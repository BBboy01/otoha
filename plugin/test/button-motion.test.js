const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function fixture(width, { disabled = false, reduced = false, role = "" } = {}) {
  const listeners = new Map();
  const properties = new Map();
  const effects = [];
  const button = {
    offsetWidth: width,
    offsetHeight: 32,
    closest: () => button,
    matches: (selector) =>
      disabled || Boolean(role && selector.includes(`[role="${role}"]`)),
    style: { setProperty: (key, value) => properties.set(key, value) },
    animate(frames, options) {
      const effect = {
        frames,
        options,
        finished: Promise.resolve(),
        cancel() {},
      };
      effects.push(effect);
      return effect;
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../button-motion.js"), "utf8"),
    {
      document: {
        addEventListener: (name, listener) => listeners.set(name, listener),
      },
      window: {
        matchMedia: () => ({ matches: reduced, addEventListener() {} }),
        getComputedStyle: () => ({
          scale: "none",
          getPropertyValue: (name) =>
            properties.get(name) ||
            {
              "--otoha-motion-press-distance": "1px",
              "--otoha-motion-rebound-distance": "0.15px",
              "--otoha-motion-rebound-duration": "220ms",
              "--otoha-motion-press-ease": "ease-out",
            }[name] ||
            "",
        }),
      },
    },
  );
  return {
    button,
    effects,
    fire(name, key) {
      listeners.get(name)?.({ target: button, key });
    },
  };
}

test("button motion shrinks wide and compact buttons by the same single pixel", () => {
  for (const width of [20, 32, 400]) {
    const f = fixture(width);
    f.fire("pointerdown");
    f.fire("click");
    assert.equal(f.effects.length, 1);
    const [x, y] = f.effects[0].frames[1].scale.split(" ").map(Number);
    assert.ok(Math.abs(width * (1 - x) - 1) < 0.00001);
    assert.ok(Math.abs(32 * (1 - y) - 1) < 0.00001);
  }
});

test("disabled and reduced-motion buttons do not animate", () => {
  for (const options of [{ disabled: true }, { reduced: true }]) {
    const f = fixture(100, options);
    f.fire("click");
    assert.equal(f.effects.length, 0);
  }
});

test("selection controls do not receive command-button rebound", () => {
  for (const role of ["radio", "combobox", "option"]) {
    const f = fixture(100, { role });
    f.fire("click");
    assert.equal(f.effects.length, 0, role);
  }
});
