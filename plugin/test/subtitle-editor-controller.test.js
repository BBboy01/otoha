const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSubtitleEditorController,
} = require("../subtitle-editor-controller");

function fixture() {
  const messages = [],
    calls = [],
    writes = [],
    deleted = [],
    reloads = [];
  const context = {
    mediaPath: "/synthetic.mp4",
    outputDirectoryPath: "/library",
    helperPath: "/helper",
    files: [{ path: "/library/video.ass" }],
    busy: false,
  };
  let failSave = false;
  let release;
  let delayed = false;
  let brokenStdout = false;
  const temporaryFiles = new Map();
  const controller = createSubtitleEditorController({
    getContext: () => context,
    onChanged() {},
    file: {
      write(path, content) {
        writes.push({ path, content });
        temporaryFiles.set(path.replace("@tmp", "/tmp"), content);
      },
      read: path => temporaryFiles.get(path.replace("@tmp", "/tmp")),
      delete(path) {
        deleted.push(path);
      },
    },
    utils: {
      resolvePath: (path) => path.replace("@tmp", "/tmp"),
      async exec(file, args) {
        calls.push({ file, args });
        const request = JSON.parse(
          args[0] === "--read-subtitle-json" ? args[1] : temporaryFiles.get(args[1]),
        );
        if (delayed)
          await new Promise((resolve) => {
            release = resolve;
          });
        const response = JSON.stringify({
            protocolVersion: 1,
            requestId: request.requestId,
            ...(failSave && args[0] === "--save-subtitle-file"
              ? { code: "subtitle.editConflict", message: "changed externally" }
              : {
                  snapshot: {
                    path: request.subtitlePath,
                    revision: "a".repeat(64),
                    cues: [
                      {
                        start: 1,
                        end: 2,
                        source: request.texts?.[0].source || "Source",
                        translation: "译文",
                      },
                    ],
                  },
                }),
          });
        const destination = args.indexOf("--subtitle-response-file");
        if (destination >= 0) temporaryFiles.set(args[destination + 1], response);
        return { status: 0, stdout: brokenStdout ? response.slice(0, 20) : response };
      },
    },
    send: (value) => messages.push(value),
    onSaved: async (...args) => reloads.push(args),
    seek() {},
  });
  return {
    controller,
    context,
    messages,
    calls,
    writes,
    deleted,
    reloads,
    truncateStdout() { brokenStdout = true; },
    failSave() {
      failSave = true;
    },
    delay() {
      delayed = true;
    },
    release() {
      release();
    },
  };
}

test("editor saves canonical text through a temporary request file and reloads once", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  await f.controller.save({
    sessionId,
    texts: [{ source: "Edited\nCJK 日本語", translation: "修正" }],
  });
  assert.equal(f.writes.filter(item => !item.path.includes("response")).length, 1);
  assert.equal(f.calls[1].args[0], "--save-subtitle-file");
  assert.equal(f.calls[1].args.length, 4);
  assert.equal(f.deleted.length, 3);
  assert.equal(f.reloads.length, 1);
  assert.equal(f.messages.at(-1).status, "saved");
});

test("editor reads and saves a complete snapshot even if the host truncates stdout", async () => {
  const f = fixture();
  f.truncateStdout();
  await f.controller.open("/library/video.ass");
  assert.equal(f.messages.at(-1).status, "ready");
  await f.controller.save({ sessionId: f.messages.at(-1).sessionId, texts: [{ source: "日本語", translation: "修正" }] });
  assert.equal(f.messages.at(-1).status, "saved");
  assert.equal(f.messages.at(-1).snapshot.cues[0].source, "日本語");
  assert.equal(f.deleted.length, 3);
});

test("closing without saving never writes subtitles and stale read cannot reopen the editor", async () => {
  const f = fixture();
  f.delay();
  const opening = f.controller.open("/library/video.ass");
  f.controller.close();
  f.release();
  await opening;
  assert.equal(f.controller.isOpen(), false);
  assert.equal(f.messages.at(-1).status, "closed");
  assert.equal(f.writes.filter(item => !item.path.includes("response")).length, 0);
  assert.equal(f.reloads.length, 0);
});

test("conflict preserves the editable snapshot and media switch prevents saving another video's file", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  f.failSave();
  await f.controller.save({
    sessionId,
    texts: [{ source: "Edited", translation: "修正" }],
  });
  assert.equal(f.messages.at(-1).errorCode, "subtitle.editConflict");
  assert.equal(f.messages.at(-1).snapshot.cues[0].source, "Source");
  assert.equal(f.reloads.length, 0);
  f.context.mediaPath = "/next.mp4";
  await f.controller.save({
    sessionId,
    texts: [{ source: "Edited", translation: "修正" }],
  });
  assert.equal(f.writes.filter(item => !item.path.includes("response")).length, 1);
  assert.equal(f.messages.at(-1).errorCode, "subtitle.editOutsideLibrary");
});

test("a save finishing after a media switch never loads into the new video", async () => {
  const f = fixture();
  await f.controller.open("/library/video.ass");
  const sessionId = f.messages.at(-1).sessionId;
  f.delay();
  const saving = f.controller.save({
    sessionId,
    texts: [{ source: "Edited", translation: "修正" }],
  });
  f.context.mediaPath = "/next.mp4";
  f.release();
  await saving;
  assert.equal(f.reloads.length, 0);
  assert.equal(f.messages.at(-1).status, "saved");
});
