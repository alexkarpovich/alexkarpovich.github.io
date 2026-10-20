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
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js", name), "utf8"), {
    window, URL, console, ...extra
  });
}

function cardHarness(overrides = {}) {
  let render;
  let handlers;
  let latest;
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
      shared[key] = structuredClone(value);
      writes++;
      if (rejectRefresh) rejectRead = true;
    },
    remove: async () => { shared = {}; writes++; },
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
      return { update: value => { latest = structuredClone(value); } };
    } }
  };
  runPage("card-page.js", window, {
    document: { getElementById: id => id === "app" ? {} : null },
    requestAnimationFrame: callback => callback()
  });
  return {
    render: () => render(), handlers: () => handlers, latest: () => latest,
    writes: () => writes, options: () => options,
    rejectWrite: value => { rejectWrite = value; },
    rejectRefresh: value => { rejectRefresh = value; },
    writable: value => { writable = value; },
    shared: value => { shared = value; }
  };
}

const fields = { ymd: 20261020, minutes: 30, note: "Review" };

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
  assert.equal(latest.epics[0].known, false);
  assert.equal(latest.epics[0].remainingMinutes, null);
  assert.equal(reads.includes("gone"), false);
});

test("epic refresh loads REST checklists and child logs after read access is granted", async t => {
  let authorized = false;
  let unreadable = false;
  const own = { lim: 240, who: [["me", "Me"]], e: [["own", 20261020, 180, 0]] };
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
  assert.equal(h.latest().needsChecklistAuth, true);
  assert.equal(h.latest().kidsKnown, false);
  authorized = true;
  await h.render();
  const loaded = h.latest();
  assert.equal(loaded.authorized, true);
  assert.equal(loaded.kidsKnown, true);
  assert.equal(loaded.remoteChecklistsFetched, true);
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

test("report requests access for hidden checklist items and computes remaining after authorization", async t => {
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
      if (scope === "epic") return { lim: 240, e: [] };
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
  assert.equal(banner.hidden, false);
  authorized = true;
  await render();
  assert.equal(banner.hidden, true);
  assert.equal(latest.epics[0].remainingMinutes, 150);
  failed = true;
  await render();
  assert.equal(latest.epics[0].known, false);
  assert.equal(latest.epics[0].remainingMinutes, null);
  assert.match(notice, /totals may be incomplete/);
});

test("epic badges use remote links and suppress remaining when child logs are unreadable", async t => {
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
      if (scope === "card") return { lim: 240, e: [] };
      if (failed) throw new Error("offline");
      return { who: [["me", "Me"]], e: [["log", 20261020, 90, 0]] };
    }
  };
  assert.equal((await capabilities["card-badges"](client))[0].text, "2h 30m left");
  failed = true;
  assert.equal((await capabilities["card-badges"](client))[0].text, "limit 4h");
});
