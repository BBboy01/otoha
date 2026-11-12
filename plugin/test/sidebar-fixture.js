const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sidebarSource = ["sidebar-progress.js", "sidebar.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
  .join("\n");

function createSidebar() {
  const selectors = [
    "#edit-subtitle-button",
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
    "#subtitle-loaded",
    "#media-error",
    "#job-elapsed",
    "#language-resource-status",
    "#language-resource-message",
    "#check-languages",
    "#media-name",
    "#subtitle-choice",
    "#translation-progress",
    "#reveal-button",
    "#delete-button",
    "#retry-button",
    "#source-language",
    "#start-button",
    "#target-language",
    "#display-mode",
    "#source-language-error",
    "#target-language-error",
    "#generation-error",
    "#subtitle-version",
    "#export-button",
    "#export-message",
    "#export-result",
    "#reveal-export-button",
  ];
  const elements = new Map(
    selectors.map((selector) => [
      selector,
      {
        children: [],
        hidden: false,
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
  const iina = {
    onMessage(name, callback) {
      handlers.set(name, callback);
    },
    postMessage(name, payload) {
      posts.push({ name, payload });
    },
  };

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
    iina,
    Option,
    URL,
    window: {
      location: { href: "file:///tmp/Otoha/sidebar.html" },
      setInterval() {},
    },
  });

  elements.get("#display-mode").setAttribute = function (name, value) {
    this.attributes.set(name, String(value));
  };
  return { elements, exportModes, displayModes, handlers, posts };
}

function videoState(overrides = {}) {
  return {
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [
      { id: 1, lang: "ja", available: true },
      { id: 2, lang: "en", available: true },
    ],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    availableSubtitles: [],
    job: { status: "idle", message: "" },
    ...overrides,
  };
}

function change(sidebar, selector, value) {
  const element = sidebar.elements.get(selector);
  element.value = value;
  element.listeners.get("change")();
}

module.exports = { createSidebar, videoState, change };
