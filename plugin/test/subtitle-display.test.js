const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDisplayMode, renderSubtitleMode, SubtitleDisplayError } = require("../subtitle-display.js");

const bilingual = `[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: OtohaSource,Arial,28,&H80FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,1.25,0,2,32,32,24,1\nStyle: OtohaTranslation,Arial,36,&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,1.25,0,2,32,32,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,OtohaTranslation,,0,0,0,,译文,带逗号\\N第二行\nDialogue: 0,0:00:01.00,0:00:03.00,OtohaSource,,0,0,0,,原文{\\i1}\\N第二行\n`;

test("display mode normalization defaults unknown values to bilingual", () => {
  assert.equal(normalizeDisplayMode("source"), "source");
  assert.equal(normalizeDisplayMode("translation"), "translation");
  assert.equal(normalizeDisplayMode("bilingual"), "bilingual");
  assert.equal(normalizeDisplayMode("SOURCE"), "bilingual");
  assert.equal(normalizeDisplayMode(null), "bilingual");
});

test("bilingual projection returns the original ASS unchanged", () => {
  assert.equal(renderSubtitleMode(bilingual, "bilingual"), bilingual);
});

test("source projection keeps source events and uses the normal single-line style", () => {
  const output = renderSubtitleMode(bilingual, "source");
  assert.match(output, /Style: OtohaSingle,Arial,36,&H00FFFFFF/);
  assert.match(output, /Dialogue: 0,0:00:01\.00,0:00:03\.00,OtohaSingle,,0,0,0,,原文\{\\i1\}\\N第二行/);
  assert.doesNotMatch(output, /Dialogue: 0,0:00:01\.00,0:00:03\.00,OtohaSource/);
  assert.doesNotMatch(output, /OtohaTranslation,,0,0,0,,译文/);
});

test("translation projection keeps translation events and retains commas and line breaks", () => {
  const output = renderSubtitleMode(bilingual, "translation");
  assert.match(output, /Style: OtohaSingle,Arial,36,&H00FFFFFF/);
  assert.match(output, /Dialogue: 0,0:00:01\.00,0:00:03\.00,OtohaSingle,,0,0,0,,译文,带逗号\\N第二行/);
  assert.doesNotMatch(output, /OtohaSource,,0,0,0,,原文/);
});

test("projection rejects an ASS file without the Otoha styles or selected events", () => {
  assert.throws(() => renderSubtitleMode("[Events]\nFormat: Layer, Start, End, Style, Name, Text\n", "source"), SubtitleDisplayError);
  assert.throws(() => renderSubtitleMode(bilingual.replace(/OtohaSource/g, "Other"), "source"), SubtitleDisplayError);
  assert.throws(() => renderSubtitleMode(bilingual.replace(/OtohaTranslation/g, "Other"), "translation"), SubtitleDisplayError);
});
