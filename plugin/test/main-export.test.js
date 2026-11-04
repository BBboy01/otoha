const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

const subtitlePath = "/Users/test/Library/Application Support/Otoha/Subtitles/Anime/Anime [en to zh-Hans].ass";

test("main exports a selected ASS into Otoha's Exports directory without a native picker", async () => {
  const plugin = createPlugin({ existingSubtitles: [subtitlePath] });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.sidebarHandlers.get("exportSubtitle")({ subtitlePath, mode: "translation" });

  assert.deepEqual(plugin.chooseFileCalls, []);
  const call = plugin.execCalls.find((entry) => entry.args[0] === "--export-srt-json");
  assert.ok(call);
  const request = JSON.parse(call.args[1]);
  assert.equal(request.subtitlePath, subtitlePath);
  assert.equal(request.mediaPath, "/Users/test/Anime episode.mkv");
  assert.equal(request.mode, "translation");
  assert.equal(request.destinationDirectoryPath, "/Users/test/Library/Application Support/Otoha/Subtitles/Exports");
  assert.deepEqual(plugin.messages.findLast((message) => message.name === "exportResult").payload, {
    status: "success",
    path: `${request.destinationDirectoryPath}/Anime episode [Translation].srt`,
  });
});

test("main rejects an unlisted subtitle without starting an export or writing files", async () => {
  const plugin = createPlugin({ existingSubtitles: [subtitlePath] });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.sidebarHandlers.get("exportSubtitle")({ subtitlePath: "/tmp/outside.ass", mode: "bilingual" });

  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--export-srt-json"), false);
  assert.equal(plugin.messages.findLast((message) => message.name === "exportResult").payload.status, "error");
  assert.deepEqual(plugin.fileWrites, []);
});
