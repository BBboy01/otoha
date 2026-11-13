const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleStyleRuntime } = require("../subtitle-style-runtime.js");

test("returning to player reapplies changed styles once and defers during editing", async () => {
  const values = {subtitle_style: JSON.stringify({font: "Menlo"})};
  let context = {path: "/sub.ass", loaded: true, busy: false};
  let focus;
  const loads = [];
  const runtime = createSubtitleStyleRuntime({preferences: {get: key => values[key]}, file: {}, utils: {},
    event: {on: (name, handler) => { assert.equal(name, "iina.window-main.changed"); focus = handler; }},
    getContext: () => context, reload: async path => { loads.push(path); }});
  focus(false);
  assert.deepEqual(loads, []);
  await runtime.refresh();
  await runtime.refresh();
  assert.deepEqual(loads, ["/sub.ass"]);
  values.subtitle_style = JSON.stringify({font: "Arial"});
  context.busy = true;
  await runtime.refresh();
  assert.equal(loads.length, 1);
  context.busy = false;
  focus(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads.length, 2);
  assert.equal(runtime.generationSettings().subtitleStyle.font, "Arial");
});

test("style helper requests use temporary files and clean up after failure", async () => {
  const files = new Map();
  const runtime = createSubtitleStyleRuntime({preferences: {get: () => ""},
    event: {on() {}}, getContext: () => ({helperPath: "/helper"}), reload() {},
    file: {write: (path, value) => files.set(path, value), delete: path => files.delete(path)},
    utils: {resolvePath: path => path.replace("@tmp", "/tmp"), exec: async () => ({status: 1, stderr: "invalid subtitle"})}});
  await assert.rejects(runtime.renderStyle("original", {}), /invalid subtitle/);
  assert.equal(files.size, 0);
});
