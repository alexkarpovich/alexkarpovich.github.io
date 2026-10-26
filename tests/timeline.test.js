const test = require("node:test");
const assert = require("node:assert/strict");
const timeline = require("../js/timeline");
const model = require("../js/model");
const start = "2026-10-26";
const task = (id, minutes = 480, extra = {}) => ({ id, name: id, entries: [], limitMinutes: minutes, ...extra });
const group = (id, kids, extra = {}) => task(id, null, { linkedIds: kids, ...extra });
const plan = (cards, extra = {}) => timeline.plan(cards, { start, calendar: { baseFte: 2 }, ...extra });

test("epic predecessors gate all descendants, including deeply nested tasks", () => {
  const p = plan([group("project", ["e1", "e2"]), group("e1", ["a", "b"]), task("a"), task("b"),
    group("e2", ["c", "sub"], { dependencyIds: ["e1"] }), task("c"), group("sub", ["d"]), task("d")], { rootIds: ["project"] });
  assert.equal(p.rows.get("e1").finish, start);
  assert.equal(p.rows.get("c").start, "2026-10-27");
  assert.equal(p.rows.get("d").start, "2026-10-27");
  assert.deepEqual(p.rows.get("d").dependencies, ["e1"]);
  assert.equal(p.finish, "2026-10-27");
});

test("child order is priority, independent work runs in parallel and multiple dependencies wait for all", () => {
  const cards = [group("root", ["a", "b", "c"]), task("a"), task("b", 960), task("c", 480, { dependencyIds: ["a", "b"] })];
  const p = plan(cards, { rootIds: ["root"] });
  assert.equal(p.rows.get("a").start, start);
  assert.equal(p.rows.get("b").start, start);
  assert.equal(p.rows.get("c").start, "2026-10-28");
  const serial = plan(cards, { rootIds: ["root"], calendar: { baseFte: 1 } });
  assert.equal(serial.rows.get("b").start, "2026-10-27");
  assert.equal(serial.finish, "2026-10-29");
});

test("calendar changes affect work already running and values persist until the next change", () => {
  const p = plan([task("a", 1200)], { calendar: { baseFte: 0.5, changes: [{ date: "2026-10-27", fte: 1 }] } });
  assert.equal(p.rows.get("a").finish, "2026-10-28");
  assert.deepEqual(p.days.slice(0, 3).map(day => day.minutes), [240, 480, 480]);
  assert.equal(timeline.capacity(timeline.normalizeCalendar({ baseFte: 1, changes: [{ date: "2026-10-27", fte: 2 }] }), "2026-12-01"), 2);
});

test("epic caps share the project pool, apply through nesting and can change by date", () => {
  const cards = [group("root", ["e1", "e2"]), group("e1", ["a", "sub"], { planning: { maxFte: 1.5 } }),
    task("a", 960), group("sub", ["b"]), task("b", 960), group("e2", ["c", "d"], { planning: { maxFte: 1.5 } }), task("c", 960), task("d", 960)];
  const p = plan(cards, { rootIds: ["root"] });
  assert.equal(p.days[0].minutes, 960);
  assert.ok(p.days.every(day => day.usedFte <= day.availableFte + 1e-7));
  const capped = plan([group("e", ["a", "b"], { planning: { maxFte: 0.5, changes: [{ date: "2026-10-27", fte: 2 }] } }), task("a", 720), task("b", 720)]);
  assert.equal(capped.days[0].minutes, 240);
  assert.equal(capped.days[1].minutes, 960);
  assert.equal(capped.finish, "2026-10-28");
});

test("single tasks default to one FTE and can explicitly use more", () => {
  assert.equal(plan([task("a", 960)]).finish, "2026-10-27");
  assert.equal(plan([task("a", 960, { planning: { maxFte: 2 } })]).finish, start);
});

test("fractional allocations release capacity and dependencies within the same day", () => {
  const p = plan([task("a", 120), task("b", 360, { dependencyIds: ["a"] })], { calendar: { baseFte: 1 } });
  assert.equal(p.finish, start);
  assert.equal(p.tasks.find(task => task.id === "b").startTime, 0.25);
  assert.equal(p.days[0].usedFte, 1);
});

test("working days respect weekends, exclusions and configured workday hours", () => {
  const p = plan([task("a", 720)], { start: "2026-10-30", calendar: { baseFte: 1 }, settings: { hoursPerDay: 6, excludedDates: ["2026-11-02"] } });
  assert.equal(p.finish, "2026-11-03");
  assert.equal(p.days.find(day => day.date === "2026-11-02").minutes, 0);
});

