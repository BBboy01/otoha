const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const binary = process.argv[2];
if (!binary) throw new Error("Pass the packaged otoha-helper executable path.");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "otoha-edit-smoke-"));
const mediaPath = path.join(root, "synthetic.mp4");
const library = path.join(root, "library");
const hash = crypto
  .createHash("sha256")
  .update(mediaPath)
  .digest("hex")
  .slice(0, 16);
const directory = path.join(library, `synthetic-${hash}`);
const subtitlePath = path.join(directory, "synthetic [en to ja].ass");
const content = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 1\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, MarginL, MarginR\nStyle: OtohaSource,Arial,38,96,96\nStyle: OtohaTranslation,Arial,34,96,96\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, Text\nDialogue: 0,0:00:01.00,0:00:03.00,OtohaTranslation,,0,0,自作の字幕です。\nDialogue: 0,0:00:01.00,0:00:03.00,OtohaSource,,0,0,Self-authored fixture, not user media\n`;
let sequence = 0;
const request = (extra) => ({
  protocolVersion: 1,
  requestId: `fixture-${++sequence}`,
  mediaPath,
  subtitlePath,
  outputDirectoryPath: library,
  ...extra,
});
function run(command, input) {
  let argument = JSON.stringify(input);
  let temporary;
  try {
    if (command === "--save-subtitle-file") {
      temporary = path.join(root, `otoha-edit-${sequence}.json`);
      fs.writeFileSync(temporary, argument, { mode: 0o600 });
      argument = temporary;
    }
    const result = spawnSync(binary, [command, argument], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const response = JSON.parse(result.stdout);
    assert.equal(response.protocolVersion, 1);
    assert.equal(response.requestId, input.requestId);
    return response;
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
  }
}
try {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(mediaPath, "synthetic CLI fixture");
  fs.writeFileSync(subtitlePath, content);
  const listing = spawnSync(
    binary,
    [
      "--list-subtitles-json",
      JSON.stringify({ mediaPath, outputDirectoryPath: library }),
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    JSON.parse(listing.stdout).files[0]?.path,
    subtitlePath,
    listing.stdout,
  );
  const read = run("--read-subtitle-json", request());
  assert.ok(
    read.snapshot,
    JSON.stringify({ read, root, listing: listing.stdout }),
  );
  const original = read.snapshot;
  assert.equal(original.cues[0].start, 1);
  assert.equal(
    original.cues[0].source,
    "Self-authored fixture, not user media",
  );
  const large = "Self-authored synthetic sentence. ".repeat(10000);
  const saved = run(
    "--save-subtitle-file",
    request({
      revision: original.revision,
      texts: [{ source: large, translation: "自作の修正版\n显式换行" }],
    }),
  ).snapshot;
  assert.equal(saved.cues[0].source, large);
  assert.equal(saved.cues[0].translation, "自作の修正版\n显式换行");
  assert.equal(
    saved.revision,
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(subtitlePath))
      .digest("hex"),
  );
  const bytes = fs.readFileSync(subtitlePath);
  assert.equal(
    run(
      "--save-subtitle-file",
      request({
        revision: original.revision,
        texts: [{ source: "Stale", translation: "过期" }],
      }),
    ).code,
    "subtitle.editConflict",
  );
  assert.deepEqual(fs.readFileSync(subtitlePath), bytes);
  assert.equal(
    run("--read-subtitle-json", request({ protocolVersion: 9 })).code,
    "helper.invalidRequest",
  );
  assert.equal(
    run("--read-subtitle-json", request({ subtitlePath: mediaPath })).code,
    "subtitle.editOutsideLibrary",
  );
  const link = path.join(directory, "synthetic [ja to en].ass");
  fs.symlinkSync(mediaPath, link);
  assert.equal(
    run("--read-subtitle-json", request({ subtitlePath: link })).code,
    "subtitle.editOutsideLibrary",
  );
  fs.chmodSync(directory, 0o500);
  const denied = run(
    "--save-subtitle-file",
    request({
      revision: saved.revision,
      texts: [{ source: "Denied", translation: "不可写" }],
    }),
  );
  assert.equal(denied.code, "subtitle.publishFailed");
  assert.deepEqual(fs.readFileSync(subtitlePath), bytes);
  fs.chmodSync(directory, 0o700);
  assert.equal(
    fs.readdirSync(directory).some((name) => name.endsWith(".tmp")),
    false,
  );
  console.log(
    "Packaged subtitle editing passed: large request, actual save, conflict, permission failure, path and symlink guards.",
  );
} finally {
  if (fs.existsSync(directory)) fs.chmodSync(directory, 0o700);
  fs.rmSync(root, { recursive: true, force: true });
}
