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
    report = window.TimeAggregate.buildReport(cards, view.filters());
    view.update(report, notice);
  }

  function exportExcel() {
    if (!report) return;
    report.labelText = window.TimeAggregate.labelText;
    const xml = window.TimeExcel.buildWorkbook(report, window.TimeDuration.formatDuration, settings);
    window.TimeDom.download("time-report-" + report.from + "_" + report.to + ".xml", xml, "application/xml;charset=utf-8");
  }

  function paintBanner() {
    window.TimeDom.clear(banner);
    if (!needsAuth) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.appendChild(window.TimeDom.h("span", null, "Allow board read access to compute epic checklist remaining time."));
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
      t.cards("id", "name", "url", "labels", "idList", "shortLink", "checklists"),
      t.lists("id", "name")
    ]);
    const listNames = new Map((lists || []).map(function (list) { return [list.id, list.name]; }));
    const shortLinks = new Map((cardList || []).map(function (card) { return [card.shortLink, card.id]; }));
    const nameIndex = window.TimeEpic.uniqueNameIndex(cardList);
    const boardTimes = await window.TimeRuntime.loadBoardTimes(t, appKey(), window.TimeModel);
    const states = cardList.map(function (card) {
      return window.TimeModel.decode(boardTimes.timeById.get(card.id));
    });
    const needsLists = cardList.some(function (card, index) {
      if (states[index].limitMinutes == null) return false;
      const fromClient = window.TimeEpic.inspectChecklists(card.checklists, card.id, shortLinks, nameIndex);
      if (!(fromClient.childIds && fromClient.childIds.length)) return true;
      return window.TimeEpic.needsRemoteChecklists(fromClient, card.checklists);
    });
    const remote = needsLists ? await loadRemoteChecklists() : { map: null, needsAuth: false };
    const cardsOut = cardList.map(function (card, index) {
      const state = states[index];
      const fromClient = window.TimeEpic.inspectChecklists(card.checklists, card.id, shortLinks, nameIndex);
      let kids = fromClient.complete ? fromClient.childIds : null;
      if (remote.map && remote.map.has(card.id)) {
        const parsed = window.TimeEpic.inspectChecklists(remote.map.get(card.id), card.id, shortLinks, nameIndex);
        if (parsed.complete) kids = parsed.childIds;
      }
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
        kids: state.limitMinutes != null ? kids : null,
        missing: false
      };
    });

    const unknown = cardsOut.filter(function (card) { return card.limitMinutes != null && !Array.isArray(card.kids); });
    let message = "Report includes only visible cards in open lists; archived cards are excluded.";
    if (unknown.length && !appKey()) {
      message += " Checklists for some epics were not returned by Trello. Open the epic card to inspect its links.";
    } else if (unknown.length && remote.needsAuth) {
      message += " Checklists for some epics were not returned. Allow board read access to compute remaining time.";
    } else if (unknown.length) {
      message += " Could not read checklists for some epics. Open those cards to refresh links.";
    }
    return { cards: cardsOut, notice: message, needsAuth: !!(unknown.length && remote.needsAuth && appKey()) };
  }

  async function loadRemoteChecklists() {
    if (!appKey()) return { map: null, needsAuth: false };
    try {
      const api = await t.getRestApi();
      if (!(await api.isAuthorized())) return { map: null, needsAuth: true };
      const token = await api.getToken();
      const board = await t.board("id");
      const list = await window.TimeRuntime.fetchJson("https://api.trello.com/1/boards/" + board.id + "/cards?filter=visible&fields=id,shortLink&checklists=all&checkItem_fields=name,idCard,state&key=" + encodeURIComponent(appKey()) + "&token=" + encodeURIComponent(token));
      const map = new Map();
      list.forEach(function (card) { map.set(card.id, card.checklists); });
      return { map: map, needsAuth: false };
    } catch (error) {
      return { map: null, needsAuth: false };
    }
  }

})();
