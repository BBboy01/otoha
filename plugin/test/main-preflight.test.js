const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");

test("a failed preflight after media switch cannot overwrite current video feedback", async () => {
  let release;
  const preflightGate = new Promise((resolve) => { release = resolve; });
  const plugin = createPlugin({ preflightTranslation: "unsupported", preflightGate });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const running = plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "en", targetLanguage: "ja" });
  await new Promise((resolve) => setImmediate(resolve));
  plugin.setMediaURL("file:///Users/test/next.mkv");
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/next.mkv");
  const marker = plugin.messages.length;
  release();
  await running;
  assert.equal(plugin.messages.slice(marker).some((item) => item.name === "job" && item.payload.status === "error"), false);
  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--request-json"), false);
});

test("unsupported Speech blocks a direct start before invoking generation", async () => {
  const plugin = createPlugin({ preflightSpeech: "unsupported" });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--request-json"), false);
  const job = plugin.messages.findLast((item) => item.name === "job").payload;
  assert.equal(job.status, "error");
  assert.equal(job.errorCode, "speech.unsupportedLanguage");
});

test("cancel during a failing preflight finishes as cancelled and leaves generation unstarted", async () => {
  let release;
  const preflightGate = new Promise((resolve) => { release = resolve; });
  const plugin = createPlugin({ preflightTranslation: "unsupported", preflightGate });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const running = plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "en", targetLanguage: "ja" });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.sidebarHandlers.get("cancel")();
  release();
  await running;
  assert.equal(plugin.messages.findLast((item) => item.name === "job").payload.status, "cancelled");
  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--request-json"), false);
});

test("missing Translation resources have a recoverable preflight state", async () => {
  const plugin = createPlugin({ preflightTranslation: "supported" });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  await plugin.sidebarHandlers.get("checkLanguages")({ sourceLanguage: "en", targetLanguage: "ja" });
  const state = plugin.messages.findLast((item) => item.name === "state").payload;
  assert.equal(state.languagePreflight.status, "unavailable");
  assert.equal(state.languagePreflight.errorCode, "translation.resourcesMissing");
  assert.equal(plugin.execCalls.some((call) => call.args[0] === "--request-json"), false);
});
