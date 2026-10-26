(function (root) {
  const h = root.TimeDom.h, clear = root.TimeDom.clear;
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
      h("div", { class: "timeline-heading" }, [h("div", null, [h("h1", null, "Timeline"), h("p", { class: "hint" }, "Remaining work, dependencies and shared team capacity")]), refresh]),
      h("div", { class: "timeline-toolbar" }, [h("label", null, ["Project", project]), h("label", null, ["Forecast from", start]), h("label", null, ["Scale", scale])]),
      details, error, summary, warnings, chart,
      h("p", { class: "hint timeline-note" }, "Every available ETA adds work to the timeline, including child estimates under an estimated epic. Epic dates cover its own work and all child work. Children without an ETA use a parent's estimate when available. Only visible cards in open lists are included.")
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
      if (!root.TimeTimeline.validDate(start.value)) { error.textContent = "Pick a valid forecast start date."; summary.textContent = ""; clear(chart); return; }
      if (error.textContent === "Pick a valid forecast start date.") error.textContent = "";
      const allParents = root.TimeTimeline.graph(cards).parents;
      const roots = selected ? [selected] : cards.filter(function (card) { return !allParents.has(card.id); }).map(function (card) { return card.id; });
      // Include cycles even when every card has a parent.
      if (!roots.length && !selected) cards.forEach(function (card) { roots.push(card.id); });
      const plan = root.TimeTimeline.plan(cards, { start: start.value, rootIds: roots, settings: settings, calendar: calendar });
      const total = plan.tasks.reduce(function (sum, task) { return sum + task.total; }, 0);
      summary.textContent = (plan.finish ? "Forecast finish " + plan.finish : cards.length ? "Forecast incomplete" : "No cards to plan") + " · " + root.TimeDuration.formatDuration(total, settings) + " remaining · " + plan.tasks.length + " work items";
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
      const firstPosition = new Map();
      displayed.forEach(function (item, index) {
        const row = item.row, card = row.card, kids = card && (card.linkedIds || card.kids || []), hasKids = kids && kids.length;
        if (!firstPosition.has(row.id)) firstPosition.set(row.id, index);
        const toggle = h("button", { type: "button", class: "timeline-toggle", "aria-label": (collapsed.has(item.key) ? "Expand " : "Collapse ") + (card ? card.name : row.id), "aria-expanded": hasKids ? String(!collapsed.has(item.key)) : null, "data-row-key": item.key,
          disabled: !hasKids, onclick: function () {
            if (collapsed.has(item.key)) collapsed.delete(item.key); else collapsed.add(item.key);
            render();
            const next = Array.from(chart.querySelectorAll(".timeline-toggle")).find(function (node) { return node.getAttribute("data-row-key") === item.key; });
            if (next) next.focus();
          } }, hasKids ? collapsed.has(item.key) ? "▸" : "▾" : "·");
        const label = h("div", { class: "timeline-card-label", style: "padding-left:" + Math.min(item.depth, 8) * 16 + "px" }, [toggle, h("div", { class: "timeline-card-text" }, [
          card && card.url ? h("a", { href: card.url, target: "_blank", rel: "noopener", title: card.name }, card.name) : h("span", null, card ? card.name : "Unavailable card"),
          h("small", { class: "muted", title: row.status }, row.start && row.finish ? row.start + " → " + row.finish : row.status)
        ])]);
        const lane = h("div", { class: "timeline-lane", style: "width:" + width + "px", title: row.dependencies.length ? "Depends on: " + row.dependencies.map(function (id) { const c = plan.graph.byId.get(id); return c ? c.name : "Unavailable card"; }).join(", ") : "No dependencies" });
        if (row.start) {
          const left = Math.round((Date.parse(row.start) - Date.parse(start.value)) / 86400000) * px;
          const end = Math.round((Date.parse(row.finish || row.scheduledThrough || row.start) - Date.parse(start.value)) / 86400000) * px;
          lane.appendChild(h("div", { class: "timeline-bar" + (hasKids ? " is-group" : "") + (!row.complete ? " is-partial" : "") + (row.status === "Done" ? " is-done" : ""),
            style: "left:" + left + "px;width:" + Math.max(px - 4, end + px - left - 4) + "px", title: (card ? card.name : row.id) + " · " + row.status + " · " + root.TimeDuration.formatDuration(row.minutes, settings)
          }, h("span", null, root.TimeDuration.formatDuration(row.minutes, settings))));
        } else lane.appendChild(h("span", { class: "timeline-blocked" }, row.status));
        rowHost.appendChild(line(label, lane, "timeline-work-row"));
      });
      const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "timeline-dependency-lines"); svg.setAttribute("width", width); svg.setAttribute("height", displayed.length * 52); svg.setAttribute("aria-hidden", "true");
      displayed.forEach(function (item, index) {
        const row = item.row; if (!row.start) return;
        row.dependencies.forEach(function (id) {
          const predecessor = plan.rows.get(id), source = firstPosition.get(id);
          if (!predecessor || !predecessor.finish || source == null || source === index) return;
          const x1 = (Math.round((Date.parse(predecessor.finish) - Date.parse(start.value)) / 86400000) + 1) * px - 3;
          const x2 = Math.round((Date.parse(row.start) - Date.parse(start.value)) / 86400000) * px;
          const y1 = source * 52 + 26, y2 = index * 52 + 26;
          const path = document.createElementNS(ns, "path");
          path.setAttribute("d", "M" + x1 + " " + y1 + " H" + (x1 + 5) + " V" + y2 + " H" + Math.max(0, x2) + " m-4 -3 l4 3 -4 3");
          svg.appendChild(path);
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
