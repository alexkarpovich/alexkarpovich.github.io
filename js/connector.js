(function () {
  if (!window.TrelloPowerUp) return;

  const icon = new URL("img/icon.svg", window.location.href).href;

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
    const settings = window.TimeDuration.normalizeSettings(await t.get("board", "shared", "settings", null));
    const card = await t.card("id");
    const state = window.TimeModel.decode(await t.get(card.id, "shared", "time", null));
    const summary = {
      settings: settings,
      ownMinutes: window.TimeModel.totalMinutes(state.entries),
      limitMinutes: state.limitMinutes,
      spentMinutes: 0,
      kidsKnown: false
    };
    if (state.limitMinutes == null) return summary;
    const full = await t.card("id", "checklists");
    const inspection = window.TimeEpic.inspectChecklists(full.checklists, full.id, null);
    const kids = inspection.complete ? inspection.childIds : state.kids;
    if (!Array.isArray(kids)) return summary;
    const times = await Promise.all(kids.map(function (id) {
      return t.get(id, "shared", "time", null);
    }));
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

  const config = window.TIMETRACK_CONFIG || {};
  try {
    if (config.appKey) {
      window.TrelloPowerUp.initialize(capabilities, {
        appKey: config.appKey,
        appName: config.appName || "Time Tracking",
        appAuthor: config.appAuthor || "Time Tracking"
      });
    } else {
      window.TrelloPowerUp.initialize(capabilities);
    }
  } catch (error) {
    // Opening the connector URL in a browser tab is the install page, not a Trello iframe.
  }
})();
