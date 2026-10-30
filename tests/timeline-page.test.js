const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createDom } = require("./helpers/dom");
function harness(options = {}) {
  const d = createDom();
  vm.runInContext('Date = class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-10-26T12:00:00Z"])); } }', d.context);
  const host = d.host(); host.id = "app";
  let render, writes = 0, fail = false, dueComplete = false, reportLoads = 0, timelineLoads = 0;
  let shared = options.shared || { unrelated: "preserved" };
  const client = {
    getContext: () => ({ permissions: { board: options.readonly ? "read" : "write" } }),
    arg: key => key === "view" ? options.initialView || "timeline" : key === "rootId" ? options.rootId || "task" : null,
    cards: async (...fields) => { if (fail) throw new Error("offline"); if (fields.includes("dueComplete")) timelineLoads++; else reportLoads++; return options.cards || [{ id: "task", name: "Work", dueComplete, labels: [] }]; },
    lists: async () => [],
    get: async (scope, visibility, key, fallback) => scope === "board" ? key ? shared[key] ?? fallback : structuredClone(shared) : options.timeById ? options.timeById[scope] || null : { lim: 480, e: [] },
    set: async (scope, visibility, key, value) => { if (options.rejectSave) throw new Error("offline write"); assert.equal(scope, "board"); assert.equal(key, "timeline"); shared[key] = structuredClone(value); writes++; },
    render: fn => { render = fn; }
  };
  d.window.parent = {}; d.window.TrelloPowerUp = { iframe: () => client };
  const html = fs.readFileSync(require.resolve("../report.html"), "utf8");
  for (const script of html.matchAll(/src="(js\/[^"?]+)(?:\?[^"\s]*)?"/g)) vm.runInContext(fs.readFileSync(require.resolve("../" + script[1]), "utf8"), d.context);
  return { ...d, host, render: () => render(), writes: () => writes, shared: () => shared, loads: () => ({ report: reportLoads, timeline: timelineLoads }), fail: value => { fail = value; }, setDone: value => { dueComplete = value; } };
}
test("combined board page opens Timeline from a card, writes the calendar and preserves other shared keys", async () => {
  const h = harness(); await h.render();
  assert.match(h.host.textContent, /Timeline/);
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast finish.*1d remaining/,
    "one card with ETA and no time entries gets a scheduled finish");
  const bar = h.host.querySelector(".timeline-bar");
  assert.ok(bar, "the minimum case draws a bar");
  assert.match(bar.getAttribute("aria-label"), /\nETA: 1d\nSpent: 0m\nRemaining: 1d\nOver ETA: 0m\nScheduled$/);
  assert.equal(bar.getAttribute("title"), null, "use the styled tooltip instead of the browser title");
  h.host.querySelector('[aria-label="Default FTE"]').value = "0.5";
  await h.host.querySelector("form").fire("submit");
  assert.equal(h.writes(), 1);
  assert.equal(h.shared().unrelated, "preserved");
  assert.equal(h.shared().timeline.baseFte, 0.5);
});
test("a group with one estimated child renders dates from the child without a group ETA", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Epic" }, { id: "task", name: "Task" }],
    timeById: { epic: { e: [], lc: ["task"] }, task: { e: [], lim: 240 } } });
  await h.render();
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast finish.*4h remaining/);
  assert.equal(h.host.querySelectorAll(".timeline-bar").length, 2, "child and grouping epic both appear on the timeline");
});
test("timeline starts at first logged date and keeps actuals before Today across scales", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Epic" }, { id: "task", name: "Task" }],
    timeById: { epic: { e: [], lc: ["task"] }, task: { e: [["entry", 20261020, 240, 0]], lim: 960 } } });
  await h.render();
  const start = h.host.querySelector('[aria-label="Timeline start"]');
  assert.equal(start.value, "2026-10-20");
  const position = (node, key) => Number(new RegExp(key + ":([\\d.]+)px").exec(node.getAttribute("style"))[1]);
  for (const value of ["weeks", "months"]) {
    const scale = h.host.querySelector('[aria-label="Timeline scale"]'); scale.value = value; await scale.fire("change");
    const epic = h.host.querySelector(".is-group"), spent = epic.querySelector(".timeline-spent"), remaining = epic.querySelector(".timeline-remaining");
    assert.ok(position(spent, "left") + position(spent, "width") < position(remaining, "left"));
    assert.equal(h.host.querySelector(".timeline-today").getAttribute("aria-label"), "Today: 2026-10-26");
  }
  start.value = "2999-01-01"; await start.fire("change");
  assert.equal(h.host.querySelector(".timeline-today"), null);
  assert.equal(h.host.querySelector(".timeline-spent"), null, "hidden history is clipped to the selected range");
});

