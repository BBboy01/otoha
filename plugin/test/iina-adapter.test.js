const test = require("node:test");
const assert = require("node:assert/strict");
const { createIinaAdapter } = require("../iina-adapter");

test("IINA adapter exposes host capabilities behind a stable boundary", () => {
  const calls = [];
  const runtime = {
    core: { window: { loaded: true }, status: { url: "file:///video.mkv" } },
    event: { on(name) { calls.push(["event", name]); } },
    menu: { addItem() {} },
    mpv: { getNative(name) { calls.push(["mpv", name]); return []; } },
    preferences: { get(name) { calls.push(["preference", name]); return "value"; } },
    sidebar: {
      loadFile(file) { calls.push(["load", file]); },
      postMessage(name, payload) { calls.push(["post", name, payload]); },
      onMessage(name) { calls.push(["sidebar-event", name]); },
      show() { calls.push(["show"]); },
    },
    utils: { exec(...args) { calls.push(["exec", ...args]); return Promise.resolve({ status: 0 }); } },
  };

  const adapter = createIinaAdapter(runtime);

  assert.equal(adapter.mediaURL(), "file:///video.mkv");
  assert.equal(adapter.playerWindowIsLoaded(), true);
  assert.deepEqual(adapter.trackList(), []);
  assert.equal(adapter.preference("setting"), "value");
  adapter.loadSidebar("sidebar.html");
  adapter.postSidebar("state", { ok: true });
  assert.deepEqual(calls, [
    ["mpv", "track-list"],
    ["preference", "setting"],
    ["load", "sidebar.html"],
    ["post", "state", { ok: true }],
  ]);
});
