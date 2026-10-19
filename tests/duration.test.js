const test = require("node:test");
const assert = require("node:assert/strict");
const duration = require("../js/duration");

const settings = { hoursPerDay: 8, daysPerWeek: 5, weekStartsOn: 1 };

test("parses the formats used on cards", function () {
  assert.equal(duration.parseDuration("30m", settings).minutes, 30);
  assert.equal(duration.parseDuration("1h", settings).minutes, 60);
  assert.equal(duration.parseDuration("1h 40m", settings).minutes, 100);
  assert.equal(duration.parseDuration("1h40m", settings).minutes, 100);
  assert.equal(duration.parseDuration("1.5h", settings).minutes, 90);
  assert.equal(duration.parseDuration("1,5h", settings).minutes, 90);
  assert.equal(duration.parseDuration("1:40", settings).minutes, 100);
  assert.equal(duration.parseDuration("1d", settings).minutes, 480);
  assert.equal(duration.parseDuration("1w", settings).minutes, 2400);
  assert.equal(duration.parseDuration("1w 2d 3h 15m", settings).minutes, 2400 + 960 + 180 + 15);
  assert.equal(duration.parseDuration("1ч 30мин", settings).minutes, 90);
  assert.equal(duration.parseDuration("2д 3ч", settings).minutes, 1140);
  assert.equal(duration.parseDuration("1нед", settings).minutes, 2400);
});

test("rejects incomplete and unknown durations", function () {
  assert.equal(duration.parseDuration("1h 40", settings).ok, false);
  assert.equal(duration.parseDuration("soon", settings).ok, false);
  assert.equal(duration.parseDuration("0m", settings).ok, false);
  assert.equal(duration.parseDuration("", settings).ok, false);
});

test("formats minutes back into mixed units", function () {
  assert.equal(duration.formatDuration(30, settings), "30m");
  assert.equal(duration.formatDuration(60, settings), "1h");
  assert.equal(duration.formatDuration(100, settings), "1h 40m");
  assert.equal(duration.formatDuration(480, settings), "1d");
  assert.equal(duration.formatDuration(2400, settings), "1w");
  assert.equal(duration.formatDuration(3860, settings), "1w 3d 20m");
  assert.equal(duration.formatDuration(0, settings), "0m");
});

test("uses board settings for a day and a week", function () {
  const custom = { hoursPerDay: 6, daysPerWeek: 4, weekStartsOn: 1 };
  assert.equal(duration.parseDuration("1d", custom).minutes, 360);
  assert.equal(duration.parseDuration("1w", custom).minutes, 1440);
  assert.equal(duration.formatDuration(360, custom), "1d");
  assert.deepEqual(duration.normalizeSettings({ hoursPerDay: 0, daysPerWeek: 9, weekStartsOn: 0 }), {
    hoursPerDay: 1,
    daysPerWeek: 7,
    weekStartsOn: 0
  });
});

test("current week starts on Monday by default", function () {
  const monday = new Date(2026, 9, 19);
  assert.deepEqual(duration.periodRange("week", monday, settings), {
    from: "2026-10-19",
    to: "2026-10-25"
  });
  assert.deepEqual(duration.periodRange("last-week", monday, settings), {
    from: "2026-10-12",
    to: "2026-10-18"
  });
  assert.deepEqual(duration.periodRange("month", monday, settings), {
    from: "2026-10-01",
    to: "2026-10-31"
  });
  assert.deepEqual(duration.periodRange("week", monday, { weekStartsOn: 0 }), {
    from: "2026-10-18",
    to: "2026-10-24"
  });
});
