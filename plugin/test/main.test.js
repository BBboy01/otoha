const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const controller = require("../controller");

const mainSource = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const pluginDirectory = "/tmp/iina/Otoha.iinaplugin";
const helperPath = path.join(pluginDirectory, "bin", "OtohaHelper.app", "Contents", "MacOS", "otoha-helper");

test("main loads its controller with an explicit JavaScript extension", () => {
  assert.match(mainSource, /require\("\.\/controller\.js"\)/);
});
function createPlugin({
  failSubtitleLoad = false,
  changeMediaBeforeCompletion = false,
  loadFileFailures = 0,
  windowReadyAtStart = true,
  ffmpegPath = "",
  ffmpegSearchPath = "/opt/homebrew/bin/ffmpeg",
  configuredFFmpegValid = true,
  subtitleTrackVisible = true,
  exposesCoreOpen = false,
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
  const pendingTimers = [];
  let clock = 1000;
  let windowReady = windowReadyAtStart;
  let remainingLoadFileFailures = loadFileFailures;
  const preferenceValues = { ffmpeg_path: ffmpegPath, output_directory: "" };
  const tracks = [
    { type: "audio", id: 7, "ff-index": 2, lang: "ja-JP", title: "Japanese", selected: true },
    { type: "audio", id: 8, "ff-index": 4, lang: "en-US", title: "English" },
  ];

  const iina = {
    core: {
      window: {
        loaded: windowReady,
      },
      status: { url: "file:///Users/test/Anime%20episode.mkv", title: "Anime episode" },
      subtitle: {
        async loadTrack(filePath) {
          loadedTracks.push(filePath);
          if (failSubtitleLoad) throw new Error("fixture load failure");
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
      show() {
        messages.push({ kind: "show-sidebar" });
      },
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
        if (file.endsWith("otoha-helper")) {
          stdoutHook('{"type":"phase","phase":"transcribing","message":"正在转录"}\n');
          if (changeMediaBeforeCompletion) {
            iina.core.status.url = "file:///Users/test/Another%20video.mkv";
          }
          stdoutHook('{"type":"completed","path":"/Users/test/Anime episode.otoha.srt"}\n');
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
      if (id !== "./controller.js") throw new Error(`Unexpected plugin module: ${id}`);
      return controller;
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
    setWindowReady(value) {
      windowReady = value;
      iina.core.window.loaded = value;
    },
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

test("main has no startup integration probe side effects", () => {
  const plugin = createPlugin({ exposesCoreOpen: true });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });

  assert.deepEqual(plugin.coreOpenCalls, []);
  assert.deepEqual(plugin.fileWrites, []);
});

test("main maps the chosen IINA track to ff-index and loads completed subtitles", async () => {
  const plugin = createPlugin({ windowReadyAtStart: false });
  plugin.runPendingTimers();
  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 0);
  plugin.setWindowReady(true);
  plugin.eventHandlers.get("iina.window-loaded")();
  plugin.runSidebarLoad();
  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 1);
  plugin.sidebarHandlers.get("ready")({ helperPath });
  plugin.sidebarHandlers.get("refresh")();
  const stateMessage = plugin.messages.findLast((message) => message.name === "state");

  assert.equal(stateMessage.payload.sourceLanguage, "ja");
  assert.equal(stateMessage.payload.targetLanguage, "zh-Hans");

  await plugin.sidebarHandlers.get("start")({
    trackId: 8,
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
  });
  await new Promise((resolve) => setImmediate(resolve));

  const helperCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper"));
  assert.ok(helperCall);
  assert.equal(helperCall.file, helperPath);
  const request = JSON.parse(helperCall.args[1]);
  assert.equal(helperCall.args[0], "--request-json");
  assert.equal(request.audioStreamIndex, 4);
  assert.equal(request.mediaPath, "/Users/test/Anime episode.mkv");
  assert.equal(request.ffmpegPath, "/opt/homebrew/bin/ffmpeg");
  assert.equal(request.backend, "apple");
  assert.equal(request.outputDirectoryPath, "/Users/test");
  assert.deepEqual(plugin.loadedTracks, ["/Users/test/Anime episode.otoha.srt"]);
  assert.equal(plugin.messages.findLast((message) => message.name === "job").payload.status, "completed");
});

test("main stops with an actionable error when login-shell PATH has no FFmpeg", async () => {
  const plugin = createPlugin({ ffmpegSearchPath: "" });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });

  await plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });

  assert.equal(plugin.execCalls.some((call) => call.file.endsWith("otoha-helper")), false);
  assert.match(plugin.messages.findLast((message) => message.name === "job").payload.message, /FFmpeg/);
});

test("main uses a configured FFmpeg path without querying the login shell", async () => {
  const configuredPath = "/Users/test/bin/ffmpeg";
  const plugin = createPlugin({ ffmpegPath: configuredPath, ffmpegSearchPath: "" });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });

  await plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });

  const helperCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper"));
  assert.ok(helperCall);
  assert.equal(JSON.parse(helperCall.args[1]).ffmpegPath, configuredPath);
  const ffmpegCheck = plugin.execCalls.find((call) => call.file === "/bin/zsh");
  assert.ok(ffmpegCheck);
  assert.deepEqual(Array.from(ffmpegCheck.args), ["-lc", 'test -f "$1" && test -x "$1"', "--", configuredPath]);
});

