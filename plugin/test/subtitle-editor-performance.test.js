const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./subtitle-editor-fixture");

test("unchanged renders and scrolling do not compare or snapshot the whole document", () => {
  const f = fixture();
  f.input("source", "Changed");
  const comparisons = f.serialization.arrays;
  for (let i = 0; i < 10; i++) {
    f.onState("/synthetic.mp4");
    f.node("fields").listeners.get("scroll")();
  }
  assert.equal(f.serialization.arrays, comparisons);
  assert.equal(
    f.posts.some((post) => post.name === "persistSubtitleDraft"),
    false,
  );
  f.flushDraft();
  assert.equal(f.serialization.arrays, comparisons + 1);
});

test("debounce snapshots the latest content, position and revision exactly once", () => {
  const f = fixture();
  f.input("source", "First");
  f.input("source", "Latest");
  f.click("next");
  f.node("fields").scrollTop = 97;
  f.node("fields").listeners.get("scroll")();
  f.flushDraft();
  const writes = f.posts.filter((post) => post.name === "persistSubtitleDraft");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.sessionId, "session");
  assert.equal(writes[0].payload.draft.revision, f.snapshot.revision);
  assert.equal(writes[0].payload.draft.cues[0].source, "Latest");
  assert.equal(writes[0].payload.draft.index, 1);
  assert.equal(writes[0].payload.draft.scrollTop, 97);
});

test("undo to baseline discards the draft and invalidates the dirty cache", () => {
  const f = fixture();
  f.input("source", "Changed");
  f.edit.undo();
  f.flushDraft();
  assert.equal(f.node("save").disabled, true);
  assert.equal(f.node("dirty").hidden, true);
  assert.equal(f.posts.filter((post) => post.payload?.discard).length, 1);
  assert.equal(
    f.posts.some((post) => post.payload?.draft),
    false,
  );
});

test("a new session cancels the previous debounce before accepting new cues", () => {
  const f = fixture();
  f.input("source", "Previous session");
  f.emit("ready", {
    sessionId: "next",
    snapshot: { ...f.snapshot, revision: "b".repeat(64) },
  });
  f.flushDraft();
  assert.equal(
    f.posts.some((post) => post.payload?.draft),
    false,
  );
});

test("quick close flushes the latest draft without waiting for debounce", () => {
  const f = fixture();
  f.input("source", "Keep me");
  f.onState("/other.mp4");
  f.emit("closed");
  f.flushDraft();
  f.emit("ready", { snapshot: f.snapshot, path: f.snapshot.path });
  assert.equal(f.node("source").value, "Keep me");
});
