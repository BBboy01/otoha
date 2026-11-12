const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createPlugin, helperPath } = require("./main-fixture");

test("runtime publishes timing and ignores a phase arriving after cancellation", async () => {
  const plugin = createPlugin({
    waitForCancel: true,
    phaseAfterCancel: true,
    helperTerminal: "cancelled",
  });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const running = plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "en",
    targetLanguage: "ja",
  });
  await new Promise((resolve) => setImmediate(resolve));
  const phase = plugin.messages.findLast((item) => item.name === "job").payload;
  assert.equal(phase.phase, "transcribing");
  assert.equal(typeof phase.startedAt, "number");
  assert.equal(phase.finishedAt, null);
  await plugin.sidebarHandlers.get("cancel")();
  await running;
  assert.equal(
    plugin.messages.some((item) => item.payload?.message === "late phase"),
    false,
  );
  const terminal = plugin.messages.findLast(
    (item) => item.name === "job",
  ).payload;
  assert.equal(terminal.status, "cancelled");
  assert.equal(terminal.startedAt, phase.startedAt);
  assert.equal(typeof terminal.finishedAt, "number");
});

function sidebar() {
  const elements = new Map();
  const handlers = new Map();
  const timers = [];
  const delayed = new Map();
  let nextTimer = 0;
  let now = 1000;
  const context = {
    document: {
      activeElement: null,
      querySelectorAll() {
        return [];
      },
      querySelector(selector) {
        const element = {
          hidden: false,
          dataset: {},
          attributes: new Map(),
          classList: {
            values: new Set(),
            add(value) {
              this.values.add(value);
            },
            remove(value) {
              this.values.delete(value);
            },
          },
          add() {},
          addEventListener() {},
          replaceChildren() {},
          focus() {
            context.document.activeElement = this;
          },
          setAttribute(key, value) {
            this.attributes.set(key, String(value));
          },
          getAttribute(key) {
            return this.attributes.get(key);
          },
          removeAttribute(key) {
            this.attributes.delete(key);
          },
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
      },
    },
    iina: {
      onMessage(name, callback) {
        handlers.set(name, callback);
      },
      postMessage() {},
    },
    Option: class {},
    URL,
    Date: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      delayed.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      delayed.delete(id);
    },
    requestAnimationFrame(callback) {
      callback();
    },
    window: {
      location: { href: "file:///tmp/Otoha/sidebar.html" },
      setInterval(callback) {
        timers.push(callback);
      },
      setTimeout(callback, delay) {
        const id = ++nextTimer;
        delayed.set(id, { callback, delay });
        return id;
      },
      clearTimeout(id) {
        delayed.delete(id);
      },
    },
  };
  vm.runInNewContext(
    ["sidebar-progress.js", "sidebar.js"]
      .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
      .join("\n"),
    context,
  );
  const state = (job, extra = {}) =>
    handlers.get("state")({
      media: { path: "/synthetic.mp4" },
      tracks: [{ id: 1, available: true }],
      selectedTrackId: 1,
      sourceLanguage: "en",
      targetLanguage: "ja",
      languagePreflight: {
        mediaPath: "/synthetic.mp4",
        sourceLanguage: "en",
        targetLanguage: "ja",
        status: "ready",
      },
      job,
      ...extra,
    });
  return {
    elements,
    state,
    handlers,
    document: context.document,
    tick(time) {
      now = time;
      timers.forEach((callback) => callback());
    },
    advance(delay) {
      const due = Array.from(delayed).filter(
        ([, timer]) => timer.delay <= delay,
      );
      for (const [id, timer] of due) {
        delayed.delete(id);
        timer.callback();
      }
    },
  };
}

test("transcription shows indeterminate progress and elapsed time without inventing a percentage", () => {
  const ui = sidebar();
  ui.state({
    jobId: "one",
    status: "running",
    phase: "transcribing",
    message: "正在转录",
    startedAt: 1000,
  });
  const progress = ui.elements.get("#translation-progress");
  assert.equal(progress.hidden, true);
  ui.advance(180);
  assert.equal(progress.hidden, false);
  assert.equal(progress.getAttribute("value"), undefined);
  assert.equal(progress.getAttribute("aria-valuenow"), undefined);
  ui.tick(126000);
  assert.equal(ui.elements.get("#job-elapsed").textContent, "已耗时 2:05");
  assert.equal(ui.elements.get("#cancel-button").hidden, false);
});

test("fast completion cancels delayed progress reveal without flashing the drawer", () => {
  const ui = sidebar();
  ui.state({
    jobId: "fast",
    status: "running",
    phase: "transcribing",
    startedAt: 1000,
  });
  assert.equal(ui.elements.get("#translation-progress").hidden, true);
  ui.state({
    jobId: "fast",
    status: "completed",
    loaded: true,
    startedAt: 1000,
  });
  ui.advance(180);
  assert.equal(ui.elements.get("#translation-progress").hidden, true);
});

test("a new job before the delayed reveal replaces the old reveal timer", () => {
  const ui = sidebar();
  ui.state({ jobId: "old", status: "running" });
  ui.state({ jobId: "new", status: "running" });
  ui.advance(180);
  assert.equal(ui.elements.get("#translation-progress").hidden, false);
});

