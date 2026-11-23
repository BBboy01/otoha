const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

test("loading rejects repeated load, generate, import, edit, delete, associate and display messages", async () => {
  let release;
  const subtitleLoadGate = new Promise((resolve) => {
    release = resolve;
  });
  const subtitle = "/library/subtitle.ass";
  const f = createPlugin({ existingSubtitles: [subtitle], subtitleLoadGate });
  f.runSidebarLoad();
  f.sidebarHandlers.get("ready")({ helperPath });
  await new Promise(setImmediate);
  const loading = f.sidebarHandlers.get("loadExisting")(subtitle);
  await new Promise(setImmediate);
  try {
    const before = f.execCalls.length;
    for (const [name, payload] of [
      ["loadExisting", subtitle],
      ["retryLoad"],
      ["setDisplayMode", "source"],
      ["start", { trackId: 7, sourceLanguage: "en", targetLanguage: "ja" }],
      ["importSubtitle"],
      ["editSubtitle", subtitle],
      ["requestSubtitleDeletion", subtitle],
      ["requestSubtitleAssociation"],
      ["exportSubtitle", { subtitlePath: subtitle, mode: "source" }],
    ])
      await f.sidebarHandlers.get(name)(payload);
    assert.equal(f.loadedTracks.length, 1);
    assert.equal(f.execCalls.length, before);
  } finally {
    release();
    await loading;
  }
  assert.equal(
    f.messages.findLast((message) => message.name === "state").payload.job
      .status,
    "completed",
  );
});