test("Epic and Phase 0 ETA both draw bars even when Phase 1 has no ETA", async () => {
  const h = harness({ rootId: "epic", cards: [
    { id: "epic", name: "EPIC" }, { id: "phase0", name: "Phase 0" },
    { id: "task1", name: "Task 1" }, { id: "task2", name: "Task 2" }, { id: "phase1", name: "Phase 1" }
  ], timeById: {
    epic: { e: [], lim: 2400, lc: ["phase0", "phase1"] },
    phase0: { e: [], lim: 960, lc: ["task1", "task2"] },
    task1: { e: [] }, task2: { e: [] }, phase1: { e: [] }
  } });
  await h.render();
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast finish.*1w 2d remaining.*2 work items/);
  assert.equal(h.host.querySelectorAll(".timeline-bar").length, 2, "Epic and Phase 0 have dated bars");
  assert.match(h.host.textContent, /Included in EPIC ETA/);
  assert.doesNotMatch(h.host.querySelector(".timeline-summary").textContent, /0m remaining/);
});
test("epic draws continuous actual and remaining periods without changing logged totals", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Epic" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
    timeById: { epic: { e: [], lc: ["a", "b"] }, a: { e: [["a1", 20261020, 240, 0]], lim: 480 }, b: { e: [["b1", 20261022, 240, 0]], lim: 480 } } });
  await h.render();
  const epic = h.host.querySelector(".is-group");
  assert.equal(epic.querySelectorAll(".timeline-spent").length, 1);
  assert.equal(epic.querySelectorAll(".timeline-remaining").length, 1);
  const dayWidth = Number(/--day-width:([\d.]+)px/.exec(h.host.querySelector(".timeline-surface").getAttribute("style"))[1]);
  const spentWidth = Number(/width:([\d.]+)px/.exec(epic.querySelector(".timeline-spent").getAttribute("style"))[1]);
  assert.ok(Math.abs(spentWidth - 3 * dayWidth) < 0.001, "historical period spans October 20–22 as one segment");
  assert.match(h.host.querySelector(".timeline-card-text").textContent, /1d spent · 1d left/);
  assert.match(h.host.querySelector(".timeline-summary").textContent, /1d remaining/);
});

test("an over-limit phase displays actuals and requires an estimate update without inventing future overrun", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "EPIC" }, { id: "phase", name: "Phase" }, { id: "a", name: "A" }],
    timeById: { epic: { e: [], lc: ["phase"] }, phase: { e: [], lim: 3360, lc: ["a"] }, a: { e: [["a1", 20261021, 3613, 0]] } } });
  await h.render();
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast incomplete.*0m remaining.*4h 13m over ETA/);
  const bar = h.host.querySelectorAll(".timeline-bar").find(bar => bar.getAttribute("aria-label").startsWith("Phase\n"));
  assert.ok(bar.querySelector(".timeline-spent"));
  assert.equal(bar.querySelector(".timeline-remaining"), null);
  assert.match(bar.getAttribute("aria-label"), /ETA exhausted/);
  await bar.fire("click");
  assert.equal(h.host.querySelector(".timeline-tooltip .is-over dd").textContent, "4h 13m");
  assert.equal(h.host.querySelectorAll(".timeline-capacity-row").length, 0);
  assert.equal(h.host.querySelectorAll(".timeline-load-row").length, 1);
});

