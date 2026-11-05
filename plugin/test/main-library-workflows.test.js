const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

const path = "/Users/test/Anime episode [ja to zh-Hans].ass";
const snapshot = { path, revision: "a".repeat(64), cues: [{ start: 1, end: 2, source: "Source", translation: "Translation" }] };

async function ready() {
  const plugin = createPlugin({ existingSubtitles: [path], subtitleEditSnapshot: snapshot });
  plugin.runSidebarLoad();
  await plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));
  return plugin;
}

test("an open editor blocks deletion and generation until closed", async () => {
  const plugin = await ready();
  await plugin.sidebarHandlers.get("editSubtitle")(path);
  assert.equal(plugin.messages.findLast((item) => item.name === "editor").payload.status, "ready");
  const count = plugin.messages.length;
  plugin.sidebarHandlers.get("requestSubtitleDeletion")(path);
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(plugin.messages.slice(count).some((item) => item.name === "deletion" || item.name === "job"), false);
  await plugin.sidebarHandlers.get("closeSubtitleEditor")();
  plugin.sidebarHandlers.get("requestSubtitleDeletion")(path);
  assert.equal(plugin.messages.findLast((item) => item.name === "deletion").payload.status, "confirm");
});

test("a deletion confirmation blocks opening the editor until cancelled", async () => {
  const plugin = await ready();
  plugin.sidebarHandlers.get("requestSubtitleDeletion")(path);
  assert.equal(plugin.messages.findLast((item) => item.name === "deletion").payload.status, "confirm");
  await plugin.sidebarHandlers.get("editSubtitle")(path);
  assert.notEqual(plugin.messages.findLast((item) => item.name === "editor")?.payload.status, "ready");
  plugin.sidebarHandlers.get("cancelSubtitleDeletion")();
  await plugin.sidebarHandlers.get("editSubtitle")(path);
  assert.equal(plugin.messages.findLast((item) => item.name === "editor").payload.status, "ready");
});
