const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadApp(values = new Map(), navigator = {}) {
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const context = {
    module: { exports: {} },
    window: { localStorage: storage, location: { protocol: "file:" } },
    navigator,
    document: { readyState: "loading", addEventListener() {} },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../app.js"), "utf8"), context);
  return { app: context.module.exports, storage };
}

function record() {
  const workDate = new Date().toLocaleDateString("sv-SE");
  return { id: workDate, workDate, clockOutAt: `${workDate}T09:00:00.000Z`, overtimeMinutes: 45, updatedAt: new Date().toISOString() };
}

function backup(records = [record()], earlyStarts = {}) {
  return JSON.stringify({ format: "overtime-backup", version: 1, records, earlyStarts });
}

test("validates the whole backup before restoring any records", () => {
  const { app } = loadApp();
  const valid = record();
  assert.equal(app.parseBackup(backup()).records.length, 1);
  for (const bad of [
    { ...valid, workDate: "2026-02-30" },
    { ...valid, clockOutAt: "broken" },
    { ...valid, overtimeMinutes: -1 },
    { ...valid, overtimeMinutes: 1.5 },
    { ...valid, updatedAt: "broken" },
  ]) {
    assert.throws(() => app.parseBackup(backup([valid, bad])));
  }
  assert.throws(() => app.parseBackup(backup([valid, valid])));
  assert.throws(() => app.parseBackup(backup([valid], { [valid.workDate]: "25:00" })));
  assert.throws(() => app.parseBackup(backup([valid], { [valid.workDate]: "08:35" })));
  assert.throws(() => app.parseBackup('{"format":"other","version":1,"records":[],"earlyStarts":{}}'));
});

test("saves the punch and pending early start in one durable write", () => {
  const values = new Map();
  const { app, storage } = loadApp(values);
  let writes = 0;
  const setItem = storage.setItem;
  storage.setItem = (key, value) => { writes++; setItem(key, value); };
  const valid = record();
  app.persistState([valid], { [valid.workDate]: "08:00" });
  assert.equal(writes, 1);
  assert.equal(app.readState().earlyStarts[valid.workDate], "08:00");
  const previous = JSON.stringify(app.createBackup().records);
  storage.setItem = () => { throw new Error("Disk full"); };
  assert.throws(() => app.persistState([], {}), /Disk full/);
  assert.equal(JSON.stringify(app.createBackup().records), previous);
  assert.equal(app.readState().records.length, 1);
  assert.equal(app.readState().earlyStarts[valid.workDate], "08:00");
});

test("keeps old browser records and never resurrects a deliberately deleted record", () => {
  const values = new Map([
    ["overtime-records-v1", JSON.stringify([record()])],
    ["overtime-records-recovery-v1", JSON.stringify([record()])],
  ]);
  const { app } = loadApp(values);
  assert.equal(app.readState().records.length, 1);
  app.persistState([], {});
  assert.equal(app.readState().records.length, 0);
  assert.equal(JSON.parse(values.get("overtime-records-v1")).length, 1);
  values.set("overtime-state-v1", "broken");
  assert.throws(() => app.readState());
});

test("requests durable browser storage without blocking use when unavailable or refused", async () => {
  assert.equal(await loadApp().app.requestPersistentStorage(), false);
  const available = { storage: { persist: async () => true } };
  assert.equal(await loadApp(new Map(), available).app.requestPersistentStorage(), true);
  available.storage.persist = async () => false;
  assert.equal(await loadApp(new Map(), available).app.requestPersistentStorage(), false);
  available.storage.persist = async () => { throw new Error("Storage denied"); };
  assert.equal(await loadApp(new Map(), available).app.requestPersistentStorage(), false);
});