test("board tabs load each view on demand and retain the report when switching back", async () => {
  const h = harness({ initialView: "report" }); await h.render();
  assert.equal(h.host.querySelector('#board-report-tab').getAttribute('aria-selected'), 'true');
  assert.equal(h.host.querySelector('#board-timeline').hidden, true);
  assert.ok(h.host.querySelector('.report'));
  assert.equal(h.loads().timeline, 0);
  await h.host.querySelector('#board-timeline-tab').fire('click');
  assert.equal(h.host.querySelector('#board-report').hidden, true);
  assert.equal(h.host.querySelector('#board-timeline-tab').getAttribute('aria-selected'), 'true');
  assert.ok(h.host.querySelector('.timeline'));
  assert.equal(h.loads().timeline, 1);
  await h.host.querySelector('#board-report-tab').fire('click');
  assert.equal(h.host.querySelector('#board-report').hidden, false);
  assert.equal(h.host.querySelector('#board-timeline').hidden, true);
  assert.ok(h.host.querySelector('.report'));
});
test("board calendar storage preflight and concurrent changes reject writes without losing edits", async () => {
  for (const scenario of ["full", "concurrent", "failed"]) {
    const h = harness({ shared: scenario === "full" ? { unrelated: "x".repeat(3990) } : {}, rejectSave: scenario === "failed" });
    await h.render();
    h.host.querySelector('[aria-label="Default FTE"]').value = "0.25";
    if (scenario === "concurrent") h.shared().timeline = { baseFte: 2 };
    await h.host.querySelector("form").fire("submit");
    assert.equal(h.writes(), 0);
    assert.equal(h.host.querySelector('[aria-label="Default FTE"]').value, "0.25");
    assert.match(h.host.querySelector('[role="alert"]').textContent, scenario === "full" ? /storage is full/ : scenario === "concurrent" ? /another window/ : /offline write/);
    assert.equal(h.host.querySelector('[type="submit"]').disabled, false);
  }
});

test("saving and reloading a dated team FTE increase updates bar dates and load for work in progress", async () => {
  const h = harness({ cards: [{ id: "task", name: "Phase 1" }], timeById: { task: { e: [], lim: 5520 } } });
  await h.render();
  const start = h.host.querySelector('[aria-label="Timeline start"]'); start.value = "2026-11-05"; await start.fire("change");
  assert.match(h.host.querySelector(".timeline-bar").getAttribute("aria-label"), /Start date: 2026-11-05\nEnd date: 2026-11-20/);
  const add = h.host.querySelectorAll("button").find(button => button.textContent === "+ add FTE change");
  await add.fire("click");
  h.host.querySelector('[aria-label="FTE effective from"]').value = "2026-11-09";
  h.host.querySelector('[aria-label="FTE from this date"]').value = "2";
  await h.host.querySelector("form").fire("submit");
  assert.equal(h.writes(), 1);
  assert.deepEqual(h.shared().timeline, { baseFte: 1, changes: [{ date: "2026-11-09", fte: 2 }] });
  const expected = /Start date: 2026-11-05\nEnd date: 2026-11-13/;
  assert.match(h.host.querySelector(".timeline-bar").getAttribute("aria-label"), expected);
  assert.ok(h.host.querySelectorAll(".timeline-load-day").some(day => day.getAttribute("title") === "2026-11-09 · 2 / 2 FTE"));
  await h.render();
  assert.match(h.host.querySelector(".timeline-bar").getAttribute("aria-label"), expected, "persisted FTE keeps the recalculated dates after reload");
});
test("timeline page recovers after a failed initial load and read-only viewers cannot save", async () => {
  const h = harness({ readonly: true }); h.fail(true); await h.render();
  assert.match(h.host.textContent, /offline/);
  h.fail(false); await h.render();
  assert.equal(h.document.getElementById("timeline-load-error"), null);
  assert.match(h.host.textContent, /Forecast/);
  await h.host.querySelector("form").fire("submit");
  assert.equal(h.writes(), 0);
});

test("timeline refresh reads native Trello Done and reopening returns remaining work to the plan", async () => {
  const h = harness(); h.setDone(true); await h.render();
  assert.match(h.host.querySelector(".timeline-summary").textContent, /0m remaining/);
  assert.match(h.host.querySelector(".timeline-card-text").textContent, /Work/);
  assert.ok(h.host.querySelector(".is-done"));
  h.setDone(false); await h.render();
  assert.doesNotMatch(h.host.querySelector(".timeline-summary").textContent, /0m remaining/);
  assert.equal(h.host.querySelector(".is-done"), null);
});

function tooltipClock(h) {
  let now = 0, id = 0;
  const timers = new Map();
  h.window.setTimeout = (fn, delay) => { timers.set(++id, { fn, time: now + delay }); return id; };
  h.window.clearTimeout = key => timers.delete(key);
  return function advance(ms) {
    now += ms;
    for (const [key, timer] of [...timers]) if (timer.time <= now) { timers.delete(key); timer.fn(); }
  };
}

