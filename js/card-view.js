(function (root) {
  const h = root.TimeDom.h;
  const clear = root.TimeDom.clear;
  const format = root.TimeDuration.formatDuration;

  const sortEntries = root.TimeModel.sortEntries;

  function entryAction(label, iconPath, danger, disabled, onClick) {
    const button = h("button", {
      type: "button",
      class: "entry-action" + (danger ? " danger" : ""),
      "aria-label": label,
      title: label,
      disabled: disabled,
      onclick: onClick
    });
    // Only the fixed icon paths below are inserted as markup.
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + iconPath + "</svg>";
    return button;
  }

  function helpTip(text) {
    return h("span", { class: "help-tip", tabindex: "0", role: "img", "aria-label": text, title: text }, "?");
  }

  function mountCardView(rootNode, handlers) {
    let editingLimit = false;
    let latestModel = null;
    let lastPresentation = "";
    let lastEntries = "";
    let lastEpic = "";
    let addingChild = false;
    let draggedId = "";
    const duration = h("input", {
      class: "field-time",
      name: "duration",
      placeholder: "Time",
      autocomplete: "off",
      "aria-label": "Time",
      maxlength: "40"
    });
    const note = h("input", {
      class: "field-comment",
      name: "note",
      placeholder: "Comment",
      maxlength: "140",
      "aria-label": "Comment"
    });
    const addButton = h("button", {
      type: "submit",
      class: "button add-submit",
      "aria-label": "Add time"
    });
    addButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    const formError = h("div", { class: "error", role: "alert" });
    const addHint = h("p", { class: "hint add-hint" }, "");
    const total = h("div", { class: "total" });
    const list = h("div", { class: "entry-list" });
    const storage = h("div", { class: "hint" });
    const debugHost = h("pre", { class: "epic-debug hint", hidden: true });
    const editHost = h("div", { class: "edit-panel", hidden: "hidden" });

    const limitInput = h("input", {
      id: "epic-limit",
      name: "limit",
      placeholder: "1w",
      autocomplete: "off",
      "aria-label": "Epic time limit",
      maxlength: "40"
    });
    const limitButton = h("button", { type: "submit", class: "button mod-primary" }, "Save limit");
    const clearLimit = h("button", { type: "button", class: "button-link" }, "Clear");
    const cancelLimit = h("button", { type: "button", class: "button-link", onclick: function () {
      editingLimit = false;
      limitError.textContent = "";
      paintLimit(latestModel);
    } }, "Cancel");
    const limitError = h("div", { class: "error", role: "alert" });
    const limitValue = h("strong");
    const editLimit = entryAction("Edit epic limit",
      '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
      false, false, function () {
        editingLimit = true;
        limitError.textContent = "";
        limitInput.value = format(latestModel.limitMinutes, latestModel.settings);
        paintLimit(latestModel);
        limitInput.focus();
        limitInput.select();
      });
    const limitSummary = h("div", { class: "limit-summary", hidden: true }, [h("span", { class: "muted" }, "Limit"), limitValue, editLimit]);
    const epicBody = h("div", { class: "epic-body" });
    const linkInput = h("input", {
      id: "epic-card-link", name: "card-link", type: "url", placeholder: "https://trello.com/c/…",
      "aria-label": "Child card link", autocomplete: "off", required: true
    });
    const linkButton = h("button", { type: "submit", class: "button" }, "Add");
    const linkError = h("div", { class: "error", role: "alert" });
    const addChild = h("button", { type: "button", class: "button-link add-child", "aria-expanded": "false", "aria-controls": "child-card-form", onclick: function () {
      addingChild = true;
      paintLinkForm();
      linkInput.focus();
    } }, "Add child card");
    function closeLinkForm() {
      addingChild = false;
      linkInput.value = "";
      linkError.textContent = "";
      paintLinkForm();
      addChild.focus();
    }
    const cancelChild = h("button", { type: "button", class: "button-link", onclick: closeLinkForm }, "Cancel");
    const linkForm = h("form", { id: "child-card-form", class: "link-form", hidden: true }, [
      h("label", { for: "epic-card-link", class: "muted" }, "Child cards"),
      h("div", { class: "control-row" }, [linkInput, linkButton, cancelChild])
    ]);
    function paintLinkForm() {
      const writable = latestModel && latestModel.canWrite !== false;
      addChild.hidden = !writable || addingChild;
      addChild.disabled = !!(latestModel && latestModel.saving);
      addChild.setAttribute("aria-expanded", String(addingChild));
      linkForm.hidden = !writable || !addingChild;
    }
    linkInput.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !latestModel.saving) { event.preventDefault(); closeLinkForm(); }
    });
    linkForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const savingCard = latestModel.cardId;
      linkError.textContent = "";
      handlers.onLinkAdd(linkInput.value).then(function () {
        if (latestModel.cardId === savingCard) closeLinkForm();
      }).catch(function (error) {
        if (latestModel.cardId === savingCard) linkError.textContent = error.message || "Could not add child card.";
      });
    });

    const form = h("form", { class: "log-form" }, [
      h("div", { class: "log-form-inline" }, [duration, note, addButton]),
      formError
    ]);
    const logPanel = h("div", { class: "log-panel", id: "card-log-panel" }, [form, addHint, editHost, total, list]);
    const logToggle = h("button", {
      type: "button", class: "log-toggle", "aria-controls": "card-log-panel", "aria-expanded": "true",
      "aria-label": "Hide time entries", title: "Hide time entries",
      onclick: function () { setLogOpen(logPanel.hidden); }
    });
    logToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 15 6-6 6 6"/></svg>';
    let epicMode = false;

    function setLogOpen(open) {
      logPanel.hidden = !open;
      logToggle.setAttribute("aria-expanded", String(open));
      const label = open ? "Hide time entries" : "Show time entries";
      logToggle.setAttribute("aria-label", label);
      logToggle.title = label;
    }

    const limitForm = h("form", { class: "limit-form" }, [
      h("label", { for: "epic-limit", class: "muted" }, "Limit"),
      h("div", { class: "control-row" }, [limitInput, limitButton, clearLimit, cancelLimit]),
      limitError
    ]);
    const epicHelp = helpTip("Add links to child cards on this board. The Power-Up stores this list and sums time from child cards, including nested epics. Time on this epic card is excluded.");
    const epicSection = h("section", { class: "epic", hidden: true }, [
      h("div", { class: "epic-header" }, [
        h("h2", { class: "epic-heading" }, ["Epic summary", epicHelp]),
        h("div", { class: "epic-divider" }, logToggle)
      ]),
      limitSummary,
      limitForm,
      epicBody,
      addChild,
      linkForm,
      linkError
    ]);

    rootNode.appendChild(h("div", { class: "card-time", id: "app-inner" }, [
      logPanel,
      storage,
      debugHost,
      epicSection
    ]));

    let editingId = null;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const parsed = root.TimeDuration.parseDuration(duration.value, handlers.settings());
      if (!parsed.ok) {
        formError.textContent = parsed.error;
        return;
      }
      formError.textContent = "";
      handlers.onAdd({
        minutes: parsed.minutes,
        ymd: root.TimeDuration.ymdNumber(root.TimeDuration.formatYmd(handlers.today ? handlers.today() : new Date())),
        note: note.value.trim()
      }).then(function () {
        duration.value = "";
        note.value = "";
        if (!logPanel.hidden && !form.hidden) duration.focus();
      }).catch(function (error) {
        setLogOpen(true);
        formError.textContent = error.message || "Could not save entry.";
      });
    });

    limitForm.addEventListener("submit", function (event) {
      event.preventDefault();
      saveLimit(limitInput.value);
    });
    clearLimit.addEventListener("click", function () {
      limitInput.value = "";
      saveLimit("");
    });

    function saveLimit(raw) {
      if (!String(raw || "").trim()) {
        limitError.textContent = "";
        persistLimit(null);
        return;
      }
      const parsed = root.TimeDuration.parseDuration(raw, handlers.settings());
      if (!parsed.ok) {
        limitError.textContent = parsed.error;
        return;
      }
      limitError.textContent = "";
      persistLimit(parsed.minutes);
    }

    function persistLimit(minutes) {
      handlers.onLimit(minutes).then(function () {
        editingLimit = false;
        paintLimit(latestModel);
      }).catch(showLimitError);
    }

    function paintLimit(model) {
      if (!model) return;
      const hasLimit = model.limitMinutes != null;
      const canWrite = model.canWrite !== false;
      limitForm.hidden = !canWrite || (hasLimit && !editingLimit);
      limitSummary.hidden = !hasLimit || editingLimit;
      limitValue.textContent = hasLimit ? format(model.limitMinutes, model.settings) : "";
      editLimit.hidden = !canWrite;
      editLimit.disabled = !!model.saving || !canWrite;
      cancelLimit.hidden = !hasLimit;
      cancelLimit.disabled = !!model.saving;
      clearLimit.hidden = !hasLimit;
    }

    function showLimitError(error) {
      limitError.textContent = error.message || "Could not save limit.";
    }

    function closeEdit() {
      editingId = null;
      editHost.hidden = true;
      clear(editHost);
    }

    function openEdit(entry, settings) {
      editingId = entry.id;
      clear(editHost);
      const editDuration = h("input", {
        class: "field-time",
        name: "edit-duration",
        value: format(entry.minutes, settings),
        "aria-label": "Time",
        maxlength: "40"
      });
      const editDate = h("input", { type: "date", min: "1970-01-01", max: "2999-12-31", required: true, name: "edit-date", "aria-label": "Date" });
      editDate.value = root.TimeDuration.ymdString(entry.ymd);
      const editNote = h("input", {
        class: "field-comment grow",
        name: "edit-note",
        value: entry.note || "",
        placeholder: "Comment",
        maxlength: "140",
        "aria-label": "Comment"
      });
      const editError = h("div", { class: "error", role: "alert" });
      const saveBtn = h("button", { type: "submit", class: "button mod-primary" }, "Save");
      const cancelBtn = h("button", {
        type: "button",
        class: "button-link",
        onclick: closeEdit
      }, "Cancel");

      const editForm = h("form", { class: "edit-form" }, [
        h("h3", null, "Edit entry"),
        h("p", { class: "hint" }, "Author: " + entry.memberName),
        h("div", { class: "control-row" }, [editDuration, editDate]),
        h("div", { class: "control-row" }, [editNote, saveBtn, cancelBtn]),
        editError
      ]);

      editForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const parsed = root.TimeDuration.parseDuration(editDuration.value, settings);
        if (!parsed.ok) {
          editError.textContent = parsed.error;
          return;
        }
        if (!editDate.value) {
          editError.textContent = "Pick a date.";
          return;
        }
        editError.textContent = "";
        handlers.onUpdate({
          id: entry.id,
          minutes: parsed.minutes,
          ymd: root.TimeDuration.ymdNumber(editDate.value),
          note: editNote.value.trim(),
          createdAt: entry.createdAt
        }).then(closeEdit).catch(function (error) {
          editError.textContent = error.message || "Could not save.";
        });
      });

      editHost.appendChild(editForm);
      editHost.hidden = false;
      editDuration.focus();
    }

    let cardId = "";

    function update(model) {
      latestModel = model;
      const childValues = model.children.map(function (child) { return [child.id, child.name, child.url, child.minutes, child.missing]; });
      const presentation = JSON.stringify([model.cardId, model.settings, model.currentMemberId, model.canWrite, model.canAdd,
        model.entries, model.limitMinutes, childValues,
        model.kidsKnown, !!model.childrenLoading, model.estimatedFinish, model.warning, model.error, model.limitError, !!model.saving,
        model.storageRatio, model.debugEpic]);
      if (presentation === lastPresentation) return false;
      lastPresentation = presentation;
      const settings = model.settings;
      const cardChanged = model.cardId !== cardId;
      if (cardChanged) {
        linkError.textContent = "";
        linkInput.value = "";
        addingChild = false;
        draggedId = "";
        editingLimit = false;
        cardId = model.cardId;
        duration.value = "";
        note.value = "";
        formError.textContent = "";
        limitError.textContent = "";
        closeEdit();
      }
      const showEpic = !!(model.children.length || model.limitMinutes != null);
      if (cardChanged || showEpic !== epicMode) setLogOpen(!showEpic);
      epicMode = showEpic;

      const canWrite = model.canWrite !== false;
      const canAdd = model.canAdd !== false;
      form.hidden = !canAdd;
      addHint.hidden = canAdd;
      addHint.textContent = canWrite ? "Sign in to Trello to log time." : "This board is read-only.";

      duration.disabled = !!model.saving || !canAdd;
      note.disabled = !!model.saving || !canAdd;
      addButton.disabled = !!model.saving || !canAdd;
      limitInput.disabled = !!model.saving || !canWrite;
      editHost.querySelectorAll("input, button").forEach(function (node) { node.disabled = !!model.saving || !canWrite; });
      limitButton.disabled = !!model.saving || !canWrite;
      clearLimit.disabled = !!model.saving || !canWrite;
      if (!canWrite) addingChild = false;
      paintLinkForm();
      cancelChild.disabled = !!model.saving;
      linkInput.disabled = !!model.saving || !canWrite;
      linkButton.disabled = !!model.saving || !canWrite;
      paintLimit(model);

      if (model.error) {
        formError.textContent = model.error;
        setLogOpen(true);
      }
      if (model.limitError) limitError.textContent = model.limitError;

      const entriesKey = JSON.stringify([model.cardId, model.entries, settings, model.currentMemberId, canWrite]);
      if (entriesKey !== lastEntries) {
        lastEntries = entriesKey;
        clear(total);
        const own = model.entries.reduce(function (sum, entry) { return sum + entry.minutes; }, 0);
        total.appendChild(h("span", { class: "muted" }, "On card"));
        total.appendChild(h("strong", null, format(own, settings)));

        clear(list);
        const sorted = sortEntries(model.entries);
        if (!sorted.length) {
          list.appendChild(h("p", { class: "empty-state" }, "No entries yet."));
        } else {
          sorted.forEach(function (entry) {
            const mine = entry.memberId === model.currentMemberId;
            const actions = h("div", { class: "entry-actions" });
            if (mine && canWrite) {
              actions.appendChild(entryAction("Edit entry",
                '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
                false, !!model.saving, function () { openEdit(entry, settings); }));
              actions.appendChild(entryAction("Delete entry",
                '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
                true, !!model.saving, function () {
                  handlers.onDelete(entry.id).catch(function (error) { formError.textContent = error.message || "Could not delete entry."; });
                }));
            }
            list.appendChild(h("div", { class: "entry" }, [
              h("div", { class: "entry-heading" }, [
                h("div", { class: "entry-main" }, [
                  h("strong", null, format(entry.minutes, settings)),
                  h("span", null, root.TimeDuration.ymdString(entry.ymd)),
                  h("span", { class: "author", title: entry.memberName }, entry.memberName)
                ]),
                mine && canWrite ? actions : null
              ]),
              entry.note ? h("div", { class: "note" }, entry.note) : null
            ]));
          });
        }

      }
      list.querySelectorAll("button").forEach(function (button) { button.disabled = !!model.saving || !canWrite; });

      if (editingId && !model.entries.some(function (e) { return e.id === editingId; })) {
        closeEdit();
      }

      storage.textContent = model.warning || (model.storageRatio > 0.75
        ? "Card storage is " + Math.round(model.storageRatio * 100) + "% full (Trello limit is 4096 characters per shared scope)."
        : "");
      if (model.debugEpic) {
        debugHost.hidden = false;
        debugHost.textContent = JSON.stringify(model.debugEpic, null, 2);
      } else {
        debugHost.hidden = true;
        debugHost.textContent = "";
      }

      if (!editingLimit && !limitInput.matches(":focus")) {
        limitInput.value = model.limitMinutes ? format(model.limitMinutes, settings) : "";
      }
      epicSection.hidden = false;
      const epicKey = JSON.stringify([model.cardId, settings, model.limitMinutes, model.kidsKnown, !!model.childrenLoading,
        model.estimatedFinish, canWrite, childValues]);
      if (epicKey !== lastEpic) {
        lastEpic = epicKey;
        const childList = epicBody.querySelector(".child-list");
        const scroll = childList ? childList.scrollTop : 0;
        endDrag();
        paintEpic(model, settings);
        const nextList = epicBody.querySelector(".child-list");
        if (nextList) nextList.scrollTop = scroll;
      }
      epicBody.querySelectorAll("button").forEach(function (button) {
        button.disabled = !!model.saving || !canWrite;
        if (button.classList.contains("drag-handle")) button.draggable = !button.disabled;
      });
      return true;
    }

    function clearDropTargets() {
      epicBody.querySelectorAll(".drop-before, .drop-after").forEach(function (row) { row.classList.remove("drop-before", "drop-after"); });
    }

    function endDrag() {
      draggedId = "";
      clearDropTargets();
      epicBody.querySelectorAll(".is-dragging").forEach(function (row) { row.classList.remove("is-dragging"); });
    }

    function reorderChildren(ids, focusId) {
      const savingCard = latestModel.cardId;
      linkError.textContent = "";
      handlers.onLinkReorder(ids).then(function () {
        if (latestModel.cardId !== savingCard) return;
        const row = Array.from(epicBody.querySelectorAll(".child")).find(function (item) { return item.dataset.childId === focusId; });
        if (row) row.querySelector(".drag-handle").focus();
      }).catch(function (error) {
        if (latestModel.cardId === savingCard) linkError.textContent = error.message || "Could not reorder child cards.";
      });
    }

    function paintEpic(model, settings) {
      clear(epicBody);
      if (model.childrenLoading) {
        epicBody.appendChild(h("p", { class: "hint", role: "status" }, "Loading child cards…"));
        return;
      }
      if (model.children.length && !model.kidsKnown) {
        epicBody.appendChild(h("p", { class: "hint" }, "Some child cards or time logs are unavailable. Totals are incomplete. Keep child cards on this board in open lists."));
      } else if (model.children.length) {
        const spent = model.children.reduce(function (sum, child) { return sum + child.minutes; }, 0);
        if (model.limitMinutes != null) {
          const left = model.limitMinutes - spent;
          const over = left < 0;
          const scale = Math.max(spent, model.limitMinutes);
          const filled = Math.min(spent, model.limitMinutes) / scale * 100;
          const label = over ? "Over by " + format(-left, settings) : format(left, settings) + " left";
          epicBody.appendChild(h("div", {
            class: "epic-progress" + (over ? " is-over" : ""), role: "progressbar",
            "aria-label": "Child cards time", "aria-valuemin": "0", "aria-valuemax": String(model.limitMinutes),
            "aria-valuenow": String(Math.min(spent, model.limitMinutes)),
            "aria-valuetext": format(spent, settings) + " spent by child cards; " + label
          }, [
            h("div", { class: "epic-progress-fill", style: "width:" + filled + "%", "aria-hidden": "true" }),
            over ? h("div", { class: "epic-progress-over", style: "width:" + (100 - filled) + "%", "aria-hidden": "true" }) : null,
            h("div", { class: "epic-progress-labels", "aria-hidden": "true" }, [
              h("span", null, [h("span", { class: "progress-caption" }, "Spent by child cards"), h("strong", null, format(spent, settings))]),
              h("span", { class: "progress-remaining" }, [h("span", { class: "progress-caption" }, over ? "Over limit" : "Remaining"), h("strong", null, over ? "Over by " + format(-left, settings) : format(left, settings) + " left")])
            ])
          ]));
          if (model.estimatedFinish) epicBody.appendChild(h("p", { class: "hint estimate-line" }, [
            "Est. finish: " + model.estimatedFinish,
            helpTip("Remaining budget converted using hours per workday in board settings, counted from today. Weekends and excluded dates are skipped.")
          ]));
        } else {
          epicBody.appendChild(h("p", { class: "hint" }, "Spent by child cards: " + format(spent, settings)));
        }
      }
      if (!model.children.length) {
        epicBody.appendChild(h("p", { class: "empty-state" }, "Add child card links to track an epic. A limit is optional."));
        return;
      }
      const childList = h("div", { class: "child-list" });
      model.children.forEach(function (child) {
        const name = child.url ? h("a", { href: child.url, target: "_blank", rel: "noopener" }, child.name) : child.name;
        const actions = h("div", { class: "child-actions" }, [
          h("strong", { title: child.missing ? "Time unavailable" : "Spent time" }, child.missing ? "Unavailable" : format(child.minutes, settings))
        ]);
        if (model.canWrite !== false) actions.appendChild(entryAction("Remove child card",
          '<path d="m6 6 12 12M6 18 18 6"/>', true, !!model.saving, function () {
            linkError.textContent = "";
            const savingCard = latestModel.cardId;
            handlers.onLinkRemove(child.id).catch(function (error) {
              if (latestModel.cardId === savingCard) linkError.textContent = error.message || "Could not remove child card.";
            });
          }));
        const row = h("div", { class: "child", "data-child-id": child.id }, [h("span", { class: "child-name" }, name), actions]);
        if (model.canWrite !== false) {
          const handle = entryAction("Move child card: " + child.name,
            '<path d="M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1"/>', false, !!model.saving, function () {});
          handle.classList.add("drag-handle");
          handle.title = "Drag to reorder, or use Arrow Up / Arrow Down";
          handle.draggable = !model.saving;
          handle.addEventListener("dragstart", function (event) {
            if (latestModel.saving) { event.preventDefault(); return; }
            draggedId = child.id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", child.id);
            row.classList.add("is-dragging");
          });
          handle.addEventListener("dragend", function () { endDrag(); });
          handle.addEventListener("keydown", function (event) {
            if (latestModel.saving || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const ids = latestModel.children.map(function (item) { return item.id; });
            const index = ids.indexOf(child.id), target = index + (event.key === "ArrowUp" ? -1 : 1);
            if (target < 0 || target >= ids.length) return;
            ids.splice(index, 1); ids.splice(target, 0, child.id);
            reorderChildren(ids, child.id);
          });
          row.prepend(handle);
          row.addEventListener("dragover", function (event) {
            if (!draggedId || latestModel.saving || draggedId === child.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            clearDropTargets();
            row.classList.add(event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? "drop-before" : "drop-after");
          });
          row.addEventListener("drop", function (event) {
            if (!draggedId || latestModel.saving) return;
            event.preventDefault();
            const moved = draggedId;
            const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
            const ids = latestModel.children.map(function (item) { return item.id; }).filter(function (id) { return id !== moved; });
            const index = ids.indexOf(child.id);
            endDrag();
            if (index < 0) return;
            ids.splice(index + (before ? 0 : 1), 0, moved);
            reorderChildren(ids, moved);
          });
        }
        childList.appendChild(row);
      });
      epicBody.appendChild(childList);
    }

    return { update: update };
  }

  root.TimeCardView = { mount: mountCardView, sortEntries: sortEntries };
})(typeof self !== "undefined" ? self : this);