test("generation reveals the attached drawer and retracts completed feedback", () => {
  const ui = sidebar(),
    status = ui.elements.get("#job-status");
  ui.state({ jobId: "drawer", status: "running" });
  assert.equal(status.getAttribute("data-drawer"), "collapsed");
  ui.advance(180);
  assert.equal(status.getAttribute("data-drawer"), "expanded");
  ui.state({ jobId: "drawer", status: "completed", loaded: true });
  assert.equal(status.getAttribute("data-drawer"), "collapsed");
  assert.equal(status.hidden, false);
  ui.advance(300);
  assert.equal(status.hidden, true);
  ui.state({ jobId: "drawer", status: "completed", loaded: true });
  assert.equal(status.hidden, true);
});

test("completion remains available to screen readers after the visual drawer retracts", () => {
  const ui = sidebar();
  ui.state({
    jobId: "spoken",
    status: "running",
    phase: "transcribing",
    message: "正在转录",
  });
  ui.advance(180);
  ui.state({ jobId: "spoken", status: "completed", loaded: true });
  ui.advance(300);
  assert.equal(ui.elements.get("#job-status").hidden, true);
  assert.equal(
    ui.elements.get("#job-announcement")?.textContent,
    "字幕已生成并加载",
  );
  assert.equal(ui.elements.get("#job-announcement").hidden, false);
});

test("live feedback announces phase changes without repeating every translation percentage", () => {
  const ui = sidebar();
  ui.state({
    jobId: "spoken",
    status: "running",
    phase: "translating",
    message: "正在翻译 1/11",
  });
  ui.state({
    jobId: "spoken",
    status: "running",
    phase: "translating",
    message: "正在翻译 2/11",
  });
  assert.equal(
    ui.elements.get("#job-announcement")?.textContent,
    "正在翻译 1/11",
  );
  ui.state({
    jobId: "spoken",
    status: "running",
    phase: "saving",
    message: "正在保存",
  });
  assert.equal(ui.elements.get("#job-announcement").textContent, "正在保存");
  ui.state({ status: "idle" });
  assert.equal(ui.elements.get("#job-announcement").textContent, "");
});

test("the persistent generation button exposes busy and completion states without enabling early", () => {
  const ui = sidebar();
  const start = ui.elements.get("#start-button");
  ui.state({ jobId: "one", status: "running" }, { jobActive: true });
  assert.equal(start.getAttribute("data-phase"), "busy");
  assert.equal(start.getAttribute("aria-label"), "正在生成");
  ui.state(
    { jobId: "one", status: "completed", loaded: true },
    { jobActive: true },
  );
  assert.equal(start.getAttribute("data-phase"), "complete");
  assert.equal(start.disabled, true);
  ui.state(
    { jobId: "one", status: "completed", loaded: true },
    { jobActive: false },
  );
  assert.equal(start.disabled, false);
  ui.advance(1000);
  assert.equal(start.getAttribute("data-phase"), "idle");
});

test("retrying a failed generation reverses the drawer close without resetting its position", () => {
  const ui = sidebar();
  ui.state({
    jobId: "failed",
    status: "running",
    phase: "translating",
    progress: 0.42,
    startedAt: 1000,
  });
  ui.advance(180);
  const drawer = ui.elements.get("#job-progress");
  ui.state({ jobId: "failed", status: "error", message: "生成失败" });
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.classList.values.has("is-visible"), false);
  ui.state({
    jobId: "retry",
    status: "running",
    phase: "checkingEnvironment",
    startedAt: 2000,
  });
  assert.equal(drawer.hidden, false);
  assert.equal(drawer.classList.values.has("is-visible"), true);
  ui.advance(220);
  assert.equal(drawer.hidden, false);
});

test("all running phases have progress; translation percentages clear on phase change and cancel", () => {
  const ui = sidebar();
  for (const phase of [
    "checkingEnvironment",
    "extractingAudio",
    "preparingLanguageResources",
    "transcribing",
    "saving",
    "loading",
  ]) {
    ui.state({
      status: phase === "loading" ? "loading" : "running",
      phase,
      startedAt: 1000,
    });
    ui.advance(180);
    assert.equal(ui.elements.get("#translation-progress").hidden, false, phase);
  }
  ui.state({
    status: "running",
    phase: "translating",
    progress: 0.42,
    startedAt: 1000,
  });
  assert.equal(
    ui.elements.get("#translation-progress").getAttribute("aria-valuetext"),
    "42%",
  );
  ui.state({ status: "running", phase: "saving", startedAt: 1000 });
  assert.equal(
    ui.elements.get("#translation-progress").getAttribute("aria-valuenow"),
    undefined,
  );
  ui.state({ status: "canceling", startedAt: 1000, finishedAt: 61000 });
  assert.equal(ui.elements.get("#translation-progress").hidden, false);
  ui.advance(260);
  ui.advance(180);
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
    const update = (job) =>
      delivery === "state" ? ui.state(job) : ui.handlers.get("job")(job);
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
    assert.equal(
      ui.document.activeElement,
      ui.elements.get("#auto-load-help"),
      delivery,
    );
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
  const plugin = createPlugin({
    helperTerminal: "cancelled",
    waitAfterTerminal: true,
  });
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const running = plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "en",
    targetLanguage: "ja",
  });
  await new Promise((resolve) => setImmediate(resolve));
  plugin.sidebarHandlers.get("refresh")();
  const terminal = plugin.messages.findLast(
    (item) => item.name === "state",
  ).payload;
  try {
    assert.equal(terminal.job.status, "cancelled");
    assert.equal(terminal.jobActive, true);
  } finally {
    plugin.finishHelper();
    await running;
  }
  assert.equal(
    plugin.messages.findLast((item) => item.name === "state").payload.jobActive,
    false,
  );
});
