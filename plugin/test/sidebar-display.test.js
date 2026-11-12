const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sidebarSource = ["sidebar-progress.js", "sidebar.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
  .join("\n");
const sidebarMarkup = fs.readFileSync(
  path.join(__dirname, "../sidebar.html"),
  "utf8",
);
const sidebarStyles = fs.readFileSync(
  path.join(__dirname, "../sidebar-home.css"),
  "utf8",
);

function createSidebar() {
  const selectors = [
    "#audio-track",
    "#auto-load",
    "#auto-load-help",
    "#cancel-button",
    "#existing-subtitles",
    "#job-form",
    "#job-message",
    "#job-announcement",
    "#job-status",
    "#job-icon",
    "#job-progress",
    "#job-detail-toggle",
    "#job-detail-message",
    "#media-error",
    "#media-name",
    "#subtitle-choice",
    "#translation-progress",
    "#reveal-button",
    "#delete-button",
    "#retry-button",
    "#source-language",
    "#source-language-error",
    "#start-button",
    "#target-language",
    "#target-language-error",
    "#subtitle-loaded",
    "#display-mode",
    "#job-elapsed",
    "#language-resource-status",
    "#language-resource-message",
    "#check-languages",
    "#export-button",
    "#export-message",
    "#export-result",
    "#reveal-export-button",
    "#edit-subtitle-button",
  ];
  const elements = new Map(
    selectors.map((selector) => [
      selector,
      {
        children: [],
        hidden: false,
        disabled: false,
        checked: false,
        value: "",
        textContent: "",
        attributes: new Map(),
        dataset: {},
        listeners: new Map(),
        add(option) {
          this.children.push(option);
        },
        addEventListener(name, callback) {
          this.listeners.set(name, callback);
        },
        replaceChildren(...children) {
          this.children = children;
        },
        focus() {
          this.focused = true;
        },
        setAttribute(name, value) {
          this.attributes.set(name, String(value));
        },
        getAttribute(name) {
          return this.attributes.get(name) ?? null;
        },
      },
    ]),
  );
  const handlers = new Map();
  const posts = [];
  const exportModes = ["source", "translation", "bilingual"].map((value) => ({
    value,
    checked: value === "bilingual",
    disabled: false,
  }));
  const displayModes = ["source", "translation", "bilingual"].map((value) => ({
    value,
    checked: value === "bilingual",
    disabled: false,
    listeners: new Map(),
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
  }));
  class Option {
    constructor(text, value) {
      this.text = text;
      this.value = value;
    }
  }
  vm.runInNewContext(sidebarSource, {
    document: {
      querySelector: (selector) => elements.get(selector),
      querySelectorAll: (selector) =>
        selector === "input[name='export-mode']"
          ? exportModes
          : selector === "input[name='display-mode']"
            ? displayModes
            : [],
    },
    iina: {
      onMessage: (name, callback) => handlers.set(name, callback),
      postMessage: (name, payload) => posts.push({ name, payload }),
    },
    Option,
    URL,
    window: {
      location: { href: "file:///tmp/Otoha/sidebar.html" },
      setInterval() {},
    },
  });
  return { elements, exportModes, displayModes, handlers, posts };
}

function videoState(overrides = {}) {
  return {
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    availableSubtitles: [],
    displayMode: "bilingual",
    job: { status: "idle", message: "" },
    ...overrides,
  };
}

test("sidebar exposes three accessible display radio modes with a moving selection surface", () => {
  assert.match(
    sidebarMarkup,
    /<fieldset class="display-mode-row"[\s\S]*<legend class="visually-hidden">显示<\/legend>/,
  );
  assert.match(sidebarMarkup, /id="display-mode" class="display-mode-options"/);
  assert.match(sidebarMarkup, /name="display-mode" value="source"/);
  assert.match(sidebarMarkup, /name="display-mode" value="translation"/);
  assert.match(sidebarMarkup, /name="display-mode" value="bilingual"/);
  assert.match(sidebarStyles, /\.display-mode-row \{/);
  assert.match(sidebarStyles, /\.display-mode-options \{/);
  assert.match(sidebarStyles, /label:has\(input:checked\)/);
});

test("sidebar defaults to bilingual and restores the current video's display mode", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ displayMode: undefined }));
  assert.equal(
    sidebar.elements.get("#display-mode").getAttribute("data-selected"),
    "bilingual",
  );

  sidebar.handlers.get("state")(
    videoState({
      media: { path: "/Users/test/other.mp4", name: "other.mp4" },
      displayMode: "source",
    }),
  );
  assert.equal(
    sidebar.elements.get("#display-mode").getAttribute("data-selected"),
    "source",
  );
});

test("sidebar sends only the selected display mode for a local video", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState());
  const mode = sidebar.displayModes[0];
  mode.checked = true;
  mode.listeners.get("change")();
  assert.deepEqual(sidebar.posts.at(-1), {
    name: "setDisplayMode",
    payload: "source",
  });
  assert.equal(
    sidebar.posts.filter((message) => message.name === "setDisplayMode").length,
    1,
  );
});

test("sidebar disables display modes without a video or while loading", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ media: null }));
  const mode = sidebar.displayModes;
  assert.equal(
    mode.every((radio) => radio.disabled),
    true,
  );
  const postsBefore = sidebar.posts.length;
  mode[0].listeners.get("change")();
  assert.equal(sidebar.posts.length, postsBefore);

  sidebar.handlers.get("state")(
    videoState({ job: { status: "loading", message: "正在加载字幕" } }),
  );
  assert.equal(
    mode.every((radio) => radio.disabled),
    true,
  );
});
