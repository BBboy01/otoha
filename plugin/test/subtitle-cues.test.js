const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function fixture(reduced = false) {
  class Element {
    constructor() {
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.attributeWrites = 0;
      this.dataset = {};
      this.style = {
        setProperty: (name, value) => {
          this.style[name] = value;
        },
      };
      this.classList = { toggle() {} };
      this.offsetHeight = 80;
      this.clientHeight = 240;
      this.animations = [];
      this.textContent = "";
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
    setAttribute(name, value) {
      this.attributeWrites++;
      this.attributes[name] = value;
    }
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    }
    focus(options) {
      this.focused = true;
      this.focusOptions = options;
    }
    remove() {}
    animate(frames, options) {
      const animation = {
        frames,
        options,
        finished: Promise.resolve(),
        cancel() {
          this.cancelled = true;
        },
      };
      this.animations.push(animation);
      return animation;
    }
  }
  const viewport = new Element(),
    count = new Element(),
    selected = [],
    seeks = [];
  const window = {
    createSubtitlePreviewQueue: () => ({
      update: (element, value) => {
        element.textContent = value;
      },
      flush() {},
      clear() {},
    }),
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: () => ({
      transform: "none",
      getPropertyValue: (name) =>
        ({
          "--otoha-cue-height": "80px",
          "--otoha-motion-cue-duration": "440ms",
          "--otoha-motion-cue-ease": "cubic-bezier(.25,.1,.25,1)",
        })[name] || "",
    }),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../subtitle-cues.js"), "utf8"),
    {
      window,
      document: { createElement: () => new Element() },
    },
  );
  const list = window.createSubtitleCueList({
    viewport,
    count,
    onSelect: (i) => selected.push(i),
    onSeek: (i) => seeks.push(i),
  });
  const cues = Array.from({ length: 6 }, (_, i) => ({
    start: i * 4,
    source: `Source ${i}`,
    translation: `译文 ${i}`,
  }));
  list.replace(cues, cues, cues);
  list.select(0, false);
  const track = viewport.children.find(
    (node) => node.className === "cue-track",
  );
  return { list, viewport, count, track, selected, seeks, cues };
}

test("cue list shows bilingual text and clamps its viewport at both ends", () => {
  const f = fixture();
  assert.equal(f.track.children.length, 6);
  assert.equal(f.track.children[0].children[1].textContent, "Source 0");
  assert.equal(f.track.children[0].children[2].textContent, "译文 0");
  assert.equal(f.track.style.transform, "translateY(0px)");
  f.list.select(5, true);
  assert.equal(f.track.style.transform, "translateY(-240px)");
  assert.equal(f.track.children[5].attributes["aria-selected"], "true");
  assert.equal(f.track.children[5].tabIndex, 0);
});

test("cue navigation updates selection only on the outgoing and incoming rows", () => {
  const f = fixture();
  const untouched = f.track.children[4];
  const before = untouched.attributeWrites;
  f.list.select(1, true);
  assert.equal(untouched.attributeWrites, before);
  assert.equal(f.track.children[0].attributes["aria-selected"], "false");
  assert.equal(f.track.children[1].attributes["aria-selected"], "true");
});

test("keyboard selection does not scroll the transformed cue viewport", () => {
  const f = fixture();
  f.viewport.listeners.keydown({ key: "End", preventDefault() {} });
  assert.equal(f.track.children.at(-1).focusOptions?.preventScroll, true);
});

test("single-click selects, double-click seeks, and keyboard boundaries do not wrap", () => {
  const f = fixture();
  f.list.setFollow(false);
  f.track.children[2].listeners.click();
  assert.deepEqual(f.selected, [2]);
  assert.deepEqual(f.seeks, []);
  f.track.children[2].listeners.dblclick();
  assert.deepEqual(f.seeks, [2]);
  f.viewport.listeners.keydown({ key: "ArrowUp", preventDefault() {} });
  assert.deepEqual(f.selected, [2]);
  f.list.setDisabled(true);
  f.track.children[3].listeners.click();
  assert.deepEqual(f.selected, [2]);
});

test("changing dirty state preserves a cue's reserved marker and text is never parsed as HTML", () => {
  const f = fixture(true),
    row = f.track.children[0],
    marker = row.children[0].children[1];
  f.list.update(
    0,
    { source: "<img onerror=alert(1)>", translation: "新译文" },
    true,
  );
  assert.equal(row.children[0].children[1], marker);
  assert.equal(marker.hidden, false);
  assert.equal(row.children[1].textContent, "<img onerror=alert(1)>");
  f.list.update(0, f.cues[0], false);
  assert.equal(marker.hidden, true);
  f.list.select(1, true);
  assert.equal(f.track.animations.length, 0);
});
