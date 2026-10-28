const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sidebarSource = fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8");

function createSidebar() {
  const selectors = [
    "#audio-track", "#auto-load", "#cancel-button", "#choose-ffmpeg", "#choose-output", "#ffmpeg-path",
    "#existing-subtitles", "#job-form", "#job-message", "#media-error",
    "#media-name", "#output-default", "#output-directory", "#subtitle-choice", "#translation-progress",
    "#reveal-button", "#retry-button", "#source-language", "#start-button", "#target-language",
  ];
  const elements = new Map(selectors.map((selector) => [selector, {
    children: [],
    listeners: new Map(),
    add(option) { this.children.push(option); },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    replaceChildren(...children) { this.children = children; },
  }]));
  const handlers = new Map();
  const posts = [];
  const iina = {
    onMessage(name, callback) { handlers.set(name, callback); },
    postMessage(name, payload) { posts.push({ name, payload }); },
  };

  class Option {
    constructor(text, value) {
      this.text = text;
      this.value = value;
    }
  }

  vm.runInNewContext(sidebarSource, {
    document: { querySelector: (selector) => elements.get(selector) },
    iina,
    Option,
    URL,
    window: { location: { href: "file:///tmp/Otoha/sidebar.html" }, setInterval() {} },
  });

  return { elements, handlers, posts };
}

function renderTrackState(trackLanguage, job = { status: "idle", message: "" }) {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: trackLanguage, available: true }],
    selectedTrackId: 1,
    sourceLanguage: "",
    targetLanguage: "zh-Hans",
    job,
  });
  return {
    sourceLanguage: sidebar.elements.get("#source-language").value,
    jobMessage: sidebar.elements.get("#job-message").textContent,
  };
}

test("sidebar defaults three-letter Japanese and Portuguese track tags", () => {
  assert.equal(renderTrackState("JPN").sourceLanguage, "ja");
  assert.equal(renderTrackState("POR").sourceLanguage, "pt-BR");
});

test("sidebar does not silently map European Portuguese to Brazilian Portuguese", () => {
  assert.equal(renderTrackState("pt-PT").sourceLanguage, "");
});

test("sidebar gives an actionable message before a job starts", () => {
  assert.equal(renderTrackState("JPN").jobMessage, "选择音轨和语言后开始");
});

test("sidebar reflects the automatic loading preference", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    autoLoad: true,
    job: { status: "idle", message: "" },
  });

  assert.equal(sidebar.elements.get("#auto-load").checked, true);
  assert.equal(sidebar.elements.get("#auto-load").disabled, false);
});

test("sidebar shows multiple saved versions to load and keeps regeneration available", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    availableSubtitles: [
      { path: "/library/video.srt" },
      { path: "/library/video (2).srt" },
    ],
    job: { status: "available", message: "找到 2 份已生成字幕" },
  });

  assert.equal(sidebar.elements.get("#existing-subtitles").hidden, false);
  assert.deepEqual(sidebar.elements.get("#subtitle-choice").children.map((option) => option.text), ["video.srt", "video (2).srt"]);
  assert.equal(sidebar.elements.get("#start-button").textContent, "重新生成");

  const subtitleChoice = sidebar.elements.get("#subtitle-choice");
  subtitleChoice.value = "/library/video (2).srt";
  subtitleChoice.listeners.get("change")();
  assert.equal(sidebar.posts.at(-1).name, "loadExisting");
  assert.equal(sidebar.posts.at(-1).payload, "/library/video (2).srt");
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    availableSubtitles: [
      { path: "/library/video.srt" },
      { path: "/library/video (2).srt" },
    ],
    job: { status: "available", message: "找到 2 份已生成字幕" },
  });
  assert.equal(subtitleChoice.value, "/library/video (2).srt");
});

test("sidebar keeps one saved subtitle visible and changes generation label", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    availableSubtitles: [{ path: "/library/video.srt" }],
    job: { status: "completed", message: "双语字幕已加载", path: "/library/video.srt", loaded: true },
  });

  assert.equal(sidebar.elements.get("#existing-subtitles").hidden, false);
  assert.equal(sidebar.elements.get("#subtitle-choice").value, "/library/video.srt");
  assert.equal(sidebar.elements.get("#start-button").textContent, "重新生成");
});

test("sidebar waits for subtitle lookup before enabling generation", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    subtitleLibraryLoading: true,
    availableSubtitles: [],
    job: { status: "idle", message: "" },
  });

  assert.equal(sidebar.elements.get("#start-button").disabled, true);
  assert.equal(sidebar.elements.get("#job-message").textContent, "正在检查已有字幕");
});
