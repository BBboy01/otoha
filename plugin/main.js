const {
  LANGUAGES,
  audioTracks,
  createJsonLineParser,
  defaultLanguage,
  localMedia,
  phaseLabel,
  resolveAudioStreamIndex,
} = require("./controller.js");

const { core, event, menu, mpv, preferences, sidebar, utils } = iina;
const activeJob = { id: null, cancelPath: null, mediaPath: null, parser: null, terminal: false };
let uiLoaded = false;
let sidebarRetryPending = false;
let sidebarRetryIndex = 0;
let sidebarPageLoadPending = false;
let sidebarLoadRequested = false;
let helperPath = null;
let lastOutputPath = null;
let job = { status: "idle", phase: "", message: "", progress: null, path: null, loaded: false };
const sidebarRetryDelays = [0, 100, 250, 500, 1000, 2000, 4000, 8000];
const sidebarReadyTimeout = 2000;
const sidebarPageLoadDelay = 500;
function playerWindowIsLoaded() {
  return !core.window || core.window.loaded === true;
}

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

function loadSidebarPage() {
  if (uiLoaded || sidebarLoadRequested) return;
  sidebarLoadRequested = true;
  try {
    sidebar.loadFile("sidebar.html");
    sidebar.onMessage("ready", (payload) => {
      uiLoaded = true;
      sidebarLoadRequested = false;
      const candidate = payload && payload.helperPath;
      if (typeof candidate !== "string" || !candidate.startsWith("/")) {
        setJobError("无法定位 Otoha helper，请重新打开插件侧栏。");
        sendState();
        return;
      }
      helperPath = utils.resolvePath(candidate);
      if (!helperPath) {
        setJobError("无法定位 Otoha helper，请重新安装插件。");
        sendState();
        return;
      }
      sendState();
    });
    sidebar.onMessage("refresh", () => sendState());
    sidebar.onMessage("start", (payload) => startJob(payload));
    sidebar.onMessage("cancel", () => cancelJob());
    sidebar.onMessage("retryLoad", () => loadSubtitle(lastOutputPath));
    sidebar.onMessage("reveal", () => revealOutput(lastOutputPath));
    sidebar.onMessage("chooseOutputDirectory", () => chooseSetting("output_directory", true));
    sidebar.onMessage("chooseFFmpeg", () => chooseSetting("ffmpeg_path", false));
    sidebar.onMessage("setSetting", ({ key, value }) => setSetting(key, value));
    sidebar.show();
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
  loadSidebarPage();
}

event.on("iina.window-loaded", () => {
  if (!uiLoaded) {
    sidebarRetryIndex = 0;
    initializeSidebar();
  }
  else sendState();
});
if (menu && typeof menu.addItem === "function" && typeof menu.item === "function") {
  menu.addItem(menu.item("显示 Otoha 侧栏", () => showSidebar()));
}
scheduleSidebarLoad();

function send(name, payload) {
  if (uiLoaded) sidebar.postMessage(name, payload);
}

function sendState() {
  const url = core.status.url;
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
  const targetDefault = defaultLanguage(utils.preferredLocalizations());
  send("state", {
    title: core.status.title || (media && media.name) || "",
    media,
    mediaError,
    tracks,
    selectedTrackId: selectedTrack ? selectedTrack.id : null,
    sourceLanguage: selectedTrack ? defaultLanguage(selectedTrack.lang) : "",
    targetLanguage: targetDefault,
    outputDirectory,
    effectiveOutputDirectory: outputDirectory || (media ? directoryName(media.path) : ""),
    ffmpegPath: preferences.get("ffmpeg_path") || "",
    job,
    hasOutput: Boolean(lastOutputPath),
  });
}

async function startJob(payload = {}) {
  if (activeJob.id) return;
  try {
    if (!helperPath) throw new Error("Otoha 侧栏尚未完成初始化，请重新打开侧栏。");
    const media = localMedia(core.status.url);
    const tracks = audioTracks(mpv.getNative("track-list") || []);
    const streamIndex = resolveAudioStreamIndex(tracks, payload.trackId);
    const sourceLanguage = String(payload.sourceLanguage || "");
    const targetLanguage = String(payload.targetLanguage || "");
    if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) {
      throw new Error("请选择不同的转录语言和翻译语言。");
    }
    const ffmpegPath = await resolveFFmpegPath();

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cancelPath = utils.resolvePath(`@tmp/otoha-${id}.cancel`);
    const outputDirectory = preferences.get("output_directory") || directoryName(media.path);
    const request = {
      backend: "apple",
      mediaPath: media.path,
      ffmpegPath,
      audioStreamIndex: streamIndex,
      sourceLanguage,
      targetLanguage,
      outputDirectoryPath: outputDirectory,
      cancellationFilePath: cancelPath,
    };

    activeJob.id = id;
    activeJob.cancelPath = cancelPath;
    activeJob.mediaPath = media.path;
    activeJob.terminal = false;
    job = { status: "running", phase: "checkingEnvironment", message: "正在启动", progress: null, path: null, loaded: false };
    sendState();

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
    activeJob.parser = null;
    sendState();
  }
}

