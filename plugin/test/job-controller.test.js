const test = require("node:test");
const assert = require("node:assert/strict");
const { createJobController } = require("../job-controller");

test("job timing survives phases, freezes on cancel and resets for a new job", () => {
  let now = 1000;
  const controller = createJobController({ now: () => now });
  controller.begin({ id: "first" });
  now = 61000;
  assert.equal(controller.withTiming({ jobId: "first", status: "running" }).startedAt, 1000);
  const cancelled = controller.withTiming({ jobId: "first", status: "canceling" });
  assert.equal(cancelled.finishedAt, 61000);
  now = 90000;
  assert.equal(controller.withTiming({ jobId: "first", status: "cancelled" }).finishedAt, 61000);
  assert.equal(controller.withTiming({ jobId: null, status: "idle" }).startedAt, undefined);
  controller.reset();
  controller.begin({ id: "second" });
  assert.equal(controller.withTiming({ jobId: "second", status: "running" }).startedAt, 90000);
});

test("job controller owns one active job and rejects stale identities", () => {
  const controller = createJobController();
  const job = controller.begin({
    id: "job-1",
    mediaPath: "/video.mkv",
    fileLoadedSequence: 3,
    cancelPath: "/tmp/job-1.cancel",
  });

  assert.equal(job.id, "job-1");
  assert.equal(controller.begin({ id: "job-2" }), null);
  assert.equal(controller.matches({ id: "job-1", mediaPath: "/video.mkv", fileLoadedSequence: 3 }), true);
  assert.equal(controller.matches({ id: "job-1", mediaPath: "/next.mkv", fileLoadedSequence: 3 }), false);
  assert.equal(controller.matches({ id: "job-1", mediaPath: "/video.mkv", fileLoadedSequence: 4 }), false);

  controller.markTerminal();
  assert.equal(controller.current().terminal, true);
  controller.reset();
  assert.equal(controller.current(), null);
});
