const {
  LANGUAGES,
  audioTracks,
  createJsonLineParser,
  localMedia,
  phaseLabel,
  resolveFFmpegPath,
  resolveAudioStreamIndex,
  waitForSubtitleTrack,
} = require("./controller.js");
const { createSubtitleSettings, subtitleLanguages } = require("./subtitle-settings.js");
const { core, event, menu, mpv, preferences, sidebar, utils } = iina;
const subtitleSettings = createSubtitleSettings(preferences);
const activeJob = { id: null, cancelPath: null, mediaPath: null, parser: null, terminal: false, fileLoadedSequence: null };
let uiLoaded = false;
let pendingFileLoadedURL = null;
let latestFileLoadedURL = null;
let fileLoadedSequence = 0;
let sidebarRetryPending = false;
let sidebarRetryIndex = 0;
let sidebarPageLoadPending = false;
let sidebarLoadRequested = false;
let sidebarShowRequested = false;
let helperPath = null;
let lastOutputPath = null;
let subtitleLibrary = { mediaPath: null, outputDirectoryPath: null, rootDirectoryPath: "", files: [], loading: false };
let subtitleLookupId = 0;
let job = { status: "idle", phase: "", message: "", progress: null, path: null, loaded: false };
const sidebarRetryDelays = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
const sidebarReadyTimeout = 2000;
const sidebarPageLoadDelay = 500;
function playerWindowIsLoaded() {
  return !core.window || core.window.loaded === true;
}
function mediaPathForURL(value) { try { return localMedia(value).path; } catch { return ""; } }
function scheduleSidebarLoad() {
  if (uiLoaded || sidebarRetryPending || sidebarPageLoadPending || sidebarLoadRequested) return;
  const delay = sidebarRetryDelays[Math.min(sidebarRetryIndex, sidebarRetryDelays.length - 1)];
  sidebarRetryIndex += 1;
  sidebarRetryPending = true;
  setTimeout(() => {
    sidebarRetryPending = false;
    if (!uiLoaded) initializeSidebar();
  }, delay);
}
function initializeSidebar() {
  if (uiLoaded || sidebarPageLoadPending || sidebarLoadRequested) return;
  if (!playerWindowIsLoaded()) {
    scheduleSidebarLoad();
    return;
  }

  try {
    sidebarPageLoadPending = true;
    setTimeout(() => {
      sidebarPageLoadPending = false;
      if (!uiLoaded && !sidebarLoadRequested) loadSidebarPage();
    }, sidebarPageLoadDelay);
  } catch (error) {
    iina.console.error(`Otoha: 无法打开侧栏：${error.message || error}`);
    scheduleSidebarLoad();
  }
}

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
      const loadedURL = pendingFileLoadedURL; pendingFileLoadedURL = null;
      const candidate = payload && payload.helperPath;
      if (typeof candidate !== "string" || !candidate.startsWith("/")) {
        setJobError("无法定位 Otoha helper，请重新打开插件侧栏。");
        sendState(loadedURL, Boolean(loadedURL));
        return;
      }
      helperPath = utils.resolvePath(candidate);
      if (!helperPath) {
        setJobError("无法定位 Otoha helper，请重新安装插件。");
        sendState(loadedURL, Boolean(loadedURL));
        return;
      }
      sendState(loadedURL, Boolean(loadedURL));
    });
    sidebar.onMessage("refresh", () => sendState());
    sidebar.onMessage("start", (payload) => startJob(payload));
    sidebar.onMessage("loadExisting", (filePath) => {
      if (subtitleLibrary.files.some((subtitle) => subtitle.path === filePath)) loadSubtitle(filePath, null, true);
    });
    sidebar.onMessage("cancel", () => cancelJob());
    sidebar.onMessage("retryLoad", () => loadSubtitle(lastOutputPath));
    sidebar.onMessage("reveal", (filePath) => revealOutput(filePath || lastOutputPath));
    sidebar.onMessage("chooseOutputDirectory", () => chooseSetting("output_directory", true));
    sidebar.onMessage("chooseFFmpeg", () => chooseSetting("ffmpeg_path", false));
    sidebar.onMessage("setSetting", ({ key, value }) => setSetting(key, value));
    if (sidebarShowRequested) {
      sidebarShowRequested = false;
      sidebar.show();
    }
    setTimeout(() => {
      if (!uiLoaded && sidebarLoadRequested) {
        sidebarLoadRequested = false;
        scheduleSidebarLoad();
      }
    }, sidebarReadyTimeout);
  } catch (error) {
    sidebarLoadRequested = false;
    iina.console.error(`Otoha: 无法加载侧栏：${error.message || error}`);
    scheduleSidebarLoad();
  }
}

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
    sidebarRetryIndex = 0;
    initializeSidebar();
  }
  else sendState();
});
event.on("iina.file-loaded", (url) => {
  const eventMediaPath = mediaPathForURL(url);
  latestFileLoadedURL = eventMediaPath ? url : null;
  fileLoadedSequence += 1;
  if (eventMediaPath && !uiLoaded) pendingFileLoadedURL = url;
  if (!uiLoaded) initializeSidebar();
  else sendState(eventMediaPath ? url : undefined, Boolean(eventMediaPath));
});
if (menu && typeof menu.addItem === "function" && typeof menu.item === "function") menu.addItem(menu.item("显示 Otoha 侧栏", () => showSidebar()));
scheduleSidebarLoad();

