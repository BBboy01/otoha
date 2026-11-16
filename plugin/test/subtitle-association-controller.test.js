const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSubtitleAssociationController,
} = require("../subtitle-association-controller");

function fixture() {
  const context = {
    mediaPath: "/new.mp4",
    title: "New",
    outputDirectoryPath: "/library",
    helperPath: "/helper",
    busy: false,
  };
  const messages = [],
    calls = [],
    associated = [];
  const waiting = [];
  const controller = createSubtitleAssociationController({
    getContext: () => context,
    send: (message) => messages.push(message),
    onChanged() {},
    onAssociated: (...args) => associated.push(args),
    exec: (path, args) => {
      const request = JSON.parse(args[1]);
      calls.push({ path, args, request });
      return new Promise((resolve) =>
        waiting.push((body) =>
          resolve({
            status: 0,
            stdout: JSON.stringify({
              protocolVersion: 1,
              requestId: request.requestId,
              ...body,
            }),
          }),
        ),
      );
    },
  });
  return {
    context,
    controller,
    messages,
    calls,
    associated,
    finish: (body) => waiting.shift()(body),
  };
}

test("browses, explicitly selects and confirms before copying", async () => {
  const f = fixture();
  const opening = f.controller.open();
  f.finish({
    entries: [
      {
        path: "/library/old-hash",
        name: "old-hash",
        kind: "directory",
        modifiedAt: 0,
      },
    ],
  });
  await opening;
  const browsing = f.controller.browse({ directoryPath: "/library/old-hash" });
  f.finish({
    entries: [
      {
        path: "/library/old-hash/old.ass",
        name: "old.ass",
        kind: "subtitle",
        modifiedAt: 0,
      },
    ],
  });
  await browsing;
  f.controller.select({ subtitlePath: "/library/old-hash/old.ass" });
  assert.equal(f.calls.length, 2);
  assert.equal(f.messages.at(-1).status, "confirm");
  const confirming = f.controller.confirm();
  f.finish({ path: "/library/new-hash/new.ass" });
  await confirming;
  assert.equal(f.calls[2].args[0], "--associate-subtitle-json");
  assert.equal(f.associated[0][0], "/library/new-hash/new.ass");
  assert.equal(f.controller.isOpen(), false);
});

test("cancelling invalidates late browse and media change prevents copy", async () => {
  const f = fixture();
  const first = f.controller.open();
  f.controller.cancel();
  f.finish({ entries: [] });
  await first;
  assert.equal(f.messages.at(-1).status, "closed");
  const next = f.controller.open();
  f.finish({
    entries: [
      {
        path: "/library/old/old.ass",
        name: "old.ass",
        kind: "subtitle",
        modifiedAt: 0,
      },
    ],
  });
  await next;
  f.controller.select({ subtitlePath: "/library/old/old.ass" });
  f.context.mediaPath = "/other.mp4";
  await f.controller.confirm();
  assert.equal(f.calls.length, 2);
  assert.equal(f.associated.length, 0);
  assert.equal(f.messages.at(-1).status, "error");
});

test("helper errors preserve selection for retry and copy cannot be cancelled mid-write", async () => {
  const f = fixture();
  const opening = f.controller.open();
  f.finish({
    entries: [
      { path: "/library/old/old.ass", name: "old.ass", kind: "subtitle" },
    ],
  });
  await opening;
  f.controller.select({ subtitlePath: "/library/old/old.ass" });
  const copying = f.controller.confirm();
  f.controller.cancel();
  assert.equal(f.controller.isOpen(), true);
  f.finish({
    code: "subtitle.associationFailed",
    message: "Permission denied",
  });
  await copying;
  assert.equal(f.messages.at(-1).status, "error");
  assert.equal(f.messages.at(-1).subtitlePath, "/library/old/old.ass");
  assert.equal(f.associated.length, 0);
  const retry = f.controller.confirm();
  f.finish({ path: "/library/new/new.ass" });
  await retry;
  assert.equal(f.associated.length, 1);
});
