const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(
  path.join(__dirname, "../subtitle-editor.js"),
  "utf8",
);

function fixture(
  reducedMotion = false,
  { refreshOnCueChange = false, editorSource = source } = {},
) {
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
          dataset: {},
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
          focus(options) {
            this.focusOptions = options;
            if (!this.disabled) document.activeElement = this;
          },
          getClientRects() {
            return [1];
          },
          replaceChildren(...children) {
            this.children = children;
          },
          animate(keyframes, options) {
            const animation = {
              keyframes,
              options,
              cancelled: false,
              cancel() {
                this.cancelled = true;
              },
            };
            this.animations = this.animations.filter((item) => !item.cancelled);
            this.animations.push(animation);
            this.transform = "matrix(1, 0, 0, 1, 0, 1.5)";
            return animation;
          },
          getAnimations() {
            return this.animations.filter((item) => !item.cancelled);
          },
        });
      return nodes.get(id);
    },
  };
  const posts = [],
    handlers = new Map();
  const timers = new Map();
  let timerSequence = 0;
  let cueList, edit;
  const receivedPlayback = [];
  let previousCue = -1;
  const window = {
    addEventListener() {},
    createSubtitleEditControls(api) {
      edit = api;
      return {
        render() {
          if (refreshOnCueChange && previousCue !== api.getIndex()) {
            previousCue = api.getIndex();
            api.refreshPlayback();
          }
        },
        updatePlayback: (value) => receivedPlayback.push(value),
      };
    },
    createDialogMotion: (dialog) => ({
      open: () => dialog.showModal(),
      close: () => dialog.close(),
    }),
    createSidebarNavigation: (home, editor) => (opened) => {
      home.hidden = opened;
      editor.hidden = !opened;
    },
    createSubtitleCueList(options) {
      cueList = {
        ...options,
        index: 0,
        updates: [],
        selections: [],
        replace(cues) {
          this.total = cues.length;
        },
        select(index, animate) {
          this.index = index;
          options.count.textContent = `${index + 1} / ${this.total}`;
          this.selections.push({ index, animate });
        },
        update(index, text, modified) {
          this.updates.push({ index, text, modified });
        },
        setDisabled() {},
        setFollow() {},
        setVideoIndex(index) {
          this.videoIndex = index;
        },
      };
      return cueList;
    },
  };
  window.getComputedStyle = (element) => ({
    transform: element.transform || "none",
    getPropertyValue: (name) =>
      ({
        "--otoha-motion-duration-cue-retarget": "200ms",
        "--otoha-motion-ease-standard": "cubic-bezier(0.2, 0.7, 0.25, 1)",
      })[name] || "",
  });
  window.matchMedia = () => ({ matches: reducedMotion });
  const serialization = { arrays: 0, cues: 0 };
  vm.runInNewContext(editorSource, {
    JSON: {
      parse: JSON.parse,
      stringify(value) {
        if (Array.isArray(value)) {
          serialization.arrays++;
          serialization.cues += value.length;
        }
        return JSON.stringify(value);
      },
    },
    document,
    window,
    setTimeout: (callback) => {
      const id = ++timerSequence;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
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
    receivedPlayback,
    serialization,
    flushDraft() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    get edit() {
      return edit;
    },
    get cueList() {
      return cueList;
    },
  };
}

module.exports = { fixture };
