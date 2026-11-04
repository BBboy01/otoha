const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createPlugin, helperPath } = require("./main-fixture");

test("runtime publishes timing and ignores a phase arriving after cancellation", async () => {
  const plugin = createPlugin({ waitForCancel: true, phaseAfterCancel: true, helperTerminal: "cancelled" });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const running = plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "en", targetLanguage: "ja" });
  await new Promise((resolve) => setImmediate(resolve));
  const phase = plugin.messages.findLast((item) => item.name === "job").payload;
  assert.equal(phase.phase, "transcribing");
  assert.equal(typeof phase.startedAt, "number");
  assert.equal(phase.finishedAt, null);
  await plugin.sidebarHandlers.get("cancel")();
  await running;
  assert.equal(plugin.messages.some((item) => item.payload?.message === "late phase"), false);
  const terminal = plugin.messages.findLast((item) => item.name === "job").payload;
  assert.equal(terminal.status, "cancelled");
  assert.equal(terminal.startedAt, phase.startedAt);
  assert.equal(typeof terminal.finishedAt, "number");
});

function sidebar() {
  const elements = new Map();
  const handlers = new Map();
  const timers = [];
  let now = 1000;
  const context = {
    document: { querySelector(selector) {
      const element = {
        hidden: false, dataset: {}, attributes: new Map(),
        add() {}, addEventListener() {}, replaceChildren() {}, focus() {},
        setAttribute(key, value) { this.attributes.set(key, String(value)); },
        getAttribute(key) { return this.attributes.get(key); },
        removeAttribute(key) { this.attributes.delete(key); },
      };
      elements.set(selector, element);
      return element;
    } },
    iina: { onMessage(name, callback) { handlers.set(name, callback); }, postMessage() {} },
    Option: class {}, URL, Date: { now: () => now },
    window: { location: { href: "file:///tmp/Otoha/sidebar.html" }, setInterval(callback) { timers.push(callback); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8"), context);
  const state = (job) => handlers.get("state")({ media: { path: "/synthetic.mp4" }, tracks: [], job });
  return { elements, state, tick(time) { now = time; timers.forEach((callback) => callback()); } };
}

test("transcription shows indeterminate progress and elapsed time without inventing a percentage", () => {
  const ui = sidebar();
  ui.state({ jobId: "one", status: "running", phase: "transcribing", message: "正在转录", startedAt: 1000 });
  const progress = ui.elements.get("#translation-progress");
  assert.equal(progress.hidden, false);
  assert.equal(progress.getAttribute("value"), undefined);
  assert.equal(progress.getAttribute("aria-valuenow"), undefined);
  ui.tick(126000);
  assert.equal(ui.elements.get("#job-elapsed").textContent, "已耗时 2:05");
  assert.equal(ui.elements.get("#cancel-button").hidden, false);
});

test("all running phases have progress; translation percentages clear on phase change and cancel", () => {
  const ui = sidebar();
  for (const phase of ["checkingEnvironment", "extractingAudio", "preparingLanguageResources", "transcribing", "saving", "loading"]) {
    ui.state({ status: phase === "loading" ? "loading" : "running", phase, startedAt: 1000 });
    assert.equal(ui.elements.get("#translation-progress").hidden, false, phase);
  }
  ui.state({ status: "running", phase: "translating", progress: 0.42, startedAt: 1000 });
  assert.equal(ui.elements.get("#translation-progress").getAttribute("aria-valuetext"), "42%");
  ui.state({ status: "running", phase: "saving", startedAt: 1000 });
  assert.equal(ui.elements.get("#translation-progress").getAttribute("aria-valuenow"), undefined);
  ui.state({ status: "canceling", startedAt: 1000, finishedAt: 61000 });
  ui.tick(200000);
  assert.equal(ui.elements.get("#translation-progress").hidden, true);
  assert.equal(ui.elements.get("#job-elapsed").textContent, "已耗时 1:00");
  ui.state({ status: "idle" });
  assert.equal(ui.elements.get("#job-elapsed").hidden, true);
});
