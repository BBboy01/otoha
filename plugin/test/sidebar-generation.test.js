const test = require("node:test");
const assert = require("node:assert/strict");
const { createSidebar, videoState } = require("./sidebar-fixture.js");

test("source-only selection restricts display and export to original text", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({
    displayMode: "source",
    availableSubtitles: [{ path: "/library/video [ja].ass", sourceLanguage: "ja", targetLanguage: "", mode: "source" }],
  }));
  assert.equal(sidebar.exportModes.find(radio => radio.value === "source").checked, true);
  assert.equal(sidebar.exportModes.find(radio => radio.value === "translation").disabled, true);
  assert.equal(sidebar.displayModes.find(radio => radio.value === "bilingual").disabled, true);
});
