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
    let cards = [], settings = {}, savedCalendar = null, calendar = { baseFte: 1, changes: [] }, selected = "", initialized = false, dirty = false, customStart = !!handlers.start;
    const collapsed = new Set();
    const listId = "timeline-projects-" + (++tooltipNumber);
    const project = h("input", { type: "search", "aria-label": "Project", role: "combobox", "aria-autocomplete": "list", "aria-controls": listId, "aria-expanded": "false", autocomplete: "off", placeholder: "Search projects or cards" });
    const projects = h("div", { id: listId, class: "child-suggestions timeline-project-options", role: "listbox", hidden: true });
    let choices = [], matches = [], active = -1;
    function hideProjects() {
      projects.hidden = true; active = -1;
      project.setAttribute("aria-expanded", "false"); project.removeAttribute("aria-activedescendant");
    }
    function showProjects(query) {
      matches = choices.filter(choice => choice.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      clear(projects); active = -1; project.removeAttribute("aria-activedescendant");
      matches.forEach((choice, index) => projects.appendChild(h("div", {
        id: listId + "-" + index, class: "child-suggestion", role: "option", "aria-selected": "false",
        onmousedown: event => event.preventDefault(), onclick: function () { choose(choice.id); render(); }
      }, choice.name)));
      if (!matches.length) projects.appendChild(h("p", { class: "hint" }, "No matching cards"));
      projects.hidden = false; project.setAttribute("aria-expanded", "true");
    }
    function choose(id) {
      selected = cards.some(card => card.id === id) ? id : "";
      hideProjects();
      project.value = (choices.find(choice => choice.id === selected) || {}).name || "All projects";
    }
    const dateField = h("div", { class: "timeline-date" });
    const start = h("input", { type: "date", min: "1970-01-01", max: "2999-12-31", required: true, "aria-label": "Timeline start", value: handlers.start || root.TimeDuration.formatYmd(new Date()) });
    const scale = h("select", { "aria-label": "Timeline scale" }, [h("option", { value: "weeks" }, "Weeks"), h("option", { value: "months" }, "Months")]);
    const summary = h("p", { class: "timeline-summary", role: "status", "aria-live": "polite" });
    const error = h("div", { class: "error", role: "alert" });
    const warnings = h("div", { class: "timeline-warnings" });
    const chart = h("div", { class: "timeline-scroll", tabindex: "0", "aria-label": "Project timeline fitted to window width." });
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
    function openTooltip(bar, row, pin) {
      cancelTimers();
      if (activeBar === bar && !tooltip.hidden) {
        pinned = pinned || pin;
        return;
      }
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
        field("Remaining", duration(row.minutes), "is-eta"),
        field("Over ETA", duration(row.overrun || 0), over ? "is-over" : "is-clear")
      ]));
      tooltip.appendChild(h("p", { class: "timeline-tooltip-hint" }, "Click to pin · Click again or press Esc to close"));
      // Measure at a neutral position without painting or extending page overflow.
      // A previous popup's coordinates must not affect the new popup's layout.
      tooltip.style.visibility = "hidden";
      tooltip.style.left = "0px";
      tooltip.style.top = "0px";
      tooltip.hidden = false;
      bar.setAttribute("aria-describedby", tooltip.id); bar.setAttribute("aria-expanded", "true");
      const anchor = bar.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
      const x = (Math.max(8, anchor.left) + Math.min(root.innerWidth - 8, anchor.right)) / 2;
      const left = Math.max(8, Math.min(x - box.width / 2, root.innerWidth - box.width - 8));
      const top = anchor.bottom + box.height + 12 <= root.innerHeight ? anchor.bottom + 10 : anchor.top - box.height - 10;
      tooltip.style.left = left + "px";
      tooltip.style.top = Math.max(8, Math.min(top, root.innerHeight - box.height - 8)) + "px";
      tooltip.style.visibility = "visible";
    }
    tooltip.addEventListener("pointerenter", function () { root.clearTimeout(hideTimer); });
    tooltip.addEventListener("pointerleave", delayClose);
    document.addEventListener("pointerdown", function (event) {
      if (!tooltip.contains(event.target) && (!activeBar || !activeBar.contains(event.target))) closeTooltip();
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeTooltip(); });
    root.addEventListener("scroll", function (event) { if (!tooltip.contains(event.target)) closeTooltip(); }, true);
    root.addEventListener("resize", function () { render(); });
    let measuredWidth = 0;
    if (root.ResizeObserver) new root.ResizeObserver(function (entries) {
      const width = entries[0].contentRect.width;
      if (Math.abs(width - measuredWidth) > 1) { measuredWidth = width; render(); }
    }).observe(chart);
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
      h("div", { class: "timeline-heading" }, [h("div", null, [h("h1", null, "Timeline"), h("p", { class: "hint" }, "Actual time, remaining work and team capacity")]), refresh]),
      h("div", { class: "timeline-toolbar" }, [h("div", { class: "timeline-project-field" }, [h("label", null, ["Project", project]), projects]), dateField, h("label", null, ["Scale", scale])]),
      details, error, summary, warnings,
      h("div", { class: "timeline-legend" }, [h("span", { class: "legend-spent" }, "Spent · logged dates"), h("span", { class: "legend-remaining" }, "Remaining · forecast")]), chart, tooltip,

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
    project.addEventListener("change", function () {
      const match = choices.find(choice => choice.name === project.value);
      choose(match ? match.id : project.value ? selected : ""); render();
    });
    project.addEventListener("focus", function () { project.select(); showProjects(""); });
    project.addEventListener("click", function () { if (projects.hidden) showProjects(""); });
    project.addEventListener("input", function () { showProjects(project.value); });
    project.addEventListener("blur", function () { choose(selected); });
    project.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); choose(selected); return; }
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); if (projects.hidden) showProjects("");
        if (!matches.length) return;
        active = (active + (event.key === "ArrowDown" ? 1 : active < 0 ? matches.length : matches.length - 1)) % matches.length;
        Array.from(projects.children).forEach((node, index) => node.setAttribute("aria-selected", String(index === active)));
        const option = projects.children[active];
        project.setAttribute("aria-activedescendant", option.id); option.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && !projects.hidden && active >= 0) {
        event.preventDefault(); choose(matches[active].id); render();
      }
    });
    [start, scale].forEach(function (node) { node.addEventListener("change", function () { if (node === start) customStart = true; render(); }); });
    const autoStart = h("button", { type: "button", class: "button-link", onclick: function () { customStart = false; render(); } }, "From first time entry");
    dateField.appendChild(h("label", null, ["Show from", start]));
    dateField.appendChild(autoStart);
    function render() {
      if (!initialized) return;
      closeTooltip();
      if (!root.TimeTimeline.validDate(start.value)) { error.textContent = "Pick a valid start date."; summary.textContent = ""; clear(chart); return; }
      if (error.textContent === "Pick a valid start date.") error.textContent = "";
      const allParents = root.TimeTimeline.graph(cards).parents;
      const roots = selected ? [selected] : cards.filter(function (card) { return !allParents.has(card.id); }).map(function (card) { return card.id; });
      // Include cycles even when every card has a parent.
      if (!roots.length && !selected) cards.forEach(function (card) { roots.push(card.id); });
      const today = root.TimeDuration.formatYmd(new Date());
      let plan = root.TimeTimeline.plan(cards, { start: customStart ? start.value : today, today: today, rootIds: roots, settings: settings, calendar: calendar });
      if (!customStart) {
        start.value = plan.firstTracked;
        if (start.value !== today) plan = root.TimeTimeline.plan(cards, { start: start.value, today: today, rootIds: roots, settings: settings, calendar: calendar });
      }
      const total = plan.tasks.reduce(function (sum, task) { return sum + task.total; }, 0);
      const overrun = plan.tasks.reduce(function (sum, task) { return sum + (task.nativeDone ? 0 : task.overrun); }, 0);
      summary.textContent = (plan.finish ? "Forecast finish " + plan.finish : cards.length ? "Forecast incomplete" : "No cards to plan") + " · " + root.TimeDuration.formatDuration(total, settings) + (overrun ? " remaining (logged " + root.TimeDuration.formatDuration(overrun, settings) + " over ETA)" : " remaining") + " · " + plan.tasks.length + " work items";
      clear(warnings);
      plan.warnings.forEach(function (message) { warnings.appendChild(h("p", { class: "hint" }, message)); });
      clear(chart);
      if (!cards.length) { chart.appendChild(h("p", { class: "empty-state" }, "Add cards and remaining estimates to build a timeline.")); return; }
      const labelProbe = h("div", { style: "width:var(--label-width);height:0" });
      chart.appendChild(labelProbe);
      const labelWidth = root.getComputedStyle ? labelProbe.getBoundingClientRect().width : 290;
      labelProbe.remove();
      const chartWidth = chart.clientWidth || Math.max(320, root.innerWidth - 64);
      const width = Math.max(1, chartWidth - labelWidth), px = width / plan.days.length;
      const surface = h("div", { class: "timeline-surface", style: "--timeline-width:" + width + "px;--day-width:" + px + "px" });
      function line(label, lane, cls) { return h("div", { class: "timeline-line " + (cls || "") }, [h("div", { class: "timeline-label" }, label), lane]); }
      const axis = h("div", { class: "timeline-axis", style: "width:" + width + "px" });
      let lastTick = -100;
      plan.days.forEach(function (day, index) {
        const date = new Date(day.date + "T12:00:00Z");
        const show = index === 0 || (scale.value === "months" ? date.getUTCDate() === 1 : date.getUTCDay() === (settings.weekStartsOn === 0 ? 0 : 1));
        if (show && index * px - lastTick >= 65) { lastTick = index * px; axis.appendChild(h("span", { style: "left:" + (index * px) + "px" }, date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }))); }
      });
      surface.appendChild(line(h("strong", null, "Project / card"), axis, "timeline-axis-row"));
      const maxFte = Math.max(1, ...plan.days.map(function (day) { return day.availableFte; }));
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
          "Remaining: " + root.TimeDuration.formatDuration(row.minutes, settings),
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
          h("small", { class: "muted", title: row.status }, "ETA " + (row.estimate != null ? root.TimeDuration.formatDuration(row.estimate, settings) : "—") + " · " + root.TimeDuration.formatDuration(row.spent || 0, settings) + " spent · " + root.TimeDuration.formatDuration(row.minutes, settings) + " left" + (!row.complete ? " · " + row.status : ""))
        ])]);
        const lane = h("div", { class: "timeline-lane", style: "width:" + width + "px" });
        if (row.start) {
          const left = Math.max(0, row.startTime * px);
          const segmentEnds = row.spentSegments.concat(row.remainingSegments).map(segment => segment.finish * px);
          const end = Math.min(width, Math.max(left + 1, ...segmentEnds));
          const bar = h("div", { class: "timeline-bar" + (hasKids ? " is-group" : "") + (!row.complete ? " is-partial" : "") + (row.status === "Done" ? " is-done" : "") + (row.overrun ? " is-overrun" : ""),
            style: "left:" + left + "px;width:" + Math.max(1, end - left) + "px", role: "button", tabindex: "0", "aria-label": barDetails, "aria-expanded": "false",
            onpointerenter: function () {
              root.clearTimeout(hideTimer);
              if (pinned) return;
              root.clearTimeout(showTimer);
              showTimer = root.setTimeout(function () { openTooltip(bar, row, false); }, 400);
            },
            onpointerleave: delayClose,
            onfocus: function () { if (!pinned) openTooltip(bar, row, false); },
            onblur: delayClose,
            onclick: function () { if (activeBar === bar && pinned) closeTooltip(); else openTooltip(bar, row, true); },
            onkeydown: function (event) {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (activeBar === bar && pinned) closeTooltip(); else openTooltip(bar, row, true); }
            }
          });
          if (!barPositions.has(row.id)) barPositions.set(row.id, { left: row.remainingSegments.length ? Math.min(...row.remainingSegments.map(part => part.start)) * px : left, right: end, y: index * 52 + 26 });
          function segment(parts, cls) {
            if (!parts.length) return;
            const x = Math.max(left, Math.min(...parts.map(part => part.start)) * px);
            const finish = Math.min(width, Math.max(...parts.map(part => part.finish)) * px);
            if (finish <= x) return;
            bar.appendChild(h("div", { class: cls, style: "left:" + (x - left) + "px;width:" + (finish - x) + "px" }));
          }
          segment(row.spentSegments, "timeline-spent");
          segment(row.remainingSegments, "timeline-remaining");
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
            const x = x2 + Math.min(8, (target.right - target.left) / 2), y = y2 - direction * 11;
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
      plan.days.forEach(function (day) {
        const title = day.date + " · " + Number(day.usedFte.toFixed(2)) + " / " + day.availableFte + " FTE";
        load.appendChild(h("button", { type: "button", class: "timeline-load-day", title: title, "aria-label": "Set availability: " + title, disabled: !writable || saving,
          onclick: function () { details.open = true; editor.add(day.date, root.TimeTimeline.capacity(calendar, day.date)); calendarHost.querySelector(".fte-period:last-child input").focus(); status.textContent = "Change the value and save to recalculate."; }
        }, h("span", { class: "timeline-load-capacity", style: "height:" + day.availableFte / maxFte * 28 + "px" },
          h("span", { style: "height:" + (day.availableFte ? day.usedFte / day.availableFte * 100 : 0) + "%" }))));
      });
      surface.appendChild(line([h("strong", null, "Team capacity / planned load"), h("small", { class: "muted" }, "Available: background · allocated: fill · select to edit")], load, "timeline-load-row"));
      const todayIndex = plan.days.findIndex(function (day) { return day.date === today; });
      if (todayIndex >= 0) surface.appendChild(h("div", { class: "timeline-today", style: "left:calc(var(--label-width) + " + plan.boundary * px + "px)", role: "img", "aria-label": "Today: " + today }, h("span", null, "Today")));
      chart.appendChild(surface);
    }
    return { selectRoot: function (id) { choose(id); render(); }, update: function (model) {
      cards = model.cards; settings = model.settings; writable = model.canWrite !== false;
      const nextCalendar = root.TimeTimeline.normalizeCalendar(model.calendar), key = JSON.stringify(nextCalendar);
      if (savedCalendar !== key) {
        calendar = nextCalendar; savedCalendar = key;
        if (dirty) { status.textContent = "Availability changed elsewhere. Your draft is preserved; review it before saving."; }
        else editor.set(calendar);
      }
      const value = initialized ? selected : handlers.rootId || "";
      const counts = new Map();
      cards.forEach(card => counts.set(card.name, (counts.get(card.name) || 0) + 1));
      choices = [{ id: "", name: "All projects" }].concat(cards.map(card => ({ id: card.id, name: card.name + (counts.get(card.name) > 1 || card.name === "All projects" ? " · " + card.id : "") })));
      choose(value); initialized = true;
      editor.disable(!writable || saving); save.disabled = !writable || saving; reset.disabled = !writable || saving;
      error.textContent = model.error || ""; render();
    } };
  }
  root.TimeTimelineView = { mount: mount };
})(typeof self !== "undefined" ? self : this);
