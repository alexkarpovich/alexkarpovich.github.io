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

  async function resolveChecklistInspection(client, cardId, card, allowRemote, appKey, epicApi) {
    let checklists = (card && card.checklists) || [];
    let local = epicApi.inspectChecklists(checklists, cardId, null);
    const wantRemote = allowRemote && appKey && epicApi.needsRemoteChecklists(local, checklists);
    if (wantRemote) {
      try {
        const api = await client.getRestApi();
        if (await api.isAuthorized()) {
          const token = await api.getToken();
          checklists = await fetchJson("https://api.trello.com/1/cards/" + encodeURIComponent(cardId) + "/checklists?checkItems=all&checkItem_fields=name,state,idCard&key=" + encodeURIComponent(appKey) + "&token=" + encodeURIComponent(token));
          local = epicApi.inspectChecklists(checklists, cardId, null);
        }
      } catch (error) { /* Keep the unknown state; never assume missing time is zero. */ }
    }
    if (local.unresolvedCount) {
      const cards = await client.cards("id", "shortLink");
      const links = new Map(cards.map(function (item) { return [item.shortLink, item.id]; }));
      local = epicApi.inspectChecklists(checklists, cardId, links);
    }
    return local;
  }

  return {
    mapPool: mapPool,
    createReader: createReader,
    coalesce: coalesce,
    fetchJson: fetchJson,
    clientOptions: clientOptions,
    resolveChecklistInspection: resolveChecklistInspection
  };
});
