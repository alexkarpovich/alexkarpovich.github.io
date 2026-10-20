(function (root) {
  const h = root.TimeDom.h;
  const clear = root.TimeDom.clear;
  const format = root.TimeDuration.formatDuration;

  const sortEntries = root.TimeModel.sortEntries;

  function mountCardView(rootNode, handlers) {
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
    const limitError = h("div", { class: "error", role: "alert" });
    const epicBody = h("div", { class: "epic-body" });

    const form = h("form", { class: "log-form" }, [
      h("div", { class: "log-form-inline" }, [duration, note, addButton]),
      formError
    ]);

    const limitForm = h("form", { class: "limit-form" }, [
      h("div", { class: "control-row" }, [limitInput, limitButton, clearLimit]),
      limitError
    ]);

    rootNode.appendChild(h("div", { class: "card-time", id: "app-inner" }, [
      form,
      addHint,
      editHost,
      total,
      list,
      storage,
      h("section", { class: "epic" }, [
        h("h2", null, "Epic limit"),
        h("p", { class: "hint" }, "Child cards come from checklists. Remaining = limit minus their time. Time logged on the epic card itself is not counted."),
        limitForm,
        epicBody
      ])
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
        duration.focus();
      }).catch(function (error) {
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
        handlers.onLimit(null).catch(showLimitError);
        return;
      }
      const parsed = root.TimeDuration.parseDuration(raw, handlers.settings());
      if (!parsed.ok) {
        limitError.textContent = parsed.error;
        return;
      }
      limitError.textContent = "";
      handlers.onLimit(parsed.minutes).catch(showLimitError);
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
      const settings = model.settings;
      if (model.cardId !== cardId) {
        cardId = model.cardId;
        duration.value = "";
        note.value = "";
        formError.textContent = "";
        limitError.textContent = "";
        closeEdit();
      }

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
      limitForm.hidden = !canWrite;

      if (model.error) formError.textContent = model.error;
      if (model.limitError) limitError.textContent = model.limitError;

      clear(total);
      const own = model.entries.reduce(function (sum, entry) { return sum + entry.minutes; }, 0);
      total.appendChild(h("span", { class: "muted" }, "On card"));
      total.appendChild(h("strong", null, format(own, settings)));

      clear(list);
      const sorted = sortEntries(model.entries);
      if (!sorted.length) {
        list.appendChild(h("p", { class: "empty" }, "No entries yet."));
      } else {
        sorted.forEach(function (entry) {
          const mine = entry.memberId === model.currentMemberId;
          const actions = h("div", { class: "entry-actions" });
          if (mine && canWrite) {
            actions.appendChild(h("button", {
              type: "button",
              class: "button-link",
              disabled: !!model.saving,
              onclick: function () { openEdit(entry, settings); }
            }, "Edit"));
            actions.appendChild(h("button", {
              type: "button",
              class: "button-link danger",
              "aria-label": "Delete entry",
              disabled: !!model.saving,
              onclick: function () { handlers.onDelete(entry.id).catch(function (error) { formError.textContent = error.message || "Could not delete entry."; }); }
            }, "Delete"));
          }
          list.appendChild(h("div", { class: "entry" }, [
            h("div", { class: "entry-main" }, [
              h("strong", null, format(entry.minutes, settings)),
              h("span", null, root.TimeDuration.ymdString(entry.ymd)),
              h("span", { class: "author" }, entry.memberName)
            ]),
            entry.note ? h("div", { class: "note" }, entry.note) : null,
            actions
          ]));
        });
      }

      if (editingId && !model.entries.some(function (e) { return e.id === editingId; })) {
        closeEdit();
      }

      storage.textContent = model.warning || (model.storageRatio > 0.75
        ? "Card storage is " + Math.round(model.storageRatio * 100) + "% full (Trello limit is 4096 characters per shared scope)."
        : "");

      if (!limitInput.matches(":focus")) {
        limitInput.value = model.limitMinutes ? format(model.limitMinutes, settings) : "";
      }
      paintEpic(model, settings);
    }

    function paintEpic(model, settings) {
      clear(epicBody);
      if (!model.kidsKnown) {
        epicBody.appendChild(h("p", { class: "hint" }, "Some links or child cards are unavailable. Keep linked cards on this board in open lists, then reopen the card."));
        if (handlers.canAuthorize) {
          epicBody.appendChild(h("button", { type: "button", class: "button-link", onclick: function () { handlers.onAuthorize().catch(showLimitError); } }, "Allow read access"));
        }
        return;
      }
      if (model.limitMinutes == null) {
        epicBody.appendChild(h("p", { class: "empty" }, model.children.length
          ? model.children.length + " child cards. Set a limit to see remaining time."
          : "No linked child cards in checklists. You can still set a limit."));
        if (model.unlinkedCount) {
          epicBody.appendChild(h("p", { class: "hint" }, model.unlinkedCount + " checklist items are not linked to cards and are ignored."));
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

      if (!model.children.length) {
        epicBody.appendChild(h("p", { class: "empty" }, "No cards in checklists."));
      } else {
        const childList = h("div", { class: "child-list" });
        model.children.forEach(function (child) {
          const name = child.url ? h("a", { href: child.url, target: "_blank", rel: "noopener" }, child.name) : child.name;
          childList.appendChild(h("div", { class: "child" }, [
            h("span", null, name),
            h("strong", null, format(child.minutes, settings))
          ]));
        });
        epicBody.appendChild(childList);
      }
      if (model.unlinkedCount) {
        epicBody.appendChild(h("p", { class: "hint" }, model.unlinkedCount + " checklist items are not linked to cards and are ignored."));
      }
    }

    return { update: update };
  }

  root.TimeCardView = { mount: mountCardView, sortEntries: sortEntries };
})(typeof self !== "undefined" ? self : this);
