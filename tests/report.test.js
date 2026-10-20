const test = require("node:test");
const assert = require("node:assert/strict");
const epic = require("../js/epic");
const aggregate = require("../js/aggregate");
const badgeApi = require("../js/badges");
const excel = require("../js/excel");
const duration = require("../js/duration");

test("reads child cards from checklist links and ignores loose items", function () {
  const parsed = epic.childIdsFromChecklists([
    {
      checkItems: [
        { idCard: "design", name: "Макеты" },
        { idCard: "design", name: "Макеты ещё раз" },
        { idCard: "epic", name: "сам эпик" },
        { name: "просто текст" },
        { name: "смотри https://trello.com/c/abc123/1-api" }
      ]
    }
  ], "epic", new Map([["abc123", "api"]]));
  assert.deepEqual(parsed.childIds, ["design", "api"]);
  assert.equal(parsed.unlinkedCount, 1);
});

test("does not treat a missing checklist field as an empty epic", function () {
  assert.equal(epic.inspectChecklists(undefined, "epic").complete, false);
  assert.equal(epic.inspectChecklists([], "epic").complete, true);
  assert.deepEqual(epic.inspectChecklists([], "epic").childIds, []);
  assert.equal(epic.inspectChecklists([{ name: "Дела" }], "epic").complete, false);
});

test("detects checklist shells that need a remote fetch", function () {
  const shell = epic.inspectChecklists([{ checkItems: [] }], "epic");
  assert.equal(shell.complete, true);
  assert.equal(epic.needsRemoteChecklists(shell, [{ checkItems: [] }]), true);
  assert.equal(epic.needsRemoteChecklists(epic.inspectChecklists([], "epic"), []), false);
  const linked = epic.inspectChecklists([{ checkItems: [{ idCard: "child" }] }], "epic");
  assert.equal(epic.needsRemoteChecklists(linked, [{ checkItems: [{ idCard: "child" }] }]), false);
  const stripped = epic.inspectChecklists([{ checkItems: [{ name: "Subtask", state: "incomplete" }] }], "epic");
  assert.equal(epic.needsRemoteChecklists(stripped, [{ checkItems: [{ name: "Subtask" }] }]), true);
});

test("reads card id from nested checklist item card objects", function () {
  assert.equal(epic.cardIdFromCheckItem({ card: { id: "child" } }), "child");
  assert.deepEqual(epic.childIdsFromChecklists([{ checkItems: [{ card: { id: "child" } }] }], "epic"), {
    childIds: ["child"],
    unlinkedCount: 0,
    unresolvedCount: 0
  });
});

function fixture() {
  return [
    {
      id: "epic",
      name: "Релиз 1.0",
      url: "https://trello.com/c/epic",
      listName: "Эпики",
      labels: [{ id: "release", name: "Release", color: "purple" }],
      entries: [],
      limitMinutes: 4800,
      kids: ["design", "api"],
      missing: false
    },
    {
      id: "design",
      name: "Макеты онбординга",
      url: "https://trello.com/c/design",
      listName: "В работе",
      labels: [{ id: "design", name: "Design", color: "pink" }],
      entries: [
        { id: "d1", ymd: 20261019, minutes: 480, memberId: "anna", memberName: "Анна Ковалева", note: "первый экран" },
        { id: "d2", ymd: 20261020, minutes: 120, memberId: "boris", memberName: "Борис Левин", note: "" }
      ],
      limitMinutes: null,
      kids: null,
      missing: false
    },
    {
      id: "api",
      name: "Авторизация",
      url: "https://trello.com/c/api",
      listName: "В работе",
      labels: [{ id: "backend", name: "Backend", color: "blue" }],
      entries: [
        { id: "a1", ymd: 20261021, minutes: 240, memberId: "anna", memberName: "Анна Ковалева", note: "" },
        { id: "a2", ymd: 20261019, minutes: 100, memberId: "boris", memberName: "Борис Левин", note: "ревью" }
      ],
      limitMinutes: null,
      kids: null,
      missing: false
    },
    {
      id: "bug",
      name: "Поправить отчёт",
      url: "https://trello.com/c/bug",
      listName: "Баги",
      labels: [{ id: "bug", name: "Bug", color: "red" }],
      entries: [
        { id: "b1", ymd: 20261022, minutes: 30, memberId: "boris", memberName: "Борис Левин", note: "" },
        { id: "b2", ymd: 20261012, minutes: 180, memberId: "anna", memberName: "Анна Ковалева", note: "прошлая неделя" }
      ],
      limitMinutes: null,
      kids: null,
      missing: false
    },
    {
      id: "gone",
      name: "Недоступная карточка",
      missing: true,
      labels: [],
      entries: [{ id: "g1", ymd: 20261019, minutes: 60, memberId: "anna", memberName: "Анна Ковалева", note: "" }],
      limitMinutes: null,
      kids: null
    }
  ];
}

