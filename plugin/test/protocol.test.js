const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ERROR_CODES,
  EVENT_TYPES,
  JOB_PHASES,
  PROTOCOL_VERSION,
  parseHelperEvent,
} = require("../protocol");

test("helper protocol v1 accepts a phase event with a stable job identity", () => {
  const event = parseHelperEvent({
    protocolVersion: PROTOCOL_VERSION,
    type: "phase",
    jobId: "job-123",
    phase: "transcribing",
    progress: 0.4,
    message: "正在转录",
  });

  assert.deepEqual(event, {
    protocolVersion: 1,
    type: "phase",
    jobId: "job-123",
    phase: "transcribing",
    progress: 0.4,
    message: "正在转录",
  });
});

test("helper protocol v1 rejects unsupported versions and unstable errors", () => {
  assert.throws(
    () => parseHelperEvent({ protocolVersion: 2, type: "cancelled", jobId: "job-123" }),
    /protocolVersion/
  );
  assert.throws(
    () => parseHelperEvent({ protocolVersion: 1, type: "error", jobId: "job-123", message: "失败" }),
    /error code/
  );
});

test("helper protocol exports the state machine vocabulary", () => {
  assert.deepEqual(EVENT_TYPES, ["phase", "completed", "cancelled", "error"]);
  assert.ok(JOB_PHASES.includes("saving"));
  assert.ok(ERROR_CODES.includes("speech.noSpeech"));
  assert.ok(ERROR_CODES.includes("ffmpeg.notFound"));
  assert.ok(ERROR_CODES.includes("subtitle.loadFailed"));
});
