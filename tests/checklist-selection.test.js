const test = require("node:test");
const assert = require("node:assert/strict");
const epic = require("../js/epic");
const runtime = require("../js/runtime");
const model = require("../js/model");

function lists() {
  return [
    { id: "dependencies", name: "Depends on", pos: 20, checkItems: [{ idCard: "dependency" }] },
    { id: "tasks", name: "Sub-tasks", pos: 10, checkItems: [{ idCard: "task" }] }
  ];
}

test("automatic selection uses Trello position, with array order as the SDK fallback", () => {
  const checklists = lists();
  assert.deepEqual(epic.inspectChecklists(checklists, "epic").childIds, ["task"]);
  assert.equal(checklists[0].id, "dependencies", "selection does not mutate SDK data");
  checklists.forEach(list => { delete list.pos; });
  assert.deepEqual(epic.inspectChecklists(checklists, "epic").childIds, ["dependency"]);
  assert.deepEqual(epic.inspectChecklists([], "epic").childIds, []);
});

test("manual selection survives renaming and reordering and never falls back after deletion", () => {
  const checklists = lists();
  checklists[0].name = "Sub-tasks";
  checklists[0].pos = 5;
  checklists[1].name = "Renamed";
  const inspect = value => epic.inspectChecklists(value, "epic", null, null, "tasks");
  assert.deepEqual(inspect(checklists).childIds, ["task"]);
  assert.equal(inspect([checklists[0]]).complete, false);
  assert.equal(inspect([]).complete, false);
  assert.equal(inspect(undefined).complete, false);
  assert.equal(epic.inspectChecklists(checklists, "epic", null, null, false).complete, false);
});

test("unselected hidden or broken checklist items cannot affect task completeness", () => {
  const checklists = lists();
  delete checklists[0].checkItems;
  assert.equal(epic.inspectChecklists(checklists, "epic").complete, true);
  checklists[0].checkItems = [{ name: "https://trello.com/c/missing" }];
  assert.equal(epic.inspectChecklists(checklists, "epic").complete, true);
  checklists[1].checkItems = [];
  assert.deepEqual(epic.inspectChecklists(checklists, "epic").childIds, [], "an empty first list does not select another list");
});

test("REST fallback preserves manual selection even when server order differs", async t => {
  const remote = lists();
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => remote }));
  const result = await runtime.resolveChecklistInspection({}, "epic", {
    subtasksChecklistId: "dependencies", checklists: [{ id: "tasks" }, { id: "dependencies" }]
  }, true, "key", epic, { boardCards: [], getRest: async () => ({ token: "test" }) });
  assert.deepEqual(result.childIds, ["dependency"]);
  assert.deepEqual(result.checklists.map(list => list.id), ["dependencies"]);
  assert.equal(result.allChecklists.length, 2);
});

test("nested rollups respect each card's own choice and skip dependency logs", async () => {
  const root = { id: "root", checklists: [{ id: "root-tasks", checkItems: [{ idCard: "sub" }] }] };
  const cards = [{ id: "sub", checklists: lists() }, { id: "task", checklists: [] }, { id: "dependency", checklists: [] }];
  const logs = new Map([
    ["sub", { sc: "dependencies", e: [] }],
    ["task", { e: [["a", 20261020, 90, 0]] }],
    ["dependency", { e: [["b", 20261020, 30, 0]] }]
  ]);
  const reads = [];
  const client = { cards: async () => cards, get: async id => { reads.push(id); return logs.get(id); } };
  const related = await runtime.loadCardChildren(client, root, "", model, epic);
  assert.equal(related.board.totalsById.get("sub").minutes, 30);
  assert.deepEqual(reads, ["sub", "dependency"]);
  cards[0].checklists = [];
  const missing = await runtime.loadCardChildren(client, root, "", model, epic);
  assert.equal(missing.board.totalsById.get("sub").missing, true);
});
