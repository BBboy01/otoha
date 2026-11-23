const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { fixture } = require("../plugin/test/subtitle-editor-fixture");

const reference = process.argv[2];
const editorSource = reference
  ? execFileSync("git", ["show", `${reference}:plugin/subtitle-editor.js`], {
      encoding: "utf8",
    })
  : undefined;
const cues = Array.from({ length: 5000 }, (_, index) => ({
  id: `cue-${index}`,
  start: index * 3,
  end: index * 3 + 2,
  source: `Self-authored benchmark subtitle ${index}.`,
  translation: `自编基准字幕 ${index}。`,
}));
const samples = [];
for (let run = 0; run < 7; run++) {
  const f = fixture(false, { editorSource });
  f.emit("ready", { snapshot: { ...f.snapshot, cues } });
  f.serialization.arrays = f.serialization.cues = 0;
  const measure = (action) => {
    const start = performance.now();
    action();
    return +(performance.now() - start).toFixed(2);
  };
  const inputMs = measure(() => {
    for (let index = 0; index < 50; index++) f.input("source", `Edit ${index}`);
  });
  const renderMs = measure(() => {
    for (let index = 0; index < 50; index++) {
      f.onState("/synthetic.mp4");
      f.node("fields").listeners.get("scroll")();
    }
  });
  const draftMs = measure(() => f.flushDraft());
  samples.push({
    inputMs,
    renderMs,
    draftMs,
    serializedCues: f.serialization.cues,
  });
}
const median = (key) =>
  samples.map((sample) => sample[key]).sort((a, b) => a - b)[3];
console.log(
  JSON.stringify(
    {
      reference: reference || "working tree",
      cues: cues.length,
      runs: samples.length,
      median: Object.fromEntries(
        Object.keys(samples[0]).map((key) => [key, median(key)]),
      ),
      samples,
    },
    null,
    2,
  ),
);
