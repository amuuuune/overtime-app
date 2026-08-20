const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSuggestedWorkDate,
  mergeRecordsByDate,
  normalizeRecords,
} = require("../app.js");

function record(workDate, overtimeMinutes, updatedAt) {
  return {
    id: workDate,
    workDate,
    clockOutAt: `${workDate}T12:00:00.000Z`,
    overtimeMinutes,
    updatedAt,
  };
}

test("keeps a device-only record while merging cloud records", () => {
  const today = getSuggestedWorkDate(new Date());
  const otherDate = getSuggestedWorkDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const local = record(today, 90, new Date().toISOString());
  const cloud = record(otherDate, 30, new Date().toISOString());

  assert.deepEqual(
    mergeRecordsByDate([local], [cloud]).map((item) => item.workDate).sort(),
    [otherDate, today].sort()
  );
});

test("keeps the newer copy when a date exists on both sides", () => {
  const today = getSuggestedWorkDate(new Date());
  const local = record(today, 30, "2026-08-20T10:00:00.000Z");
  const cloud = record(today, 60, "2026-08-20T11:00:00.000Z");

  assert.equal(mergeRecordsByDate([local], [cloud])[0].overtimeMinutes, 60);
});

test("drops malformed records without discarding valid device records", () => {
  const today = getSuggestedWorkDate(new Date());
  const valid = record(today, 45, new Date().toISOString());

  assert.deepEqual(normalizeRecords([valid, { workDate: today, clockOutAt: "invalid" }]), [valid]);
});
