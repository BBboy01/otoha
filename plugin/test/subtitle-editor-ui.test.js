const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./subtitle-editor-fixture");

test("drafts survive cue navigation, Escape confirmation and keeping edits", () => {
  const f = fixture();
  f.input("source", "Edited\nEnglish 日本語");
  f.click("next");
  f.input("translation", "第二句修改");
  f.click("previous");
  assert.equal(f.node("source").value, "Edited\nEnglish 日本語");
  f.nodes.get("subtitle-editor").listeners.get("cancel")({
    preventDefault() {},
  });
  assert.equal(f.node("discard-dialog").open, true);
  assert.equal(
    f.posts.filter((post) => post.name !== "seekSubtitleCue").length,
    0,
  );
  f.click("keep");
  f.click("save");
  const saved = f.posts.find((post) => post.name === "saveSubtitleEdits");
  assert.equal(saved.payload.texts[1].translation, "第二句修改");
  assert.equal(saved.payload.texts[0].start, undefined);
});

test("cue navigation animates the cue list while editing fields stay fixed", () => {
  const f = fixture();
  f.click("next");
  f.click("previous");
  assert.equal(f.node("fields").animations.length, 0);
  assert.deepEqual(f.cueList.selections.slice(-2), [
    { index: 1, animate: true },
    { index: 0, animate: true },
  ]);
});

test("cue motion respects the system reduced-motion preference", () => {
  const f = fixture(true);
  f.click("next");
  assert.equal(f.node("fields").animations.length, 0);
});

test("empty text focuses the invalid cue; save errors keep drafts and permit retry", () => {
  const f = fixture();
  f.input("source", " ");
  f.click("next");
  f.click("save");
  assert.equal(
    f.posts.filter((post) => post.name !== "seekSubtitleCue").length,
    0,
  );
  assert.equal(f.document.activeElement, f.node("source"));
  assert.equal(f.cueList.index, 0);
  f.input("source", "Corrected");
  f.click("save");
  f.emit("saving");
  assert.equal(f.node("close").disabled, true);
  assert.equal(f.node("source").disabled, true);
  f.emit("error", { message: "权限不足，请检查字幕目录" });
  assert.equal(f.node("source").value, "Corrected");
  assert.equal(f.node("error").textContent, "权限不足，请检查字幕目录");
  assert.equal(f.node("save").disabled, false);
  f.emit("saved", {
    message: "已保存",
    snapshot: {
      ...f.snapshot,
      cues: f.snapshot.cues.map((cue, index) =>
        index ? cue : { ...cue, source: "Corrected" },
      ),
    },
  });
  assert.equal(f.node("save").disabled, true);
  f.click("close");
  assert.equal(f.posts.at(-1).name, "closeSubtitleEditor");
  assert.equal(f.node("discard-dialog").open, false);
});

test("media changes preserve drafts and block save and seek until returning", () => {
  const f = fixture();
  f.input("translation", "保留草稿");
  f.onState("/another-synthetic.mp4");
  assert.equal(f.node("save").disabled, true);
  assert.equal(f.node("follow").disabled, true);
  assert.equal(f.node("translation").value, "保留草稿");
  f.onState("/synthetic.mp4");
  assert.equal(f.node("save").disabled, false);
  assert.equal(f.node("follow").disabled, false);
  f.cueList.onSeek(0);
  assert.equal(f.posts[0].name, "seekSubtitleCue");
  f.click("close");
  f.click("discard");
  assert.equal(f.posts.at(-1).name, "closeSubtitleEditor");
  f.emit("closed");
  assert.equal(f.nodes.get("subtitle-editor").open, false);
  assert.equal(f.document.activeElement, f.opener);
});

