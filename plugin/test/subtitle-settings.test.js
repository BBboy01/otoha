const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleSettings, subtitleLanguages } = require("../subtitle-settings.js");

const mediaPath = "/videos/episode.mkv";
const japaneseSubtitle = { path: "/library/episode [ja to zh-Hans].ass" };
const englishSubtitle = { path: "/library/episode [en to zh-Hans].ass" };

function createPreferences(values = {}) {
  return {
    values,
    syncCount: 0,
    get(key) { return this.values[key]; },
    set(key, value) { this.values[key] = value; },
    sync() { this.syncCount += 1; },
  };
}

test("new videos use configured source and target language preferences", () => {
  const settings = createSubtitleSettings(createPreferences({
    default_source_language: "jpn",
    default_target_language: "fr-CA",
  }));

  assert.deepEqual(settings.languages(mediaPath, ["zh-Hans-CN"]), {
    sourceLanguage: "ja",
    targetLanguage: "fr",
  });
});

test("unset language preferences use English and the supported system language", () => {
  const settings = createSubtitleSettings(createPreferences());

  assert.deepEqual(settings.languages(mediaPath, ["xx", "zh-Hans-CN", "en-US"]), {
    sourceLanguage: "en",
    targetLanguage: "zh-Hans",
  });
});

test("successful generation survives a restart and overrides changed global defaults", () => {
  const preferences = createPreferences();
  const settings = createSubtitleSettings(preferences);
  settings.rememberGeneration(mediaPath, { sourceLanguage: "ja", targetLanguage: "zh-Hans" }, japaneseSubtitle.path);
  preferences.values.default_source_language = "de";
  preferences.values.default_target_language = "en";

  const restarted = createSubtitleSettings(preferences);
  assert.deepEqual(restarted.languages(mediaPath, ["en-US"]), {
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
  assert.equal(typeof preferences.values.video_settings, "string");
  assert.equal(preferences.syncCount, 1);
  assert.equal(restarted.selectedSubtitle(mediaPath, [englishSubtitle, japaneseSubtitle]), japaneseSubtitle);
  assert.deepEqual(restarted.languages("/videos/another.mkv", ["zh-Hans"]), {
    sourceLanguage: "de",
    targetLanguage: "en",
  });
});

test("videos without a saved configuration recover the newest valid ASS language pair", () => {
  const settings = createSubtitleSettings(createPreferences({ default_source_language: "de" }));

  assert.deepEqual(settings.languages(mediaPath, ["en-US"], [
    { path: "/library/episode.otoha.ass" },
    japaneseSubtitle,
    englishSubtitle,
  ]), { sourceLanguage: "ja", targetLanguage: "zh-Hans" });
});

test("remembering an older subtitle selection does not change the generation languages", () => {
  const preferences = createPreferences();
  const settings = createSubtitleSettings(preferences);
  settings.rememberGeneration(mediaPath, { sourceLanguage: "ja", targetLanguage: "zh-Hans" }, japaneseSubtitle.path);
  settings.rememberSelection(mediaPath, englishSubtitle.path);

  const restarted = createSubtitleSettings(preferences);
  assert.deepEqual(restarted.languages(mediaPath, ["en-US"]), {
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
  assert.equal(restarted.selectedSubtitle(mediaPath, [japaneseSubtitle, englishSubtitle]), englishSubtitle);
});

test("a selection-only record still recovers generation languages from the newest subtitle", () => {
  const settings = createSubtitleSettings(createPreferences());
  settings.rememberSelection(mediaPath, englishSubtitle.path);

  assert.deepEqual(settings.languages(mediaPath, ["en-US"], [japaneseSubtitle, englishSubtitle]), {
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
});

test("missing remembered subtitles fall back to the newest existing file without replacing the record", () => {
  const preferences = createPreferences();
  const settings = createSubtitleSettings(preferences);
  settings.rememberSelection(mediaPath, englishSubtitle.path);
  const before = preferences.values.video_settings;

  assert.equal(settings.selectedSubtitle(mediaPath, [japaneseSubtitle]), japaneseSubtitle);
  assert.equal(settings.selectedSubtitle(mediaPath, []), null);
  assert.equal(preferences.values.video_settings, before);
});

test("saving one video preserves the other video's generation and subtitle selection", () => {
  const preferences = createPreferences();
  const settings = createSubtitleSettings(preferences);
  settings.rememberGeneration(mediaPath, { sourceLanguage: "ja", targetLanguage: "zh-Hans" }, japaneseSubtitle.path);
  settings.rememberGeneration("/videos/other.mkv", { sourceLanguage: "fr", targetLanguage: "en" }, "/library/other [fr to en].ass");

  assert.deepEqual(settings.languages(mediaPath, ["en-US"]), {
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
  });
  assert.equal(settings.selectedSubtitle(mediaPath, [englishSubtitle, japaneseSubtitle]), japaneseSubtitle);
});

test("malformed settings cannot prevent loading existing subtitles or applying defaults", () => {
  for (const value of ["not json", "null", "[]", "5", '{"/videos/episode.mkv":null}']) {
    const preferences = createPreferences({ video_settings: value });
    const settings = createSubtitleSettings(preferences);
    assert.deepEqual(settings.languages(mediaPath, ["zh-Hans"]), {
      sourceLanguage: "en",
      targetLanguage: "zh-Hans",
    });
    assert.equal(settings.selectedSubtitle(mediaPath, [japaneseSubtitle]), japaneseSubtitle);
    settings.rememberSelection(mediaPath, japaneseSubtitle.path);
    assert.equal(createSubtitleSettings(preferences).selectedSubtitle(mediaPath, [englishSubtitle, japaneseSubtitle]), japaneseSubtitle);
  }
});

test("invalid saved languages fall back to defaults and invalid writes do not replace success", () => {
  const preferences = createPreferences({
    video_settings: JSON.stringify({ [mediaPath]: { sourceLanguage: "und", targetLanguage: "made-up", subtitlePath: japaneseSubtitle.path } }),
  });
  const settings = createSubtitleSettings(preferences);
  assert.deepEqual(settings.languages(mediaPath, ["zh-Hans"]), { sourceLanguage: "en", targetLanguage: "zh-Hans" });
  settings.rememberGeneration(mediaPath, { sourceLanguage: "ja", targetLanguage: "en" }, japaneseSubtitle.path);
  const before = preferences.values.video_settings;
  settings.rememberGeneration(mediaPath, { sourceLanguage: "und", targetLanguage: "en" }, englishSubtitle.path);
  settings.rememberGeneration(mediaPath, { sourceLanguage: "en", targetLanguage: "en" }, englishSubtitle.path);
  settings.rememberSelection("__proto__", englishSubtitle.path);
  settings.rememberSelection(mediaPath, "relative.ass");
  assert.equal(preferences.values.video_settings, before);
});

test("subtitle filename parsing normalizes supported language pairs and ignores invalid filenames", () => {
  assert.deepEqual(subtitleLanguages("/library/episode [jpn to zh-CN].ass"), { sourceLanguage: "ja", targetLanguage: "zh-Hans" });
  assert.deepEqual(subtitleLanguages("/library/episode [en to fr-CA].ASS"), { sourceLanguage: "en", targetLanguage: "fr" });
  for (const value of [null, {}, "episode.ass", "/library/episode [und to en].ass", "/library/episode [ja to und].ass", "/library/episode [ja to en].srt"]) {
    assert.deepEqual(subtitleLanguages(value), {});
  }
});
