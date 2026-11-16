const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function fixture() {
  const nodes = [];
  function make(tag) {
    const node = {
      tag,
      attributes: {},
      listeners: {},
      children: [],
      dataset: {},
      open: false,
      append(...items) {
        this.children.push(...items);
      },
      replaceChildren(...items) {
        this.children = items;
      },
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      addEventListener(key, value) {
        this.listeners[key] = value;
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
        this.listeners.close?.();
      },
    };
    nodes.push(node);
    return node;
  }
  const body = make("body"),
    trigger = make("button");
  const handlers = {},
    posts = [];
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../subtitle-association.js"), "utf8"),
    {
      document: {
        body,
        createElement: make,
        getElementById: (id) => (id === "subtitle-associate" ? trigger : null),
      },
      iina: {
        onMessage: (name, fn) => {
          handlers[name] = fn;
        },
        postMessage: (name, value) => posts.push({ name, value }),
      },
    },
  );
  return {
    nodes,
    trigger,
    handlers,
    posts,
    dialog: nodes.find((node) => node.tag === "dialog"),
  };
}

test("association opens a named modal with literal file text and cancellation", () => {
  const f = fixture();
  f.trigger.listeners.click();
  assert.equal(f.posts.at(-1).name, "requestSubtitleAssociation");
  f.handlers.association({
    status: "browse",
    title: "Movie",
    entries: [
      {
        name: "<img onerror=x>.ass",
        path: "/library/old.ass",
        kind: "subtitle",
      },
    ],
  });
  assert.equal(f.dialog.open, true);
  assert.equal(f.dialog.attributes["aria-labelledby"], "association-heading");
  const row = f.nodes.find((node) => node.className === "association-list")
    .children[0];
  assert.equal(row.children[0].textContent, "<img onerror=x>.ass");
  row.listeners.click();
  assert.equal(f.posts.at(-1).name, "selectSubtitleAssociation");
  f.dialog.close();
  assert.equal(f.posts.at(-1).name, "cancelSubtitleAssociation");
});

test("in-flight copy blocks dismissal and terminal close does not send redundant cancel", () => {
  const f = fixture();
  f.handlers.association({ status: "copying", title: "Movie", entries: [] });
  let prevented = false;
  f.dialog.listeners.cancel({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  f.handlers.association({ status: "closed" });
  assert.equal(f.dialog.open, false);
  assert.equal(f.posts.length, 0);
});
