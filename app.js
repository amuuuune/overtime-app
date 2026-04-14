(function () {
  "use strict";

  const STORAGE_KEY = "overtime-records-v1";
  const SUPABASE_URL = "https://amijlzfjamcstxchwkud.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_oHGPXeQxwEjeK7HlF9gDZQ_HA39G8y0";
  const CLOUD_TABLE = "overtime_records";
  const RETAINED_PERIODS = 12;
  const EDITABLE_PERIODS = 2;
  const NIGHT_WORK_WARNING_CUTOFF_HOUR = 5;
  const WORKDAY_START_TIME = "08:35";
  const OVERTIME_START_TIME = "17:00";
  const OVERTIME_START_HOUR = 17;
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const BREAKS = [
    { start: "17:00", end: "17:15" },
    { start: "19:15", end: "19:30" },
  ];
  const HOLIDAY_BREAKS = [
    { start: "10:00", end: "10:15" },
    { start: "11:45", end: "12:30" },
    { start: "15:00", end: "15:15" },
    ...BREAKS,
  ];

  let records = [];
  let periodStart = "";
  let selectedWorkDate = "";
  let editingWorkDate = "";
  let detailReturnScrollY = 0;
  let supabaseClient = null;
  let currentUser = null;
  let cloudBusy = false;
  let authFormOpen = false;
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

  function isNightWorkTime(time) {
    const parsedTime = parseTime(time);
    return Boolean(parsedTime && parsedTime.hours < NIGHT_WORK_WARNING_CUTOFF_HOUR);
  }

  function shouldSaveWithoutOvernight(time) {
    if (!isNightWorkTime(time)) {
      return true;
    }
    return window.confirm("深夜の退勤時刻です。日またぎ残業ではなく、この日の残業0分として記録しますか？");
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

  function calculateMinutesAfterBreaks(workDate, startTime, endDate, breakTimes) {
    const workStart = combineWorkDateTime(workDate, startTime, false);
    const workEnd = truncateToMinute(endDate);
    if (Number.isNaN(workStart.getTime()) || Number.isNaN(workEnd.getTime()) || workEnd <= workStart) {
      return 0;
    }

    let minutes = diffMinutes(workStart, workEnd);
    for (const breakTime of breakTimes) {
      minutes -= overlapMinutes(
        workStart,
        workEnd,
        combineWorkDateTime(workDate, breakTime.start, false),
        combineWorkDateTime(workDate, breakTime.end, false)
      );
    }
    return Math.max(0, minutes);
  }

  function calculateEarlyOvertimeMinutes(workDate, earlyStartTime) {
    const earlyStart = combineWorkDateTime(workDate, earlyStartTime, false);
    const workdayStart = combineWorkDateTime(workDate, WORKDAY_START_TIME, false);
    if (Number.isNaN(earlyStart.getTime()) || Number.isNaN(workdayStart.getTime()) || earlyStart >= workdayStart) {
      return 0;
    }
    return diffMinutes(earlyStart, workdayStart);
  }

  function calculateOvertimeMinutes(workDate, clockOutDate, options = {}) {
    if (options.holidayWork) {
      return calculateMinutesAfterBreaks(workDate, WORKDAY_START_TIME, clockOutDate, HOLIDAY_BREAKS);
    }

    let minutes = calculateMinutesAfterBreaks(workDate, OVERTIME_START_TIME, clockOutDate, BREAKS);
    if (options.earlyStartTime) {
      minutes += calculateEarlyOvertimeMinutes(workDate, options.earlyStartTime);
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

  function formatHoursCompact(minutes) {
    const safeMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
    const hours = safeMinutes / 60;
    return `${hours.toFixed(1).replace(/\.0$/, "")}h`;
  }

  function formatInputTime(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatShortDate(value) {
    const date = parseYmd(value);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function shouldShowChartDateLabel(workDate, hasRecord) {
    const date = parseYmd(workDate);
    const day = date.getDate();
    return hasRecord || day === 1 || day === 5 || day === 10 || day === 15 || day === 16 || day === 20 || day === 25 || day === 30;
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

  function formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${formatInputTime(date)}`;
  }

  function getSuggestedWorkDate(now) {
    return toYmd(now);
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

  function getPeriodDays(start) {
    const period = getPeriodFromStart(start);
    const days = [];
    let current = parseYmd(period.start);
    const end = parseYmd(period.end);
    while (current <= end) {
      days.push(toYmd(current));
      current = addDays(current, 1);
    }
    return days;
  }

  function shiftPeriod(start, months) {
    const startDate = parseYmd(start);
    return toYmd(new Date(startDate.getFullYear(), startDate.getMonth() + months, 16));
  }

  function getCurrentPeriodStart() {
    return getPeriodForDate(toYmd(new Date())).start;
  }

  function getRetentionStart() {
    return shiftPeriod(getCurrentPeriodStart(), -(RETAINED_PERIODS - 1));
  }

  function getEditableStart() {
    return shiftPeriod(getCurrentPeriodStart(), -(EDITABLE_PERIODS - 1));
  }

  function clampPeriodStart(start) {
    const minStart = getRetentionStart();
    const maxStart = getCurrentPeriodStart();
    if (!start || start < minStart) {
      return minStart;
    }
    if (start > maxStart) {
      return maxStart;
    }
    return start;
  }

  function canEditPeriod(start) {
    return start >= getEditableStart() && start <= getCurrentPeriodStart();
  }

  function canEditWorkDate(workDate) {
    return canEditPeriod(getPeriodForDate(workDate).start);
  }

  function getRetentionEnd() {
    return getPeriodFromStart(getCurrentPeriodStart()).end;
  }

  function pruneRecordsByRetention(recordSet) {
    const retentionStart = getRetentionStart();
    const retentionEnd = getRetentionEnd();
    return recordSet.filter((record) => record.workDate >= retentionStart && record.workDate <= retentionEnd);
  }

  function loadRecords() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return pruneRecordsByRetention(parsed
        .filter((record) => record && record.workDate && record.clockOutAt)
        .map((record) => {
          const clockOut = new Date(record.clockOutAt);
          return {
            id: record.workDate,
            workDate: record.workDate,
            clockOutAt: clockOut.toISOString(),
            overtimeMinutes: Number.isFinite(record.overtimeMinutes)
              ? Math.max(0, Math.floor(record.overtimeMinutes))
              : calculateOvertimeMinutes(record.workDate, clockOut),
            updatedAt: record.updatedAt || clockOut.toISOString(),
          };
        })
        .filter((record) => !Number.isNaN(new Date(record.clockOutAt).getTime()))
        .sort((a, b) => a.workDate.localeCompare(b.workDate)));
    } catch (error) {
      return [];
    }
  }

  function persistRecords() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function isCloudSignedIn() {
    return Boolean(supabaseClient && currentUser);
  }

  function toCloudRecord(record) {
    return {
      user_id: currentUser.id,
      work_date: record.workDate,
      clock_out_at: record.clockOutAt,
      overtime_minutes: record.overtimeMinutes,
      updated_at: record.updatedAt,
    };
  }

  function fromCloudRecord(row) {
    const clockOut = new Date(row.clock_out_at);
    return {
      id: row.work_date,
      workDate: row.work_date,
      clockOutAt: clockOut.toISOString(),
      overtimeMinutes: Number.isFinite(row.overtime_minutes)
        ? Math.max(0, Math.floor(row.overtime_minutes))
        : calculateOvertimeMinutes(row.work_date, clockOut),
      updatedAt: row.updated_at || row.clock_out_at,
    };
  }

  function recordTimestamp(record) {
    const updatedAt = new Date(record.updatedAt || record.clockOutAt).getTime();
    return Number.isNaN(updatedAt) ? 0 : updatedAt;
  }

  function mergeRecordsByDate(...recordSets) {
    const byDate = new Map();
    for (const recordSet of recordSets) {
      for (const record of recordSet) {
        const existing = byDate.get(record.workDate);
        if (!existing || recordTimestamp(record) >= recordTimestamp(existing)) {
          byDate.set(record.workDate, record);
        }
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.workDate.localeCompare(b.workDate));
  }

  function setCloudBusy(nextBusy) {
    cloudBusy = nextBusy;
    if (!elements) {
      return;
    }
    elements.toggleAuth.disabled = cloudBusy;
    elements.authSubmit.disabled = cloudBusy;
    elements.syncCloud.disabled = cloudBusy;
    elements.signOut.disabled = cloudBusy;
  }

  function renderCloudUi(message) {
    if (!elements) {
      return;
    }
    const signedIn = isCloudSignedIn();
    elements.authForm.hidden = signedIn || !supabaseClient || !authFormOpen;
    elements.toggleAuth.hidden = signedIn;
    elements.toggleAuth.textContent = authFormOpen ? "閉じる" : "ログイン";
    elements.syncCloud.hidden = !signedIn;
    elements.signOut.hidden = !signedIn;
    elements.cloudState.textContent = signedIn ? "クラウド" : "端末保存";
    if (signedIn && currentUser.email) {
      elements.authEmail.value = currentUser.email;
    }
    elements.cloudMessage.hidden = !message;
    elements.cloudMessage.textContent = message || "";
  }

  function cloudErrorMessage(action, error) {
    return `${action}に失敗しました。SupabaseのSQL作成やログインURL設定を確認してください。${error && error.message ? `（${error.message}）` : ""}`;
  }

  async function syncRecordToCloud(record) {
    if (!isCloudSignedIn()) {
      return true;
    }
    const { error } = await supabaseClient
      .from(CLOUD_TABLE)
      .upsert([toCloudRecord(record)], { onConflict: "user_id,work_date" });
    if (error) {
      setStatus(cloudErrorMessage("クラウド保存", error));
      renderCloudUi(cloudErrorMessage("クラウド保存", error));
      return false;
    }
    renderCloudUi();
    return true;
  }

  async function deleteRecordFromCloud(workDate) {
    if (!isCloudSignedIn()) {
      return true;
    }
    const { error } = await supabaseClient
      .from(CLOUD_TABLE)
      .delete()
      .eq("user_id", currentUser.id)
      .eq("work_date", workDate);
    if (error) {
      setStatus(cloudErrorMessage("クラウド削除", error));
      renderCloudUi(cloudErrorMessage("クラウド削除", error));
      return false;
    }
    renderCloudUi();
    return true;
  }

  async function syncCloudRecords() {
    if (!isCloudSignedIn()) {
      renderCloudUi();
      return false;
    }
    setCloudBusy(true);
    renderCloudUi("Supabaseと同期中です。");
    try {
      const retentionStart = getRetentionStart();
      const retentionEnd = getRetentionEnd();
      const { error: pruneError } = await supabaseClient
        .from(CLOUD_TABLE)
        .delete()
        .eq("user_id", currentUser.id)
        .lt("work_date", retentionStart);
      if (pruneError) {
        renderCloudUi(cloudErrorMessage("古いクラウド記録の削除", pruneError));
        return false;
      }

      const { data, error } = await supabaseClient
        .from(CLOUD_TABLE)
        .select("work_date, clock_out_at, overtime_minutes, updated_at")
        .gte("work_date", retentionStart)
        .lte("work_date", retentionEnd)
        .order("work_date", { ascending: true });
      if (error) {
        renderCloudUi(cloudErrorMessage("クラウド読み込み", error));
        return false;
      }

      const cloudRecords = (data || [])
        .map(fromCloudRecord)
        .filter((record) => !Number.isNaN(new Date(record.clockOutAt).getTime()));
      records = pruneRecordsByRetention(mergeRecordsByDate(records, cloudRecords));
      persistRecords();

      if (records.length > 0) {
        const { error: upsertError } = await supabaseClient
          .from(CLOUD_TABLE)
          .upsert(records.map(toCloudRecord), { onConflict: "user_id,work_date" });
        if (upsertError) {
          renderCloudUi(cloudErrorMessage("クラウド同期", upsertError));
          render();
          return false;
        }
      }

      render();
      renderCloudUi();
      return true;
    } finally {
      setCloudBusy(false);
    }
  }

  async function applySession(session) {
    currentUser = session && session.user ? session.user : null;
    if (!currentUser) {
      authFormOpen = false;
      renderCloudUi();
      return;
    }
    authFormOpen = false;
    renderCloudUi(`${currentUser.email || "ログイン中"} でログインしました。同期します。`);
    await syncCloudRecords();
  }

  async function initCloud() {
    if (!window.supabase || !window.supabase.createClient) {
      renderCloudUi("Supabase機能を読み込めませんでした。ネットワーク接続後に再読み込みしてください。");
      return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    renderCloudUi();

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      renderCloudUi(cloudErrorMessage("ログイン状態の確認", error));
    } else {
      await applySession(data.session);
    }

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        applySession(session);
      }, 0);
    });
  }

  function getRecordForDate(workDate) {
    return records.find((record) => record.workDate === workDate) || null;
  }

  function setStatus(message) {
    elements.statusMessage.textContent = message;
  }

  function setEditingMode(workDate) {
    editingWorkDate = workDate || "";
    elements.cancelEdit.hidden = !editingWorkDate;
  }

  function setFormFromClockOut(workDate, clockOut) {
    elements.workDate.value = workDate;
    elements.clockOutTime.value = formatInputTime(clockOut);
  }

  function setWorkDateBounds() {
    elements.workDate.min = getEditableStart();
    elements.workDate.max = toYmd(new Date());
  }

  function updateSpecialOptions() {
    const showEarlyStart = elements.earlyWork.checked && !elements.holidayWork.checked;
    elements.earlyStartField.hidden = !showEarlyStart;
    elements.earlyStartTime.disabled = !showEarlyStart;
    elements.earlyWork.disabled = elements.holidayWork.checked;
    if (elements.holidayWork.checked) {
      elements.earlyWork.checked = false;
    }
  }

  function resetSpecialOptions() {
    elements.overnightWork.checked = false;
    elements.holidayWork.checked = false;
    elements.earlyWork.checked = false;
    elements.earlyStartTime.value = "08:00";
    updateSpecialOptions();
  }

  function getSpecialOptions() {
    return {
      nextDay: elements.overnightWork.checked,
      holidayWork: elements.holidayWork.checked,
      earlyStartTime: elements.earlyWork.checked && !elements.holidayWork.checked ? elements.earlyStartTime.value : "",
    };
  }

  function setDefaultFormNow() {
    const now = truncateToMinute(new Date());
    setFormFromClockOut(getSuggestedWorkDate(now), now);
    resetSpecialOptions();
  }

  function shouldOverwrite(workDate, skipConfirm) {
    const existing = getRecordForDate(workDate);
    if (!existing || skipConfirm) {
      return true;
    }
    return window.confirm(`${formatDateWithWeekday(workDate)} の記録があります。上書きしますか？`);
  }

  async function saveRecord(workDate, clockOut, options = {}) {
    if (workDate > toYmd(new Date())) {
      setStatus("未来日は保存できません。");
      return false;
    }
    if (workDate < getRetentionStart() || workDate > getRetentionEnd()) {
      setStatus("保存できるのは直近1年分までです。");
      return false;
    }
    if (!canEditWorkDate(workDate)) {
      setStatus("この期間は確定済みのため、修正できません。");
      return false;
    }
    if (!shouldOverwrite(workDate, options.skipConfirm)) {
      setStatus("上書きを取り消しました。");
      return false;
    }

    const clockOutAt = truncateToMinute(clockOut);
    if (clockOutAt > truncateToMinute(new Date())) {
      setStatus("未来の退勤時刻は保存できません。");
      return false;
    }
    const nextRecord = {
      id: workDate,
      workDate,
      clockOutAt: clockOutAt.toISOString(),
      overtimeMinutes: calculateOvertimeMinutes(workDate, clockOutAt, options.overtimeOptions || {}),
      updatedAt: new Date().toISOString(),
    };

    records = records
      .filter((record) => record.workDate !== workDate)
      .concat(nextRecord)
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
    records = pruneRecordsByRetention(records);
    persistRecords();
    periodStart = getPeriodForDate(workDate).start;
    render();
    setEditingMode("");
    setStatus(`${formatDateWithWeekday(workDate)}を${formatMinutes(nextRecord.overtimeMinutes)}で保存しました。`);
    if (isCloudSignedIn()) {
      setStatus(`${formatDateWithWeekday(workDate)}を保存しました。クラウドへ同期中です。`);
      const synced = await syncRecordToCloud(nextRecord);
      setStatus(
        synced
          ? `${formatDateWithWeekday(workDate)}を${formatMinutes(nextRecord.overtimeMinutes)}でクラウド保存しました。`
          : `${formatDateWithWeekday(workDate)}をこの端末に保存しました。クラウド同期は失敗しました。`
      );
    }
    return true;
  }

  async function deleteRecord(workDate) {
    const record = getRecordForDate(workDate);
    if (!record) {
      return false;
    }
    if (!canEditWorkDate(workDate)) {
      setStatus("この期間は確定済みのため、削除できません。");
      return false;
    }
    if (!window.confirm(`${formatDateWithWeekday(workDate)} の記録を削除しますか？`)) {
      return false;
    }
    if (!(await deleteRecordFromCloud(workDate))) {
      return false;
    }
    records = records.filter((item) => item.workDate !== workDate);
    persistRecords();
    render();
    setStatus(`${formatDateWithWeekday(workDate)} の記録を削除しました。`);
    return true;
  }

  function getPeriodRecords() {
    const period = getPeriodFromStart(periodStart);
    return records
      .filter((record) => record.workDate >= period.start && record.workDate <= period.end)
      .sort((a, b) => b.workDate.localeCompare(a.workDate));
  }

  function getRecordsForPeriod(start) {
    const period = getPeriodFromStart(start);
    return records.filter((record) => record.workDate >= period.start && record.workDate <= period.end);
  }

  function getTrendPeriods() {
    const periods = [];
    const currentStart = getCurrentPeriodStart();
    for (let offset = RETAINED_PERIODS - 1; offset >= 0; offset -= 1) {
      const start = shiftPeriod(currentStart, -offset);
      const period = getPeriodFromStart(start);
      const periodRecords = getRecordsForPeriod(start);
      periods.push({
        start: period.start,
        end: period.end,
        total: periodRecords.reduce((sum, record) => sum + record.overtimeMinutes, 0),
      });
    }
    return periods;
  }

  function renderRecord(record) {
    const item = elements.recordItemTemplate.content.firstElementChild.cloneNode(true);
    item.querySelector(".record-date").textContent = `${formatShortDate(record.workDate)}（${WEEKDAYS[parseYmd(record.workDate).getDay()]}）`;
    item.querySelector(".record-time").textContent = formatClockOut(record).replace(" 退勤", "");
    item.querySelector(".record-total").textContent = formatMinutes(record.overtimeMinutes);
    item.addEventListener("click", () => {
      showDetail(record.workDate);
    });

    return item;
  }

  function renderChart(periodRecords) {
    elements.recordsChart.replaceChildren();
    elements.recordsChart.hidden = false;
    const periodEditable = canEditPeriod(periodStart);
    const recordMap = new Map(periodRecords.map((record) => [record.workDate, record]));
    const dayEntries = getPeriodDays(periodStart).map((workDate) => {
      const record = recordMap.get(workDate) || null;
      return {
        workDate,
        record,
        overtimeMinutes: record ? record.overtimeMinutes : 0,
      };
    });
    const maxMinutes = Math.max(...dayEntries.map((entry) => entry.overtimeMinutes), 1);
    const scroll = document.createElement("div");
    scroll.className = "chart-scroll";
    scroll.style.setProperty("--period-days", String(dayEntries.length));

    for (const entry of dayEntries) {
      const bar = document.createElement(entry.record && periodEditable ? "button" : "span");
      const height = entry.overtimeMinutes > 0 ? Math.max(3, Math.round((entry.overtimeMinutes / maxMinutes) * 100)) : 0;
      bar.className = `chart-bar ${entry.record ? "has-record" : "is-missing"} ${entry.overtimeMinutes === 0 ? "is-zero" : ""}`;
      if (entry.record && periodEditable) {
        bar.type = "button";
        bar.setAttribute("aria-label", `${formatDateWithWeekday(entry.workDate)} ${formatMinutes(entry.overtimeMinutes)}`);
        bar.title = `${formatDateWithWeekday(entry.workDate)} ${formatMinutes(entry.overtimeMinutes)}`;
        bar.addEventListener("click", () => {
          showDetail(entry.workDate);
        });
      } else if (!entry.record) {
        bar.setAttribute("aria-label", `${formatDateWithWeekday(entry.workDate)} 未打刻`);
        bar.title = `${formatDateWithWeekday(entry.workDate)} 未打刻`;
      } else {
        bar.setAttribute("aria-label", `${formatDateWithWeekday(entry.workDate)} ${formatMinutes(entry.overtimeMinutes)} 確定済み`);
        bar.title = `${formatDateWithWeekday(entry.workDate)} ${formatMinutes(entry.overtimeMinutes)} 確定済み`;
      }

      const track = document.createElement("span");
      track.className = "bar-track";
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.style.height = `${height}%`;
      track.append(fill);

      const label = document.createElement("span");
      label.className = "bar-label";
      label.textContent = shouldShowChartDateLabel(entry.workDate, Boolean(entry.record))
        ? String(parseYmd(entry.workDate).getDate())
        : "";

      bar.append(track, label);
      scroll.append(bar);
    }

    const note = document.createElement("p");
    note.className = "chart-note";
    note.textContent = periodEditable
      ? "記録済みの日は棒をタップすると詳細を確認できます。"
      : "この期間は確定済みのため、修正用のタップ操作はありません。";
    elements.recordsChart.append(scroll, note);
  }

  function renderTrendChart() {
    const periods = getTrendPeriods();
    const maxTotal = Math.max(...periods.map((period) => period.total), 1);
    const fragment = document.createDocumentFragment();

    elements.trendChart.replaceChildren();
    for (const period of periods) {
      const bar = document.createElement("button");
      const height = period.total > 0 ? Math.max(4, Math.round((period.total / maxTotal) * 100)) : 0;
      bar.className = `trend-bar ${period.start === periodStart ? "is-current" : ""} ${period.total === 0 ? "is-zero" : ""}`;
      bar.type = "button";
      bar.setAttribute("aria-label", `${formatPeriod(period.start, period.end)} ${formatMinutes(period.total)}`);
      bar.title = `${formatPeriod(period.start, period.end)} ${formatMinutes(period.total)}`;
      bar.addEventListener("click", () => {
        periodStart = period.start;
        render();
      });

      const total = document.createElement("span");
      total.className = "trend-total";
      total.textContent = formatHoursCompact(period.total);

      const track = document.createElement("span");
      track.className = "trend-track";
      const fill = document.createElement("span");
      fill.className = "trend-fill";
      fill.style.height = `${height}%`;
      track.append(fill);

      const label = document.createElement("span");
      label.className = "trend-label";
      label.textContent = `${parseYmd(period.start).getMonth() + 1}月`;

      bar.append(total, track, label);
      fragment.append(bar);
    }
    elements.trendChart.append(fragment);
  }

  function renderRecordsList(periodRecords) {
    elements.recordsList.replaceChildren();
    const periodEditable = canEditPeriod(periodStart);
    elements.recordsModeNote.hidden = periodEditable;
    elements.recordsModeNote.textContent = periodEditable
      ? ""
      : "2カ月前になった期間は確定済みとして、一覧と修正・削除を表示しません。";
    elements.recordsHint.textContent = periodEditable ? "行をタップして修正・削除" : "確定済み";
    elements.recordsList.hidden = !periodEditable;
    if (!periodEditable) {
      return;
    }
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
    periodStart = clampPeriodStart(periodStart);
    setWorkDateBounds();
    const period = getPeriodFromStart(periodStart);
    const periodRecords = getPeriodRecords();
    const overtimeRecords = periodRecords.filter((record) => record.overtimeMinutes > 0);
    const total = periodRecords.reduce((sum, record) => sum + record.overtimeMinutes, 0);
    const average = periodRecords.length ? Math.floor(total / periodRecords.length) : 0;

    elements.summaryHeading.textContent = formatPeriod(period.start, period.end);
    elements.totalOvertime.textContent = formatMinutes(total);
    elements.recordCount.textContent = `${overtimeRecords.length}日`;
    elements.averageOvertime.textContent = formatMinutes(average);
    elements.prevPeriod.disabled = periodStart <= getRetentionStart();
    elements.nextPeriod.disabled = periodStart >= getCurrentPeriodStart();
    renderTrendChart();
    renderChart(periodRecords);
    renderRecordsList(periodRecords);
    if (selectedWorkDate && !getRecordForDate(selectedWorkDate)) {
      selectedWorkDate = "";
    }
  }

  function showHome(options = {}) {
    const scrollY = options.restoreScroll ? detailReturnScrollY : 0;
    elements.detailView.hidden = true;
    elements.homeView.hidden = false;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: options.restoreScroll ? "auto" : "smooth" });
    });
  }

  function showDetail(workDate) {
    if (!canEditWorkDate(workDate)) {
      setStatus("この期間は確定済みのため、詳細修正画面は表示しません。");
      return;
    }
    selectedWorkDate = workDate;
    const record = getRecordForDate(workDate);
    if (!record) {
      return;
    }
    elements.detailHeading.textContent = formatDateWithWeekday(record.workDate);
    elements.detailClockOut.textContent = formatClockOut(record);
    elements.detailOvertime.textContent = formatMinutes(record.overtimeMinutes);
    elements.detailUpdated.textContent = formatTimestamp(record.updatedAt);
    detailReturnScrollY = window.scrollY;
    elements.homeView.hidden = true;
    elements.detailView.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editSelectedRecord() {
    const record = getRecordForDate(selectedWorkDate);
    if (!record) {
      showHome();
      return;
    }
    if (!canEditWorkDate(record.workDate)) {
      setStatus("この期間は確定済みのため、修正できません。");
      showHome({ restoreScroll: true });
      return;
    }
    setFormFromClockOut(record.workDate, new Date(record.clockOutAt));
    resetSpecialOptions();
    setEditingMode(record.workDate);
    showHome();
    setStatus(`${formatDateWithWeekday(record.workDate)}を修正中です。`);
    elements.workDate.focus({ preventScroll: true });
  }

  function cancelEdit() {
    setEditingMode("");
    setDefaultFormNow();
    setStatus("修正をキャンセルしました。");
  }

  async function deleteSelectedRecord() {
    if (await deleteRecord(selectedWorkDate)) {
      selectedWorkDate = "";
      setEditingMode("");
      showHome({ restoreScroll: true });
    }
  }

  async function handleClockOutNow() {
    const now = truncateToMinute(new Date());
    const overtimeOptions = getSpecialOptions();
    if (!overtimeOptions.nextDay && !shouldSaveWithoutOvernight(formatInputTime(now))) {
      setStatus("保存を取り消しました。日またぎ残業の場合は特殊な勤務から選んでください。");
      return;
    }
    const workDate = overtimeOptions.nextDay ? toYmd(addDays(now, -1)) : getSuggestedWorkDate(now);
    const clockOut = now;

    const saved = await saveRecord(workDate, clockOut, { overtimeOptions });
    if (saved) {
      setFormFromClockOut(workDate, clockOut);
      resetSpecialOptions();
    }
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    const workDate = elements.workDate.value;
    const clockOutTime = elements.clockOutTime.value;
    const overtimeOptions = getSpecialOptions();
    if (!overtimeOptions.nextDay && !shouldSaveWithoutOvernight(clockOutTime)) {
      setStatus("保存を取り消しました。日またぎ残業の場合は特殊な勤務から選んでください。");
      return;
    }
    const clockOut = combineWorkDateTime(workDate, clockOutTime, overtimeOptions.nextDay);

    if (Number.isNaN(clockOut.getTime())) {
      setStatus("勤務日と退勤時刻を入力してください。");
      return;
    }

    if (await saveRecord(workDate, clockOut, { skipConfirm: editingWorkDate === workDate, overtimeOptions })) {
      resetSpecialOptions();
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!supabaseClient) {
      renderCloudUi("Supabase機能を読み込めませんでした。再読み込みしてください。");
      return;
    }
    const email = elements.authEmail.value.trim();
    if (!email) {
      renderCloudUi("メールアドレスを入力してください。");
      return;
    }

    setCloudBusy(true);
    renderCloudUi("ログインメールを送信中です。");
    try {
      const redirectTo = new URL("./", window.location.href).href;
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true,
        },
      });
      if (!error) {
        authFormOpen = false;
      }
      renderCloudUi(
        error
          ? cloudErrorMessage("ログインメール送信", error)
          : "ログインメールを送りました。同じスマホでメール内のリンクを開いてください。"
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleSignOut() {
    if (!supabaseClient) {
      return;
    }
    setCloudBusy(true);
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        renderCloudUi(cloudErrorMessage("ログアウト", error));
        return;
      }
      currentUser = null;
      authFormOpen = false;
      renderCloudUi("ログアウトしました。未ログイン中はこの端末に保存します。");
    } finally {
      setCloudBusy(false);
    }
  }

  function toggleAuthForm() {
    authFormOpen = !authFormOpen;
    renderCloudUi(authFormOpen ? "メールのリンクを同じスマホで開くとログインできます。" : "");
    if (authFormOpen) {
      elements.authEmail.focus({ preventScroll: true });
    }
  }

  function wireEvents() {
    elements.clockOutNow.addEventListener("click", handleClockOutNow);
    elements.recordForm.addEventListener("submit", handleManualSubmit);
    elements.toggleAuth.addEventListener("click", toggleAuthForm);
    elements.authForm.addEventListener("submit", handleAuthSubmit);
    elements.syncCloud.addEventListener("click", syncCloudRecords);
    elements.signOut.addEventListener("click", handleSignOut);
    elements.holidayWork.addEventListener("change", updateSpecialOptions);
    elements.earlyWork.addEventListener("change", updateSpecialOptions);
    elements.backToList.addEventListener("click", () => {
      showHome({ restoreScroll: true });
    });
    elements.editSelectedRecord.addEventListener("click", editSelectedRecord);
    elements.deleteSelectedRecord.addEventListener("click", deleteSelectedRecord);
    elements.cancelEdit.addEventListener("click", cancelEdit);
    elements.prevPeriod.addEventListener("click", () => {
      periodStart = clampPeriodStart(shiftPeriod(periodStart, -1));
      render();
    });
    elements.nextPeriod.addEventListener("click", () => {
      periodStart = clampPeriodStart(shiftPeriod(periodStart, 1));
      render();
    });
    elements.workDate.addEventListener("change", () => {
      if (elements.workDate.value) {
        periodStart = clampPeriodStart(getPeriodForDate(elements.workDate.value).start);
        render();
      }
    });
  }

  function init() {
    elements = {
      homeView: document.getElementById("homeView"),
      detailView: document.getElementById("detailView"),
      cloudState: document.getElementById("cloudState"),
      cloudMessage: document.getElementById("cloudMessage"),
      toggleAuth: document.getElementById("toggleAuth"),
      authForm: document.getElementById("authForm"),
      authEmail: document.getElementById("authEmail"),
      authSubmit: document.getElementById("authSubmit"),
      syncCloud: document.getElementById("syncCloud"),
      signOut: document.getElementById("signOut"),
      clockOutNow: document.getElementById("clockOutNow"),
      recordForm: document.getElementById("recordForm"),
      workDate: document.getElementById("workDate"),
      clockOutTime: document.getElementById("clockOutTime"),
      overnightWork: document.getElementById("overnightWork"),
      holidayWork: document.getElementById("holidayWork"),
      earlyWork: document.getElementById("earlyWork"),
      earlyStartField: document.getElementById("earlyStartField"),
      earlyStartTime: document.getElementById("earlyStartTime"),
      cancelEdit: document.getElementById("cancelEdit"),
      statusMessage: document.getElementById("statusMessage"),
      prevPeriod: document.getElementById("prevPeriod"),
      nextPeriod: document.getElementById("nextPeriod"),
      summaryHeading: document.getElementById("summary-heading"),
      totalOvertime: document.getElementById("totalOvertime"),
      recordCount: document.getElementById("recordCount"),
      averageOvertime: document.getElementById("averageOvertime"),
      trendChart: document.getElementById("trendChart"),
      recordsChart: document.getElementById("recordsChart"),
      recordsHint: document.getElementById("recordsHint"),
      recordsModeNote: document.getElementById("recordsModeNote"),
      recordsList: document.getElementById("recordsList"),
      recordItemTemplate: document.getElementById("recordItemTemplate"),
      backToList: document.getElementById("backToList"),
      detailHeading: document.getElementById("detail-heading"),
      detailClockOut: document.getElementById("detailClockOut"),
      detailOvertime: document.getElementById("detailOvertime"),
      detailUpdated: document.getElementById("detailUpdated"),
      editSelectedRecord: document.getElementById("editSelectedRecord"),
      deleteSelectedRecord: document.getElementById("deleteSelectedRecord"),
    };

    records = loadRecords();
    persistRecords();
    setDefaultFormNow();
    periodStart = clampPeriodStart(getPeriodForDate(elements.workDate.value).start);
    wireEvents();
    render();
    initCloud();
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
