const test = require("node:test");
const assert = require("node:assert/strict");
const { createSidebarLifecycle } = require("../sidebar-lifecycle");

test("sidebar lifecycle retries before loading and preserves an explicit show request", () => {
  const timers = [];
  const actions = [];
  let loaded = false;
  let windowLoaded = false;
  const lifecycle = createSidebarLifecycle({
    isLoaded: () => loaded,
    isWindowLoaded: () => windowLoaded,
    load: (show) => actions.push(["load", show]),
    schedule(callback, delay) { timers.push({ callback, delay }); },
    delays: [10, 20],
    pageLoadDelay: 5,
  });

  lifecycle.initialize(true);
  assert.deepEqual(actions, []);
  assert.equal(timers[0].delay, 10);
  windowLoaded = true;
  timers.shift().callback();
  assert.equal(timers[0].delay, 5);
  timers.shift().callback();
  assert.deepEqual(actions, [["load", true]]);

  loaded = true;
  lifecycle.initialize();
  assert.equal(actions.length, 1);
});
