const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const model = require("../js/model");
const duration = require("../js/duration");
const epic = require("../js/epic");
const runtime = require("../js/runtime");
const tick = () => new Promise(resolve => setImmediate(resolve));

function runPage(name, window, extra = {}) {
  if (window.TimeRuntime) window.TimeRollupCache = require("../js/rollup-cache");
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js", name), "utf8"), {
    window, URL, console, ...extra
  });
}

function cardHarness(overrides = {}, environment = {}) {
  let render;
  let handlers;
  let latest;
  const updates = [];
  let shared = {};
  let writes = 0;
  let rejectWrite = false;
  let rejectRead = false;
  let rejectRefresh = false;
  let writable = true;
  let options;
  const client = {
    getContext: () => ({ permissions: { board: writable ? "write" : "read" } }),
    render: callback => { render = callback; },
    card: async () => ({ id: "card", name: "Card", checklists: [] }),
    board: async () => ({ id: "board" }),
    member: async () => ({ id: "me", fullName: "Me" }),
    get: async (scope, visibility, key, fallback) => {
      if (rejectRead) throw new Error("offline read");
      if (scope === "board") return fallback;
      return key ? shared[key] || fallback : structuredClone(shared);
    },
    set: async (scope, visibility, key, value) => {
      await tick();
      if (rejectWrite) throw new Error("offline write");
      if (typeof key === "object") Object.assign(shared, structuredClone(key));
      else shared[key] = structuredClone(value);
      writes++;
      if (rejectRefresh) rejectRead = true;
    },
    remove: async (scope, visibility, key) => { delete shared[key]; writes++; },
    sizeTo: async () => {},
    cards: async () => []
  };
  Object.assign(client, overrides);
  const window = {
    parent: {},
    TIMETRACK_CONFIG: { appKey: "test-key", appName: "Test" },
    TrelloPowerUp: { iframe: opts => { options = opts; return client; } },
    TimeTheme: { bind() {} },
    TimeRuntime: runtime,
    TimeDuration: duration,
    TimeModel: model,
    TimeEpic: epic,
    TimeCardView: { mount: (app, callbacks) => {
      handlers = callbacks;
      return { update: value => { latest = structuredClone(value); updates.push(latest); } };
    } }
  };
  runPage("card-page.js", window, {
    document: { getElementById: id => id === "app" ? {} : null },
    requestAnimationFrame: callback => callback(),
    ...environment
  });
  return {
    render: () => render(), handlers: () => handlers, latest: () => latest,
    writes: () => writes, options: () => options, updates: () => updates,
    rejectWrite: value => { rejectWrite = value; },
    rejectRefresh: value => { rejectRefresh = value; },
    writable: value => { writable = value; },
    shared: value => { shared = value; }
  };
}

const fields = { ymd: 20261020, minutes: 30, note: "Review" };

