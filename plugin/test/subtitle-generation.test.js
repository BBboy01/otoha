const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareGeneration, executeGeneration, createSubtitleImportRuntime, cancelGeneration } = require("../subtitle-generation");

test("cancellation marks pending intent before writing its marker and reports write failures", async () => {
  const order = [];
  let state = { jobId: "job", status: "running" };
  await cancelGeneration({
    jobController: { current: () => ({ cancelPath: "/tmp/job.cancel" }), requestCancel: () => order.push("intent") },
    replaceJob: (next) => { state = next; order.push(next.status); }, jobState: () => state,
    send: (name, value) => { assert.equal(name, "job"); assert.equal(value.status, "canceling"); order.push("send"); },
    utils: { exec: async (path, args) => { assert.equal(path, "/usr/bin/touch"); assert.deepEqual(args, ["/tmp/job.cancel"]); order.push("touch"); throw new Error("denied"); } },
    onError: (message) => { assert.equal(message, "无法发送取消请求：denied"); order.push("error"); },
  });
  assert.deepEqual(order, ["intent", "canceling", "send", "touch", "error"]);
  await cancelGeneration({ jobController: { current: () => null } });
});

test("generation preparation validates modes and skips audio for imported text", () => {
  const resolve = (_, id) => { assert.equal(id, 3); return 7; };
  assert.deepEqual(prepareGeneration({ generationMode: "source", sourceLanguage: "en", targetLanguage: "ja", trackId: 3 }, [], resolve),
    { generationMode: "source", sourceLanguage: "en", targetLanguage: "", streamIndex: 7 });
  assert.deepEqual(prepareGeneration({ generationMode: "translate", sourceLanguage: "en", targetLanguage: "ja", inputSubtitlePath: "/captions.srt" }, [], () => assert.fail("audio not needed")),
    { generationMode: "translate", sourceLanguage: "en", targetLanguage: "ja", streamIndex: -1 });
  for (const payload of [{ generationMode: "bad" }, { sourceLanguage: "en", targetLanguage: "en" }, { generationMode: "translate", sourceLanguage: "en", targetLanguage: "ja" }]) {
    assert.throws(() => prepareGeneration(payload, [], resolve));
  }
});

test("helper execution streams and flushes output, bounds stderr and awaits completion", async () => {
  const seen = [];
  const job = { completion: Promise.resolve().then(() => seen.push("complete")) };
  const value = await executeGeneration({
    utils: { exec: async (path, args, _, stdout, stderr) => {
      assert.equal(path, "/helper"); assert.equal(args[0], "--request-json");
      stdout("event"); stderr("x".repeat(4500)); return { status: 0 };
    } }, helperPath: "/helper", request: { jobId: "a" },
    createJsonLineParser: () => ({ push: (chunk) => seen.push(chunk), flush: () => seen.push("flush") }),
    onEvent() {}, onParseError() {}, claimedJob: job,
  });
  assert.equal(value.stderr.length, 4000);
  assert.equal(value.result.status, 0);
  assert.ok(seen.includes("event")); assert.ok(seen.includes("flush")); assert.ok(seen.includes("complete"));
});

function fixture() {
  let resolve;
  let context = { mediaPath: "/movie.mkv", outputDirectoryPath: "/library", helperPath: "/helper", busy: false };
  const started = [], errors = [], pending = [];
  const runtime = createSubtitleImportRuntime({
    getContext: () => context,
    exec: () => new Promise((callback) => { resolve = callback; }),
    start: async (payload) => started.push(payload),
    onChanged: () => pending.push(runtime.isOpen()), onError: (error) => errors.push(error),
  });
  return { runtime, started, errors, pending, resolve: (response) => resolve({ status: 0, stdout: JSON.stringify(response) }),
    set: (next) => { context = { ...context, ...next }; } };
}

test("import cancellation unlocks without launching a generation", async () => {
  const f = fixture(); const work = f.runtime.import({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(f.runtime.isOpen(), true); f.resolve({ path: null }); await work;
  assert.equal(f.runtime.isOpen(), false); assert.deepEqual(f.started, []); assert.deepEqual(f.pending, [true, false]);
});

test("import ignores a selection after media or library changes", async () => {
  for (const change of [{ mediaPath: "/other.mkv" }, { outputDirectoryPath: "/other-library" }]) {
    const f = fixture(); const work = f.runtime.import({ sourceLanguage: "en", targetLanguage: "ja" });
    f.set(change); f.resolve({ path: "/captions.srt" }); await work;
    assert.equal(f.started.length, 0); assert.equal(f.runtime.isOpen(), false);
  }
});

test("import ignores picker errors after media or library changes", async () => {
  for (const change of [{ mediaPath: "/other.mkv" }, { outputDirectoryPath: "/other-library" }]) {
    const f = fixture(); const work = f.runtime.import({ sourceLanguage: "en", targetLanguage: "ja" });
    f.set(change); f.resolve({ path: null, message: "Old picker failed" }); await work;
    assert.equal(f.errors.length, 0);
    assert.equal(f.runtime.isOpen(), false);
  }
});

test("import rejects a second picker and carries language intent to generation", async () => {
  const f = fixture(); const work = f.runtime.import({ sourceLanguage: "en", targetLanguage: "ja" });
  await f.runtime.import({}); f.resolve({ path: "/captions.srt" }); await work;
  assert.equal(f.started.length, 1);
  assert.equal(f.started[0].generationMode, "translate");
  assert.equal(f.started[0].inputSubtitlePath, "/captions.srt");
  assert.equal(f.started[0].sourceLanguage, "en");
});