test("without an epic ETA shared child estimates are counted once", () => {
  const cards = [group("root", ["x", "y"]), group("x", ["a"], { entries: [{ minutes: 900 }] }), group("y", ["a", "b"]), task("a"), task("b")];
  const p = plan(cards, { rootIds: ["root"] });
  assert.equal(p.tasks.length, 2);
  assert.equal(p.rows.get("root").minutes, 960);
  assert.equal(p.days[0].minutes, 960);
  assert.equal(p.finish, start);
});

test("epic and nested phase ETAs all contribute to the shared schedule", () => {
  const cards = [group("epic", ["phase0", "phase1"], { limitMinutes: 2880 }),
    group("phase0", ["a", "b"], { limitMinutes: 960 }),
    task("a", null, { entries: [{ minutes: 120 }] }), task("b", null), task("phase1", 480)];
  const p = plan(cards, { rootIds: ["epic"], calendar: { baseFte: 1 } });
  assert.equal(p.tasks.length, 3);
  assert.equal(p.rows.get("phase0").minutes, 840, "logged child work reduces the phase ETA");
  assert.ok(p.rows.get("phase0").finish);
  assert.equal(p.rows.get("epic").minutes, 4080, "the epic includes its own remaining ETA and all child estimates");
  assert.equal(p.finish, "2026-11-05");
  assert.equal(p.days.reduce((sum, day) => sum + day.minutes, 0), 4080);
  assert.deepEqual(p.warnings, []);
});

test("own epic ETA works with missing child ETA and preserves external dependencies", () => {
  const partial = plan([group("phase", ["a", "b"], { limitMinutes: 960 }), task("a", 480), task("b", null)]);
  assert.equal(partial.complete, true);
  assert.equal(partial.tasks.length, 2);
  assert.equal(partial.rows.get("phase").minutes, 1440);
  assert.ok(partial.rows.get("a").finish);
  assert.match(partial.rows.get("b").status, /Included in phase ETA/);
  const dependent = plan([group("phase", ["a"], { limitMinutes: 480 }), task("a", null, { dependencyIds: ["before"] }), task("before", 480)]);
  assert.equal(dependent.complete, true);
  assert.ok(dependent.tasks.find(item => item.id === "phase").startTime >= dependent.tasks.find(item => item.id === "before").finishTime);
});

test("a child ETA adds load and extends its parent and the overall forecast", () => {
  const p = plan([group("epic", ["task"], { limitMinutes: 480 }), task("task", 960)], { calendar: { baseFte: 1 } });
  assert.equal(p.finish, "2026-10-28");
  assert.equal(p.rows.get("epic").finish, "2026-10-28");
  assert.equal(p.rows.get("task").finish, "2026-10-27");
  assert.equal(p.tasks.find(item => item.id === "epic").startTime, 2, "child work has priority over the parent remainder");
  assert.equal(p.days.reduce((sum, day) => sum + day.minutes, 0), 1440);
});

test("estimated epics share caps with children and successors wait for the entire epic", () => {
  const p = plan([group("epic", ["child"], { limitMinutes: 480, planning: { maxFte: 1 } }),
    task("child", 960), task("after", 480, { dependencyIds: ["epic"] })], { rootIds: ["after"] });
  assert.equal(p.rows.get("epic").minutes, 1440);
  assert.equal(p.rows.get("epic").finish, "2026-10-28");
  assert.equal(p.rows.get("after").start, "2026-10-29");
  assert.ok(p.days.every(day => day.usedFte <= 1));
});

test("shared children contribute once even when both parents have explicit ETAs", () => {
  const cards = [group("root", ["x", "y"]), group("x", ["a"], { limitMinutes: 480 }),
    group("y", ["a"], { limitMinutes: 480 }), task("a", 480)];
  const p = plan(cards, { rootIds: ["root"], calendar: { baseFte: 1 } });
  assert.equal(p.tasks.length, 3);
  assert.equal(p.rows.get("root").minutes, 1440);
  assert.equal(p.days.reduce((sum, day) => sum + day.minutes, 0), 1440);
  const child = plan(cards, { rootIds: ["a"] });
  assert.deepEqual(child.tasks.map(item => item.id), ["a"]);
  assert.equal(child.rows.get("a").minutes, 480);
});

test("estimated children keep their own dependencies under an estimated parent", () => {
  const p = plan([group("epic", ["child"], { limitMinutes: 480 }),
    task("child", 480, { dependencyIds: ["before"] }), task("before", 480)]);
  const byId = new Map(p.tasks.map(item => [item.id, item]));
  assert.ok(byId.get("child").startTime >= byId.get("before").finishTime);
  assert.equal(p.complete, true);
  assert.equal(p.days.reduce((sum, day) => sum + day.minutes, 0), 1440);
});

