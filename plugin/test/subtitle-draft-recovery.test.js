const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./subtitle-editor-fixture");

function openWithDraft(revision) {
  const f = fixture();
  const draft = {
    revision: revision || f.snapshot.revision,
    index: 0,
    scrollTop: 32,
    cues: f.snapshot.cues.map((cue, index) =>
      index ? cue : { ...cue, source: "UNSAVED IMPORTANT EDIT" },
    ),
  };
  f.emit("ready", { snapshot: { ...f.snapshot, draft } });
  f.posts.length = 0;
  return f;
}

for (const revision of [undefined, "b".repeat(64)]) {
  test(`unresolved ${revision ? "conflicting" : "current"} drafts survive navigation and close without being overwritten`, () => {
    const f = openWithDraft(revision);
    f.click("next");
    f.flushDraft();
    f.edit.change([{ ...f.snapshot.cues[0], source: "New branch" }]);
    f.flushDraft();
    assert.equal(f.node("source").disabled, true);
    f.click("close");
    assert.deepEqual(
      f.posts.filter((post) => post.name === "persistSubtitleDraft"),
      [],
    );
    assert.equal(
      f.edit.getSnapshot().draft.cues[0].source,
      "UNSAVED IMPORTANT EDIT",
    );
  });
}

test("recovering a draft adopts its content before navigation can persist an updated position", () => {
  const f = openWithDraft();
  f.edit.restoreDraft();
  assert.equal(f.node("source").value, "UNSAVED IMPORTANT EDIT");
  assert.equal(f.node("source").disabled, false);
  f.click("next");
  f.flushDraft();
  const written = f.posts.find((post) => post.name === "persistSubtitleDraft");
  assert.equal(written.payload.draft.cues[0].source, "UNSAVED IMPORTANT EDIT");
  assert.equal(written.payload.draft.index, 1);
});

test("discarding a draft waits for acknowledgement and clean navigation never writes a new body", () => {
  const f = openWithDraft();
  f.edit.discardDraft();
  assert.equal(f.node("source").disabled, true);
  f.emit("draftSaved", { draft: null });
  assert.equal(f.node("source").disabled, false);
  f.posts.length = 0;
  f.click("next");
  f.flushDraft();
  assert.deepEqual(
    f.posts.filter((post) => post.name === "persistSubtitleDraft"),
    [],
  );
});

test("scrolling a dirty draft persists its latest editing position", () => {
  const f = fixture();
  f.input("source", "Edited");
  f.node("fields").scrollTop = 64;
  f.node("fields").listeners.get("scroll")?.();
  f.flushDraft();
  const written = f.posts.find((post) => post.name === "persistSubtitleDraft");
  assert.equal(written.payload.draft.scrollTop, 64);
});