test("owned card links persist without limits and ignore native checklists", async () => {
  const root = { id: "links-root", shortLink: "root", checklists: [{ checkItems: [{ idCard: "unrelated" }] }] };
  const task = { id: "task", shortLink: "task", name: "Task", url: "https://trello.com/c/task" };
  const second = { id: "second", shortLink: "second", name: "Second", url: "https://trello.com/c/second" };
  const data = new Map([[root.id, {}], [second.id, {}], [task.id, { time: { e: [["work", 20261020, 30, 0]] } }]]);
  let scans = 0;
  const h = cardHarness({
    card: async () => root, cards: async () => { scans++; return [root, task, second]; },
    get: async (id, visibility, key, fallback) => {
      if (id === "board") return fallback;
      const raw = data.get(id === "card" ? root.id : id) || {};
      return structuredClone(key ? raw[key] ?? fallback : raw);
    },
    set: async (id, visibility, key, value) => Object.assign(data.get(id), typeof key === "object" ? key : { [key]: structuredClone(value) }),
    remove: async (id, visibility, key) => { delete data.get(id)[key]; }
  });
  await h.render();
  assert.equal(h.latest().children.length, 0);
  assert.deepEqual((await h.handlers().onCardSearch("ta")).map(card => card.id), [task.id]);
  assert.deepEqual((await h.handlers().onCardSearch("SEC")).map(card => card.id), [second.id]);
  assert.equal(scans, 1, "typing multiple queries reuses board metadata");
  await h.handlers().onLinkAdd(task.url);
  assert.deepEqual(await h.handlers().onCardSearch("ta"), [], "already linked cards are excluded");
  assert.deepEqual(data.get(root.id).time.lc, [task.id]);
  assert.equal(h.latest().children[0].minutes, 30);
  assert.equal(h.latest().limitMinutes, null);
  for (const [url, message] of [[task.url, /already linked/], ["https://trello.com/c/root", /itself/], ["https://evil.com/c/task", /Trello card URL/], ["https://trello.com/c/missing", /not found/]]) {
    await assert.rejects(h.handlers().onLinkAdd(url), message);
  }
  await h.handlers().onAdd(fields);
  await h.handlers().onLimit(120);
  assert.deepEqual(data.get(root.id).time.lc, [task.id]);
  await h.handlers().onLinkAdd("Second");
  await h.handlers().onLinkReorder([second.id, task.id]);
  assert.deepEqual(data.get(root.id).time.lc, [second.id, task.id]);
  assert.deepEqual(h.latest().children.map(child => child.id), [second.id, task.id]);
  const beforeRefresh = h.updates().length;
  await h.render();
  assert.ok(h.updates().slice(beforeRefresh).every(value => !value.childrenLoading), "background refresh never replaces children with a loader");
  await assert.rejects(h.handlers().onLinkReorder([task.id]), /Child cards changed/);
  await assert.rejects(h.handlers().onLinkReorder([task.id, task.id]), /Child cards changed/);
  await h.handlers().onLinkRemove(second.id);
  second.name = task.name;
  await assert.rejects(h.handlers().onLinkAdd(task.name), /Several cards/);
  await h.handlers().onLinkAdd(task.name, second.id);
  assert.ok(data.get(root.id).time.lc.includes(second.id), "autocomplete selection identifies duplicate names by ID");
  await h.handlers().onLinkRemove(second.id);
  h.writable(false);
  await assert.rejects(h.handlers().onLinkReorder([task.id]), /read-only/);
  await assert.rejects(h.handlers().onLinkRemove(task.id), /read-only/);
  await assert.rejects(h.handlers().onLinkAdd(task.url), /read-only/);
  h.writable(true);
  data.get(task.id).time.lc = [root.id];
  await assert.rejects(h.handlers().onLinkAdd(task.url), /circular/);
  delete data.get(task.id).time.lc;
  await h.handlers().onLinkRemove(task.id);
  assert.equal(h.latest().children.length, 0);
  assert.equal(h.latest().entries.length, 1);
});

test("reports and badges share owned links and ignore checklist selection", async () => {
  const root = { id: "report-links-root", name: "Epic" };
  const cards = [root, { id: "a", name: "A" }, { id: "b", name: "B" }];
  const data = new Map([[root.id, { lc: ["a"], lim: 120, e: [] }], ["a", { e: [["a", 20261020, 30, 0]] }], ["b", { e: [["b", 20261020, 90, 0]] }]]);
  let render, latest, capabilities;
  const client = {
    getContext: () => ({ board: "links-board", card: root.id }), render: callback => { render = callback; },
    lists: async () => [], card: async () => root, cards: async () => cards,
    get: async (id, visibility, key) => id === "board" ? null : key === "time" ? data.get(id) : { time: data.get(id === "card" ? root.id : id) }
  };
  const window = {
    parent: {}, location: { href: "https://example.com/index.html" },
    TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeAggregate: require("../js/aggregate"), TimeBadges: require("../js/badges"), TimeTheme: { bind() {} },
    TimeDom: { clear() {} }, TimeReportView: { mount: () => ({ filters: () => ({ from: "2026-10-01", to: "2026-10-31" }), update: value => { latest = value; } }) },
    TrelloPowerUp: { iframe: () => client, initialize: value => { capabilities = value; } }
  };
  runPage("report-page.js", window, { document: { getElementById: () => ({}) } });
  runPage("connector.js", window);
  await render();
  assert.equal(latest.epics[0].remainingMinutes, 90);
  assert.equal((await capabilities["card-badges"](client))[0].text, "1h 30m left");
  data.get(root.id).lc = ["b"];
  data.get(root.id).sc = "ignored";
  await render();
  assert.equal(latest.epics[0].remainingMinutes, 30);
  assert.equal((await capabilities["card-badges"](client))[0].text, "30m left");
});

