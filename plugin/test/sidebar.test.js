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
    "#existing-subtitles", "#job-form", "#job-message", "#job-status", "#job-icon",
    "#job-detail-toggle", "#job-detail-message", "#subtitle-loaded", "#media-error",
    "#media-name", "#subtitle-choice", "#translation-progress",
    "#reveal-button", "#retry-button", "#source-language", "#start-button", "#target-language",
    "#display-mode",
  ];
  const elements = new Map(selectors.map((selector) => [selector, {
    children: [],
    hidden: false,
    attributes: new Map(),
    dataset: {},
    listeners: new Map(),
    add(option) { this.children.push(option); },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    replaceChildren(...children) { this.children = children; },
    focus() { this.focused = true; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
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

function videoState(overrides = {}) {
  return {
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }, { id: 2, lang: "en", available: true }],
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

test("sidebar uses resolved language preferences instead of audio metadata", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ sourceLanguage: "en", targetLanguage: "ko" }));
  assert.equal(sidebar.elements.get("#source-language").value, "en");
  assert.equal(sidebar.elements.get("#target-language").value, "ko");
});

test("sidebar keeps the current video summary on one line and preserves its full name", () => {
  const sidebar = createSidebar();
  assert.match(sidebarMarkup, /<div class="media-row">[\s\S]*<h2 id="media-heading">当前视频<\/h2>[\s\S]*<p id="media-name"/);
  assert.match(sidebarStyles, /\.media-name \{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  sidebar.handlers.get("state")(videoState({
    title: "A very long video title that should stay available to inspect",
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
  }));
  assert.equal(sidebar.elements.get("#media-name").title, "A very long video title that should stay available to inspect");
});

test("sidebar uses a compact hover and click explanation for automatic loading", () => {
  assert.match(sidebarMarkup, /<div class="help-popover">/);
  assert.match(sidebarMarkup, /aria-label="自动加载说明"/);
  assert.match(sidebarMarkup, /role="tooltip"/);
  assert.match(sidebarMarkup, /<span id="automation-heading">自动加载<\/span>[\s\S]*<div class="help-popover">[\s\S]*<span class="help-icon" aria-hidden="true">\?<\/span>/);
  assert.match(sidebarStyles, /\.automation-row \{[\s\S]*justify-content: flex-start;/);
  assert.match(sidebarStyles, /\.help-icon \{[\s\S]*width: 15px;[\s\S]*height: 15px;/);
  assert.match(sidebarStyles, /@media \(hover: hover\) \{[\s\S]*\.help-popover:hover > \.help-tooltip/);
  assert.match(sidebarStyles, /\.help-popover:focus-within > \.help-tooltip/);
  const sidebar = createSidebar();
  const help = sidebar.elements.get("#auto-load-help");
  help.listeners.get("click")();
  assert.equal(help.focused, true);
});

test("sidebar leaves global path settings to plugin preferences", () => {
  assert.doesNotMatch(sidebarMarkup, /<details class="settings">/);
  assert.doesNotMatch(sidebarMarkup, /id="ffmpeg-path"/);
  assert.doesNotMatch(sidebarMarkup, /id="output-directory"/);
});

test("sidebar gives generation a clear primary hierarchy", () => {
  assert.match(sidebarMarkup, /<h2 id="generation-heading">生成字幕<\/h2>/);
  assert.match(sidebarMarkup, /<div class="track-row">[\s\S]*<label for="audio-track">音轨<\/label>[\s\S]*<select id="audio-track"/);
  assert.match(sidebarMarkup, /<label for="source-language">源语言<\/label>/);
  assert.match(sidebarMarkup, /<label for="target-language">目标语言<\/label>/);
  assert.match(sidebarMarkup, /<section class="playback-options" aria-label="播放选项">/);
  assert.match(sidebarStyles, /h2 \{[\s\S]*font-size: 13px;[\s\S]*font-weight: 650;/);
  assert.match(sidebarStyles, /label \{[\s\S]*font-size: 11px;[\s\S]*font-weight: 600;/);
  assert.match(sidebarStyles, /form \{[\s\S]*padding-top: 11px;[\s\S]*border-top: 1px solid var\(--quiet-border\);/);
  assert.match(sidebarStyles, /\.track-row \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(sidebarStyles, /button\.primary \{[\s\S]*min-height: 34px;/);
});

test("sidebar places the Finder action beside the selected subtitle", () => {
  assert.match(sidebarMarkup, /<div class="subtitle-row">[\s\S]*<select id="subtitle-choice"[\s\S]*<button id="reveal-button"/);
  assert.match(sidebarMarkup, /<h2 id="subtitle-heading">字幕列表<\/h2>/);
  assert.match(sidebarMarkup, /id="subtitle-loaded"[^>]*aria-label="字幕已加载"[^>]*title="字幕已加载"[^>]*>✓<\/span>/);
  assert.doesNotMatch(sidebarMarkup, /<span id="subtitle-loaded"[^>]*>已加载<\/span>/);
  assert.doesNotMatch(sidebarMarkup, /<div class="job-actions">[\s\S]*id="reveal-button"/);
  assert.match(sidebarStyles, /\.subtitle-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);

  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ hasOutput: true, job: { status: "completed", path: "/library/video.ass", message: "双语字幕已加载" } }));
  assert.equal(sidebar.elements.get("#reveal-button").hidden, true);
  sidebar.handlers.get("state")(videoState({ availableSubtitles: [{ path: "/library/video.ass" }] }));
  assert.equal(sidebar.elements.get("#reveal-button").hidden, false);
  sidebar.elements.get("#reveal-button").listeners.get("click")();
  assert.deepEqual(sidebar.posts.at(-1), { name: "reveal", payload: "/library/video.ass" });
});

test("sidebar does not infer a missing source language from audio metadata", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ sourceLanguage: "" }));
  assert.equal(sidebar.elements.get("#source-language").value, "");
});

test("sidebar hides idle feedback instead of reserving space for instructions", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState());
  assert.equal(sidebar.elements.get("#job-status").hidden, true);
  assert.equal(sidebar.elements.get("#job-message").textContent, "");
  assert.equal(sidebar.elements.get("#subtitle-loaded").hidden, true);
});

test("sidebar reflects the automatic loading preference", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")({
    ...videoState(),
    autoLoad: true,
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
      { path: "/library/video.ass", sourceLanguage: "ja", targetLanguage: "zh-Hans" },
      { path: "/library/video (2).ass" },
    ],
    job: { status: "available", message: "找到 2 份已生成字幕" },
  });

  assert.equal(sidebar.elements.get("#existing-subtitles").hidden, false);
  assert.deepEqual(sidebar.elements.get("#subtitle-choice").children.map((option) => option.text), ["video.ass", "video (2).ass"]);
  assert.equal(sidebar.elements.get("#start-button").textContent, "重新生成");

  const subtitleChoice = sidebar.elements.get("#subtitle-choice");
  subtitleChoice.value = "/library/video (2).ass";
  subtitleChoice.listeners.get("change")();
  assert.equal(sidebar.posts.at(-1).name, "loadExisting");
  assert.equal(sidebar.posts.at(-1).payload, "/library/video (2).ass");
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    availableSubtitles: [
      { path: "/library/video.ass", sourceLanguage: "ja", targetLanguage: "zh-Hans" },
      { path: "/library/video (2).ass" },
    ],
    job: { status: "available", message: "找到 2 份已生成字幕" },
  });
  assert.equal(subtitleChoice.value, "/library/video (2).ass");
});

