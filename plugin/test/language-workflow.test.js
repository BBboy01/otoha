const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

const mediaPath = "/Users/test/Anime episode.mkv";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const latestState = (plugin) => plugin.messages.findLast((message) => message.name === "state").payload;

async function openPlugin(options) {
  const plugin = createPlugin(options);
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await tick();
  return plugin;
}

test("automatic loading leaves videos without subtitles idle even when their audio language is known", async () => {
  const plugin = await openPlugin({ autoLoad: true, audioLanguage: "ja" });
  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--request-json"), false);
  assert.deepEqual(plugin.loadedTracks, []);
  assert.equal(latestState(plugin).job.status, "idle");
  assert.equal(plugin.messages.some((message) => message.kind === "show-sidebar"), false);
});

test("automatic loading leaves unknown-language videos idle", async () => {
  const plugin = await openPlugin({ autoLoad: true, audioLanguage: "und" });
  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--request-json"), false);
  assert.equal(latestState(plugin).job.status, "idle");
});

test("new videos use global source and target preferences rather than track metadata", async () => {
  const plugin = await openPlugin({ defaultSourceLanguage: "en", defaultTargetLanguage: "ja", audioLanguage: "ko" });
  assert.equal(latestState(plugin).sourceLanguage, "en");
  assert.equal(latestState(plugin).targetLanguage, "ja");
});

test("successful generation restores this video's languages after a plugin restart", async () => {
  const plugin = await openPlugin();
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ko", targetLanguage: "en" });
  await tick();
  plugin.preferenceValues.default_source_language = "fr";
  plugin.preferenceValues.default_target_language = "de";
  const reopened = await openPlugin({ savedPreferences: plugin.preferenceValues });
  assert.equal(latestState(reopened).sourceLanguage, "ko");
  assert.equal(latestState(reopened).targetLanguage, "en");
  reopened.setMediaURL("file:///Users/test/Other.mkv");
  reopened.sidebarHandlers.get("refresh")();
  await tick();
  assert.equal(latestState(reopened).sourceLanguage, "fr");
  assert.equal(latestState(reopened).targetLanguage, "de");
});

test("a completed subtitle remembers its language settings even if IINA fails to load it", async () => {
  const plugin = await openPlugin({ failSubtitleLoad: true });
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ja", targetLanguage: "en" });
  await tick();
  assert.equal(latestState(plugin).job.status, "load-error");
  const reopened = await openPlugin({ savedPreferences: plugin.preferenceValues });
  assert.equal(latestState(reopened).sourceLanguage, "ja");
  assert.equal(latestState(reopened).targetLanguage, "en");
});

for (const terminal of ["error", "cancelled"]) {
  test(`${terminal} generation preserves this video's previously successful language settings`, async () => {
    const plugin = await openPlugin();
    await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ko", targetLanguage: "de" });
    await tick();
    const failed = await openPlugin({ helperTerminal: terminal, savedPreferences: plugin.preferenceValues });
    await failed.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ko", targetLanguage: "en" });
    await tick();
    const reopened = await openPlugin({ savedPreferences: failed.preferenceValues });
    assert.equal(latestState(reopened).sourceLanguage, "ko");
    assert.equal(latestState(reopened).targetLanguage, "de");
  });
}

test("automatic loading restores the last selected subtitle across a restart", async () => {
  const files = ["/library/Anime episode [ja to zh-Hans].ass", "/library/Anime episode [ja to en].ass"];
  const plugin = await openPlugin({ autoLoad: true, existingSubtitles: files });
  plugin.sidebarHandlers.get("loadExisting")(files[1]);
  await tick();
  const reopened = await openPlugin({ savedPreferences: plugin.preferenceValues, existingSubtitles: files });
  assert.deepEqual(reopened.loadedTracks, [files[1]]);
  assert.equal(latestState(reopened).selectedSubtitlePath, files[1]);
  for (let index = 0; index < 3; index += 1) reopened.sidebarHandlers.get("refresh")();
  await tick();
  assert.deepEqual(reopened.loadedTracks, [files[1]]);
});

test("missing remembered subtitles fall back to the latest existing file without generation", async () => {
  const plugin = await openPlugin({ autoLoad: true, existingSubtitles: ["/library/old.ass"] });
  const reopened = await openPlugin({ savedPreferences: plugin.preferenceValues, existingSubtitles: ["/library/new.ass"] });
  assert.deepEqual(reopened.loadedTracks, ["/library/new.ass"]);
  assert.equal(reopened.execCalls.some((call) => call.args[0] === "--request-json"), false);
});

test("existing generated subtitle names restore languages before any per-video record exists", async () => {
  const plugin = await openPlugin({ existingSubtitles: ["/library/Anime episode [ja to en].ass"] });
  assert.equal(latestState(plugin).sourceLanguage, "ja");
  assert.equal(latestState(plugin).targetLanguage, "en");
  assert.equal(latestState(plugin).availableSubtitles[0].sourceLanguage, "ja");
  assert.equal(latestState(plugin).availableSubtitles[0].targetLanguage, "en");
});

test("a temporarily missing subtitle does not erase the user's explicit selection", async () => {
  const files = ["/library/Anime episode [ja to zh-Hans].ass", "/library/Anime episode [ja to en].ass"];
  const plugin = await openPlugin({ autoLoad: true, existingSubtitles: files });
  plugin.sidebarHandlers.get("loadExisting")(files[1]);
  await tick();
  const missing = await openPlugin({ savedPreferences: plugin.preferenceValues, existingSubtitles: [files[0]] });
  assert.deepEqual(missing.loadedTracks, [files[0]]);
  const restored = await openPlugin({ savedPreferences: missing.preferenceValues, existingSubtitles: files });
  assert.deepEqual(restored.loadedTracks, [files[1]]);
});

test("manual generation uses the newly opened video while core status still points to the previous one", async () => {
  const plugin = await openPlugin();
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/New%20episode.mkv");
  await tick();
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ko", targetLanguage: "en" });
  await tick();
  const request = plugin.execCalls.find((call) => call.args[0] === "--request-json");
  assert.equal(JSON.parse(request.args[1]).mediaPath, "/Users/test/New episode.mkv");
  assert.equal(latestState(plugin).media.path, "/Users/test/New episode.mkv");
});

test("manual generation finishing after a file-loaded event never loads into the next video", async () => {
  const plugin = await openPlugin({ fileLoadedBeforeCompletion: "file:///Users/test/Next%20episode.mkv" });
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ko", targetLanguage: "en" });
  await tick();
  assert.deepEqual(plugin.loadedTracks, []);
  assert.equal(latestState(plugin).media.path, "/Users/test/Next episode.mkv");
  const saved = JSON.parse(plugin.preferenceValues.video_settings);
  assert.equal(saved[mediaPath].sourceLanguage, "ko");
  assert.equal(saved["/Users/test/Next episode.mkv"], undefined);
});

test("manual generation started during a file switch does not transcribe the previous video", async () => {
  const plugin = await openPlugin();
  const starting = plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "ko", targetLanguage: "en" });
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/Next%20episode.mkv");
  await starting;
  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--request-json"), false);
});