test("ordinary cards load without scanning the board or looking up REST access", async () => {
  let reads = 0;
  let extraCalls = 0;
  const unexpected = () => { extraCalls++; throw new Error("Unexpected board or REST lookup"); };
  const h = cardHarness({
    cards: unexpected,
    board: unexpected,
    getRestApi: unexpected,
    get: async () => { reads++; return null; }
  });
  await h.render();
  assert.equal(reads, 2, "only settings and the current card log");
  assert.equal(extraCalls, 0);
  assert.equal(h.latest().canAdd, true);
  assert.equal(h.latest().needsChecklistAuth, false);
  assert.equal(h.latest().children.length, 0);
});

test("the time log is usable while epic metadata is pending; failure keeps the log", async () => {
  let rejectCards;
  const pendingCards = new Promise((resolve, reject) => { rejectCards = reject; });
  const h = cardHarness({
    card: async () => ({ id: "epic", checklists: [{ id: "list" }] }),
    cards: () => pendingCards
  });
  h.shared({ time: { lc: ["task"], lim: 120, e: [["entry", 20261020, 30, 0]], who: [["me", "Me"]] } });
  const loading = h.render();
  await tick();
  assert.equal(h.latest().entries[0].minutes, 30);
  assert.equal(h.latest().childrenLoading, true);
  assert.equal(h.latest().canAdd, true);
  assert.equal(h.latest().kidsKnown, false);
  rejectCards(new Error("Board unavailable"));
  await loading;
  assert.equal(h.latest().entries[0].minutes, 30);
  assert.equal(h.latest().canAdd, true);
  assert.equal(h.latest().childrenLoading, undefined);
  assert.match(h.latest().warning, /child cards could not be refreshed/);
});

test("card rendering is read-only, initializes REST options and unlocks after save", async () => {
  const h = cardHarness();
  await h.render();
  assert.equal(h.writes(), 0);
  assert.equal(h.options().appKey, "test-key");
  await h.handlers().onAdd(fields);
  assert.equal(h.writes(), 1);
  assert.equal(h.latest().entries.length, 1);
  assert.equal(h.latest().saving, false);
  await h.handlers().onDelete(h.latest().entries[0].id);
  assert.equal(h.latest().entries.length, 0);
  assert.equal(h.latest().saving, false);
});

test("failed writes unlock the form and do not create entries", async () => {
  const h = cardHarness();
  await h.render();
  h.rejectWrite(true);
  await assert.rejects(h.handlers().onAdd(fields), /offline write/);
  assert.equal(h.writes(), 0);
  assert.equal(h.latest().saving, false);
  h.rejectWrite(false);
  await h.handlers().onAdd(fields);
  assert.equal(h.latest().entries.length, 1);
});

test("duplicate submissions are rejected while a write is in flight", async () => {
  const h = cardHarness();
  await h.render();
  const first = h.handlers().onAdd(fields);
  await assert.rejects(h.handlers().onAdd(fields), /wait/);
  await first;
  assert.equal(h.writes(), 1);
});

