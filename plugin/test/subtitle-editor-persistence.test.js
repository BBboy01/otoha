const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSubtitleEditorController,
} = require("../subtitle-editor-controller");

function deferred() {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function fixture() {
  const messages = [],
    requests = [],
    reloads = [],
    seeks = [],
    timers = [];
  const handlers = new Map(),
    files = new Map();
  const draftStarted = deferred(),
    releaseDraft = deferred();
  const context = {
    mediaPath: "/video.mp4",
    outputDirectoryPath: "/library",
    helperPath: "/helper",
    files: [{ path: "/library/video.ass" }],
    busy: false,
  };
  const playback = { paused: false, position: 3, duration: 10 };
  const cues = [
    { id: "cue", origins: ["cue"], source: "Original", start: 1, end: 2 },
  ];
  let draft;
  const controller = createSubtitleEditorController({
    getContext: () => context,
    getPlayback: () => playback,
    file: {
      write: (path, value) => files.set(path, value),
      read: (path) => files.get(path),
      delete() {},
    },
    utils: {
      resolvePath: (path) => path,
      async exec(_, args) {
        const request = JSON.parse(
          args[0] === "--read-subtitle-json" ? args[1] : files.get(args[1]),
        );
        requests.push(request);
        if (request.action === "draft") {
          draftStarted.resolve();
          await releaseDraft.promise;
          draft = request.draft;
        }
        if (request.action === "discardDraft") draft = undefined;
        if (request.cues || request.action === "restore") draft = undefined;
        files.set(
          args[3],
          JSON.stringify({
            protocolVersion: 1,
            requestId: request.requestId,
            snapshot: {
              path: request.subtitlePath,
              revision: "a".repeat(64),
              mode: "source",
              cues: request.cues || cues,
              draft,
              history: [],
            },
          }),
        );
        return { status: 0 };
      },
    },
    send: (message) => messages.push(message),
    onChanged() {},
    onSaved: (...args) => reloads.push(args),
    seek: (position) => seeks.push(position),
    scheduleLoop: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    unscheduleLoop() {},
  });
  controller.register({
    onMessage: (name, handler) => handlers.set(name, handler),
  });
  return {
    controller,
    handlers,
    context,
    playback,
    messages,
    requests,
    reloads,
    seeks,
    timers,
    draftStarted,
    releaseDraft,
    cues,
  };
}

test("saving locks the editor while it waits for a draft and submits the full source-only cues once", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  const draft = {
    revision: "a".repeat(64),
    cues: f.cues,
    index: 0,
    scrollTop: 0,
  };
  const persisting = f.handlers.get("persistSubtitleDraft")({
    sessionId,
    draft,
  });
  await f.draftStarted.promise;
  const saving = f.controller.save({ sessionId, cues: f.cues });
  const statusWhilePending = f.messages.at(-1).status;
  const duplicate = f.controller.save({ sessionId, cues: f.cues });
  f.releaseDraft.resolve();
  await Promise.all([persisting, saving, duplicate]);
  assert.equal(statusWhilePending, "saving");
  assert.equal(f.requests.filter((request) => request.cues).length, 1);
  assert.equal(f.messages.at(-1).status, "saved");
  assert.deepEqual(f.requests.at(-1).cues, f.cues);
});

test("restoring waits for pending drafts so a late draft cannot recreate the discarded draft", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  const persisting = f.handlers.get("persistSubtitleDraft")({
    sessionId,
    draft: { revision: "a".repeat(64), cues: f.cues, index: 0, scrollTop: 0 },
  });
  await f.draftStarted.promise;
  const restoring = f.handlers.get("restoreSubtitleHistory")({
    sessionId,
    backupID: "backup.ass",
  });
  const beforeRelease = f.requests.map((request) => request.action);
  f.releaseDraft.resolve();
  await Promise.all([persisting, restoring]);
  assert.deepEqual(beforeRelease, [undefined, "draft"]);
  assert.deepEqual(
    f.requests.map((request) => request.action),
    [undefined, "draft", "restore"],
  );
  assert.equal(f.messages.at(-1).snapshot.draft, undefined);
});

test("discarding an undone draft remains ordered after closing the editor", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  const persisting = f.handlers.get("persistSubtitleDraft")({
    sessionId,
    draft: { revision: "a".repeat(64), cues: f.cues, index: 0, scrollTop: 0 },
  });
  await f.draftStarted.promise;
  const discarding = f.handlers.get("persistSubtitleDraft")({
    sessionId,
    discard: true,
  });
  f.handlers.get("closeSubtitleEditor")();
  f.releaseDraft.resolve();
  await Promise.all([persisting, discarding]);
  assert.deepEqual(
    f.requests.map((request) => request.action),
    [undefined, "draft", "discardDraft"],
  );
  await f.controller.open("/library/video.ass");
  assert.equal(f.messages.at(-1).snapshot.draft, undefined);
});

test("a cancelled loop ignores its already queued timer and never needs interval globals", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  f.handlers.get("loopSubtitleCue")({ sessionId, cue: f.cues[0] });
  const stale = f.timers.at(-1);
  f.controller.stopLoop();
  assert.doesNotThrow(stale);
  assert.equal(f.timers.length, 1);
  assert.deepEqual(f.seeks, []);
});

test("loop uses playback bounds and stops seeking while paused or after a media switch", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  f.handlers.get("loopSubtitleCue")({ sessionId, cue: f.cues[0] });
  f.timers.at(-1)();
  assert.deepEqual(f.seeks, [0.7]);
  f.playback.paused = true;
  f.timers.at(-1)();
  assert.deepEqual(f.seeks, [0.7]);
  f.context.mediaPath = "/other.mp4";
  const count = f.timers.length;
  f.timers.at(-1)();
  assert.equal(f.timers.length, count);
});

test("loop does not seek outside a media duration shorter than the selected cue", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  f.playback.duration = 0.5;
  f.handlers.get("loopSubtitleCue")({ sessionId, cue: f.cues[0] });
  f.timers.at(-1)();
  assert.deepEqual(f.seeks, []);
});

test("playback refresh reads current playback without republishing the editor snapshot", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  assert.ok(f.handlers.has("refreshSubtitlePlayback"));
  f.playback.position = 1.8;
  f.handlers.get("refreshSubtitlePlayback")({ sessionId });
  assert.equal(f.messages.at(-1).status, "playback");
  assert.equal(f.messages.at(-1).playback.position, 1.8);
  assert.equal(f.messages.at(-1).snapshot, undefined);
});

test("playback refresh ignores a closed editor", () => {
  const f = fixture();
  assert.doesNotThrow(() => f.handlers.get("refreshSubtitlePlayback")());
  assert.deepEqual(f.messages, []);
});