function send(name, payload) {
  if (uiLoaded) sidebar.postMessage(name, payload);
}

function sendState(mediaURLOverride = null, forceLibraryRefresh = false) {
  const url = mediaURLOverride || latestFileLoadedURL || core.status.url;
  let media = null;
  let mediaError = "";
  if (url) {
    try {
      media = localMedia(url);
    } catch (error) {
      mediaError = error.message;
    }
  }
  const rawTracks = mpv.getNative("track-list") || [];
  const tracks = audioTracks(rawTracks);
  const selectedNative = rawTracks.find((track) => track && track.type === "audio" && track.selected);
  const selectedAudioId = selectedNative ? selectedNative.id : mpv.getNative("aid");
  const selectedTrack = tracks.find((track) => String(track.id) === String(selectedAudioId));
  const outputDirectory = preferences.get("output_directory") || "";
  const availableSubtitles = media && subtitleLibrary.mediaPath === media.path ? subtitleLibrary.files : [];
  const languages = subtitleSettings.languages(media ? media.path : "", utils.preferredLocalizations(), availableSubtitles);
  const selectedSubtitle = subtitleSettings.selectedSubtitle(media ? media.path : "", availableSubtitles);
  updateSubtitleLibrary(media, mediaURLOverride, forceLibraryRefresh);
  send("state", {
    title: core.status.title || (media && media.name) || "",
    media,
    mediaError,
    tracks,
    selectedTrackId: selectedTrack ? selectedTrack.id : null,
    sourceLanguage: languages.sourceLanguage,
    targetLanguage: languages.targetLanguage,
    selectedSubtitlePath: selectedSubtitle ? selectedSubtitle.path : "",
    autoLoad: autoLoadEnabled(),
    outputDirectory,
    effectiveOutputDirectory: outputDirectory || subtitleLibrary.rootDirectoryPath,
    availableSubtitles,
    subtitleLibraryLoading: Boolean(media && subtitleLibrary.mediaPath === media.path && subtitleLibrary.loading),
    ffmpegPath: preferences.get("ffmpeg_path") || "",
    job,
    hasOutput: Boolean(lastOutputPath || availableSubtitles.length),
  });
}