test("sidebar keeps one saved subtitle visible and changes generation label", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")({
    media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    tracks: [{ id: 1, lang: "ja", available: true }],
    selectedTrackId: 1,
    sourceLanguage: "ja",
    targetLanguage: "zh-Hans",
    availableSubtitles: [{ path: "/library/video.ass", sourceLanguage: "ja", targetLanguage: "zh-Hans" }],
    job: { status: "completed", message: "双语字幕已加载", path: "/library/video.ass", loaded: true },
  });

  assert.equal(sidebar.elements.get("#existing-subtitles").hidden, false);
  assert.equal(sidebar.elements.get("#subtitle-choice").value, "/library/video.ass");
  assert.equal(sidebar.elements.get("#start-button").textContent, "重新生成");
});

test("sidebar merges confirmed loading into the selected saved subtitle", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({
    availableSubtitles: [{ path: "/library/video.ass" }, { path: "/library/another.ass" }],
    selectedSubtitlePath: "/library/video.ass",
    job: { status: "completed", message: "双语字幕已加载", path: "/library/video.ass", loaded: true },
  }));
  assert.equal(sidebar.elements.get("#job-status").hidden, true);
  assert.equal(sidebar.elements.get("#subtitle-loaded").hidden, false);
  change(sidebar, "#subtitle-choice", "/library/another.ass");
  assert.equal(sidebar.elements.get("#subtitle-loaded").hidden, true);
});

test("sidebar does not mark a missing or different subtitle as loaded", () => {
  for (const files of [[], [{ path: "/library/different.ass" }]]) {
    const sidebar = createSidebar();
    sidebar.handlers.get("state")(videoState({
      availableSubtitles: files,
      job: { status: "completed", message: "双语字幕已加载", path: "/library/video.ass", loaded: true },
    }));
    assert.equal(sidebar.elements.get("#subtitle-loaded").hidden, true);
  }
});

