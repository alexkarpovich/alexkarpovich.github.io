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

  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open this report from the Time report board button in Trello.";
    return;
  }
  t = window.TrelloPowerUp.iframe();
  window.TimeTheme.bind(t);

  t.render(function () {
    return reload().catch(function (error) {
      notice = error.message || "Could not build the report.";
      if (view && report) view.update(report, notice);
      else app.textContent = notice;
    });
  });

  function appKey() {
    return (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey) || "";
  }

  async function reload() {
    settings = window.TimeDuration.normalizeSettings(await t.get("board", "shared", "settings", null));
    if (!view) {
      view = window.TimeReportView.mount(app, {
        today: function () { return new Date(); },
        settings: function () { return settings; },
        onChange: renderReport,
        onExport: exportExcel
      });
    }
    const loaded = await loadBoard();
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
    window.TimeDom.download("time-report-" + report.from + "_" + report.to + ".xls", xml);
  }

  function paintBanner() {
    window.TimeDom.clear(banner);
    if (!needsAuth) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.appendChild(window.TimeDom.h("span", null, "Allow board read access to compute epic checklist remaining time."));
    banner.appendChild(window.TimeDom.h("button", {
      type: "button",
      class: "button mod-primary",
      onclick: async function () {
        const api = await t.getRestApi();
        await api.authorize({ scope: "read", expiration: "never" });
        await reload();
      }
    }, "Allow"));
  }

  async function loadBoard() {
    const cardList = await t.cards("id", "name", "url", "labels", "idList", "shortLink", "checklists");
    const lists = await t.lists("id", "name");
    const listNames = new Map((lists || []).map(function (list) { return [list.id, list.name]; }));
    const shortLinks = new Map((cardList || []).map(function (card) { return [card.shortLink, card.id]; }));
    const times = await mapPool(cardList, 8, function (card) {
      return t.get(card.id, "shared", "time", null);
    });
    const states = times.map(function (raw) { return window.TimeModel.decode(raw); });
    const needsLists = cardList.some(function (card, index) {
      return states[index].limitMinutes != null && !window.TimeEpic.inspectChecklists(card.checklists, card.id, shortLinks).complete;
    });
    const remote = needsLists ? await loadRemoteChecklists() : { map: null, needsAuth: false };
    const cardsOut = cardList.map(function (card, index) {
      const state = states[index];
      const fromClient = window.TimeEpic.inspectChecklists(card.checklists, card.id, shortLinks);
      let kids = state.kids;
      if (remote.map && remote.map.has(card.id)) {
        const parsed = window.TimeEpic.inspectChecklists(remote.map.get(card.id), card.id, shortLinks);
        if (parsed.complete) kids = parsed.childIds;
      } else if (fromClient.complete) {
        kids = fromClient.childIds;
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

    const known = new Set(cardsOut.map(function (card) { return card.id; }));
    const missingIds = [];
    cardsOut.forEach(function (card) {
      (card.kids || []).forEach(function (id) {
        if (!known.has(id)) missingIds.push(id);
      });
    });
    const uniqueMissing = Array.from(new Set(missingIds));
    const missingTimes = await mapPool(uniqueMissing, 8, function (id) {
      return t.get(id, "shared", "time", null);
    });
    uniqueMissing.forEach(function (id, index) {
      const state = window.TimeModel.decode(missingTimes[index]);
      cardsOut.push({
        id: id,
        name: "Unavailable card",
        url: "",
        listName: "",
        labels: [],
        entries: state.entries,
        limitMinutes: null,
        kids: null,
        missing: true
      });
    });

    const unknown = cardsOut.filter(function (card) { return card.limitMinutes != null && !Array.isArray(card.kids); });
    let message = "";
    if (unknown.length && !appKey()) {
      message = "Checklists for some epics were not returned by Trello. Set appKey in js/config.js or open the epic card to refresh links.";
    } else if (unknown.length && remote.needsAuth) {
      message = "Checklists for some epics were not returned. Allow board read access to compute remaining time.";
    } else if (unknown.length) {
      message = "Could not read checklists for some epics. Open those cards to refresh links.";
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
      const response = await fetch("https://api.trello.com/1/boards/" + board.id + "/cards?filter=visible&fields=id,shortLink&checklists=all&checkItem_fields=name,idCard,state&key=" + encodeURIComponent(appKey()) + "&token=" + encodeURIComponent(token));
      if (!response.ok) return { map: null, needsAuth: false };
      const list = await response.json();
      const map = new Map();
      list.forEach(function (card) { map.set(card.id, card.checklists || []); });
      return { map: map, needsAuth: false };
    } catch (error) {
      return { map: null, needsAuth: false };
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
    for (let i = 0; i < Math.min(limit, items.length); i += 1) workers.push(worker());
    await Promise.all(workers);
    return out;
  }
})();