test("styled timeline details delay hover, allow pointer transfer and pin on click", async () => {
  const h = harness(); const advance = tooltipClock(h); await h.render();
  const bar = h.host.querySelector(".timeline-bar"), popup = h.host.querySelector(".timeline-tooltip");
  await bar.fire("pointerenter", { clientX: 200 }); advance(399);
  assert.equal(popup.hidden, true);
  advance(1);
  assert.equal(popup.hidden, false);
  assert.equal(bar.getAttribute("aria-describedby"), popup.id);
  assert.equal(popup.querySelector(".is-eta dd").textContent, "1d");
  assert.equal(popup.querySelector(".is-spent dd").textContent, "0m");
  assert.equal(popup.querySelector(".is-clear dd").textContent, "0m");
  await bar.fire("pointerleave"); advance(50); await popup.fire("pointerenter"); advance(200);
  assert.equal(popup.hidden, false, "the pointer can move into the tooltip");
  await popup.fire("pointerleave"); advance(150);
  assert.equal(popup.hidden, true);
  await bar.fire("click"); await bar.fire("pointerleave"); advance(1000);
  assert.equal(popup.hidden, false, "click pins the tooltip");
  assert.match(popup.querySelector(".timeline-tooltip-hint").textContent, /Click again/);
  await h.document.fire("pointerdown", { target: popup.querySelector("h3") });
  assert.equal(popup.hidden, false, "clicking its contents keeps the tooltip open");
  await h.document.fire("pointerdown", { target: h.host });
  assert.equal(popup.hidden, true);
  await bar.fire("click"); await bar.fire("click");
  assert.equal(popup.hidden, true, "a second click toggles the tooltip closed");
});

test("timeline tooltip supports keyboard access, dismisses stale content and stays inside viewport", async () => {
  const h = harness(); const advance = tooltipClock(h); await h.render();
  let bar = h.host.querySelector(".timeline-bar");
  const popup = h.host.querySelector(".timeline-tooltip");
  h.window.innerWidth = 400; h.window.innerHeight = 300;
  popup.getBoundingClientRect = () => ({ width: 340, height: 250 });
  bar.getBoundingClientRect = () => ({ left: 370, right: 410, top: 260, bottom: 280 });
  await bar.fire("focus");
  assert.equal(popup.hidden, false);
  assert.equal(popup.style.left, "52px");
  assert.equal(popup.style.top, "8px");
  await bar.fire("keydown", { key: "Enter" }); await bar.fire("blur"); advance(500);
  assert.equal(popup.hidden, false, "Enter pins the details for keyboard users");
  await h.document.fire("keydown", { key: "Escape" });
  assert.equal(popup.hidden, true);
  assert.equal(bar.getAttribute("aria-expanded"), "false");
  await bar.fire("keydown", { key: " " });
  assert.equal(popup.hidden, false);
  await h.window.fire("resize"); assert.equal(popup.hidden, true);
  await bar.fire("click"); await h.window.fire("scroll", { target: h.host });
  assert.equal(popup.hidden, true, "scrolling dismisses the popup before its anchor moves");
  await bar.fire("pointerenter"); await bar.fire("pointerleave"); advance(500);
  assert.equal(popup.hidden, true, "leaving before the delay cancels the pending tooltip");
  await bar.fire("pointerenter"); await h.render(); advance(500);
  assert.equal(popup.hidden, true, "a refresh cancels the pending tooltip for removed bars");
  bar = h.host.querySelector(".timeline-bar");
  await bar.fire("focus"); await bar.fire("blur"); advance(150);
  assert.equal(popup.hidden, true);
});

test("dependency connectors use actual bar edges and approach successors with rounded forward arrows", async () => {
  for (const children of [["a", "b"], ["b", "a"]]) {
    const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Epic" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      timeById: { epic: { e: [], lc: children }, a: { e: [], lim: 480 }, b: { e: [], lim: 480, dep: ["a"] } } });
    await h.render();
    const start = h.host.querySelector('[aria-label="Timeline start"]'); start.value = "2026-10-26"; await start.fire("change");
    for (const scale of ["weeks", "months"]) {
      const select = h.host.querySelector('[aria-label="Timeline scale"]'); select.value = scale; await select.fire("change");
      const bars = h.host.querySelectorAll(".timeline-bar");
      const source = bars.find(bar => bar.getAttribute("aria-label").startsWith("A\n"));
      const target = bars.find(bar => bar.getAttribute("aria-label").startsWith("B\n"));
      const value = (bar, key) => Number(new RegExp(key + ":([\\d.]+)px").exec(bar.getAttribute("style"))[1]);
      const sourceX = value(source, "left") + value(source, "width"), targetX = value(target, "left") - 2;
      const sourceY = (children.indexOf("a") + 1) * 52 + 26, targetY = (children.indexOf("b") + 1) * 52 + 26;
      const path = h.host.querySelector('[data-predecessor="a"]');
      assert.equal(path.getAttribute("data-successor"), "b");
      assert.ok(path.getAttribute("d").startsWith("M" + sourceX + " " + sourceY));
      assert.ok(path.getAttribute("d").endsWith("L" + targetX + " " + targetY));
      assert.match(path.getAttribute("d"), / Q/, "corners are rounded");
      const arrow = h.host.querySelector(".timeline-dependency-arrow");
      assert.equal(arrow.getAttribute("d"), `M${targetX - 4} ${targetY - 3} L${targetX} ${targetY} L${targetX - 4} ${targetY + 3}`);
    }
    await h.host.querySelector('.timeline-toggle').fire("click");
    assert.equal(h.host.querySelector('[data-predecessor="a"]'), null, "collapsed cards have no stray connectors");
  }
});

