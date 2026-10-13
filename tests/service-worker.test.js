const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function worker(caches, fetch) {
  const handlers = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../service-worker.js"), "utf8"), {
    URL, caches, fetch,
    self: { location: { origin: "https://example.com" }, clients: { claim() {} }, addEventListener: (name, handler) => { handlers[name] = handler; } },
  });
  return handlers;
}

test("updates only this app's caches on a shared website origin", async () => {
  const removed = [];
  const handlers = worker({
    keys: async () => ["overtime-app-v39", "overtime-app-v40", "another-app-v1"],
    delete: async key => { removed.push(key); },
  });
  let completed;
  handlers.activate({ waitUntil: promise => { completed = promise; } });
  await completed;
  assert.deepEqual(removed, ["overtime-app-v39"]);
});

test("keeps the cached app when a server returns an error", async () => {
  const cached = { body: "previous complete app" };
  const handlers = worker({ match: async () => cached }, async () => ({ ok: false, status: 503 }));
  let response;
  handlers.fetch({
    request: { method: "GET", url: "https://example.com/overtime-app/app.js", mode: "cors", destination: "script" },
    respondWith: promise => { response = promise; },
  });
  assert.equal(await response, cached);
});
