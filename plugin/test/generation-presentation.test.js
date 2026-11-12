const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createPlugin, helperPath } = require("./main-fixture");

function waitingPlugin() {
  const plugin = createPlugin();
  plugin.runSidebarLoad();
  plugin.sidebarHandlers.get("ready")({ helperPath });
  const running = plugin.sidebarHandlers.get("start")({
    trackId: 7,
    sourceLanguage: "en",
    targetLanguage: "ja",
    waitForProgress: true,
  });
  const job = plugin.messages.findLast(({ name }) => name === "state").payload
    .job;
  const generations = () =>
    plugin.execCalls.filter(({ args }) => args.includes("--request-json"));
  return { plugin, running, job, generations };
}

test("the helper starts only after the current drawer has acknowledged expansion", async () => {
  const { plugin, running, job, generations } = waitingPlugin();
  await new Promise(setImmediate);
  assert.equal(generations().length, 0);
  assert.equal(job.message, "正在启动");
  plugin.sidebarHandlers.get("progressReady")({ jobId: "stale" });
  await new Promise(setImmediate);
  assert.equal(generations().length, 0);
  plugin.sidebarHandlers.get("progressReady")({ jobId: job.jobId });
  await running;
  assert.equal(generations().length, 1);
});

test("cancelling during expansion never launches the generation helper", async () => {
  const { plugin, running, job, generations } = waitingPlugin();
  await plugin.sidebarHandlers.get("cancel")();
  await running;
  assert.equal(generations().length, 0);
  plugin.sidebarHandlers.get("progressReady")({ jobId: job.jobId });
  assert.equal(generations().length, 0);
});

test("switching video during expansion invalidates the waiting generation", async () => {
  const { plugin, running, job, generations } = waitingPlugin();
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/next.mp4");
  await running;
  plugin.sidebarHandlers.get("progressReady")({ jobId: job.jobId });
  assert.equal(generations().length, 0);
});

function feedback({ reduced = false } = {}) {
  const timers = [];
  const receipts = [];
  let finish;
  const animation = {
    finished: new Promise((resolve) => {
      finish = resolve;
    }),
  };
  const summary = {
    getBoundingClientRect() {},
    getAnimations: () => [animation],
  };
  const element = () => ({
    hidden: false,
    textContent: "生成",
    classList: { add() {}, remove() {} },
    setAttribute() {},
    getBoundingClientRect() {},
  });
  const elements = Object.fromEntries(
    [
      "jobStatus",
      "jobElapsed",
      "jobAnnouncement",
      "jobMessage",
      "start",
      "progressDrawer",
      "progress",
    ].map((key) => [key, element()]),
  );
  elements.jobMessage.closest = () => summary;
  const window = {
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: (callback) => callback(),
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../sidebar-progress.js"), "utf8"),
    { window, document: {} },
  );
  const controller = window.createProgressFeedback(
    elements,
    () => "/video.mp4",
    (id) => receipts.push(id),
  );
  return {
    controller,
    receipts,
    finish,
    timers,
    reveal: () =>
      timers.find(({ delay }) => delay === (reduced ? 0 : 180)).callback(),
  };
}

test("drawer acknowledgement waits for the actual text animation, including slow frames", async () => {
  const f = feedback();
  f.controller.render({ jobId: "one", status: "running", message: "正在启动" });
  f.reveal();
  await new Promise(setImmediate);
  assert.deepEqual(f.receipts, []);
  f.finish();
  await new Promise(setImmediate);
  assert.deepEqual(f.receipts, ["one"]);
});

test("a cancelled drawer cannot acknowledge after its animation finishes", async () => {
  const f = feedback();
  f.controller.render({ jobId: "one", status: "running" });
  f.reveal();
  f.controller.render({ jobId: "one", status: "canceling" });
  f.finish();
  await new Promise(setImmediate);
  assert.deepEqual(f.receipts, []);
});

test("reduced motion acknowledges an expanded drawer without an animation wait", () => {
  const f = feedback({ reduced: true });
  f.controller.render({ jobId: "one", status: "running" });
  f.reveal();
  assert.deepEqual(f.receipts, ["one"]);
});
