const test = require("node:test");
const assert = require("node:assert/strict");
const { createDom } = require("./helpers/dom");
const tick = () => new Promise(resolve => setImmediate(resolve));
const cards = [
  { id: "root", name: "Project", linkedIds: ["a", "b"], entries: [] },
  { id: "a", name: "Foundation", limitMinutes: 480, entries: [] },
  { id: "b", name: "Rollout", limitMinutes: 480, dependencyIds: ["a"], entries: [] }
];
function ui() { const dom = createDom(); dom.run("planning-view.js"); dom.run("timeline-view.js"); return dom; }

test("timeline renders computed dates, dependencies, calendar edits and collapse without duplicating work", async () => {
  const d = ui(), host = d.host(); let saved;
  const view = d.window.TimeTimelineView.mount(host, { start: "2026-10-26", rootId: "root", onRefresh: async () => {}, onCalendar: async value => { saved = value; } });
  const model = { cards, settings: {}, calendar: { baseFte: 1 }, canWrite: true };
  view.update(model);
  assert.match(host.querySelector(".timeline-summary").textContent, /2026-10-27/);
  assert.equal(host.querySelectorAll(".timeline-work-row").length, 3);
  assert.equal(host.querySelectorAll("path").length, 1, "dependency connector is rendered");
  await host.querySelector('.timeline-toggle').fire("click");
  assert.equal(host.querySelectorAll(".timeline-work-row").length, 1);
  await host.querySelector('.timeline-toggle').fire("click");
  assert.equal(host.querySelectorAll(".timeline-work-row").length, 3);
  const defaultFte = host.querySelector('[aria-label="Default FTE"]');
  defaultFte.value = "0.5";
  view.update(model);
  assert.equal(defaultFte.value, "0.5", "background refresh preserves unsaved calendar");
  await host.querySelector("form").fire("submit");
  assert.equal(saved.baseFte, 0.5);
  assert.match(host.querySelector(".timeline-summary").textContent, /2026-10-29/);
  await host.querySelector(".fte-day").fire("click");
  assert.equal(host.querySelectorAll(".fte-period").length, 1, "date on chart creates a calendar period");
  const period = host.querySelector(".fte-period");
  period.querySelector('[aria-label="FTE effective from"]').value = "2026-10-27";
  period.querySelector('[aria-label="FTE from this date"]').value = "1";
  await host.querySelector("form").fire("submit");
  assert.deepEqual(JSON.parse(JSON.stringify(saved.changes)), [{ date: "2026-10-27", fte: 1 }]);
  assert.match(host.querySelector(".timeline-summary").textContent, /2026-10-28/);
});

test("calendar rejects duplicate dates and failed saves retain editable values", async () => {
  const d = ui(), host = d.host(); let writes = 0;
  const view = d.window.TimeTimelineView.mount(host, { start: "2026-10-26", onRefresh: async () => {}, onCalendar: async () => { writes++; throw new Error("offline"); } });
  view.update({ cards, settings: {}, calendar: { baseFte: 1 }, canWrite: true });
  await host.querySelector(".fte-day").fire("click");
  await host.querySelector(".fte-day").fire("click");
  await host.querySelector("form").fire("submit");
  assert.equal(writes, 0);
  assert.match(host.querySelector('[role="alert"]').textContent, /one FTE change/);
  await host.querySelector('[aria-label="Remove FTE change"]').fire("click");
  await host.querySelector("form").fire("submit");
  assert.equal(writes, 1);
  assert.match(host.querySelector('[role="alert"]').textContent, /offline/);
  assert.equal(host.querySelector('[type="submit"]').disabled, false);
  assert.equal(host.querySelectorAll(".fte-period").length, 1);
});

test("read-only timeline permits changing the view but disables all calendar writes", async () => {
  const d = ui(), host = d.host(); let writes = 0;
  const view = d.window.TimeTimelineView.mount(host, { start: "2026-10-26", onRefresh: async () => {}, onCalendar: async () => { writes++; } });
  view.update({ cards, settings: {}, calendar: null, canWrite: false });
  assert.equal(host.querySelector('[aria-label="Default FTE"]').disabled, true);
  assert.equal(host.querySelector(".fte-day").disabled, true);
  assert.equal(host.querySelector('[aria-label="Project"]').disabled, false);
  await host.querySelector("form").fire("submit");
  assert.equal(writes, 0);
});

