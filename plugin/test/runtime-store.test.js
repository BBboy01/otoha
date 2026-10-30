const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntimeStore } = require("../runtime-store");

test("runtime store keeps one AppState snapshot and notifies subscribers", () => {
  const store = createRuntimeStore({
    title: "episode.mkv",
    media: null,
    job: { status: "idle" },
  });
  const snapshots = [];
  const unsubscribe = store.subscribe((state) => snapshots.push(state));

  const next = store.setState((state) => ({ ...state, title: "next.mkv" }));

  assert.equal(store.getState(), next);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0], next);
  assert.equal(next.title, "next.mkv");

  unsubscribe();
  store.setState((state) => ({ ...state, title: "ignored by subscriber" }));
  assert.equal(snapshots.length, 1);
});

test("updateJob merges job fields into the current AppState snapshot", () => {
  const initialState = {
    title: "episode.mkv",
    job: { jobId: null, status: "idle", message: "" },
  };
  const store = createRuntimeStore(initialState);

  const next = store.updateJob({ jobId: "job-1", status: "running", message: "正在处理" });

  assert.deepEqual(next.job, {
    jobId: "job-1",
    status: "running",
    message: "正在处理",
  });
  assert.equal(next.title, "episode.mkv");
  assert.notEqual(next.job, initialState.job);
});

test("operation tokens are current only for their latest kind", () => {
  const store = createRuntimeStore({ job: { status: "idle" } });
  const firstMedia = store.begin("media");
  const firstSubtitle = store.begin("subtitle");

  assert.equal(firstMedia.kind, "media");
  assert.equal(store.isCurrent(firstMedia), true);
  assert.equal(store.isCurrent(firstSubtitle), true);

  const secondMedia = store.begin("media");
  assert.equal(store.isCurrent(firstMedia), false);
  assert.equal(store.isCurrent(secondMedia), true);
  assert.equal(store.isCurrent(firstSubtitle), true);

  store.invalidate("media");
  assert.equal(store.isCurrent(secondMedia), false);
  assert.equal(store.isCurrent(firstSubtitle), true);

  store.invalidate("all");
  assert.equal(store.isCurrent(firstSubtitle), false);
});

test("invalidating all operations also makes future checks reject stale tokens", () => {
  const store = createRuntimeStore({});
  const token = store.begin("library");
  store.invalidate();

  assert.equal(store.isCurrent(token), false);
  assert.equal(store.isCurrent(null), false);
  assert.equal(store.isCurrent({ kind: "library", id: token.id }), false);
});

test("operation tokens are scoped to the store that created them", () => {
  const firstStore = createRuntimeStore({});
  const secondStore = createRuntimeStore({});
  const token = firstStore.begin("media");

  assert.equal(firstStore.isCurrent(token), true);
  assert.equal(secondStore.isCurrent(token), false);
});
