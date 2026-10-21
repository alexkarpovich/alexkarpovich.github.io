const test = require("node:test");
const assert = require("node:assert/strict");
const cache = require("../js/rollup-cache");
const epic = require("../js/epic");
const duration = require("../js/duration");

let sequence = 0;
function fixture() {
  const prefix = "cache" + (++sequence) + "-";
  const id = name => prefix + name;
  const checklist = children => [{ checkItems: children.map(name => ({ idCard: id(name) })) }];
  const cards = [
    { id: id("root"), name: "Epic", checklists: checklist(["a", "b"]) },
    { id: id("a"), name: "Sub A", checklists: checklist(["task", "other"]) },
    { id: id("b"), name: "Sub B", checklists: checklist(["task"]) },
    { id: id("task"), name: "Shared task", checklists: [] },
    { id: id("other"), name: "Other task", checklists: [] }
  ];
  cards.forEach(card => { card.shortLink = card.id.replace(/-/g, ""); card.url = "https://trello.com/c/" + card.shortLink; });
  const log = minutes => ({ who: [["me", "Me"]], e: [["entry", 20261020, minutes, 0]] });
  const data = new Map([
    [id("root"), { time: { ...log(999), lim: 600 } }],
    [id("a"), { time: { ...log(999), lim: 300 } }],
    [id("b"), { time: { ...log(999), lim: 300 } }],
    [id("task"), { time: log(60) }], [id("other"), { time: log(30) }]
  ]);
  const reads = [], writes = [];
  let scans = 0, writable = true, rejectWrites = false, failRead = "";
  const client = {
    getContext: () => ({ board: prefix, permissions: { board: writable ? "write" : "read" } }),
    cards: async () => { scans++; return structuredClone(cards); },
    get: async (cardId, visibility, key, fallback) => {
      reads.push([cardId, key]);
      if (cardId === failRead) throw new Error("offline");
      const value = data.get(cardId) || {};
      return structuredClone(key ? value[key] === undefined ? fallback : value[key] : value);
    },
    set: async (cardId, visibility, key, value) => {
      if (rejectWrites) throw new Error("write failed");
      const next = { ...(data.get(cardId) || {}), ...(typeof key === "object" ? key : { [key]: value }) };
      assert.ok(JSON.stringify(next).length <= 4000, "cache respects the shared storage budget");
      data.set(cardId, structuredClone(next));
      writes.push(cardId);
    },
    remove: async (cardId, visibility, key) => {
      if (rejectWrites) throw new Error("write failed");
      delete data.get(cardId)[key];
      writes.push(cardId);
    }
  };
  const card = name => cards.find(item => item.id === id(name));
  const load = (name = "root", options = {}) => cache.loadCardChildren(client, structuredClone(card(name)), "", {
    shared: structuredClone(data.get(id(name))), ...options
  });
  const total = name => data.get(id(name)).rollup.c.reduce((sum, row) => sum + row[3], 0);
  async function change(name, minutes) {
    const tx = await cache.prepareChange(client, card(name), "", data.get(id(name)));
    const packed = minutes == null ? null : log(minutes);
    data.get(id(name)).time = packed;
    await cache.finishChange(client, tx, "", packed);
    return tx;
  }
  return { client, cards, card, id, data, log, reads, writes, load, total, change,
    scans: () => scans, writable: value => { writable = value; }, rejectWrites: value => { rejectWrites = value; },
    failRead: name => { failRead = id(name); } };
}

test("cold epic is persisted; reopening reads neither descendants nor board metadata", async () => {
  const h = fixture(), original = structuredClone(h.data.get(h.id("root")).time);
  const live = await h.load();
  assert.equal(live.board.totalsById.get(h.id("a")).minutes, 90);
  assert.equal(live.board.totalsById.get(h.id("b")).minutes, 0, "shared task counted once for the root");
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), true);
  assert.deepEqual(h.data.get(h.id("root")).time, original);
  assert.deepEqual(h.data.get(h.id("task")).rollupLinks.p, [h.id("a"), h.id("b")]);
  const scans = h.scans(), reads = h.reads.length, writes = h.writes.length;
  const reopened = await h.load();
  assert.equal(reopened.cached, true);
  assert.equal(h.scans(), scans);
  assert.equal(h.reads.length, reads);
  assert.equal(h.writes.length, writes);
  assert.equal(reopened.board.entries.reduce((sum, entry) => sum + entry.minutes, 0), 90);
  const settings = { excludedDates: ["2026-10-21"] };
  const today = new Date(2026, 9, 20, 12);
  const remaining = 600 - reopened.board.entries.reduce((sum, entry) => sum + entry.minutes, 0);
  assert.equal(epic.estimateFinish(remaining, settings, today), epic.estimateFinish(510, settings, today));
});

