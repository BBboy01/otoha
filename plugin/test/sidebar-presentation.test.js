const test = require("node:test");
const assert = require("node:assert/strict");
const { createSidebar, videoState } = require("./sidebar-fixture.js");
const fs = require("node:fs");
const path = require("node:path");
const sidebarMarkup = fs.readFileSync(path.join(__dirname, "../sidebar.html"), "utf8");
const sidebarStyles = fs.readFileSync(path.join(__dirname, "../sidebar.css"), "utf8");
const editorStyles = fs.readFileSync(path.join(__dirname, "../subtitle-editor.css"), "utf8");

test("sidebar uses resolved language preferences instead of audio metadata", () => {
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(videoState({ sourceLanguage: "en", targetLanguage: "ko" }));
  assert.equal(sidebar.elements.get("#source-language").value, "en");
  assert.equal(sidebar.elements.get("#target-language").value, "ko");
});

test("sidebar keeps the current video summary compact and preserves its full name", () => {
  const sidebar = createSidebar();
  assert.match(sidebarMarkup, /<div class="media-row">[\s\S]*<h2 id="media-heading">当前视频<\/h2>[\s\S]*<p\s+id="media-name"/);
  assert.match(sidebarStyles, /\.media-name \{[\s\S]*-webkit-line-clamp: 2;[\s\S]*text-overflow: ellipsis;/);
  sidebar.handlers.get("state")(
    videoState({
      title: "A very long video title that should stay available to inspect",
      media: { path: "/Users/test/video.mp4", name: "video.mp4" },
    }),
  );
  assert.equal(sidebar.elements.get("#media-name").title, "A very long video title that should stay available to inspect");
  assert.equal(sidebar.elements.get("#media-name").getAttribute("aria-label"), "A very long video title that should stay available to inspect");
});

test("sidebar uses a compact hover and click explanation for automatic loading", () => {
  assert.match(sidebarMarkup, /<div class="help-popover">/);
  assert.match(sidebarMarkup, /aria-label="自动加载说明"/);
  assert.match(sidebarMarkup, /role="tooltip"/);
  assert.match(sidebarMarkup, /<span id="automation-heading">自动加载<\/span>[\s\S]*<div class="help-popover">[\s\S]*<span class="help-icon" aria-hidden="true">\?<\/span>/);
  assert.match(sidebarStyles, /\.automation-row \{[\s\S]*justify-content: flex-start;/);
  assert.match(sidebarStyles, /\.help-icon \{[\s\S]*width: var\(--otoha-icon-size-help\);[\s\S]*height: var\(--otoha-icon-size-help\);/);
  assert.match(sidebarStyles, /@media \(hover: hover\) \{[\s\S]*\.help-popover:hover > \.help-tooltip/);
  assert.match(sidebarStyles, /\.help-popover:focus-within > \.help-tooltip/);
  const sidebar = createSidebar();
  const help = sidebar.elements.get("#auto-load-help");
  help.listeners.get("click")();
  assert.equal(help.focused, true);
});

test("sidebar exposes an explicit help state and closes it with Escape", () => {
  assert.match(sidebarMarkup, /id="auto-load-help"[^>]*aria-expanded="false"/);
  const sidebar = createSidebar();
  const help = sidebar.elements.get("#auto-load-help");
  assert.equal(help.getAttribute("aria-expanded"), "false");
  help.listeners.get("click")({});
  assert.equal(help.getAttribute("aria-expanded"), "true");
  help.listeners.get("keydown")({ key: "Escape", preventDefault() {} });
  assert.equal(help.getAttribute("aria-expanded"), "false");
  assert.equal(help.focused, true);
});

test("sidebar exposes progress text and field-level language errors", () => {
  assert.match(sidebarMarkup, /<progress id="translation-progress"[^>]*aria-label="翻译进度"/);
  assert.match(sidebarMarkup, /id="source-language-error"[^>]*role="alert"/);
  assert.match(sidebarMarkup, /id="target-language-error"[^>]*role="alert"/);
  const sidebar = createSidebar();
  sidebar.handlers.get("state")(
    videoState({
      sourceLanguage: "en",
      targetLanguage: "zh-Hans",
      job: {
        status: "running",
        phase: "translating",
        message: "正在翻译",
        progress: 0.42,
      },
    }),
  );
  assert.equal(sidebar.elements.get("#translation-progress").getAttribute("aria-valuenow"), "0.42");
  assert.equal(sidebar.elements.get("#translation-progress").getAttribute("aria-valuetext"), "42%");
  assert.equal(sidebar.elements.get("#source-language").getAttribute("aria-invalid"), "false");
  sidebar.handlers.get("state")(videoState({ sourceLanguage: "", targetLanguage: "en" }));
  sidebar.elements.get("#job-form").listeners.get("submit")({
    preventDefault() {},
  });
  assert.equal(sidebar.elements.get("#source-language").getAttribute("aria-invalid"), "true");
  assert.equal(sidebar.elements.get("#source-language-error").hidden, false);
  assert.equal(sidebar.elements.get("#source-language-error").textContent, "请选择源语言。");
});

test("sidebar leaves global path settings to plugin preferences", () => {
  assert.doesNotMatch(sidebarMarkup, /<details class="settings">/);
  assert.doesNotMatch(sidebarMarkup, /id="ffmpeg-path"/);
  assert.doesNotMatch(sidebarMarkup, /id="output-directory"/);
});

test("sidebar groups generation in a collapsible task section", () => {
  assert.match(sidebarMarkup, /<summary id="generation-heading">生成字幕<\/summary>/);
  assert.match(sidebarMarkup, /<div class="track-row">[\s\S]*<label for="audio-track">音轨<\/label>[\s\S]*<select id="audio-track"/);
  assert.match(sidebarMarkup, /<label for="source-language">源语言<\/label>/);
  assert.match(sidebarMarkup, /<label for="target-language">目标语言<\/label>/);
  assert.match(sidebarMarkup, /<section class="playback-options" aria-label="播放选项">/);
  assert.match(sidebarStyles, /h2 \{[\s\S]*font-size: var\(--otoha-font-size-body\);[\s\S]*font-weight: var\(--otoha-font-weight-heading\);/);
  assert.match(sidebarStyles, /label \{[\s\S]*font-size: var\(--otoha-font-size-small\);[\s\S]*font-weight: var\(--otoha-font-weight-medium\);/);
  assert.match(sidebarStyles, /form \{[\s\S]*padding-top: var\(--otoha-space-section-inset\);[\s\S]*border-top: var\(--otoha-border-width\) solid var\(--otoha-color-border-subtle\);/);
  assert.match(sidebarStyles, /\.track-row \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(sidebarStyles, /button\.primary \{[\s\S]*min-height: var\(--otoha-control-height-primary\);/);
  assert.match(sidebarStyles, /@media \(max-width: 280px\)[\s\S]*\.language-grid,[\s\S]*\.subtitle-row/);
});

test("sidebar exposes the brand line hierarchy through theme tokens", () => {
  assert.match(sidebarStyles, /\.header h1::after \{[\s\S]*background: var\(--otoha-color-accent\)/);
  assert.match(sidebarStyles, /\.section-heading h2::before \{[\s\S]*background: var\(--otoha-color-accent\)/);
  assert.match(sidebarStyles, /\.job-status\[data-kind="success"\][\s\S]*var\(--otoha-color-success\)/);
});

test("editor keeps source and translation fields as a paired workspace", () => {
  assert.match(sidebarMarkup, /<div class="editor-field editor-field-source">[\s\S]*id="editor-source"/);
  assert.match(sidebarMarkup, /<div class="editor-field editor-field-translation">[\s\S]*id="editor-translation"/);
  assert.match(editorStyles, /\.editor-field-source::before[\s\S]*var\(--otoha-color-border-strong\)/);
  assert.match(editorStyles, /\.editor-field-translation::before[\s\S]*var\(--otoha-color-accent\)/);
});

test("sidebar keeps subtitle management beside the selected version", () => {
  assert.match(sidebarMarkup, /<div class="subtitle-row">[\s\S]*<select id="subtitle-choice"[\s\S]*<button\s+id="reveal-button"/);
  assert.match(sidebarMarkup, /<h2 id="subtitle-heading">当前字幕<\/h2>/);
  assert.match(sidebarMarkup, /id="subtitle-loaded"[^>]*aria-label="字幕已加载"[^>]*title="字幕已加载"[^>]*>✓<\/span>/);
  assert.doesNotMatch(sidebarMarkup, /<span id="subtitle-loaded"[^>]*>已加载<\/span>/);
  assert.doesNotMatch(sidebarMarkup, /<div class="job-actions">[\s\S]*id="reveal-button"/);
  assert.match(sidebarStyles, /\.subtitle-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(sidebarMarkup, /id="subtitle-version"[^>]*>版本 1<\/span>/);
  assert.match(sidebarMarkup, /id="edit-subtitle-button" class="secondary"/);
  assert.doesNotMatch(sidebarMarkup, /<option[^>]*>[^<]*版本/);

  const sidebar = createSidebar();
  sidebar.handlers.get("state")(
    videoState({
      hasOutput: true,
      job: {
        status: "completed",
        path: "/library/video.ass",
        message: "双语字幕已加载",
      },
    }),
  );
  assert.equal(sidebar.elements.get("#reveal-button").hidden, true);
  sidebar.handlers.get("state")(videoState({ availableSubtitles: [{ path: "/library/video.ass" }] }));
  assert.equal(sidebar.elements.get("#reveal-button").hidden, false);
  sidebar.elements.get("#reveal-button").listeners.get("click")();
  assert.deepEqual(sidebar.posts.at(-1), {
    name: "reveal",
    payload: "/library/video.ass",
  });
});
