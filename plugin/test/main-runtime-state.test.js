const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

const tick = () => new Promise(setImmediate);
const latestState = (plugin) =>
  plugin.messages.findLast((message) => message.name === "state").payload;

async function initialize(options) {
  const plugin = createPlugin(options);
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await tick();
  return plugin;
}

test("a library failure preserves the active generation identity, phase and timing", async () => {
  const plugin = await initialize({
    waitForCancel: true,
    helperTerminal: "cancelled",
    failedListingPath: "/broken",
  });
  const running = plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "en",
    targetLanguage: "ja",
  });
  await tick();
  const before = plugin.messages.findLast(
    (message) => message.name === "job",
  ).payload;
  try {
    plugin.preferenceValues.output_directory = "/broken";
    plugin.sidebarHandlers.get("refresh")();
    await tick();
    const state = latestState(plugin);
    assert.equal(state.job.status, "running");
    assert.equal(state.job.jobId, before.jobId);
    assert.equal(state.job.phase, "transcribing");
    assert.equal(state.job.startedAt, before.startedAt);
    assert.equal(state.subtitleLibraryError.code, "subtitle.libraryFailed");
    assert.equal(state.generationJob.jobId, before.jobId);
  } finally {
    await plugin.sidebarHandlers.get("cancel")();
    await running;
  }
});

test("subtitle loading has its own state and survives an unrelated library failure", async () => {
  let release;
  const subtitle = "/library/video.ass";
  const plugin = await initialize({
    existingSubtitles: [subtitle],
    failedListingPath: "/broken",
    subtitleLoadGate: new Promise((resolve) => {
      release = resolve;
    }),
  });
  const loading = plugin.sidebarHandlers.get("loadExisting")(subtitle);
  await tick();
  try {
    assert.equal(latestState(plugin).subtitleLoad.status, "loading");
    plugin.preferenceValues.output_directory = "/broken";
    plugin.sidebarHandlers.get("refresh")();
    await tick();
    const state = latestState(plugin);
    assert.equal(state.job.status, "loading");
    assert.equal(state.generationJob.status, "idle");
    assert.equal(state.subtitleLoad.status, "loading");
    assert.equal(state.subtitleLibraryError.code, "subtitle.libraryFailed");
  } finally {
    release();
    await loading;
  }
  assert.equal(latestState(plugin).subtitleLoad.loaded, true);
});

for (const failSubtitleLoad of [true, false]) {
  test(`library warnings preserve subsequent ${failSubtitleLoad ? "load retry" : "loaded feedback"}`, async () => {
    const subtitle = "/library/video.ass";
    const plugin = await initialize({
      existingSubtitles: [subtitle],
      failedListingPath: "/broken",
      failSubtitleLoad,
    });
    plugin.preferenceValues.output_directory = "/broken";
    plugin.sidebarHandlers.get("refresh")();
    await tick();
    await plugin.sidebarHandlers.get("loadExisting")(subtitle);
    const state = latestState(plugin);
    assert.equal(
      state.job.status,
      failSubtitleLoad ? "load-error" : "completed",
    );
    assert.equal(state.job.loaded, !failSubtitleLoad);
    assert.equal(state.subtitleLibraryError.code, "subtitle.libraryFailed");
  });
}

test("generation timing stays active until subtitle loading finishes", async () => {
  let release;
  const plugin = await initialize({
    subtitleLoadGate: new Promise((resolve) => {
      release = resolve;
    }),
  });
  const running = plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "en",
    targetLanguage: "ja",
  });
  await tick();
  try {
    assert.equal(latestState(plugin).generationJob.status, "completed");
    assert.equal(latestState(plugin).job.status, "loading");
    assert.equal(latestState(plugin).job.finishedAt, null);
  } finally {
    release();
    await running;
  }
  assert.equal(typeof latestState(plugin).job.finishedAt, "number");
});
