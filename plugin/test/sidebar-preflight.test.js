const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function createSidebar() {
  const elements = new Map(), handlers = new Map(), posts = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8"), {
    document: { querySelector(selector) {
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
  const state = (preflight, mediaPath = "/synthetic.mp4") => handlers.get("state")({
    media: { path: mediaPath, name: "synthetic.mp4" }, sourceLanguage: "en", targetLanguage: "ja",
    selectedTrackId: 1, tracks: [{ id: 1, available: true }], job: { status: "idle" },
    languagePreflight: preflight,
  });
  return { elements, handlers, posts, state };
}

test("sidebar requests language preflight, blocks unchecked generation and exposes retry", () => {
  const ui = createSidebar();
  ui.state(undefined);
  assert.equal(ui.posts.at(-1).name, "checkLanguages");
  assert.equal(ui.elements.get("#start-button").disabled, true);
  const pair = { sourceLanguage: "en", targetLanguage: "ja", mediaPath: "/synthetic.mp4" };
  ui.state({ ...pair, status: "unavailable", message: "需要下载翻译资源" });
  assert.equal(ui.elements.get("#language-resource-message").textContent, "需要下载翻译资源");
  assert.equal(ui.elements.get("#check-languages").hidden, false);
  ui.elements.get("#check-languages").listeners.get("click")();
  assert.equal(ui.posts.at(-1).name, "checkLanguages");
  ui.state({ ...pair, status: "ready", message: "语言资源可用" });
  assert.equal(ui.elements.get("#start-button").disabled, false);
  ui.state({ ...pair, status: "ready" }, "/next.mp4");
  assert.equal(ui.elements.get("#start-button").disabled, true);
});

test("changing languages invalidates prior approval and rechecks without changing playback", () => {
  const ui = createSidebar();
  ui.state({ sourceLanguage: "en", targetLanguage: "ja", mediaPath: "/synthetic.mp4", status: "ready" });
  ui.elements.get("#target-language").value = "ko";
  ui.elements.get("#target-language").listeners.get("change")();
  assert.equal(ui.posts.at(-1).payload.targetLanguage, "ko");
  assert.equal(ui.elements.get("#start-button").disabled, true);
});
