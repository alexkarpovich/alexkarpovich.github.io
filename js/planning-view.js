(function (root) {
  const h = root.TimeDom.h, clear = root.TimeDom.clear;
  let sequence = 0;
  function calendarEditor(host, options) {
    function changed() { if (options.onChange) options.onChange(); }
    const fieldId = "fte-base-" + (++sequence);
    const base = h("input", { id: fieldId, type: "number", min: "0", max: "100", step: "0.01", required: true, "aria-label": options.label || "Default FTE" });
    const rows = h("div", { class: "fte-periods" });
    const add = h("button", { type: "button", class: "button-link", onclick: function () { addRow({ date: options.start ? options.start() : root.TimeDuration.formatYmd(new Date()), fte: Number(base.value) || 0 }); changed(); } }, "+ add FTE change");
    const caption = h("span", { class: "fte-caption" }, h("label", { for: fieldId }, options.label || "Default team FTE"));
    const heading = h("div", { class: "fte-base" }, [caption, base]);
    if (options.hint) {
      const tipId = "fte-help-" + (++sequence);
      const tip = h("span", { id: tipId, class: "fte-tooltip", role: "tooltip", hidden: true }, options.hint);
      const help = h("button", { type: "button", class: "help-tip", "aria-label": "About " + options.label, "aria-describedby": tipId, "aria-expanded": "false" }, "?");
      function show(visible) { tip.hidden = !visible; help.setAttribute("aria-expanded", String(visible)); }
      help.addEventListener("click", function () { show(tip.hidden); });
      help.addEventListener("mouseenter", function () { show(true); });
      help.addEventListener("mouseleave", function () { if (document.activeElement !== help) show(false); });
      help.addEventListener("focus", function () { show(true); });
      help.addEventListener("blur", function () { show(false); });
      help.addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); show(false); } });
      caption.appendChild(help);
      heading.appendChild(tip);
    }
    const form = h("div", { class: "fte-editor" }, [heading,
      options.hint ? null : h("p", { class: "hint" }, "Each value applies from its date until the next change. 1 FTE = one full workday."), rows, add]);
    host.appendChild(form);
    form.addEventListener("input", changed);
    function addRow(value) {
      const date = h("input", { type: "date", min: "1970-01-01", max: "2999-12-31", required: true, value: value.date, "aria-label": "FTE effective from" });
      const input = h("input", { type: "number", min: "0", max: "100", step: "0.01", required: true, value: value.fte, "aria-label": "FTE from this date" });
      const row = h("div", { class: "fte-period" }, [h("span", { class: "muted" }, "From"), date, input, h("span", { class: "muted" }, "FTE"),
        h("button", { type: "button", class: "button-link", "aria-label": "Remove FTE change", onclick: function () { row.remove(); changed(); } }, "Remove")]);
      rows.appendChild(row);
    }
    return {
      set: function (value) { base.value = value.baseFte == null ? "" : value.baseFte; clear(rows); (value.changes || []).forEach(addRow); },
      read: function () {
        const value = base.value === "" ? null : Number(base.value);
        if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw new Error("FTE must be between 0 and 100.");
        const dates = new Set(), changes = Array.from(rows.children).map(function (row) {
          const inputs = row.querySelectorAll("input"), date = inputs[0].value, fte = Number(inputs[1].value);
          if (!root.TimeTimeline.validDate(date) || inputs[1].value === "" || !Number.isFinite(fte) || fte < 0 || fte > 100) throw new Error("Pick a valid date and FTE between 0 and 100.");
          if (dates.has(date)) throw new Error("Use only one FTE change per date.");
          dates.add(date); return { date: date, fte: fte };
        }).sort(function (a, b) { return a.date.localeCompare(b.date); });
        return { baseFte: value, changes: changes };
      },
      add: function (date, fte) { addRow({ date: date, fte: fte }); changed(); },
      disable: function (disabled) { form.querySelectorAll("input, button").forEach(function (node) { node.disabled = disabled; }); },
      base: base
    };
  }
  function mount(host, handlers, planningHost) {
    const id = "dependency-picker-" + (++sequence);
    let model = null, last = "", lastPlanning = "", lastEstimate = "", token = 0, results = [], active = -1, selected = null, addingDependency = false, editingPlanning = false, savingPlanning = false;
    const list = h("div", { class: "dependency-list" });
    const inherited = h("div", { class: "inherited-dependencies" });
    const error = h("div", { class: "error", role: "alert" });
    const input = h("input", { placeholder: "Card name or Trello URL", "aria-label": "Dependency card name or link", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": id, autocomplete: "off", required: true });
    const suggestions = h("div", { id: id, class: "child-suggestions", role: "listbox", hidden: true });
    function hide() { token++; suggestions.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; }
    function paintDependencyForm() {
      const writable = !!model && model.canWrite !== false;
      form.hidden = !writable || !addingDependency;
      add.hidden = !writable;
      add.setAttribute("aria-expanded", String(addingDependency));
    }
    function close(restoreFocus) {
      addingDependency = false; input.value = ""; selected = null; hide(); error.textContent = ""; paintDependencyForm();
      if (restoreFocus !== false) add.focus();
    }
    function choose(card) { selected = card; input.value = card.name; hide(); input.focus(); }
    const add = h("button", { type: "button", class: "entry-action", "aria-label": "Add dependency", title: "Add dependency", "aria-expanded": "false", "aria-controls": id + "-form", onclick: function () { addingDependency = true; paintDependencyForm(); input.focus(); } });
    add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>';
    const form = h("form", { id: id + "-form", class: "dependency-form link-form", hidden: true }, [h("div", { class: "control-row" }, [h("div", { class: "child-picker" }, [input, suggestions]),
      h("button", { type: "submit", class: "button mod-primary" }, "Add"), h("button", { type: "button", class: "button-link", onclick: close }, "Cancel")])]);
    input.addEventListener("input", async function () {
      selected = null; hide(); error.textContent = "";
      if (!input.value.trim() || /^https?:/i.test(input.value)) return;
      const version = token;
      try {
        const found = await handlers.onCardSearch(input.value.trim(), "dependency");
        if (version !== token) return;
        results = found;
        clear(suggestions);
        results.forEach(function (card, index) { suggestions.appendChild(h("div", { id: id + "-" + index, class: "child-suggestion", role: "option", "aria-selected": "false",
          onmousedown: function (event) { event.preventDefault(); }, onclick: function () { choose(card); } }, [h("span", null, card.name), h("small", { class: "muted" }, card.url || card.id)])); });
        if (!results.length) suggestions.appendChild(h("p", { class: "hint" }, "No matching cards."));
        suggestions.hidden = false; input.setAttribute("aria-expanded", "true");
      } catch (e) { if (version === token) error.textContent = "Could not search cards. Try again."; }
    });
    input.addEventListener("blur", hide);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (!suggestions.hidden && results.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); active = (active + (event.key === "ArrowDown" ? 1 : results.length - 1) + results.length) % results.length;
        suggestions.querySelectorAll('[role="option"]').forEach(function (node, index) { node.setAttribute("aria-selected", String(index === active)); });
        input.setAttribute("aria-activedescendant", id + "-" + active);
      } else if (event.key === "Enter" && active >= 0 && !suggestions.hidden) { event.preventDefault(); choose(results[active]); }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault(); error.textContent = ""; hide(); const cardId = model.cardId;
      handlers.onDependencyAdd(input.value, selected && selected.id).then(function () { if (model.cardId === cardId) close(); }).catch(function (e) { if (model.cardId === cardId) error.textContent = e.message; });
    });
    const planningError = h("div", { class: "error", role: "alert" });
    const estimate = h("input", { id: id + "-estimate", name: "estimate", placeholder: "1w", autocomplete: "off", "aria-label": "ETA", maxlength: "40" });
    const calendarHost = h("div");
    const editor = calendarEditor(calendarHost, { label: "Maximum FTE", hint: "Leave empty to inherit the team's available FTE and parent limits. Set 1 to keep a task on one FTE. A maximum limits the pool; it does not add capacity." });
    editor.base.required = false; editor.base.placeholder = "Inherit";
    const previewValue = h("strong", { class: "planning-preview-value" });
    const editPlanning = h("button", { type: "button", class: "entry-action", "aria-label": "Edit planning", title: "Edit planning", "aria-controls": id + "-planning-form", "aria-expanded": "false", onclick: function () {
      if (!model || model.canWrite === false || model.saving || savingPlanning) return;
      editingPlanning = true;
      planningError.textContent = "";
      paintPlanning();
      estimate.focus();
      estimate.select();
    } });
    editPlanning.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>';
    const preview = h("div", { class: "planning-preview" }, [h("span", { class: "muted" }, "ETA"), previewValue]);
    const cancelPlanning = h("button", { type: "button", class: "button-link", onclick: function () { closePlanning(true); } }, "Cancel");
    const fields = h("form", { id: id + "-planning-form", class: "planning-form", hidden: true }, [h("label", { class: "planning-estimate", for: id + "-estimate" }, ["ETA", estimate]),
      calendarHost,
      h("div", { class: "planning-actions" }, [h("button", { type: "submit", class: "button mod-primary" }, "Save planning"), cancelPlanning]), planningError]);
    function paintPlanning() {
      fields.hidden = !editingPlanning;
      preview.hidden = editingPlanning;
      previewValue.textContent = model && model.limitMinutes != null ? root.TimeDuration.formatDuration(model.limitMinutes, model.settings) : "—";
      previewValue.title = model && model.limitMinutes != null ? "ETA" : "No ETA set";
      editPlanning.hidden = editingPlanning || !model || model.canWrite === false;
      editPlanning.disabled = savingPlanning || !!(model && model.saving);
      editPlanning.setAttribute("aria-expanded", String(editingPlanning));
      fields.querySelectorAll("input, button").forEach(function (node) { node.disabled = savingPlanning || !model || !!model.saving || model.canWrite === false; });
      fields.querySelectorAll(".help-tip").forEach(function (node) { node.disabled = false; });
    }
    function closePlanning(restoreFocus) {
      if (savingPlanning || model && model.saving) return;
      editingPlanning = false;
      planningError.textContent = "";
      const p = model && model.planning || {};
      estimate.value = model && model.limitMinutes != null ? root.TimeDuration.formatDuration(model.limitMinutes, model.settings) : "";
      editor.set({ baseFte: p.maxFte, changes: p.changes });
      fields.querySelectorAll('[role="tooltip"]').forEach(function (node) { node.hidden = true; });
      fields.querySelectorAll(".help-tip").forEach(function (node) { node.setAttribute("aria-expanded", "false"); });
      paintPlanning();
      if (restoreFocus && !editPlanning.hidden) editPlanning.focus();
    }
    fields.addEventListener("keydown", function (event) {
      if (event.target && event.target.classList && event.target.classList.contains("help-tip")) return;
      if (event.key === "Escape") { event.preventDefault(); closePlanning(true); }
    });
    fields.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!model || !editingPlanning || model.canWrite === false || model.saving || savingPlanning) return;
      planningError.textContent = "";
      const savingCard = model.cardId;
      let saved = false;
      try {
        const calendar = editor.read(), raw = estimate.value.trim();
        const parsed = raw ? root.TimeDuration.parseDuration(raw, handlers.settings()) : null;
        if (parsed && !parsed.ok) throw new Error(parsed.error);
        const p = { maxFte: calendar.baseFte, changes: calendar.changes };
        savingPlanning = true;
        paintPlanning();
        await handlers.onPlanning(p, parsed ? parsed.minutes : null);
        saved = true;
      } catch (e) { if (model.cardId === savingCard) planningError.textContent = e.message; }
      finally {
        savingPlanning = false;
        if (saved && model.cardId === savingCard) closePlanning(true);
        else paintPlanning();
      }
    });
    const inspectStatus = h("p", { class: "hint", role: "status" });
    const inspect = h("button", { type: "button", class: "button-link inspect-dependencies", onclick: async function () {
      inspect.disabled = true; inspectStatus.textContent = "Checking parent cards…";
      try { const result = await handlers.onInspectDependencies(); inspectStatus.textContent = result.incomplete ? "Some parent links are unavailable. Open Timeline to inspect them." : result.count ? "Inherited links are edited on their parent card." : "No inherited dependencies."; }
      catch (e) { inspectStatus.textContent = e.message; } finally { inspect.disabled = false; }
    } }, "Check inherited dependencies");
    const heading = h("div", { class: "planning-summary" }, [h("div", { class: "planning-heading-label" }, [h("strong", { id: id + "-planning-title", class: "planning-title" }, "Planning"), editPlanning]), preview]);
    const details = h("section", { class: "planning-details", "aria-labelledby": id + "-planning-title" }, [heading, fields]);
    const timeline = h("button", { type: "button", class: "button-link", onclick: function () { handlers.onTimeline(); } }, "Open timeline ↗");
    (planningHost || host).appendChild(details);
    host.appendChild(h("section", { class: "card-planning" }, [h("div", { class: "planning-heading" }, [h("div", { class: "planning-heading-label" }, [h("strong", null, "Depends on"), add]), timeline]),
      list, inherited, form, error, inspect, inspectStatus]));
    return { update: function (next) {
      const changed = !model || model.cardId !== next.cardId;
      model = next;
      if (changed) { close(false); error.textContent = ""; planningError.textContent = ""; editingPlanning = false; }
      const key = JSON.stringify([next.cardId, next.dependencies, next.inheritedDependencies, next.planning, next.canWrite]);
      if (key !== last) {
        last = key; clear(list); clear(inherited);
        (next.dependencies || []).forEach(function (card) { const row = h("div", { class: "dependency-row" }, [card.url ? h("a", { href: card.url, target: "_blank", rel: "noopener" }, card.name) : h("span", null, card.name),
          card.missing ? h("small", { class: "muted" }, "Unavailable") : null]);
          if (next.canWrite !== false) row.appendChild(h("button", { class: "button-link", type: "button", "aria-label": "Remove dependency", onclick: function () {
            error.textContent = ""; handlers.onDependencyRemove(card.id).catch(function (e) { error.textContent = e.message; });
          } }, "Remove")); list.appendChild(row);
        });
        (next.inheritedDependencies || []).forEach(function (item) { inherited.appendChild(h("p", { class: "hint" }, ["↳ " + item.name + " · inherited from ", item.parentUrl ? h("a", { href: item.parentUrl, target: "_blank", rel: "noopener" }, item.parentName) : item.parentName])); });
      }
      const planningKey = JSON.stringify([next.cardId, next.planning]);
      if (planningKey !== lastPlanning) {
        lastPlanning = planningKey;
        const p = next.planning || {};
        editor.set({ baseFte: p.maxFte, changes: p.changes });
      }
      const estimateKey = JSON.stringify([next.cardId, next.limitMinutes, next.settings]);
      if (estimateKey !== lastEstimate) {
        lastEstimate = estimateKey;
        estimate.value = next.limitMinutes != null ? root.TimeDuration.formatDuration(next.limitMinutes, next.settings) : "";
      }
      if (next.canWrite === false) { addingDependency = false; editingPlanning = false; }
      paintDependencyForm();
      [host, fields].forEach(function (scope) { scope.querySelectorAll("input, button").forEach(function (node) { node.disabled = !!next.saving || next.canWrite === false; }); });
      paintPlanning();
      timeline.disabled = false; inspect.disabled = !!next.saving;
    } };
  }
  root.TimePlanningView = { mount: mount, calendarEditor: calendarEditor };
})(typeof self !== "undefined" ? self : this);
