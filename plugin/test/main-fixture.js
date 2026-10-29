const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const controller = require("../controller");

const mainSource = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const pluginDirectory = "/tmp/iina/Otoha.iinaplugin";
const helperPath = path.join(pluginDirectory, "bin", "OtohaHelper.app", "Contents", "MacOS", "otoha-helper");

function createPlugin({
  failSubtitleLoad = false,
  changeMediaBeforeCompletion = false,
  loadFileFailures = 0,
  windowReadyAtStart = true,
  ffmpegPath = "",
  ffmpegSearchPath = "/opt/homebrew/bin/ffmpeg",
  configuredFFmpegValid = true,
  subtitleTrackVisible = true,
  audioLanguage = "ja-JP",
  exposesCoreOpen = false,
  outputDirectory = "",
  autoLoad = false,
  defaultSourceLanguage = "en",
  defaultTargetLanguage = "",
  savedPreferences = {},
  helperTerminal = "completed",
  fileLoadedBeforeCompletion = "",
  subtitleScale = 100,
  existingSubtitles = [],
  failedListingPath = "",
} = {}) {
  const sidebarHandlers = new Map();
  const eventHandlers = new Map();
  const messages = [];
  const execCalls = [];
  const fileWrites = [];
  const loadedTracks = [];
  const menuItems = [];
  const consoleErrors = [];
  const coreOpenCalls = [];
  const mpvCommands = [];
  const pendingTimers = [];
  let clock = 1000;
  let windowReady = windowReadyAtStart;
  let remainingLoadFileFailures = loadFileFailures;
  const preferenceValues = {
    ffmpeg_path: ffmpegPath, output_directory: outputDirectory, auto_load: autoLoad,
    default_source_language: defaultSourceLanguage, default_target_language: defaultTargetLanguage,
    subtitle_scale: subtitleScale, ...savedPreferences,
  };
  const tracks = [
    { type: "audio", id: 7, "ff-index": 2, lang: audioLanguage, title: "Japanese", selected: true },
    { type: "audio", id: 8, "ff-index": 4, lang: "en-US", title: "English" },
  ];
  const iina = {
    core: {
      window: { loaded: windowReady },
      status: { url: "file:///Users/test/Anime%20episode.mkv", title: "Anime episode" },
      subtitle: {
        async loadTrack(filePath) {
          loadedTracks.push(filePath);
          if (failSubtitleLoad) throw new Error("fixture load failure");
          if (tracks.some((track) => track.type === "sub" && track["external-filename"] === filePath)) return;
          if (subtitleTrackVisible) {
            tracks.push({ type: "sub", id: 20 + loadedTracks.length, "external-filename": filePath });
          }
        },
      },
      ...(exposesCoreOpen ? { open(url) { coreOpenCalls.push(url); } } : {}),
    },
    event: { on: (name, callback) => eventHandlers.set(name, callback) },
    file: { write: (filePath, content) => fileWrites.push({ filePath, content }) },
    console: { error: (message) => consoleErrors.push(message) },
    menu: {
      item: (name, action) => ({ name, action }),
      addItem(item) { menuItems.push(item); },
    },
    mpv: {
      command(name, args) {
        mpvCommands.push({ name, args });
        if (name === "sub-remove") {
          const trackId = Number(args[0]);
          const index = tracks.findIndex((track) => track.type === "sub" && track.id === trackId);
          if (index >= 0) tracks.splice(index, 1);
        }
      },
      getNative(name) {
        if (name === "track-list") return tracks;
        if (name === "aid") return 7;
        return null;
      },
    },
    preferences: {
      get: (key) => preferenceValues[key],
      set: (key, value) => { preferenceValues[key] = value; },
      sync() {},
    },
    sidebar: {
      show() { messages.push({ kind: "show-sidebar" }); },
      loadFile(filePath) {
        sidebarHandlers.clear();
        if (!windowReady) throw new Error("window not available");
        if (remainingLoadFileFailures > 0) {
          remainingLoadFileFailures -= 1;
          throw new Error("temporary load failure");
        }
        messages.push({ kind: "load-file", filePath });
      },
      onMessage: (name, callback) => sidebarHandlers.set(name, callback),
      postMessage: (name, payload) => messages.push({ kind: "message", name, payload }),
    },
    utils: {
      resolvePath(value) {
        if (value.startsWith("@tmp/")) return `/tmp/iina/tmp/${value.slice(5)}`;
        if (!path.isAbsolute(value)) return null;
        return value;
      },
      preferredLocalizations: () => ["zh-Hans-CN", "en-US"],
      async exec(file, args, cwd, stdoutHook, stderrHook) {
        execCalls.push({ file, args, cwd });
        if (file === "/bin/zsh") {
          if (args[1] === 'test -f "$1" && test -x "$1"') {
            return configuredFFmpegValid
              ? { status: 0, stdout: "", stderr: "" }
              : { status: 1, stdout: "", stderr: "" };
          }
          return ffmpegSearchPath
            ? { status: 0, stdout: `${ffmpegSearchPath}\n`, stderr: "" }
            : { status: 127, stdout: "", stderr: "ffmpeg not found" };
        }
        if (file === "/usr/bin/test") {
          return configuredFFmpegValid ? { status: 0, stdout: "", stderr: "" } : { status: 1, stdout: "", stderr: "" };
        }
        if (file === "/usr/bin/open") {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (file.endsWith("otoha-helper")) {
          if (args[0] === "--list-subtitles-json") {
            const request = JSON.parse(args[1]);
            if (failedListingPath && request.outputDirectoryPath === failedListingPath) {
              return { status: 1, stdout: "", stderr: "permission denied" };
            }
            return {
              status: 0,
              stdout: JSON.stringify({
                rootDirectoryPath: outputDirectory || "/Users/test/Library/Application Support/Otoha/Subtitles",
                files: existingSubtitles.map((subtitlePath) => ({ path: subtitlePath })),
              }),
              stderr: "",
            };
          }
          const request = JSON.parse(args[1]);
          const mediaPath = typeof request.mediaPath === "string" ? request.mediaPath : "/Users/test/Anime episode.mkv";
          const outputPath = mediaPath.replace(/\.[^/.]+$/, ".otoha.ass");
          stdoutHook('{"type":"phase","phase":"transcribing","message":"正在转录"}\n');
          if (changeMediaBeforeCompletion) {
            iina.core.status.url = "file:///Users/test/Another%20video.mkv";
          }
          if (fileLoadedBeforeCompletion) eventHandlers.get("iina.file-loaded")(fileLoadedBeforeCompletion);
          if (helperTerminal === "completed" && !existingSubtitles.includes(outputPath)) existingSubtitles.push(outputPath);
          stdoutHook(`${JSON.stringify({ type: helperTerminal, path: outputPath, message: "fixture generation failure" })}\n`);
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      async chooseFile() { return null; },
      open(filePath) { messages.push({ kind: "open", filePath }); },
    },
  };

  vm.runInNewContext(mainSource, {
    console: undefined,
    Date: { now: () => clock },
    Math,
    Promise,
    setTimeout(callback, delay = 0) { pendingTimers.push({ callback, delay }); },
    iina,
    require(id) {
      if (id === "./controller.js") return controller;
      if (id === "./subtitle-settings.js") return require("../subtitle-settings.js");
      throw new Error(`Unexpected plugin module: ${id}`);
    },
  });

  return {
    eventHandlers,
    execCalls,
    fileWrites,
    loadedTracks,
    menuItems,
    messages,
    pendingTimers,
    sidebarHandlers,
    consoleErrors,
    coreOpenCalls,
    mpvCommands,
    preferenceValues,
    setWindowReady(value) {
      windowReady = value;
      iina.core.window.loaded = value;
    },
    setMediaURL(value) { iina.core.status.url = value; },
    setAudioLanguage(value) { tracks[0].lang = value; },
    runSidebarLoad() {
      this.runPendingTimers();
      this.runPendingTimers();
    },
    runPendingTimers() {
      pendingTimers.splice(0).forEach(({ callback, delay }) => {
        clock += delay;
        callback();
      });
    },
    runAllPendingTimers() {
      let runs = 0;
      while (pendingTimers.length && runs < 100) {
        this.runPendingTimers();
        runs += 1;
      }
      assert.ok(runs < 100, "timer queue should settle");
    },
  };
}

module.exports = { createPlugin, helperPath, mainSource };
