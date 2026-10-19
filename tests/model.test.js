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

test("drops notes when the card blob would exceed the Trello limit", function () {
  const state = model.emptyState();
  for (let i = 0; i < 40; i += 1) {
    state.entries.push(entry("e" + i, 20260101 + i, 30, "x".repeat(200), 1000 + i));
  }
  const fit = model.fitState(state);
  assert.ok(model.pluginChars(fit.packed) <= model.MAX_PLUGIN_CHARS);
  assert.ok(fit.warning);
  assert.equal(model.totalMinutes(fit.state.entries), 1200);
});

test("refuses to save when even compact entries do not fit", function () {
  const state = model.emptyState();
  for (let day = 0; day < 400; day += 1) {
    state.entries.push(entry("e" + day, 20260101 + day, 15, "", day));
  }
  assert.throws(function () { model.fitState(state); }, /4 KB/);
});
