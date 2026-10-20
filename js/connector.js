(function () {
  if (window.parent === window || !window.TrelloPowerUp) return;

  const read = window.TimeRuntime.createReader(8);
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
      title: "Time report",
      accentColor: "#0079BF"
    });
  }

  async function summaryFor(t) {
    const ctx = t.getContext();
    const [rawSettings, raw] = await Promise.all([
      read(ctx.board + ":settings", function () { return t.get("board", "shared", "settings", null); }),
      read(ctx.board + ":" + ctx.card, function () { return t.get("card", "shared", "time", null); })
    ]);
    const settings = window.TimeDuration.normalizeSettings(rawSettings);
    const state = window.TimeModel.decode(raw);
    const summary = {
      settings: settings,
      ownMinutes: window.TimeModel.totalMinutes(state.entries),
      limitMinutes: state.limitMinutes,
      spentMinutes: 0,
      kidsKnown: false
    };
    if (state.limitMinutes == null) return summary;
    const full = await t.card("id", "checklists");
    const inspection = await window.TimeRuntime.resolveChecklistInspection(
      t,
      full.id,
      full,
      true,
      appKey(),
      window.TimeEpic
    );
    if (!inspection.complete) return summary;
    const kids = inspection.childIds;
    const boardCards = await read(ctx.board + ":cards", function () { return t.cards("id", "shortLink"); });
    const visible = new Set(boardCards.map(function (card) { return card.id; }));
    if (kids.some(function (id) { return !visible.has(id); })) return summary;
    let times;
    try {
      times = await Promise.all(kids.map(function (id) {
        return read(ctx.board + ":" + id, function () { return t.get(id, "shared", "time", null); });
      }));
    } catch (error) { return summary; }
    summary.spentMinutes = times.reduce(function (sum, raw) {
      return sum + window.TimeModel.totalMinutes(window.TimeModel.decode(raw).entries);
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

  const capabilities = {
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
        icon: icon,
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
