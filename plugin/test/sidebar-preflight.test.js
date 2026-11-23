const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function createSidebar() {
  const elements = new Map(), handlers = new Map(), posts = [];
  vm.runInNewContext(["operation-policy.js", "sidebar-state.js", "sidebar-render.js", "sidebar-preflight.js", "sidebar-progress.js", "sidebar.js"].map(file => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n"), {
    document: { querySelectorAll() { return []; }, querySelector(selector) {
      const node = { dataset: {}, hidden: false, listeners: new Map(), attributes: new Map(), value: "",
        replaceChildren() {}, add() {}, focus() {},
        addEventListener(name, callback) { this.listeners.set(name, callback); },
        setAttribute(key, value) { this.attributes.set(key, String(value)); },
        getAttribute(key) { return this.attributes.get(key); },
      };
      elements.set(selector, node); return node;
    } },
    iina: { onMessage(name, callback) { handlers.set(name, callback); }, postMessage(name, payload) { posts.push({ name, payload }); } },
    Option: class {}, URL, window: { location: { href: "file:///tmp/Otoha/sidebar.html" }, setInterval() {} },
  });
  const state = (preflight, mediaPath = "/synthetic.mp4", overrides = {}) => handlers.get("state")({
    media: { path: mediaPath, name: "synthetic.mp4" }, sourceLanguage: "en", targetLanguage: "ja",
    selectedTrackId: 1, tracks: [{ id: 1, available: true }], job: { status: "idle" },
    languagePreflight: preflight,
    ...overrides,
  });
  return { elements, handlers, posts, state };
}

test("sidebar requests language preflight, blocks unchecked generation and exposes retry", () => {
  const ui = createSidebar();
  ui.state(undefined);
  assert.equal(ui.posts.at(-1).name, "checkLanguages");
  assert.notEqual(ui.posts.at(-1).payload.force, true);
  assert.equal(ui.elements.get("#start-button").disabled, true);
  const pair = { sourceLanguage: "en", targetLanguage: "ja", mediaPath: "/synthetic.mp4" };
  ui.state({ ...pair, status: "unavailable", message: "需要下载翻译资源" });
  assert.equal(ui.elements.get("#language-resource-message").textContent, "需要下载翻译资源");
  assert.equal(ui.elements.get("#check-languages").hidden, false);
  ui.elements.get("#check-languages").listeners.get("click")();
  assert.equal(ui.posts.at(-1).name, "checkLanguages");
  assert.equal(ui.posts.at(-1).payload.force, true);
  ui.state({ ...pair, status: "ready", message: "语言资源可用" });
  assert.equal(ui.elements.get("#start-button").disabled, false);
  ui.state({ ...pair, status: "ready" }, "/next.mp4");
  assert.equal(ui.elements.get("#start-button").disabled, true);
});

test("cached resource approval keeps the generation button enabled when returning to a mode", () => {
  const ui = createSidebar();
  const pair = { sourceLanguage: "en", targetLanguage: "ja", mediaPath: "/synthetic.mp4", generationMode: "bilingual", status: "ready", message: "语言资源可用" };
  ui.state({ ...pair, generationMode: "source", targetLanguage: "", readyChecks: [pair] });
  assert.equal(ui.elements.get("#start-button").disabled, false);
  assert.equal(ui.elements.get("#language-resource-message").textContent, "语言资源可用");
  ui.elements.get("#check-languages").listeners.get("click")();
  assert.equal(ui.elements.get("#start-button").disabled, true);
});

test("ready language resources remain visible while generation is running", () => {
  const ui = createSidebar();
  const pair = { sourceLanguage: "en", targetLanguage: "ja", mediaPath: "/synthetic.mp4", status: "ready", message: "语言资源可用" };
  ui.state(pair);
  ui.state(pair, "/synthetic.mp4", { jobActive: true, job: { status: "running" } });
  assert.equal(ui.elements.get("#language-resource-status").hidden, false);
  assert.equal(ui.elements.get("#language-resource-message").textContent, "语言资源可用");
});

test("language resource rechecks remain visible during generation", () => {
  const ui = createSidebar();
  const pair = { sourceLanguage: "en", targetLanguage: "ja", mediaPath: "/synthetic.mp4", status: "checking", message: "正在检查语言资源" };
  ui.state(pair, "/synthetic.mp4", { jobActive: true, job: { status: "running" } });
  assert.equal(ui.elements.get("#language-resource-status").hidden, false);
  assert.equal(ui.elements.get("#language-resource-message").textContent, "正在检查语言资源");
  assert.equal(ui.elements.get("#language-resource-status").getAttribute("aria-busy"), "true");
});

test("changing languages invalidates prior approval and rechecks without changing playback", () => {
  const ui = createSidebar();
  ui.state({ sourceLanguage: "en", targetLanguage: "ja", mediaPath: "/synthetic.mp4", status: "ready" });
  ui.elements.get("#target-language").value = "ko";
  ui.elements.get("#target-language").listeners.get("change")();
  assert.equal(ui.posts.at(-1).payload.targetLanguage, "ko");
  assert.equal(ui.elements.get("#start-button").disabled, true);
});