function updateSubtitleLibrary(media, mediaURLOverride = null, forceLibraryRefresh = false) {
  if (!media) {
    if (subtitleLibrary.mediaPath !== null) {
      subtitleLookupId += 1;
      subtitleLibrary = { mediaPath: null, outputDirectoryPath: null, rootDirectoryPath: "", files: [], loading: false };
    }
    if (!activeJob.id) {
      lastOutputPath = null;
      job = { status: "idle", phase: "", message: "", progress: null, path: null, loaded: false };
    }
    return;
  }
  if (!helperPath) return;
  const outputDirectoryPath = preferences.get("output_directory") || "";
  if (!forceLibraryRefresh && subtitleLibrary.mediaPath === media.path && subtitleLibrary.outputDirectoryPath === outputDirectoryPath) return;

  const lookupId = ++subtitleLookupId;
  const mediaChanged = subtitleLibrary.mediaPath !== null && subtitleLibrary.mediaPath !== media.path;
  if (mediaChanged && !activeJob.id) {
    lastOutputPath = null;
    job = { status: "idle", phase: "", message: "", progress: null, path: null, loaded: false };
  }
  const previousFiles = subtitleLibrary.mediaPath === media.path ? subtitleLibrary.files : [];
  const previousRootDirectoryPath = subtitleLibrary.mediaPath === media.path ? subtitleLibrary.rootDirectoryPath : "";
  subtitleLibrary = {
    mediaPath: media.path,
    outputDirectoryPath,
    rootDirectoryPath: previousRootDirectoryPath,
    files: previousFiles,
    loading: true,
  };
  const request = {
    mediaPath: media.path,
    outputDirectoryPath,
  };

  utils.exec(helperPath, ["--list-subtitles-json", JSON.stringify(request)])
    .then((result) => {
      if (lookupId !== subtitleLookupId) return;
      if (!result || result.status !== 0) throw new Error("字幕库读取失败");
      const listing = JSON.parse(String(result.stdout || "{}"));
      const files = Array.isArray(listing.files)
        ? listing.files.filter((item) => item && typeof item.path === "string" && item.path.startsWith("/") && item.path.toLowerCase().endsWith(".ass"))
          .map((item) => ({ ...item, ...subtitleLanguages(item.path) }))
        : [];
      const currentMediaPath = mediaPathForURL(mediaURLOverride || latestFileLoadedURL || core.status.url);
      if (currentMediaPath !== media.path) return;

      subtitleLibrary = {
        mediaPath: media.path,
        outputDirectoryPath,
        rootDirectoryPath: typeof listing.rootDirectoryPath === "string" ? listing.rootDirectoryPath : "",
        files,
        loading: false,
      };
      if (files.length > 0 && autoLoadEnabled() && !activeJob.id) {
        loadSubtitle(subtitleSettings.selectedSubtitle(media.path, files).path, mediaURLOverride ? media.path : null);
      }
      sendState(mediaURLOverride);
    })
    .catch((error) => {
      if (lookupId !== subtitleLookupId) return;
      subtitleLibrary = {
        mediaPath: media.path,
        outputDirectoryPath,
        rootDirectoryPath: previousRootDirectoryPath,
        files: previousFiles,
        loading: false,
      };
      job = {
        status: previousFiles.length ? "available" : "error",
        phase: "",
        message: previousFiles.length
          ? `新字幕库读取失败，仍可使用已发现的字幕：${error.message || error}`
          : `无法读取已有字幕：${error.message || error}`,
        progress: null,
        path: lastOutputPath,
        loaded: false,
      };
      sendState(mediaURLOverride);
    });
}

