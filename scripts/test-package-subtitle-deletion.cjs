const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const helper = process.argv[2];
assert.ok(helper && fs.existsSync(helper), "pass the packaged otoha-helper executable path");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "otoha-delete-"));
try {
  const mediaPath = path.join(fixture, "self-authored-video.mp4");
  const root = path.join(fixture, "custom subtitle library");
  const digest = createHash("sha256").update(mediaPath).digest("hex").slice(0, 16);
  const directory = path.join(root, `self-authored-video-${digest}`);
  const selected = path.join(directory, "self-authored-video [en to ja].ass");
  const other = path.join(directory, "self-authored-video [en to zh-Hans].ass");
  fs.writeFileSync(mediaPath, "synthetic media");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(selected, "selected subtitle");
  fs.writeFileSync(other, "other subtitle");
  const run = (subtitlePath) => spawnSync(helper, ["--delete-subtitle-json", JSON.stringify({
    protocolVersion: 1, requestId: "package-delete-test", mediaPath, subtitlePath, outputDirectoryPath: root,
  })], { encoding: "utf8" });
  const success = run(selected);
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), { protocolVersion: 1, requestId: "package-delete-test", path: selected });
  assert.equal(fs.existsSync(selected), false);
  assert.equal(fs.readFileSync(other, "utf8"), "other subtitle");
  assert.equal(fs.readFileSync(mediaPath, "utf8"), "synthetic media");
  const rejected = run(mediaPath);
  const response = JSON.parse(rejected.stdout);
  assert.equal(response.code, "subtitle.deleteOutsideLibrary");
  assert.equal(fs.readFileSync(mediaPath, "utf8"), "synthetic media");
  const linked = path.join(directory, "self-authored-video [en to fr].ass");
  fs.symlinkSync(mediaPath, linked);
  assert.equal(JSON.parse(run(linked).stdout).code, "subtitle.deleteOutsideLibrary");
  assert.equal(fs.readFileSync(mediaPath, "utf8"), "synthetic media");
  assert.equal(JSON.parse(run(selected).stdout).code, "subtitle.deleteMissing");
  if (process.getuid?.() !== 0) {
    fs.chmodSync(directory, 0o500);
    assert.equal(JSON.parse(run(other).stdout).code, "subtitle.deleteFailed");
    assert.equal(fs.readFileSync(other, "utf8"), "other subtitle");
    fs.chmodSync(directory, 0o700);
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
