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

  function normalizePacked(modelApi, raw) {
    if (modelApi && modelApi.normalizePackedRaw) return modelApi.normalizePackedRaw(raw);
    return raw && typeof raw === "object" ? raw : null;
  }

  async function restCredentials(client, appKey) {
    if (!appKey) return null;
    try {
      const api = await client.getRestApi();
      if (!(await api.isAuthorized())) return null;
      return { appKey: appKey, token: await api.getToken() };
    } catch (error) {
      return null;
    }
  }

  async function readSharedTime(client, cardId, rest, modelApi) {
    try {
      let packed = normalizePacked(modelApi, await client.get(cardId, "shared", "time", null));
      if (packed) return packed;
      const shared = await client.get(cardId, "shared");
      packed = normalizePacked(modelApi, shared && shared.time);
      if (packed) return packed;
      if (!rest || !rest.appKey || !rest.token) return null;
      const rows = await fetchJson("https://api.trello.com/1/cards/" + encodeURIComponent(cardId) + "/pluginData?key=" + encodeURIComponent(rest.appKey) + "&token=" + encodeURIComponent(rest.token));
      if (!Array.isArray(rows)) return null;
      for (let i = 0; i < rows.length; i += 1) {
        packed = normalizePacked(modelApi, rows[i].value);
        if (packed) return packed;
      }
    } catch (error) { /* unreadable card */ }
    return null;
  }

  async function loadBoardTimes(client, appKey, modelApi) {
    const boardCards = await client.cards("id", "name", "url", "shortLink");
    const rest = await restCredentials(client, appKey);
    const packedList = await mapPool(boardCards, 8, function (card) {
      return readSharedTime(client, card.id, rest, modelApi);
    });
    const timeById = new Map(boardCards.map(function (card, index) {
      return [card.id, packedList[index]];
    }));
    return { boardCards: boardCards, timeById: timeById, rest: rest };
  }

  async function resolveChecklistInspection(client, cardId, card, allowRemote, appKey, epicApi, boardContext) {
    let checklists = (card && card.checklists) || [];
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
    const wantRemote = allowRemote && appKey && epicApi.needsRemoteChecklists(local, checklists);
    if (wantRemote) {
      try {
        const rest = await restCredentials(client, appKey);
        if (rest) {
          checklists = await fetchJson("https://api.trello.com/1/cards/" + encodeURIComponent(cardId) + "/checklists?checkItems=all&checkItem_fields=name,state,idCard&key=" + encodeURIComponent(appKey) + "&token=" + encodeURIComponent(rest.token));
          local = inspect();
        }
      } catch (error) { /* Keep the unknown state; never assume missing time is zero. */ }
    }
    if (local.unresolvedCount) {
      local = inspect();
    }
    return local;
  }

  return {
    mapPool: mapPool,
    createReader: createReader,
    coalesce: coalesce,
    fetchJson: fetchJson,
    clientOptions: clientOptions,
    readSharedTime: readSharedTime,
    loadBoardTimes: loadBoardTimes,
    resolveChecklistInspection: resolveChecklistInspection
  };
});
