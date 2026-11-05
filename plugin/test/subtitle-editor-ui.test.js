const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(
  path.join(__dirname, "../subtitle-editor.js"),
  "utf8",
);

function fixture() {
  const nodes = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!nodes.has(id))
        nodes.set(id, {
          id,
          listeners: new Map(),
          value: "",
          open: false,
          disabled: false,
          children: [],
          addEventListener(name, callback) {
            this.listeners.set(name, callback);
          },
          showModal() {
            this.open = true;
          },
          close() {
            this.open = false;
          },
          focus() {
            document.activeElement = this;
          },
          getClientRects() {
            return [1];
          },
          replaceChildren(...children) {
            this.children = children;
          },
        });
      return nodes.get(id);
    },
  };
  const posts = [],
    handlers = new Map();
  const window = { addEventListener() {} };
  vm.runInNewContext(source, {
    document,
    window,
    Option: function (text, value) {
      this.text = text;
      this.value = value;
    },
    iina: {
      onMessage: (name, callback) => handlers.set(name, callback),
      postMessage: (name, payload) => posts.push({ name, payload }),
    },
  });
  const node = (id) => document.getElementById(`editor-${id}`);
  const click = (id) => node(id).listeners.get("click")();
  const input = (id, value) => {
    node(id).value = value;
    node(id).listeners.get("input")();
  };
  const snapshot = {
    path: "/library/synthetic.ass",
    revision: "a".repeat(64),
    cues: [
      {
        start: 1,
        end: 2.5,
        source: "Self-authored one",
        translation: "自编一",
      },
      { start: 3, end: 4, source: "Self-authored two", translation: "自编二" },
    ],
  };
  const emit = (status, extra = {}) =>
    handlers.get("editor")({
      sessionId: "session",
      mediaPath: "/synthetic.mp4",
      status,
      ...extra,
    });
  const onState = (media) =>
    window.subtitleEditorUI.onState({ media: media ? { path: media } : null });
  const opener = document.getElementById("opener");
  opener.focus();
  onState("/synthetic.mp4");
  emit("ready", { snapshot, path: snapshot.path });
  return {
    nodes,
    node,
    click,
    input,
    emit,
    onState,
    posts,
    snapshot,
    document,
    opener,
  };
}

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
  assert.equal(f.posts.length, 0);
  f.click("keep");
  f.click("save");
  assert.equal(f.posts[0].name, "saveSubtitleEdits");
  assert.equal(f.posts[0].payload.texts[1].translation, "第二句修改");
  assert.equal(f.posts[0].payload.texts[0].start, undefined);
});

test("empty text focuses the invalid cue; save errors keep drafts and permit retry", () => {
  const f = fixture();
  f.input("source", " ");
  f.click("next");
  f.click("save");
  assert.equal(f.posts.length, 0);
  assert.equal(f.document.activeElement, f.node("source"));
  assert.equal(f.node("cue").value, "0");
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
  assert.equal(f.node("seek").disabled, true);
  assert.equal(f.node("translation").value, "保留草稿");
  f.onState("/synthetic.mp4");
  assert.equal(f.node("save").disabled, false);
  assert.equal(f.node("seek").disabled, false);
  f.click("seek");
  assert.equal(f.posts[0].name, "seekSubtitleCue");
  f.click("close");
  f.click("discard");
  assert.equal(f.posts.at(-1).name, "closeSubtitleEditor");
  f.emit("closed");
  assert.equal(f.nodes.get("subtitle-editor").open, false);
  assert.equal(f.document.activeElement, f.opener);
});
