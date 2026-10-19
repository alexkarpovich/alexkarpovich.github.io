(function (root) {
  const h = root.TimeDom.h;
  const clear = root.TimeDom.clear;
  const format = root.TimeDuration.formatDuration;
  const labelText = root.TimeAggregate.labelText;

  function labelDots(labels) {
    return h("span", { class: "labels" }, (labels || []).map(function (label) {
      return h("span", { class: "label-chip", "data-color": label.color || "none", title: labelText(label) }, labelText(label));
    }));
  }

  function mountReportView(rootNode, handlers) {
    const state = {
      preset: "week",
      from: "",
      to: "",
      labelIds: [],
      memberIds: []
    };

    const fromInput = h("input", { type: "date", "aria-label": "From date" });
    const toInput = h("input", { type: "date", "aria-label": "To date" });
    const presetBox = h("div", { class: "presets" });
    const labelBox = h("div", { class: "chips" });
    const authorBox = h("div", { class: "chips" });
    const summary = h("div", { class: "summary" });
    const tableHost = h("div", { class: "table-wrap" });
    const epicHost = h("div", { class: "epic-report" });
    const status = h("div", { class: "status", role: "status" });

    function emit() {
      handlers.onChange({
        preset: state.preset,
        from: state.from,
        to: state.to,
        labelIds: state.labelIds.slice(),
        memberIds: state.memberIds.slice()
      });
    }

    function setPreset(preset, silent) {
      state.preset = preset;
      const range = root.TimeDuration.periodRange(preset, handlers.today(), handlers.settings());
      state.from = range.from;
      state.to = range.to;
      fromInput.value = state.from;
      toInput.value = state.to;
      paintPresets();
      if (!silent) emit();
    }

    function paintPresets() {
      clear(presetBox);
      [["week", "This week"], ["last-week", "Last week"], ["month", "This month"]].forEach(function (item) {
        presetBox.appendChild(h("button", {
          type: "button",
          class: state.preset === item[0] ? "chip is-on" : "chip",
          onclick: function () { setPreset(item[0]); }
        }, item[1]));
      });
    }

    fromInput.addEventListener("change", function () {
      state.preset = "";
      state.from = fromInput.value;
      paintPresets();
      emit();
    });
    toInput.addEventListener("change", function () {
      state.preset = "";
      state.to = toInput.value;
      paintPresets();
      emit();
    });

    const exportButton = h("button", {
      type: "button",
      class: "button mod-primary",
      onclick: function () { handlers.onExport(); }
    }, "Download Excel");

    rootNode.appendChild(h("div", { class: "report" }, [
      h("div", { class: "toolbar" }, [
        h("div", { class: "field" }, [h("span", { class: "label" }, "Period"), presetBox]),
        h("div", { class: "field date-range" }, [
          h("label", { class: "date-field" }, [h("span", { class: "label" }, "From"), fromInput]),
          h("label", { class: "date-field" }, [h("span", { class: "label" }, "To"), toInput])
        ]),
        exportButton
      ]),
      h("div", { class: "filters" }, [
        h("div", { class: "field grow" }, [h("span", { class: "label" }, "Labels"), labelBox]),
        h("div", { class: "field grow" }, [h("span", { class: "label" }, "Authors"), authorBox])
      ]),
      status,
      summary,
      tableHost,
      epicHost
    ]));

    function toggle(list, id) {
      const next = list.indexOf(id) === -1 ? list.concat([id]) : list.filter(function (item) { return item !== id; });
      return next;
    }

    function paintChips(box, options, selected, onToggle) {
      clear(box);
      if (!options.length) {
        box.appendChild(h("span", { class: "muted" }, "No data for this period"));
        return;
      }
      options.forEach(function (option) {
        const on = selected.indexOf(option.id) !== -1;
        box.appendChild(h("button", {
          type: "button",
          class: on ? "chip is-on" : "chip",
          onclick: function () { onToggle(option.id); }
        }, option.name));
      });
    }

    function update(report, notice) {
      state.from = report.from;
      state.to = report.to;
      fromInput.value = report.from;
      toInput.value = report.to;
      status.textContent = notice || "";
      clear(summary);
      summary.appendChild(h("strong", null, format(report.totalMinutes, handlers.settings())));
      summary.appendChild(h("span", null, report.cardCount + " " + (report.cardCount === 1 ? "card" : "cards")));
      summary.appendChild(h("span", null, report.authorCount + " " + (report.authorCount === 1 ? "author" : "authors")));
      summary.appendChild(h("span", { class: "muted" }, "· visible to all board members"));

      paintChips(labelBox, report.labelOptions, state.labelIds, function (id) {
        state.labelIds = toggle(state.labelIds, id);
        emit();
      });
      paintChips(authorBox, report.authorOptions, state.memberIds, function (id) {
        state.memberIds = toggle(state.memberIds, id);
        emit();
      });

      clear(tableHost);
      if (!report.groups.length) {
        tableHost.appendChild(h("p", { class: "empty" }, "No entries for the selected period."));
      } else {
        const body = h("tbody");
        report.groups.forEach(function (group) {
          body.appendChild(h("tr", { class: "group-row" }, [
            h("td", { colspan: "4" }, group.memberName + " · subtotal"),
            h("td", { class: "num" }, format(group.minutes, handlers.settings()))
          ]));
          group.rows.forEach(function (item) {
            const name = item.cardUrl
              ? h("a", { href: item.cardUrl, target: "_blank", rel: "noopener" }, item.cardName)
              : item.cardName;
            body.appendChild(h("tr", null, [
              h("td", null, group.memberName),
              h("td", null, name),
              h("td", null, item.listName),
              h("td", null, labelDots(item.labels)),
              h("td", { class: "num" }, format(item.minutes, handlers.settings()))
            ]));
          });
        });
        tableHost.appendChild(h("table", null, [
          h("thead", null, h("tr", null, ["Author", "Card", "List", "Labels", "Time"].map(function (title) {
            return h("th", null, title);
          }))),
          body
        ]));
      }

      clear(epicHost);
      epicHost.appendChild(h("h2", null, "Epics"));
      epicHost.appendChild(h("p", { class: "hint" }, "Remaining time uses all logged time on child checklist cards, not just this period. Time on the epic card itself is excluded from the limit."));
      if (!report.epics.length) {
        epicHost.appendChild(h("p", { class: "empty" }, "No cards with a limit. Open an epic and set a limit, e.g. 1w or 3d."));
        return;
      }
      const ebody = h("tbody");
      report.epics.forEach(function (epic) {
        const name = epic.cardUrl ? h("a", { href: epic.cardUrl, target: "_blank", rel: "noopener" }, epic.cardName) : epic.cardName;
        let remain = "Links not loaded";
        let tone = "muted";
        if (epic.known) {
          if (epic.remainingMinutes < 0) {
            remain = "over " + format(-epic.remainingMinutes, handlers.settings());
            tone = "bad";
          } else {
            remain = format(epic.remainingMinutes, handlers.settings()) + " left";
            tone = epic.remainingMinutes === 0 ? "warn" : "ok";
          }
        }
        ebody.appendChild(h("tr", null, [
          h("td", null, name),
          h("td", null, labelDots(epic.labels)),
          h("td", { class: "num" }, format(epic.limitMinutes, handlers.settings())),
          h("td", { class: "num" }, epic.known ? format(epic.spentMinutes, handlers.settings()) : "—"),
          h("td", { class: "num " + tone }, remain)
        ]));
      });
      epicHost.appendChild(h("table", null, [
        h("thead", null, h("tr", null, ["Epic", "Labels", "Limit", "Spent", "Remaining"].map(function (title) {
          return h("th", null, title);
        }))),
        ebody
      ]));
    }

    setPreset("week", true);
    return { update: update, filters: function () { return state; } };
  }

  root.TimeReportView = { mount: mountReportView };
})(typeof self !== "undefined" ? self : this);
