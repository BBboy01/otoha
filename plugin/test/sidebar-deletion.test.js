const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("deletion dialog announces the target, blocks Escape while deleting, and restores focus", () => {
  const handlers = new Map();
  const posts = [];
  const listeners = new Map();
  const dialog = { open: false, addEventListener: (name, fn) => listeners.set(name, fn), showModal() { this.open = true; }, close() { this.open = false; } };
  const elements = new Map(["#delete-dialog", "#delete-button", "#delete-cancel", "#delete-confirm", "#delete-description", "#delete-error", "#existing-subtitles", "#subtitle-choice", "#source-language"].map(id => [id, {
    id: id.slice(1), disabled: false, hidden: false, value: "/library/episode [en to ja].ass", textContent: "", listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn); }, focus() { this.focused = true; },
  }]));
  elements.set("#delete-dialog", dialog);
  const source = fs.readFileSync(path.join(__dirname, "../sidebar-deletion.js"), "utf8");
  vm.runInNewContext(source, { document: { querySelector: selector => elements.get(selector) }, iina: {
    onMessage: (name, fn) => handlers.set(name, fn), postMessage: (name, payload) => posts.push({ name, payload }),
  } });
  const button = elements.get("#delete-button");
  button.listeners.get("click")();
  assert.deepEqual(posts.pop(), { name: "requestSubtitleDeletion", payload: "/library/episode [en to ja].ass" });
  handlers.get("deletion")({ status: "confirm", requestId: "delete-1", title: "Episode 3", mediaPath: "/video.mkv", sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(dialog.open, true);
  assert.match(elements.get("#delete-description").textContent, /Episode 3.*en → ja/);
  assert.equal(elements.get("#delete-cancel").focused, true);
  handlers.get("deletion")({ status: "deleting", requestId: "delete-1", title: "Episode 3", mediaPath: "/video.mkv", sourceLanguage: "en", targetLanguage: "ja" });
  let prevented = false;
  listeners.get("cancel")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(posts.length, 0);
  assert.equal(elements.get("#delete-confirm").disabled, true);
  handlers.get("deletion")({ status: "closed" });
  assert.equal(dialog.open, false);
  assert.equal(button.focused, true);
});
