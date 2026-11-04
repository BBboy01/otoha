const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createSubtitleExportController } = require("../subtitle-export-controller.js");

const mediaPath = "/Users/test/Anime episode.mkv";
const subtitlePath = "/library/Anime [en to zh-Hans].ass";
const helperPath = "/Applications/Otoha/bin/otoha-helper";
const libraryRootPath = "/library";

function setup({ chosenDirectory = "/Users/test/Exports", helperResult, onChoose, factory = createSubtitleExportController } = {}) {
  const results = [];
  const calls = [];
  let context = {
    helperPath,
    mediaPath,
    libraryRootPath,
    subtitles: [{ path: subtitlePath }],
  };
  const controller = factory({
    chooseDirectory: async () => {
      if (onChoose) onChoose((value) => { context = value; });
      return chosenDirectory;
    },
    exec: async (...args) => {
      calls.push(args);
      return helperResult || { status: 0, stdout: JSON.stringify({ path: `${chosenDirectory}/Anime episode [Bilingual].srt` }), stderr: "" };
    },
    getContext: () => context,
    onResult: (result) => results.push(result),
  });
  return { calls, controller, results, setContext(value) { context = value; } };
}

test("exports the selected ASS in the selected mode and reports the resulting path", async () => {
  const fixture = setup();
  await fixture.controller.export({ subtitlePath, mode: "bilingual" });

  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0][0], helperPath);
  assert.equal(fixture.calls[0][1][0], "--export-srt-json");
  assert.deepEqual(JSON.parse(fixture.calls[0][1][1]), {
    protocolVersion: 1,
    mediaPath,
    subtitlePath,
    libraryRootPath,
    destinationDirectoryPath: "/Users/test/Exports",
    mode: "bilingual",
  });
  assert.deepEqual(fixture.results.at(-1), {
    status: "success",
    path: "/Users/test/Exports/Anime episode [Bilingual].srt",
  });
});

test("exports in IINA JavaScriptCore without Node built-ins or a URL global", async () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../subtitle-export-controller.js"), "utf8"), {
    module,
    require: () => null,
  });
  const fixture = setup({ factory: module.exports.createSubtitleExportController });
  await fixture.controller.export({ subtitlePath, mode: "source" });
  assert.equal(fixture.results.at(-1).status, "success");
});

test("does not call the helper when the user cancels the directory picker", async () => {
  const fixture = setup({ chosenDirectory: null });
  await fixture.controller.export({ subtitlePath, mode: "source" });

  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.results.at(-1), { status: "cancelled" });
});

test("rejects a stale video or subtitle selection after the directory picker", async () => {
  const fixture = setup({
    onChoose(setContext) {
      setContext({ helperPath, mediaPath: "/Users/test/Next.mkv", libraryRootPath, subtitles: [{ path: subtitlePath }] });
    },
  });
  await fixture.controller.export({ subtitlePath, mode: "source" });

  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.results.at(-1).status, "error");
});

test("keeps helper failures actionable and rejects non-SRT result paths", async () => {
  const failed = setup({ helperResult: { status: 1, stdout: "", stderr: "permission denied" } });
  await failed.controller.export({ subtitlePath, mode: "translation" });
  assert.match(failed.results.at(-1).message, /permission denied/);

  const invalid = setup({ helperResult: { status: 0, stdout: JSON.stringify({ path: "/tmp/result.ass" }) } });
  await invalid.controller.export({ subtitlePath, mode: "translation" });
  assert.equal(invalid.results.at(-1).status, "error");
});

test("rejects output outside the selected directory including parent traversal", async () => {
  for (const path of ["/tmp/result.srt", "/Users/test/Exports/../result.srt"]) {
    const fixture = setup({ helperResult: { status: 0, stdout: JSON.stringify({ path }) } });
    await fixture.controller.export({ subtitlePath, mode: "source" });
    assert.equal(fixture.results.at(-1).status, "error");
  }
});

test("accepts a directory ending in a slash and the filesystem root", async () => {
  for (const chosenDirectory of ["/Users/test/Exports/", "/"]) {
    const fixture = setup({ chosenDirectory });
    await fixture.controller.export({ subtitlePath, mode: "source" });
    assert.equal(fixture.results.at(-1).status, "success");
  }
});
