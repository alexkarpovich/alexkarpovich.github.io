(function () {
  const app = document.getElementById("app");
  let t = null;
  let view = null;
  let saving = false;
  let current = null;
  let currentMember = null;
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

  function checklistDebugItems(checklists, selfId, shortLinks, nameIndex) {
    const rows = [];
    (checklists || []).forEach(function (list) {
      (list.checkItems || []).forEach(function (item) {
        const resolved = window.TimeEpic.resolveCheckItemChildId(item, selfId, shortLinks, nameIndex);
        rows.push({
          name: item && item.name,
          idCard: item && item.idCard,
          childId: resolved.id || null,
          unresolved: resolved.unresolved
        });
      });
    });
    return rows;
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
    if (window.ResizeObserver) {
      let queued = false;
      new window.ResizeObserver(function () {
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
    view.update(loaded);
    requestAnimationFrame(function () { t.sizeTo("#app").catch(function () {}); });
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

  async function mutate(change) {
    const card = await t.card("id");
    const shared = await t.get(card.id, "shared");
    const state = window.TimeModel.decode(shared && shared.time);
    const next = change(state);
    // Relationships come from checklists, not a stale duplicate in pluginData.
    next.kids = null;
    if (window.TimeModel.isEmpty(next)) {
      await t.remove(card.id, "shared", "time");
      return;
    }
    const fit = window.TimeModel.fitState(next, shared);
    await t.set(card.id, "shared", "time", fit.packed);
    if (fit.warning) t.alert({ message: fit.warning, duration: 6, display: "warning" });
  }

  function onAuthorize() {
    if (!appKey()) return Promise.reject(new Error("No API key in config.js for read access."));
    return window.TimeRuntime.authorizeReadAccess(t).then(function () {
      return refresh();
    }).then(function () {
      if (current && current.authorized && current.children.length) {
        t.alert({ message: "Read access granted. Child cards loaded from the checklist.", duration: 4, display: "success" });
      } else if (current && current.authorized) {
        t.alert({ message: "Read access granted. Reopen the card if checklist links still do not appear.", duration: 5, display: "info" });
      }
    });
  }

  async function loadModel(client) {
    const [rawSettings, card, member, raw] = await Promise.all([
      client.get("board", "shared", "settings", null),
      client.card("id", "name", "checklists"),
      client.member("id", "fullName", "username").catch(function () { return null; }),
      client.get("card", "shared", "time", null)
    ]);
    const settings = window.TimeDuration.normalizeSettings(rawSettings);
    currentMember = member ? { id: member.id, name: member.fullName || member.username || "You" } : null;
    const state = window.TimeModel.decode(raw);
    const write = canWriteCard();
    const base = {
      cardId: card.id,
      settings: settings,
      currentMemberId: currentMember ? currentMember.id : "",
      canWrite: write,
      canAdd: write && !!currentMember,
      entries: state.entries,
      limitMinutes: state.limitMinutes,
      kidsKnown: false,
      needsChecklistAuth: false,
      authorized: false,
      children: [],
      unlinkedCount: 0,
      hasChecklists: !!(card.checklists && card.checklists.length),
      buildLabel: buildLabel(),
      warning: "",
      error: "",
      limitError: "",
      saving: saving,
      storageRatio: window.TimeModel.storageRatio(state)
    };
    if (Array.isArray(card.checklists) && card.checklists.length === 0) return base;

    // The time form and its entries are usable while optional epic data loads.
    current = Object.assign({}, base, { childrenLoading: true });
    view.update(current);
    let related;
    try {
      related = await window.TimeRuntime.loadCardChildren(
        client, card, appKey(), window.TimeModel, window.TimeEpic
      );
    } catch (error) {
      return Object.assign(base, {
        saving: saving,
        warning: "Time log loaded, but child cards could not be refreshed. Reopen the card to retry."
      });
    }
    const { board, inspection, shortLinks, nameIndex } = related;
    // Rendering never writes pluginData: opening a card cannot overwrite a log.

    const kids = (inspection.childIds || []).slice();
    const byId = new Map(board.boardCards.map(function (item) { return [item.id, item]; }));
    const children = kids.map(function (id) {
      const info = byId.get(id);
      const packed = board.timeById.get(id);
      const decoded = window.TimeModel.decode(packed);
      return {
        id: id,
        name: info ? info.name : "Unavailable card",
        url: info ? info.url : "",
        minutes: window.TimeModel.totalMinutes(decoded.entries),
        missing: !info || board.unreadableIds.has(id)
      };
    });

    const spent = children.reduce(function (sum, child) { return sum + child.minutes; }, 0);
    const debugEpic = debugEnabled() ? {
      build: buildLabel(),
      epicId: card.id,
      limitMinutes: state.limitMinutes,
      childIds: kids.slice(),
      spentMinutes: spent,
      remainingMinutes: state.limitMinutes != null ? state.limitMinutes - spent : null,
      kidsKnown: kids.length > 0 && inspection.complete && !children.some(function (child) { return child.missing; }),
      checklistAuthNeeded: !!inspection.checklistAuthNeeded,
      authorized: !!board.rest,
      remoteChecklistsFetched: !!inspection.remoteChecklistsFetched,
      checklistCount: (inspection.checklists || []).length,
      checklistItems: checklistDebugItems(inspection.checklists, card.id, shortLinks, nameIndex),
      children: children.map(function (child) {
        return { id: child.id, name: child.name, minutes: child.minutes, missing: child.missing };
      })
    } : null;

    return Object.assign(base, {
      kidsKnown: kids.length > 0 && inspection.complete && !children.some(function (child) { return child.missing; }),
      needsChecklistAuth: !!inspection.checklistAuthNeeded,
      authorized: !!board.rest,
      remoteChecklistsFetched: !!inspection.remoteChecklistsFetched,
      children: children,
      unlinkedCount: inspection.unlinkedCount || 0,
      hasChecklists: !!(inspection.checklists && inspection.checklists.length) || !!(card.checklists && card.checklists.length),
      debugEpic: debugEpic,
      saving: saving
    });
  }

})();
