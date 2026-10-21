(function (root, factory) {
  const common = typeof module === "object" && module.exports;
  const api = common ? factory(require("./runtime"), require("./model"), require("./epic"))
    : factory(root.TimeRuntime, root.TimeModel, root.TimeEpic);
  if (common) module.exports = api;
  else root.TimeRollupCache = api;
})(typeof self !== "undefined" ? self : this, function (runtime, model, epic) {
  const TTL = 5 * 60 * 1000;
  const KEY = "rollup";
  const LINKS = "rollupLinks";
  const pending = new Map();
  const failedWrites = new Map();

  function scope(raw) {
    return raw && Array.isArray(raw.e) ? { time: raw } : raw && typeof raw === "object" ? raw : {};
  }
  function canWrite(client) {
    const permissions = client.getContext && client.getContext().permissions || {};
    return permissions.board === "write" || permissions.card === "write";
  }
  function signature(card) {
    const text = JSON.stringify(card.checklists == null ? null : card.checklists.map(function (list) {
      return [list.id || "", Array.isArray(list.checkItems) ? list.checkItems.map(function (item) {
        return [item.id || "", item.name || "", epic.cardIdFromCheckItem(item)];
      }) : null];
    }));
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
  }
  function valid(cache, card) {
    if (!cache || cache.v !== 1 || cache.dirty || cache.s !== signature(card) ||
      !Number.isFinite(cache.t) || Date.now() - cache.t < 0 || Date.now() - cache.t >= TTL ||
      !Array.isArray(cache.c) || !Array.isArray(cache.d)) return false;
    const ids = new Set();
    if (!cache.c.every(function (row) {
      if (!Array.isArray(row) || row.length !== 4 || typeof row[0] !== "string" || !row[0] || ids.has(row[0]) ||
        typeof row[1] !== "string" || typeof row[2] !== "string" || !Number.isSafeInteger(row[3]) || row[3] < 0) return false;
      ids.add(row[0]); return true;
    })) return false;
    if (!cache.d.every(function (row) {
      try { model.validateEntry({ ymd: row[0], minutes: 1 }); return Number.isSafeInteger(row[1]) && row[1] > 0; }
      catch (error) { return false; }
    })) return false;
    return cache.c.reduce(function (sum, row) { return sum + row[3]; }, 0) ===
      cache.d.reduce(function (sum, row) { return sum + row[1]; }, 0);
  }
  function hydrate(cache, card) {
    const cards = cache.c.map(function (row) { return { id: row[0], name: row[1], url: row[2] }; });
    return {
      cached: true,
      inspection: { complete: true, childIds: cards.map(function (card) { return card.id; }), unlinkedCount: cache.u || 0, checklists: card.checklists },
      board: { boardCards: cards, unreadableIds: new Set(), timeById: new Map(),
        totalsById: new Map(cache.c.map(function (row) { return [row[0], { minutes: row[3], entries: [], missing: false }]; })),
        entries: cache.d.map(function (row) { return { ymd: row[0], minutes: row[1] }; }) },
      shortLinks: new Map(), nameIndex: new Map()
    };
  }
  function pack(card, related) {
    const ids = related.inspection.childIds || [];
    if (!related.inspection.complete || ids.some(function (id) {
      return !related.board.totalsById.has(id) || related.board.totalsById.get(id).missing;
    })) return null;
    const info = new Map(related.board.boardCards.map(function (item) { return [item.id, item]; }));
    const days = new Map();
    const rows = ids.map(function (id) {
      const total = related.board.totalsById.get(id), item = info.get(id);
      total.entries.forEach(function (entry) { days.set(entry.ymd, (days.get(entry.ymd) || 0) + entry.minutes); });
      return [id, item && item.name || "Unavailable card", item && item.url || "", total.minutes];
    });
    return { v: 1, t: Date.now(), s: signature(card), u: related.inspection.unlinkedCount || 0,
      c: rows, d: Array.from(days).sort(function (a, b) { return a[0] - b[0]; }) };
  }

  // Derived data must never displace source logs or arbitrary shared keys.
  async function write(client, id, values, expectedToken) {
    if (!canWrite(client)) return false;
    try {
      const shared = scope(await client.get(id, "shared"));
      if (expectedToken && (!shared[KEY] || shared[KEY].dirty !== expectedToken)) return false;
      if (JSON.stringify(Object.assign({}, shared, values)).length > model.MAX_PLUGIN_CHARS) {
        failedWrites.set(id, Date.now()); return false;
      }
      await client.set(id, "shared", values);
      if (values[KEY] && !values[KEY].dirty) failedWrites.delete(id);
      return true;
    } catch (error) {
      failedWrites.set(id, Date.now());
      return false;
    }
  }
  async function invalidate(client, id, token) {
    if (await write(client, id, { [KEY]: { v: 1, dirty: token } })) return true;
    // A full card can still discard its old derived value.
    try {
      if (await client.get(id, "shared", KEY, null)) await client.remove(id, "shared", KEY);
    } catch (error) { /* TTL bounds an unreachable cache. */ }
    return false;
  }

  async function graphFor(client, card, appKey) {
    let cards = await client.cards("id", "name", "url", "shortLink", "checklists");
    const existing = (cards || []).find(function (item) { return item.id === card.id; });
    cards = (cards || []).filter(function (item) { return item.id !== card.id; }).concat([Object.assign({}, existing, card)]);
    const sourceById = new Map(cards.map(function (item) { return [item.id, item]; }));
    let credentials;
    const getRest = function () {
      if (!credentials) credentials = runtime.restCredentials(client, appKey);
      return credentials;
    };
    let links = new Map(cards.map(function (item) { return [item.shortLink, item.id]; }));
    let names = epic.uniqueNameIndex(cards);
    const incomplete = cards.some(function (item) {
      const parsed = epic.inspectChecklists(item.checklists, item.id, links, names);
      return epic.needsRemoteChecklists(parsed, item.checklists);
    });
    const remoteIds = new Set();
    if (incomplete && appKey) {
      const rest = await getRest();
      if (rest) {
        try {
          const ctx = client.getContext && client.getContext();
          const boardId = ctx && ctx.board || (await client.board("id")).id;
          const remote = await runtime.fetchJson("https://api.trello.com/1/boards/" + encodeURIComponent(boardId) +
            "/cards?filter=visible&fields=id&checklists=all&checkItem_fields=name,state&key=" + encodeURIComponent(appKey) + "&token=" + encodeURIComponent(rest.token));
          const checklists = new Map(remote.map(function (item) { return [item.id, item.checklists]; }));
          cards = cards.map(function (item) {
            if (!checklists.has(item.id)) return item;
            remoteIds.add(item.id);
            return Object.assign({}, item, { checklists: checklists.get(item.id) });
          });
        } catch (error) { /* Partial metadata remains unknown; live reads can retry individual cards. */ }
      }
    }
    const inspections = new Map(), parents = new Map();
    cards.forEach(function (item) {
      const parsed = epic.inspectChecklists(item.checklists, item.id, links, names);
      if (parsed.complete && (remoteIds.has(item.id) || !epic.needsRemoteChecklists(parsed, item.checklists))) {
        inspections.set(item.id, Object.assign({}, parsed, { checklists: item.checklists,
          remoteChecklistsFetched: remoteIds.has(item.id) }));
      }
      (parsed.childIds || []).forEach(function (id) {
        if (!parents.has(id)) parents.set(id, new Set());
        parents.get(id).add(item.id);
      });
    });
    return { cards: cards, byId: new Map(cards.map(function (item) { return [item.id, item]; })), sourceById: sourceById,
      inspections: inspections, parents: parents, getRest: getRest };
  }
  async function addKnownParents(client, graph, cardId, shared) {
    const queue = [cardId], visited = new Set();
    for (let i = 0; i < queue.length; i++) {
      const child = queue[i];
      if (visited.has(child)) continue;
      visited.add(child);
      let stored = child === cardId ? shared[LINKS] : null;
      if (child !== cardId) {
        try { stored = await client.get(child, "shared", LINKS, null); } catch (error) { /* Best-effort index recovery. */ }
      }
      if (stored && stored.v === 1 && Array.isArray(stored.p)) stored.p.forEach(function (id) {
        if (typeof id !== "string" || (!graph.failed && !graph.byId.has(id))) return;
        const known = graph.inspections.get(id);
        if (known && !known.childIds.includes(child)) return;
        if (!graph.parents.has(child)) graph.parents.set(child, new Set());
        graph.parents.get(child).add(id);
      });
      (graph.parents.get(child) || []).forEach(function (id) { if (!visited.has(id)) queue.push(id); });
    }
  }
  function ancestors(graph, id) {
    const found = new Set(), queue = [id];
    for (let i = 0; i < queue.length; i++) {
      (graph.parents.get(queue[i]) || []).forEach(function (parent) {
        if (!found.has(parent)) { found.add(parent); queue.push(parent); }
      });
    }
    found.delete(id);
    return found;
  }
  async function prepareChange(client, card, appKey, shared) {
    let graph;
    try { graph = await graphFor(client, card, appKey); }
    catch (error) {
      graph = { failed: true, cards: [card], byId: new Map([[card.id, card]]), sourceById: new Map([[card.id, card]]),
        inspections: new Map(), parents: new Map() };
    }
    await addKnownParents(client, graph, card.id, scope(shared));
    const affected = ancestors(graph, card.id);
    const rootInspection = graph.inspections.get(card.id);
    if (scope(shared)[KEY] || model.decode(scope(shared).time).limitMinutes != null ||
      rootInspection && rootInspection.childIds.length || card.checklists && card.checklists.length) affected.add(card.id);
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    await runtime.mapPool(Array.from(affected), 4, function (id) { return invalidate(client, id, token); });
    const previous = scope(shared);
    const priorKids = previous[LINKS] && previous[LINKS].k;
    const oldChildren = Array.isArray(priorKids) ? priorKids.filter(function (id) { return typeof id === "string"; }) :
      previous[KEY] && Array.isArray(previous[KEY].c) ? previous[KEY].c.filter(Array.isArray).map(function (row) { return row[0]; }) : [];
    return { graph: graph, affected: affected, token: token, card: card, oldChildren: oldChildren };
  }
  async function writeLinks(client, graph, ids) {
    await runtime.mapPool(Array.from(ids), 4, async function (id) {
      try {
        const inspection = graph.inspections.get(id);
        const value = { v: 1, p: Array.from(graph.parents.get(id) || []).sort(), k: inspection ? inspection.childIds : null };
        const shared = scope(await client.get(id, "shared"));
        if (!value.p.length && (!value.k || !value.k.length)) {
          if (shared[LINKS]) await client.remove(id, "shared", LINKS);
          return;
        }
        if (JSON.stringify(shared[LINKS]) === JSON.stringify(value)) return;
        await write(client, id, { [LINKS]: value });
      } catch (error) { failedWrites.set(id, Date.now()); }
    });
  }
  async function finishChange(client, transaction, appKey, changedTime) {
    if (transaction.graph.failed) throw new Error("Parent relationships could not be refreshed.");
    const graph = transaction.graph, reads = new Map(), results = new Map(), touched = new Set();
    if (arguments.length >= 4) reads.set(transaction.card.id, Promise.resolve(changedTime));
    const options = { cards: function () { return Promise.resolve(graph.cards); }, getRest: graph.getRest,
      inspections: graph.inspections, read: function (id, work) {
        if (!reads.has(id)) reads.set(id, Promise.resolve().then(work));
        return reads.get(id);
      } };
    await runtime.mapPool(Array.from(transaction.affected), 2, async function (id) {
      const card = id === transaction.card.id ? transaction.card : graph.byId.get(id);
      if (!card) return;
      const related = await runtime.loadCardChildren(client, card, appKey, model, epic, options);
      results.set(id, related);
      related.inspections.forEach(function (inspection, node) {
        graph.inspections.set(node, inspection); touched.add(node);
        (inspection.childIds || []).forEach(function (childId) {
          if (!graph.parents.has(childId)) graph.parents.set(childId, new Set());
          graph.parents.get(childId).add(node);
        });
      });
      related.board.timeById.forEach(function (value, node) { touched.add(node); });
      const cache = pack(id === transaction.card.id ? transaction.card : graph.sourceById.get(id) || card, related);
      if (cache) await write(client, id, { [KEY]: cache }, transaction.token);
      else failedWrites.set(id, Date.now());
    });
    touched.add(transaction.card.id);
    transaction.oldChildren.forEach(function (id) { if (graph.byId.has(id)) touched.add(id); });
    await writeLinks(client, graph, touched);
    return results;
  }
  async function loadCardChildren(client, card, appKey, options) {
    const opts = options || {}, shared = scope(opts.shared);
    if (!opts.force && !failedWrites.has(card.id) && valid(shared[KEY], card)) return hydrate(shared[KEY], card);
    const ctx = client.getContext && client.getContext();
    const key = (ctx && ctx.board || "") + ":" + card.id;
    if (pending.has(key)) return pending.get(key);
    const work = (async function () {
      const persist = opts.persist !== false && canWrite(client) &&
        (opts.force || Date.now() - (failedWrites.get(card.id) || 0) > 60000);
      if (!persist) return runtime.loadCardChildren(client, card, appKey, model, epic, opts);
      // Rebuilding also repairs ancestors when this card's checklist changed.
      const tx = await prepareChange(client, card, appKey, shared);
      tx.affected.add(card.id);
      if (!shared[KEY] && !(tx.graph.inspections.get(card.id) && tx.graph.inspections.get(card.id).childIds.length) &&
        !(card.checklists && card.checklists.length)) {
        return runtime.loadCardChildren(client, card, appKey, model, epic, opts);
      }
      // First-ever parents may not have existed when prepareChange invalidated.
      let rootShared = shared;
      try { rootShared = scope(await client.get(card.id, "shared")); } catch (error) { /* Live totals still work without cache writes. */ }
      if (!rootShared[KEY] || rootShared[KEY].dirty !== tx.token) await invalidate(client, card.id, tx.token);
      const results = await finishChange(client, tx, appKey);
      return results.get(card.id);
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  return { loadCardChildren: loadCardChildren, prepareChange: prepareChange, finishChange: finishChange,
    valid: valid, TTL: TTL, KEY: KEY, LINKS: LINKS };
});
