const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function fixture(reduced = false) {
  const listeners = {};
  const effects = [];
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
    getBoundingClientRect: () => ({
      x: 10,
      y: 100,
      left: 10,
      top: 100,
      right: 250,
      bottom: 300,
      width: 240,
      height: 200,
    }),
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
    getComputedStyle: () => ({
      transform: "none",
      clipPath: "none",
      opacity: "1",
      borderRadius: "8px",
      getPropertyValue: (name) =>
        name.endsWith("duration-dialog") ? "280ms" : "ease-out",
    }),
  };
  const filename = require.resolve("../dialog-motion.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    window,
    DOMMatrix: class {
      m41 = 0;
      m42 = 0;
    },
  });
  let dismissed = 0;
  const motion = window.createDialogMotion(dialog, trigger, () => {
    dismissed++;
    motion.close();
  });
  return { motion, dialog, effects, listeners, dismissed: () => dismissed };
}

test("dialog opens from its trigger and stays modal until its closing animation ends", async () => {
  const f = fixture();
  f.motion.open();
  assert.equal(f.dialog.open, true);
  assert.match(f.effects[0].frames[0].clipPath, /90px 110px/);
  assert.match(f.effects[0].frames[0].transform, /100px,-150px/);
  const closing = f.motion.close();
  assert.equal(f.dialog.open, true);
  assert.equal(f.dialog.inert, true);
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
