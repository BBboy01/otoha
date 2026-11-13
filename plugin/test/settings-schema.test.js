const test = require("node:test");
const assert = require("node:assert/strict");
const { readSetting, writeSetting } = require("../settings-schema");

function preferences(values) {
  return {
    get: (key) => values[key],
    set: (key, value) => { values[key] = value; },
    sync: () => { values.synced = (values.synced || 0) + 1; },
  };
}

test("settings schema applies defaults and typed ranges", () => {
  const values = {};
  const store = preferences(values);
  assert.equal(readSetting(store, "auto_load"), false);
  assert.equal(readSetting(store, "subtitle_scale"), 100);
  assert.equal(readSetting(store, "default_source_language"), "en");
  assert.equal(readSetting(store, "subtitle_scale"), 100);

  writeSetting(store, "auto_load", "true");
  writeSetting(store, "subtitle_scale", 999);
  assert.equal(values.auto_load, true);
  assert.equal(values.subtitle_scale, 300);
  assert.equal(values.synced, 2);
});

test("subtitle scale accepts the new bounds and precise values", () => {
  const values = {};
  const store = preferences(values);
  for (const percent of [50, 137, 200, 300]) {
    writeSetting(store, "subtitle_scale", percent);
    assert.equal(readSetting(store, "subtitle_scale"), percent);
  }
  writeSetting(store, "subtitle_scale", 10);
  assert.equal(readSetting(store, "subtitle_scale"), 50);
});

test("settings schema rejects unknown keys without touching preferences", () => {
  const values = {};
  assert.equal(writeSetting(preferences(values), "unknown", "value"), false);
  assert.deepEqual(values, {});
});

test("subtitle font persists trimmed names and falls back for unsafe ASS fields", () => {
  const values = {};
  const store = preferences(values);
  assert.equal(readSetting(store, "subtitle_font"), "Arial");
  writeSetting(store, "subtitle_font", "  PingFang SC  ");
  assert.equal(readSetting(store, "subtitle_font"), "PingFang SC");
  for (const name of ["", " ", "Arial,42", "Arial\nStyle: injected", "Arial\0", "x".repeat(129)]) {
    writeSetting(store, "subtitle_font", name);
    assert.equal(readSetting(store, "subtitle_font"), "Arial");
  }
});
