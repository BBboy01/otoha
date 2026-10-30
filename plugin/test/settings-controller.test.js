const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettingsController } = require("../settings-controller");

test("settings controller normalizes persisted settings and invalidates subtitle library", async () => {
  const values = { auto_load: "true", output_directory: "" };
  let syncCount = 0;
  let invalidations = 0;
  const controller = createSettingsController({
    preferences: {
      get: (key) => values[key],
      set: (key, value) => { values[key] = value; },
      sync: () => { syncCount += 1; },
    },
    exec: async () => ({ status: 0 }),
    invalidateLibrary: () => { invalidations += 1; },
    reportError: () => assert.fail("unexpected error"),
  });

  assert.equal(controller.autoLoadEnabled(), true);
  await controller.setSetting("output_directory", " /tmp/captions ");
  assert.equal(values.output_directory, "/tmp/captions");
  assert.equal(syncCount, 1);
  assert.equal(invalidations, 1);
});
