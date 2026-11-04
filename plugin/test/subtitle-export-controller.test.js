const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createSubtitleExportController } = require("../subtitle-export-controller.js");

const mediaPath = "/Users/test/Anime episode.mkv";
const subtitlePath = "/library/Anime [en to zh-Hans].ass";
const helperPath = "/Applications/Otoha/bin/otoha-helper";
const libraryRootPath = "/library";

function setup({ helperResult, onExec, factory = createSubtitleExportController, root = libraryRootPath } = {}) {
  const results = [];
  const calls = [];
  let context = { helperPath, mediaPath, libraryRootPath: root, subtitles: [{ path: subtitlePath }] };
  const controller = factory({
    chooseDirectory() { throw new Error("IINA's native picker must not be used"); },
    exec: async (...args) => {
      calls.push(args);
      if (onExec) await onExec((value) => { context = value; });
      const request = JSON.parse(args[1][1]);
      return helperResult || {
        status: 0,
        stdout: JSON.stringify({ path: `${request.destinationDirectoryPath}/Anime episode [Bilingual].srt` }),
        stderr: "",
      };
    },
    getContext: () => context,
    onResult: (result) => results.push(result),
  });
  return { calls, controller, results, setContext(value) { context = value; } };
}

test("exports into the Otoha Exports directory without opening IINA's native picker", async () => {
  const fixture = setup();
  await fixture.controller.export({ subtitlePath, mode: "bilingual" });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0][0], helperPath);
  assert.equal(fixture.calls[0][1][0], "--export-srt-json");
  assert.deepEqual(JSON.parse(fixture.calls[0][1][1]), {
    protocolVersion: 1, mediaPath, subtitlePath, libraryRootPath,
    destinationDirectoryPath: "/library/Exports", mode: "bilingual",
  });
  assert.deepEqual(fixture.results.at(-1), {
    status: "success", path: "/library/Exports/Anime episode [Bilingual].srt",
  });
});

test("exports in IINA JavaScriptCore without Node built-ins or a URL global", async () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../subtitle-export-controller.js"), "utf8"), {
    module, require: () => null,
  });
  const fixture = setup({ factory: module.exports.createSubtitleExportController });
  await fixture.controller.export({ subtitlePath, mode: "source" });
  assert.equal(fixture.results.at(-1).status, "success");
});

test("rejects invalid contexts before calling the helper", async () => {
  const fixture = setup();
  fixture.setContext({ helperPath, mediaPath, libraryRootPath: "", subtitles: [] });
  await fixture.controller.export({ subtitlePath, mode: "source" });
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.results.at(-1).status, "error");
});

test("does not display a completed export in a different video's sidebar", async () => {
  const fixture = setup({
    onExec(setContext) {
      setContext({ helperPath, mediaPath: "/Users/test/Next.mkv", libraryRootPath, subtitles: [] });
    },
  });
  await fixture.controller.export({ subtitlePath, mode: "source" });
  assert.deepEqual(fixture.results, [{ status: "running" }]);
});

test("keeps helper errors actionable and allows retry", async () => {
  const fixture = setup({ helperResult: { status: 1, stdout: "", stderr: "permission denied" } });
  await fixture.controller.export({ subtitlePath, mode: "translation" });
  assert.match(fixture.results.at(-1).message, /permission denied/);
  await fixture.controller.export({ subtitlePath, mode: "translation" });
  assert.equal(fixture.calls.length, 2);
});

test("settles export feedback while the same video's subtitle list is refreshing", async () => {
  const fixture = setup({
    onExec(setContext) {
      setContext({ helperPath, mediaPath, libraryRootPath, subtitles: [] });
    },
  });
  await fixture.controller.export({ subtitlePath, mode: "source" });
  assert.equal(fixture.results.at(-1).status, "success");
});

test("rejects non-SRT paths, output outside Exports and parent traversal", async () => {
  for (const path of ["/library/Exports/result.ass", "/tmp/result.srt", "/library/Exports/../result.srt"]) {
    const fixture = setup({ helperResult: { status: 0, stdout: JSON.stringify({ path }) } });
    await fixture.controller.export({ subtitlePath, mode: "source" });
    assert.equal(fixture.results.at(-1).status, "error");
  }
});

test("normalizes library roots ending in a slash and the filesystem root", async () => {
  for (const root of ["/library/", "/"]) {
    const fixture = setup({ root });
    await fixture.controller.export({ subtitlePath, mode: "source" });
    assert.equal(fixture.results.at(-1).status, "success");
    const destination = JSON.parse(fixture.calls[0][1][1]).destinationDirectoryPath;
    assert.equal(destination, root === "/" ? "/Exports" : "/library/Exports");
  }
});
