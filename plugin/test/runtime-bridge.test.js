const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin } = require("./main-fixture");
const { createSidebar } = require("./sidebar-fixture");

const tick = () => new Promise(setImmediate);
const copy = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

async function connect(options) {
  let sidebar;
  const requests = [];
  const errors = [];
  const plugin = createPlugin({
    ...options,
    onSidebarMessage(name, payload) {
      queueMicrotask(() => sidebar.handlers.get(name)?.(copy(payload)));
    },
  });
  plugin.runSidebarLoad();
  sidebar = createSidebar(undefined, {
    onPostMessage(name, payload) {
      queueMicrotask(() => {
        try {
          const result = plugin.sidebarHandlers.get(name)?.(copy(payload));
          if (result?.then)
            requests.push(result.catch((error) => errors.push(error)));
        } catch (error) {
          errors.push(error);
        }
      });
    },
  });
  await tick();
  assert.deepEqual(errors, []);
  return { plugin, sidebar, requests, errors };
}

test("real main-to-sidebar messages disable loading controls and release them on completion", async () => {
  let release;
  const subtitle = "/library/video [en to zh-Hans].ass";
  const { sidebar, plugin, requests, errors } = await connect({
    existingSubtitles: [subtitle],
    subtitleLoadGate: new Promise((resolve) => {
      release = resolve;
    }),
  });
  const element = (id) => sidebar.elements.get(id);
  assert.equal(element("#edit-subtitle-button").disabled, false);
  element("#subtitle-choice").listeners.get("change")();
  await tick();
  try {
    for (const id of [
      "#edit-subtitle-button",
      "#delete-button",
      "#export-button",
      "#subtitle-choice",
    ])
      assert.equal(element(id).disabled, true, id);
    assert.ok(sidebar.displayModes.every((radio) => radio.disabled));
    assert.equal(
      plugin.messages.findLast((message) => message.name === "state").payload
        .generationJob.status,
      "idle",
    );
  } finally {
    release();
    await Promise.all(requests);
    await tick();
  }
  assert.deepEqual(errors, []);
  assert.equal(element("#edit-subtitle-button").disabled, false);
  assert.equal(element("#subtitle-loaded").hidden, false);
});

test("a library failure cannot replace transcription feedback across the message bridge", async () => {
  const { sidebar, plugin, requests, errors } = await connect({
    waitForCancel: true,
    helperTerminal: "cancelled",
    failedListingPath: "/broken",
  });
  const element = (id) => sidebar.elements.get(id);
  assert.equal(element("#start-button").disabled, false);
  element("#job-form").listeners.get("submit")({ preventDefault() {} });
  await tick();
  try {
    assert.equal(element("#job-message").textContent, "正在转录");
    plugin.preferenceValues.output_directory = "/broken";
    plugin.sidebarHandlers.get("refresh")();
    await tick();
    assert.equal(element("#job-message").textContent, "正在转录");
    assert.equal(element("#cancel-button").hidden, false);
    assert.equal(element("#start-button").disabled, true);
  } finally {
    element("#cancel-button").listeners.get("click")();
    await tick();
    await Promise.all(requests);
    await tick();
  }
  assert.deepEqual(errors, []);
  assert.equal(
    plugin.messages.findLast((message) => message.name === "state").payload
      .jobActive,
    false,
  );
});

test("a late load completion does not revive the previous video in the sidebar", async () => {
  let release;
  const files = ["/library/video [en to zh-Hans].ass"];
  const { sidebar, plugin, requests, errors } = await connect({
    existingSubtitles: files,
    subtitleLoadGate: new Promise((resolve) => {
      release = resolve;
    }),
  });
  sidebar.elements.get("#subtitle-choice").listeners.get("change")();
  await tick();
  files.length = 0;
  plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/Next.mp4");
  await tick();
  release();
  await Promise.all(requests);
  await tick();
  assert.deepEqual(errors, []);
  assert.equal(sidebar.elements.get("#subtitle-loaded").hidden, true);
  assert.equal(sidebar.elements.get("#existing-subtitles").hidden, true);
  assert.equal(sidebar.elements.get("#retry-button").hidden, true);
});

for (const helperTerminal of ["cancelled", "error"]) {
  test(`switching media releases a generation ending with ${helperTerminal}`, async () => {
    const { sidebar, plugin, requests, errors } = await connect({
      waitForCancel: true,
      helperTerminal,
    });
    sidebar.elements.get("#job-form").listeners.get("submit")({
      preventDefault() {},
    });
    await tick();
    plugin.eventHandlers.get("iina.file-loaded")("file:///Users/test/Next.mp4");
    await Promise.all(requests);
    await tick();
    const state = plugin.messages.findLast(
      (message) => message.name === "state",
    ).payload;
    assert.deepEqual(errors, []);
    assert.equal(state.jobActive, false);
    assert.equal(state.generationJob.status, "idle");
    assert.equal(sidebar.elements.get("#start-button").disabled, false);
    assert.equal(sidebar.elements.get("#cancel-button").hidden, true);
  });
}
