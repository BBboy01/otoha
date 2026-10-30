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
  assert.equal(values.subtitle_scale, 140);
  assert.equal(values.synced, 2);
});

test("settings schema rejects unknown keys without touching preferences", () => {
  const values = {};
  assert.equal(writeSetting(preferences(values), "unknown", "value"), false);
  assert.deepEqual(values, {});
});
