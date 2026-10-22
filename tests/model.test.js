const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../js/model");

function entry(id, ymd, minutes, note, createdAt) {
  return {
    id: id,
    ymd: ymd,
    minutes: minutes,
    memberId: "507f1f77bcf86cd799439011",
    memberName: "Анна Ковалева",
    note: note || "",
    createdAt: createdAt || 0
  };
}

test("decodes packed time from JSON strings and nested time objects", function () {
  const packed = model.pack(model.emptyState());
  packed.e = [["id1", 20261020, 30, 0]];
  packed.who = [["507f1f77bcf86cd799439011", "Author"]];
  const fromString = model.decode(JSON.stringify(packed));
  assert.equal(fromString.entries[0].minutes, 30);
  const fromWrapper = model.decode({ time: packed });
  assert.equal(fromWrapper.entries[0].minutes, 30);
});

test("packs and reads entries, limit, child cards and createdAt", function () {
  const state = model.emptyState();
  state.limitMinutes = 2400;
  state.kids = ["card-a", "card-b"];
  state.entries.push(entry("ab12", 20261019, 100, "ревью", 1760000000000));
  const packed = model.pack(state);
  const decoded = model.decode(packed);
  assert.equal(decoded.limitMinutes, 2400);
  assert.deepEqual(decoded.kids, ["card-a", "card-b"]);
  assert.equal(decoded.entries.length, 1);
  assert.equal(decoded.entries[0].minutes, 100);
  assert.equal(decoded.entries[0].note, "ревью");
  assert.equal(decoded.entries[0].createdAt, 1760000000000);
});

test("sorts by createdAt newest first", function () {
  const sorted = model.sortEntries([
    entry("a", 20261019, 10, "", 1000),
    entry("b", 20261018, 20, "", 3000),
    entry("c", 20261020, 30, "", 2000)
  ]);
  assert.deepEqual(sorted.map(function (item) { return item.id; }), ["b", "c", "a"]);
});

test("a checklist choice survives without a limit or time entries and can return to automatic", () => {
  const state = model.emptyState();
  state.subtasksChecklistId = "chosen-list";
  assert.equal(model.isEmpty(state), false);
  const fitted = model.fitState(state);
  assert.equal(fitted.state.subtasksChecklistId, "chosen-list");
  assert.equal(model.decode(fitted.packed).subtasksChecklistId, "chosen-list");
  state.subtasksChecklistId = null;
  assert.equal(model.isEmpty(state), true);
  assert.equal(model.decode(model.pack(state)).subtasksChecklistId, null);
  assert.equal(model.decode({ e: [], lim: 120 }).subtasksChecklistId, null, "old cards use automatic selection");
});

test("refuses overflow without merging entries or removing notes", function () {
  const state = model.emptyState();
  for (let i = 0; i < 40; i += 1) {
    state.entries.push(entry("e" + i, 20260101, 30, "x".repeat(200), 1760000000000 + i));
  }
  const before = structuredClone(state);
  assert.throws(() => model.fitState(state), { code: "STORAGE_FULL" });
  assert.deepEqual(state, before);
});

test("refuses to save when even compact entries do not fit", function () {
  const state = model.emptyState();
  for (let day = 0; day < 400; day += 1) {
    state.entries.push(entry("e" + day, 20260101 + day, 15, "", day));
  }
  assert.throws(function () { model.fitState(state); }, /4096 characters/);
});

test("counts other shared keys against the storage budget", function () {
  const state = model.emptyState();
  state.entries.push(entry("a", 20261019, 30));
  assert.equal(model.fitState(state).warning, null);
  assert.throws(() => model.fitState(state, { other: "x".repeat(4000) }), { code: "STORAGE_FULL" });
});

test("rejects non-finite minutes and invalid calendar dates", function () {
  const raw = { who: [["me", "Me"]], e: [
    ["a", 20260230, 10, 0], ["b", "bad", 20, 0], ["c", 20261019, Infinity, 0],
    ["d", 20261019, 30, 0]
  ] };
  const state = model.decode(raw);
  assert.deepEqual(state.entries.map(e => e.id), ["d"]);
  assert.equal(state.entries[0].createdAt, Date.UTC(2026, 9, 19));
  assert.throws(() => model.createEntry({ ymd: 20260230, minutes: 10 }), /valid date/);
  assert.throws(() => model.createEntry({ ymd: 20261019, minutes: Infinity }), /minutes/);
});

test("new entry IDs are unique and survive a round trip", function () {
  const state = model.emptyState();
  state.entries = Array.from({ length: 20 }, () => model.createEntry({ ymd: 20261019, minutes: 10, memberId: "me" }));
  assert.equal(new Set(state.entries.map(e => e.id)).size, 20);
  assert.deepEqual(model.decode(model.pack(state)).entries.map(e => e.id), state.entries.map(e => e.id));
});
