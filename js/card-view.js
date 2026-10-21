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
    const limitSummary = h("div", { class: "limit-summary", hidden: true }, [limitValue, editLimit]);
    const epicBody = h("div", { class: "epic-body" });

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
      h("div", { class: "control-row" }, [limitInput, limitButton, clearLimit, cancelLimit]),
      limitError
    ]);
    const epicHelp = helpTip("Child cards = checklist items with a trello.com/c/… link to another card on this board. Time on this card is excluded.");
    const epicSection = h("section", { class: "epic", hidden: true }, [
      h("div", { class: "epic-divider" }, logToggle),
      h("h2", { class: "epic-heading" }, ["Epic limit", epicHelp]),
      limitSummary,
      limitForm,
      epicBody
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
      const settings = model.settings;
      const cardChanged = model.cardId !== cardId;
      if (cardChanged) {
        editingLimit = false;
        cardId = model.cardId;
        duration.value = "";
        note.value = "";
        formError.textContent = "";
        limitError.textContent = "";
        closeEdit();
      }
      const showEpic = !!(model.children.length || model.limitMinutes != null || model.hasChecklists);
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
      paintLimit(model);

      if (model.error) {
        formError.textContent = model.error;
        setLogOpen(true);
      }
      if (model.limitError) limitError.textContent = model.limitError;

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
      epicSection.hidden = !showEpic;
      if (!epicSection.hidden) paintEpic(model, settings);
    }

    function wantsReadAccess(model) {
      return !!(handlers.canAuthorize && !model.authorized && model.needsChecklistAuth);
    }

    function appendAuthorizeButton() {
      epicBody.appendChild(h("button", {
        type: "button",
        class: "button mod-primary",
        onclick: function () { handlers.onAuthorize().catch(showLimitError); }
      }, "Allow read access"));
    }

    function paintEpic(model, settings) {
      clear(epicBody);
      if (model.childrenLoading) {
        epicBody.appendChild(h("p", { class: "hint", role: "status" }, "Loading child cards…"));
        return;
      }
      if (model.limitMinutes == null) {
        epicBody.appendChild(h("p", { class: "empty-state" }, model.children.length
          ? model.children.length + " child cards. Set a limit to see remaining time."
          : "Add trello.com/c/… links in the checklist, then set a limit."));
        if (wantsReadAccess(model) || (model.needsChecklistAuth && !model.children.length)) {
          epicBody.appendChild(h("p", { class: "hint" }, "Allow read access once to load checklist links from the REST API."));
          appendAuthorizeButton();
        }
        if (model.unlinkedCount) {
          epicBody.appendChild(h("p", { class: "hint" }, model.unlinkedCount + " checklist items have no recognizable card link."));
        }
        return;
      }

      if (!model.children.length) {
        epicBody.appendChild(h("p", { class: "empty-state" }, "No child cards found in the checklist."));
        if (wantsReadAccess(model) || model.needsChecklistAuth) {
          epicBody.appendChild(h("p", { class: "hint" }, "Trello often hides checklist item text in the Power-Up. Click Allow read access once to load pasted trello.com/c/… links."));
          appendAuthorizeButton();
        } else {
          epicBody.appendChild(h("p", { class: "hint" }, "Paste each sub-task card link (trello.com/c/…) into a checklist item. Cards must be on this board in open lists."));
        }
        if (model.unlinkedCount) {
          epicBody.appendChild(h("p", { class: "hint" }, model.unlinkedCount + " items have no trello.com/c/ link we could match."));
        }
        return;
      }

      if (!model.kidsKnown) {
        epicBody.appendChild(h("p", { class: "hint" }, "Some links or child cards are unavailable. Keep linked cards on this board in open lists, then reopen the card."));
        if (handlers.canAuthorize) {
          epicBody.appendChild(h("button", { type: "button", class: "button-link", onclick: function () { handlers.onAuthorize().catch(showLimitError); } }, "Allow read access"));
        }
        return;
      }

      const spent = model.children.reduce(function (sum, child) { return sum + child.minutes; }, 0);
      const left = model.limitMinutes - spent;
      const ratio = model.limitMinutes ? Math.min(1, spent / model.limitMinutes) : 0;
      epicBody.appendChild(h("div", { class: "remain " + (left < 0 ? "bad" : left === 0 ? "warn" : "ok") }, left < 0
        ? "Over by " + format(-left, settings)
        : format(left, settings) + " left"));
      epicBody.appendChild(h("div", { class: "bar" + (left < 0 ? " is-over" : "") }, h("span", { style: "width:" + (Math.round(ratio * 1000) / 10) + "%" })));
      epicBody.appendChild(h("p", { class: "hint" }, "Spent by child cards: " + format(spent, settings) + " of " + format(model.limitMinutes, settings)));
      if (model.estimatedFinish) epicBody.appendChild(h("p", { class: "hint estimate-line" }, [
        "Est. finish: " + model.estimatedFinish,
        helpTip("Based on the average logged time per working day. Weekends and excluded dates in board settings are skipped.")
      ]));

      if (!model.children.length) {
        epicBody.appendChild(h("p", { class: "empty-state" }, "No cards in checklists."));
      } else {
        const childList = h("div", { class: "child-list" });
        model.children.forEach(function (child) {
          const name = child.url ? h("a", { href: child.url, target: "_blank", rel: "noopener" }, child.name) : child.name;
          childList.appendChild(h("div", { class: "child" }, [
            h("span", null, name),
            h("strong", null, format(child.minutes, settings))
          ]));
        });
        epicBody.appendChild(h("details", { class: "child-details" }, [
          h("summary", null, "Show child cards (" + model.children.length + ")"), childList
        ]));
      }
      if (model.unlinkedCount) {
        epicBody.appendChild(h("p", { class: "hint" }, model.unlinkedCount + " checklist items are not linked to cards and are ignored."));
      }
    }

    return { update: update };
  }

  root.TimeCardView = { mount: mountCardView, sortEntries: sortEntries };
})(typeof self !== "undefined" ? self : this);