test("builds a week report with authors, labels and epic remaining", function () {
  const report = aggregate.buildReport(fixture(), {
    from: "2026-10-19",
    to: "2026-10-25",
    labelIds: [],
    memberIds: []
  });
  assert.equal(report.totalMinutes, 970);
  assert.equal(report.authorCount, 2);
  assert.equal(report.cardCount, 3);
  assert.equal(report.entries.some(function (entry) { return entry.note === "прошлая неделя"; }), false);
  assert.equal(report.groups[0].memberName, "Анна Ковалева");
  assert.equal(report.groups[0].minutes, 720);
  const epicRow = report.epics[0];
  assert.equal(epicRow.spentMinutes, 940);
  assert.equal(epicRow.remainingMinutes, 3860);
  assert.equal(report.entries.some(function (entry) { return entry.cardId === "gone"; }), false);
});

test("filters the report by label and author", function () {
  const cards = fixture();
  const byBug = aggregate.buildReport(cards, {
    from: "2026-10-19",
    to: "2026-10-25",
    labelIds: ["bug"],
    memberIds: []
  });
  assert.equal(byBug.totalMinutes, 30);
  assert.equal(byBug.epics.length, 0);
  const byAnna = aggregate.buildReport(cards, {
    from: "2026-10-01",
    to: "2026-10-31",
    labelIds: [],
    memberIds: ["anna"]
  });
  assert.equal(byAnna.totalMinutes, 480 + 240 + 180);
  assert.equal(byAnna.authorCount, 1);
  assert.equal(byAnna.epics.length, 1);
});

test("badge text shows logged time and epic remainder", function () {
  const settings = { hoursPerDay: 8, daysPerWeek: 5, weekStartsOn: 1 };
  function badgeList(own, limit, spent) {
    return badgeApi.badgesFor({
      ownMinutes: own,
      limitMinutes: limit,
      spentMinutes: spent || 0,
      kidsKnown: spent != null
    }, settings);
  }
  const badges = badgeList(100, 1000, 800);
  assert.equal(badges[0].text, "1h 40m");
  assert.equal(badges[1].text, "3h 20m left");
  assert.equal(badges[1].color, "orange");
  assert.equal(badgeList(0, 1000, 700)[0].color, "green");
  assert.equal(badgeList(0, 1000, 1100)[0].text, "over 1h 40m");
  assert.equal(badgeList(0, 1000, 1100)[0].color, "red");
  assert.equal(badgeList(0, 480, null)[0].text, "limit 1d");
});

test("excel export escapes text and keeps numeric minutes", function () {
  const report = aggregate.buildReport(fixture(), {
    from: "2026-10-19",
    to: "2026-10-25",
    labelIds: [],
    memberIds: []
  });
  report.groups[0].rows[0].cardName = "Макеты <script>";
  report.entries[0].note = "=1+1";
  report.labelText = aggregate.labelText;
  const xml = excel.buildWorkbook(report, duration.formatDuration, { hoursPerDay: 8, daysPerWeek: 5, weekStartsOn: 1 });
  assert.match(xml, /ss:Name="Report"/);
  assert.match(xml, /ss:Name="Entries"/);
  assert.match(xml, /ss:Name="Epics"/);
  assert.match(xml, /Макеты &lt;script&gt;/);
  assert.match(xml, /'=1\+1/);
  assert.match(xml, /ss:Type="Number">970</);
  assert.match(xml, /Over limit|Within limit/);
});

test("unresolved Trello URLs are unknown, not zero-time children", function () {
  const lists = [{ checkItems: [{ name: "[Child](https://trello.com/c/abc123/title)" }] }];
  assert.equal(epic.inspectChecklists(lists, "epic").complete, false);
  assert.deepEqual(epic.inspectChecklists(lists, "epic", new Map([["abc123", "child"]])).childIds, ["child"]);
  assert.deepEqual(epic.inspectChecklists([{ checkItems: [{ name: "https://eviltrello.com/c/abc123" }] }], "epic").childIds, []);
});

test("unavailable children cannot produce an optimistic epic remainder", function () {
  const cards = fixture();
  cards[0].kids.push("missing");
  const result = aggregate.buildReport(cards, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(result.epics[0].known, false);
  assert.equal(result.epics[0].remainingMinutes, null);
});

test("Excel headers are strings and control characters cannot break XML", function () {
  const result = aggregate.buildReport(fixture(), { from: "2026-10-01", to: "2026-10-31" });
  result.entries[0].note = "bad\u0000text\u000b!";
  const xml = excel.buildWorkbook(result, duration.formatDuration, {});
  assert.doesNotMatch(xml, /NaN|[\u0000\u000b]/);
  assert.match(xml, /ss:Type="String">Minutes</);
  assert.match(xml, /badtext!/);
});