test("successful save followed by failed refresh is not reported as a failed save", async () => {
  const h = cardHarness();
  await h.render();
  h.rejectRefresh(true);
  await h.handlers().onAdd(fields);
  assert.equal(h.writes(), 1);
  assert.equal(h.latest().saving, false);
  assert.match(h.latest().error, /Saved, but refresh failed/);
});

test("read-only users cannot update, delete or set limits", async () => {
  const h = cardHarness();
  await h.render();
  h.writable(false);
  for (const operation of [
    () => h.handlers().onUpdate({ ...fields, id: "entry" }),
    () => h.handlers().onDelete("entry"),
    () => h.handlers().onLimit(120)
  ]) await assert.rejects(operation(), /read-only/);
  assert.equal(h.writes(), 0);
});

test("full shared storage rejects a save without a write", async () => {
  const h = cardHarness();
  h.shared({ other: "x".repeat(4000) });
  await h.render();
  await assert.rejects(h.handlers().onAdd(fields), { code: "STORAGE_FULL" });
  assert.equal(h.writes(), 0);
  assert.equal(h.latest().saving, false);
});

test("saving through the card controller updates persisted parent totals and reopening uses the cache", async () => {
  const root = { id: "ui-cached-epic", name: "Epic", checklists: [{ checkItems: [{ idCard: "ui-cached-task" }] }] };
  const task = { id: "ui-cached-task", name: "Task", checklists: [] };
  const data = new Map([[root.id, { time: { lc: [task.id], lim: 240, e: [] } }], [task.id, {}]]);
  let current = task, scans = 0;
  const h = cardHarness({
    getContext: () => ({ board: "ui-cache-board", permissions: { board: "write" } }),
    card: async () => structuredClone(current),
    cards: async () => { scans++; return structuredClone([root, task]); },
    get: async (scope, visibility, key, fallback) => {
      if (scope === "board") return fallback;
      const shared = data.get(scope === "card" ? current.id : scope) || {};
      return structuredClone(key ? shared[key] === undefined ? fallback : shared[key] : shared);
    },
    set: async (scope, visibility, key, value) => {
      const previous = data.get(scope) || {};
      data.set(scope, { ...previous, ...structuredClone(typeof key === "object" ? key : { [key]: value }) });
    },
    remove: async (scope, visibility, key) => { delete data.get(scope)[key]; }
  });
  await h.render();
  await h.handlers().onAdd(fields);
  assert.equal(data.get(root.id).rollup.c[0][3], 30);
  const entry = h.latest().entries[0];
  await h.handlers().onUpdate({ ...entry, minutes: 75 });
  assert.equal(data.get(root.id).rollup.c[0][3], 75);
  current = root;
  const scansBeforeOpen = scans;
  await h.render();
  assert.equal(h.latest().kidsKnown, true);
  assert.equal(h.latest().children[0].minutes, 75);
  assert.equal(scans, scansBeforeOpen, "reopening the parent skips dependency discovery");
  current = task;
  await h.render();
  await h.handlers().onDelete(entry.id);
  assert.equal(data.get(root.id).rollup.c[0][3], 0);
  assert.equal(data.get(task.id).time, undefined);
});

test("derived cache cannot prevent a source time entry from fitting shared storage", async () => {
  const h = cardHarness();
  await h.render();
  h.shared({ rollup: { v: 1, dirty: "old", padding: "x".repeat(3850) } });
  await h.handlers().onAdd(fields);
  assert.equal(h.latest().entries.length, 1);
  assert.equal(h.latest().entries[0].minutes, 30);
});