test("dependencies from completed work enter a first-day successor vertically without clipping the arrow", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Epic" }, { id: "a", name: "Done", dueComplete: true }, { id: "b", name: "Next" }],
    timeById: { epic: { e: [], lc: ["a", "b"] }, a: { e: [], lim: 480 }, b: { e: [], lim: 480, dep: ["a"] } } });
  await h.render();
  const start = h.host.querySelector('[aria-label="Timeline start"]'); start.value = "2026-10-27"; await start.fire("change");
  assert.ok(h.host.querySelector('[data-predecessor="a"]').getAttribute("d").endsWith("L8 119"));
  assert.equal(h.host.querySelector(".timeline-dependency-arrow").getAttribute("d"), "M5 115 L8 119 L11 115");
});

test("automatic start includes external prerequisite history and a manual date survives refresh", async () => {
  const h = harness({ rootId: "task", cards: [{ id: "task", name: "Work" }, { id: "before", name: "Before", dueComplete: true }],
    timeById: { task: { e: [["a", 20261023, 120, 0]], lim: 480, dep: ["before"] }, before: { e: [["b", 20261019, 480, 0]], lim: 480 } } });
  await h.render();
  const start = h.host.querySelector('[aria-label="Timeline start"]');
  assert.equal(start.value, "2026-10-19");
  start.value = "2026-10-22"; await start.fire("change");
  await h.render();
  assert.equal(start.value, "2026-10-22");
  await h.host.querySelectorAll("button").find(button => button.textContent === "From first time entry").fire("click");
  assert.equal(start.value, "2026-10-19");
});

test("dependency arrows enter remaining work rather than a successor's historical logs", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Epic" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
    timeById: { epic: { e: [], lc: ["a", "b"] }, a: { e: [], lim: 480 }, b: { e: [["b1", 20261020, 120, 0]], lim: 480, dep: ["a"] } } });
  await h.render();
  const bar = h.host.querySelectorAll(".timeline-bar").find(bar => bar.getAttribute("aria-label").startsWith("B\n"));
  const value = (element, key) => Number(new RegExp(key + ":([\\d.]+)px").exec(element.getAttribute("style"))[1]);
  const target = value(bar, "left") + value(bar.querySelector(".timeline-remaining"), "left") - 2;
  assert.ok(h.host.querySelector('[data-predecessor="a"]').getAttribute("d").endsWith("L" + target + " 130"));
});

test("opening from a card keeps its ID selected and includes descendants and prerequisites after refresh", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Same" }, { id: "other", name: "Same" }, { id: "child", name: "Child" }, { id: "before", name: "Before" }],
    timeById: { epic: { e: [], lc: ["child"], dep: ["before"] }, other: { e: [], lim: 9600 }, child: { e: [], lim: 480 }, before: { e: [], lim: 480 } } });
  await h.render();
  const project = h.host.querySelector('[aria-label="Project"]');
  assert.equal(project.value, "Same · epic");
  assert.equal(h.host.querySelectorAll(".timeline-work-row").length, 3);
  assert.match(h.host.querySelector(".timeline-summary").textContent, /2d remaining/);
  await project.fire("focus");
  project.value = "other"; await project.fire("input");
  await project.fire("keydown", { key: "Escape" });
  assert.equal(project.value, "Same · epic");
  await h.render();
  assert.equal(project.value, "Same · epic");
  assert.equal(h.host.querySelectorAll(".timeline-work-row").length, 3);
});
