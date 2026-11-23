const test = require("node:test");
const assert = require("node:assert/strict");
const { operationCapabilities } = require("../operation-policy");

const operations = [
  "generate",
  "load",
  "edit",
  "delete",
  "associate",
  "import",
  "display",
  "style",
  "export",
  "configure",
  "preflight",
];
const cases = [
  ["generation", { jobActive: true }],
  ["running", { job: { status: "running" } }],
  ["canceling", { job: { status: "canceling" } }],
  ["loading", { job: { status: "loading" } }],
  ["edit", { editorOpen: true }],
  ["delete", { deletionOpen: true }],
  ["associate", { associationOpen: true }],
  ["import", { importOpen: true }],
];
for (const [name, state] of cases) {
  test(`${name} blocks all new operation entries`, () => {
    const capabilities = operationCapabilities(state);
    for (const operation of operations)
      assert.equal(capabilities[operation], false, operation);
  });
}
for (const [operation, flag] of [
  ["edit", "editorOpen"],
  ["delete", "deletionOpen"],
  ["associate", "associationOpen"],
  ["import", "importOpen"],
]) {
  test(`${operation} can continue its own save/confirm while blocking other sessions`, () => {
    assert.equal(
      operationCapabilities({ [flag]: true }, operation)[operation],
      true,
    );
    for (const other of operations.filter((value) => value !== operation)) {
      assert.equal(
        operationCapabilities({ [flag]: true }, operation)[other],
        false,
        other,
      );
    }
    assert.equal(
      operationCapabilities({ [flag]: true, jobActive: true }, operation)[
        operation
      ],
      false,
    );
    assert.equal(
      operationCapabilities(
        { [flag]: true, subtitleLibraryLoading: true },
        operation,
      )[operation],
      true,
    );
  });
}
test("terminal presentation does not release the generation owner until cleanup", () => {
  for (const status of ["completed", "cancelled", "error", "load-error"]) {
    assert.equal(
      operationCapabilities({ jobActive: true, job: { status } }).edit,
      false,
    );
    assert.equal(
      operationCapabilities({ jobActive: false, job: { status } }).edit,
      true,
    );
  }
});
test("idle allows operations without storing another lock", () => {
  const state = { job: { status: "idle" } };
  for (const operation of operations)
    assert.equal(operationCapabilities(state)[operation], true);
  assert.deepEqual(state, { job: { status: "idle" } });
});