test("reopening an epic advances the forecast from today even when totals come from cache", async () => {
  let today = "2026-10-21";
  class ViewDate extends Date {
    constructor(...args) { super(...(args.length ? args : [today + "T12:00:00Z"])); }
  }
  const root = { id: "stable-date-epic", name: "Epic", checklists: [{ checkItems: [{ idCard: "stable-date-task" }] }] };
  const task = { id: "stable-date-task", name: "Task", checklists: [] };
  const data = new Map([
    [root.id, { time: { lc: [task.id], lim: 9600, e: [] } }],
    [task.id, { time: { e: [["first", 20261019, 1200, 0], ["last", 20261020, 1200, 0]] } }]
  ]);
  let scans = 0;
  const h = cardHarness({
    getContext: () => ({ board: "stable-date-board", permissions: { board: "write" } }),
    card: async () => root,
    cards: async () => { scans++; return [root, task]; },
    get: async (scope, visibility, key, fallback) => {
      if (scope === "board") return fallback;
      const shared = data.get(scope === "card" ? root.id : scope) || {};
      return structuredClone(key ? shared[key] === undefined ? fallback : shared[key] : shared);
    },
    set: async (scope, visibility, values) => { Object.assign(data.get(scope), structuredClone(values)); },
    remove: async (scope, visibility, key) => { delete data.get(scope)[key]; }
  }, { Date: ViewDate });
  await h.render();
  assert.equal(h.latest().estimatedFinish, "2026-11-11");
  const coldScans = scans;
  today = "2026-10-22";
  await h.render();
  assert.equal(h.latest().estimatedFinish, "2026-11-12");
  assert.equal(scans, coldScans, "warm reopening uses the same cached daily totals");
  data.get(root.id).rollup.t = 0;
  today = "2026-10-23";
  await h.render();
  assert.ok(scans > coldScans);
  assert.equal(h.latest().estimatedFinish, "2026-11-13", "cache recovery uses the current day too");
});

test("the controller rereads source logs after dependency discovery before writing", async () => {
  const incoming = { who: [["other", "Other"]], e: [["incoming", 20261020, 45, 0]] };
  const h = cardHarness({ cards: async () => {
    h.shared({ time: incoming });
    return [];
  } });
  await h.render();
  await h.handlers().onAdd(fields);
  assert.equal(h.latest().entries.length, 2);
  assert.equal(h.latest().entries.find(entry => entry.id === "incoming").minutes, 45);
  assert.equal(h.latest().entries.find(entry => entry.memberId === "me").minutes, 30);
});

test("200 simultaneous badge callbacks use 101 reads with at most eight in flight", async () => {
  let capabilities;
  let calls = 0;
  let active = 0;
  let peak = 0;
  const window = {
    parent: {}, location: { href: "https://example.com/index.html" },
    TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeBadges: require("../js/badges"),
    TrelloPowerUp: { initialize: value => { capabilities = value; } }
  };
  runPage("connector.js", window);
  const callbacks = Array.from({ length: 100 }, (_, i) => {
    const client = {
      getContext: () => ({ board: "board", card: "card" + i }),
      get: async () => {
        calls++;
        peak = Math.max(peak, ++active);
        await tick();
        active--;
        return null;
      }
    };
    return [capabilities["card-badges"](client), capabilities["card-detail-badges"](client)];
  }).flat();
  await Promise.all(callbacks);
  assert.equal(calls, 101);
  assert.equal(peak, 8);
});

test("report recovers from an initial failure and does not read inaccessible children", async () => {
  let render;
  let latest;
  let fail = true;
  const reads = [];
  const app = { textContent: "" };
  const banner = { hidden: true };
  const window = {
    parent: {}, TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeAggregate: require("../js/aggregate"),
    TimeTheme: { bind() {} },
    TimeDom: { clear() {} },
    TimeReportView: { mount: () => ({
      filters: () => ({ from: "2026-10-01", to: "2026-10-31" }),
      update: value => { latest = value; }
    }) },
    TrelloPowerUp: { iframe: () => ({
      render: callback => { render = callback; },
      lists: async () => [],
      cards: async () => {
        if (fail) throw new Error("offline");
        return [{ id: "epic", name: "Epic", checklists: [{ checkItems: [{ idCard: "gone" }] }] }];
      },
      get: async scope => {
        reads.push(scope);
        return scope === "board" ? null : { lim: 120, e: [] };
      }
    }) }
  };
  runPage("report-page.js", window, { document: { getElementById: id => id === "app" ? app : banner } });
  await render();
  assert.match(app.textContent, /offline/);
  fail = false;
  await render();
  assert.equal(app.textContent, "");
  assert.equal(latest.epics.length, 0, "no readable task activity in this period");
  assert.equal(reads.includes("gone"), false);
});

