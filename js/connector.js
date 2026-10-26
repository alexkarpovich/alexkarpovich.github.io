(function () {
  if (window.parent === window || !window.TrelloPowerUp) return;

  const read = window.TimeRuntime.createReader(8);
  // Aggregates use a separate pending-only pool so they never occupy slots
  // needed by their own child reads.
  const summarize = window.TimeRuntime.createReader(Infinity);
  const icon = new URL("img/icon.svg", window.location.href).href;

  function appKey() {
    return (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey) || "";
  }

  function openCard(t) {
    return t.popup({
      title: "Time tracking",
      url: "./card.html",
      height: 480
    });
  }

  function openReport(t) {
    return t.modal({
      url: "./report.html",
      fullscreen: true,
      title: "Time report and timeline",
      accentColor: "#0079BF"
    });
  }

  function summaryFor(t) {
    const ctx = t.getContext();
    return summarize(ctx.board + ":" + ctx.card, function () { return loadSummary(t); });
  }

  async function loadSummary(t) {
    const ctx = t.getContext();
    const [rawSettings, raw] = await Promise.all([
      read(ctx.board + ":settings", function () { return t.get("board", "shared", "settings", null); }),
      read(ctx.board + ":" + ctx.card, function () { return t.get("card", "shared"); })
    ]);
    const settings = window.TimeDuration.normalizeSettings(rawSettings);
    const state = window.TimeModel.decode(raw && raw.time || raw);
    const summary = {
      settings: settings,
      ownMinutes: window.TimeModel.totalMinutes(state.entries),
      limitMinutes: state.limitMinutes,
      spentMinutes: 0,
      kidsKnown: false
    };
    if (state.limitMinutes == null) return summary;
    const full = await t.card("id");
    const related = await window.TimeRollupCache.loadCardChildren(t, full, appKey(), {
      shared: raw,
      persist: false,
      authStatus: false,
      cards: function () {
        return read(ctx.board + ":cards", function () { return t.cards("id", "name", "url", "shortLink"); });
      },
      // Child reads include validation and fallbacks; do not share their result
      // with the raw read used by that child's own badge callback.
      read: function (id, work) { return read(ctx.board + ":child-time:" + id, work); }
    });
    const { board, inspection } = related;
    if (!inspection.complete) return summary;
    const kids = inspection.childIds || [];
    if (!kids.length) return summary;
    const visible = new Set(board.boardCards.map(function (card) { return card.id; }));
    if (kids.some(function (id) { return !visible.has(id) || !board.totalsById.has(id) || board.totalsById.get(id).missing; })) return summary;
    summary.spentMinutes = kids.reduce(function (sum, id) {
      return sum + board.totalsById.get(id).minutes;
    }, 0);
    summary.kidsKnown = true;
    return summary;
  }

  function trelloBadges(summary, interactive) {
    return window.TimeBadges.badgesFor(summary, summary.settings).map(function (badge) {
      const item = { text: badge.text, color: badge.color };
      if (interactive) {
        item.title = badge.kind === "time" ? "Time" : "Epic";
        item.callback = openCard;
      } else {
        item.icon = icon;
      }
      return item;
    });
  }

  function needsReadAccess() {
    return !!appKey();
  }

  const capabilities = {
    "on-enable": function (t) {
      if (!needsReadAccess()) return;
      return window.TimeRuntime.isReadAuthorized(t).then(function (authorized) {
        if (authorized) return;
        // Must not call authorize() here (popup blockers). Open settings iframe; user clicks Allow there.
        return t.modal({
          title: "Time tracking — getting started",
          url: "./settings.html",
          accentColor: "#0079BF"
        });
      });
    },
    "authorization-status": function (t) {
      if (!needsReadAccess()) return Promise.resolve({ authorized: true });
      return window.TimeRuntime.isReadAuthorized(t).then(function (authorized) {
        return { authorized: authorized };
      });
    },
    "show-authorization": function (t) {
      return t.popup({
        title: "Time tracking — read access",
        url: "./settings.html",
        height: 420
      });
    },
    "card-buttons": function () {
      return [{ icon: icon, text: "Time", callback: openCard }];
    },
    "card-badges": function (t) {
      return summaryFor(t).then(function (summary) {
        return trelloBadges(summary, false);
      }).catch(function () { return []; });
    },
    "card-detail-badges": function (t) {
      return summaryFor(t).then(function (summary) {
        return trelloBadges(summary, true);
      }).catch(function () { return []; });
    },
    "card-back-section": function (t) {
      return {
        title: "Time tracking",
        icon: icon,
        content: {
          type: "iframe",
          url: t.signUrl("./card.html"),
          height: 380
        }
      };
    },
    "board-buttons": function () {
      return [{
        icon: {
          dark: new URL("img/report-on-dark.svg", window.location.href).href,
          light: new URL("img/report-on-light.svg", window.location.href).href
        },
        text: "Time report",
        condition: "always",
        callback: openReport
      }];
    },
    "show-settings": function (t) {
      return t.popup({
        title: "Time tracking settings",
        url: "./settings.html",
        height: 340
      });
    }
  };

  window.TrelloPowerUp.initialize(capabilities, window.TimeRuntime.clientOptions(window.TIMETRACK_CONFIG));
})();
