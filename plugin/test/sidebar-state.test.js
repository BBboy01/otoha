const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveSidebarState } = require("../sidebar-state");
const { videoState } = require("./sidebar-fixture");

for (const [name, state, selection, expected] of [
  [
    "audio without a track",
    { tracks: [] },
    {},
    ["bilingual", true, "生成字幕", false],
  ],
  [
    "source only",
    {},
    { generationMode: "source" },
    ["source", false, "生成字幕", true],
  ],
  [
    "existing subtitle",
    { availableSubtitles: [{ path: "/a.ass", sourceLanguage: "en" }] },
    { generationSource: "existing-subtitle" },
    ["translate", true, "翻译并生成新版本", true],
  ],
  ["busy", { deletionOpen: true }, {}, ["bilingual", true, "生成字幕", false]],
]) {
  test(name, () => {
    const current = videoState(state);
    const view = deriveSidebarState(
      current,
      {
        generationMode: "bilingual",
        generationSource: "audio",
        sourceLanguage: "ja",
        targetLanguage: "zh-Hans",
        trackId: 1,
        ...selection,
      },
      current,
    );
    assert.deepEqual(
      [
        view.preflight.mode,
        view.needsTarget,
        view.startLabel,
        view.canGenerate,
      ],
      expected,
    );
  });
}

test("repeated refresh keeps local choices until the player changes them", () => {
  const previous = videoState();
  const selection = { sourceLanguage: "en", targetLanguage: "ja", trackId: 2 };
  const view = deriveSidebarState(videoState(), selection, previous);
  assert.equal(view.sourceLanguage, "en");
  assert.equal(view.targetLanguage, "ja");
  assert.equal(view.trackId, 2);
  assert.equal(
    deriveSidebarState(
      videoState({ selectedTrackId: 2 }),
      { ...selection, trackId: 1 },
      previous,
    ).trackId,
    2,
  );
});

test("preflight matches the media, languages and mode including successful cached modes", () => {
  const check = {
    mediaPath: "/Users/test/video.mp4",
    sourceLanguage: "ja",
    targetLanguage: "",
    generationMode: "source",
    status: "ready",
  };
  const state = videoState({
    languagePreflight: { status: "error", readyChecks: [check] },
  });
  const view = deriveSidebarState(state, { generationMode: "source" });
  assert.equal(view.preflight.check, check);
  assert.equal(
    view.preflight.key,
    '["/Users/test/video.mp4","ja","","source"]',
  );
  assert.equal(
    deriveSidebarState(
      { ...state, media: { path: "/other.mp4" } },
      { generationMode: "source" },
    ).preflight.check,
    undefined,
  );
});
