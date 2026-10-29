const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

const canonicalPath = "/Users/test/Anime episode [ja to zh-Hans].ass";
const canonicalContent = `[Script Info]\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour\nStyle: OtohaSource,Arial,28,&H80FFFFFF\nStyle: OtohaTranslation,Arial,36,&H00FFFFFF\n\n[Events]\nFormat: Layer, Start, End, Style, Name, Text\nDialogue: 0,0:00:01.00,0:00:02.00,OtohaTranslation,,Hello\\N你好\nDialogue: 0,0:00:01.00,0:00:02.00,OtohaSource,,こんにちは\n`;
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function openPlugin(options = {}) {
  const plugin = createPlugin({
    existingSubtitles: [canonicalPath],
    subtitleContents: { [canonicalPath]: canonicalContent },
    ...options,
  });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await tick();
  return plugin;
}

test("main sends each video's remembered display mode and defaults new videos to bilingual", async () => {
  const plugin = await openPlugin({
    savedPreferences: {
      video_settings: JSON.stringify({
        "/Users/test/Anime episode.mkv": { displayMode: "source" },
      }),
    },
  });
  assert.equal(plugin.messages.findLast((message) => message.name === "state").payload.displayMode, "source");

  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/Next%20episode.mkv");
  await tick();
  assert.equal(plugin.messages.findLast((message) => message.name === "state").payload.displayMode, "bilingual");
});

test("main projects the canonical ASS for a selected display mode and selects the new track", async () => {
  const plugin = await openPlugin();
  await plugin.sidebarHandlers.get("setDisplayMode")("source");
  await tick();

  const projection = plugin.fileWrites.find((write) => write.filePath.startsWith("@data/"));
  assert.ok(projection);
  assert.match(projection.content, /Style: OtohaSingle/);
  assert.match(projection.content, /Dialogue: 0,0:00:01\.00,0:00:02\.00,OtohaSingle,,こんにちは/);
  assert.doesNotMatch(projection.content, /Dialogue: 0,0:00:01\.00,0:00:02\.00,OtohaSingle,,Hello/);
  assert.equal(plugin.loadedTracks.at(-1), projection.resolvedPath);
  assert.equal(plugin.selectedSubtitleId, plugin.lastLoadedTrackId);
  assert.equal(plugin.preferenceValues.video_settings.includes('"displayMode":"source"'), true);
});

test("main ignores a display mode load that finishes after switching videos", async () => {
  const plugin = await openPlugin();
  const load = plugin.sidebarHandlers.get("setDisplayMode")("source");
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/Next%20episode.mkv");
  await load;
  await tick();

  const state = plugin.messages.findLast((message) => message.name === "state").payload;
  assert.equal(state.media.path, "/Users/test/Next episode.mkv");
  assert.equal(state.job.status, "idle");
});