test("epic refresh recovers unreadable child logs through REST after read access is granted", async t => {
  let authorized = false;
  let unreadable = false;
  const own = { lc: ["child1", "child2"], lim: 240, who: [["me", "Me"]], e: [["own", 20261020, 180, 0]] };
  const children = [
    { id: "child1", name: "First", shortLink: "first", url: "https://trello.com/c/first" },
    { id: "child2", name: "Second", shortLink: "second", url: "https://trello.com/c/second" }
  ];
  t.mock.method(globalThis, "fetch", async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("token"), "token");
    if (parsed.pathname.endsWith("/checklists")) return {
      ok: true, json: async () => [{ id: "list", checkItems: [
        { name: children[0].url }, { name: children[1].url }, { name: children[0].url }
      ] }]
    };
    const minutes = parsed.pathname.includes("child1") ? 30 : 90;
    return {
      ok: !unreadable, status: 403,
      json: async () => [{ value: JSON.stringify({ time: { who: [["me", "Me"]], e: [["log", 20261020, minutes, 0]] } }) }]
    };
  });
  const h = cardHarness({
    card: async () => ({ id: "epic", name: "Epic", checklists: [{ id: "list" }] }),
    cards: async () => children,
    getRestApi: () => ({ isAuthorized: () => authorized, getToken: () => authorized ? "token" : null }),
    get: async (scope, visibility, key, fallback) => {
      if (scope === "board") return fallback;
      if (scope === "card") return own;
      throw new Error("Read child via REST");
    }
  });
  await h.render();
  assert.equal(h.latest().needsChecklistAuth, false);
  assert.equal(h.latest().kidsKnown, false);
  authorized = true;
  await h.render();
  const loaded = h.latest();
  assert.equal(loaded.authorized, true);
  assert.equal(loaded.kidsKnown, true);
  assert.deepEqual(loaded.children.map(child => child.minutes), [30, 90]);
  const spent = loaded.children.reduce((sum, child) => sum + child.minutes, 0);
  assert.equal(spent, 120, "own epic time and duplicate links must not count");
  assert.equal(loaded.limitMinutes - spent, 120);
  assert.equal(h.writes(), 0);
  unreadable = true;
  await h.render();
  assert.equal(h.latest().kidsKnown, false, "failed reads must not produce a positive remaining time");
});

test("authorization capabilities return Trello's contract and open an embedded settings panel", async () => {
  let capabilities;
  const window = {
    parent: {}, location: { href: "https://example.com/index.html" },
    TIMETRACK_CONFIG: { appKey: "key" }, TimeRuntime: runtime,
    TrelloPowerUp: { initialize: value => { capabilities = value; } }
  };
  runPage("connector.js", window);
  let authorized = false;
  let popup;
  const client = {
    getRestApi: () => ({ isAuthorized: () => authorized }),
    popup: async options => { popup = options; }
  };
  assert.equal((await capabilities["authorization-status"](client)).authorized, false);
  authorized = true;
  assert.equal((await capabilities["authorization-status"](client)).authorized, true);
  await capabilities["show-authorization"](client);
  assert.equal(popup.url, "./settings.html");
});