test("an over-limit phase gets its own bar and delays the epic remainder by the overrun", () => {
  const p = plan([
    group("epic", ["phase0", "phase1"], { limitMinutes: 11520 }),
    group("phase0", ["a", "b"], { limitMinutes: 240 }),
    task("a", null, { entries: [{ minutes: 133 }] }),
    task("b", null, { entries: [{ minutes: 120 }] }),
    task("phase1", null, { dependencyIds: ["phase0"] })
  ], { calendar: { baseFte: 1 } });
  const epic = p.tasks.find(item => item.id === "epic");
  assert.deepEqual(epic.deps, []);
  assert.equal(epic.total, 11267);
  assert.equal(epic.start, start);
  assert.equal(epic.finish, "2026-11-26");
  assert.equal(p.rows.get("epic").start, start);
  assert.equal(p.rows.get("epic").scheduledThrough, epic.finish);
  assert.equal(p.days.reduce((sum, day) => sum + day.minutes, 0), 11280);
  const phase = p.tasks.find(item => item.id === "phase0");
  assert.equal(phase.overrun, 13);
  assert.equal(phase.total, 13);
  assert.equal(phase.startTime, 0);
  assert.equal(phase.finishTime, 13 / 480);
  assert.equal(epic.startTime, phase.finishTime);
  assert.equal(p.rows.get("phase0").overrun, 13);
  assert.equal(p.rows.get("phase0").start, start);
  assert.equal(p.rows.get("phase0").finish, start);
  assert.equal(p.complete, true);
  assert.equal(p.finish, "2026-11-26");
});

test("missing estimates and unavailable dependencies cannot imply completion", () => {
  for (const first of [task("a", null), task("a", 480, { missing: true })]) {
    const p = plan([first, task("b", 480, { dependencyIds: ["a"] })]);
    assert.equal(p.complete, false);
    assert.equal(p.rows.get("a").finish, null);
    assert.equal(p.rows.get("b").start, null);
    assert.ok(p.warnings.length);
    assert.equal(p.days.length, 28, "blocked plans do not display ten years of blank days");
  }
  const external = plan([task("b", 480, { dependencyIds: ["gone"] })]);
  assert.equal(external.finish, null);
  assert.equal(external.rows.get("gone").status, "Unavailable");
});

test("overrun shifts dependent work by exact working minutes, including weekends and FTE caps", () => {
  const cards = [task("first", 240, { entries: [{ minutes: 253 }] }),
    task("after", 480, { dependencyIds: ["first"] })];
  for (const baseFte of [1, 0.5]) {
    const p = plan(cards, { start: "2026-10-30", calendar: { baseFte } });
    const after = p.tasks.find(item => item.id === "after");
    assert.equal(after.startTime, 13 / (480 * baseFte));
    assert.equal(p.rows.get("first").overrun, 13);
    assert.equal(p.days.reduce((sum, day) => sum + day.minutes, 0), 493);
    assert.equal(p.finish, baseFte === 1 ? "2026-11-02" : "2026-11-03");
    assert.ok(p.days.filter(day => !day.workday).every(day => day.minutes === 0));
  }
});

test("an ETA exactly consumed is a zero-duration milestone that releases successors", () => {
  const p = plan([task("before", 480), task("exact", 240, { entries: [{ minutes: 240 }], dependencyIds: ["before"] }),
    task("after", 480, { dependencyIds: ["exact"] })], { calendar: { baseFte: 1 } });
  const exact = p.tasks.find(item => item.id === "exact");
  const after = p.tasks.find(item => item.id === "after");
  assert.equal(exact.total, 0);
  assert.equal(exact.startTime, 1);
  assert.equal(exact.finishTime, 1);
  assert.equal(exact.nativeDone, false, "the forecast does not change Trello completion");
  assert.equal(p.rows.get("exact").start, start);
  assert.equal(after.startTime, 1);
  assert.equal(p.complete, true);
  assert.equal(p.finish, "2026-10-27");
});

test("native completion and revised estimate determine remaining work", () => {
  const cards = [task("a", null, { dueComplete: true }), task("b", 840, { entries: [{ minutes: 600 }], planning: { remainingMinutes: 1 }, dependencyIds: ["a"] })];
  const p = plan(cards);
  assert.equal(p.finish, start);
  assert.equal(p.days[0].minutes, 240);
  assert.equal(p.rows.get("a").status, "Done");
  cards[1].entries.push({ minutes: 60 });
  assert.equal(plan(cards).days[0].minutes, 180, "logging time reduces the plan without changing the estimate");
  assert.equal(model.decode({ e: [], p: { remainingMinutes: 120 } }).planning, null, "the removed override is ignored");
});

