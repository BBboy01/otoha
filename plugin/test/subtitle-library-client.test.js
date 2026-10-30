const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleLibraryClient } = require("../subtitle-library-client");

test("subtitle library client ignores stale listings and filters ASS files", async () => {
  const requests = [];
  const operations = [];
  const loaded = [];
  let currentOperation = null;
  let currentMedia = "/video.mkv";
  const client = createSubtitleLibraryClient({
    exec: (_helper, args) => new Promise((resolve) => requests.push({ args, resolve })),
    mediaPathForURL: () => currentMedia,
    subtitleLanguages: (path) => ({ pathLanguage: path }),
    beginOperation: () => {
      currentOperation = {};
      operations.push(currentOperation);
      return currentOperation;
    },
    isCurrentOperation: (operation) => operation === currentOperation,
    isAutoLoadEnabled: () => true,
    onAutoLoad: (files) => loaded.push(files),
    onError: () => assert.fail("listing should not fail"),
  });

  client.update({ helperPath: "/helper", media: { path: "/video.mkv" } });
  currentMedia = "/next.mkv";
  client.update({ helperPath: "/helper", media: { path: "/next.mkv" }, force: true });
  requests[0].resolve({ status: 0, stdout: JSON.stringify({ files: [{ path: "/old.ass" }] }) });
  requests[1].resolve({ status: 0, stdout: JSON.stringify({ files: [{ path: "/new.srt" }, { path: "/new.ass" }] }) });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(operations.length, 2);
  assert.deepEqual(client.state().files, [{ path: "/new.ass", pathLanguage: "/new.ass" }]);
  assert.equal(loaded.length, 1);
});

test("subtitle library client invalidation prevents a pending result from replacing state", async () => {
  let resolveRequest;
  let currentOperation = null;
  const client = createSubtitleLibraryClient({
    exec: () => new Promise((resolve) => { resolveRequest = resolve; }),
    mediaPathForURL: () => "/video.mkv",
    subtitleLanguages: () => ({}),
    beginOperation: () => (currentOperation = {}),
    isCurrentOperation: (operation) => operation === currentOperation,
    isAutoLoadEnabled: () => false,
    onAutoLoad: () => {},
    onError: () => {},
  });

  client.update({ helperPath: "/helper", media: { path: "/video.mkv" } });
  client.invalidate();
  resolveRequest({ status: 0, stdout: JSON.stringify({ files: [{ path: "/stale.ass" }] }) });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(client.state().files, []);
  assert.equal(client.state().loading, false);
});

test("subtitle library client reports when the active media is cleared", () => {
  let currentOperation = null;
  let mediaChanges = 0;
  const client = createSubtitleLibraryClient({
    exec: () => Promise.resolve({ status: 0, stdout: JSON.stringify({ files: [] }) }),
    mediaPathForURL: () => "/video.mkv",
    subtitleLanguages: () => ({}),
    beginOperation: () => (currentOperation = {}),
    isCurrentOperation: (operation) => operation === currentOperation,
    isAutoLoadEnabled: () => false,
    onMediaChanged: () => { mediaChanges += 1; },
    onAutoLoad: () => {},
    onError: () => {},
  });

  client.update({ helperPath: "/helper", media: { path: "/video.mkv" } });
  client.clear();

  assert.equal(mediaChanges, 1);
  assert.equal(client.state().mediaPath, null);
});

test("subtitle library client retries a failed listing for the same media", async () => {
  const requests = [];
  let currentOperation = null;
  const client = createSubtitleLibraryClient({
    exec: (_helper, args) => new Promise((resolve) => requests.push({ args, resolve })),
    mediaPathForURL: () => "/video.mkv",
    subtitleLanguages: () => ({}),
    beginOperation: () => (currentOperation = {}),
    isCurrentOperation: (operation) => operation === currentOperation,
    isAutoLoadEnabled: () => false,
    onAutoLoad: () => {},
    onError: () => {},
  });

  client.update({ helperPath: "/helper", media: { path: "/video.mkv" } });
  requests[0].resolve({ status: 1, stdout: "", stderr: "permission denied" });
  await new Promise((resolve) => setImmediate(resolve));
  client.update({ helperPath: "/helper", media: { path: "/video.mkv" } });
  requests[1].resolve({ status: 0, stdout: JSON.stringify({ files: [{ path: "/video.ass" }] }) });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 2);
  assert.deepEqual(client.state().files, [{ path: "/video.ass" }]);
});
