const { audioTracks, localMedia } = require("./controller.js");
const { createIinaAdapter } = require("./iina-adapter.js");
const { createJobController } = require("./job-controller.js");
const { operationCapabilities } = require("./operation-policy.js");
const { createLanguagePreflightClient } = require("./language-preflight-client.js");
const { createSubtitleImportRuntime } = require("./subtitle-generation.js");
const { createGenerationWorkflow } = require("./generation-workflow.js");
const { createSubtitlePlayback } = require("./subtitle-playback.js");
const { createSubtitleEditorController } = require("./subtitle-editor-controller.js");
const { createRuntimeStore } = require("./runtime-store.js");
const { idleJob, projectJob } = require("./runtime-state.js");
const { createSidebarLifecycle } = require("./sidebar-lifecycle.js");
const { createSettingsController } = require("./settings-controller.js");
const { readSetting } = require("./settings-schema.js");
const { createSubtitleSettings, subtitleLanguages } = require("./subtitle-settings.js");
const { createSubtitleExportRuntime } = require("./subtitle-export-controller.js");
const { renderSubtitleMode } = require("./subtitle-display.js");
const { mediaPathForURL: getMediaPath, mediaSnapshot: getMediaSnapshot, playerWindowIsLoaded: isPlayerWindowLoaded } = require("./media-snapshot.js");
const iinaAdapter = createIinaAdapter(iina);
const { console: hostConsole, core, event, file, menu, mpv, preferences, sidebar, utils } = iinaAdapter;
const mediaPathForURL = (value) => getMediaPath(value, localMedia);
const mediaSnapshot = (url) => getMediaSnapshot(url, localMedia);
const playerWindowIsLoaded = () => isPlayerWindowLoaded(core);
const subtitleSettings = createSubtitleSettings(preferences);
const jobController = createJobController({ now: () => Date.now() });
const languagePreflightClient = createLanguagePreflightClient({ exec: (...args) => utils.exec(...args), helperPath: () => helperPath, onUpdated: () => sendState() });
const runtimeStore = createRuntimeStore({
  job: idleJob(),
  subtitleLoad: idleJob(),
  feedbackSource: "generation",
  subtitleLibrary: { mediaPath: null, outputDirectoryPath: null, rootDirectoryPath: "", files: [], loading: false, error: null },
});
function currentJob() { return jobController.current(); }
function jobState() { return runtimeStore.getState().job; }
function subtitleLoadState() { return runtimeStore.getState().subtitleLoad; }
function presentedJob() { return projectJob(runtimeStore.getState(), Boolean(currentJob())); }
function replaceJob(nextJob, timing) { runtimeStore.setState((state) => ({ ...state, job: jobController.withTiming(nextJob, timing), feedbackSource: "generation" })); }
function operations(continuing = null) {
  return operationCapabilities({ jobActive: Boolean(currentJob()), generationJob: jobState(), subtitleLoad: subtitleLoadState(), editorOpen: subtitleEditor.isOpen(), deletionOpen: subtitleDeletion.isOpen(), associationOpen: subtitleAssociation.isOpen(), importOpen: subtitleImport.isOpen(), subtitleLibraryLoading: subtitleLibraryState().loading }, continuing);
}
const subtitleEditor = createSubtitleEditorController({
  file,
  utils,
  getContext: () => ({ busy: !operations("edit").edit, helperPath, mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url), outputDirectoryPath: readSetting(preferences, "output_directory"), files: subtitleLibraryState().files }),
  send: (payload) => send("editor", payload),
  onChanged: sendState,
  onSaved: async (path, media) => {
    await refreshSubtitleLibrary(media, true);
    await loadSubtitle(path, media, false, true);
  },
  seek: (time) => mpv.command("seek", [String(time), "absolute"]),
  getPlayback: () => ({ position: Number(mpv.getNumber("time-pos")) || 0, duration: Number(mpv.getNumber("duration")) || 0, paused: mpv.getNative("pause") !== false }),
});
const subtitleTrackManager = require("./subtitle-style-runtime.js").createStyledSubtitleTrackManager({ mpv, preferences, file, utils, event, mediaPathForURL, renderSubtitleMode, getContext: () => ({ helperPath, path: playback.currentPath(), loaded: subtitleLoadState().loaded, busy: !operations().style }), reload: (path) => loadSubtitle(path, null, false, true) });
let uiLoaded = false;
let pendingFileLoadedURL = null;
let latestFileLoadedURL = null;
let fileLoadedSequence = 0;
let sidebarLoadRequested = false;
let sidebarShowRequested = false;
let sidebarLifecycle;
let helperPath = null;
let mediaOperation = runtimeStore.begin("media");
const subtitleLibraryClient = require("./subtitle-library-client.js").createSubtitleLibraryClient({
  exec: (...args) => utils.exec(...args),
  mediaPathForURL: (value) => mediaPathForURL(value || latestFileLoadedURL || core.status.url),
  subtitleLanguages,
  beginOperation: () => runtimeStore.begin("library"),
  isCurrentOperation: (operation) => runtimeStore.isCurrent(operation),
  onStateChanged: (subtitleLibrary) => runtimeStore.setState((state) => ({ ...state, subtitleLibrary })),
  isAutoLoadEnabled: () => settingsController.autoLoadEnabled(),
  onMediaChanged: () => {
    if (!currentJob()) {
      playback.reset();
      replaceJob(idleJob());
    }
  },
  onUpdated: (mediaURLOverride) => sendState(mediaURLOverride),
  onAutoLoad: (files, mediaPathOverride) => {
    const mediaPath = mediaPathOverride || mediaPathForURL(latestFileLoadedURL || core.status.url);
    const selected = subtitleSettings.selectedSubtitle(mediaPath, files);
    if (!selected) return;
    if (currentJob()) return generationWorkflow.deferAutoLoad(selected.path, mediaPath);
    if (!operations().load) return;
    loadSubtitle(selected.path, mediaPathOverride);
  },
  onError: () => sendState(),
});
const subtitleLibraryState = () => runtimeStore.getState().subtitleLibrary;
const subtitleAssociation = require("./subtitle-association-controller.js").createSubtitleAssociationController({
  getContext: () => ({ mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url), title: core.status.title, outputDirectoryPath: readSetting(preferences, "output_directory"), helperPath, busy: !operations("associate").associate }),
  exec: (...args) => utils.exec(...args), send: (payload) => send("association", payload), onChanged: sendState,
  onAssociated: async (path, media, root) => {
    if (media !== mediaPathForURL(latestFileLoadedURL || core.status.url) || root !== readSetting(preferences, "output_directory")) return;
    await refreshSubtitleLibrary(media, true);
    if (media !== mediaPathForURL(latestFileLoadedURL || core.status.url) || root !== readSetting(preferences, "output_directory")) return;
    await loadSubtitle(path, media, true);
  },
});
const subtitleImport = createSubtitleImportRuntime({
  getContext: () => ({ mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url), outputDirectoryPath: readSetting(preferences, "output_directory"), helperPath, busy: !operations("import").import }),
  exec: (...args) => utils.exec(...args), start: (payload) => startJob(payload), onChanged: sendState, onError: (error) => setJobError(error.message || String(error)),
});
const subtitleDeletion = require("./subtitle-deletion-runtime.js").createSubtitleDeletionRuntime({
  getContext: () => ({ mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url), title: core.status.title, outputDirectoryPath: readSetting(preferences, "output_directory"), helperPath, files: subtitleLibraryState().files, busy: !operations("delete").delete }),
  exec: (...args) => utils.exec(...args),
  send: (payload) => send("deletion", payload),
  onChanged: () => sendState(),
  settings: subtitleSettings,
  library: subtitleLibraryClient,
  currentMediaPath: () => mediaPathForURL(latestFileLoadedURL || core.status.url),
  outputDirectoryPath: () => readSetting(preferences, "output_directory"),
  refresh: (mediaPath) => refreshSubtitleLibrary(mediaPath, true, true),
  clearOutput(path) {
    if (!playback.clear(path)) return;
    replaceJob({ status: "idle", message: "", path: null, loaded: false });
  },
});
const settingsController = createSettingsController({
  preferences,
  exec: (...args) => utils.exec(...args),
  invalidateLibrary() {
    subtitleLibraryClient.invalidate();
  },
  reportError: (message) => setJobError(message),
});
function workflowContext() {
  const mediaURL = latestFileLoadedURL || core.status.url;
  return { helperPath, mediaURL, mediaPath: mediaPathForURL(mediaURL), fileLoadedSequence, mediaOperation };
}
const publishJob = () => send("job", presentedJob());
const playback = createSubtitlePlayback({
  core, mpv, runtimeStore, jobController, subtitleSettings, subtitleTrackManager,
  getContext: workflowContext, mediaPathForURL, operations, publishJob, sendState,
  now: () => Date.now(), schedule: setTimeout,
});
const generationWorkflow = createGenerationWorkflow({
  jobController, runtimeStore, languagePreflightClient, subtitleSettings, subtitleLibraryClient,
  preferences, utils, mpv, hostConsole, getContext: workflowContext, operations,
  jobState, replaceJob, publishJob, sendState, playback, now: () => Date.now(),
  getRequestSettings: () => ({ ...subtitleTrackManager.generationSettings(), ...iinaAdapter.videoDimensions(), outputDirectoryPath: readSetting(preferences, "output_directory") }),
});
const startJob = (...args) => generationWorkflow.start(...args);
const cancelJob = () => generationWorkflow.cancel();
const setJobError = (...args) => generationWorkflow.fail(...args);
const loadSubtitle = (...args) => playback.load(...args);
const setDisplayMode = (mode) => playback.setDisplayMode(mode);
const sidebarReadyTimeout = 2000;
const subtitleExportController = createSubtitleExportRuntime({
  utils,
  getContext() {
    const { media } = mediaSnapshot(latestFileLoadedURL || core.status.url);
    const library = subtitleLibraryState();
    return {
      helperPath,
      mediaPath: media ? media.path : "",
      libraryRootPath: library.mediaPath === (media && media.path) ? library.rootDirectoryPath : "",
      subtitles: library.mediaPath === (media && media.path) ? library.files : [],
    };
  },
  onResult: (result) => send("exportResult", result),
});
function loadSidebarPage(show = false) {
  sidebarShowRequested = sidebarShowRequested || show;
  if (uiLoaded) {
    if (sidebarShowRequested) {
      sidebarShowRequested = false;
      sidebar.show();
    }
    return;
  }
  if (sidebarLoadRequested) {
    if (sidebarShowRequested) {
      sidebarShowRequested = false;
      sidebar.show();
    }
    return;
  }
  sidebarLoadRequested = true;
  try {
    sidebar.loadFile("sidebar.html");
    sidebar.onMessage("ready", (payload) => {
      uiLoaded = true;
      sidebarLoadRequested = false;
      sidebarLifecycle.markLoadFinished();
      const loadedURL = pendingFileLoadedURL;
      pendingFileLoadedURL = null;
      const candidate = payload && payload.helperPath;
      if (typeof candidate !== "string" || !candidate.startsWith("/")) {
        setJobError("无法定位 Otoha helper，请重新打开插件侧栏。");
        sendState(loadedURL);
        return;
      }
      helperPath = utils.resolvePath(candidate);
      if (!helperPath) {
        setJobError("无法定位 Otoha helper，请重新安装插件。");
        sendState(loadedURL);
        return;
      }
      refreshSubtitleLibrary(loadedURL, Boolean(loadedURL));
      sendState(loadedURL);
    });
    sidebar.onMessage("refresh", () => {
      refreshSubtitleLibrary();
      sendState();
    });
    sidebar.onMessage("start", (payload) => startJob(payload));
    sidebar.onMessage("importSubtitle", (payload) => subtitleImport.import(payload));
    sidebar.onMessage("progressReady", (payload) => jobController.releaseStart(payload?.jobId));
    sidebar.onMessage("checkLanguages", (payload) => operations().preflight && languagePreflightClient.check({ ...payload, mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url) }, payload?.force === true));
    subtitleDeletion.register(sidebar);
    subtitleEditor.register(sidebar);
    subtitleAssociation.register(sidebar);
    sidebar.onMessage("loadExisting", (filePath) => {
      if (operations().load && subtitleLibraryState().files.some((subtitle) => subtitle.path === filePath)) return loadSubtitle(filePath, null, true);
    });
    sidebar.onMessage("exportSubtitle", (payload) => operations().export && subtitleExportController.export(payload));
    sidebar.onMessage("setDisplayMode", (mode) => setDisplayMode(mode));
    sidebar.onMessage("cancel", () => cancelJob());
    sidebar.onMessage("retryLoad", () => {
      if (operations().load) return loadSubtitle(playback.currentPath());
    });
    sidebar.onMessage("reveal", (filePath) => settingsController.reveal(filePath || playback.currentPath()));
    sidebar.onMessage("setSetting", ({ key, value }) =>
      settingsController.setSetting(key, value).then(() => {
        refreshSubtitleLibrary(null, true);
        sendState();
      }),
    );
    if (sidebarShowRequested) {
      sidebarShowRequested = false;
      sidebar.show();
    }
    setTimeout(() => {
      if (!uiLoaded && sidebarLoadRequested) {
        sidebarLoadRequested = false;
        sidebarLifecycle.markLoadFinished();
        sidebarLifecycle.scheduleRetry();
      }
    }, sidebarReadyTimeout);
  } catch (error) {
    sidebarLoadRequested = false;
    sidebarLifecycle.markLoadFinished();
    hostConsole.error(`Otoha: 无法加载侧栏：${error.message || error}`);
    sidebarLifecycle.scheduleRetry();
  }
}
sidebarLifecycle = createSidebarLifecycle({
  isLoaded: () => uiLoaded,
  isWindowLoaded: playerWindowIsLoaded,
  load(show) {
    sidebarLifecycle.markLoadStarted();
    loadSidebarPage(show);
  },
  schedule: setTimeout,
  pageLoadDelay: 500,
});
function showSidebar() {
  if (!playerWindowIsLoaded()) {
    setJobError("播放器窗口尚未准备好，请稍后再试。");
    sendState();
    return;
  }
  if (uiLoaded) {
    sidebar.show();
    return;
  }
  loadSidebarPage(true);
}
event.on("iina.window-loaded", () => {
  if (!uiLoaded) {
    sidebarLifecycle.reset();
    sidebarLifecycle.initialize();
  } else sendState();
});
event.on("iina.file-loaded", (url) => {
  const eventMediaPath = mediaPathForURL(url);
  const activeJob = currentJob();
  if (activeJob && (!eventMediaPath || activeJob.mediaPath !== eventMediaPath)) cancelJob();
  latestFileLoadedURL = eventMediaPath ? url : null;
  mediaOperation = runtimeStore.begin("media");
  runtimeStore.begin("display");
  fileLoadedSequence += 1;
  subtitleTrackManager.reset();
  playback.reset();
  if (eventMediaPath && !uiLoaded) pendingFileLoadedURL = url;
  if (!uiLoaded) sidebarLifecycle.initialize();
  else {
    refreshSubtitleLibrary(eventMediaPath ? url : undefined, Boolean(eventMediaPath));
    sendState(eventMediaPath ? url : undefined);
  }
});
if (menu && typeof menu.addItem === "function" && typeof menu.item === "function") menu.addItem(menu.item("显示 Otoha 侧栏", () => showSidebar()));
sidebarLifecycle.scheduleRetry();
function send(name, payload) {
  if (uiLoaded) sidebar.postMessage(name, payload);
}
function refreshSubtitleLibrary(mediaURLOverride = null, force = false, suppressAutoLoad = false) {
  const url = mediaURLOverride || latestFileLoadedURL || core.status.url;
  const { media } = mediaSnapshot(url);
  const outputDirectoryPath = readSetting(preferences, "output_directory");
  return subtitleLibraryClient.update({ helperPath, media, mediaURLOverride, outputDirectoryPath, force, suppressAutoLoad: suppressAutoLoad || subtitleDeletion.isOpen() });
}
function sendState(mediaURLOverride = null) {
  const url = mediaURLOverride || latestFileLoadedURL || core.status.url;
  const { media, mediaError } = mediaSnapshot(url);
  const rawTracks = mpv.getNative("track-list") || [];
  const tracks = audioTracks(rawTracks);
  const selectedNative = rawTracks.find((track) => track && track.type === "audio" && track.selected);
  const selectedAudioId = selectedNative ? selectedNative.id : mpv.getNative("aid");
  const selectedTrack = tracks.find((track) => String(track.id) === String(selectedAudioId));
  const outputDirectory = readSetting(preferences, "output_directory");
  const subtitleLibrary = subtitleLibraryState();
  const availableSubtitles = media && subtitleLibrary.mediaPath === media.path ? subtitleLibrary.files : [];
  const languages = subtitleSettings.languages(media ? media.path : "", utils.preferredLocalizations(), availableSubtitles);
  const selectedSubtitle = subtitleSettings.selectedSubtitle(media ? media.path : "", availableSubtitles);
  const displayMode = selectedSubtitle?.mode === "source" ? "source" : media ? subtitleSettings.displayMode(media.path) : "bilingual";
  send("state", {
    title: core.status.title || (media && media.name) || "",
    media,
    mediaError,
    tracks,
    selectedTrackId: selectedTrack ? selectedTrack.id : null,
    sourceLanguage: languages.sourceLanguage,
    targetLanguage: languages.targetLanguage,
    selectedSubtitlePath: selectedSubtitle ? selectedSubtitle.path : "",
    displayMode,
    autoLoad: settingsController.autoLoadEnabled(),
    outputDirectory,
    effectiveOutputDirectory: outputDirectory || subtitleLibrary.rootDirectoryPath,
    availableSubtitles,
    subtitleLibraryLoading: Boolean(media && subtitleLibrary.mediaPath === media.path && subtitleLibrary.loading),
    ffmpegPath: preferences.get("ffmpeg_path") || "",
    job: presentedJob(), jobActive: Boolean(currentJob()),
    generationJob: jobState(), subtitleLoad: subtitleLoadState(), subtitleLibraryError: subtitleLibrary.error || null,
    languagePreflight: languagePreflightClient.getState(),
    editorOpen: subtitleEditor.isOpen(),
    deletionOpen: subtitleDeletion.isOpen(),
    associationOpen: subtitleAssociation.isOpen(), importOpen: subtitleImport.isOpen(),
    hasOutput: Boolean(playback.currentPath() || availableSubtitles.length),
  });
}
runtimeStore.subscribe(() => sendState());
