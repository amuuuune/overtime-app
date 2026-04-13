(function () {
  "use strict";

  const STORAGE_KEY = "overtime-records-v1";
  const MORNING_CUTOFF_HOUR = 5;
  const OVERTIME_START_TIME = "17:00";
  const OVERTIME_START_HOUR = 17;
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const BREAKS = [
    { start: "17:00", end: "17:15" },
    { start: "19:15", end: "19:30" },
  ];

  let records = [];
  let periodStart = "";
  let elements = null;

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function toYmd(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseYmd(value) {
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      return new Date(NaN);
    }
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function truncateToMinute(date) {
    const next = new Date(date);
    next.setSeconds(0, 0);
    return next;
  }

  function parseTime(value) {
    const parts = String(value).split(":").map(Number);
    if (parts.length !== 2 || parts.some(Number.isNaN)) {
      return null;
    }
    const [hours, minutes] = parts;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    return { hours, minutes };
  }

  function combineWorkDateTime(workDate, time, nextDay) {
    const parsedTime = parseTime(time);
    const baseDate = parseYmd(workDate);
    if (!parsedTime || Number.isNaN(baseDate.getTime())) {
      return new Date(NaN);
    }
    const dayOffset = nextDay ? 1 : 0;
    return new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate() + dayOffset,
      parsedTime.hours,
      parsedTime.minutes,
      0,
      0
    );
  }

  function isBeforeOvertimeStart(time) {
    const parsedTime = parseTime(time);
    if (!parsedTime) {
      return false;
    }
    return parsedTime.hours < OVERTIME_START_HOUR;
  }

  function diffMinutes(start, end) {
    return Math.floor((end.getTime() - start.getTime()) / 60000);
  }

  function overlapMinutes(start, end, breakStart, breakEnd) {
    const overlapStart = Math.max(start.getTime(), breakStart.getTime());
    const overlapEnd = Math.min(end.getTime(), breakEnd.getTime());
    if (overlapEnd <= overlapStart) {
      return 0;
    }
    return Math.floor((overlapEnd - overlapStart) / 60000);
  }

  function calculateOvertimeMinutes(workDate, clockOutDate) {
    const overtimeStart = combineWorkDateTime(workDate, OVERTIME_START_TIME, false);
    const clockOut = truncateToMinute(clockOutDate);
    if (Number.isNaN(overtimeStart.getTime()) || Number.isNaN(clockOut.getTime()) || clockOut <= overtimeStart) {
      return 0;
    }

    let minutes = diffMinutes(overtimeStart, clockOut);
    for (const breakTime of BREAKS) {
      minutes -= overlapMinutes(
        overtimeStart,
        clockOut,
        combineWorkDateTime(workDate, breakTime.start, false),
        combineWorkDateTime(workDate, breakTime.end, false)
      );
    }
    return Math.max(0, minutes);
  }

  function formatMinutes(minutes) {
    const safeMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
    if (safeMinutes < 60) {
      return `${safeMinutes}分`;
    }
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    return remainder === 0 ? `${hours}時間` : `${hours}時間${remainder}分`;
  }

  function formatInputTime(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatShortDate(value) {
    const date = parseYmd(value);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function formatDateWithWeekday(value) {
    const date = parseYmd(value);
    return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
  }

  function formatPeriod(start, end) {
    const startDate = parseYmd(start);
    const endDate = parseYmd(end);
    return `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()} - ${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()}`;
  }

  function formatClockOut(record) {
    const clockOut = new Date(record.clockOutAt);
    const clockOutDate = toYmd(clockOut);
    if (clockOutDate === record.workDate) {
      return `${formatInputTime(clockOut)} 退勤`;
    }
    return `翌日 ${formatInputTime(clockOut)} 退勤`;
  }

  function getSuggestedWorkDate(now) {
    const base = new Date(now);
    if (base.getHours() < MORNING_CUTOFF_HOUR) {
      return toYmd(addDays(base, -1));
    }
    return toYmd(base);
  }

  function getPeriodForDate(workDate) {
    const date = parseYmd(workDate);
    const start =
      date.getDate() >= 16
        ? new Date(date.getFullYear(), date.getMonth(), 16)
        : new Date(date.getFullYear(), date.getMonth() - 1, 16);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 15);
    return { start: toYmd(start), end: toYmd(end) };
  }

  function getPeriodFromStart(start) {
    const startDate = parseYmd(start);
    const end = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 15);
    return { start: toYmd(startDate), end: toYmd(end) };
  }

  function shiftPeriod(start, months) {
    const startDate = parseYmd(start);
    return toYmd(new Date(startDate.getFullYear(), startDate.getMonth() + months, 16));
  }

  function loadRecords() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((record) => record && record.workDate && record.clockOutAt)
        .map((record) => {
          const clockOut = new Date(record.clockOutAt);
          return {
            id: record.workDate,
            workDate: record.workDate,
            clockOutAt: clockOut.toISOString(),
            overtimeMinutes: calculateOvertimeMinutes(record.workDate, clockOut),
            updatedAt: record.updatedAt || clockOut.toISOString(),
          };
        })
        .filter((record) => !Number.isNaN(new Date(record.clockOutAt).getTime()))
        .sort((a, b) => a.workDate.localeCompare(b.workDate));
    } catch (error) {
      return [];
    }
  }

  function persistRecords() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function getRecordForDate(workDate) {
    return records.find((record) => record.workDate === workDate) || null;
  }

  function setStatus(message) {
    elements.statusMessage.textContent = message;
  }

  function setFormFromClockOut(workDate, clockOut) {
    elements.workDate.value = workDate;
    elements.clockOutTime.value = formatInputTime(clockOut);
  }

  function setDefaultFormNow() {
    const now = truncateToMinute(new Date());
    setFormFromClockOut(getSuggestedWorkDate(now), now);
  }

  function shouldOverwrite(workDate) {
    const existing = getRecordForDate(workDate);
    if (!existing) {
      return true;
    }
    return window.confirm(`${formatDateWithWeekday(workDate)} の記録があります。上書きしますか？`);
  }

  function saveRecord(workDate, clockOut) {
    if (!shouldOverwrite(workDate)) {
      setStatus("上書きを取り消しました。");
      return false;
    }

    const clockOutAt = truncateToMinute(clockOut);
    const nextRecord = {
      id: workDate,
      workDate,
      clockOutAt: clockOutAt.toISOString(),
      overtimeMinutes: calculateOvertimeMinutes(workDate, clockOutAt),
      updatedAt: new Date().toISOString(),
    };

    records = records
      .filter((record) => record.workDate !== workDate)
      .concat(nextRecord)
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
    persistRecords();
    periodStart = getPeriodForDate(workDate).start;
    render();
    setStatus(`${formatDateWithWeekday(workDate)}を${formatMinutes(nextRecord.overtimeMinutes)}で保存しました。`);
    return true;
  }

  function deleteRecord(workDate) {
    const record = getRecordForDate(workDate);
    if (!record) {
      return;
    }
    if (!window.confirm(`${formatDateWithWeekday(workDate)} の記録を削除しますか？`)) {
      return;
    }
    records = records.filter((item) => item.workDate !== workDate);
    persistRecords();
    render();
    setStatus(`${formatDateWithWeekday(workDate)} の記録を削除しました。`);
  }

  function getPeriodRecords() {
    const period = getPeriodFromStart(periodStart);
    return records
      .filter((record) => record.workDate >= period.start && record.workDate <= period.end)
      .sort((a, b) => b.workDate.localeCompare(a.workDate));
  }

  function renderRecord(record) {
    const item = elements.recordItemTemplate.content.firstElementChild.cloneNode(true);
    item.querySelector(".record-date").textContent = formatDateWithWeekday(record.workDate);
    item.querySelector(".record-time").textContent = formatClockOut(record);
    item.querySelector(".record-total").textContent = formatMinutes(record.overtimeMinutes);

    item.querySelector(".edit-record").addEventListener("click", () => {
      setFormFromClockOut(record.workDate, new Date(record.clockOutAt));
      setStatus(`${formatDateWithWeekday(record.workDate)}を編集中です。`);
      document.querySelector(".action-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    item.querySelector(".delete-record").addEventListener("click", () => {
      deleteRecord(record.workDate);
    });

    return item;
  }

  function renderRecordsList(periodRecords) {
    elements.recordsList.replaceChildren();
    if (periodRecords.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "まだ記録がありません。";
      elements.recordsList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const record of periodRecords) {
      fragment.append(renderRecord(record));
    }
    elements.recordsList.append(fragment);
  }

  function render() {
    const period = getPeriodFromStart(periodStart);
    const periodRecords = getPeriodRecords();
    const total = periodRecords.reduce((sum, record) => sum + record.overtimeMinutes, 0);
    const average = periodRecords.length ? Math.floor(total / periodRecords.length) : 0;

    elements.summaryHeading.textContent = formatPeriod(period.start, period.end);
    elements.totalOvertime.textContent = formatMinutes(total);
    elements.recordCount.textContent = `${periodRecords.filter((record) => record.overtimeMinutes > 0).length}日`;
    elements.averageOvertime.textContent = formatMinutes(average);
    renderRecordsList(periodRecords);
  }

  function handleClockOutNow() {
    const now = truncateToMinute(new Date());
    const workDate = getSuggestedWorkDate(now);
    const saved = saveRecord(workDate, now);
    if (saved) {
      setFormFromClockOut(workDate, now);
    }
  }

  function handleManualSubmit(event) {
    event.preventDefault();
    const workDate = elements.workDate.value;
    const clockOutTime = elements.clockOutTime.value;
    const clockOut = combineWorkDateTime(workDate, clockOutTime, isBeforeOvertimeStart(clockOutTime));

    if (Number.isNaN(clockOut.getTime())) {
      setStatus("勤務日と退勤時刻を入力してください。");
      return;
    }

    saveRecord(workDate, clockOut);
  }

  function wireEvents() {
    elements.clockOutNow.addEventListener("click", handleClockOutNow);
    elements.recordForm.addEventListener("submit", handleManualSubmit);
    elements.prevPeriod.addEventListener("click", () => {
      periodStart = shiftPeriod(periodStart, -1);
      render();
    });
    elements.nextPeriod.addEventListener("click", () => {
      periodStart = shiftPeriod(periodStart, 1);
      render();
    });
    elements.workDate.addEventListener("change", () => {
      if (elements.workDate.value) {
        periodStart = getPeriodForDate(elements.workDate.value).start;
        render();
      }
    });
  }

  function init() {
    elements = {
      clockOutNow: document.getElementById("clockOutNow"),
      recordForm: document.getElementById("recordForm"),
      workDate: document.getElementById("workDate"),
      clockOutTime: document.getElementById("clockOutTime"),
      statusMessage: document.getElementById("statusMessage"),
      prevPeriod: document.getElementById("prevPeriod"),
      nextPeriod: document.getElementById("nextPeriod"),
      summaryHeading: document.getElementById("summary-heading"),
      totalOvertime: document.getElementById("totalOvertime"),
      recordCount: document.getElementById("recordCount"),
      averageOvertime: document.getElementById("averageOvertime"),
      recordsList: document.getElementById("recordsList"),
      recordItemTemplate: document.getElementById("recordItemTemplate"),
    };

    records = loadRecords();
    setDefaultFormNow();
    periodStart = getPeriodForDate(elements.workDate.value).start;
    wireEvents();
    render();
  }

  const testApi = {
    calculateOvertimeMinutes,
    combineWorkDateTime,
    formatMinutes,
    getPeriodForDate,
    getSuggestedWorkDate,
    isBeforeOvertimeStart,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = testApi;
  }

  if (typeof window !== "undefined") {
    window.OvertimeApp = testApi;
    if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