test("sidebar keeps feedback when a generated subtitle was not loaded", () => {
  const sidebar = createSidebar();
  const message = "字幕已保存；当前视频已更换，因此未自动加载。";
  sidebar.handlers.get("state")(videoState({
    availableSubtitles: [{ path: "/library/video.ass" }],
    job: { status: "completed", message, path: "/library/video.ass", loaded: false },
  }));
  assert.equal(sidebar.elements.get("#subtitle-loaded").hidden, true);
  assert.equal(sidebar.elements.get("#job-status").hidden, false);
  assert.equal(sidebar.elements.get("#job-message").textContent, message);
});

test("sidebar keeps long loading errors behind an expandable detail and exposes retry", () => {
  const sidebar = createSidebar();
  const message = "字幕已生成，但 IINA 加载失败：IINA 尚未确认字幕轨道加载，请重试或在播放器中检查字幕轨道。";
  sidebar.handlers.get("state")(videoState({ job: { status: "load-error", message } }));
  assert.equal(sidebar.elements.get("#job-status").hidden, false);
  assert.equal(sidebar.elements.get("#job-message").textContent, "字幕加载失败");
  assert.equal(sidebar.elements.get("#retry-button").hidden, false);
  const toggle = sidebar.elements.get("#job-detail-toggle");
  const detail = sidebar.elements.get("#job-detail-message");
  assert.equal(toggle.hidden, false);
  assert.equal(detail.hidden, true);
  assert.equal(detail.textContent, message);
  toggle.listeners.get("click")();
  assert.equal(detail.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.listeners.get("click")();
  assert.equal(detail.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  sidebar.elements.get("#retry-button").listeners.get("click")();
  assert.equal(sidebar.posts.at(-1).name, "retryLoad");
});

test("sidebar keeps error details open across polling and resets them for a new error", () => {
  const sidebar = createSidebar();
  const current = videoState({ job: { status: "error", message: "FFmpeg 不可用。" } });
  sidebar.handlers.get("state")(current);
  const detail = sidebar.elements.get("#job-detail-message");
  const toggle = sidebar.elements.get("#job-detail-toggle");
  assert.equal(detail.hidden, true);
  toggle.listeners.get("click")();
  sidebar.handlers.get("state")(current);
  assert.equal(detail.hidden, false);
  sidebar.handlers.get("job")({ status: "error", message: "语音模型不可用。" });
  assert.equal(detail.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(detail.textContent, "语音模型不可用。");
});

test("sidebar summarizes recognition and generation failures without discarding the reason", () => {
  for (const [message, summary, errorCode] of [
    ["所选音轨中没有识别到语音。", "未识别到语音", "speech.noSpeech"],
    ["FFmpeg 读取音频失败：文件无法访问。", "字幕生成失败", "ffmpeg.extractionFailed"],
  ]) {
    const sidebar = createSidebar();
    const current = videoState({ job: { status: "error", message, errorCode } });
    sidebar.handlers.get("state")(current);
    assert.equal(sidebar.elements.get("#job-status").hidden, false);
    assert.equal(sidebar.elements.get("#job-icon").hidden, false);
    assert.equal(sidebar.elements.get("#job-message").textContent, summary);
    assert.equal(sidebar.elements.get("#job-detail-message").textContent, message);
    assert.equal(sidebar.elements.get("#job-detail-message").hidden, true);
    assert.equal(sidebar.elements.get("#retry-button").hidden, true);
    sidebar.handlers.get("state")(current);
    assert.equal(sidebar.elements.get("#job-status").hidden, false);
    sidebar.handlers.get("state")(videoState({ media: { path: "/Users/test/next.mp4", name: "next.mp4" } }));
    assert.equal(sidebar.elements.get("#job-status").hidden, true);
  }
});

test("sidebar retains phase feedback and real progress while cancellation is available", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({
    job: { status: "running", phase: "translating", message: "正在翻译 42%", progress: 0.42 },
  }));
  assert.equal(sidebar.elements.get("#job-status").hidden, false);
  assert.equal(sidebar.elements.get("#job-message").textContent, "正在翻译 42%");
  assert.equal(sidebar.elements.get("#translation-progress").hidden, false);
  assert.equal(sidebar.elements.get("#translation-progress").value, 0.42);
  assert.equal(sidebar.elements.get("#cancel-button").hidden, false);
  assert.equal(sidebar.elements.get("#cancel-button").disabled, false);
  assert.equal(sidebar.elements.get("#job-detail-toggle").hidden, true);
  sidebar.elements.get("#cancel-button").listeners.get("click")();
  assert.equal(sidebar.posts.at(-1).name, "cancel");
  sidebar.handlers.get("job")({ status: "canceling", message: "正在取消" });
  assert.equal(sidebar.elements.get("#cancel-button").disabled, true);
  assert.equal(sidebar.elements.get("#translation-progress").hidden, true);
});

test("sidebar hides ordinary available feedback but preserves subtitle library warnings", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ job: { status: "available", message: "" } }));
  assert.equal(sidebar.elements.get("#job-status").hidden, true);
  const warning = "新字幕库读取失败，仍可使用已发现的字幕：目录无法读取";
  sidebar.handlers.get("state")(videoState({ job: { status: "available", message: warning, errorCode: "subtitle.libraryFailed" } }));
  assert.equal(sidebar.elements.get("#job-status").hidden, false);
});

