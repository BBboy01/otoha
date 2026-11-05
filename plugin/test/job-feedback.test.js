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
    document: { activeElement: null, querySelectorAll() { return []; }, querySelector(selector) {
      const element = {
        hidden: false, dataset: {}, attributes: new Map(),
        add() {}, addEventListener() {}, replaceChildren() {},
        focus() { context.document.activeElement = this; },
        setAttribute(key, value) { this.attributes.set(key, String(value)); },
        getAttribute(key) { return this.attributes.get(key); },
        removeAttribute(key) { this.attributes.delete(key); },
      };
      for (const property of ["hidden", "disabled"]) {
        let value = false;
        Object.defineProperty(element, property, {
          get: () => value,
          set(next) {
            value = next;
            if (next && context.document.activeElement === element)
              context.document.activeElement = null;
          },
        });
      }
      elements.set(selector, element);
      return element;
    } },
    iina: { onMessage(name, callback) { handlers.set(name, callback); }, postMessage() {} },
    Option: class {}, URL, Date: { now: () => now },
    window: { location: { href: "file:///tmp/Otoha/sidebar.html" }, setInterval(callback) { timers.push(callback); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8"), context);
  const state = (job, extra = {}) => handlers.get("state")({ media: { path: "/synthetic.mp4" }, tracks: [{ id: 1, available: true }], selectedTrackId: 1, sourceLanguage: "en", targetLanguage: "ja", languagePreflight: { mediaPath: "/synthetic.mp4", sourceLanguage: "en", targetLanguage: "ja", status: "ready" }, job, ...extra });
  return { elements, state, handlers, document: context.document, tick(time) { now = time; timers.forEach((callback) => callback()); } };
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

test("cancelled and failed jobs restore keyboard focus without stealing it at startup", () => {
  for (const delivery of ["state", "job"]) {
    const ui = sidebar();
    const start = ui.elements.get("#start-button");
    const cancel = ui.elements.get("#cancel-button");
    const message = ui.elements.get("#job-message");
    ui.state({ status: "idle" });
    const update = job => delivery === "state" ? ui.state(job) : ui.handlers.get("job")(job);
    start.focus();
    update({ status: "running", phase: "transcribing" });
    assert.equal(ui.document.activeElement, null, delivery);
    cancel.focus();
    update({ status: "canceling" });
    assert.equal(ui.document.activeElement, message, delivery);
    update({ status: "cancelled" });
    assert.equal(ui.document.activeElement, start, delivery);
    start.focus();
    update({ status: "running", phase: "transcribing" });
    cancel.focus();
    update({ status: "error", message: "可重试" });
    assert.equal(ui.document.activeElement, start, delivery);
    ui.elements.get("#auto-load-help").focus();
    update({ status: "running", phase: "transcribing" });
    assert.equal(ui.document.activeElement, ui.elements.get("#auto-load-help"), delivery);
  }
});

test("terminal feedback keeps generation disabled until the helper process exits", () => {
  const ui = sidebar();
  ui.state({ status: "running" }, { jobActive: true });
  ui.elements.get("#cancel-button").focus();
  ui.state({ status: "cancelled", message: "已取消" }, { jobActive: true });
  assert.equal(ui.elements.get("#start-button").disabled, true);
  assert.equal(ui.document.activeElement, ui.elements.get("#job-message"));
  ui.state({ status: "cancelled", message: "已取消" }, { jobActive: false });
  assert.equal(ui.elements.get("#start-button").disabled, false);
  assert.equal(ui.document.activeElement, ui.elements.get("#start-button"));
});

test("terminal focus stays on visible feedback when generation settings are collapsed", () => {
  const ui = sidebar();
  ui.elements.get("#start-button").closest = () => ({ open: false });
  ui.state({ status: "running" });
  ui.elements.get("#cancel-button").focus();
  ui.state({ status: "cancelled", message: "已取消" });
  assert.equal(ui.document.activeElement, ui.elements.get("#job-message"));
});

test("a completed generation retains feedback while loading an existing file uses its loaded badge", () => {
  const ui = sidebar();
  ui.state({ jobId: "generated", status: "completed", loaded: true });
  assert.equal(ui.elements.get("#job-status").hidden, false);
  assert.equal(ui.elements.get("#job-message").textContent, "字幕已生成并加载");
  ui.state({ jobId: null, status: "completed", loaded: true });
  assert.equal(ui.elements.get("#job-status").hidden, true);
});

test("runtime publishes active ownership until a terminal helper has actually exited", async () => {
  const plugin = createPlugin({ helperTerminal: "cancelled", waitAfterTerminal: true });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const running = plugin.sidebarHandlers.get("start")({ trackId: 7, sourceLanguage: "en", targetLanguage: "ja" });
  await new Promise(resolve => setImmediate(resolve));
  plugin.sidebarHandlers.get("refresh")();
  const terminal = plugin.messages.findLast(item => item.name === "state").payload;
  try {
    assert.equal(terminal.job.status, "cancelled");
    assert.equal(terminal.jobActive, true);
  } finally {
    plugin.finishHelper();
    await running;
  }
  assert.equal(plugin.messages.findLast(item => item.name === "state").payload.jobActive, false);
});
