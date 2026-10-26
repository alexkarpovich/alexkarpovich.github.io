(function () {
  const app = document.getElementById("app");
  if (window.parent === window || !window.TrelloPowerUp) { app.textContent = "Open Timeline from a Trello board or use preview.html for a local demo."; return; }
  const t = window.TimeRuntime.createIframe(window.TIMETRACK_CONFIG, window.TrelloPowerUp);
  if (!t) { app.textContent = "Could not connect to Trello. Reload the board."; return; }
  window.TimeTheme.bind(t);
  let view = null, calendarSource = null, saving = false;
  const refresh = window.TimeRuntime.coalesce(reload);
  function canWrite() { const p = t.getContext().permissions || {}; return p.board === "write"; }
  async function reload() {
    const [cards, rawSettings, rawCalendar] = await Promise.all([t.cards("id", "name", "url", "shortLink", "dueComplete"), t.get("board", "shared", "settings", null), t.get("board", "shared", "timeline", null)]);
    const loaded = await window.TimeRuntime.loadBoardTimes(t, (window.TIMETRACK_CONFIG || {}).appKey || "", window.TimeModel, cards);
    calendarSource = JSON.stringify(rawCalendar);
    const previousError = document.getElementById("timeline-load-error");
    if (previousError) previousError.remove();
    if (!view) {
      app.textContent = "";
      view = window.TimeTimelineView.mount(app, { rootId: t.arg("rootId"), onRefresh: refresh, onCalendar: saveCalendar });
    }
    view.update({ cards: cards.map(function (card) { return Object.assign({}, card, window.TimeModel.decode(loaded.timeById.get(card.id)), { missing: loaded.unreadableIds.has(card.id) }); }),
      settings: window.TimeDuration.normalizeSettings(rawSettings), calendar: rawCalendar, canWrite: canWrite() });
  }
  async function saveCalendar(value) {
    if (!canWrite()) throw new Error("This board is read-only.");
    if (saving) throw new Error("Please wait for the current save.");
    saving = true;
    try {
      const shared = await t.get("board", "shared") || {};
      if (JSON.stringify(shared.timeline == null ? null : shared.timeline) !== calendarSource) throw new Error("Team availability changed in another window. Refresh before saving.");
      const next = window.TimeTimeline.normalizeCalendar(value);
      if (JSON.stringify(Object.assign({}, shared, { timeline: next })).length > window.TimeModel.MAX_PLUGIN_CHARS) throw new Error("Board shared storage is full (4096 characters). Nothing was saved.");
      await t.set("board", "shared", "timeline", next);
      calendarSource = JSON.stringify(next);
    } finally { saving = false; }
  }
  t.render(function () { return refresh().catch(function (error) {
    let status = document.getElementById("timeline-load-error");
    if (!status) { status = window.TimeDom.h("p", { id: "timeline-load-error", class: "error", role: "alert" }); app.prepend(status); }
    status.textContent = (error.message || "Could not load the timeline.") + " Reopen Timeline to retry.";
  }); });
})();