async function startJob(payload = {}, mediaOverride = null) {
  if (activeJob.id) return;
  const jobFileLoadedSequence = fileLoadedSequence;
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
    const ffmpegPath = await resolveFFmpegPath(preferences, (...args) => utils.exec(...args));
    if (jobFileLoadedSequence !== fileLoadedSequence || mediaPathForURL(latestFileLoadedURL || core.status.url) !== media.path) {
      throw new Error("生成前视频已更换，请重新选择当前视频的字幕语言。");
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cancelPath = utils.resolvePath(`@tmp/otoha-${id}.cancel`);
    const request = {
      backend: "apple",
      mediaPath: media.path,
      ffmpegPath,
      audioStreamIndex: streamIndex,
      sourceLanguage,
      targetLanguage,
      subtitleScale: Math.min(140, Math.max(80, Number(preferences.get("subtitle_scale") || 100))) / 100,
      outputDirectoryPath: preferences.get("output_directory") || "",
      cancellationFilePath: cancelPath,
    };

    activeJob.id = id;
    activeJob.cancelPath = cancelPath;
    activeJob.mediaPath = media.path;
    activeJob.languages = { sourceLanguage, targetLanguage };
    activeJob.terminal = false;
    activeJob.fileLoadedSequence = jobFileLoadedSequence;
    job = { status: "running", phase: "checkingEnvironment", message: "正在启动", progress: null, path: null, loaded: false };
    sendState(mediaOverride ? media.path : undefined);

    const parser = createJsonLineParser(handleHelperEvent, (error) => {
      iina.console.error(`Otoha: 忽略无效 helper 事件：${error.message}`);
    });
    activeJob.parser = parser;
    let stderr = "";
    const args = ["--request-json", JSON.stringify(request)];
    const result = await utils.exec(
      helperPath,
      args,
      null,
      (chunk) => parser.push(chunk),
      (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-4000);
      },
    );
    parser.flush();
    if (!activeJob.terminal) {
      if (result.status !== 0) {
        setJobError(stderr.trim() || `字幕 helper 退出，状态码 ${result.status}。`);
      } else {
        setJobError("字幕 helper 已退出，但没有返回完成事件。");
      }
    }
  } catch (error) {
    setJobError(error.message || String(error));
  } finally {
    if (activeJob.cancelPath) {
      utils.exec("/bin/rm", ["-f", activeJob.cancelPath]).catch(() => {});
    }
    activeJob.id = null;
    activeJob.cancelPath = null;
    activeJob.mediaPath = null;
    activeJob.languages = null;
    activeJob.parser = null;
    activeJob.fileLoadedSequence = null;
    sendState(mediaOverride ? mediaOverride.path : undefined);
  }
}

function handleHelperEvent(helperEvent) {
  if (helperEvent.type === "phase") {
    job = {
      ...job,
      phase: helperEvent.phase || "",
      message: helperEvent.message || phaseLabel(helperEvent.phase),
      progress: Number.isFinite(helperEvent.progress) ? helperEvent.progress : null,
    };
    send("job", job);
    return;
  }

  if (helperEvent.type === "completed" && typeof helperEvent.path === "string") {
    activeJob.terminal = true;
    subtitleSettings.rememberGeneration(activeJob.mediaPath, activeJob.languages, helperEvent.path);
    if (subtitleLibrary.mediaPath === activeJob.mediaPath) {
      subtitleLibrary.files = [
        { path: helperEvent.path, ...activeJob.languages },
        ...subtitleLibrary.files.filter((subtitle) => subtitle.path !== helperEvent.path),
      ];
    }
    const currentStatusMediaPath = mediaPathForURL(latestFileLoadedURL || core.status.url);
    const fileLoadedMediaIsCurrent = activeJob.fileLoadedSequence === fileLoadedSequence;
    const statusMediaIsCurrent = !currentStatusMediaPath || currentStatusMediaPath === activeJob.mediaPath;
    if (!fileLoadedMediaIsCurrent || !statusMediaIsCurrent) {
      job = {
        status: "completed",
        phase: "",
        message: "字幕已保存；当前视频已更换，因此未自动加载。",
        progress: null,
        path: helperEvent.path,
        loaded: false,
      };
      send("job", job);
      return;
    }
    lastOutputPath = helperEvent.path;
    job = { status: "loading", phase: "loading", message: "字幕已生成，正在加载", progress: null, path: helperEvent.path, loaded: false };
    send("job", job);
    loadSubtitle(helperEvent.path, activeJob.mediaPath);
    return;
  }

  if (helperEvent.type === "cancelled") {
    activeJob.terminal = true;
    job = { status: "cancelled", phase: "", message: "已取消", progress: null, path: null, loaded: false };
    send("job", job);
    return;
  }

  if (helperEvent.type === "error") {
    activeJob.terminal = true;
    setJobError(helperEvent.message || "字幕生成失败。");
  }
}

