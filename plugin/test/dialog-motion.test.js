const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function fixture(reduced = false) {
  const listeners = {};
  const effects = [];
  const bounds = {
    x: 10,
    y: 100,
    left: 10,
    top: 100,
    right: 250,
    bottom: 300,
    width: 240,
    height: 200,
  };
  const style = {
    transform: "none",
    opacity: "1",
    borderRadius: "8px",
    getPropertyValue: (name) =>
      name.endsWith("duration-dialog") ? "360ms" : "ease-out",
  };
  const dialog = {
    open: false,
    dataset: {},
    inert: false,
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    getBoundingClientRect: () => bounds,
    animate(frames, options) {
      let finish;
      const effect = {
        frames,
        options,
        finished: new Promise((resolve) => {
          finish = resolve;
        }),
        cancel() {
          finish();
        },
        finish,
      };
      effects.push(effect);
      return effect;
    },
  };
  const trigger = {
    getBoundingClientRect: () => ({ x: 220, y: 40, width: 20, height: 20 }),
  };
  const window = {
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: () => style,
  };
  const filename = require.resolve("../dialog-motion.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    window,
    DOMMatrix: class {
      constructor(value) {
        const parts = value?.match(/[\d.-]+/g)?.map(Number) || [
          1, 0, 0, 1, 0, 0,
        ];
        [this.m11, , , this.m22, this.m41, this.m42] = parts;
      }
    },
  });
  let dismissed = 0;
  const motion = window.createDialogMotion(dialog, trigger, () => {
    dismissed++;
    motion.close();
  });
  return {
    motion,
    dialog,
    effects,
    listeners,
    bounds,
    style,
    dismissed: () => dismissed,
  };
}

function assertAnchored(frame) {
  const values = frame.transform.match(/[\d.-]+/g).map(Number);
  const [x, y, scaleX, scaleY] = values;
  assert.equal(10 + 240 / 2 + x, 230);
  assert.equal(100 + 200 / 2 + y, 50);
  assert.equal(240 * scaleX, 20);
  assert.equal(200 * scaleY, 20);
  assert.equal(frame.clipPath, undefined);
}

test("dialog opens from its trigger and stays modal until its closing animation ends", async () => {
  const f = fixture();
  f.motion.open();
  assert.equal(f.dialog.open, true);
  assertAnchored(f.effects[0].frames[0]);
  assert.match(f.effects[0].frames.at(-1).transform, /scale\(1,\s*1\)/);
  assert.equal(f.effects[0].options.fill, "both");
  const closing = f.motion.close();
  assert.equal(f.dialog.open, true);
  assert.equal(f.dialog.inert, true);
  assertAnchored(f.effects.at(-1).frames.at(-1));
  f.effects.at(-1).finish();
  await closing;
  assert.equal(f.dialog.open, false);
});

test("closing mid-expansion returns to the same button without applying scale twice", async () => {
  const f = fixture();
  f.motion.open();
  Object.assign(f.bounds, { x: 100, y: 130, width: 120, height: 100 });
  f.style.transform = "matrix(0.5, 0, 0, 0.5, 30, -20)";
  const closing = f.motion.close();
  assert.equal(f.effects.at(-1).frames[0].transform, f.style.transform);
  assertAnchored(f.effects.at(-1).frames.at(-1));
  f.effects.at(-1).finish();
  await closing;
  assert.equal(f.dialog.open, false);
});

test("only a pointer press and release both outside dismiss the dialog", () => {
  const f = fixture(true);
  const outside = { target: f.dialog, button: 0, clientX: 1, clientY: 1 };
  const inside = { ...outside, clientX: 50, clientY: 150 };
  f.motion.open();
  f.listeners.pointerdown(inside);
  f.listeners.click(outside);
  assert.equal(f.dismissed(), 0);
  f.listeners.pointerdown(outside);
  f.listeners.click(inside);
  assert.equal(f.dismissed(), 0);
  f.listeners.pointerdown(outside);
  f.listeners.click(outside);
  assert.equal(f.dismissed(), 1);
  assert.equal(f.dialog.open, false);
});

test("state changes can close immediately and reduced motion skips effects", async () => {
  const f = fixture();
  f.motion.open();
  await f.motion.close(true);
  assert.equal(f.dialog.open, false);
  const reduced = fixture(true);
  reduced.motion.open();
  await reduced.motion.close();
  assert.equal(reduced.effects.length, 0);
  assert.equal(reduced.dialog.open, false);
});