test("root selection includes external prerequisites and inherits restrictions from ancestors", () => {
  const p = plan([group("parent", ["child"], { dependencyIds: ["external"], planning: { maxFte: 0.5 } }), task("child"), task("external")], { rootIds: ["child"] });
  assert.equal(p.rows.get("external").finish, start);
  assert.equal(p.rows.get("child").start, "2026-10-27");
  assert.equal(p.rows.get("child").finish, "2026-10-28");
});

test("zero FTE pauses work and later capacity resumes it; permanent zero stays incomplete", () => {
  const p = plan([task("a")], { calendar: { baseFte: 0, changes: [{ date: "2026-10-28", fte: 1 }] } });
  assert.equal(p.rows.get("a").start, "2026-10-28");
  assert.equal(plan([task("a")], { calendar: { baseFte: 0 } }).complete, false);
});

test("validation catches direct, inherited, hierarchy and epic-to-descendant dependency cycles", () => {
  const cases = [
    [task("a", 480, { dependencyIds: ["b"] }), task("b", 480, { dependencyIds: ["a"] })],
    [group("e1", ["a"]), group("e2", ["b"], { dependencyIds: ["e1"] }), task("a", 480, { dependencyIds: ["e2"] }), task("b")],
    [group("e", ["a"], { dependencyIds: ["a"] }), task("a")],
    [group("e", ["a"]), group("a", ["e"])],
    [task("a", 480, { dependencyIds: ["a"] })]
  ];
  cases.forEach(cards => {
    assert.throws(() => timeline.validateLinks(cards), /circular/);
    const p = plan(cards, { rootIds: [cards[0].id] });
    assert.equal(p.complete, false);
    assert.match(p.warnings.join(" "), /Circular/);
  });
});

test("calendar validates dates, deduplicates changes and preserves zero capacity", () => {
  assert.equal(timeline.validDate("2026-02-30"), false);
  assert.equal(timeline.validDate("2028-02-29"), true);
  assert.throws(() => plan([], { start: "2026-02-30" }), /valid/);
  assert.deepEqual(timeline.normalizeCalendar({ baseFte: 0, changes: [{ date: start, fte: 2 }, { date: start, fte: 0.25 }, { date: "2026-02-30", fte: 1 }, { date: start, fte: -1 }] }), { baseFte: 0, changes: [{ date: start, fte: 0.25 }] });
});

test("planning and dependencies round-trip without changing logs or legacy cards", () => {
  const state = model.emptyState();
  state.dependencyIds = ["epic"];
  state.planning = { maxFte: 0.25, changes: [{ date: start, fte: 0 }] };
  const fitted = model.fitState(state);
  assert.deepEqual(model.decode(fitted.packed), state);
  assert.deepEqual(fitted.state.planning, state.planning);
  assert.equal(model.isEmpty(state), false);
  assert.equal(model.isEmpty(model.emptyState()), true);
  assert.equal(model.decode({ e: [] }).planning, null);
  assert.deepEqual(model.decode({ e: [], dep: ["a", "a", null] }).dependencyIds, ["a"]);
  assert.throws(() => model.fitState({ ...state, dependencyIds: ["x".repeat(4000)] }), { code: "STORAGE_FULL" });
});

test("completed work does not schedule its historical predecessors again", () => {
  const p = plan([group("root", ["a"], { dependencyIds: ["gone"] }), task("a", 480, { dueComplete: true, dependencyIds: ["old"] })], { rootIds: ["root"] });
  assert.equal(p.complete, true);
  assert.equal(p.rows.get("root").status, "Done");
  assert.equal(p.rows.has("gone"), false);
  assert.equal(p.rows.has("old"), false);
  assert.equal(p.days[0].minutes, 0);
});

test("Trello Done is the completion source; legacy planning flags cannot complete reopened work", () => {
  const cards = [task("a", 480, { dueComplete: true, planning: { done: false } })];
  assert.equal(plan(cards).rows.get("a").status, "Done");
  assert.equal(plan(cards).days[0].minutes, 0);
  cards[0].dueComplete = false;
  cards[0].planning.done = true;
  const reopened = plan(cards);
  assert.equal(reopened.rows.get("a").status, "Scheduled");
  assert.equal(reopened.days[0].minutes, 480);
  assert.equal(model.decode({ e: [], p: { done: true } }).planning, null);
  const epic = plan([group("root", ["a"], { dueComplete: true }), task("a")], { rootIds: ["root"] });
  assert.equal(epic.rows.get("root").status, "Scheduled", "an epic mark does not complete unfinished children");
});
