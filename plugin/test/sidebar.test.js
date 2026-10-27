const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sidebarSource = fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8");

function createSidebar() {
  const selectors = [
    "#audio-track", "#cancel-button", "#choose-ffmpeg", "#choose-output", "#ffmpeg-path",
    "#job-form", "#job-message", "#media-error", "#media-name", "#output-default",
    "#output-directory", "#translation-progress", "#reveal-button", "#retry-button",
    "#source-language", "#start-button", "#target-language",
  ];
  const elements = new Map(selectors.map((selector) => [selector, {
    add() {},
    addEventListener() {},
    replaceChildren() {},
  }]));
  const handlers = new Map();
  const iina = {
    onMessage(name, callback) { handlers.set(name, callback); },
    postMessage() {},
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

  return { elements, handlers };
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
