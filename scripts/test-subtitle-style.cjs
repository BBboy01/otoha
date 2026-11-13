const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const helper = process.argv[2];
assert.ok(helper, "Provide the packaged helper path");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "otoha-style-test-"));
const input = path.join(directory, "otoha-style-input-test.json");
const output = path.join(directory, "otoha-style-output-test.json");
const original = [
  "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 1", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: OtohaSource,Arial,38,&H50FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3.5,1.5,2,96,96,74,1",
  "Style: OtohaTranslation,Arial,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3.5,1.5,2,96,96,20,1", "",
  "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:00.00,0:01:00.00,OtohaTranslation,,0,0,0,,世界充满了微小的美好。字幕样式可以随时调整。",
  "Dialogue: 0,0:00:00.00,0:01:00.00,OtohaSource,,0,0,0,,The world is full of small wonders. 字幕のスタイルを調整できます。", "",
].join("\n");
try {
  const style = {font: "Menlo", scale: 1.4, color: "#FFE066", background: true, dimSource: true};
  fs.writeFileSync(input, JSON.stringify({content: original, style}));
  execFileSync(helper, ["--style-subtitle-file", input, output], {timeout: 30000});
  const result = fs.readFileSync(output, "utf8");
  assert.match(result, /Style: OtohaSource,Menlo,53,&H5066E0FF,/);
  assert.match(result, /Style: OtohaTranslation,Menlo,48,&H0066E0FF,/);
  assert.match(result, /Dialogue: 0,0:00:00.00,0:01:00.00,OtohaTranslation/);
  assert.match(result, /世界充满了微小的美好/);
  assert.equal(JSON.parse(fs.readFileSync(input, "utf8")).content, original);
  fs.writeFileSync(input, JSON.stringify({content: original, style: {...style, color: "bad"}}));
  const failed = spawnSync(helper, ["--style-subtitle-file", input, output], {timeout: 30000});
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(output, "utf8"), result);
  const outside = spawnSync(helper, ["--style-subtitle-file", input, "/tmp/unauthorized-style.json"], {timeout: 30000});
  assert.notEqual(outside.status, 0);
  console.log("Packaged subtitle style CLI passed: styling, original content, invalid color and output path validation.");
} finally { fs.rmSync(directory, {recursive: true, force: true}); }