test("report uses owned links without checklist authorization and marks unreadable logs", async t => {
  let render;
  let latest;
  let notice;
  let authorized = false;
  let failed = false;
  const banner = { hidden: true, appendChild() {} };
  const cards = [
    { id: "epic", name: "Epic", shortLink: "epic", checklists: [{ id: "list", checkItems: [] }] },
    { id: "child", name: "Task", shortLink: "task", checklists: [] }
  ];
  const client = {
    render: callback => { render = callback; },
    cards: async () => cards, lists: async () => [], board: async () => ({ id: "board" }),
    getRestApi: () => ({ isAuthorized: () => authorized, getToken: () => authorized ? "token" : null }),
    get: async scope => {
      if (scope === "board") return null;
      if (scope === "epic") return { lc: ["child"], lim: 240, e: [] };
      if (failed) throw new Error("offline");
      return { who: [["me", "Me"]], e: [["log", 20261020, 90, 0]] };
    }
  };
  t.mock.method(globalThis, "fetch", async url => {
    if (url.includes("/pluginData")) return { ok: false, status: 403 };
    return { ok: true, json: async () => [
      { id: "epic", checklists: [{ id: "list", checkItems: [{ name: "https://trello.com/c/task" }] }] }
    ] };
  });
  const window = {
    parent: {}, TIMETRACK_CONFIG: { appKey: "key" },
    TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeAggregate: require("../js/aggregate"), TimeTheme: { bind() {} },
    TimeDom: { clear() {}, h: () => ({ addEventListener() {} }) },
    TimeReportView: { mount: () => ({
      filters: () => ({ from: "2026-10-01", to: "2026-10-31" }),
      update: (value, message) => { latest = value; notice = message; }
    }) },
    TrelloPowerUp: { iframe: () => client }
  };
  runPage("report-page.js", window, { document: { getElementById: id => id === "app" ? {} : banner } });
  await render();
  assert.equal(banner.hidden, true);
  authorized = true;
  await render();
  assert.equal(banner.hidden, true);
  assert.equal(latest.epics[0].remainingMinutes, 150);
  failed = true;
  await render();
  assert.equal(latest.epics.length, 0, "no readable task activity in this period");
  assert.match(notice, /totals may be incomplete/);
});

test("epic card and badges subtract task time nested under a sub-epic", async () => {
  const rootCard = { id: "epic", checklists: [{ checkItems: [{ idCard: "sub" }] }] };
  const cards = [
    { id: "sub", name: "Sub-Epic", checklists: [{ checkItems: [{ idCard: "task" }] }] },
    { id: "task", name: "Task", checklists: [] }
  ];
  const logs = {
    epic: { lc: ["sub"], lim: 600, e: [] },
    sub: { lc: ["task"], lim: 300, e: [["own", 20261020, 999, 0]] },
    task: { e: [["work", 20261020, 90, 0]] }
  };
  const client = {
    card: async () => rootCard,
    cards: async () => cards,
    get: async scope => scope === "board" ? null : logs[scope === "card" ? "epic" : scope]
  };
  const h = cardHarness(client);
  await h.render();
  assert.equal(h.latest().kidsKnown, true);
  assert.equal(h.latest().children[0].name, "Sub-Epic");
  assert.equal(h.latest().children[0].minutes, 90);
  assert.equal(h.latest().limitMinutes - h.latest().children[0].minutes, 510);

  let capabilities;
  runPage("connector.js", {
    parent: {}, location: { href: "https://example.com/index.html" },
    TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeBadges: require("../js/badges"),
    TrelloPowerUp: { initialize: value => { capabilities = value; } }
  });
  client.getContext = () => ({ board: "board", card: "epic" });
  assert.equal((await capabilities["card-badges"](client))[0].text, "1d 30m left");
});

