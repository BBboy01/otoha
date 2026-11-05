const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const helperPath = process.argv[2];
assert.ok(helperPath && fs.existsSync(helperPath), "pass the packaged otoha-helper executable path");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otoha-srt-package-test-"));
const mediaPath = "/tmp/Otoha SRT Export Test.mkv";
const mediaBase = path.basename(mediaPath, path.extname(mediaPath));
const mediaHash = crypto.createHash("sha256").update(mediaPath).digest("hex").slice(0, 16);
const libraryRootPath = path.join(fixtureRoot, "Library");
const mediaLibraryPath = path.join(libraryRootPath, `${mediaBase}-${mediaHash}`);
const subtitlePath = path.join(mediaLibraryPath, `${mediaBase} [en to zh-Hans].ass`);
const destinationDirectoryPath = path.join(fixtureRoot, "Exports");
const originalASS = [
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:01.23,0:00:02.00,OtohaTranslation,,0,0,0,,你好，世界",
  "Dialogue: 0,0:00:01.23,0:00:02.00,OtohaSource,,0,0,0,,<b>{\\i1}Hello, world{\\i0}</b>\\Nこんにちは",
  "",
].join("\n");

function invoke(request) {
  return spawnSync(helperPath, ["--export-srt-json", JSON.stringify(request)], { encoding: "utf8" });
}

try {
  fs.mkdirSync(mediaLibraryPath, { recursive: true });
  fs.mkdirSync(destinationDirectoryPath, { recursive: true });
  fs.writeFileSync(subtitlePath, originalASS, "utf8");
  const baseRequest = {
    protocolVersion: 1,
    mediaPath,
    subtitlePath,
    libraryRootPath,
    destinationDirectoryPath,
  };

  const expected = {
    source: "1\n00:00:01,230 --> 00:00:02,000\n&lt;b&gt;Hello, world&lt;/b&gt;\nこんにちは\n\n",
    translation: "1\n00:00:01,230 --> 00:00:02,000\n你好，世界\n\n",
    bilingual: "1\n00:00:01,230 --> 00:00:02,000\n&lt;b&gt;Hello, world&lt;/b&gt;\nこんにちは\n你好，世界\n\n",
  };
  for (const mode of Object.keys(expected)) {
    const result = invoke({ ...baseRequest, mode });
    assert.equal(result.status, 0, result.stderr || `export failed for mode ${mode}`);
    const outputPath = JSON.parse(result.stdout).path;
    assert.equal(path.dirname(outputPath), destinationDirectoryPath);
    assert.equal(path.extname(outputPath), ".srt");
    assert.equal(fs.readFileSync(outputPath, "utf8"), expected[mode]);
    const probe = spawnSync("ffprobe", [
      "-v", "error", "-f", "srt", "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1", outputPath,
    ], { encoding: "utf8" });
    if (probe.error?.code !== "ENOENT") {
      assert.equal(probe.status, 0, probe.stderr || `ffprobe rejected mode ${mode}`);
      assert.equal(probe.stdout.trim(), "subrip");
    }
  }

  const repeated = invoke({ ...baseRequest, mode: "source" });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(JSON.parse(repeated.stdout).path, /\[Source\] \(2\)\.srt$/);
  assert.equal(fs.readFileSync(subtitlePath, "utf8"), originalASS);

  const outsidePath = path.join(fixtureRoot, "outside.ass");
  fs.writeFileSync(outsidePath, originalASS, "utf8");
  const outside = invoke({ ...baseRequest, subtitlePath: outsidePath, mode: "source" });
  assert.notEqual(outside.status, 0);
  assert.match(outside.stderr, /不在当前视频的 Otoha 字幕库/);

  const invalidProtocol = invoke({ ...baseRequest, protocolVersion: 2, mode: "source" });
  assert.notEqual(invalidProtocol.status, 0);
  process.stdout.write("Packaged SRT export integration passed.\n");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
