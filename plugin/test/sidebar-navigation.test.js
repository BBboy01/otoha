const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(reduced = false) {
  const element = (hidden) => ({
    hidden,
    inert: false,
    style: {},
    animations: [],
    animate(frames, options) {
      let finish;
      const effect = {
        frames,
        options,
        finished: new Promise((resolve) => {
          finish = resolve;
        }),
        finish: () => finish(),
        cancel() {
          finish();
        },
      };
      this.animations.push(effect);
      return effect;
    },
  });
  const home = element(false),
    editor = element(true),
    window = {
      matchMedia: () => ({ matches: reduced }),
      getComputedStyle: (element) => ({
        transform: element.style.transform || "none",
        getPropertyValue: (name) =>
          ({
            "--otoha-motion-duration-expand": "200ms",
            "--otoha-motion-ease-editor": "ease-out",
          })[name],
      }),
    };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../sidebar-navigation.js"), "utf8"),
    { window },
  );
  return {
    home,
    editor,
    navigate: window.createSidebarNavigation(home, editor),
  };
}

test("navigation switches screens immediately without animation", () => {
  const f = fixture();
  f.navigate(true);
  assert.equal(f.home.hidden, true);
  assert.equal(f.home.inert, true);
  assert.equal(f.editor.hidden, false);
  assert.equal(f.home.animations.length, 0);
  assert.equal(f.editor.animations.length, 0);
  assert.equal(f.home.style.transform, undefined);
  assert.equal(f.editor.style.transform, undefined);
  f.navigate(false);
  assert.equal(f.home.hidden, false);
  assert.equal(f.home.inert, false);
  assert.equal(f.editor.hidden, true);
  assert.equal(f.editor.inert, true);
});

test("repeated navigation to the current screen is a no-op", () => {
  const f = fixture(true);
  f.navigate(true);
  assert.equal(f.home.hidden, true);
  assert.equal(f.editor.hidden, false);
  assert.equal(f.editor.animations.length, 0);
  f.navigate(true);
  assert.equal(f.home.hidden, true);
  assert.equal(f.editor.hidden, false);
});