async function resolveFFmpegPath() {
  const configuredPath = preferences.get("ffmpeg_path");
  if (typeof configuredPath === "string" && configuredPath.trim()) {
    const path = configuredPath.trim();
    await assertExecutableFile(path, "配置的 FFmpeg 路径不存在或不可执行，请选择可执行文件或清空设置后重试。");
    return path;
  }

  const result = await utils.exec("/bin/zsh", ["-lc", "command -v ffmpeg"]);
  const candidates = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  const discoveredPath = candidates[candidates.length - 1];
  if (result.status !== 0 || !discoveredPath || !discoveredPath.startsWith("/")) {
    throw new Error("未找到 FFmpeg。请安装后重试，或在路径设置中填写可执行文件的完整路径。");
  }
  await assertExecutableFile(discoveredPath, "找到的 FFmpeg 不可执行，请检查安装或在路径设置中填写可执行文件的完整路径。");
  return discoveredPath;
}

async function assertExecutableFile(filePath, message) {
  if (!filePath.startsWith("/")) throw new Error(message);
  try {
    const result = await utils.exec("/bin/zsh", ["-lc", 'test -f "$1" && test -x "$1"', "--", filePath]);
    if (result.status !== 0) throw new Error(message);
  } catch (error) {
    if (error && error.message === message) throw error;
    throw new Error(message);
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
    lastOutputPath = helperEvent.path;
    let currentMediaPath = "";
    try {
      currentMediaPath = localMedia(core.status.url).path;
    } catch {}
    if (currentMediaPath !== activeJob.mediaPath) {
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
    job = { status: "loading", phase: "loading", message: "字幕已生成，正在加载", progress: null, path: helperEvent.path, loaded: false };
    send("job", job);
    loadSubtitle(helperEvent.path);
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

async function loadSubtitle(filePath) {
  if (!filePath) return;
  job = { ...job, status: "loading", phase: "loading", message: "正在加载字幕", path: filePath, loaded: false };
  send("job", job);
  try {
    await core.subtitle.loadTrack(filePath);
    await waitForSubtitleTrack(filePath);
    lastOutputPath = filePath;
    job = { status: "completed", phase: "", message: "双语字幕已加载", progress: null, path: filePath, loaded: true };
  } catch (error) {
    lastOutputPath = filePath;
    job = { status: "load-error", phase: "", message: `字幕已生成，但 IINA 加载失败：${error.message || error}`, progress: null, path: filePath, loaded: false };
  }
  send("job", job);
  sendState();
}

function waitForSubtitleTrack(filePath) {
  const expectedPath = localMedia(filePath).path;
  const deadline = Date.now() + 3000;

  return new Promise((resolve, reject) => {
    const check = () => {
      const loaded = (mpv.getNative("track-list") || []).some((track) => {
        if (!track || track.type !== "sub") return false;
        const externalFilename = track["external-filename"] || track.externalFilename;
        if (typeof externalFilename !== "string") return false;
        try {
          return localMedia(externalFilename).path === expectedPath;
        } catch {
          return externalFilename === expectedPath;
        }
      });
      if (loaded) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error("IINA 尚未确认字幕轨道加载，请重试或在播放器中检查字幕轨道。"));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

function revealOutput(filePath) {
  if (!filePath) return;
  try {
    utils.open(filePath);
  } catch (error) {
    setJobError(`无法打开字幕文件：${error.message || error}`);
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
  if (key !== "ffmpeg_path" && key !== "output_directory") return;
  preferences.set(key, typeof value === "string" ? value.trim() : "");
  preferences.sync();
  sendState();
}

function directoryName(filePath) {
  const separator = filePath.lastIndexOf("/");
  return separator > 0 ? filePath.slice(0, separator) : "/";
}
