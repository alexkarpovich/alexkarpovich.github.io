(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeRuntime = api;
})(typeof self !== "undefined" ? self : this, function () {
  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    let failed = false;
    let failure;
    async function worker() {
      while (!failed && cursor < items.length) {
        const index = cursor++;
        try { out[index] = await fn(items[index], index); }
        catch (error) {
          failed = true;
          failure = error;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    if (failed) throw failure;
    return out;
  }

  // Share only pending reads: the next render always sees fresh Trello data.
  // One queue per iframe bounds requests across all badge callbacks.
  function createReader(limit) {
    const pending = new Map();
    const queue = [];
    let active = 0;
    function drain() {
      while (active < limit && queue.length) {
        const job = queue.shift();
        active++;
        function finish() {
          pending.delete(job.key);
          active--;
          drain();
        }
        Promise.resolve().then(job.read).then(function (value) {
          finish();
          job.resolve(value);
        }, function (error) {
          finish();
          job.reject(error);
        });
      }
    }
    return function (key, read) {
      if (pending.has(key)) return pending.get(key);
      const promise = new Promise(function (resolve, reject) {
        queue.push({ key: key, read: read, resolve: resolve, reject: reject });
      });
      pending.set(key, promise);
      drain();
      return promise;
    };
  }

  // Collapse bursts of t.render notifications and run one trailing refresh.
  function coalesce(work) {
    let running = null;
    let again = false;
    return function () {
      again = true;
      if (!running) {
        running = Promise.resolve().then(async function () {
          do {
            again = false;
            await work();
          } while (again);
        }).finally(function () { running = null; });
      }
      return running;
    };
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 8000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("Trello request failed (" + response.status + ").");
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function clientOptions(config) {
    return config && config.appKey ? {
      appKey: config.appKey,
      appName: config.appName || "Time Tracking",
      appAuthor: config.appAuthor || "Time Tracking"
    } : {};
  }

  function createIframe(config, trelloPowerUp) {
    const opts = clientOptions(config);
    const trello = trelloPowerUp || (typeof globalThis !== "undefined" ? globalThis.TrelloPowerUp : null);
    if (!trello || typeof trello.iframe !== "function") return null;
    try {
      return Object.keys(opts).length ? trello.iframe(opts) : trello.iframe();
    } catch (error) {
      try { return trello.iframe(); }
      catch (fallbackError) { return null; }
    }
  }

  function normalizePacked(modelApi, raw) {
    if (modelApi && modelApi.normalizePackedRaw) return modelApi.normalizePackedRaw(raw);
    return raw && typeof raw === "object" ? raw : null;
  }

  function asPromise(value) {
    return value && typeof value.then === "function" ? value : Promise.resolve(value);
  }

  // iframe() may return the REST client directly; connector capability handlers get a Promise.
  function restApi(client) {
    try {
      return asPromise(client.getRestApi());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function restCredentials(client, appKey) {
    if (!appKey) return null;
    try {
      const api = await restApi(client);
      if (!(await asPromise(api.isAuthorized()))) return null;
      const token = await asPromise(api.getToken());
      return token ? { appKey: appKey, token: token } : null;
    } catch (error) {
      return null;
    }
  }

  function authorizeReturnUrl() {
    try {
      const url = new URL("auth-complete.html", window.location.href);
      url.search = "";
      url.hash = "";
      return url.href;
    } catch (error) {
      return window.location.origin + "/auth-complete.html";
    }
  }

  // Start getRestApi().authorize() synchronously from a click handler (no await before authorize).
  function authorizeReadAccess(client) {
    function authorize(api) {
      return asPromise(api.authorize({
        scope: "read",
        expiration: "never",
        // The SDK accepts returnUrl; return_url is only the REST query parameter.
        returnUrl: authorizeReturnUrl()
      }));
    }
    try {
      const api = client.getRestApi();
      const pending = api && typeof api.then === "function" ? api.then(authorize) : authorize(api);
      return asPromise(pending).then(function () {
        return isReadAuthorized(client);
      }).then(function (ok) {
        if (!ok) throw new Error("Authorization was not completed.");
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function isReadAuthorized(client) {
    try {
      const api = await restApi(client);
      return await asPromise(api.isAuthorized());
    } catch (error) {
      return false;
    }
  }

  async function readSharedTime(client, cardId, rest, modelApi) {
    try {
      const raw = await client.get(cardId, "shared", "time", null);
      // A successful missing-key read is authoritative. Empty cards must not
      // trigger a second SDK call and a network request for every render.
      if (raw == null) return null;
      const packed = normalizePacked(modelApi, raw);
      if (packed) return packed;
    } catch (error) { /* Try the full shared scope and then REST. */ }
    try {
      const shared = await client.get(cardId, "shared");
      if (shared && typeof shared === "object" && shared.time == null) return null;
      const packed = normalizePacked(modelApi, shared && shared.time);
      if (packed) return packed;
    } catch (error) { /* A failed SDK read must not skip the REST fallback. */ }
    if (typeof rest === "function") rest = await rest();
    if (!rest || !rest.appKey || !rest.token) return undefined;
    try {
      const rows = await fetchJson("https://api.trello.com/1/cards/" + encodeURIComponent(cardId) + "/pluginData?key=" + encodeURIComponent(rest.appKey) + "&token=" + encodeURIComponent(rest.token));
      if (!Array.isArray(rows)) return undefined;
      for (let i = 0; i < rows.length; i += 1) {
        const packed = normalizePacked(modelApi, rows[i].value);
        if (packed) return packed;
      }
    } catch (error) { return undefined; }
    // null means no log; undefined means unreadable and must not count as zero.
    return null;
  }

  async function expandShortLinkMap(client, checklists, baseMap, rest, boardId, epicApi) {
    const map = new Map(baseMap || []);
    if (!rest || !rest.appKey || !rest.token || !epicApi) return map;
    const slugs = epicApi.collectShortLinksFromChecklists(checklists).filter(function (slug) {
      return !map.has(slug);
    });
    if (!slugs.length) return map;
    await mapPool(slugs, 4, async function (slug) {
      try {
        const card = await fetchJson("https://api.trello.com/1/cards/" + encodeURIComponent(slug) + "?fields=id,idBoard,closed&key=" + encodeURIComponent(rest.appKey) + "&token=" + encodeURIComponent(rest.token));
        if (card && card.id && !card.closed && (!boardId || card.idBoard === boardId)) {
          map.set(slug, card.id);
        }
      } catch (error) { /* card missing or inaccessible */ }
    });
    return map;
  }

  function lazyCredentials(client, appKey) {
    let pending;
    return function () {
      if (!pending) pending = restCredentials(client, appKey);
      return pending;
    };
  }

  async function loadBoardTimes(client, appKey, modelApi, cards, options) {
    const boardCards = cards || await client.cards("id", "name", "url", "shortLink");
    const opts = options || {};
    const getRest = opts.getRest || lazyCredentials(client, appKey);
    const packedList = await mapPool(boardCards, 8, function (card) {
      const work = function () { return readSharedTime(client, card.id, getRest, modelApi); };
      return opts.read ? opts.read(card.id, work) : work();
    });
    const timeById = new Map(boardCards.map(function (card, index) {
      return [card.id, packedList[index]];
    }));
    const unreadableIds = new Set(boardCards.filter(function (card, index) {
      return packedList[index] === undefined;
    }).map(function (card) { return card.id; }));
    return { boardCards: boardCards, timeById: timeById, unreadableIds: unreadableIds };
  }

  // Read metadata once, then read logs only for visible checklist children.
  // No board scan, token lookup, or REST request for a card without checklists.
  async function loadCardChildren(client, card, appKey, modelApi, epicApi, options) {
    const opts = options || {};
    const getRest = opts.getRest || lazyCredentials(client, appKey);
    const empty = Array.isArray(card.checklists) && card.checklists.length === 0;
    const boardCards = empty ? [] : await (opts.cards
      ? opts.cards()
      : client.cards("id", "name", "url", "shortLink", "checklists"));
    const shortLinks = new Map(boardCards.map(function (item) { return [item.shortLink, item.id]; }));
    const nameIndex = epicApi.uniqueNameIndex(boardCards);
    const inspection = opts.inspections && opts.inspections.get(card.id) || (empty
      ? { complete: true, childIds: [], checklists: [], unlinkedCount: 0 }
      : await resolveChecklistInspection(client, card.id, card, true, appKey, epicApi, {
        boardCards: boardCards, shortLinks: shortLinks, nameIndex: nameIndex, getRest: getRest
      }));
    const byId = new Map(boardCards.map(function (item) { return [item.id, item]; }));
    const inspections = new Map([[card.id, inspection]]);
    const timeById = new Map(), unreadableIds = new Set(), seen = new Set([card.id]);
    let pending = inspection.childIds || [];
    while (pending.length) {
      const layer = pending.filter(function (id) {
        if (seen.has(id) || !byId.has(id)) return false;
        seen.add(id);
        return true;
      });
      pending = [];
      const loaded = await loadBoardTimes(client, appKey, modelApi,
        layer.map(function (id) { return byId.get(id); }), { getRest: getRest, read: opts.read });
      loaded.timeById.forEach(function (value, id) { timeById.set(id, value); });
      loaded.unreadableIds.forEach(function (id) { unreadableIds.add(id); });
      const nested = await mapPool(layer, 4, async function (id) {
        const info = byId.get(id), state = modelApi.decode(timeById.get(id));
        if (state.limitMinutes == null && !(info.checklists && info.checklists.length)) return [];
        const childInspection = opts.inspections && opts.inspections.get(id) || await resolveChecklistInspection(client, id, info, true, appKey, epicApi, {
          boardCards: boardCards, shortLinks: shortLinks, nameIndex: nameIndex, getRest: getRest
        });
        inspections.set(id, childInspection);
        if (childInspection.checklistAuthNeeded) inspection.checklistAuthNeeded = true;
        return childInspection.childIds || [];
      });
      nested.forEach(function (ids) { pending.push.apply(pending, ids); });
    }
    function rollup(id, visited, path) {
      if (path.has(id)) return { minutes: 0, entries: [], missing: true };
      if (visited.has(id)) return { minutes: 0, entries: [], missing: false };
      visited.add(id);
      if (!byId.has(id) || unreadableIds.has(id) || !timeById.has(id)) return { minutes: 0, entries: [], missing: true };
      const links = inspections.get(id);
      if (!links) {
        const entries = modelApi.decode(timeById.get(id)).entries;
        return { minutes: modelApi.totalMinutes(entries), entries: entries, missing: false };
      }
      const nextPath = new Set(path); nextPath.add(id);
      const result = { minutes: 0, entries: [], missing: !links.complete };
      (links.childIds || []).forEach(function (childId) {
        const child = rollup(childId, visited, nextPath);
        result.minutes += child.minutes;
        result.entries.push.apply(result.entries, child.entries);
        result.missing = result.missing || child.missing;
      });
      return result;
    }
    const totalsById = new Map(), counted = new Set();
    (inspection.childIds || []).forEach(function (id) {
      totalsById.set(id, rollup(id, counted, new Set([card.id])));
    });
    const board = { timeById: timeById, unreadableIds: unreadableIds, totalsById: totalsById };
    // Only epic/checklist UI needs authorization state; ordinary cards skip it.
    board.rest = empty || opts.authStatus === false ? null : await getRest();
    board.boardCards = boardCards;
    return { board: board, inspection: inspection, shortLinks: shortLinks, nameIndex: nameIndex, inspections: inspections };
  }

  async function resolveChecklistInspection(client, cardId, card, allowRemote, appKey, epicApi, boardContext) {
    let checklists = card && card.checklists;
    let shortLinks = boardContext && boardContext.shortLinks;
    let nameIndex = boardContext && boardContext.nameIndex;
    if (!shortLinks || !nameIndex) {
      const cards = boardContext && boardContext.boardCards
        ? boardContext.boardCards
        : await client.cards("id", "name", "shortLink");
      if (!shortLinks) {
        shortLinks = new Map(cards.map(function (item) { return [item.shortLink, item.id]; }));
      }
      if (!nameIndex) nameIndex = epicApi.uniqueNameIndex(cards);
    }
    function inspect() {
      return epicApi.inspectChecklists(checklists, cardId, shortLinks, nameIndex);
    }
    let local = inspect();
    let checklistAuthNeeded = false;
    let remoteChecklistsFetched = false;
    const incomplete = !local.complete;
    const wantRemote = allowRemote && appKey && (incomplete || epicApi.needsRemoteChecklists(local, checklists));
    if (wantRemote) {
      try {
        const rest = boardContext && boardContext.getRest
          ? await boardContext.getRest()
          : await restCredentials(client, appKey);
        if (!rest) checklistAuthNeeded = true;
        else {
          checklists = await fetchJson("https://api.trello.com/1/cards/" + encodeURIComponent(cardId) + "/checklists?checkItems=all&checkItem_fields=name,state&key=" + encodeURIComponent(appKey) + "&token=" + encodeURIComponent(rest.token));
          remoteChecklistsFetched = true;
          checklists = await hydrateChecklistItems(checklists, appKey, rest);
          local = inspect();
        }
      } catch (error) { /* Keep the unknown state; never assume missing time is zero. */ }
    }
    return {
      complete: local.complete,
      childIds: local.childIds,
      unlinkedCount: local.unlinkedCount,
      unresolvedCount: local.unresolvedCount,
      checklists: checklists,
      checklistAuthNeeded: checklistAuthNeeded,
      remoteChecklistsFetched: remoteChecklistsFetched
    };
  }

  async function hydrateChecklistItems(checklists, appKey, rest) {
    const lists = Array.isArray(checklists) ? checklists : [];
    return mapPool(lists, 4, async function (list) {
      if (!list || !list.id) return list;
      if (Array.isArray(list.checkItems)) return list;
      try {
        const items = await fetchJson("https://api.trello.com/1/checklists/" + encodeURIComponent(list.id) + "/checkItems?fields=name,state&key=" + encodeURIComponent(appKey) + "&token=" + encodeURIComponent(rest.token));
        return Object.assign({}, list, { checkItems: Array.isArray(items) ? items : [] });
      } catch (error) {
        return list;
      }
    });
  }

  return {
    createIframe: createIframe,
    expandShortLinkMap: expandShortLinkMap,
    mapPool: mapPool,
    createReader: createReader,
    coalesce: coalesce,
    fetchJson: fetchJson,
    clientOptions: clientOptions,
    readSharedTime: readSharedTime,
    loadBoardTimes: loadBoardTimes,
    loadCardChildren: loadCardChildren,
    resolveChecklistInspection: resolveChecklistInspection,
    authorizeReadAccess: authorizeReadAccess,
    isReadAuthorized: isReadAuthorized,
    restApi: restApi,
    asPromise: asPromise,
    restCredentials: restCredentials
  };
});
