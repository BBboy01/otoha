const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const latestState = (plugin) => plugin.messages.findLast((message) => message.name === "state").payload;

test("an expired automatic subtitle load cannot restore the previous video after a timeout", async () => {
  const files = ["/library/A [en to zh-Hans].ass"];
  const plugin = createPlugin({ subtitleTrackVisible: false, existingSubtitles: files });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await tick();

  plugin.preferenceValues.auto_load = true;
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/A.mkv");
  await tick();
  assert.equal(latestState(plugin).job.status, "loading");

  plugin.preferenceValues.auto_load = false;
  files.length = 0;
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/B.mkv");
  await tick();
  assert.equal(latestState(plugin).media.path, "/Users/test/B.mkv");
  const lookupCount = plugin.execCalls.filter((call) => call.args[0] === "--list-subtitles-json").length;

  plugin.runAllPendingTimers();
  await tick();

  assert.equal(latestState(plugin).media.path, "/Users/test/B.mkv");
  assert.equal(latestState(plugin).job.status, "idle");
  assert.equal(latestState(plugin).hasOutput, false);
  assert.equal(plugin.execCalls.filter((call) => call.args[0] === "--list-subtitles-json").length, lookupCount);
  const loadCount = plugin.loadedTracks.length;
  plugin.sidebarHandlers.get("retryLoad")();
  assert.equal(plugin.loadedTracks.length, loadCount);
});

test("an expired successful subtitle load cannot replace the current video's feedback", async () => {
  const subtitlePath = "/library/A [en to zh-Hans].ass";
  const files = [subtitlePath];
  const plugin = createPlugin({ existingSubtitles: files });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await tick();

  plugin.sidebarHandlers.get("loadExisting")(subtitlePath);
  files.length = 0;
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/B.mkv");
  const switchMessageCount = plugin.messages.length;
  await tick();

  assert.equal(latestState(plugin).media.path, "/Users/test/B.mkv");
  assert.equal(latestState(plugin).job.status, "idle");
  assert.equal(plugin.messages.slice(switchMessageCount).some((message) => (
    message.name === "job" && message.payload.path === subtitlePath
  )), false);
});
