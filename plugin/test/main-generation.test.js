const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

function ready(options) {
  const plugin = createPlugin(options);
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  return plugin;
}

test("cancelling subtitle import releases the operation without starting generation", async () => {
  const plugin = ready();
  await plugin.sidebarHandlers.get("importSubtitle")({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(plugin.execCalls.filter(call => call.args[0] === "--choose-subtitle-json").length, 1);
  assert.equal(plugin.execCalls.some(call => call.args[0] === "--request-json"), false);
  assert.equal(plugin.messages.findLast(item => item.name === "state").payload.importOpen, false);
  assert.equal(plugin.messages.some(item => item.name === "job" && item.payload.status === "error"), false);
});

test("SRT import translates without Speech resources, FFmpeg lookup or audio selection", async () => {
  const plugin = ready({ importSelection: "/tmp/self-authored.srt", preflightSpeech: "unsupported", ffmpegSearchPath: "" });
  await plugin.sidebarHandlers.get("importSubtitle")({ sourceLanguage: "en", targetLanguage: "ja" });
  const request = JSON.parse(plugin.execCalls.find(call => call.args[0] === "--request-json").args[1]);
  assert.equal(request.generationMode, "translate");
  assert.equal(request.inputSubtitlePath, "/tmp/self-authored.srt");
  assert.equal(request.ffmpegPath, "");
  assert.equal(plugin.execCalls.some(call => call.file === "/bin/zsh"), false);
});

test("pending import locks generation and ignores a result after media switch", async () => {
  let release;
  const importGate = new Promise(resolve => { release = resolve; });
  const plugin = ready({ importSelection: "/tmp/self-authored.srt", importGate });
  const importing = plugin.sidebarHandlers.get("importSubtitle")({ sourceLanguage: "en", targetLanguage: "ja" });
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "en", targetLanguage: "ja" });
  plugin.setMediaURL("file:///tmp/next.mkv");
  plugin.eventHandlers.get("iina.file-loaded")("file:///tmp/next.mkv");
  release();
  await importing;
  assert.equal(plugin.execCalls.some(call => call.args[0] === "--request-json"), false);
  assert.equal(plugin.messages.findLast(item => item.name === "state").payload.importOpen, false);
});