test("dependency autocomplete carries IDs, keyboard selection works and planning drafts survive unrelated updates", async () => {
  const d = ui(), host = d.host(); let added, planning, estimateMinutes;
  const view = d.window.TimePlanningView.mount(host, { settings: () => ({}), onTimeline() {}, onInspectDependencies: async () => ({ count: 0 }),
    onCardSearch: async () => [{ id: "duplicate-name-id", name: "Foundation" }], onDependencyAdd: async (text, id) => { added = id; }, onDependencyRemove: async () => {}, onPlanning: async (value, minutes) => { planning = value; estimateMinutes = minutes; } });
  const model = { cardId: "task", settings: {}, limitMinutes: 480, dependencies: [], planning: null, canWrite: true };
  view.update(model);
  const add = host.querySelectorAll("button").find(node => node.textContent === "+ add dependency");
  const form = host.querySelector(".dependency-form");
  assert.equal(form.hidden, true, "dependency input and actions are hidden initially");
  assert.equal(add.hidden, false);
  assert.equal(add.getAttribute("aria-expanded"), "false");
  assert.equal(host.querySelector('[type="checkbox"]'), null, "completion is managed in Trello");
  assert.doesNotMatch(host.textContent, /Completed/);
  await add.fire("click");
  assert.equal(form.hidden, false);
  assert.equal(add.hidden, true);
  assert.equal(add.getAttribute("aria-expanded"), "true");
  view.update({ ...model, saving: true });
  assert.equal(form.hidden, false, "saving state does not open or close the picker");
  view.update(model);
  await host.querySelector('[role="combobox"]').fire("keydown", { key: "Escape" });
  assert.equal(form.hidden, true);
  await add.fire("click");
  await form.querySelectorAll("button").find(node => node.textContent === "Cancel").fire("click");
  assert.equal(form.hidden, true);
  await add.fire("click");
  const input = host.querySelector('[role="combobox"]'); input.value = "Found";
  await input.fire("input");
  await input.fire("keydown", { key: "ArrowDown" });
  assert.ok(input.getAttribute("aria-activedescendant"));
  await input.fire("keydown", { key: "Enter" });
  await host.querySelector(".dependency-form").fire("submit"); await tick();
  assert.equal(added, "duplicate-name-id");
  assert.equal(host.querySelector(".dependency-form").hidden, true);
  const estimate = host.querySelector('[aria-label="ETA"]');
  assert.equal(estimate.value, "1d");
  assert.equal(host.querySelector('[aria-label="Remaining work"]'), null);
  assert.equal(host.querySelector(".planning-title").textContent, "Planning");
  assert.equal(host.querySelector(".planning-summary").children.length, 2, "Planning and ETA share one row");
  assert.equal(host.querySelector(".planning-heading-label").querySelector('[aria-label="Edit planning"]') !== null, true, "edit belongs to the Planning heading");
  assert.equal(host.querySelector(".planning-preview").textContent, "ETA1d");
  assert.equal(host.querySelector(".planning-preview-value").textContent, "1d");
  assert.equal(host.querySelector(".planning-form").hidden, true);
  const editPlanning = host.querySelector('[aria-label="Edit planning"]');
  assert.equal(editPlanning.getAttribute("aria-expanded"), "false");
  await editPlanning.fire("click");
  assert.equal(host.querySelector(".planning-preview").hidden, true);
  assert.equal(host.querySelector(".planning-form").hidden, false);
  assert.equal(editPlanning.getAttribute("aria-expanded"), "true");
  estimate.value = "2h";
  await host.querySelector(".planning-actions").querySelectorAll("button").find(node => node.textContent === "Cancel").fire("click");
  assert.equal(host.querySelector(".planning-form").hidden, true);
  assert.equal(host.querySelector(".planning-preview-value").textContent, "1d");
  await editPlanning.fire("click");
  assert.equal(estimate.value, "1d", "cancel restores the saved estimate");
  estimate.value = "4h";
  view.update({ ...model, inheritedDependencies: [{ name: "Foundation", parentName: "Epic" }] });
  assert.equal(estimate.value, "4h");
  host.querySelector('[aria-label="Maximum FTE"]').value = "0.25";
  await host.querySelector(".planning-form").fire("submit");
  assert.equal(estimateMinutes, 240);
  assert.equal(Object.hasOwn(planning, "remainingMinutes"), false);
  assert.equal(planning.maxFte, 0.25);
  assert.equal(Object.hasOwn(planning, "done"), false);
  assert.equal(host.querySelector(".planning-form").hidden, true, "successful save returns to the preview");
  view.update({ ...model, limitMinutes: estimateMinutes, planning: planning });
  assert.equal(host.querySelector(".planning-preview-value").textContent, "4h");
  await editPlanning.fire("click");
  const help = host.querySelector('[aria-label="About Maximum FTE"]');
  const tooltip = host.querySelector('[role="tooltip"]');
  assert.equal(tooltip.hidden, true);
  assert.equal(host.querySelector(".fte-editor .hint"), null, "FTE explanation is not a paragraph in the form");
  await help.fire("mouseenter");
  assert.equal(tooltip.hidden, false);
  await help.fire("mouseleave");
  assert.equal(tooltip.hidden, true);
  await help.fire("click");
  assert.equal(tooltip.hidden, false);
  await help.fire("keydown", { key: "Escape" });
  assert.equal(tooltip.hidden, true);
  await host.querySelector(".planning-form").querySelectorAll("button").find(node => node.textContent === "Cancel").fire("click");
  assert.equal(host.querySelector(".planning-form").hidden, true);
  assert.equal(host.querySelector(".planning-preview-value").textContent, "4h");
  view.update({ ...model, canWrite: false });
  assert.equal(host.querySelector('[aria-label="Edit planning"]').hidden, true);
  assert.equal(form.hidden, true);
  assert.equal(add.hidden, true);
  assert.equal(help.disabled, false, "help stays accessible on read-only cards");
  await help.fire("focus");
  assert.equal(tooltip.hidden, false);
  await help.fire("blur");
  assert.equal(tooltip.hidden, true);
});

