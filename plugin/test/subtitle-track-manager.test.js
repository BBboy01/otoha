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
