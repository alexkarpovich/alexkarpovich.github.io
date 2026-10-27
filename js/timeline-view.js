(function (root) {
  const h = root.TimeDom.h, clear = root.TimeDom.clear;
  let tooltipNumber = 0;
  function roundedPath(points) {
    let path = "M" + points[0].join(" ");
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const before = Math.hypot(b[0] - a[0], b[1] - a[1]), after = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (!before || !after) continue;
      const r = Math.min(5, before / 2, after / 2);
      path += " L" + [b[0] + (a[0] - b[0]) * r / before, b[1] + (a[1] - b[1]) * r / before].join(" ") +
        " Q" + b.join(" ") + " " + [b[0] + (c[0] - b[0]) * r / after, b[1] + (c[1] - b[1]) * r / after].join(" ");
    }
    return path + " L" + points[points.length - 1].join(" ");
  }
  function mount(host, handlers) {
    let cards = [], settings = {}, savedCalendar = null, calendar = { baseFte: 1, changes: [] }, selected = "", initialized = false, dirty = false;
    const collapsed = new Set();
    const project = h("select", { "aria-label": "Project" });
    const start = h("input", { type: "date", min: "1970-01-01", max: "2999-12-31", required: true, "aria-label": "Forecast start", value: handlers.start || root.TimeDuration.formatYmd(new Date()) });
    const scale = h("select", { "aria-label": "Timeline scale" }, [h("option", { value: "weeks" }, "Weeks"), h("option", { value: "months" }, "Months")]);
    const summary = h("p", { class: "timeline-summary", role: "status", "aria-live": "polite" });
    const error = h("div", { class: "error", role: "alert" });
    const warnings = h("div", { class: "timeline-warnings" });
    const chart = h("div", { class: "timeline-scroll", tabindex: "0", "aria-label": "Project timeline. Scroll horizontally to see more dates." });
    const tooltip = h("div", { class: "timeline-tooltip", id: "timeline-tooltip-" + (++tooltipNumber), role: "tooltip", hidden: true });
    let activeBar = null, pinned = false, showTimer = null, hideTimer = null;
    function cancelTimers() { root.clearTimeout(showTimer); root.clearTimeout(hideTimer); }
    function closeTooltip() {
      cancelTimers(); tooltip.hidden = true; pinned = false;
      if (activeBar) { activeBar.removeAttribute("aria-describedby"); activeBar.setAttribute("aria-expanded", "false"); }
      activeBar = null;
    }
    function delayClose() {
      root.clearTimeout(showTimer);
      root.clearTimeout(hideTimer);
      if (!pinned && document.activeElement !== activeBar) hideTimer = root.setTimeout(closeTooltip, 150);
    }
    function openTooltip(bar, row, pin, pointerX) {
      cancelTimers();
      if (activeBar && activeBar !== bar) closeTooltip();
      activeBar = bar; pinned = pin;
      const duration = function (value, fallback) { return value != null ? root.TimeDuration.formatDuration(value, settings) : fallback; };
      const over = row.overrun > 0;
      function field(label, value, cls) { return h("div", { class: "timeline-tooltip-field " + cls }, [h("dt", null, label), h("dd", null, value)]); }
      clear(tooltip);
      tooltip.appendChild(h("div", { class: "timeline-tooltip-top" }, [
        h("span", { class: "timeline-tooltip-kind" }, (row.card && (row.card.linkedIds || row.card.kids || []).length) ? "Epic" : "Task"),
        h("span", { class: "timeline-tooltip-status" + (over ? " is-over" : row.status === "Done" ? " is-done" : "") }, over ? "Over ETA" : row.status)
      ]));
      tooltip.appendChild(h("h3", null, row.card ? row.card.name : row.id));
      tooltip.appendChild(h("dl", { class: "timeline-tooltip-dates" }, [field("Start date", row.start || "Not scheduled", "is-start"), field("End date", row.finish || "Not scheduled", "is-finish")]));
      tooltip.appendChild(h("dl", { class: "timeline-tooltip-metrics" }, [
        field("ETA", duration(row.estimate, "Not set"), "is-eta"),
        field("Spent", duration(row.spent, "Unavailable"), "is-spent"),
        field("Over ETA", duration(row.overrun || 0), over ? "is-over" : "is-clear")
      ]));
      tooltip.appendChild(h("p", { class: "timeline-tooltip-hint" }, pinned ? "Click again or press Esc to close" : "Click bar to keep open · Esc to close"));
      tooltip.hidden = false;
      bar.setAttribute("aria-describedby", tooltip.id); bar.setAttribute("aria-expanded", "true");
      const anchor = bar.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
      const x = Number.isFinite(pointerX) ? pointerX : (Math.max(8, anchor.left) + Math.min(root.innerWidth - 8, anchor.right)) / 2;
      const left = Math.max(8, Math.min(x - box.width / 2, root.innerWidth - box.width - 8));
      const top = anchor.bottom + box.height + 12 <= root.innerHeight ? anchor.bottom + 10 : anchor.top - box.height - 10;
      tooltip.style.left = left + "px";
      tooltip.style.top = Math.max(8, Math.min(top, root.innerHeight - box.height - 8)) + "px";
    }
    tooltip.addEventListener("pointerenter", function () { root.clearTimeout(hideTimer); });
    tooltip.addEventListener("pointerleave", delayClose);
    document.addEventListener("pointerdown", function (event) {
      if (!tooltip.contains(event.target) && (!activeBar || !activeBar.contains(event.target))) closeTooltip();
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeTooltip(); });
    root.addEventListener("scroll", function (event) { if (!tooltip.contains(event.target)) closeTooltip(); }, true);
    root.addEventListener("resize", closeTooltip);
    const calendarHost = h("div");
    const editor = root.TimePlanningView.calendarEditor(calendarHost, { start: function () { return start.value; }, onChange: function () { dirty = true; status.textContent = "Unsaved changes"; } });
    const save = h("button", { type: "submit", class: "button mod-primary" }, "Save FTE calendar");
    const status = h("span", { class: "hint", role: "status", "aria-live": "polite" });
    const reset = h("button", { type: "button", class: "button-link", onclick: function () { editor.set(calendar); dirty = false; status.textContent = ""; error.textContent = ""; } }, "Reset");
    const form = h("form", null, [calendarHost, h("div", { class: "fte-actions" }, [save, reset, status])]);
    const details = h("details", { class: "timeline-calendar" }, [h("summary", null, "Team availability · FTE calendar"), form]);
    let writable = false, saving = false;
    const refresh = h("button", { type: "button", class: "button", onclick: async function () {
      refresh.disabled = true; error.textContent = "";
      try { await handlers.onRefresh(); } catch (e) { error.textContent = e.message; } finally { refresh.disabled = false; }
    } }, "Refresh");
    host.appendChild(h("div", { class: "timeline" }, [
      h("div", { class: "timeline-heading" }, [h("div", null, [h("h1", null, "Timeline"), h("p", { class: "hint" }, "Full ETA, overruns and shared team capacity")]), refresh]),
      h("div", { class: "timeline-toolbar" }, [h("label", null, ["Project", project]), h("label", null, ["Forecast from", start]), h("label", null, ["Scale", scale])]),
      details, error, summary, warnings, chart, tooltip,
      h("p", { class: "hint timeline-note" }, "Every available ETA adds work to the timeline, including child estimates under an estimated epic. Bars show the full ETA plus any overrun, without subtracting spent time. Child work has priority over the epic's own ETA. Red segments show time over ETA and shift subsequent work using the same FTE calendar and dependencies. Children without an ETA use a parent's estimate when available. Only visible cards in open lists are included.")
    ]));
    form.addEventListener("submit", async function (event) {
      event.preventDefault(); if (saving || !writable) return;
      error.textContent = ""; status.textContent = "";
      let next;
      try { next = editor.read(); if (next.baseFte == null) throw new Error("Set the default team FTE."); } catch (e) { error.textContent = e.message; return; }
      saving = true; editor.disable(true); save.disabled = true; reset.disabled = true;
      try { await handlers.onCalendar(next); calendar = root.TimeTimeline.normalizeCalendar(next); savedCalendar = JSON.stringify(calendar); dirty = false; status.textContent = "Saved"; }
      catch (e) { error.textContent = e.message || "Could not save the FTE calendar."; }
      finally { saving = false; editor.disable(!writable); save.disabled = !writable; reset.disabled = !writable; render(); }
    });
    [project, start, scale].forEach(function (node) { node.addEventListener("change", function () { selected = project.value; render(); }); });
    function render() {
      if (!initialized) return;
      closeTooltip();
      if (!root.TimeTimeline.validDate(start.value)) { error.textContent = "Pick a valid forecast start date."; summary.textContent = ""; clear(chart); return; }
      if (error.textContent === "Pick a valid forecast start date.") error.textContent = "";
      const allParents = root.TimeTimeline.graph(cards).parents;
      const roots = selected ? [selected] : cards.filter(function (card) { return !allParents.has(card.id); }).map(function (card) { return card.id; });
      // Include cycles even when every card has a parent.
      if (!roots.length && !selected) cards.forEach(function (card) { roots.push(card.id); });
      const plan = root.TimeTimeline.plan(cards, { start: start.value, rootIds: roots, settings: settings, calendar: calendar });
      const total = plan.tasks.reduce(function (sum, task) { return sum + task.total; }, 0);
      const overrun = plan.tasks.reduce(function (sum, task) { return sum + (task.nativeDone ? 0 : task.overrun); }, 0);
      summary.textContent = (plan.finish ? "Forecast finish " + plan.finish : cards.length ? "Forecast incomplete" : "No cards to plan") + " · " + root.TimeDuration.formatDuration(total, settings) + (overrun ? " to schedule (includes " + root.TimeDuration.formatDuration(overrun, settings) + " over ETA)" : " planned") + " · " + plan.tasks.length + " work items";
      clear(warnings);
      plan.warnings.forEach(function (message) { warnings.appendChild(h("p", { class: "hint" }, message)); });
      clear(chart);
      if (!cards.length) { chart.appendChild(h("p", { class: "empty-state" }, "Add cards and remaining estimates to build a timeline.")); return; }
      const px = scale.value === "months" ? 7 : 22, width = plan.days.length * px;
      const surface = h("div", { class: "timeline-surface", style: "--timeline-width:" + width + "px;--day-width:" + px + "px" });
      function line(label, lane, cls) { return h("div", { class: "timeline-line " + (cls || "") }, [h("div", { class: "timeline-label" }, label), lane]); }
      const axis = h("div", { class: "timeline-axis", style: "width:" + width + "px" });
      plan.days.forEach(function (day, index) {
        const date = new Date(day.date + "T12:00:00Z");
        const show = index === 0 || (scale.value === "months" ? date.getUTCDate() === 1 : date.getUTCDay() === (settings.weekStartsOn === 0 ? 0 : 1));
        if (show) axis.appendChild(h("span", { style: "left:" + (index * px) + "px" }, date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })));
      });
      surface.appendChild(line(h("strong", null, "Project / card"), axis, "timeline-axis-row"));
      const maxFte = Math.max(1, ...plan.days.map(function (day) { return day.availableFte; }));
      const availability = h("div", { class: "timeline-capacity", style: "width:" + width + "px" });
      plan.days.forEach(function (day) { availability.appendChild(h("button", { type: "button", class: "fte-day" + (!day.workday ? " is-off" : ""),
        title: day.date + " · " + day.availableFte + " FTE", "aria-label": "Set availability from " + day.date + ", currently " + day.availableFte + " FTE", disabled: !writable || saving,
        onclick: function () { details.open = true; editor.add(day.date, root.TimeTimeline.capacity(calendar, day.date)); calendarHost.querySelector(".fte-period:last-child input").focus(); status.textContent = "Change the value and save to recalculate."; }
      }, h("span", { style: "height:" + Math.max(0, day.availableFte / maxFte * 34) + "px" }))); });
      surface.appendChild(line([h("strong", null, "Team availability"), h("small", { class: "muted" }, maxFte + " FTE max · select a day to change")], availability, "timeline-capacity-row"));
      const displayed = [], seen = new Set();
      function visit(id, depth, path, key) {
        if (path.has(id)) return;
        path = new Set(path); path.add(id); seen.add(id);
        const row = plan.rows.get(id); if (!row) return;
        displayed.push({ row: row, depth: depth, key: key });
        if (!collapsed.has(key)) ((row.card || {}).linkedIds || (row.card || {}).kids || []).forEach(function (child, i) { visit(child, depth + 1, path, key + "/" + i); });
        else { // A collapsed subtree still belongs to this project, not the external dependency section.
          const mark = function (child, visited) { if (visited.has(child)) return; visited.add(child); seen.add(child); const c = plan.graph.byId.get(child); if (c) (c.linkedIds || c.kids || []).forEach(function (kid) { mark(kid, visited); }); };
          mark(id, new Set());
        }
      }
      roots.forEach(function (id, i) { visit(id, 0, new Set(), "root/" + i + "/" + id); });
      const external = Array.from(plan.rows.keys()).filter(function (id) { return !seen.has(id); });
      const externalSet = new Set(external);
      external.filter(function (id) { return !(plan.graph.parents.get(id) || []).some(function (parent) { return externalSet.has(parent); }); }).forEach(function (id) { visit(id, 0, new Set(), "external/" + id); });
      external.forEach(function (id) { if (!seen.has(id)) visit(id, 0, new Set(), "external/" + id); });
      const rowHost = h("div", { class: "timeline-rows" });
      const offdays = h("div", { class: "timeline-offdays", "aria-hidden": "true" });
      plan.days.forEach(function (day, i) { if (!day.workday) offdays.appendChild(h("span", { class: "timeline-offday", style: "left:" + i * px + "px;width:" + px + "px" })); });
      rowHost.appendChild(offdays);
      const barPositions = new Map();
      displayed.forEach(function (item, index) {
        const row = item.row, card = row.card, kids = card && (card.linkedIds || card.kids || []), hasKids = kids && kids.length;
        const barDetails = [card ? card.name : row.id,
          "Start date: " + (row.start || "Not scheduled"),
          "End date: " + (row.finish || "Not scheduled"),
          "ETA: " + (row.estimate != null ? root.TimeDuration.formatDuration(row.estimate, settings) : "Not set"),
          "Spent: " + (row.spent != null ? root.TimeDuration.formatDuration(row.spent, settings) : "Unavailable"),
          "Over ETA: " + root.TimeDuration.formatDuration(row.overrun || 0, settings),
          row.status
        ].join("\n");
        const toggle = h("button", { type: "button", class: "timeline-toggle", "aria-label": (collapsed.has(item.key) ? "Expand " : "Collapse ") + (card ? card.name : row.id), "aria-expanded": hasKids ? String(!collapsed.has(item.key)) : null, "data-row-key": item.key,
          disabled: !hasKids, onclick: function () {
            if (collapsed.has(item.key)) collapsed.delete(item.key); else collapsed.add(item.key);
            render();
            const next = Array.from(chart.querySelectorAll(".timeline-toggle")).find(function (node) { return node.getAttribute("data-row-key") === item.key; });
            if (next) next.focus();
          } }, hasKids ? collapsed.has(item.key) ? "▸" : "▾" : "·");
        const label = h("div", { class: "timeline-card-label", style: "padding-left:" + Math.min(item.depth, 8) * 16 + "px" }, [toggle, h("div", { class: "timeline-card-text" }, [
          card && card.url ? h("a", { href: card.url, target: "_blank", rel: "noopener", title: card.name }, card.name) : h("span", null, card ? card.name : "Unavailable card"),
          !row.start ? h("small", { class: "muted", title: row.status }, row.status) : null
        ])]);
        const lane = h("div", { class: "timeline-lane", style: "width:" + width + "px" });
        if (row.start) {
          const left = (row.startTime != null ? row.startTime : Math.round((Date.parse(row.start) - Date.parse(start.value)) / 86400000)) * px;
          const end = (row.finishTime != null ? row.finishTime : Math.round((Date.parse(row.finish || row.scheduledThrough || row.start) - Date.parse(start.value)) / 86400000) + 1) * px;
          const bar = h("div", { class: "timeline-bar" + (hasKids ? " is-group" : "") + (!row.complete ? " is-partial" : "") + (row.status === "Done" ? " is-done" : "") + (row.overrun ? " is-overrun" : ""),
            style: "left:" + left + "px;width:" + Math.max(3, end - left - 1) + "px", role: "button", tabindex: "0", "aria-label": barDetails, "aria-expanded": "false",
            onpointerenter: function (event) {
              root.clearTimeout(hideTimer);
              if (pinned) return;
              root.clearTimeout(showTimer);
              showTimer = root.setTimeout(function () { openTooltip(bar, row, false, event.clientX); }, 400);
            },
            onpointerleave: delayClose,
            onfocus: function () { if (!pinned) openTooltip(bar, row, false); },
            onblur: delayClose,
            onclick: function (event) { if (activeBar === bar && pinned) closeTooltip(); else openTooltip(bar, row, true, event.clientX); },
            onkeydown: function (event) {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (activeBar === bar && pinned) closeTooltip(); else openTooltip(bar, row, true); }
            }
          }, h("span", null, root.TimeDuration.formatDuration(row.minutes, settings)));
          if (!barPositions.has(row.id)) barPositions.set(row.id, { left: left, right: left + Math.max(3, end - left - 1), y: index * 52 + 26, halfHeight: hasKids ? 6 : 9 });
          if (row.overrunStartTime != null) {
            const overrunLeft = Math.max(0, row.overrunStartTime * px - left);
            const overrunEnd = row.overrunFinishTime != null ? row.overrunFinishTime * px : end;
            bar.appendChild(h("div", { class: "timeline-overrun", style: "left:" + overrunLeft + "px;width:" + Math.max(3, overrunEnd - left - overrunLeft) + "px" }));
          }
          lane.appendChild(bar);
        } else lane.appendChild(h("span", { class: "timeline-blocked" }, row.status));
        rowHost.appendChild(line(label, lane, "timeline-work-row"));
      });
      const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "timeline-dependency-lines"); svg.setAttribute("width", width); svg.setAttribute("height", displayed.length * 52); svg.setAttribute("aria-hidden", "true");
      displayed.forEach(function (item, index) {
        const row = item.row; if (!row.start) return;
        row.dependencies.forEach(function (id) {
          const predecessor = plan.rows.get(id), source = barPositions.get(id), target = barPositions.get(row.id);
          if (!predecessor || !predecessor.finish || !source || !target || source.y === index * 52 + 26) return;
          const x1 = source.right, y1 = source.y, x2 = target.left, y2 = index * 52 + 26, direction = y2 > y1 ? 1 : -1;
          const tip = Math.max(2, x2 - 2), entry = Math.max(1, tip - 10), exit = Math.min(width - 1, x1 + 12);
          // Adjacent dates need a dogleg in the gutter, so the final arrow always
          // approaches the successor from the left instead of doubling back.
          let points = x2 - x1 >= 26 ? [[x1, y1], [(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2], [tip, y2]] :
            [[x1, y1], [exit, y1], [exit, y2 - direction * 26], [entry, y2 - direction * 26], [entry, y2], [tip, y2]];
          let arrowPoints = [[tip - 4, y2 - 3], [tip, y2], [tip - 4, y2 + 3]];
          if (x2 < 6) {
            // A successor on the first day has no room for a left-hand arrow.
            const x = x2 + Math.min(8, (target.right - target.left) / 2), y = y2 - direction * (target.halfHeight + 2);
            points = [[x1, y1], [exit, y1], [exit, y2 - direction * 26], [x, y2 - direction * 26], [x, y]];
            arrowPoints = [[x - 3, y - direction * 4], [x, y], [x + 3, y - direction * 4]];
          }
          const path = document.createElementNS(ns, "path");
          path.setAttribute("d", roundedPath(points));
          path.setAttribute("data-predecessor", id); path.setAttribute("data-successor", row.id);
          svg.appendChild(path);
          const arrow = document.createElementNS(ns, "path");
          arrow.setAttribute("class", "timeline-dependency-arrow");
          arrow.setAttribute("d", "M" + arrowPoints.map(function (point) { return point.join(" "); }).join(" L"));
          svg.appendChild(arrow);
        });
      });
      rowHost.appendChild(svg); surface.appendChild(rowHost);
      const load = h("div", { class: "timeline-load", style: "width:" + width + "px" });
      plan.days.forEach(function (day) { load.appendChild(h("span", { class: "timeline-load-day", title: day.date + " · " + Number(day.usedFte.toFixed(2)) + " / " + day.availableFte + " FTE" },
        h("span", { style: "height:" + day.usedFte / maxFte * 28 + "px" }))); });
      surface.appendChild(line([h("strong", null, "Planned load"), h("small", { class: "muted" }, "Allocated FTE per day")], load, "timeline-load-row"));
      chart.appendChild(surface);
    }
    return { selectRoot: function (id) { project.value = id; selected = project.value; render(); }, update: function (model) {
      cards = model.cards; settings = model.settings; writable = model.canWrite !== false;
      const nextCalendar = root.TimeTimeline.normalizeCalendar(model.calendar), key = JSON.stringify(nextCalendar);
      if (savedCalendar !== key) {
        calendar = nextCalendar; savedCalendar = key;
        if (dirty) { status.textContent = "Availability changed elsewhere. Your draft is preserved; review it before saving."; }
        else editor.set(calendar);
      }
      const value = initialized ? project.value : handlers.rootId || "";
      clear(project); project.appendChild(h("option", { value: "" }, "All projects"));
      cards.forEach(function (card) { project.appendChild(h("option", { value: card.id }, card.name)); });
      project.value = cards.some(function (card) { return card.id === value; }) ? value : "";
      selected = project.value; initialized = true;
      editor.disable(!writable || saving); save.disabled = !writable || saving; reset.disabled = !writable || saving;
      error.textContent = model.error || ""; render();
    } };
  }
  root.TimeTimelineView = { mount: mount };
})(typeof self !== "undefined" ? self : this);