test("adding, editing and deleting task time updates all ancestors without opening them", async () => {
  const h = fixture();
  await h.load();
  for (const [minutes, expected] of [[90, 120], [120, 150], [null, 30]]) {
    const before = structuredClone(h.data.get(h.id("root")).time);
    const tx = await h.change("task", minutes);
    assert.deepEqual([...tx.affected].sort(), [h.id("a"), h.id("b"), h.id("root")].sort());
    assert.equal(h.total("root"), expected);
    assert.equal(h.total("a"), expected);
    assert.equal(h.total("b"), minutes || 0);
    assert.deepEqual(h.data.get(h.id("root")).time, before);
    assert.equal((await h.load()).cached, true);
  }
});

test("checklist changes rebuild the parent and remove stale reverse links", async () => {
  const h = fixture();
  await h.load();
  h.card("a").checklists[0].checkItems = [];
  const rebuilt = await h.load("a");
  assert.equal(rebuilt.inspection.childIds.length, 0);
  assert.equal(h.total("root"), 60, "only Sub B still contributes the shared task");
  assert.deepEqual(h.data.get(h.id("task")).rollupLinks.p, [h.id("b")]);
  assert.equal(h.data.get(h.id("other")).rollupLinks, undefined);
});

test("expired caches recover edits made outside the application", async t => {
  const h = fixture();
  await h.load();
  h.data.get(h.id("task")).time = h.log(180);
  const timestamp = h.data.get(h.id("root")).rollup.t;
  t.mock.method(Date, "now", () => timestamp + cache.TTL + 1);
  await h.load();
  assert.equal(h.total("root"), 210);
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), true);
});

test("corrupt caches and incomplete child reads cannot yield an optimistic cached remainder", async () => {
  const h = fixture();
  await h.load();
  h.data.get(h.id("root")).rollup.c[0][3] = 1;
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), false);
  h.failRead("task");
  const live = await h.load();
  assert.equal(live.board.totalsById.get(h.id("a")).missing, true);
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), false);
  const writes = h.writes.length;
  await h.load();
  assert.equal(h.writes.length, writes, "failed repair does not create a render/write loop");
});

test("read-only members use shared caches and never write during a live fallback", async () => {
  const h = fixture();
  h.writable(false);
  await h.load();
  assert.equal(h.writes.length, 0);
  h.writable(true);
  await h.load();
  h.writable(false);
  const writes = h.writes.length;
  assert.equal((await h.load()).cached, true);
  assert.equal(h.writes.length, writes);
});

test("full storage keeps source logs and falls back to live computation", async () => {
  const h = fixture();
  const source = h.data.get(h.id("root"));
  source.other = "x".repeat(3750);
  const original = structuredClone(source);
  const live = await h.load();
  assert.equal(live.board.totalsById.get(h.id("a")).minutes, 90);
  assert.deepEqual(h.data.get(h.id("root")).time, original.time);
  assert.equal(h.data.get(h.id("root")).other, original.other);
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), false);
  const writes = h.writes.length;
  await h.load();
  assert.equal(h.writes.length, writes, "a successful small backlink write does not retry the oversized cache");
});

test("an earlier propagation cannot replace a newer invalidation token", async () => {
  const h = fixture();
  await h.load();
  const first = await cache.prepareChange(h.client, h.card("task"), "", h.data.get(h.id("task")));
  const second = await cache.prepareChange(h.client, h.card("other"), "", h.data.get(h.id("other")));
  h.data.get(h.id("task")).time = h.log(120);
  await cache.finishChange(h.client, first, "", h.log(120));
  assert.equal(h.data.get(h.id("root")).rollup.dirty, second.token);
  h.data.get(h.id("other")).time = h.log(45);
  await cache.finishChange(h.client, second, "", h.log(45));
  assert.equal(h.total("root"), 165);
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), true);
});

test("cached totals use the current board calendar for the estimate", async () => {
  const h = fixture();
  await h.load();
  const related = await h.load();
  const spent = related.board.entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const today = new Date(2026, 9, 20, 12);
  assert.equal(epic.estimateFinish(570 - spent, duration.normalizeSettings(null), today), "2026-10-21");
  assert.equal(epic.estimateFinish(570 - spent, { excludedDates: ["2026-10-21"] }, today), "2026-10-22");
});

test("the first task save discovers and populates every parent even before an epic was opened", async () => {
  const h = fixture();
  await h.change("task", 75);
  assert.equal(h.total("root"), 105);
  assert.equal(h.total("a"), 105);
  assert.equal(h.total("b"), 75);
});

test("reverse indexes invalidate all ancestors when checklist metadata is unavailable", async () => {
  const h = fixture();
  await h.load();
  h.cards.forEach(card => { if (card.checklists.length) card.checklists = undefined; });
  const tx = await cache.prepareChange(h.client, h.card("task"), "", h.data.get(h.id("task")));
  assert.deepEqual([...tx.affected].sort(), [h.id("a"), h.id("b"), h.id("root")].sort());
  assert.equal(h.data.get(h.id("root")).rollup.dirty, tx.token);
  await cache.finishChange(h.client, tx, "", h.log(120));
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), false);
});

