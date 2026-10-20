const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../js/runtime");
const model = require("../js/model");
const epic = require("../js/epic");
const tick = () => new Promise(resolve => setImmediate(resolve));

test("reader coalesces pending reads, bounds concurrency and does not cache results", async () => {
  const read = runtime.createReader(3);
  let active = 0;
  let peak = 0;
  let calls = 0;
  const fetch = async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await tick();
    active--;
    return calls;
  };
  const first = read("same", fetch);
  assert.equal(read("same", fetch), first);
  await Promise.all([first, ...Array.from({ length: 20 }, (_, i) => read(String(i), fetch))]);
  assert.equal(calls, 21);
  assert.equal(peak, 3);
  await read("same", fetch);
  assert.equal(calls, 22);
  await assert.rejects(read("failure", () => { throw new Error("offline"); }), /offline/);
  assert.equal(await read("failure", () => 42), 42);
});

test("pool preserves input order with at most eight in-flight reads", async () => {
  let active = 0;
  let peak = 0;
  const input = Array.from({ length: 100 }, (_, i) => i);
  const output = await runtime.mapPool(input, 8, async i => {
    peak = Math.max(peak, ++active);
    await tick();
    active--;
    return i * 2;
  });
  assert.equal(peak, 8);
  assert.deepEqual(output, input.map(i => i * 2));
});

test("render bursts run one trailing refresh without overlapping loads", async () => {
  let calls = 0;
  let active = 0;
  let peak = 0;
  const refresh = runtime.coalesce(async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await tick();
    active--;
  });
  const first = refresh();
  await Promise.resolve();
  assert.equal(refresh(), first);
  refresh();
  await first;
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  await refresh();
  assert.equal(calls, 3);
});

test("a failed refresh can be retried", async () => {
  let calls = 0;
  const refresh = runtime.coalesce(() => {
    if (++calls === 1) throw new Error("offline");
  });
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.equal(calls, 2);
});

test("failed pools stop scheduling and finish in-flight work before rejecting", async () => {
  let calls = 0;
  let active = 0;
  await assert.rejects(runtime.mapPool(Array.from({ length: 100 }), 3, async (_, i) => {
    calls++;
    if (i === 0) throw new Error("offline");
    active++;
    await tick();
    active--;
  }), /offline/);
  assert.equal(active, 0);
  assert.equal(calls, 3);
});

test("child logs fall back to REST even when both SDK reads reject", async t => {
  const packed = { who: [["me", "Me"]], e: [["entry", 20261020, 90, 0]] };
  const urls = [];
  t.mock.method(globalThis, "fetch", async url => {
    urls.push(new URL(url));
    return { ok: true, json: async () => [{ value: JSON.stringify({ time: packed }) }] };
  });
  const client = { get: async () => { throw new Error("SDK cannot read card"); } };
  const actual = await runtime.readSharedTime(client, "child", { appKey: "key", token: "token" }, model);
  assert.equal(model.totalMinutes(model.decode(actual).entries), 90);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, "/1/cards/child/pluginData");
});

test("board times distinguish an empty log from unreadable data", async t => {
  t.mock.method(globalThis, "fetch", async url => ({
    ok: !url.includes("/broken/"), status: 403, json: async () => []
  }));
  const result = await runtime.loadBoardTimes({
    cards: async () => [{ id: "empty" }, { id: "broken" }],
    get: async id => {
      if (id === "broken") throw new Error("SDK read failed");
      return null;
    },
    getRestApi: () => ({ isAuthorized: () => true, getToken: () => "token" })
  }, "key", model);
  assert.equal(result.timeById.get("empty"), null);
  assert.equal(result.timeById.get("broken"), undefined);
  assert.deepEqual([...result.unreadableIds], ["broken"]);
});

test("remote checklist names resolve child links and deduplicate them", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async url => {
    requests.push(new URL(url));
    return { ok: true, json: async () => [{
      id: "list", checkItems: [
        { name: "https://trello.com/c/childOne/task" },
        { name: "[Task](https://trello.com/c/childOne/task)", state: "complete" }
      ]
    }] };
  });
  const result = await runtime.resolveChecklistInspection({
    getRestApi: () => ({ isAuthorized: () => true, getToken: () => "token" })
  }, "epic", { checklists: [{ id: "list" }] }, true, "key", epic, {
    boardCards: [{ id: "child", shortLink: "childOne", name: "Task" }]
  });
  assert.equal(result.complete, true);
  assert.equal(result.remoteChecklistsFetched, true);
  assert.deepEqual(result.childIds, ["child"]);
  assert.equal(requests[0].searchParams.get("checkItem_fields"), "name,state");
});

