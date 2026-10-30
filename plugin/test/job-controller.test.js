const test = require("node:test");
const assert = require("node:assert/strict");
const { createJobController } = require("../job-controller");

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
