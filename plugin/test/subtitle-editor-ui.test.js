const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(
  path.join(__dirname, "../subtitle-editor.js"),
  "utf8",
);

function fixture(reducedMotion = false) {
  const nodes = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!nodes.has(id))
        nodes.set(id, {
          id,
          listeners: new Map(),
          value: "",
          scrollTop: 0,
          open: false,
          disabled: false,
          children: [],
          animations: [],
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
            if (!this.disabled) document.activeElement = this;
          },
          getClientRects() {
            return [1];
          },
          replaceChildren(...children) {
            this.children = children;
          },
          animate(keyframes, options) {
            const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
            this.animations = this.animations.filter((item) => !item.cancelled);
            this.animations.push(animation);
            this.transform = "matrix(1, 0, 0, 1, 0, 1.5)";
            return animation;
          },
          getAnimations() { return this.animations.filter((item) => !item.cancelled); },
        });
      return nodes.get(id);
    },
  };
  const posts = [],
    handlers = new Map();
  let cueList;
  const window = {
    addEventListener() {},
    createDialogMotion: dialog => ({ open: () => dialog.showModal(), close: () => dialog.close() }),
    createSidebarNavigation: (home, editor) => opened => { home.hidden = opened; editor.hidden = !opened; },
    createSubtitleCueList(options) {
      cueList = {
        ...options, index: 0, updates: [], selections: [],
        replace(cues) { this.total = cues.length; },
        select(index, animate) { this.index = index; options.count.textContent = `${index + 1} / ${this.total}`; this.selections.push({ index, animate }); },
        update(index, text, modified) { this.updates.push({ index, text, modified }); },
        setDisabled() {}, setFollow() {}, setVideoIndex(index) { this.videoIndex = index; },
      };
      return cueList;
    },
  };
  window.getComputedStyle = (element) => ({
    transform: element.transform || "none",
    getPropertyValue: (name) => ({
      "--otoha-motion-editor-offset": "2px",
      "--otoha-motion-duration-cue-retarget": "200ms",
      "--otoha-motion-ease-standard": "cubic-bezier(0.2, 0.7, 0.25, 1)",
    })[name] || "",
  });
  window.matchMedia = () => ({ matches: reducedMotion });
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
  posts.length = 0;
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
    get cueList() { return cueList; },
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
  assert.equal(f.posts.filter(post => post.name !== "seekSubtitleCue").length, 0);
  f.click("keep");
  f.click("save");
  const saved = f.posts.find(post => post.name === "saveSubtitleEdits");
  assert.equal(saved.payload.texts[1].translation, "第二句修改");
  assert.equal(saved.payload.texts[0].start, undefined);
});

test("cue navigation animates the cue list while editing fields stay fixed", () => {
  const f = fixture();
  f.click("next");
  f.click("previous");
  assert.equal(f.node("fields").animations.length, 0);
  assert.deepEqual(f.cueList.selections.slice(-2), [{ index: 1, animate: true }, { index: 0, animate: true }]);
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
  assert.equal(f.posts.filter(post => post.name !== "seekSubtitleCue").length, 0);
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
  f.emit("ready", { sessionId:"session-2", path:f.snapshot.path, snapshot:f.snapshot });
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
  f.emit("ready", { sessionId:"session-2", path:f.snapshot.path, snapshot:f.snapshot });
  assert.equal(f.cueList.index, 1);
});

test("discarding edits clears the cached draft before reopening", () => {
  const f = fixture();
  f.input("translation", "不应恢复");
  f.click("close");
  f.click("discard");
  f.emit("closed");
  f.emit("ready", { sessionId:"session-2", path:f.snapshot.path, snapshot:f.snapshot });
  assert.equal(f.node("translation").value, f.snapshot.cues[0].translation);
  assert.equal(f.node("save").disabled, true);
});

test("cached editor drafts do not cross subtitle revisions", () => {
  const f = fixture();
  f.input("translation", "旧版本草稿");
  f.click("close");
  f.emit("closed");
  const nextRevision = { ...f.snapshot, revision:"b".repeat(64) };
  f.emit("ready", { sessionId:"session-2", path:f.snapshot.path, snapshot:nextRevision });
  assert.equal(f.node("translation").value, nextRevision.cues[0].translation);
  assert.equal(f.node("save").disabled, true);
});

test("saving consumes an old revision cache and reopening uses the saved revision", () => {
  const f = fixture();
  f.input("translation", "旧版本草稿");
  f.click("close");
  f.emit("closed");
  f.emit("ready", { sessionId:"session-2", path:f.snapshot.path, snapshot:f.snapshot });
  f.click("save");
  const savedSnapshot = {
    ...f.snapshot,
    revision:"c".repeat(64),
    cues:f.snapshot.cues.map((cue, index) => index ? cue : { ...cue, translation:"已保存译文" }),
  };
  f.emit("saved", { snapshot:savedSnapshot });
  f.click("close");
  f.emit("closed");
  f.emit("ready", { sessionId:"session-3", path:f.snapshot.path, snapshot:savedSnapshot });
  assert.equal(f.node("translation").value, "已保存译文");
  assert.equal(f.node("save").disabled, true);
  f.click("close");
  f.emit("closed");
  f.emit("ready", { sessionId:"session-4", path:f.snapshot.path, snapshot:f.snapshot });
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
  f.emit("saved", { snapshot: { ...f.snapshot, cues: f.snapshot.cues.map((cue, index) => index ? cue : { ...cue, source: "Corrected" }) } });
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
  f.emit("ready", { sessionId: "new-session", path: f.snapshot.path, snapshot: f.snapshot });
  assert.equal(f.posts.filter(post => post.name === "seekSubtitleCue").length, 1);
});
