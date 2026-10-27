const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createDom } = require("./helpers/dom");
function harness(options = {}) {
  const d = createDom(), host = d.host(); host.id = "app";
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
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast finish.*1d planned/,
    "one card with ETA and no time entries gets a scheduled finish");
  const bar = h.host.querySelector(".timeline-bar");
  assert.ok(bar, "the minimum case draws a bar");
  assert.match(bar.getAttribute("aria-label"), /\nETA: 1d\nSpent: 0m\nOver ETA: 0m\nScheduled$/);
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
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast finish.*4h planned/);
  assert.equal(h.host.querySelectorAll(".timeline-bar").length, 2, "child and grouping epic both appear on the timeline");
});
test("epic bars show only logged progress and today's marker follows the scale and visible dates", async () => {
  const h = harness({ rootId: "epic", cards: [{ id: "epic", name: "Epic" }, { id: "task", name: "Task" }],
    timeById: { epic: { e: [], lc: ["task"] }, task: { e: [["entry", 20261020, 240, 0]], lim: 960 } } });
  await h.render();
  const start = h.host.querySelector('[aria-label="Forecast start"]');
  const today = h.window.TimeDuration.formatYmd(new Date());
  start.value = "2026-10-26"; await start.fire("change");
  const epic = h.host.querySelector(".is-group");
  assert.equal(epic.querySelector(".timeline-spent").getAttribute("style"), "left:0px;width:11px");
  assert.ok(Number(/width:([\d.]+)px/.exec(epic.getAttribute("style"))[1]) > 11);
  start.value = today; await start.fire("change");
  let marker = h.host.querySelector(".timeline-today");
  assert.equal(marker.getAttribute("aria-label"), "Today: " + today);
  assert.equal(marker.getAttribute("style"), "left:calc(var(--label-width) + 11px)");
  const scale = h.host.querySelector('[aria-label="Timeline scale"]'); scale.value = "months"; await scale.fire("change");
  marker = h.host.querySelector(".timeline-today");
  assert.equal(marker.getAttribute("style"), "left:calc(var(--label-width) + 3.5px)");
  start.value = "2999-01-01"; await start.fire("change");
  assert.equal(h.host.querySelector(".timeline-today"), null, "today is outside the visible range");
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
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast finish.*1w 2d planned.*2 work items/);
  assert.equal(h.host.querySelectorAll(".timeline-bar").length, 2, "Epic and Phase 0 have dated bars");
  assert.match(h.host.textContent, /Included in EPIC ETA/);
  assert.doesNotMatch(h.host.querySelector(".timeline-summary").textContent, /0m planned/);
});
test("an over-limit phase and epic both draw bars with visible overrun and planned load", async () => {
  const h = harness({ rootId: "epic", cards: [
    { id: "epic", name: "EPIC" }, { id: "phase0", name: "Phase 0" },
    { id: "a", name: "Task 1" }, { id: "b", name: "Task 2" }, { id: "phase1", name: "Phase 1" }
  ], timeById: {
    epic: { e: [], lim: 11520, lc: ["phase0", "phase1"] },
    phase0: { e: [], lim: 3360, lc: ["a", "b"] },
    a: { e: [["a1", 20261021, 3493, 0]] }, b: { e: [["b1", 20261020, 120, 0]] },
    phase1: { e: [], dep: ["phase0"] }
  } });
  await h.render();
  assert.match(h.host.querySelector(".timeline-summary").textContent, /Forecast finish.*includes 4h 13m over ETA/);
  assert.equal(h.host.querySelectorAll(".timeline-bar").length, 2);
  const overrunBar = h.host.querySelectorAll(".timeline-bar").find(bar => bar.className.split(" ").includes("is-overrun"));
  assert.ok(overrunBar);
  const tooltip = overrunBar.getAttribute("aria-label");
  assert.match(tooltip, /^Phase 0\nStart date: \d{4}-\d{2}-\d{2}\nEnd date: \d{4}-\d{2}-\d{2}\nETA: 1w 2d\nSpent: 1w 2d 4h 13m\nOver ETA: 4h 13m\nScheduled$/);
  await overrunBar.fire("click");
  const popup = h.host.querySelector(".timeline-tooltip");
  assert.equal(popup.hidden, false);
  assert.equal(popup.querySelector("h3").textContent, "Phase 0");
  assert.equal(popup.querySelector(".is-over dd").textContent, "4h 13m");
  const labels = h.host.querySelectorAll(".timeline-card-text");
  assert.equal(labels[0].textContent, "EPIC");
  assert.equal(labels[1].textContent, "Phase 0");
  assert.doesNotMatch(labels[1].textContent, /ETA|Spent|\d{4}-\d{2}-\d{2}/);
  const style = overrunBar.getAttribute("style");
  assert.ok(Number(/width:([\d.]+)px/.exec(style)[1]) > 9 * 22, "the phase bar includes seven workdays and its overrun");
  const segment = overrunBar.querySelector(".timeline-overrun");
  assert.ok(segment, "only the trailing overrun segment is red");
  assert.equal(segment.getAttribute("title"), null, "the red segment inherits the full bar tooltip");
  assert.equal(Number(/left:([\d.]+)px/.exec(segment.getAttribute("style"))[1]), 9 * 22);
  assert.doesNotMatch(h.host.textContent, /ETA exhausted|no reliable finish/);
  assert.ok(h.host.querySelectorAll(".timeline-load-day").some(day => / · 1 \/ 1 FTE/.test(day.getAttribute("title"))));
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
  const start = h.host.querySelector('[aria-label="Forecast start"]'); start.value = "2026-11-05"; await start.fire("change");
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

test("timeline refresh reads native Trello Done and reopening returns planned work to the plan", async () => {
  const h = harness(); h.setDone(true); await h.render();
  assert.match(h.host.querySelector(".timeline-summary").textContent, /0m planned/);
  assert.match(h.host.querySelector(".timeline-card-text").textContent, /Work/);
  assert.ok(h.host.querySelector(".is-done"));
  h.setDone(false); await h.render();
  assert.doesNotMatch(h.host.querySelector(".timeline-summary").textContent, /0m planned/);
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
    const start = h.host.querySelector('[aria-label="Forecast start"]'); start.value = "2026-10-26"; await start.fire("change");
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
  const start = h.host.querySelector('[aria-label="Forecast start"]'); start.value = "2026-10-26"; await start.fire("change");
  assert.ok(h.host.querySelector('[data-predecessor="a"]').getAttribute("d").endsWith("L8 119"));
  assert.equal(h.host.querySelector(".timeline-dependency-arrow").getAttribute("d"), "M5 115 L8 119 L11 115");
});
