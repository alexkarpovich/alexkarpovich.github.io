const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createDom } = require("./helpers/dom");
function harness(options = {}) {
  const d = createDom(), host = d.host(); host.id = "app";
  let render, writes = 0, fail = false, dueComplete = false;
  let shared = options.shared || { unrelated: "preserved" };
  const client = {
    getContext: () => ({ permissions: { board: options.readonly ? "read" : "write" } }),
    arg: () => "task",
    cards: async (...fields) => { if (fail) throw new Error("offline"); assert.ok(fields.includes("dueComplete")); return [{ id: "task", name: "Work", dueComplete }]; },
    get: async (scope, visibility, key, fallback) => scope === "board" ? key ? shared[key] ?? fallback : structuredClone(shared) : { lim: 480, e: [] },
    set: async (scope, visibility, key, value) => { if (options.rejectSave) throw new Error("offline write"); assert.equal(scope, "board"); assert.equal(key, "timeline"); shared[key] = structuredClone(value); writes++; },
    render: fn => { render = fn; }
  };
  d.window.parent = {}; d.window.TrelloPowerUp = { iframe: () => client };
  const html = fs.readFileSync(require.resolve("../timeline.html"), "utf8");
  for (const script of html.matchAll(/src="(js\/[^"?]+)(?:\?[^"\s]*)?"/g)) vm.runInContext(fs.readFileSync(require.resolve("../" + script[1]), "utf8"), d.context);
  return { ...d, host, render: () => render(), writes: () => writes, shared: () => shared, fail: value => { fail = value; }, setDone: value => { dueComplete = value; } };
}
test("real timeline page script order boots, writes board calendar and preserves other shared keys", async () => {
  const h = harness(); await h.render();
  assert.match(h.host.textContent, /Timeline/);
  h.host.querySelector('[aria-label="Default FTE"]').value = "0.5";
  await h.host.querySelector("form").fire("submit");
  assert.equal(h.writes(), 1);
  assert.equal(h.shared().unrelated, "preserved");
  assert.equal(h.shared().timeline.baseFte, 0.5);
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

test("timeline refresh reads native Trello Done and reopening returns remaining work to the plan", async () => {
  const h = harness(); h.setDone(true); await h.render();
  assert.match(h.host.querySelector(".timeline-summary").textContent, /0m remaining/);
  assert.match(h.host.querySelector(".timeline-card-text").textContent, /Work/);
  assert.ok(h.host.querySelector(".is-done"));
  h.setDone(false); await h.render();
  assert.doesNotMatch(h.host.querySelector(".timeline-summary").textContent, /0m remaining/);
  assert.equal(h.host.querySelector(".is-done"), null);
});
