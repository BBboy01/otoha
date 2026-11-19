const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture() {
  const element = (hidden) => ({
    hidden,
    inert: false,
    style: {},
    animate() {
      assert.fail("screen navigation must not start animations");
    },
  });
  const home = element(false),
    editor = element(true),
    window = {};
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
  assert.equal(f.home.style.transform, undefined);
  assert.equal(f.editor.style.transform, undefined);
  f.navigate(false);
  assert.equal(f.home.hidden, false);
  assert.equal(f.home.inert, false);
  assert.equal(f.editor.hidden, true);
  assert.equal(f.editor.inert, true);
});

test("repeated navigation to the current screen is a no-op", () => {
  const f = fixture();
  f.navigate(true);
  assert.equal(f.home.hidden, true);
  assert.equal(f.editor.hidden, false);
  f.navigate(true);
  assert.equal(f.home.hidden, true);
  assert.equal(f.editor.hidden, false);
});
