const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStyle, readStyle } = require("../subtitle-style.js");

test("style validates preferences and migrates font and size", () => {
  assert.deepEqual(normalizeStyle({font: " Menlo ", scale: 1.2, color: "#ffcc00", background: true, dimSource: false}),
    {font: "Menlo", scale: 1.2, color: "#FFCC00", background: true, dimSource: false});
  assert.deepEqual(normalizeStyle({font: "Arial,42", scale: 9, color: "red"}),
    {font: "Arial", scale: 3, color: "#FFFFFF", background: false, dimSource: true});
  const values = {subtitle_font: "Songti SC", subtitle_scale: 120, subtitle_style: "{"};
  assert.equal(readStyle({get: key => values[key]}).font, "Songti SC");
  assert.equal(readStyle({get: key => values[key]}).scale, 1.2);
});

test("style accepts enlarged scale range and preserves precise percentages", () => {
  for (const scale of [0.5, 1.37, 2, 3]) assert.equal(normalizeStyle({scale}).scale, scale);
  assert.equal(normalizeStyle({scale: 0.1}).scale, 0.5);
});
