(function () {
  const app = document.getElementById("app");
  if (window.parent === window || !window.TrelloPowerUp) {
    app.textContent = "Open settings from the Power-Up menu on the board.";
    return;
  }
  const t = window.TimeRuntime.createIframe(window.TIMETRACK_CONFIG, window.TrelloPowerUp);
  if (!t) {
    app.textContent = "Could not connect to Trello. Reload the board.";
    return;
  }
  window.TimeTheme.bind(t);
  const h = window.TimeDom.h;
  const duration = window.TimeDuration;
  let ready = false;
  let saving = false;
  const canWrite = t.getContext().permissions && t.getContext().permissions.board === "write";
  let excludedDates = new Set();
  const today = new Date();
  let month = new Date(today.getFullYear(), today.getMonth(), 1);
  let helpIndex = 0;

  function resize() { Promise.resolve(t.sizeTo("#app")).catch(function () {}); }
  function heading(title, explanation) {
    const id = "settings-help-" + (++helpIndex);
    const tip = h("span", { id: id, class: "settings-tooltip", role: "tooltip", hidden: true }, explanation);
    const help = h("button", { type: "button", class: "help-tip", "aria-label": "About " + title, "aria-describedby": id, "aria-expanded": "false" }, "?");
    function show(visible) { tip.hidden = !visible; help.setAttribute("aria-expanded", String(visible)); }
    help.addEventListener("click", function () { show(true); });
    help.addEventListener("mouseenter", function () { show(true); });
    help.addEventListener("mouseleave", function () { if (document.activeElement !== help) show(false); });
    help.addEventListener("focus", function () { show(true); });
    help.addEventListener("blur", function () { show(false); });
    help.addEventListener("keydown", function (event) { if (event.key === "Escape") show(false); });
    return h("div", { class: "settings-heading" }, [h("h2", null, title), help, tip]);
  }

  const hours = h("input", { type: "number", min: "1", max: "24", step: "1", required: true, id: "hours", "aria-label": "Hours in 1d" });
  const days = h("input", { type: "number", min: "1", max: "7", step: "1", required: true, id: "days", "aria-label": "Workdays in 1w" });
  const monthDays = h("input", { type: "number", min: "1", max: "31", step: "1", required: true, id: "month-days", "aria-label": "Workdays in 1M" });
  const week = h("select", { id: "week" }, [h("option", { value: "1" }, "Monday"), h("option", { value: "0" }, "Sunday")]);
  function unitRow(symbol, name, input, unit) {
    return h("label", { class: "settings-unit", for: input.id }, [
      h("span", { class: "settings-unit-name" }, [h("strong", null, symbol), h("span", null, name)]),
      h("span", { class: "settings-unit-value" }, [h("span", { "aria-hidden": true }, "="), input, h("span", null, unit)])
    ]);
  }
  const unitSummary = h("p", { class: "settings-summary", "aria-live": "polite" });
  function paintUnits() {
    const value = duration.normalizeSettings({ hoursPerDay: hours.value, daysPerWeek: days.value, daysPerMonth: monthDays.value });
    unitSummary.textContent = "1w = " + value.hoursPerDay * value.daysPerWeek + "h · 1M = " + value.hoursPerDay * value.daysPerMonth + "h";
  }
  [hours, days, monthDays].forEach(function (input) { input.addEventListener("input", paintUnits); });

  const monthLabel = h("strong", { id: "calendar-month", "aria-live": "polite" });
  const calendarDays = h("div", { class: "settings-calendar-days", role: "group", "aria-labelledby": "calendar-month" });
  const weekdays = h("div", { class: "settings-weekdays", "aria-hidden": true });
  const dateCount = h("span", { class: "settings-date-count", role: "status" });
  const dateList = h("div", { class: "settings-date-list" });
  const selectedSummary = h("summary", null, dateCount);
  const selectedDetails = h("details", { class: "settings-selected" }, [selectedSummary, dateList]);
  selectedDetails.addEventListener("toggle", resize);
  const clearDates = h("button", { type: "button", class: "button-link", onclick: function () {
    if (!ready || !canWrite || saving) return;
    saveStatus.textContent = "";
    excludedDates.clear();
    paintCalendar();
  } }, "Clear all");
  function toggleDate(ymd) {
    if (!ready || !canWrite || saving) return;
    saveStatus.textContent = "";
    if (excludedDates.has(ymd)) excludedDates.delete(ymd);
    else excludedDates.add(ymd);
    paintCalendar(ymd);
  }
  function paintCalendar(focusDate) {
    monthLabel.textContent = month.toLocaleDateString("en", { month: "long", year: "numeric" });
    window.TimeDom.clear(weekdays);
    const start = Number(week.value);
    const names = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    for (let i = 0; i < 7; i++) weekdays.appendChild(h("span", null, names[(start + i) % 7]));
    window.TimeDom.clear(calendarDays);
    const offset = (month.getDay() - start + 7) % 7;
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let i = 0; i < 42; i++) {
      const day = i - offset + 1;
      if (day < 1 || day > total) { calendarDays.appendChild(h("span")); continue; }
      const date = new Date(month.getFullYear(), month.getMonth(), day);
      const ymd = duration.formatYmd(date);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const selected = excludedDates.has(ymd);
      const dayButton = h("button", {
        type: "button", class: "settings-day" + (weekend ? " is-weekend" : "") + (selected ? " is-selected" : ""),
        disabled: !ready || !canWrite || saving,
        "aria-label": date.toLocaleDateString("en", { dateStyle: "full" }) + (weekend ? ", weekend" : ""),
        "aria-pressed": String(selected), "aria-current": ymd === duration.formatYmd(today) ? "date" : null,
        onclick: function () { toggleDate(ymd); }
      }, String(day));
      calendarDays.appendChild(dayButton);
      if (focusDate === ymd) dayButton.focus();
    }
    dateCount.textContent = excludedDates.size + " selected date" + (excludedDates.size === 1 ? "" : "s");
    clearDates.hidden = !excludedDates.size;
    clearDates.disabled = !ready || !canWrite || saving;
    window.TimeDom.clear(dateList);
    Array.from(excludedDates).sort().forEach(function (ymd) {
      dateList.appendChild(h("button", {
        type: "button", class: "settings-date-chip", disabled: !ready || !canWrite || saving,
        "aria-label": "Remove " + ymd, onclick: function () { toggleDate(ymd); selectedSummary.focus(); }
      }, [duration.parseYmd(ymd).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }), h("span", { "aria-hidden": true }, "×")]));
    });
  }
  function changeMonth(delta) { month = new Date(month.getFullYear(), month.getMonth() + delta, 1); paintCalendar(); }
  week.addEventListener("change", paintCalendar);
  const error = h("div", { class: "error", role: "alert" });
  const saveStatus = h("div", { class: "status", role: "status" });
  const button = h("button", { type: "submit", class: "button mod-primary settings-save" }, "Save settings");
  const form = h("form", { class: "settings" }, [
    h("section", { class: "settings-section" }, [
      heading("Time units", "Applies to entries, estimates and reports. 1M = workdays; m = minutes. Saved minutes stay unchanged."),
      unitRow("1d", "Day", hours, "hours"), unitRow("1w", "Week", days, "workdays"), unitRow("1M", "Month", monthDays, "workdays"), unitSummary
    ]),
    h("section", { class: "settings-section" }, [
      heading("Non-working days", "Click dates to toggle days off, across any months. Epic finish estimates skip selected dates and all Saturdays and Sundays."),
      h("label", { class: "settings-week-start", for: "week" }, ["Week starts on", week]),
      h("div", { class: "settings-calendar" }, [
        h("div", { class: "settings-calendar-nav" }, [
          h("button", { type: "button", class: "button", "aria-label": "Previous month", onclick: function () { changeMonth(-1); } }, "‹"),
          monthLabel,
          h("button", { type: "button", class: "button", "aria-label": "Next month", onclick: function () { changeMonth(1); } }, "›")
        ]), weekdays, calendarDays,
        h("div", { class: "settings-calendar-legend" }, [h("span", { class: "legend-weekend" }, "Weekend"), h("span", { class: "legend-selected" }, "Selected")])
      ]),
      h("div", { class: "settings-date-actions" }, [selectedDetails, clearDates])
    ]),
    h("div", { class: "settings-footer" }, [error, saveStatus, button])
  ]);

  function lockForm() {
    [hours, days, monthDays, week, button].forEach(function (control) { control.disabled = !ready || !canWrite || saving; });
    button.textContent = saving ? "Saving…" : "Save settings";
    paintCalendar();
  }
  lockForm();
  if (!canWrite) error.textContent = "This board is read-only.";
  app.textContent = "";
  app.appendChild(form);

  if (window.TIMETRACK_CONFIG && window.TIMETRACK_CONFIG.appKey) {
    const authStatus = h("span", { class: "settings-auth-status", role: "status" }, "Checking…");
    const connect = h("button", { type: "button", class: "button", hidden: true }, "Connect");
    const disconnect = h("button", { type: "button", class: "button-link", hidden: true }, "Disconnect");
    async function paintAuth() {
      const ok = await window.TimeRuntime.isReadAuthorized(t);
      connect.hidden = ok;
      disconnect.hidden = !ok;
      authStatus.textContent = ok ? "Connected" : "Not connected";
      resize();
    }
    connect.addEventListener("click", async function () {
      connect.disabled = true;
      try { await window.TimeRuntime.authorizeReadAccess(t); await paintAuth(); }
      catch (err) { authStatus.textContent = err.message || "Could not authorize."; }
      finally { connect.disabled = false; resize(); }
    });
    disconnect.addEventListener("click", async function () {
      disconnect.disabled = true;
      try {
        const api = await window.TimeRuntime.restApi(t);
        await window.TimeRuntime.asPromise(api.clearToken());
        await paintAuth();
      } catch (err) { authStatus.textContent = err.message || "Could not disconnect."; }
      finally { disconnect.disabled = false; resize(); }
    });
    app.appendChild(h("section", { class: "settings-section settings-auth" }, [
      heading("Read access", "Optional access to recover unavailable logs. Connect opens Trello consent. Disconnect forgets the token; revoke it in Trello account settings → Applications."),
      h("div", { class: "settings-auth-actions" }, [authStatus, connect, disconnect])
    ]));
    paintAuth().catch(function () { authStatus.textContent = "Could not check access."; resize(); });
  }

  form.addEventListener("input", function () { saveStatus.textContent = ""; });
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!ready || !canWrite || saving || !form.reportValidity()) return;
    const next = duration.normalizeSettings({
      hoursPerDay: hours.value, daysPerWeek: days.value, daysPerMonth: monthDays.value,
      weekStartsOn: week.value, excludedDates: Array.from(excludedDates)
    });
    saving = true;
    error.textContent = "";
    saveStatus.textContent = "";
    let timer;
    let saved = false;
    try {
      lockForm();
      // A missing SDK reply must not leave this iframe locked indefinitely.
      await Promise.race([
        Promise.resolve().then(function () { return t.set("board", "shared", "settings", next); }),
        new Promise(function (_, reject) {
          timer = setTimeout(function () {
            reject(new Error("Trello did not confirm saving. Reopen settings to check before retrying."));
          }, 15000);
        })
      ]);
      saved = true;
      saveStatus.textContent = "Settings saved.";
    } catch (err) {
      error.textContent = err && err.message || "Could not save settings.";
    } finally {
      clearTimeout(timer);
      saving = false;
      lockForm();
      resize();
    }
    // Closing is best-effort UI cleanup, not part of the write transaction.
    // Settings can also be shown in a modal where closePopup is a no-op.
    if (saved) Promise.resolve().then(function () { return t.closePopup(); }).catch(function () {});
  });

  t.render(function () {
    if (ready) return;
    return t.get("board", "shared", "settings", null).then(function (raw) {
      const settings = duration.normalizeSettings(raw);
      hours.value = String(settings.hoursPerDay);
      days.value = String(settings.daysPerWeek);
      monthDays.value = String(settings.daysPerMonth);
      week.value = String(settings.weekStartsOn);
      excludedDates = new Set(settings.excludedDates);
      ready = true;
      lockForm();
      paintUnits();
      resize();
    }).catch(function (err) { error.textContent = err.message || "Could not load settings."; resize(); });
  });
})();
