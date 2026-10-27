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
  assert.match(bar.getAttribute("title"), /\nETA: 1d\nSpent: 0m\nOver ETA: 0m\nScheduled$/);
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
  const tooltip = overrunBar.getAttribute("title");
  assert.match(tooltip, /^Phase 0\nStart date: \d{4}-\d{2}-\d{2}\nEnd date: \d{4}-\d{2}-\d{2}\nETA: 1w 2d\nSpent: 1w 2d 4h 13m\nOver ETA: 4h 13m\nScheduled$/);
  assert.equal(overrunBar.getAttribute("aria-label"), tooltip);
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
