const { audioTracks, createJsonLineParser, localMedia, phaseLabel, PROTOCOL_VERSION, resolveFFmpegPath, resolveAudioStreamIndex, waitForSubtitleTrack } = require("./controller.js");
const { createIinaAdapter } = require("./iina-adapter.js");
const { createJobController } = require("./job-controller.js");
const { createLanguagePreflightClient } = require("./language-preflight-client.js");
const { createSubtitleEditorController } = require("./subtitle-editor-controller.js");
const { createRuntimeStore } = require("./runtime-store.js");
const { createSidebarLifecycle } = require("./sidebar-lifecycle.js");
const { createSettingsController } = require("./settings-controller.js");
const { readSetting } = require("./settings-schema.js");
const { createSubtitleSettings, subtitleLanguages } = require("./subtitle-settings.js");
const { createSubtitleExportRuntime } = require("./subtitle-export-controller.js");
const { normalizeDisplayMode, renderSubtitleMode } = require("./subtitle-display.js");
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
  job: { jobId: null, status: "idle", phase: "", message: "", progress: null, path: null, loaded: false, errorCode: null },
  subtitleLibrary: { mediaPath: null, outputDirectoryPath: null, rootDirectoryPath: "", files: [], loading: false },
});
function currentJob() { return jobController.current(); }
function jobState() { return runtimeStore.getState().job; }
function replaceJob(nextJob) { runtimeStore.setState((state) => ({ ...state, job: jobController.withTiming(nextJob) })); }
const subtitleEditor = createSubtitleEditorController({
  file,
  utils,
  getContext: () => ({ busy: Boolean(currentJob()) || jobState().status === "loading" || subtitleDeletion.isOpen(), helperPath, mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url), outputDirectoryPath: readSetting(preferences, "output_directory"), files: subtitleLibraryState().files }),
  send: (payload) => send("editor", payload),
  onChanged: sendState,
  onSaved: async (path, media) => {
    await refreshSubtitleLibrary(media, true);
    await loadSubtitle(path, media, false, true);
  },
  seek: (time) => mpv.command("seek", [String(time), "absolute"]),
});
const subtitleTrackManager = require("./subtitle-style-runtime.js").createStyledSubtitleTrackManager({ mpv, preferences, file, utils, event, mediaPathForURL, renderSubtitleMode, getContext: () => ({ helperPath, path: lastOutputPath, loaded: jobState().loaded, busy: Boolean(currentJob()) || subtitleEditor.isOpen() || subtitleDeletion.isOpen() }), reload: (path) => loadSubtitle(path, null, false, true) });
let uiLoaded = false;
let pendingFileLoadedURL = null;
let latestFileLoadedURL = null;
let fileLoadedSequence = 0;
let sidebarLoadRequested = false;
let sidebarShowRequested = false;
let sidebarLifecycle;
let helperPath = null;
let lastOutputPath = null;
let pendingAutoLoad = null;
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
      lastOutputPath = null;
      replaceJob({ jobId: null, status: "idle", phase: "", message: "", progress: null, path: null, loaded: false, errorCode: null });
    }
  },
  onUpdated: (mediaURLOverride) => sendState(mediaURLOverride),
  onAutoLoad: (files, mediaPathOverride) => {
    if (subtitleEditor.isOpen()) return;
    const mediaPath = mediaPathOverride || mediaPathForURL(latestFileLoadedURL || core.status.url);
    const selected = subtitleSettings.selectedSubtitle(mediaPath, files);
    if (!selected) return;
    if (currentJob()) return void (pendingAutoLoad = { mediaPath, path: selected.path });
    loadSubtitle(selected.path, mediaPathOverride);
  },
  onError: ({ previousFiles, error }) => {
    replaceJob({
      status: previousFiles.length ? "available" : "error",
      phase: "",
      message: previousFiles.length ? `新字幕库读取失败，仍可使用已发现的字幕：${error.message || error}` : `无法读取字幕列表：${error.message || error}`,
      progress: null,
      path: lastOutputPath,
      loaded: false,
      errorCode: "subtitle.libraryFailed",
    });
    sendState();
  },
});
const subtitleLibraryState = () => runtimeStore.getState().subtitleLibrary;
const subtitleDeletion = require("./subtitle-deletion-runtime.js").createSubtitleDeletionRuntime({
  getContext: () => ({ mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url), title: core.status.title, outputDirectoryPath: readSetting(preferences, "output_directory"), helperPath, files: subtitleLibraryState().files, busy: Boolean(currentJob()) || jobState().status === "loading" || subtitleEditor.isOpen() }),
  exec: (...args) => utils.exec(...args),
  send: (payload) => send("deletion", payload),
  onChanged: () => sendState(),
  settings: subtitleSettings,
  library: subtitleLibraryClient,
  currentMediaPath: () => mediaPathForURL(latestFileLoadedURL || core.status.url),
  outputDirectoryPath: () => readSetting(preferences, "output_directory"),
  refresh: (mediaPath) => refreshSubtitleLibrary(mediaPath, true, true),
  clearOutput(path) {
    if (lastOutputPath !== path) return;
    runtimeStore.begin("display");
    subtitleTrackManager.unload();
    lastOutputPath = null;
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
const initializeSidebar = () => sidebarLifecycle.initialize();
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
    sidebar.onMessage("progressReady", (payload) => jobController.releaseStart(payload?.jobId));
    sidebar.onMessage("checkLanguages", (payload) => !currentJob() && languagePreflightClient.check({ ...payload, mediaPath: mediaPathForURL(latestFileLoadedURL || core.status.url) }, true));
    subtitleDeletion.register(sidebar);
    subtitleEditor.register(sidebar);
    sidebar.onMessage("loadExisting", (filePath) => {
      if (!currentJob() && !subtitleDeletion.isOpen() && !subtitleEditor.isOpen() && subtitleLibraryState().files.some((subtitle) => subtitle.path === filePath)) loadSubtitle(filePath, null, true);
    });
    sidebar.onMessage("exportSubtitle", (payload) => subtitleExportController.export(payload));
    sidebar.onMessage("setDisplayMode", (mode) => setDisplayMode(mode));
    sidebar.onMessage("cancel", () => cancelJob());
    sidebar.onMessage("retryLoad", () => {
      if (!currentJob()) return loadSubtitle(lastOutputPath);
      return undefined;
    });
    sidebar.onMessage("reveal", (filePath) => settingsController.reveal(filePath || lastOutputPath));
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
    initializeSidebar();
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
  if (eventMediaPath && !uiLoaded) pendingFileLoadedURL = url;
  if (!uiLoaded) initializeSidebar();
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
  const displayMode = media ? subtitleSettings.displayMode(media.path) : "bilingual";
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
    job: jobState(), jobActive: Boolean(currentJob()),
    languagePreflight: languagePreflightClient.getState(),
    editorOpen: subtitleEditor.isOpen(),
    hasOutput: Boolean(lastOutputPath || availableSubtitles.length),
  });
}
async function startJob(payload = {}, mediaOverride = null) {
  if (currentJob() || subtitleDeletion.isOpen() || subtitleEditor.isOpen()) return;
  runtimeStore.begin("display");
  const jobFileLoadedSequence = fileLoadedSequence;
  let jobId = null;
  try {
    if (!helperPath) throw new Error("Otoha 侧栏尚未完成初始化，请重新打开侧栏。");
    const media = mediaOverride || localMedia(latestFileLoadedURL || core.status.url);
    const tracks = audioTracks(mpv.getNative("track-list") || []);
    const streamIndex = resolveAudioStreamIndex(tracks, payload.trackId);
    const sourceLanguage = String(payload.sourceLanguage || "");
    const targetLanguage = String(payload.targetLanguage || "");
    if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) {
      throw new Error("请选择不同的转录语言和翻译语言。");
    }
    jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cancelPath = utils.resolvePath(`@tmp/otoha-${jobId}.cancel`);
    if (!cancelPath) throw new Error("无法创建字幕任务取消标记。");
    const claimedJob = jobController.begin({ id: jobId, cancelPath, mediaPath: media.path, languages: { sourceLanguage, targetLanguage }, fileLoadedSequence: jobFileLoadedSequence, mediaOperation, deferStart: payload.waitForProgress === true });
    if (!claimedJob) return;
    replaceJob({ jobId, status: "running", phase: "checkingEnvironment", message: "正在启动", progress: null, path: null, loaded: false, errorCode: null });
    sendState(mediaOverride ? media.path : undefined);
    if (claimedJob.presentation && !(await claimedJob.presentation)) throw Object.assign(new Error("无法显示生成进度，请重新打开侧栏后重试。"), { code: "ui.progressUnavailable" });
    await languagePreflightClient.check({ sourceLanguage, targetLanguage, mediaPath: media.path });
    const check = languagePreflightClient.getState(); if (check.status !== "ready") throw Object.assign(new Error(check.message || "请重试语言检查。"), { code: check.errorCode });
    const ffmpegPath = await resolveFFmpegPath(preferences, (...args) => utils.exec(...args));
    if (claimedJob.cancelRequested || jobFileLoadedSequence !== fileLoadedSequence || mediaPathForURL(latestFileLoadedURL || core.status.url) !== media.path) {
      jobController.markTerminal(); replaceJob({ ...jobState(), status: "cancelled", phase: "", message: "已取消", progress: null, path: null, loaded: false, errorCode: "job.cancelled" }); send("job", jobState()); return;
    }
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      jobId,
      backend: "apple",
      mediaPath: media.path,
      ffmpegPath,
      audioStreamIndex: streamIndex,
      sourceLanguage,
      targetLanguage,
      ...subtitleTrackManager.generationSettings(),
      ...iinaAdapter.videoDimensions(),
      outputDirectoryPath: readSetting(preferences, "output_directory"),
      cancellationFilePath: cancelPath,
    };
    const parser = createJsonLineParser(handleHelperEvent, (error) => {
      hostConsole.error(`Otoha: 忽略无效 helper 事件：${error.message}`);
    });
    claimedJob.parser = parser;
    let stderr = "";
    const args = ["--request-json", JSON.stringify(request)];
    const result = await utils.exec(helperPath, args, null,
      (chunk) => parser.push(chunk),
      (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    parser.flush();
    if (claimedJob.completion) await claimedJob.completion;
    if (!claimedJob.terminal) {
      if (result.status !== 0) {
        setJobError(stderr.trim() || `字幕 helper 退出，状态码 ${result.status}。`);
      } else {
        setJobError("字幕 helper 已退出，但没有返回完成事件。");
      }
    }
  } catch (error) {
    if (currentJob() && !runtimeStore.isCurrent(currentJob().mediaOperation)) replaceJob({ jobId: null, status: "idle", message: "", phase: "", progress: null, path: null, loaded: false, errorCode: null });
    else if (currentJob()?.cancelRequested) {
      replaceJob({ ...jobState(), status: "cancelled", message: "已取消", phase: "", progress: null, errorCode: "job.cancelled" }); send("job", jobState());
    } else setJobError(error.message || String(error), error.code);
  } finally {
    const runningJob = currentJob();
    if (runningJob && runningJob.id === jobId && runningJob.cancelPath) {
      utils.exec("/bin/rm", ["-f", runningJob.cancelPath]).catch(() => {});
    }
    if (runningJob && runningJob.id === jobId && pendingAutoLoad) {
      const deferred = pendingAutoLoad;
      pendingAutoLoad = null;
      if (mediaPathForURL(latestFileLoadedURL || core.status.url) === deferred.mediaPath) await loadSubtitle(deferred.path);
    }
    jobController.reset();
    sendState(mediaOverride ? mediaOverride.path : undefined);
  }
}
function handleHelperEvent(helperEvent) {
  const runningJob = currentJob();
  if (!runningJob || (helperEvent.jobId !== runningJob.id && !(helperEvent.type === "error" && helperEvent.jobId === "unknown"))) return;
  if (runningJob.terminal) return;
  const currentMediaPath = mediaPathForURL(latestFileLoadedURL || core.status.url);
  const staleForPlayback = !runtimeStore.isCurrent(runningJob.mediaOperation) || runningJob.fileLoadedSequence !== fileLoadedSequence || (currentMediaPath && currentMediaPath !== runningJob.mediaPath);
  if (staleForPlayback && helperEvent.type !== "completed") {
    if (["error", "cancelled"].includes(helperEvent.type)) jobController.markTerminal();
    return;
  }
  if (helperEvent.type === "phase") {
    if (runningJob.cancelRequested) return;
    replaceJob({
      ...jobState(),
      phase: helperEvent.phase || "",
      message: helperEvent.message || phaseLabel(helperEvent.phase),
      progress: Number.isFinite(helperEvent.progress) ? helperEvent.progress : null,
    });
    send("job", jobState());
    return;
  }
  if (helperEvent.type === "completed" && typeof helperEvent.path === "string") {
    jobController.markTerminal();
    subtitleSettings.rememberGeneration(runningJob.mediaPath, runningJob.languages, helperEvent.path);
    const subtitleLibrary = subtitleLibraryState();
    if (subtitleLibrary.mediaPath === runningJob.mediaPath) subtitleLibraryClient.addFile({ path: helperEvent.path, ...runningJob.languages });
    const currentStatusMediaPath = mediaPathForURL(latestFileLoadedURL || core.status.url);
    const fileLoadedMediaIsCurrent = runtimeStore.isCurrent(runningJob.mediaOperation) && runningJob.fileLoadedSequence === fileLoadedSequence;
    const statusMediaIsCurrent = !currentStatusMediaPath || currentStatusMediaPath === runningJob.mediaPath;
    if (!fileLoadedMediaIsCurrent || !statusMediaIsCurrent) {
      replaceJob({ jobId: runningJob.id, status: "completed", phase: "", message: "字幕已保存；当前视频已更换，因此未自动加载。", progress: null, path: helperEvent.path, loaded: false, errorCode: null });
      send("job", jobState());
      return;
    }
    lastOutputPath = helperEvent.path;
    replaceJob({ jobId: runningJob.id, status: "loading", phase: "loading", message: "字幕已生成，正在加载", progress: null, path: helperEvent.path, loaded: false, errorCode: null });
    send("job", jobState());
    jobController.setCompletion(loadSubtitle(helperEvent.path, runningJob.mediaPath));
    return;
  }
  if (helperEvent.type === "cancelled") {
    jobController.markTerminal();
    replaceJob({ jobId: runningJob.id, status: "cancelled", phase: "", message: "已取消", progress: null, path: null, loaded: false, errorCode: "job.cancelled" });
    send("job", jobState());
    return;
  }

  if (helperEvent.type === "error") {
    jobController.markTerminal();
    setJobError(helperEvent.message || "字幕生成失败。", helperEvent.code || "helper.unknown");
  }
}
function setJobError(message, errorCode = "helper.unknown") {
  const runningJob = currentJob();
  if (runningJob) jobController.markTerminal();
  replaceJob({ jobId: runningJob ? runningJob.id : null, status: "error", phase: "", message, progress: null, path: lastOutputPath, loaded: false, errorCode });
  send("job", jobState());
}
async function cancelJob() {
  const runningJob = currentJob();
  if (!runningJob || !runningJob.cancelPath) return;
  jobController.requestCancel();
  replaceJob({ ...jobState(), status: "canceling", message: "正在取消" });
  send("job", jobState());
  try {
    await utils.exec("/usr/bin/touch", [runningJob.cancelPath]);
  } catch (error) {
    setJobError(`无法发送取消请求：${error.message || error}`);
  }
}
async function loadSubtitle(filePath, mediaURLOverride = null, rememberSelection = false, forceReload = false) {
  if (!filePath) return;
  const mediaPath = mediaPathForURL(mediaURLOverride || latestFileLoadedURL || core.status.url);
  const loadFileLoadedSequence = fileLoadedSequence;
  const loadMediaOperation = mediaOperation;
  const loadDisplayOperation = runtimeStore.begin("display");
  const displayMode = subtitleSettings.displayMode(mediaPath);
  const isCurrentMedia = () => runtimeStore.isCurrent(loadMediaOperation) && runtimeStore.isCurrent(loadDisplayOperation) && loadFileLoadedSequence === fileLoadedSequence && mediaPathForURL(latestFileLoadedURL || core.status.url) === mediaPath;
  let loadedPath = filePath;
  const runningJob = currentJob();
  replaceJob({ ...jobState(), jobId: runningJob ? runningJob.id : null, status: "loading", phase: "loading", message: "正在加载字幕", path: filePath, loaded: false, errorCode: null });
  send("job", jobState());
  try {
    loadedPath = await subtitleTrackManager.prepare(filePath, mediaPath, displayMode);
    if (!isCurrentMedia()) return;
    const existing = subtitleTrackManager.find(loadedPath);
    if (forceReload && existing) mpv.command("sub-reload", [String(existing.id)]);
    else await core.subtitle.loadTrack(loadedPath);
    await waitForSubtitleTrack(mpv, loadedPath, Date.now, setTimeout);
    if (!isCurrentMedia()) return;
    const loadedTrack = subtitleTrackManager.find(loadedPath);
    if (loadedTrack && core.subtitle) core.subtitle.id = loadedTrack.id;
    subtitleTrackManager.removePrevious(loadedPath);
    if (rememberSelection) subtitleSettings.rememberSelection(mediaPath, filePath);
    lastOutputPath = filePath;
    replaceJob({ ...jobState(), status: "completed", phase: "", message: "双语字幕已加载", progress: null, path: filePath, loaded: true, displayMode, errorCode: null });
  } catch (error) {
    if (!isCurrentMedia()) return;
    lastOutputPath = filePath;
    replaceJob({ ...jobState(), status: "load-error", phase: "", message: `字幕已生成，但 IINA 加载失败：${error.message || error}`, progress: null, path: filePath, loaded: false, errorCode: "subtitle.loadFailed" });
  }
  send("job", jobState());
  sendState(mediaURLOverride);
}
function setDisplayMode(value) {
  if (currentJob() || subtitleDeletion.isOpen() || subtitleEditor.isOpen()) return;
  const mode = normalizeDisplayMode(value);
  const mediaPath = mediaPathForURL(latestFileLoadedURL || core.status.url);
  if (!mediaPath) return;
  subtitleSettings.rememberDisplayMode(mediaPath, mode);
  const selectedSubtitle = subtitleSettings.selectedSubtitle(mediaPath, subtitleLibraryState().files);
  if (selectedSubtitle) loadSubtitle(selectedSubtitle.path);
  else sendState();
}