test("main rejects a configured FFmpeg path that is not executable", async () => {
  const plugin = createPlugin({
    ffmpegPath: "/Users/test/bin/ffmpeg",
    configuredFFmpegValid: false,
  });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });

  await plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });

  assert.equal(plugin.execCalls.some((call) => call.file.endsWith("otoha-helper")), false);
  assert.match(plugin.messages.findLast((message) => message.name === "job").payload.message, /可执行|FFmpeg/);
});

test("main preserves an SRT and exposes retry state when IINA cannot load it", async () => {
  const plugin = createPlugin({ failSubtitleLoad: true });
  plugin.eventHandlers.get("iina.window-loaded")();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
  await new Promise((resolve) => setImmediate(resolve));

  const jobMessage = plugin.messages.findLast((message) => message.name === "job");
  assert.equal(jobMessage.payload.status, "load-error");
  assert.equal(jobMessage.payload.path, "/Users/test/Anime episode.otoha.srt");

  await plugin.sidebarHandlers.get("retryLoad")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(plugin.loadedTracks.length, 2);
  assert.equal(plugin.messages.findLast((message) => message.name === "job").payload.status, "load-error");
});

test("main reports subtitle loading only after mpv exposes the external track", async () => {
  const plugin = createPlugin({ subtitleTrackVisible: false });
  plugin.eventHandlers.get("iina.window-loaded")();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const start = plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
  await new Promise((resolve) => setImmediate(resolve));
  plugin.runAllPendingTimers();
  await start;

  const jobMessage = plugin.messages.findLast((message) => message.name === "job");
  assert.equal(jobMessage.payload.status, "load-error");
  assert.equal(jobMessage.payload.loaded, false);
});

test("main keeps output but does not load it after playback changes to another video", async () => {
  const plugin = createPlugin({ changeMediaBeforeCompletion: true });
  plugin.eventHandlers.get("iina.window-loaded")();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
  await new Promise((resolve) => setImmediate(resolve));

  const jobMessage = plugin.messages.findLast((message) => message.name === "job");
  assert.equal(jobMessage.payload.status, "completed");
  assert.match(jobMessage.payload.message, /当前视频已更换/);
  assert.equal(jobMessage.payload.path, "/Users/test/Anime episode.otoha.srt");
  assert.deepEqual(plugin.loadedTracks, []);
});

test("main does not launch helper when the chosen track has no ff-index", async () => {
  const plugin = createPlugin({ windowReadyAtStart: true });
  plugin.runPendingTimers();
  plugin.eventHandlers.get("iina.window-loaded")();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("start")({
    trackId: 999,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
  assert.equal(plugin.execCalls.some((call) => call.file.endsWith("otoha-helper")), false);
});

test("main rejects a relative helper path reported by the sidebar", async () => {
  const plugin = createPlugin({ windowReadyAtStart: true });
  plugin.runPendingTimers();
  plugin.eventHandlers.get("iina.window-loaded")();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath: "bin/OtohaHelper.app/Contents/MacOS/otoha-helper" });

  await plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });

  assert.equal(plugin.execCalls.some((call) => call.file.endsWith("otoha-helper")), false);
  assert.equal(plugin.messages.findLast((message) => message.name === "job").payload.status, "error");
});

test("main loads the sidebar after enabling in an already-open player", () => {
  const plugin = createPlugin({ windowReadyAtStart: true });
  plugin.runSidebarLoad();

  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 1);
  assert.equal(typeof plugin.sidebarHandlers.get("ready"), "function");
});

test("main exposes a menu command for opening the sidebar", () => {
  const plugin = createPlugin();
  assert.equal(plugin.menuItems.length, 1);
  plugin.menuItems[0].action();
  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 1);
});

test("main shows the plugin sidebar before loading its page", () => {
  const plugin = createPlugin();
  plugin.runSidebarLoad();

  assert.deepEqual(
    plugin.messages.filter((message) => ["show-sidebar", "load-file"].includes(message.kind)).map((message) => message.kind),
    ["load-file", "show-sidebar"],
  );
});

test("main retries sidebar loading when plugin startup precedes the player window", () => {
  const plugin = createPlugin({ windowReadyAtStart: false });
  plugin.runPendingTimers();
  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 0);

  plugin.setWindowReady(true);
  plugin.eventHandlers.get("iina.window-loaded")();
  plugin.runSidebarLoad();

  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 1);
  assert.equal(typeof plugin.sidebarHandlers.get("ready"), "function");
});

test("main retries a transient sidebar load failure", () => {
  const plugin = createPlugin({ loadFileFailures: 1 });
  plugin.runPendingTimers();

  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 0);
  plugin.runPendingTimers();
  plugin.runPendingTimers();
  plugin.runPendingTimers();
  plugin.runPendingTimers();

  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 1);
  assert.equal(typeof plugin.sidebarHandlers.get("ready"), "function");
  assert.equal(plugin.consoleErrors.length, 1);
});

test("main keeps retrying until the sidebar page reports ready", () => {
  const plugin = createPlugin();
  plugin.runSidebarLoad();
  plugin.runPendingTimers();
  plugin.runPendingTimers();
  plugin.runPendingTimers();
  plugin.runPendingTimers();

  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 2);
  assert.equal(plugin.messages.filter((message) => message.kind === "show-sidebar").length, 2);
});
