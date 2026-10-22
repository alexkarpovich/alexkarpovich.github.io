(function () {
  const app = document.getElementById("app");
  const banner = document.getElementById("banner");
  let t = null;
  let view = null;
  let settings = window.TimeDuration.normalizeSettings(null);
  let cards = [];
  let notice = "";
  let needsAuth = false;
  let report = null;
  const refresh = window.TimeRuntime.coalesce(reload);

  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open this report from the Time report board button in Trello.";
    return;
  }
  t = window.TimeRuntime.createIframe(window.TIMETRACK_CONFIG, window.TrelloPowerUp);
  if (!t) {
    app.textContent = "Could not connect to Trello. Reload the board.";
    return;
  }
  window.TimeTheme.bind(t);

  t.render(function () {
    return refresh().catch(function (error) {
      notice = error.message || "Could not build the report.";
      if (view && report) view.update(report, notice);
      else app.textContent = notice;
    });
  });

  function appKey() {
    return (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey) || "";
  }

  async function reload() {
    const [rawSettings, loaded] = await Promise.all([
      t.get("board", "shared", "settings", null),
      loadBoard()
    ]);
    settings = window.TimeDuration.normalizeSettings(rawSettings);
    if (!view) {
      app.textContent = "";
      view = window.TimeReportView.mount(app, {
        today: function () { return new Date(); },
        settings: function () { return settings; },
        onChange: renderReport,
        onExport: exportExcel
      });
    }
    cards = loaded.cards;
    notice = loaded.notice;
    needsAuth = loaded.needsAuth;
    paintBanner();
    renderReport();
  }

  function renderReport() {
    if (!view) return;
    report = window.TimeAggregate.buildReport(cards, Object.assign({}, view.filters(), { settings: settings }));
    view.update(report, notice);
  }

  function exportExcel() {
    if (!report) return;
    report.labelText = window.TimeAggregate.labelText;
    const workbook = window.TimeExcel.buildWorkbook(report, window.TimeDuration.formatDuration, settings);
    window.TimeDom.download("time-report-" + report.from + "_" + report.to + ".xlsx", workbook);
  }

  function paintBanner() {
    window.TimeDom.clear(banner);
    if (!needsAuth) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.appendChild(window.TimeDom.h("span", null, "Allow board read access to recover unavailable time logs."));
    const allowBtn = window.TimeDom.h("button", {
      type: "button",
      class: "button mod-primary"
    }, "Allow");
    allowBtn.addEventListener("click", function () {
      allowBtn.disabled = true;
      window.TimeRuntime.authorizeReadAccess(t).then(function () {
        return refresh();
      }).catch(function (error) {
        notice = error.message || "Could not authorize. Please try again.";
        renderReport();
      }).finally(function () {
        allowBtn.disabled = false;
      });
    });
    banner.appendChild(allowBtn);
  }

  async function loadBoard() {
    const [cardList, lists] = await Promise.all([
      t.cards("id", "name", "url", "labels", "idList", "shortLink"),
      t.lists("id", "name")
    ]);
    const listNames = new Map((lists || []).map(function (list) { return [list.id, list.name]; }));
    const boardTimes = await window.TimeRuntime.loadBoardTimes(t, appKey(), window.TimeModel, cardList);
    const states = cardList.map(function (card) {
      return window.TimeModel.decode(boardTimes.timeById.get(card.id));
    });
    const cardsOut = cardList.map(function (card, index) {
      const state = states[index];
      return {
        id: card.id,
        name: card.name,
        url: card.url,
        listName: listNames.get(card.idList) || "",
        labels: (card.labels || []).map(function (label) {
          return { id: label.id, name: label.name || "", color: label.color || "" };
        }),
        entries: state.entries,
        limitMinutes: state.limitMinutes,
        hasSubtasks: state.linkedIds.length > 0,
        kids: boardTimes.unreadableIds.has(card.id) ? null : state.linkedIds,
        missing: boardTimes.unreadableIds.has(card.id)
      };
    });

    let message = "Report includes only visible cards in open lists; archived cards are excluded.";
    if (boardTimes.unreadableIds.size) message += " Some time logs could not be read; totals may be incomplete. Reload the report to retry.";
    return { cards: cardsOut, notice: message, needsAuth: false };
  }

})();
