const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleDeletionController } = require("../subtitle-deletion-controller");
function fixture() {
  const context = { mediaPath: "/synthetic.mp4", title: "Synthetic video", outputDirectoryPath: "", helperPath: "/helper", busy: false,
    files: [{ path: "/library/synthetic [en to ja].ass", sourceLanguage: "en", targetLanguage: "ja" }] };
  const messages = [], deleted = [], calls = [];
  let finish;
  const controller = createSubtitleDeletionController({ getContext: () => context, send: value => messages.push(value),
    onChanged() {}, onDeleted: path => deleted.push(path), exec: (helper, args) => { calls.push({ helper, args }); return new Promise(resolve => { finish = resolve; }); } });
  return { context, messages, deleted, calls, controller, finish: response => finish(response) };
}
test("deletion requires confirmation and updates state only after helper success", async () => {
  const f = fixture(); f.controller.open(f.context.files[0].path);
  const confirmation = f.messages.at(-1);
  assert.equal(confirmation.status, "confirm");
  assert.equal(confirmation.title, "Synthetic video");
  assert.equal(confirmation.sourceLanguage, "en");
  assert.equal(f.calls.length, 0);
  const saving = f.controller.confirm({ requestId: confirmation.requestId });
  assert.equal(f.calls.length, 1); assert.equal(f.deleted.length, 0);
  f.finish({ status: 0, stdout: JSON.stringify({ protocolVersion: 1, requestId: confirmation.requestId, path: confirmation.path }) });
  await saving; assert.deepEqual(f.deleted, [confirmation.path]);
  assert.equal(f.messages.at(-1).status, "deleted");
});
test("cancel and media switch prevent delete; permission failures preserve list", async () => {
  const f = fixture(); const path = f.context.files[0].path;
  f.controller.open(path); const first = f.messages.at(-1); f.controller.cancel();
  await f.controller.confirm({ requestId: first.requestId }); assert.equal(f.calls.length, 0);
  f.controller.open(path); const second = f.messages.at(-1); f.context.mediaPath = "/other.mp4";
  await f.controller.confirm({ requestId: second.requestId }); assert.equal(f.calls.length, 0);
  f.controller.cancel(); f.context.mediaPath = "/synthetic.mp4"; f.controller.open(path);
  const active = f.messages.at(-1); const saving = f.controller.confirm({ requestId: active.requestId });
  f.finish({ status: 0, stdout: JSON.stringify({ protocolVersion: 1, requestId: active.requestId, code: "subtitle.deleteFailed", message: "请检查字幕目录的写入权限后重试。" }) });
  await saving; assert.equal(f.messages.at(-1).status, "error"); assert.equal(f.deleted.length, 0);
  assert.equal(f.context.files.length, 1);
});
