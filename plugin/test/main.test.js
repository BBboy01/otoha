const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createPlugin, helperPath, mainSource } = require("./main-fixture");

test("main loads its controller with an explicit JavaScript extension", () => {
  assert.match(mainSource, /require\("\.\/controller\.js"\)/);
});
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

  const helperCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--request-json");
  assert.ok(helperCall);
  assert.equal(helperCall.file, helperPath);
  const request = JSON.parse(helperCall.args[1]);
  assert.equal(helperCall.args[0], "--request-json");
  assert.equal(request.audioStreamIndex, 4);
  assert.equal(request.mediaPath, "/Users/test/Anime episode.mkv");
  assert.equal(request.ffmpegPath, "/opt/homebrew/bin/ffmpeg");
  assert.equal(request.backend, "apple");
  assert.equal(request.outputDirectoryPath, "");
  assert.deepEqual(plugin.loadedTracks, ["/Users/test/Anime episode.otoha.srt"]);
  assert.equal(plugin.messages.findLast((message) => message.name === "job").payload.status, "completed");
});

test("main does not load existing subtitles when automatic loading is disabled", async () => {
  const subtitlePath = "/Users/test/Library/Application Support/Otoha/Subtitles/video/episode.srt";
  const plugin = createPlugin({ existingSubtitles: [subtitlePath] });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(plugin.loadedTracks, []);
});

test("main automatically loads the sole subtitle when automatic loading is enabled", async () => {
  const subtitlePath = "/Users/test/Library/Application Support/Otoha/Subtitles/video/episode.srt";
  const plugin = createPlugin({ autoLoad: true, existingSubtitles: [subtitlePath] });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));

  const listingCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--list-subtitles-json");
  assert.ok(listingCall);
  assert.equal(JSON.parse(listingCall.args[1]).mediaPath, "/Users/test/Anime episode.mkv");
  assert.deepEqual(plugin.loadedTracks, [subtitlePath]);
  const state = plugin.messages.findLast((message) => message.name === "state");
  assert.equal(state.payload.availableSubtitles[0].path, subtitlePath);
});

test("main automatically loads the newest saved subtitle while keeping other versions selectable", async () => {
  const choices = ["/library/episode.srt", "/library/episode (2).srt"];
  const plugin = createPlugin({ autoLoad: true, existingSubtitles: choices });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));

  const state = plugin.messages.findLast((message) => message.name === "state");
  assert.deepEqual(Array.from(state.payload.availableSubtitles, (item) => item.path), choices);
  assert.deepEqual(plugin.loadedTracks, [choices[0]]);

  await plugin.sidebarHandlers.get("loadExisting")(choices[1]);
  assert.deepEqual(plugin.loadedTracks, [choices[0], choices[1]]);
});

test("main automatically starts transcription when no subtitle exists", async () => {
  const plugin = createPlugin({ autoLoad: true });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));

  const helperCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--request-json");
  assert.ok(helperCall);
  const request = JSON.parse(helperCall.args[1]);
  assert.equal(request.audioStreamIndex, 2);
  assert.equal(request.sourceLanguage, "ja");
  assert.equal(request.targetLanguage, "zh-Hans");
  assert.deepEqual(plugin.loadedTracks, ["/Users/test/Anime episode.otoha.srt"]);
});

test("main uses the configured subtitle library as its root directory", async () => {
  const outputDirectory = "/Users/test/Captions";
  const plugin = createPlugin({ outputDirectory });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });

  const listingCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--list-subtitles-json");
  const requestCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--request-json");
  assert.equal(JSON.parse(listingCall.args[1]).outputDirectoryPath, outputDirectory);
  assert.equal(JSON.parse(requestCall.args[1]).outputDirectoryPath, outputDirectory);
});

test("main clears the previous subtitle when playback has no local media", async () => {
  const plugin = createPlugin({ existingSubtitles: ["/library/episode.srt"] });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));
  plugin.setMediaURL(null);
  plugin.sidebarHandlers.get("refresh")();
  const state = plugin.messages.findLast((message) => message.name === "state");
  assert.equal(state.payload.hasOutput, false);
  assert.deepEqual(Array.from(state.payload.availableSubtitles), []);
});

test("main keeps the loaded subtitle path when the library setting changes", async () => {
  const plugin = createPlugin();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ja", targetLanguage: "zh-Hans" });
  await new Promise((resolve) => setImmediate(resolve));

  plugin.sidebarHandlers.get("setSetting")({ key: "output_directory", value: "/Users/test/Captions" });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.sidebarHandlers.get("retryLoad")();

  assert.deepEqual(plugin.loadedTracks, [
    "/Users/test/Anime episode.otoha.srt",
    "/Users/test/Anime episode.otoha.srt",
  ]);
});

test("main reloads an existing subtitle without removing its track", async () => {
  const plugin = createPlugin();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ja", targetLanguage: "zh-Hans" });
  await plugin.sidebarHandlers.get("retryLoad")();

  assert.equal(plugin.mpvCommands.length, 0);
  assert.deepEqual(plugin.loadedTracks, [
    "/Users/test/Anime episode.otoha.srt",
    "/Users/test/Anime episode.otoha.srt",
  ]);
  assert.equal(plugin.messages.findLast((message) => message.name === "job").payload.status, "completed");
});

test("main reveals a subtitle by selecting it in Finder", async () => {
  const plugin = createPlugin();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("reveal")("/Users/test/Library/Application Support/Otoha/Subtitles/video.srt");

  const revealCall = plugin.execCalls.find((call) => call.file === "/usr/bin/open");
  assert.ok(revealCall);
  assert.deepEqual(Array.from(revealCall.args), ["-R", "/Users/test/Library/Application Support/Otoha/Subtitles/video.srt"]);
});

test("main preserves previously discovered subtitles when a new library cannot be read", async () => {
  const subtitlePath = "/old-library/episode.srt";
  const plugin = createPlugin({ existingSubtitles: [subtitlePath], failedListingPath: "/Users/test/Captions" });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));

  plugin.sidebarHandlers.get("setSetting")({ key: "output_directory", value: "/Users/test/Captions" });
  await new Promise((resolve) => setImmediate(resolve));

  const state = plugin.messages.findLast((message) => message.name === "state");
  assert.deepEqual(Array.from(state.payload.availableSubtitles, (item) => item.path), [subtitlePath]);
  assert.match(state.payload.job.message, /仍可使用已发现的字幕/);
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

  assert.equal(plugin.execCalls.some((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--request-json"), false);
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

  const helperCall = plugin.execCalls.find((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--request-json");
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

  assert.equal(plugin.execCalls.some((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--request-json"), false);
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
  assert.equal(plugin.execCalls.some((call) => call.file.endsWith("otoha-helper") && call.args[0] === "--request-json"), false);
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

test("main does not show the plugin sidebar during startup", () => {
  const plugin = createPlugin();
  plugin.runSidebarLoad();

  assert.equal(plugin.messages.filter((message) => message.kind === "load-file").length, 1);
  assert.equal(plugin.messages.filter((message) => message.kind === "show-sidebar").length, 0);
});

test("main shows the plugin sidebar only when its menu command is used", () => {
  const plugin = createPlugin();
  plugin.menuItems[0].action();

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
  assert.equal(plugin.messages.filter((message) => message.kind === "show-sidebar").length, 0);
});
