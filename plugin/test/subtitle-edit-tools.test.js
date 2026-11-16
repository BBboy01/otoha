const test = require("node:test");
const assert = require("node:assert/strict");
const {
  search,
  replace,
  merge,
  split,
  createLoop,
} = require("../subtitle-edit-tools.js");
const cues = [
  {
    id: "a",
    origins: ["a"],
    start: 1,
    end: 3,
    source: "cat cat",
    translation: "猫",
  },
  {
    id: "b",
    origins: ["b"],
    start: 4,
    end: 5,
    source: "dog",
    translation: "犬",
  },
];
test("literal replacement records matches and never mutates input", () => {
  assert.equal(search(cues, "cat", "source").length, 2);
  assert.equal(
    replace(cues, "cat", "kitten", "source", false)[0].source,
    "kitten cat",
  );
  assert.equal(
    replace(cues, "cat", "kitten", "source", true)[0].source,
    "kitten kitten",
  );
  assert.equal(cues[0].source, "cat cat");
});
test("single replacement targets the selected literal occurrence", () => {
  const match = search(cues, "cat", "source")[1];
  assert.equal(
    replace(cues, "cat", "kitten", "source", false, match)[0].source,
    "cat kitten",
  );
});
test("merge and independent language split preserve origin mappings", () => {
  const joined = merge(cues, 0);
  assert.deepEqual(joined[0].origins, ["a", "b"]);
  assert.equal(joined[0].end, 5);
  const parts = split(joined, 0, 3, 1, 2);
  assert.equal(parts[0].source, "cat");
  assert.equal(parts[1].translation, "\n犬");
  assert.throws(() => split(cues, 0, 1, 1, 9));
});
test("split validates numeric cuts and treats a Unicode character as one cut position", () => {
  const editable = [{ ...cues[0], translation: "猫猫" }];
  assert.throws(() => split(editable, 0, NaN, 1, 2));
  assert.throws(() => split(editable, 0, 1.5, 1, 2));
  const sourceOnly = [{ ...cues[0], source: "🙂好", translation: "" }];
  const parts = split(sourceOnly, 0, 1, 0, 2);
  assert.equal(parts[0].source, "🙂");
  assert.equal(parts[1].source, "好");
});
test("loop respects pause and clamp and stops after cleanup", () => {
  let state = { position: 3.4, paused: false, duration: 3.2 },
    moved = [];
  const loop = createLoop({
    getPlayback: () => state,
    seek: (v) => moved.push(v),
  });
  loop.set(cues[0]);
  loop.tick();
  assert.deepEqual(moved, [0.7]);
  state.paused = true;
  loop.tick();
  assert.equal(moved.length, 1);
  loop.stop();
  state.paused = false;
  loop.tick();
  assert.equal(moved.length, 1);
});
