(function () {
  const app = document.getElementById("app");
  let t = null;
  let view = null;
  let saving = false;
  let current = null;
  let currentMember = null;

  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open this page from a Trello card.";
    return;
  }
  t = window.TrelloPowerUp.iframe();
  window.TimeTheme.bind(t);

  boot().catch(function (error) {
    app.textContent = error.message || "Could not open time tracking.";
  });

  function appKey() {
    return (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey) || "";
  }

  function permissions() {
    const ctx = t.getContext();
    return (ctx && ctx.permissions) || {};
  }

  function canWriteCard() {
    const perms = permissions();
    return perms.card === "write" || perms.board === "write";
  }

  async function boot() {
    view = window.TimeCardView.mount(app, {
      settings: function () { return current ? current.settings : window.TimeDuration.normalizeSettings(null); },
      canAuthorize: !!appKey(),
      onAdd: onAdd,
      onUpdate: onUpdate,
      onDelete: onDelete,
      onLimit: onLimit,
      onAuthorize: onAuthorize
    });
    t.render(function () {
      return reload().catch(function (error) {
        if (current) {
          current.error = error.message || "Could not refresh the card.";
          view.update(current);
        }
      });
    });
  }

  async function reload() {
    const loaded = await loadModel(t);
    current = loaded;
    view.update(loaded);
    requestAnimationFrame(function () { t.sizeTo("#app"); });
  }

  async function withSaving(work) {
    saving = true;
    if (current && view) {
      current.saving = true;
      view.update(current);
    }
    try {
      await work();
      await reload();
    } finally {
      saving = false;
    }
  }

  function assertAuthor(entry) {
    if (!currentMember || !currentMember.id) {
      throw new Error("Sign in to Trello to change entries.");
    }
    if (!entry || entry.memberId !== currentMember.id) {
      throw new Error("You can only edit your own entries.");
    }
  }

  function onAdd(fields) {
    if (!canWriteCard()) return Promise.reject(new Error("This board is read-only."));
    if (!currentMember || !currentMember.id) return Promise.reject(new Error("Sign in to Trello to log time."));
    return withSaving(function () {
      return mutate(function (state) {
        state.entries.push(window.TimeModel.createEntry({
          minutes: fields.minutes,
          ymd: fields.ymd,
          note: fields.note,
          memberId: currentMember.id,
          memberName: currentMember.name
        }));
        return state;
      });
    });
  }

  function onUpdate(fields) {
    return withSaving(function () {
      return mutate(function (state) {
        const entry = window.TimeModel.findEntry(state, fields.id);
        assertAuthor(entry);
        entry.minutes = fields.minutes;
        entry.ymd = fields.ymd;
        entry.note = fields.note;
        entry.createdAt = fields.createdAt || entry.createdAt || Date.now();
        return state;
      });
    });
  }

  function onDelete(id) {
    return withSaving(function () {
      return mutate(function (state) {
        const entry = window.TimeModel.findEntry(state, id);
        assertAuthor(entry);
        state.entries = state.entries.filter(function (item) { return item.id !== id; });
        return state;
      });
    });
  }

  function onLimit(minutes) {
    if (!canWriteCard()) return Promise.reject(new Error("This board is read-only."));
    return withSaving(function () {
      return mutate(function (state) {
        state.limitMinutes = minutes;
        return state;
      });
    });
  }

  async function mutate(change) {
    const card = await t.card("id");
    const state = window.TimeModel.decode(await t.get(card.id, "shared", "time", null));
    const next = change(state);
    if (next.limitMinutes != null) {
      const inspection = await readChildren(card.id);
      if (inspection.complete) next.kids = inspection.childIds;
    } else {
      next.kids = null;
    }
    if (window.TimeModel.isEmpty(next)) {
      await t.remove(card.id, "shared", "time");
      return;
    }
    const fit = window.TimeModel.fitState(next);
    await t.set(card.id, "shared", "time", fit.packed);
    if (fit.warning) t.alert({ message: fit.warning, duration: 6, display: "warning" });
  }

  async function onAuthorize() {
    const api = await t.getRestApi();
    await api.authorize({ scope: "read", expiration: "never" });
    await reload();
  }

  async function loadModel(client) {
    const settings = window.TimeDuration.normalizeSettings(await client.get("board", "shared", "settings", null));
    const card = await client.card("id", "name", "checklists");
    let member = null;
    try {
      member = await client.member("id", "fullName", "username");
    } catch (error) {
      member = null;
    }
    currentMember = member ? {
      id: member.id,
      name: member.fullName || member.username || "You"
    } : null;

    const board = await client.board("members");
    let state = window.TimeModel.decode(await client.get(card.id, "shared", "time", null));
    state.entries = window.TimeModel.sortEntries(state.entries);

    let inspection = window.TimeEpic.inspectChecklists(card.checklists, card.id, null);
    if (!inspection.complete) inspection = await readChildren(card.id);
    if (inspection.complete) state.kids = inspection.childIds;
    if (state.limitMinutes != null && inspection.complete) {
      const saved = window.TimeModel.decode(await client.get(card.id, "shared", "time", null));
      if (!window.TimeEpic.sameIds(saved.kids, inspection.childIds)) {
        try {
          const fit = window.TimeModel.fitState(state);
          state = fit.state;
          await client.set(card.id, "shared", "time", fit.packed);
        } catch (error) {
          // Read-only members still see the fresh child list for this session.
        }
      }
    }

    const members = ((board && board.members) || []).map(function (person) {
      return { id: person.id, name: person.fullName || person.username || "Unnamed" };
    });
    if (member && !members.some(function (person) { return person.id === member.id; })) {
      members.unshift({ id: member.id, name: member.fullName || member.username || "You" });
    }

    const write = canWriteCard();
    const kids = state.kids || [];
    let children = kids.map(function (id) {
      return { id: id, name: "Card", url: "", minutes: 0 };
    });
    if (state.limitMinutes != null && kids.length) {
      const boardCards = await client.cards("id", "name", "url");
      const byId = new Map(boardCards.map(function (item) { return [item.id, item]; }));
      const childTimes = await mapPool(kids, 8, function (id) {
        return client.get(id, "shared", "time", null);
      });
      children = kids.map(function (id, index) {
        const info = byId.get(id);
        const decoded = window.TimeModel.decode(childTimes[index]);
        return {
          id: id,
          name: info ? info.name : "Unavailable card",
          url: info ? info.url : "",
          minutes: window.TimeModel.totalMinutes(decoded.entries)
        };
      });
    }

    return {
      cardId: card.id,
      settings: settings,
      members: members,
      currentMemberId: currentMember ? currentMember.id : "",
      canWrite: write,
      canAdd: write && !!currentMember,
      entries: state.entries,
      limitMinutes: state.limitMinutes,
      kidsKnown: inspection.complete || Array.isArray(state.kids),
      children: children,
      unlinkedCount: inspection.unlinkedCount || 0,
      warning: "",
      error: "",
      limitError: "",
      saving: saving,
      storageRatio: window.TimeModel.storageRatio(state)
    };
  }

  async function readChildren(cardId) {
    const card = await t.card("id", "checklists");
    const local = window.TimeEpic.inspectChecklists(card.checklists, card.id || cardId, null);
    if (local.complete || !appKey()) return local;
    try {
      const api = await t.getRestApi();
      if (!(await api.isAuthorized())) return local;
      const token = await api.getToken();
      const response = await fetch("https://api.trello.com/1/cards/" + cardId + "/checklists?checkItems=all&checkItem_fields=name,state,idCard&key=" + encodeURIComponent(appKey()) + "&token=" + encodeURIComponent(token));
      if (!response.ok) return local;
      return window.TimeEpic.inspectChecklists(await response.json(), cardId, null);
    } catch (error) {
      return local;
    }
  }

  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        out[index] = await fn(items[index], index);
      }
    }
    const workers = [];
    const count = Math.min(limit, items.length);
    for (let i = 0; i < count; i += 1) workers.push(worker());
    await Promise.all(workers);
    return out;
  }
})();
