const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");
const { createSidebar } = require("./sidebar-fixture");

test("initial language check still completes when automatic subtitle loading overtakes the UI message", async () => {
  let release;
  const subtitleLoadGate = new Promise((resolve) => {
    release = resolve;
  });
  const main = createPlugin({
    autoLoad: true,
    existingSubtitles: ["/library/custom.ass"],
    subtitleLoadGate,
  });
  const ui = createSidebar();
  main.runSidebarLoad();
  main.sidebarHandlers.get("ready")({ helperPath });
  const initial = main.messages.findLast(
    (message) => message.name === "state",
  ).payload;
  ui.handlers.get("state")(initial);
  const request = ui.posts.find((post) => post.name === "checkLanguages");
  assert.ok(request);
  await new Promise(setImmediate);
  try {
    await main.sidebarHandlers.get("checkLanguages")(request.payload);
    assert.equal(
      main.execCalls.filter((call) => call.args[0] === "--check-languages-json")
        .length,
      1,
    );
  } finally {
    release();
  }
  await new Promise(setImmediate);
  ui.handlers.get("state")(
    main.messages.findLast((message) => message.name === "state").payload,
  );
  assert.equal(ui.elements.get("#start-button").disabled, false);
});
