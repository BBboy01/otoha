const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const helper = process.argv[2];
if (!helper) throw new Error("Pass the packaged helper executable.");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "otoha-workflows-"));
const library = path.join(root, "library");
const mediaPath = path.join(root, "synthetic.mp4");
const hash = crypto
  .createHash("sha256")
  .update(mediaPath)
  .digest("hex")
  .slice(0, 16);
const directory = path.join(library, `synthetic-${hash}`);
const subtitlePath = path.join(directory, "synthetic [en].ass");
const content = `[Script Info]
; OtohaMode: source
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 1
[V4+ Styles]
Format: Name, Fontname, Fontsize, MarginL, MarginR
Style: OtohaSource,Arial,38,96,96
Style: OtohaTranslation,Arial,34,96,96
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, Text
Dialogue: 0,0:00:01.00,0:00:03.00,OtohaSource,,0,0,Self-authored subtitle
`;
let sequence = 0;
function call(command, extra = {}) {
  const request = {
    protocolVersion: 1,
    requestId: `workflow-${++sequence}`,
    mediaPath,
    subtitlePath,
    outputDirectoryPath: library,
    ...extra,
  };
  let argument = JSON.stringify(request),
    temporary;
  try {
    if (command === "--save-subtitle-file") {
      temporary = path.join(root, `otoha-edit-${sequence}.json`);
      fs.writeFileSync(temporary, argument, { mode: 0o600 });
      argument = temporary;
    }
    const result = spawnSync(helper, [command, argument], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const response = JSON.parse(result.stdout);
    assert.equal(response.code, undefined, JSON.stringify(response));
    if (command !== "--export-srt-json")
      assert.equal(response.requestId, request.requestId);
    return response;
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
  }
}
try {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(mediaPath, "synthetic smoke fixture");
  fs.writeFileSync(subtitlePath, content);
  const listing = () =>
    JSON.parse(
      spawnSync(
        helper,
        [
          "--list-subtitles-json",
          JSON.stringify({ mediaPath, outputDirectoryPath: library }),
        ],
        { encoding: "utf8", timeout: 15000 },
      ).stdout,
    );
  assert.equal(
    listing().files.find((file) => file.path === subtitlePath).mode,
    "source",
  );
  const bilingualPath = path.join(directory, "synthetic [fr to ja].ass");
  const bilingual = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, MarginL, MarginR\nStyle: OtohaSource,Arial,38,96,96\nStyle: OtohaTranslation,Arial,34,96,96\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, Text\nDialogue: 0,0:00:01.00,0:00:03.00,OtohaSource,,0,0,Hello\nDialogue: 0,0:00:01.00,0:00:03.00,OtohaTranslation,,0,0,こんにちは\n`;
  fs.writeFileSync(bilingualPath, bilingual);
  assert.equal(
    listing().files.find((file) => file.path === bilingualPath).mode,
    "bilingual",
  );
  const initial = call("--read-subtitle-json").snapshot;
  assert.equal(initial.mode, "source");
  const first = initial.cues[0];
  const cues = [
    { ...first, id: "split-a", end: 2, source: "Self-authored" },
    { ...first, id: "split-b", start: 2, source: "subtitle" },
  ];
  call("--save-subtitle-file", {
    action: "draft",
    draft: { revision: initial.revision, cues, index: 1, scrollTop: 40 },
  });
  const reopened = call("--read-subtitle-json").snapshot;
  assert.equal(reopened.draft.cues.length, 2);
  assert.equal(reopened.draft.index, 1);
  assert.equal(fs.readFileSync(subtitlePath, "utf8"), content);
  const saved = call("--save-subtitle-file", {
    revision: initial.revision,
    cues,
  }).snapshot;
  assert.equal(saved.cues.length, 2);
  assert.equal(saved.draft, undefined);
  assert.equal(saved.history.length, 1);
  const restored = call("--save-subtitle-file", {
    action: "restore",
    revision: saved.revision,
    backupID: saved.history[0].id,
  }).snapshot;
  assert.equal(restored.cues.length, 1);
  assert.equal(restored.history.length, 2);
  assert.equal(fs.readFileSync(subtitlePath, "utf8"), content);
  const browse = call("--browse-subtitles-json");
  assert.ok(browse.entries.some((entry) => entry.path === directory));
  const files = call("--browse-subtitles-json", { directoryPath: directory });
  assert.ok(files.entries.some((entry) => entry.path === subtitlePath));
  const renamedMedia = path.join(root, "renamed.mp4");
  const copied = call("--associate-subtitle-json", {
    mediaPath: renamedMedia,
  }).path;
  assert.notEqual(fs.statSync(copied).ino, fs.statSync(subtitlePath).ino);
  assert.equal(fs.readFileSync(copied, "utf8"), content);
  const copiedAgain = call("--associate-subtitle-json", {
    mediaPath: renamedMedia,
  }).path;
  assert.notEqual(copiedAgain, copied);
  const exported = call("--export-srt-json", {
    libraryRootPath: library,
    destinationDirectoryPath: path.join(library, "Exports"),
    mode: "source",
  });
  assert.match(
    fs.readFileSync(exported.path, "utf8"),
    /Self-authored subtitle/,
  );
  call("--delete-subtitle-json");
  assert.equal(fs.existsSync(subtitlePath), false);
  assert.equal(
    fs
      .readdirSync(directory)
      .some((name) => name.startsWith(".otoha-history-")),
    false,
  );
  assert.equal(fs.existsSync(copied), true);
  console.log(
    "Packaged workflows passed: source-only, persistent draft, split save, backup restore, association copy, export and deletion cleanup.",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
