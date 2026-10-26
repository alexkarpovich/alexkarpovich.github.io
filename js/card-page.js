(function () {
  const app = document.getElementById("app");
  let t = null;
  let view = null;
  let saving = false;
  let current = null;
  let currentMember = null;
  let rollupNotice = "";
  let searchCards = null;
  let searchAt = 0;
  const refresh = window.TimeRuntime.coalesce(reload);

  if (window.parent === window) {
    app.textContent = "Open this from a Trello board, not this URL in a new tab. On a card, use the Time button or the Time tracking section on the card back, then Allow read access there.";
    return;
  }
  if (!window.TrelloPowerUp) {
    app.textContent = "Trello Power-Up SDK did not load. Reload the board, disable ad blockers for trello.com and p.trellocdn.com, then reopen the card.";
    return;
  }
  t = window.TimeRuntime.createIframe(window.TIMETRACK_CONFIG, window.TrelloPowerUp);
  if (!t) {
    app.textContent = "Could not connect to Trello. Reload the board.";
    return;
  }
  window.TimeTheme.bind(t);

  boot().catch(function (error) {
    app.textContent = error.message || "Could not open time tracking.";
  });

  function appKey() {
    return (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey) || "";
  }

  function buildLabel() {
    return (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.build) || "dev";
  }

  function debugEnabled() {
    try { return window.localStorage.getItem("timetrackDebug") === "1"; } catch (error) { return false; }
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
      onAdd: onAdd,
      onUpdate: onUpdate,
      onDelete: onDelete,
      onLimit: onLimit,
      onLinkAdd: onLinkAdd,
      onCardSearch: onCardSearch,
      onLinkRemove: onLinkRemove,
      onLinkReorder: onLinkReorder,
      onDependencyAdd: function (text, id) { return onLinkAdd(text, id, "dependency"); },
      onDependencyRemove: function (id) { return withSaving(function () { return mutate(function (state) { state.dependencyIds = state.dependencyIds.filter(function (key) { return key !== id; }); return state; }); }); },
      onPlanning: function (planning, minutes) { return withSaving(function () { return mutate(function (state) { state.planning = window.TimeModel.normalizePlanning(planning); state.limitMinutes = minutes; return state; }); }); },
      onInspectDependencies: onInspectDependencies,
      onTimeline: function () { return t.modal({ title: "Timeline", url: "./timeline.html", fullscreen: true, args: { rootId: current.cardId } }); }
    });
    if (window.ResizeObserver) {
      let queued = false;
      let lastSize = "";
      new window.ResizeObserver(function (entries) {
        const rect = entries[0].contentRect;
        const size = Math.ceil(rect.width) + ":" + Math.ceil(rect.height);
        if (size === lastSize) return;
        lastSize = size;
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          t.sizeTo("#app").catch(function () {});
        });
      }).observe(app);
    }
    t.render(function () {
      return refresh().catch(function (error) {
        if (current) {
          current.error = error.message || "Could not refresh the card.";
          view.update(current);
        } else {
          let status = document.getElementById("load-error");
          if (!status) {
            status = window.TimeDom.h("p", { id: "load-error", class: "error", role: "alert" });
            app.prepend(status);
          }
          status.textContent = error.message || "Could not load the card. Reopen it to retry.";
        }
      });
    });
  }

  async function reload() {
    const loaded = await loadModel(t);
    const status = document.getElementById("load-error");
    if (status) status.remove();
    current = loaded;
    const changed = view.update(loaded);
    if (changed !== false && !window.ResizeObserver) requestAnimationFrame(function () { t.sizeTo("#app").catch(function () {}); });
  }

  async function withSaving(work) {
    if (saving) throw new Error("Please wait for the current save.");
    if (!canWriteCard()) throw new Error("This board is read-only.");
    saving = true;
    if (current && view) {
      current.saving = true;
      view.update(current);
    }
    try {
      await work();
      // A successful write must not be reported as failed if the refresh fails:
      // otherwise retrying Add would create a duplicate entry.
      try { await refresh(); } catch (error) {
        if (current) current.error = "Saved, but refresh failed. Reopen the card to see the latest data.";
      }
    } finally {
      saving = false;
      if (current && view) {
        current.saving = false;
        view.update(current);
      }
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
        window.TimeModel.validateEntry(fields);
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

  async function onCardSearch(query, kind) {
    if (!searchCards || Date.now() - searchAt > 30000) {
      searchAt = Date.now();
      searchCards = t.cards("id", "name", "url", "shortLink").catch(function (error) { searchCards = null; throw error; });
    }
    const cards = await searchCards;
    const text = String(query || "").trim().toLowerCase();
    return cards.filter(function (card) {
      return card.id !== current.cardId && !(kind === "dependency" ? current.dependencyIds : current.linkedIds).includes(card.id) && String(card.name || "").toLowerCase().includes(text);
    }).slice(0, 8);
  }

  function onLinkAdd(rawLink, selectedId, kind) {
    return withSaving(async function () {
      const text = String(rawLink || "").trim();
      const match = text.match(/^https?:\/\/trello\.com\/c\/([A-Za-z0-9]+)(?:[/?#].*)?$/i);
      if (!selectedId && /^(?:https?:|trello\.)/i.test(text) && !match) throw new Error("Paste a Trello card URL (https://trello.com/c/…).");
      const cards = await t.cards("id", "name", "url", "shortLink");
      const matches = cards.filter(function (item) {
        return selectedId ? item.id === selectedId : match
          ? item.shortLink === match[1] || window.TimeEpic.shortLinksInText(item.url).includes(match[1])
          : String(item.name || "").toLowerCase() === text.toLowerCase();
      });
      if (matches.length > 1) throw new Error("Several cards have this name. Choose a card from the suggestions.");
      const child = matches[0];
      if (!child) throw new Error("Card not found. Use a visible card on this board in an open list.");
      if (child.id === current.cardId) throw new Error("A card cannot link to itself.");
      const board = await planningBoard();
      window.TimeTimeline.validateLinks(board);
      return mutate(function (state) {
        const ids = kind === "dependency" ? state.dependencyIds : state.linkedIds;
        if (ids.includes(child.id)) throw new Error("This card is already linked.");
        ids.push(child.id);
        return state;
      }, board);
    });
  }

  function onLinkRemove(id) {
    return withSaving(function () {
      return mutate(function (state) {
        state.linkedIds = state.linkedIds.filter(function (childId) { return childId !== id; });
        return state;
      });
    });
  }

  function onLinkReorder(ids) {
    if (!canWriteCard()) return Promise.reject(new Error("This board is read-only."));
    if (current && window.TimeEpic.sameIds(ids, current.linkedIds)) return Promise.resolve();
    return withSaving(function () {
      return mutate(function (state) {
        if (!Array.isArray(ids) || ids.length !== state.linkedIds.length || new Set(ids).size !== ids.length ||
          ids.some(function (id) { return !state.linkedIds.includes(id); })) {
          throw new Error("Child cards changed. Refresh the card before reordering.");
        }
        state.linkedIds = ids.slice();
        return state;
      });
    });
  }

  async function mutate(change, relationshipBoard) {
    const card = await t.card("id");
    const shared = await t.get(card.id, "shared");
    const state = window.TimeModel.decode(shared && shared.time);
    const next = change(state);
    if (hasNewLinks(window.TimeModel.decode(shared && shared.time), next)) {
      await validateRelationships(card.id, next, relationshipBoard);
    }
    // Retire legacy checklist settings; owned links are source data.
    next.kids = null;
    next.subtasksChecklistId = null;
    const primary = Object.assign({}, shared);
    delete primary.rollup;
    delete primary.rollupLinks;
    let fit = window.TimeModel.isEmpty(next) ? null : window.TimeModel.fitState(next, primary);
    let transaction;
    rollupNotice = "";
    try {
      const full = await t.card("id", "name", "url", "shortLink");
      transaction = await window.TimeRollupCache.prepareChange(t, full, appKey(), shared);
    } catch (error) {
      rollupNotice = "Parent totals could not be refreshed. Reopen the epic to recalculate.";
    }
    // Source logs have priority over derived keys when shared storage is full.
    const latestShared = await t.get(card.id, "shared") || {};
    const latestPrimary = Object.assign({}, latestShared);
    delete latestPrimary.rollup;
    delete latestPrimary.rollupLinks;
    const fresh = JSON.stringify(latestShared.time) === JSON.stringify(shared && shared.time)
      ? next : change(window.TimeModel.decode(latestShared.time));
    if (fresh !== next && hasNewLinks(window.TimeModel.decode(latestShared.time), fresh)) await validateRelationships(card.id, fresh);
    fresh.kids = null;
    fresh.subtasksChecklistId = null;
    fit = window.TimeModel.isEmpty(fresh) ? null : window.TimeModel.fitState(fresh, latestPrimary);
    if (fit && JSON.stringify(Object.assign({}, latestShared, { time: fit.packed })).length > window.TimeModel.MAX_PLUGIN_CHARS) {
      if (latestShared.rollup) await t.remove(card.id, "shared", "rollup");
      if (latestShared.rollupLinks) await t.remove(card.id, "shared", "rollupLinks");
    }
    if (fit) await t.set(card.id, "shared", "time", fit.packed);
    else await t.remove(card.id, "shared", "time");
    if (transaction) {
      try { await window.TimeRollupCache.finishChange(t, transaction, appKey(), fit ? fit.packed : null); }
      catch (error) { rollupNotice = "Time saved. Parent totals will be recalculated when reopened."; }
    }
    if (fit && fit.warning) t.alert({ message: fit.warning, duration: 6, display: "warning" });
  }

  function hasNewLinks(previous, next) {
    return next.linkedIds.some(function (id) { return !previous.linkedIds.includes(id); }) ||
      next.dependencyIds.some(function (id) { return !previous.dependencyIds.includes(id); });
  }

  async function planningBoard() {
    const cards = await t.cards("id", "name", "url", "shortLink");
    const loaded = await window.TimeRuntime.loadBoardTimes(t, appKey(), window.TimeModel, cards);
    return cards.map(function (item) { return Object.assign({}, item, window.TimeModel.decode(loaded.timeById.get(item.id)), { missing: loaded.unreadableIds.has(item.id) }); });
  }

  async function validateRelationships(id, state, loaded) {
    const cards = loaded || await planningBoard();
    if (cards.some(function (item) { return item.missing; })) throw new Error("Some card links are unavailable. Restore access before changing relationships.");
    const index = cards.findIndex(function (item) { return item.id === id; });
    if (index < 0) cards.push(Object.assign({ id: id }, state));
    else cards[index] = Object.assign({}, cards[index], state);
    const known = new Set(cards.map(function (item) { return item.id; }));
    if (cards.some(function (item) { return item.linkedIds.concat(item.dependencyIds).some(function (key) { return !known.has(key); }); })) throw new Error("Some linked cards are unavailable. Restore access before adding links.");
    window.TimeTimeline.validateLinks(cards);
  }

  async function onInspectDependencies() {
    const id = current.cardId, cards = await planningBoard();
    if (current.cardId !== id) return;
    const g = window.TimeTimeline.graph(cards), inherited = [];
    g.ancestors(id).forEach(function (parentId) {
      const parent = g.byId.get(parentId);
      (parent.dependencyIds || []).forEach(function (dep) {
        const card = g.byId.get(dep);
        inherited.push({ id: dep, name: card ? card.name : "Unavailable card", parentName: parent.name, parentUrl: parent.url });
      });
    });
    current.inheritedDependencies = inherited;
    view.update(current);
    return { count: inherited.length, incomplete: cards.some(function (card) { return card.missing; }) };
  }

  async function loadModel(client) {
    const [rawSettings, card, member, raw] = await Promise.all([
      client.get("board", "shared", "settings", null),
      client.card("id", "name"),
      client.member("id", "fullName", "username").catch(function () { return null; }),
      client.get("card", "shared")
    ]);
    const settings = window.TimeDuration.normalizeSettings(rawSettings);
    currentMember = member ? { id: member.id, name: member.fullName || member.username || "You" } : null;
    const state = window.TimeModel.decode(raw && raw.time || raw);
    const write = canWriteCard();
    const base = {
      cardId: card.id,
      settings: settings,
      currentMemberId: currentMember ? currentMember.id : "",
      canWrite: write,
      canAdd: write && !!currentMember,
      entries: state.entries,
      linkedIds: state.linkedIds,
      dependencyIds: state.dependencyIds,
      planning: state.planning,
      dependencies: state.dependencyIds.map(function (id) { return { id: id, name: "Card " + id, missing: true }; }),
      inheritedDependencies: [],
      limitMinutes: state.limitMinutes,
      kidsKnown: false,
      needsChecklistAuth: false,
      authorized: false,
      children: state.linkedIds.map(function (id) { return { id: id, name: "Unavailable card", url: "", minutes: 0, missing: true }; }),
      buildLabel: buildLabel(),
      warning: rollupNotice,
      error: "",
      limitError: "",
      saving: saving,
      storageRatio: window.TimeModel.storageRatio(state)
    };
    if (state.dependencyIds.length) {
      try {
        const cards = await client.cards("id", "name", "url", "shortLink");
        base.dependencies = state.dependencyIds.map(function (id) { return cards.find(function (item) { return item.id === id; }) || { id: id, name: "Unavailable card", missing: true }; });
      } catch (error) { base.warning = "Dependency names could not be loaded. Open Timeline to retry."; }
    }
    if (!state.linkedIds.length) return base;

    // The time form and its entries are usable while optional epic data loads.
    if (!current || current.cardId !== card.id) {
      current = Object.assign({}, base, { childrenLoading: true });
      view.update(current);
    }
    let related;
    try {
      related = await window.TimeRollupCache.loadCardChildren(client, card, appKey(), { shared: raw });
    } catch (error) {
      return Object.assign(base, {
        saving: saving,
        warning: "Time log loaded, but child cards could not be refreshed. Reopen the card to retry."
      });
    }
    const { board, inspection } = related;
    // Opening a card may repair derived summaries; source logs are kept separately.

    const kids = (inspection.childIds || []).slice();
    const byId = new Map(board.boardCards.map(function (item) { return [item.id, item]; }));
    const children = kids.map(function (id) {
      const info = byId.get(id);
      const rolled = board.totalsById.get(id);
      return {
        id: id,
        name: info ? info.name : "Unavailable card",
        url: info ? info.url : "",
        minutes: rolled ? rolled.minutes : 0,
        entries: rolled ? rolled.entries : [],
        missing: !info || !rolled || rolled.missing
      };
    });

    const spent = children.reduce(function (sum, child) { return sum + child.minutes; }, 0);
    const estimatedFinish = state.limitMinutes != null
      ? window.TimeEpic.estimateFinish(state.limitMinutes - spent, settings, new Date())
      : "";
    const debugEpic = debugEnabled() ? {
      build: buildLabel(),
      epicId: card.id,
      linkedIds: state.linkedIds,
      limitMinutes: state.limitMinutes,
      childIds: kids.slice(),
      spentMinutes: spent,
      remainingMinutes: state.limitMinutes != null ? state.limitMinutes - spent : null,
      kidsKnown: kids.length > 0 && inspection.complete && !children.some(function (child) { return child.missing; }),
      authorized: !!board.rest,
      children: children.map(function (child) {
        return { id: child.id, name: child.name, minutes: child.minutes, missing: child.missing };
      })
    } : null;

    return Object.assign(base, {
      kidsKnown: kids.length > 0 && inspection.complete && !children.some(function (child) { return child.missing; }),
      needsChecklistAuth: !!inspection.checklistAuthNeeded,
      authorized: !!board.rest,
      children: children,
      estimatedFinish: estimatedFinish,
      debugEpic: debugEpic,
      saving: saving
    });
  }

})();
