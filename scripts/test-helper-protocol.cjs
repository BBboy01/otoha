const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { createJsonLineParser } = require("../plugin/controller.js");

const input = process.argv[2];
if (!input) throw new Error("Pass a packaged helper executable or --stdin.");
let output;
if (input === "--stdin") {
  output = fs.readFileSync(0, "utf8");
} else {
  const result = spawnSync(input, ["--request-json", "{}"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  output = result.stdout;
}

const events = [];
const errors = [];
const parser = createJsonLineParser(
  (event) => events.push(event),
  (error) => errors.push(error),
);
for (const chunk of [output.slice(0, 7), output.slice(7, 31), output.slice(31)])
  parser.push(chunk);
parser.flush();
assert.deepEqual(errors, []);
assert.ok(
  events.length > 0,
  "The real Swift producer must emit at least one event",
);
if (input === "--stdin") {
  assert.deepEqual(
    events.map((event) => event.type),
    ["phase", "phase", "completed", "cancelled", "error"],
  );
  assert.ok(events.every((event) => event.jobId === "contract-job"));
  assert.equal(events[0].phase, "transcribing");
  assert.equal(events[0].progress, undefined);
  assert.equal(events[1].phase, "translating");
  assert.equal(events[1].progress, 0.4);
  assert.equal(events[2].path, "/tmp/contract.ass");
  assert.equal(events[4].code, "speech.noSpeech");
} else {
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "error");
  assert.equal(events[0].code, "helper.invalidRequest");
  assert.equal(events[0].jobId, "unknown");
}
console.log("Swift JSONL was accepted by the production JavaScript parser.");
