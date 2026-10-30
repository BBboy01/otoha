const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  audioTracks,
  createJsonLineParser,
  defaultLanguage,
  localMedia,
  resolveAudioStreamIndex,
} = require("../controller");

test("localMedia decodes local file URLs and rejects non-local media", () => {
  assert.deepEqual(localMedia("file:///Users/test/My%20video.mkv"), {
    path: "/Users/test/My video.mkv",
    name: "My video.mkv",
  });
  assert.throws(() => localMedia("https://example.com/video.mkv"), /本地文件/);
  assert.throws(() => localMedia("file://server/video.mkv"), /本地文件/);
});

test("localMedia works in IINA JavaScriptCore where URL is not defined", () => {
  const source = fs.readFileSync(path.join(__dirname, "../controller.js"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    decodeURIComponent,
    require(id) { return require(path.join(__dirname, "..", id)); },
  });

  const media = module.exports.localMedia("file:///Users/test/My%20video.mkv");
  assert.equal(media.path, "/Users/test/My video.mkv");
  assert.equal(media.name, "My video.mkv");
});

test("audioTracks maps IINA IDs to ff-index and marks unavailable streams", () => {
  const tracks = audioTracks([
    { type: "video", id: 1, "ff-index": 0 },
    { type: "audio", id: 3, "ff-index": 2, lang: "ja", title: "日本語" },
    { type: "audio", id: 4, lang: "en", title: "External", external: true },
    { type: "audio", id: 5, title: "No stream index" },
  ]);

  assert.deepEqual(tracks, [
    { id: 3, streamIndex: 2, lang: "ja", title: "日本語", available: true },
    { id: 4, streamIndex: null, lang: "en", title: "External", available: false },
    { id: 5, streamIndex: null, lang: "", title: "No stream index", available: false },
  ]);
  assert.equal(resolveAudioStreamIndex(tracks, 3), 2);
  assert.throws(() => resolveAudioStreamIndex(tracks, 4), /ff-index/);
  assert.throws(() => resolveAudioStreamIndex(tracks, 999), /音轨/);
});

test("defaultLanguage normalizes track metadata and preferred localizations", () => {
  assert.equal(defaultLanguage("zh-CN"), "zh-Hans");
  assert.equal(defaultLanguage("fr-CA"), "fr");
  assert.equal(defaultLanguage("JPN"), "ja");
  assert.equal(defaultLanguage("eng-US"), "en");
  assert.equal(defaultLanguage("zho-CN"), "zh-Hans");
  assert.equal(defaultLanguage(["zh-Hans-CN", "en-US"]), "zh-Hans");
  assert.equal(defaultLanguage("und"), "");
});

test("JSONL parser accepts split chunks and reports malformed records", () => {
  const events = [];
  const errors = [];
  const parser = createJsonLineParser((event) => events.push(event), (error) => errors.push(error));

  parser.push('{"protocolVersion":1,"type":"phase","jobId":"job-123","phase":"transcribing"}\n{"protocolVersion":1,"type":"com');
  parser.push('pleted","jobId":"job-123","path":"/tmp/a.ass"}\nnot json\n');
  parser.flush();

  assert.deepEqual(events, [
    { protocolVersion: 1, type: "phase", jobId: "job-123", phase: "transcribing" },
    { protocolVersion: 1, type: "completed", jobId: "job-123", path: "/tmp/a.ass" },
  ]);
  assert.equal(errors.length, 1);
});
