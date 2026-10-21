const test = require("node:test");
const assert = require("node:assert/strict");
const epic = require("../js/epic");
const duration = require("../js/duration");
const aggregate = require("../js/aggregate");

const settings = duration.normalizeSettings(null);
const today = new Date(2026, 9, 21, 12);

test("4w limit minus 1w spent gives three working weeks from today, and moves with tomorrow", () => {
  const remaining = duration.parseDuration("4w", settings).minutes - duration.parseDuration("1w", settings).minutes;
  assert.equal(epic.estimateFinish(remaining, settings, today), "2026-11-11");
  assert.equal(epic.estimateFinish(remaining, settings, new Date(2026, 9, 22, 12)), "2026-11-12");
});

test("more logged work shortens the forecast by the corresponding number of working days", () => {
  const limit = duration.parseDuration("4w", settings).minutes;
  assert.equal(epic.estimateFinish(limit - duration.parseDuration("1w", settings).minutes, settings, today), "2026-11-11");
  assert.equal(epic.estimateFinish(limit - duration.parseDuration("2w", settings).minutes, settings, today), "2026-11-04");
});

test("remaining minutes are converted with the configured workday length", () => {
  assert.equal(epic.estimateFinish(480, { hoursPerDay: 8 }, today), "2026-10-22");
  assert.equal(epic.estimateFinish(480, { hoursPerDay: 6 }, today), "2026-10-23");
  assert.equal(epic.estimateFinish(480, null, today), "2026-10-22");
});

test("forecast skips weekends and the board's excluded dates", () => {
  const friday = new Date(2026, 9, 23, 12);
  assert.equal(epic.estimateFinish(480, settings, friday), "2026-10-26");
  assert.equal(epic.estimateFinish(480, { ...settings, excludedDates: ["2026-10-26"] }, friday), "2026-10-27");
});

test("an entirely unused budget can be forecast without any activity history", () => {
  assert.equal(epic.estimateFinish(duration.parseDuration("4w", settings).minutes, settings, today), "2026-11-18");
});

test("partial days round up; exhausted, invalid and excessive budgets have no estimated date", () => {
  assert.equal(epic.estimateFinish(480, settings, today), "2026-10-22");
  assert.equal(epic.estimateFinish(481, settings, today), "2026-10-23");
  for (const remaining of [0, -1, NaN, Infinity, 3651 * 480]) {
    assert.equal(epic.estimateFinish(remaining, settings, today), "");
  }
});

test("the calendar starts at the viewer's local day even close to midnight", () => {
  assert.equal(epic.estimateFinish(480, settings, new Date(2026, 9, 21, 23, 59)), "2026-10-22");
});

test("report period boundaries do not replace today's date as the forecast anchor", () => {
  const cards = [
    { id: "epic", name: "Epic", limitMinutes: 240, entries: [], kids: ["task"] },
    { id: "task", name: "Task", entries: [
      { ymd: 20261019, minutes: 60, memberId: "me", memberName: "Me" },
      { ymd: 20261020, minutes: 60, memberId: "me", memberName: "Me" }
    ] }
  ];
  const month = aggregate.buildReport(cards, { from: "2026-10-01", to: "2026-10-31", today });
  const activity = aggregate.buildReport(cards, { from: "2026-10-19", to: "2026-10-20", today });
  assert.equal(month.epics[0].estimateDate, "2026-10-22");
  assert.equal(month.epics[0].estimateDate, activity.epics[0].estimateDate);
});
