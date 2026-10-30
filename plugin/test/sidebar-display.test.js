const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sidebarSource = fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8");
const sidebarMarkup = fs.readFileSync(path.join(__dirname, "../sidebar.html"), "utf8");
const sidebarStyles = fs.readFileSync(path.join(__dirname, "../sidebar.css"), "utf8");

function createSidebar() {
  const selectors = [
    "#audio-track", "#auto-load", "#auto-load-help", "#cancel-button",
    "#existing-subtitles", "#job-form", "#job-message", "#job-status", "#job-icon", "#job-detail-toggle", "#job-detail-message",
    "#media-error", "#media-name", "#subtitle-choice", "#translation-progress", "#reveal-button",
    "#retry-button", "#source-language", "#source-language-error", "#start-button", "#target-language",
    "#target-language-error", "#subtitle-loaded", "#display-mode",
  ];
  const elements = new Map(selectors.map((selector) => [selector, {
    children: [], hidden: false, disabled: false, checked: false, value: "", textContent: "",
    attributes: new Map(), dataset: {}, listeners: new Map(),
    add(option) { this.children.push(option); },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    replaceChildren(...children) { this.children = children; },
    focus() { this.focused = true; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
  }]));
  const handlers = new Map();
  const posts = [];
  class Option {
    constructor(text, value) { this.text = text; this.value = value; }
  }
  vm.runInNewContext(sidebarSource, {
    document: { querySelector: (selector) => elements.get(selector) },
    iina: { onMessage: (name, callback) => handlers.set(name, callback), postMessage: (name, payload) => posts.push({ name, payload }) },
    Option,
    URL,
    window: { location: { href: "file:///tmp/Otoha/sidebar.html" }, setInterval() {} },
  });
  return { elements, handlers, posts };
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

test("sidebar exposes the three display modes in an accessible compact select", () => {
  assert.match(sidebarMarkup, /<label[^>]*for="display-mode">显示<\/label>/);
  assert.match(sidebarMarkup, /<select[^>]*id="display-mode"/);
  assert.match(sidebarMarkup, /<option[^>]*value="source">原文<\/option>/);
  assert.match(sidebarMarkup, /<option[^>]*value="translation">译文<\/option>/);
  assert.match(sidebarMarkup, /<option[^>]*value="bilingual"[^>]*>双语<\/option>/);
  assert.doesNotMatch(sidebarMarkup, /display-mode-options/);
  assert.match(sidebarStyles, /\.display-mode-row \{/);
  assert.doesNotMatch(sidebarStyles, /\.display-mode-options/);
});

test("sidebar defaults to bilingual and restores the current video's display mode", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ displayMode: undefined }));
  assert.equal(sidebar.elements.get("#display-mode").value, "bilingual");

  sidebar.handlers.get("state")(videoState({ media: { path: "/Users/test/other.mp4", name: "other.mp4" }, displayMode: "source" }));
  assert.equal(sidebar.elements.get("#display-mode").value, "source");
});

test("sidebar sends only the selected display mode for a local video", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState());
  const mode = sidebar.elements.get("#display-mode");
  mode.value = "source";
  mode.listeners.get("change")();
  assert.deepEqual(sidebar.posts.at(-1), { name: "setDisplayMode", payload: "source" });
  assert.equal(sidebar.posts.filter((message) => message.name === "setDisplayMode").length, 1);
});

test("sidebar disables display modes without a video or while loading", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ media: null }));
  const mode = sidebar.elements.get("#display-mode");
  assert.equal(mode.disabled, true);
  const postsBefore = sidebar.posts.length;
  mode.listeners.get("change")();
  assert.equal(sidebar.posts.length, postsBefore);

  sidebar.handlers.get("state")(videoState({ job: { status: "loading", message: "正在加载字幕" } }));
  assert.equal(mode.disabled, true);
});