test("epic badges use owned links and suppress remaining when child logs are unreadable", async t => {
  let capabilities;
  let failed = false;
  t.mock.method(globalThis, "fetch", async url => {
    if (url.includes("/pluginData")) return { ok: false, status: 403 };
    return { ok: true, json: async () => [{
      id: "list", checkItems: [{ name: "https://trello.com/c/task" }]
    }] };
  });
  runPage("connector.js", {
    parent: {}, location: { href: "https://example.com/index.html" },
    TIMETRACK_CONFIG: { appKey: "key" },
    TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeBadges: require("../js/badges"),
    TrelloPowerUp: { initialize: value => { capabilities = value; } }
  });
  const client = {
    getContext: () => ({ board: "board", card: "epic" }),
    getRestApi: () => ({ isAuthorized: () => true, getToken: () => "token" }),
    card: async () => ({ id: "epic", checklists: [{ id: "list" }] }),
    cards: async () => [{ id: "child", name: "Task", shortLink: "task" }],
    get: async scope => {
      if (scope === "board") return null;
      if (scope === "card") return { lc: ["child"], lim: 240, e: [] };
      if (failed) throw new Error("offline");
      return { who: [["me", "Me"]], e: [["log", 20261020, 90, 0]] };
    }
  };
  assert.equal((await capabilities["card-badges"](client))[0].text, "2h 30m left");
  failed = true;
  assert.equal((await capabilities["card-badges"](client))[0].text, "limit 4h");
});

test("simultaneous epic badge and detail callbacks share metadata and child reads", async () => {
  let capabilities;
  let reads = 0;
  let cardCalls = 0;
  let boardCalls = 0;
  let authCalls = 0;
  runPage("connector.js", {
    parent: {}, location: { href: "https://example.com/index.html" },
    TIMETRACK_CONFIG: { appKey: "key" },
    TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeBadges: require("../js/badges"),
    TrelloPowerUp: { initialize: value => { capabilities = value; } }
  });
  const client = {
    getRestApi: () => { authCalls++; throw new Error("Local badge data must not require authorization"); },
    getContext: () => ({ board: "board", card: "epic" }),
    card: async () => {
      cardCalls++;
      return { id: "epic", checklists: [{ checkItems: [{ name: "https://trello.com/c/task" }] }] };
    },
    cards: async () => {
      boardCalls++;
      return Array.from({ length: 500 }, (_, i) => ({ id: "child" + i, shortLink: i === 0 ? "task" : "other" + i }));
    },
    get: async scope => {
      reads++;
      await tick();
      if (scope === "board") return null;
      if (scope === "card") return { lc: ["child0"], lim: 120, e: [] };
      assert.equal(scope, "child0");
      return { e: [["log", 20261020, 30, 0]] };
    }
  };
  const [badge, detail] = await Promise.all([
    capabilities["card-badges"](client), capabilities["card-detail-badges"](client)
  ]);
  assert.equal(badge[0].text, "1h 30m left");
  assert.equal(detail[0].text, badge[0].text);
  assert.equal(reads, 3);
  assert.equal(cardCalls, 1);
  assert.equal(boardCalls, 1);
  assert.equal(authCalls, 0);
});

test("an epic cannot reuse an unvalidated raw result from its child's badge", async () => {
  let capabilities;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  runPage("connector.js", {
    parent: {}, location: { href: "https://example.com/index.html" },
    TimeRuntime: runtime, TimeDuration: duration, TimeModel: model, TimeEpic: epic,
    TimeBadges: require("../js/badges"),
    TrelloPowerUp: { initialize: value => { capabilities = value; } }
  });
  const child = {
    getContext: () => ({ board: "board", card: "child" }),
    get: async scope => scope === "board" ? null : pending
  };
  const parent = {
    getContext: () => ({ board: "board", card: "epic" }),
    get: async scope => scope === "board" ? null : scope === "card" ? { lc: ["child"], e: [], lim: 120 } : "invalid JSON",
    card: async () => ({ id: "epic", checklists: [{ checkItems: [{ name: "https://trello.com/c/task" }] }] }),
    cards: async () => [{ id: "child", shortLink: "task" }]
  };
  const childBadge = capabilities["card-badges"](child);
  const epicBadge = capabilities["card-badges"](parent);
  await tick();
  release("invalid JSON");
  await childBadge;
  assert.equal((await epicBadge)[0].text, "limit 2h");
});
