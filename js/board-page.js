(function () {
  const app = document.getElementById("app");
  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open Time report from a Trello board or use preview.html for a local demo.";
    return;
  }
  const t = window.TimeRuntime.createIframe(window.TIMETRACK_CONFIG, window.TrelloPowerUp);
  if (!t) { app.textContent = "Could not connect to Trello. Reload the board."; return; }
  window.TimeTheme.bind(t);
  const h = window.TimeDom.h;
  let active = t.arg("view") === "timeline" ? "timeline" : "report";
  let reportView = null, report = null, reportCards = [], reportNotice = "", reportSettings = window.TimeDuration.normalizeSettings(null), needsAuth = false;
  let timelineView = null, calendarSource = null, savingCalendar = false;
  const reportPanel = h("section", { id: "board-report", role: "tabpanel", "aria-labelledby": "board-report-tab" }, h("p", { class: "hint", role: "status" }, "Loading…"));
  const timelinePanel = h("section", { id: "board-timeline", role: "tabpanel", "aria-labelledby": "board-timeline-tab" }, h("p", { class: "hint", role: "status" }, "Loading…"));
  const tabs = {
    report: h("button", { id: "board-report-tab", type: "button", role: "tab", "aria-controls": "board-report", onclick: function () { return selectTab("report", true); } }, "Time report"),
    timeline: h("button", { id: "board-timeline-tab", type: "button", role: "tab", "aria-controls": "board-timeline", onclick: function () { return selectTab("timeline", true); } }, "Timeline")
  };
  const tablist = h("div", { class: "board-tabs", role: "tablist", "aria-label": "Board time views" }, [tabs.report, tabs.timeline]);
  app.textContent = "";
  app.appendChild(tablist);
  app.appendChild(reportPanel);
  app.appendChild(timelinePanel);
  tablist.addEventListener("keydown", function (event) {
    const next = event.key === "ArrowRight" || event.key === "ArrowLeft" ? active === "report" ? "timeline" : "report" : event.key === "Home" ? "report" : event.key === "End" ? "timeline" : null;
    if (!next) return;
    event.preventDefault();
    tabs[next].focus();
    selectTab(next, true);
  });
  function selectTab(name, load) {
    active = name;
    for (const key of ["report", "timeline"]) {
      tabs[key].setAttribute("aria-selected", String(key === name));
      tabs[key].setAttribute("tabindex", key === name ? "0" : "-1");
    }
    reportPanel.hidden = name !== "report";
    timelinePanel.hidden = name !== "timeline";
    if (load) return refreshActive();
  }
  selectTab(active, false);
  function appKey() { return (window.TIMETRACK_CONFIG || {}).appKey || ""; }
  function canWrite() { return (t.getContext().permissions || {}).board === "write"; }
  const reportRefresh = window.TimeRuntime.coalesce(reloadReport);
  const timelineRefresh = window.TimeRuntime.coalesce(reloadTimeline);
  function refreshActive() {
    const tab = active;
    return (tab === "report" ? reportRefresh() : timelineRefresh()).catch(function (error) {
      if (tab === "report") {
        reportNotice = error.message || "Could not build the report.";
        if (reportView && report) reportView.update(report, reportNotice);
        else reportPanel.textContent = reportNotice;
      } else {
        let status = document.getElementById("timeline-load-error");
        if (!status) { status = h("p", { id: "timeline-load-error", class: "error", role: "alert" }); timelinePanel.prepend(status); }
        status.textContent = (error.message || "Could not load the timeline.") + " Refresh to retry.";
      }
    });
  }
  t.render(refreshActive);

  async function reloadReport() {
    const [rawSettings, loaded] = await Promise.all([t.get("board", "shared", "settings", null), loadReportBoard()]);
    reportSettings = window.TimeDuration.normalizeSettings(rawSettings);
    if (!reportView) {
      reportPanel.textContent = "";
      reportView = window.TimeReportView.mount(reportPanel, {
        today: function () { return new Date(); }, settings: function () { return reportSettings; },
        onChange: renderReport, onExport: exportExcel
      });
    }
    reportCards = loaded.cards;
    reportNotice = loaded.notice;
    needsAuth = loaded.needsAuth;
    paintBanner();
    renderReport();
  }
  function renderReport() {
    if (!reportView) return;
    report = window.TimeAggregate.buildReport(reportCards, Object.assign({}, reportView.filters(), { settings: reportSettings }));
    reportView.update(report, reportNotice);
  }
  function exportExcel() {
    if (!report) return;
    report.labelText = window.TimeAggregate.labelText;
    const workbook = window.TimeExcel.buildWorkbook(report, window.TimeDuration.formatDuration, reportSettings);
    window.TimeDom.download("time-report-" + report.from + "_" + report.to + ".xlsx", workbook);
  }
  function paintBanner() {
    const previous = reportPanel.querySelector(".banner");
    if (previous) previous.remove();
    if (!needsAuth) return;
    const banner = h("div", { class: "banner" }, h("span", null, "Allow board read access to recover unavailable time logs."));
    const allow = h("button", { type: "button", class: "button mod-primary", onclick: function () {
      allow.disabled = true;
      window.TimeRuntime.authorizeReadAccess(t).then(reportRefresh).catch(function (error) {
        reportNotice = error.message || "Could not authorize. Please try again.";
        renderReport();
      }).finally(function () { allow.disabled = false; });
    } }, "Allow");
    banner.appendChild(allow);
    reportPanel.prepend(banner);
  }
  async function loadReportBoard() {
    const [cardList, lists] = await Promise.all([
      t.cards("id", "name", "url", "labels", "idList", "shortLink"), t.lists("id", "name")
    ]);
    const listNames = new Map((lists || []).map(function (list) { return [list.id, list.name]; }));
    const boardTimes = await window.TimeRuntime.loadBoardTimes(t, appKey(), window.TimeModel, cardList);
    const cards = cardList.map(function (card) {
      const state = window.TimeModel.decode(boardTimes.timeById.get(card.id));
      return {
        id: card.id, name: card.name, url: card.url, listName: listNames.get(card.idList) || "",
        labels: (card.labels || []).map(function (label) { return { id: label.id, name: label.name || "", color: label.color || "" }; }),
        entries: state.entries, limitMinutes: state.limitMinutes, hasSubtasks: state.linkedIds.length > 0,
        kids: boardTimes.unreadableIds.has(card.id) ? null : state.linkedIds,
        missing: boardTimes.unreadableIds.has(card.id)
      };
    });
    let notice = "Report includes only visible cards in open lists; archived cards are excluded.";
    if (boardTimes.unreadableIds.size) notice += " Some time logs could not be read; totals may be incomplete. Reload the report to retry.";
    return { cards: cards, notice: notice, needsAuth: false };
  }

  async function reloadTimeline() {
    const [cards, rawSettings, rawCalendar] = await Promise.all([
      t.cards("id", "name", "url", "shortLink", "dueComplete"),
      t.get("board", "shared", "settings", null), t.get("board", "shared", "timeline", null)
    ]);
    const loaded = await window.TimeRuntime.loadBoardTimes(t, appKey(), window.TimeModel, cards);
    calendarSource = JSON.stringify(rawCalendar);
    const previousError = document.getElementById("timeline-load-error");
    if (previousError) previousError.remove();
    if (!timelineView) {
      timelinePanel.textContent = "";
      timelineView = window.TimeTimelineView.mount(timelinePanel, { rootId: t.arg("rootId"), onRefresh: timelineRefresh, onCalendar: saveCalendar });
    }
    timelineView.update({
      cards: cards.map(function (card) { return Object.assign({}, card, window.TimeModel.decode(loaded.timeById.get(card.id)), { missing: loaded.unreadableIds.has(card.id) }); }),
      settings: window.TimeDuration.normalizeSettings(rawSettings), calendar: rawCalendar, canWrite: canWrite()
    });
  }
  async function saveCalendar(value) {
    if (!canWrite()) throw new Error("This board is read-only.");
    if (savingCalendar) throw new Error("Please wait for the current save.");
    savingCalendar = true;
    try {
      const shared = await t.get("board", "shared") || {};
      if (JSON.stringify(shared.timeline == null ? null : shared.timeline) !== calendarSource) throw new Error("Team availability changed in another window. Refresh before saving.");
      const next = window.TimeTimeline.normalizeCalendar(value);
      if (JSON.stringify(Object.assign({}, shared, { timeline: next })).length > window.TimeModel.MAX_PLUGIN_CHARS) throw new Error("Board shared storage is full (4096 characters). Nothing was saved.");
      await t.set("board", "shared", "timeline", next);
      calendarSource = JSON.stringify(next);
    } finally { savingCalendar = false; }
  }
})();
