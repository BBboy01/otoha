const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleTrackManager } = require("../subtitle-track-manager");

test("subtitle track manager renders display modes and removes only its previous track", () => {
  const tracks = [
    { type: "sub", id: 10, "external-filename": "/tmp/old.ass" },
    { type: "sub", id: 11, "external-filename": "/tmp/new.ass" },
  ];
  const writes = [];
  const commands = [];
  const manager = createSubtitleTrackManager({
    mpv: { getNative: () => tracks, command: (...args) => commands.push(args) },
    file: {
      read: () => "[Script Info]\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,OtohaSource,,0,0,0,,Source",
      write: (path, content) => writes.push({ path, content }),
    },
    resolvePath: (path) => `/resolved/${path.slice(6)}`,
    mediaPathForURL: (path) => path,
    renderSubtitleMode: (content, mode) => `${content}:${mode}`,
  });

  assert.match(manager.prepare("/tmp/input.ass", "/tmp/video.mkv", "source"), /^\/resolved\/otoha-display-[0-9a-f]+-source\.ass$/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].content.endsWith(":source"), true);
  manager.rememberLoaded("/tmp/old.ass");
  manager.removePrevious("/tmp/new.ass");
  assert.deepEqual(commands, [["sub-remove", ["10"]]]);
});

test("unload removes only the exact cached display track", () => {
  const tracks = [{ type: "sub", id: 20, "external-filename": "/other/video.ass" }, { type: "sub", id: 21, "external-filename": "/resolved/cache.ass" }];
  const commands = [];
  const manager = createSubtitleTrackManager({ mpv: { getNative: () => tracks, command: (...args) => commands.push(args) },
    file: {}, resolvePath: () => "", mediaPathForURL: () => "", renderSubtitleMode: () => "" });
  manager.rememberLoaded("/resolved/cache.ass"); manager.unload();
  assert.deepEqual(commands, [["sub-remove", ["21"]]]);
});

test("styles bilingual playback through a cache and projects modes after restyling", async () => {
  const writes = [];
  const manager = createSubtitleTrackManager({
    mpv: {}, file: {read: () => "original", write: (path, content) => writes.push({path, content})},
    resolvePath: path => `/cache/${path.slice(6)}`, mediaPathForURL: path => path,
    getStyle: () => ({font: "Menlo"}), renderStyle: async content => `${content}:styled`,
    renderSubtitleMode: (content, mode) => `${content}:${mode}`,
  });
  assert.match(await manager.prepare("/library/sub.ass", "/video.mkv", "bilingual"), /cache/);
  assert.equal(writes[0].content, "original:styled:bilingual");
  assert.notEqual(writes[0].path, "/library/sub.ass");
  await manager.prepare("/library/sub.ass", "/video.mkv", "source");
  assert.equal(writes[1].content, "original:styled:source");
});