function setJobError(message) {
  activeJob.terminal = true;
  job = { status: "error", phase: "", message, progress: null, path: lastOutputPath, loaded: false };
  send("job", job);
}

async function cancelJob() {
  if (!activeJob.id || !activeJob.cancelPath) return;
  job = { ...job, status: "canceling", message: "正在取消" };
  send("job", job);
  try {
    await utils.exec("/usr/bin/touch", [activeJob.cancelPath]);
  } catch (error) {
    setJobError(`无法发送取消请求：${error.message || error}`);
  }
}

async function loadSubtitle(filePath, mediaURLOverride = null, rememberSelection = false) {
  if (!filePath) return;
  const mediaPath = mediaPathForURL(mediaURLOverride || latestFileLoadedURL || core.status.url);
  const loadFileLoadedSequence = fileLoadedSequence;
  const isCurrentMedia = () => loadFileLoadedSequence === fileLoadedSequence
    && mediaPathForURL(latestFileLoadedURL || core.status.url) === mediaPath;
  job = { ...job, status: "loading", phase: "loading", message: "正在加载字幕", path: filePath, loaded: false };
  send("job", job);
  try {
    await core.subtitle.loadTrack(filePath);
    await waitForSubtitleTrack(mpv, filePath, Date.now, setTimeout);
    if (!isCurrentMedia()) return;
    if (rememberSelection) subtitleSettings.rememberSelection(mediaPath, filePath);
    lastOutputPath = filePath;
    job = { status: "completed", phase: "", message: "双语字幕已加载", progress: null, path: filePath, loaded: true };
  } catch (error) {
    if (!isCurrentMedia()) return;
    lastOutputPath = filePath;
    job = { status: "load-error", phase: "", message: `字幕已生成，但 IINA 加载失败：${error.message || error}`, progress: null, path: filePath, loaded: false };
  }
  send("job", job);
  sendState(mediaURLOverride);
}

async function revealOutput(filePath) {
  if (!filePath) return;
  try {
    const result = await utils.exec("/usr/bin/open", ["-R", filePath]);
    if (result && result.status !== 0) throw new Error(result.stderr || `Finder 退出状态码 ${result.status}。`);
  } catch (error) {
    setJobError(`无法在 Finder 中显示字幕：${error.message || error}`);
  }
}

async function chooseSetting(key, chooseDir) {
  try {
    const chosen = await utils.chooseFile(chooseDir ? "选择字幕输出文件夹" : "选择 FFmpeg 可执行文件", {
      chooseDir,
    });
    const selected = Array.isArray(chosen) ? chosen[0] : chosen;
    if (typeof selected === "string" && selected) setSetting(key, selected);
  } catch (error) {
    job = { ...job, message: `未能选择路径：${error.message || error}` };
    send("job", job);
  }
}

function setSetting(key, value) {
  if (!["ffmpeg_path", "output_directory", "auto_load"].includes(key)) return;
  preferences.set(key, key === "auto_load" ? Boolean(value) : typeof value === "string" ? value.trim() : "");
  preferences.sync();
  if (key === "output_directory" || key === "auto_load") {
    subtitleLookupId += 1;
    subtitleLibrary = { ...subtitleLibrary, outputDirectoryPath: null, loading: false };
  }
  sendState();
}

function autoLoadEnabled() { return [true, 1, "true"].includes(preferences.get("auto_load")); }
