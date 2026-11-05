const test = require("node:test");
const assert = require("node:assert/strict");
const { createLanguagePreflightClient } = require("../language-preflight-client");

function response(request, patch = {}) {
  return { status: 0, stdout: JSON.stringify({ ...request, speech: "installed", translation: "installed", ...patch }) };
}

test("preflight uses helper capability checks and caches only successful checks", async () => {
  const calls = [];
  const client = createLanguagePreflightClient({
    helperPath: () => "/helper", onUpdated() {},
    exec: async (file, args) => { calls.push({ file, args }); return response(JSON.parse(args[1])); },
  });
  await client.check({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(client.getState().status, "ready");
  assert.equal(calls[0].args[0], "--check-languages-json");
  await client.check({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(calls.length, 1);
  await client.check({ sourceLanguage: "en", targetLanguage: "ja" }, true);
  assert.equal(calls.length, 2);
});

test("missing and unsupported resources block generation with stable codes and permit retry", async () => {
  let translation = "supported";
  const client = createLanguagePreflightClient({ helperPath: () => "/helper", onUpdated() {},
    exec: async (_, args) => response(JSON.parse(args[1]), { translation }),
  });
  await client.check({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(client.getState().status, "unavailable");
  assert.equal(client.getState().errorCode, "translation.resourcesMissing");
  translation = "unsupported";
  await client.check({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(client.getState().errorCode, "translation.unsupportedLanguage");
  translation = "installed";
  await client.check({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(client.getState().status, "ready");
});

test("late results and failures cannot replace a newer language pair or cleared media", async () => {
  const requests = [];
  const client = createLanguagePreflightClient({ helperPath: () => "/helper", onUpdated() {},
    exec: (_, args) => new Promise((resolve) => requests.push({ request: JSON.parse(args[1]), resolve })),
  });
  const old = client.check({ sourceLanguage: "en", targetLanguage: "ja" });
  const current = client.check({ sourceLanguage: "ja", targetLanguage: "en" });
  requests[1].resolve(response(requests[1].request));
  await current;
  requests[0].resolve({ status: 1, stderr: "old error" });
  await old;
  assert.equal(client.getState().sourceLanguage, "ja");
  assert.equal(client.getState().status, "ready");
  const pending = client.check({ sourceLanguage: "en", targetLanguage: "ko" });
  client.reset();
  requests[2].resolve(response(requests[2].request));
  await pending;
  assert.equal(client.getState().status, "idle");
});

test("malformed helper response fails closed and can be retried", async () => {
  const client = createLanguagePreflightClient({ helperPath: () => "/helper", onUpdated() {},
    exec: async (_, args) => response(JSON.parse(args[1]), { requestId: "wrong" }),
  });
  await client.check({ sourceLanguage: "en", targetLanguage: "ja" });
  assert.equal(client.getState().status, "error");
});
