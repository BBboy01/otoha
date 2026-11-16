const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = new Map();
      this.dataset = {};
      this.attributes = {};
      this.value = "";
    }
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    }
    prepend(child) {
      child.parentElement = this;
      this.children.unshift(child);
    }
    replaceChildren() {
      this.children = [];
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(selector.split(",").includes(child.tagName) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
  }
  const window = { subtitleEditTools: require("../subtitle-edit-tools") };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../subtitle-edit-controls.js"),
      "utf8",
    ),
    { window, document: { createElement: (tag) => new Element(tag) } },
  );
  const container = new Element("div"),
    undoButton = new Element("button"),
    requests = [];
  const cues = [
    {
      id: "cue",
      origins: ["cue"],
      start: 1,
      end: 3,
      source: "Original",
      translation: "译文",
    },
    {
      id: "next",
      origins: ["next"],
      start: 3,
      end: 4,
      source: "Next",
      translation: "下一句",
    },
  ];
  let index = 0;
  const session = { snapshot: { revision: "a".repeat(64), cues, history: [] } };
  const controls = window.createSubtitleEditControls({
    container,
    undoButton,
    getCues: () => cues,
    getIndex: () => index,
    getSnapshot: () => session.snapshot,
    refreshPlayback: () => requests.push("refresh"),
    change() {},
    select() {},
    undo() {
      requests.push("undo");
    },
    loop() {},
    restore() {},
    restoreDraft() {},
    discardDraft() {},
  });
  controls.render({ session, undo: 0, disabled: false });
  const disclosure = container.children[0];
  const splitTime = disclosure
    .querySelectorAll("input")
    .find((input) => input.attributes["aria-label"] === "拆分时间（秒）");
  return {
    controls,
    disclosure,
    splitTime,
    undoButton,
    requests,
    render(state) {
      controls.render({ session, undo: 1, disabled: false, ...state });
    },
    selectCue(value) {
      index = value;
      controls.render({ session, undo: 0, disabled: false });
    },
    openSession(sessionId) {
      session.sessionId = sessionId;
      controls.render({ session, undo: 0, disabled: false });
    },
  };
}

test("opening correction tools refreshes split time once and preserves a subsequently edited value", () => {
  const f = fixture();
  f.disclosure.open = true;
  f.disclosure.listeners.get("toggle")?.();
  assert.deepEqual(f.requests, ["refresh"]);
  f.controls.updatePlayback({ position: 1.8 });
  assert.equal(f.splitTime.value, 1.8);
  f.controls.updatePlayback({ position: 2.1 });
  assert.equal(f.splitTime.value, 1.8);
  f.disclosure.listeners.get("toggle")();
  f.splitTime.value = "2.5";
  f.splitTime.listeners.get("input")?.();
  f.controls.updatePlayback({ position: 2.2 });
  assert.equal(f.splitTime.value, "2.5");
});

test("search and history selects provide distinct IDs for their custom controls", () => {
  const selects = fixture().disclosure.querySelectorAll("select");
  assert.equal(selects.length, 2);
  assert.ok(selects.every((select) => select.id));
  assert.equal(
    new Set(selects.map((select) => select.id)).size,
    selects.length,
  );
});

test("switching cues with tools open refreshes playback and uses a valid midpoint during asynchronous seeking", () => {
  const f = fixture();
  f.disclosure.open = true;
  f.disclosure.listeners.get("toggle")();
  f.controls.updatePlayback({ position: 1.8 });
  f.selectCue(1);
  assert.deepEqual(f.requests, ["refresh", "refresh"]);
  assert.equal(f.splitTime.value, 3.5);
  f.controls.updatePlayback({ position: 1.8 });
  assert.equal(f.splitTime.value, 3.5);
  f.selectCue(0);
  f.controls.updatePlayback({ position: 2.2 });
  assert.equal(f.splitTime.value, 2.2);
});

test("header undo stays usable with tools collapsed and respects editor locks", () => {
  const f = fixture();
  f.disclosure.open = false;
  assert.equal(f.undoButton.disabled, true);
  f.render({ undo: 1 });
  assert.equal(f.undoButton.disabled, false);
  f.undoButton.listeners.get("click")();
  assert.deepEqual(f.requests, ["undo"]);
  for (const state of [
    { undo: 0 },
    { disabled: true },
    { unresolvedDraft: true },
  ]) {
    f.render(state);
    assert.equal(f.undoButton.disabled, true);
    f.undoButton.listeners.get("click")();
  }
  assert.deepEqual(f.requests, ["undo"]);
});

test("a new correction session starts collapsed without collapsing tools during editing", () => {
  const f = fixture();
  f.openSession("first");
  assert.equal(Boolean(f.disclosure.open), false);
  f.disclosure.open = true;
  f.render();
  assert.equal(f.disclosure.open, true);
  f.selectCue(1);
  assert.equal(f.disclosure.open, true);
  f.openSession("second");
  assert.equal(f.disclosure.open, false);
});
