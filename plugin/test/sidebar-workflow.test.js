const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  const nodes = new Map();
  const document = { activeElement: null, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, open: false, disabled: false, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; },
      focus() { document.activeElement = this; },
    });
    return nodes.get(id);
  } };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../sidebar-workflow.js"), "utf8"), { document, window });
  const node = (id) => document.getElementById(id);
  const state = { media: { path: "/movie.mp4" }, availableSubtitles: [{ path: "/old.ass" }] };
  window.sidebarWorkflow.onState(state);
  return { ui: window.sidebarWorkflow, node, state, click: (id) => node(id).listeners.click() };
}

test("regeneration requires confirmation and cancellation never starts a job", () => {
  const f = fixture();
  let starts = 0;
  f.ui.requestStart({ sourceLanguage: "en", targetLanguage: "ja" }, true, () => starts++);
  assert.equal(starts, 0);
  assert.equal(f.node("regenerate-dialog").open, true);
  f.click("regenerate-cancel");
  assert.equal(starts, 0);
  f.ui.requestStart({}, true, () => starts++);
  f.click("regenerate-confirm");
  assert.equal(starts, 1);
});

test("a media switch or active task invalidates a pending regeneration", () => {
  for (const next of [{ media: { path: "/other.mp4" } }, { jobActive: true }]) {
    const f = fixture();
    let starts = 0;
    f.ui.requestStart({}, true, () => starts++);
    f.ui.onState({ ...f.state, ...next });
    f.click("regenerate-confirm");
    assert.equal(starts, 0);
    assert.equal(f.node("regenerate-dialog").open, false);
  }
});

test("entering the editor closes an already open export dialog", () => {
  const f = fixture();
  f.click("open-export");
  f.ui.onState({ ...f.state, editorOpen: true });
  assert.equal(f.node("export-dialog").open, false);
});

test("generation is expanded for an empty library and collapsed for existing subtitles", () => {
  const f = fixture();
  assert.equal(f.node("generation-options").open, false);
  f.ui.onState({ ...f.state, media: { path: "/new.mp4" }, availableSubtitles: [] });
  assert.equal(f.node("generation-options").open, true);
  let starts = 0;
  f.ui.requestStart({}, false, () => starts++);
  assert.equal(starts, 1);
});

test("the first resolved library collapses generation even without automatic subtitle loading", () => {
  const f = fixture();
  f.ui.onState({ media: { path: "/another.mp4" }, subtitleLibraryLoading: true, availableSubtitles: [] });
  f.ui.onState({ media: { path: "/another.mp4" }, subtitleLibraryLoading: false, availableSubtitles: [{ path: "/old.ass" }] });
  assert.equal(f.node("generation-options").open, false);
  f.node("generation-options").open = true;
  f.ui.onState({ media: { path: "/another.mp4" }, availableSubtitles: [{ path: "/old.ass" }] });
  assert.equal(f.node("generation-options").open, true);
});

test("version labels prioritize readable languages and preserve collision numbers", () => {
  const f = fixture();
  assert.equal(f.ui.subtitleLabel({ path: "/movie [en to ja] (12).ass", sourceLanguage: "en", targetLanguage: "ja" }, [["en", "English"], ["ja", "日本語"]]), "English → 日本語 · 版本 12");
  assert.equal(f.ui.subtitleLabel({ path: "/legacy.ass" }, []), "legacy.ass");
});

test("resource recovery distinguishes Speech and Translation without guessing a missing language", () => {
  const f = fixture();
  f.ui.onPreflight({ speech: "installed", translation: "supported", errorCode: "translation.resourcesMissing" });
  assert.match(f.node("resource-breakdown").textContent, /语音转录：已就绪/);
  assert.match(f.node("resource-breakdown").textContent, /翻译：未安装/);
  assert.equal(f.node("resource-help").hidden, false);
  f.ui.onPreflight({ speech: "downloading", translation: "installed" });
  assert.match(f.node("resource-breakdown").textContent, /语音转录：下载中/);
  assert.equal(f.node("resource-help").hidden, true);
});