test("sidebar identifies library errors before any subtitle has been generated", () => {
  const sidebar = createSidebar();
  const message = "无法读取字幕列表：目录无法读取";
  sidebar.handlers.get("state")(videoState({ job: { status: "error", message, errorCode: "subtitle.libraryFailed" } }));
  assert.equal(sidebar.elements.get("#job-message").textContent, "字幕库读取失败");
  assert.equal(sidebar.elements.get("#job-detail-message").textContent, message);
  assert.equal(sidebar.elements.get("#job-status").dataset.kind, "warning");
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
  assert.equal(sidebar.elements.get("#job-message").textContent, "正在检查字幕列表");
});

test("sidebar keeps edited languages when audio tracks or periodic state change", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState());
  change(sidebar, "#source-language", "fr");
  change(sidebar, "#target-language", "en");
  change(sidebar, "#audio-track", "2");
  assert.equal(sidebar.elements.get("#source-language").value, "fr");
  sidebar.handlers.get("state")(videoState({ selectedTrackId: 2 }));
  assert.equal(sidebar.elements.get("#source-language").value, "fr");
  assert.equal(sidebar.elements.get("#target-language").value, "en");
});

test("sidebar restores the next video's configuration after switching videos", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState());
  change(sidebar, "#source-language", "fr");
  sidebar.handlers.get("state")(videoState({
    media: { path: "/Users/test/another.mp4", name: "another.mp4" },
    sourceLanguage: "ko",
    targetLanguage: "en",
  }));
  assert.equal(sidebar.elements.get("#source-language").value, "ko");
  assert.equal(sidebar.elements.get("#target-language").value, "en");
});

test("sidebar applies a newly resolved saved configuration for the same video", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ subtitleLibraryLoading: true, sourceLanguage: "en" }));
  sidebar.handlers.get("state")(videoState({ sourceLanguage: "fr", targetLanguage: "ko" }));
  assert.equal(sidebar.elements.get("#source-language").value, "fr");
  assert.equal(sidebar.elements.get("#target-language").value, "ko");
});

test("sidebar restores the remembered subtitle instead of the first file", () => {
  const sidebar = createSidebar();
  const files = [{ path: "/library/newest.ass" }, { path: "/library/chosen.ass" }];
  sidebar.handlers.get("state")(videoState({
    availableSubtitles: files,
    selectedSubtitlePath: "/library/chosen.ass",
  }));
  assert.equal(sidebar.elements.get("#subtitle-choice").value, "/library/chosen.ass");
  change(sidebar, "#subtitle-choice", "/library/newest.ass");
  sidebar.handlers.get("state")(videoState({
    availableSubtitles: files,
    selectedSubtitlePath: "/library/chosen.ass",
  }));
  assert.equal(sidebar.elements.get("#subtitle-choice").value, "/library/newest.ass");
});

test("sidebar updates the generation label immediately for the chosen language pair", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({
    availableSubtitles: [{ path: "/library/video [ja to zh-Hans].ass", sourceLanguage: "ja", targetLanguage: "zh-Hans" }],
  }));
  assert.equal(sidebar.elements.get("#start-button").textContent, "重新生成");
  change(sidebar, "#target-language", "en");
  assert.equal(sidebar.elements.get("#start-button").textContent, "生成");
  change(sidebar, "#target-language", "zh-Hans");
  assert.equal(sidebar.elements.get("#start-button").textContent, "重新生成");
});

test("sidebar treats unlabelled subtitles as a separate version", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ availableSubtitles: [{ path: "/library/video.ass" }] }));
  assert.equal(sidebar.elements.get("#start-button").textContent, "生成");
});

test("sidebar blocks generation with a missing or duplicate language", () => {
  for (const [sourceLanguage, targetLanguage] of [["", "en"], ["en", ""], ["en", "en"]]) {
    const sidebar = createSidebar();
    sidebar.handlers.get("state")(videoState({ sourceLanguage, targetLanguage }));
    assert.equal(sidebar.elements.get("#start-button").disabled, true);
    sidebar.elements.get("#job-form").listeners.get("submit")({ preventDefault() {} });
    assert.equal(sidebar.posts.some((message) => message.name === "start"), false);
  }
});