test("500 empty logs require 500 SDK reads, no REST or authorization calls", async t => {
  let reads = 0;
  let auth = 0;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Unexpected REST"); });
  const cards = Array.from({ length: 500 }, (_, i) => ({ id: String(i) }));
  const loaded = await runtime.loadBoardTimes({
    cards: async () => { throw new Error("Already have card metadata"); },
    get: async () => { reads++; return null; },
    getRestApi: () => { auth++; throw new Error("Unnecessary authorization lookup"); }
  }, "key", model, cards);
  assert.equal(reads, 500);
  assert.equal(auth, 0);
  assert.equal(requests, 0);
  assert.equal(loaded.unreadableIds.size, 0);
  assert.equal(loaded.timeById.size, 500);
});

test("malformed logs remain unknown if no fallback can read them", async () => {
  const client = { get: async (id, visibility, key) => key ? "invalid JSON" : { time: "invalid JSON" } };
  assert.equal(await runtime.readSharedTime(client, "broken", null, model), undefined);
});

test("epics read only their visible children, deduplicate links, and refresh changed logs", async () => {
  const cards = Array.from({ length: 500 }, (_, i) => ({ id: "card" + i, shortLink: "link" + i, name: "Card " + i }));
  const reads = [];
  let minutes = 30;
  const client = {
    cards: async () => cards,
    get: async id => {
      reads.push(id);
      return { who: [["me", "Me"]], e: [["entry", 20261020, minutes, 0]] };
    }
  };
  const card = { id: "epic", checklists: [{ checkItems: [
    { name: "https://trello.com/c/link3" },
    { name: "https://trello.com/c/link3" },
    { name: "https://trello.com/c/link7" },
    { name: "https://trello.com/c/missing" }
  ] }] };
  let loaded = await runtime.loadCardChildren(client, card, "", model, epic);
  assert.deepEqual(reads, ["card3", "card7"]);
  assert.equal(loaded.inspection.complete, false);
  assert.equal(model.totalMinutes(model.decode(loaded.board.timeById.get("card3")).entries), 30);
  minutes = 60;
  loaded = await runtime.loadCardChildren(client, card, "", model, epic);
  assert.equal(model.totalMinutes(model.decode(loaded.board.timeById.get("card3")).entries), 60);
  assert.equal(reads.length, 4);
});

test("empty REST checklists do not trigger another request per checklist", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return { ok: true, json: async () => [{ id: "list", checkItems: [] }] };
  });
  const result = await runtime.resolveChecklistInspection({
    getRestApi: () => ({ isAuthorized: () => true, getToken: () => "token" })
  }, "epic", { checklists: [{ id: "list" }] }, true, "key", epic, { boardCards: [] });
  assert.equal(requests, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.childIds, []);
});

test("epic rollups use nested task logs, exclude sub-epic logs and count shared tasks once", async () => {
  const cards = [
    { id: "sub", shortLink: "sub", checklists: [{ checkItems: [{ idCard: "task" }, { idCard: "deeper" }] }] },
    { id: "deeper", shortLink: "deeper", checklists: [{ checkItems: [{ idCard: "task2" }] }] },
    { id: "task", shortLink: "task", checklists: [] },
    { id: "task2", shortLink: "task2", checklists: [] },
    { id: "unrelated", shortLink: "unrelated", checklists: [] }
  ];
  const reads = [];
  const client = {
    cards: async () => cards,
    get: async id => {
      reads.push(id);
      return { lim: id === "sub" || id === "deeper" ? 600 : undefined,
        who: [["me", "Me"]], e: [["entry", 20261020, id === "task" ? 90 : id === "task2" ? 30 : 999, 0]] };
    }
  };
  const loaded = await runtime.loadCardChildren(client, {
    id: "epic", checklists: [{ checkItems: [{ idCard: "sub" }, { idCard: "task" }] }]
  }, "", model, epic);
  assert.equal(loaded.board.totalsById.get("sub").minutes, 120);
  assert.equal(loaded.board.totalsById.get("sub").entries.length, 2);
  assert.equal(loaded.board.totalsById.get("sub").missing, false);
  assert.equal(loaded.board.totalsById.get("task").minutes, 0);
  assert.deepEqual(reads.sort(), ["deeper", "sub", "task", "task2"]);
});

test("nested missing links and cycles make the epic total unknown", async () => {
  for (const target of ["unavailable", "epic"]) {
    const client = {
      cards: async () => [{ id: "sub", checklists: [{ checkItems: [{ idCard: target }] }] }],
      get: async () => ({ lim: 600, entries: [] })
    };
    const loaded = await runtime.loadCardChildren(client, {
      id: "epic", checklists: [{ checkItems: [{ idCard: "sub" }] }]
    }, "", model, epic);
    assert.equal(loaded.board.totalsById.get("sub").missing, true);
  }
});