test("failed board discovery still invalidates known parents before the source write", async () => {
  const h = fixture();
  await h.load();
  h.client.cards = async () => { throw new Error("offline metadata"); };
  const tx = await cache.prepareChange(h.client, h.card("task"), "", h.data.get(h.id("task")));
  assert.equal(h.data.get(h.id("root")).rollup.dirty, tx.token);
  assert.equal(h.data.get(h.id("a")).rollup.dirty, tx.token);
  await assert.rejects(cache.finishChange(h.client, tx, "", h.log(90)), /relationships/);
});

test("denied cache writes retain source data and still return the live total", async () => {
  const h = fixture();
  const original = structuredClone(h.data);
  h.rejectWrites(true);
  const live = await h.load();
  assert.equal(live.board.totalsById.get(h.id("a")).minutes, 90);
  assert.deepEqual(h.data, original);
  assert.equal(h.writes.length, 0);
});

test("ancestor discovery keeps the opened card's short link from board metadata", async () => {
  const h = fixture();
  h.card("root").checklists = [{ checkItems: [{ name: h.card("a").url }] }];
  const minimal = { id: h.id("a"), name: "Sub A", checklists: h.card("a").checklists };
  await cache.loadCardChildren(h.client, minimal, "", { shared: h.data.get(h.id("a")) });
  assert.equal(h.total("root"), 90);
  assert.deepEqual(h.data.get(h.id("a")).rollupLinks.p, [h.id("root")]);
  assert.equal(cache.valid(h.data.get(h.id("a")).rollup, minimal), true);
});

test("one propagation shares descendant reads across all affected ancestors", async () => {
  const h = fixture();
  await h.change("task", 75);
  assert.equal(h.reads.filter(([id, key]) => id === h.id("other") && key === "time").length, 1);
  assert.equal(h.reads.filter(([id, key]) => id === h.id("task") && key === "time").length, 0,
    "the just-saved source log is passed directly to the calculation");
});

test("changing a task to an epic excludes its own log from ancestor totals", async () => {
  const h = fixture();
  await h.load();
  const tx = await cache.prepareChange(h.client, h.card("task"), "", h.data.get(h.id("task")));
  const changed = { ...h.log(60), lim: 120 };
  h.data.get(h.id("task")).time = changed;
  await cache.finishChange(h.client, tx, "", changed);
  assert.equal(h.total("root"), 30);
  assert.equal(h.total("a"), 30);
  assert.equal(h.total("b"), 0);
});

test("a failed source write leaves ancestors dirty and the next open restores the old total", async () => {
  const h = fixture();
  await h.load();
  const tx = await cache.prepareChange(h.client, h.card("task"), "", h.data.get(h.id("task")));
  const originalSet = h.client.set;
  h.client.set = async (...args) => {
    if (args[2] === "time") throw new Error("source save failed");
    return originalSet(...args);
  };
  await assert.rejects(h.client.set(h.id("task"), "shared", "time", h.log(90)), /source save failed/);
  assert.equal(h.data.get(h.id("root")).rollup.dirty, tx.token);
  await h.load();
  assert.equal(h.total("root"), 90);
});

test("cyclic dependencies never become a valid persisted total", async () => {
  const h = fixture();
  h.card("a").checklists[0].checkItems.push({ idCard: h.id("root") });
  const related = await h.load();
  assert.equal(related.board.totalsById.get(h.id("a")).missing, true);
  assert.equal(cache.valid(h.data.get(h.id("root")).rollup, h.card("root")), false);
});

test("hidden checklist items are resolved in one board request and warm opens skip REST", async t => {
  const h = fixture();
  h.cards.forEach(card => card.checklists.forEach((list, i) => { list.id = card.id + "-list" + i; }));
  const remote = structuredClone(h.cards);
  h.cards.forEach(card => card.checklists.forEach(list => { delete list.checkItems; }));
  h.client.getRestApi = () => ({ isAuthorized: () => true, getToken: () => "test-token" });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async url => {
    requests++;
    assert.match(url, /\/boards\/.*\/cards\?/);
    return { ok: true, json: async () => remote };
  });
  const options = () => ({ shared: structuredClone(h.data.get(h.id("root"))) });
  const loaded = await cache.loadCardChildren(h.client, h.card("root"), "key", options());
  assert.equal(loaded.inspection.remoteChecklistsFetched, true);
  assert.equal(h.total("root"), 90);
  assert.equal(requests, 1);
  assert.equal((await cache.loadCardChildren(h.client, h.card("root"), "key", options())).cached, true);
  assert.equal(requests, 1);
});
