const test = require("node:test");
const assert = require("node:assert/strict");
const { createSidebar, videoState, change } = require("./sidebar-fixture");

test("unchanged refresh preserves options and the user's language selection", () => {
  const f = createSidebar();
  const state = videoState({ availableSubtitles: [{ path: "/a.ass" }] });
  f.handlers.get("state")(state);
  change(f, "#source-language", "en");
  const tracks = f.elements.get("#audio-track").children.slice();
  const languages = f.elements.get("#source-language").children.slice();
  const subtitles = f.elements.get("#subtitle-choice").children.slice();
  f.handlers.get("state")(structuredClone(state));
  assert.equal(f.elements.get("#source-language").value, "en");
  for (const [selector, children] of [
    ["#audio-track", tracks],
    ["#source-language", languages],
    ["#subtitle-choice", subtitles],
  ]) {
    assert.equal(f.elements.get(selector).children[0], children[0], selector);
  }
});

test("ready preflight cache avoids another message while explicit refresh forces a check", () => {
  const f = createSidebar();
  const check = {
    mediaPath: "/Users/test/video.mp4",
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    generationMode: "bilingual",
    status: "ready",
  };
  f.handlers.get("state")(
    videoState({ languagePreflight: { readyChecks: [check] } }),
  );
  assert.equal(
    f.posts.filter((post) => post.name === "checkLanguages").length,
    0,
  );
  f.elements.get("#check-languages").listeners.get("click")();
  assert.equal(
    f.posts.filter((post) => post.name === "checkLanguages").length,
    1,
  );
  assert.equal(f.posts.at(-1).payload.force, true);
});
