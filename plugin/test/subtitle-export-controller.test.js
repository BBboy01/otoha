const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleExportController } = require("../subtitle-export-controller.js");

const mediaPath = "/Users/test/Anime episode.mkv";
const subtitlePath = "/library/Anime [en to zh-Hans].ass";
const helperPath = "/Applications/Otoha/bin/otoha-helper";
const libraryRootPath = "/library";

function setup({ chosenDirectory = "/Users/test/Exports", helperResult, onChoose } = {}) {
  const results = [];
  const calls = [];
  let context = {
    helperPath,
    mediaPath,
    libraryRootPath,
    subtitles: [{ path: subtitlePath }],
  };
  const controller = createSubtitleExportController({
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