test("closing and reopening the same subtitle restores its unsaved draft and selected cue", () => {
  const f = fixture();
  f.input("translation", "保留的未保存译文");
  f.click("next");
  f.node("fields").scrollTop = 64;
  f.click("close");
  f.emit("closed");
  f.emit("ready", {
    sessionId: "session-2",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(f.cueList.index, 1);
  assert.equal(f.node("count").textContent, "2 / 2");
  f.click("previous");
  assert.equal(f.node("translation").value, "保留的未保存译文");
  assert.equal(f.node("save").disabled, false);
  assert.equal(f.node("fields").scrollTop, 64);
});

test("closing a clean editor restores the last selected cue", () => {
  const f = fixture();
  f.click("next");
  f.click("close");
  f.emit("closed");
  f.emit("ready", {
    sessionId: "session-2",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(f.cueList.index, 1);
});

test("entering the editor moves focus without scrolling during the transition", () => {
  const f = fixture();
  f.emit("closed");
  f.emit("ready", {
    sessionId: "session-2",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(f.node("close").focusOptions?.preventScroll, true);
});

test("editor keeps its controls visible and disabled while cue content loads", () => {
  const f = fixture();
  f.emit("closed");
  f.emit("loading", {
    sessionId: "session-2",
    path: f.snapshot.path,
    message: "正在读取字幕",
  });
  assert.equal(f.node("fields").hidden, false);
  assert.equal(f.node("fields").dataset.loading, "true");
  assert.equal(f.node("save-area").hidden, false);
  assert.equal(f.node("source").value, "");
  assert.equal(f.node("translation").value, "");
  for (const name of [
    "source", "translation", "follow", "previous", "next", "save", "save-next",
  ])
    assert.equal(f.node(name).disabled, true, name);

  f.emit("ready", {
    sessionId: "session-2",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(f.node("fields").hidden, false);
  assert.equal(f.node("fields").dataset.loading, "false");
  assert.equal(f.node("save-area").hidden, false);
  assert.equal(f.node("source").value, "Self-authored one");
  assert.equal(f.node("source").disabled, false);
  assert.equal(f.node("next").disabled, false);
});

test("undoing back to the saved baseline clears an autosaved draft", () => {
  const f = fixture();
  f.input("source", "临时修改");
  f.flushDraft();
  f.emit("draftSaved", {
    draft: {
      revision: f.snapshot.revision,
      cues: f.snapshot.cues.map((cue, index) =>
        index ? cue : { ...cue, source: "临时修改" },
      ),
      index: 0,
      scrollTop: 0,
    },
  });
  f.edit.undo();
  assert.equal(f.node("save").disabled, true);
  assert.equal(
    f.posts.filter((post) => post.name === "persistSubtitleDraft").at(-1)
      ?.payload.discard,
    true,
  );
});

test("undoing to baseline clears a draft whose acknowledgement is pending", () => {
  const f = fixture();
  f.input("source", "Pending draft");
  f.flushDraft();
  f.edit.undo();
  f.click("close");
  assert.equal(
    f.posts.filter((post) => post.name === "persistSubtitleDraft").at(-1)
      ?.payload.discard,
    true,
  );
});

test("discarding edits clears the cached draft before reopening", () => {
  const f = fixture();
  f.input("translation", "不应恢复");
  f.click("close");
  f.click("discard");
  f.emit("closed");
  f.emit("ready", {
    sessionId: "session-2",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(f.node("translation").value, f.snapshot.cues[0].translation);
  assert.equal(f.node("save").disabled, true);
});

test("cached editor drafts do not cross subtitle revisions", () => {
  const f = fixture();
  f.input("translation", "旧版本草稿");
  f.click("close");
  f.emit("closed");
  const nextRevision = { ...f.snapshot, revision: "b".repeat(64) };
  f.emit("ready", {
    sessionId: "session-2",
    path: f.snapshot.path,
    snapshot: nextRevision,
  });
  assert.equal(f.node("translation").value, nextRevision.cues[0].translation);
  assert.equal(f.node("save").disabled, true);
});

test("saving consumes an old revision cache and reopening uses the saved revision", () => {
  const f = fixture();
  f.input("translation", "旧版本草稿");
  f.click("close");
  f.emit("closed");
  f.emit("ready", {
    sessionId: "session-2",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  f.click("save");
  const savedSnapshot = {
    ...f.snapshot,
    revision: "c".repeat(64),
    cues: f.snapshot.cues.map((cue, index) =>
      index ? cue : { ...cue, translation: "已保存译文" },
    ),
  };
  f.emit("saved", { snapshot: savedSnapshot });
  f.click("close");
  f.emit("closed");
  f.emit("ready", {
    sessionId: "session-3",
    path: f.snapshot.path,
    snapshot: savedSnapshot,
  });
  assert.equal(f.node("translation").value, "已保存译文");
  assert.equal(f.node("save").disabled, true);
  f.click("close");
  f.emit("closed");
  f.emit("ready", {
    sessionId: "session-4",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(f.node("translation").value, f.snapshot.cues[0].translation);
  assert.equal(f.node("save").disabled, true);
});

test("save and next advances only after successful persistence and marks modified cues", () => {
  const f = fixture();
  assert.equal(f.node("count").textContent, "1 / 2");
  f.input("source", "Corrected");
  assert.equal(f.cueList.updates.at(-1).modified, true);
  f.node("save-next").focus();
  f.click("save-next");
  assert.equal(f.posts.at(-1).name, "saveSubtitleEdits");
  assert.equal(f.cueList.index, 0);
  f.emit("error", { message: "保存失败" });
  assert.equal(f.cueList.index, 0);
  f.click("save-next");
  f.emit("saved", {
    snapshot: {
      ...f.snapshot,
      cues: f.snapshot.cues.map((cue, index) =>
        index ? cue : { ...cue, source: "Corrected" },
      ),
    },
  });
  assert.equal(f.cueList.index, 1);
  assert.equal(f.node("count").textContent, "2 / 2");
  assert.equal(f.document.activeElement, f.node("source"));
  assert.equal(f.cueList.updates.at(-1).modified, false);
});

test("video follows selection by default; disabling follow requires double-click seeking", () => {
  const f = fixture();
  f.posts.length = 0;
  f.click("next");
  assert.equal(f.posts.at(-1).name, "seekSubtitleCue");
  assert.equal(f.posts.at(-1).payload.index, 1);
  f.node("follow").checked = false;
  f.node("follow").listeners.get("change")();
  f.posts.length = 0;
  f.cueList.onSelect(0);
  assert.equal(f.posts.length, 0);
  f.cueList.onSeek(0);
  assert.equal(f.posts.at(-1).payload.index, 0);
  f.node("follow").checked = true;
  f.node("follow").listeners.get("change")();
  assert.equal(f.posts.at(-1).payload.index, 0);
});

test("the initial subtitle follows video even when loading arrives before ready", () => {
  const f = fixture();
  f.emit("closed");
  f.posts.length = 0;
  f.emit("loading", { sessionId: "new-session", path: f.snapshot.path });
  f.emit("ready", {
    sessionId: "new-session",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(
    f.posts.filter((post) => post.name === "seekSubtitleCue").length,
    1,
  );
});

test("closing preserves structural drafts and undo restores the previous structure", () => {
  const f = fixture();
  const joined = [{ ...f.snapshot.cues[0], source: "Joined", end: 4 }];
  f.edit.change(joined);
  assert.equal(f.cueList.total, 1);
  f.edit.undo();
  assert.equal(f.cueList.total, 2);
  f.edit.change(joined);
  f.click("close");
  f.emit("closed");
  f.emit("ready", {
    sessionId: "reopened",
    path: f.snapshot.path,
    snapshot: f.snapshot,
  });
  assert.equal(f.cueList.total, 1);
  assert.equal(f.node("source").value, "Joined");
});

test("draft discard acknowledgements clear the persisted draft controls", () => {
  const f = fixture();
  f.emit("ready", {
    snapshot: {
      ...f.snapshot,
      draft: {
        revision: f.snapshot.revision,
        cues: f.snapshot.cues,
        index: 0,
        scrollTop: 0,
      },
    },
  });
  assert.ok(f.edit.getSnapshot().draft);
  f.emit("draftSaved", { draft: null });
  assert.equal(f.edit.getSnapshot().draft, null);
});

test("successful saving clears undo entries whose origin IDs belong to an older revision", () => {
  const f = fixture();
  const oldCues = f.snapshot.cues.map((cue, index) => ({
    ...cue,
    id: `old:${index}`,
    origins: [`old:${index}`],
  }));
  f.emit("ready", { snapshot: { ...f.snapshot, cues: oldCues } });
  f.edit.change(oldCues.map((cue) => ({ ...cue, source: "Edited" })));
  const newCues = oldCues.map((cue, index) => ({
    ...cue,
    source: "Edited",
    id: `new:${index}`,
    origins: [`new:${index}`],
  }));
  f.emit("saved", {
    snapshot: { ...f.snapshot, revision: "b".repeat(64), cues: newCues },
  });
  f.edit.undo();
  assert.equal(f.edit.getCues()[0].id, "new:0");
  assert.equal(f.node("save").disabled, true);
});

test("undo retains the latest 50 immutable editing states", () => {
  const f = fixture();
  for (let value = 1; value <= 60; value++) f.input("source", `Edit ${value}`);
  for (let step = 0; step < 50; step++) f.edit.undo();
  assert.equal(f.node("source").value, "Edit 10");
  assert.equal(f.node("translation").value, "自编一");
  f.edit.undo();
  assert.equal(f.node("source").value, "Edit 10");
  f.input("source", "New branch");
  f.edit.undo();
  assert.equal(f.node("source").value, "Edit 10");
});

test("a playback refresh updates split defaults without replacing drafts or undo", () => {
  const f = fixture();
  f.input("source", "Local draft");
  f.emit("playback", {
    playback: { position: 1.8, paused: true, duration: 10 },
  });
  assert.equal(f.receivedPlayback.at(-1)?.position, 1.8);
  assert.equal(f.node("source").value, "Local draft");
  f.edit.undo();
  assert.equal(f.node("source").value, f.snapshot.cues[0].source);
});

test("cue navigation sends the follow seek before requesting a current split position", () => {
  const f = fixture(false, { refreshOnCueChange: true });
  f.click("next");
  assert.deepEqual(
    f.posts.map((post) => post.name),
    ["seekSubtitleCue", "refreshSubtitlePlayback"],
  );
});