test("failed planning saves keep the editor and its draft, while Cancel restores the preview", async () => {
  const d = ui(), host = d.host();
  const view = d.window.TimePlanningView.mount(host, { settings: () => ({}), onTimeline() {}, onInspectDependencies: async () => ({ count: 0 }),
    onCardSearch: async () => [], onDependencyAdd: async () => {}, onDependencyRemove: async () => {},
    onPlanning: async () => { throw new Error("offline write"); } });
  view.update({ cardId: "task", settings: {}, limitMinutes: 480, dependencies: [], canWrite: true });
  await host.querySelector('[aria-label="Edit planning"]').fire("click");
  const estimate = host.querySelector('[aria-label="ETA"]');
  estimate.value = "2h";
  await host.querySelector(".planning-form").fire("submit");
  assert.equal(host.querySelector(".planning-form").hidden, false);
  assert.equal(estimate.value, "2h");
  assert.match(host.querySelector(".planning-form [role=alert]").textContent, /offline write/);
  assert.equal(host.querySelector(".planning-form [type=submit]").disabled, false);
  await host.querySelector(".planning-actions").querySelectorAll("button").find(node => node.textContent === "Cancel").fire("click");
  assert.equal(host.querySelector(".planning-preview").hidden, false);
  assert.equal(host.querySelector(".planning-preview-value").textContent, "1d");
  await host.querySelector('[aria-label="Edit planning"]').fire("click");
  assert.equal(estimate.value, "1d");
  await host.querySelector(".planning-form").fire("keydown", { key: "Escape" });
  assert.equal(host.querySelector(".planning-form").hidden, true);
});

test("the complete preview boots with the real HTML script order and exposes the handoff example", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const d = createDom();
  d.context.location = { search: "" };
  for (const id of ["card-picker", "card-app", "report-app", "timeline-app"]) {
    const node = d.document.createElement(id === "card-picker" ? "select" : "div"); node.id = id; d.document.body.appendChild(node);
  }
  const html = fs.readFileSync(require.resolve("../preview.html"), "utf8");
  for (const script of html.matchAll(/src="(js\/[^"?]+)(?:\?[^"\s]*)?"/g)) vm.runInContext(fs.readFileSync(require.resolve("../" + script[1]), "utf8"), d.context);
  const cardHost = d.document.getElementById("card-app");
  assert.match(cardHost.textContent, /Depends on/);
  assert.equal(cardHost.querySelector(".card-time").children[0].querySelector(".planning-title").textContent, "Planning", "Planning is above tabs and dependencies");
  assert.equal(cardHost.querySelector(".planning-preview-value").textContent, "2w", "preview shows the saved estimate");
  assert.equal(cardHost.querySelector(".planning-form").hidden, true);
  assert.ok(cardHost.querySelector('[aria-label="Edit planning"]'));
  assert.equal(cardHost.querySelectorAll('[aria-label="ETA"]').length, 1, "one editor updates the original estimate");
  assert.equal(cardHost.querySelector('[aria-label="Remaining work"]'), null);
  assert.match(d.document.getElementById("report-app").textContent, /2d 10m/);
  assert.match(d.document.getElementById("timeline-app").textContent, /Task D/);
  assert.doesNotMatch(d.document.getElementById("timeline-app").querySelector(".timeline-summary").textContent, /incomplete/);
});

test("stale dependency searches cannot replace the selected card identity", async () => {
  const d = ui(), host = d.host(); let release, added;
  const old = new Promise(resolve => { release = resolve; });
  const view = d.window.TimePlanningView.mount(host, { settings: () => ({}), onTimeline() {}, onInspectDependencies: async () => ({ count: 0 }),
    onCardSearch: query => query === "old" ? old : Promise.resolve([{ id: "new", name: "Same title" }]),
    onDependencyAdd: async (text, id) => { added = id; }, onDependencyRemove: async () => {}, onPlanning: async () => {} });
  view.update({ cardId: "task", settings: {}, dependencies: [], canWrite: true });
  await host.querySelectorAll("button").find(node => node.textContent === "+ add dependency").fire("click");
  const input = host.querySelector('[role="combobox"]');
  input.value = "old"; const searching = input.fire("input");
  input.value = "new"; await input.fire("input");
  release([{ id: "old", name: "Same title" }]); await searching;
  await input.fire("keydown", { key: "ArrowDown" });
  await input.fire("keydown", { key: "Enter" });
  await host.querySelector(".dependency-form").fire("submit"); await tick();
  assert.equal(added, "new");
});
