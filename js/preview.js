(function () {
  const settings = { hoursPerDay: 8, daysPerWeek: 5, weekStartsOn: 1 };
  const members = [
    { id: "anna", name: "Анна Ковалева" },
    { id: "boris", name: "Борис Левин" }
  ];

  let createdSeq = 1;
  function entry(id, ymd, minutes, memberId, memberName, note) {
    return {
      id: id,
      ymd: ymd,
      minutes: minutes,
      memberId: memberId,
      memberName: memberName,
      note: note || "",
      createdAt: Date.UTC(2026, 9, 15) + createdSeq++ * 60000
    };
  }

  const cards = [
    {
      id: "epic",
      name: "Релиз 1.0",
      url: "https://trello.com/c/epic",
      listName: "Эпики",
      labels: [{ id: "release", name: "Release", color: "purple" }],
      entries: [],
      limitMinutes: 4800,
      kids: ["design", "api"]
    },
    {
      id: "design",
      name: "Макеты онбординга",
      url: "https://trello.com/c/design",
      listName: "В работе",
      labels: [{ id: "design", name: "Design", color: "pink" }],
      entries: [
        entry("d1", 20261019, 480, "anna", "Анна Ковалева", "первый экран"),
        entry("d2", 20261020, 120, "boris", "Борис Левин", "")
      ],
      limitMinutes: null,
      kids: null
    },
    {
      id: "api",
      name: "Авторизация",
      url: "https://trello.com/c/api",
      listName: "В работе",
      labels: [{ id: "backend", name: "Backend", color: "blue" }],
      entries: [
        entry("a1", 20261021, 240, "anna", "Анна Ковалева", ""),
        entry("a2", 20261019, 100, "boris", "Борис Левин", "ревью")
      ],
      limitMinutes: null,
      kids: null
    },
    {
      id: "bug",
      name: "Поправить отчёт",
      url: "https://trello.com/c/bug",
      listName: "Баги",
      labels: [{ id: "bug", name: "Bug", color: "red" }],
      entries: [
        entry("b1", 20261022, 30, "boris", "Борис Левин", ""),
        entry("b2", 20261012, 180, "anna", "Анна Ковалева", "прошлая неделя")
      ],
      limitMinutes: null,
      kids: null
    }
  ];

  [
    { id: "project", name: "Project Epic · Platform migration", kids: ["phase1", "phase2"] },
    { id: "phase1", name: "Epic 1 · Foundation", kids: ["task-a", "task-b"], planning: { maxFte: 1.4 } },
    { id: "task-a", name: "Task A · Data model", limitMinutes: 2400 },
    { id: "task-b", name: "Task B · API integration", limitMinutes: 3360 },
    { id: "phase2", name: "Epic 2 · Rollout", kids: ["task-c", "sub-epic"], dependencyIds: ["phase1"] },
    { id: "task-c", name: "Task C · Migrate services", limitMinutes: 2880 },
    { id: "sub-epic", name: "Sub-epic · Validation", kids: ["task-d"] },
    { id: "task-d", name: "Task D · Release checks", limitMinutes: 1920 }
  ].forEach(function (card) { cards.push(Object.assign({ url: "https://trello.com/c/" + card.id, listName: "Planning", labels: [], entries: [], limitMinutes: null, kids: [] }, card)); });
  let timelineView = null;
  let fteCalendar = { baseFte: 1.4, changes: [{ date: "2026-10-28", fte: 2 }, { date: "2026-11-04", fte: 0.8 }] };
  let selectedId = "epic";
  const picker = document.getElementById("card-picker");
  cards.forEach(function (card) {
    picker.appendChild(window.TimeDom.h("option", { value: card.id }, card.name));
  });
  picker.value = selectedId;
  picker.addEventListener("change", function () {
    selectedId = picker.value;
    paintCard();
  });

  const fixedToday = new Date(2026, 9, 19);
  const cardView = window.TimeCardView.mount(document.getElementById("card-app"), {
    today: function () { return fixedToday; },
    settings: function () { return settings; },
    canAuthorize: false,
    onAdd: function (fields) {
      selected().entries.push(window.TimeModel.createEntry({
        minutes: fields.minutes,
        ymd: fields.ymd,
        note: fields.note,
        memberId: "anna",
        memberName: "Анна Ковалева"
      }));
      paintCard();
      paintReport();
      return Promise.resolve();
    },
    onUpdate: function (fields) {
      const card = selected();
      const entry = window.TimeModel.findEntry({ entries: card.entries }, fields.id);
      if (!entry || entry.memberId !== "anna") return Promise.reject(new Error("You can only edit your own entries."));
      entry.minutes = fields.minutes;
      entry.ymd = fields.ymd;
      entry.note = fields.note;
      entry.createdAt = fields.createdAt || entry.createdAt;
      paintCard();
      paintReport();
      return Promise.resolve();
    },
    onDelete: function (id) {
      const card = selected();
      const entry = window.TimeModel.findEntry({ entries: card.entries }, id);
      if (!entry || entry.memberId !== "anna") return Promise.reject(new Error("You can only delete your own entries."));
      card.entries = card.entries.filter(function (item) { return item.id !== id; });
      paintCard();
      paintReport();
      return Promise.resolve();
    },
    onLimit: function (minutes) {
      const card = selected();
      card.limitMinutes = minutes;
      paintCard();
      paintReport();
      return Promise.resolve();
    },
    onCardSearch: function (query, kind) {
      return Promise.resolve(cards.filter(function (card) {
        return card.id !== selectedId && !(kind === "dependency" ? selected().dependencyIds || [] : selected().kids || []).includes(card.id) && card.name.toLowerCase().includes(query.toLowerCase());
      }));
    },
    onLinkAdd: function (url, selectedId) {
      const card = selected();
      const child = cards.find(function (item) { return selectedId ? item.id === selectedId : item.url === url || item.name.toLowerCase() === url.toLowerCase(); });
      if (!child || child.id === card.id) return Promise.reject(new Error("Use another card URL from this preview."));
      if ((card.kids || []).includes(child.id)) return Promise.reject(new Error("This card is already linked."));
      try { window.TimeTimeline.validateLinks(cards.map(function (item) { return item === card ? Object.assign({}, item, { kids: (item.kids || []).concat(child.id) }) : item; })); }
      catch (e) { return Promise.reject(e); }
      card.kids = (card.kids || []).concat(child.id);
      paintCard();
      paintReport();
      return Promise.resolve();
    },
    onLinkReorder: function (ids) {
      selected().kids = ids.slice();
      paintCard();
      paintReport();
      return Promise.resolve();
    },
    onLinkRemove: function (id) {
      selected().kids = (selected().kids || []).filter(function (childId) { return childId !== id; });
      paintCard();
      paintReport();
      return Promise.resolve();
    },
    onPlanning: function (planning, minutes) { selected().planning = window.TimeModel.normalizePlanning(planning); selected().limitMinutes = minutes; paintCard(); paintReport(); return Promise.resolve(); },
    onDependencyAdd: function (text, id) {
      const card = cards.find(function (item) { return id ? item.id === id : item.url === text || item.name.toLowerCase() === text.toLowerCase(); });
      if (!card) return Promise.reject(new Error("Choose a card from this preview."));
      const current = selected();
      if ((current.dependencyIds || []).includes(card.id)) return Promise.reject(new Error("This dependency already exists."));
      const next = (current.dependencyIds || []).concat(card.id);
      try { window.TimeTimeline.validateLinks(cards.map(function (item) { return item === current ? Object.assign({}, item, { dependencyIds: next }) : item; })); }
      catch (e) { return Promise.reject(e); }
      current.dependencyIds = next; paintCard(); paintTimeline(); return Promise.resolve();
    },
    onDependencyRemove: function (id) { selected().dependencyIds = (selected().dependencyIds || []).filter(function (key) { return key !== id; }); paintCard(); paintTimeline(); return Promise.resolve(); },
    onInspectDependencies: function () {
      const inherited = inheritedDependencies(selected());
      return Promise.resolve({ count: inherited.length, incomplete: false });
    },
    onTimeline: function () { if (timelineView) timelineView.selectRoot(selectedId); document.getElementById("timeline-app").scrollIntoView({ behavior: "smooth" }); },
    onAuthorize: function () { return Promise.resolve(); }
  });

  const reportView = window.TimeReportView.mount(document.getElementById("report-app"), {
    today: function () { return fixedToday; },
    settings: function () { return settings; },
    onChange: paintReport,
    onExport: function () {
      const current = currentReport();
      current.labelText = window.TimeAggregate.labelText;
      const workbook = window.TimeExcel.buildWorkbook(current, window.TimeDuration.formatDuration, settings);
      window.TimeDom.download("uchet-vremeni-" + current.from + "_" + current.to + ".xlsx", workbook);
    }
  });

  timelineView = window.TimeTimelineView.mount(document.getElementById("timeline-app"), {
    start: "2026-10-26", rootId: "project", onRefresh: function () { paintTimeline(); return Promise.resolve(); },
    onCalendar: function (value) { fteCalendar = value; return Promise.resolve(); }
  });
  function paintTimeline() { if (timelineView) timelineView.update({ cards: cards, settings: settings, calendar: fteCalendar, canWrite: true }); }
  function inheritedDependencies(card) {
    const g = window.TimeTimeline.graph(cards), inherited = [];
    g.ancestors(card.id).forEach(function (id) {
      const parent = g.byId.get(id);
      (parent.dependencyIds || []).forEach(function (dep) { const predecessor = g.byId.get(dep); inherited.push({ id: dep, name: predecessor ? predecessor.name : "Unavailable card", parentName: parent.name, parentUrl: parent.url }); });
    });
    return inherited;
  }

  function selected() {
    return cards.find(function (card) { return card.id === selectedId; });
  }

  function reportCards() {
    return cards.map(function (card) {
      return {
        id: card.id,
        name: card.name,
        url: card.url,
        listName: card.listName,
        labels: card.labels,
        entries: card.entries,
        limitMinutes: card.limitMinutes,
        kids: card.limitMinutes != null ? card.kids : null,
        missing: false
      };
    });
  }

  function cardModel(card) {
    const kids = card.kids || [];
    return {
      cardId: card.id,
      planning: card.planning,
      dependencies: (card.dependencyIds || []).map(function (id) { return cards.find(function (item) { return item.id === id; }) || { id: id, name: "Unavailable card", missing: true }; }),
      inheritedDependencies: inheritedDependencies(card),
      settings: settings,
      members: members,
      currentMemberId: "anna",
      canWrite: true,
      canAdd: true,
      entries: window.TimeModel.sortEntries(card.entries),
      limitMinutes: card.limitMinutes,
      kidsKnown: true,
      linkedIds: kids,
      warning: "",
      error: "",
      limitError: "",
      saving: false,
      storageRatio: window.TimeModel.storageRatio({
        entries: card.entries,
        limitMinutes: card.limitMinutes,
        linkedIds: kids
      }),
      children: kids.map(function (id) {
        const child = cards.find(function (item) { return item.id === id; });
        return {
          id: id,
          name: child ? child.name : "Unavailable card",
          url: child ? child.url : "",
          minutes: child ? window.TimeModel.totalMinutes(child.entries) : 0
        };
      })
    };
  }

  function currentReport() {
    return window.TimeAggregate.buildReport(reportCards(), reportView.filters());
  }

  function paintCard() {
    cardView.update(cardModel(selected()));
  }

  function paintReport() {
    reportView.update(currentReport(), "");
    paintTimeline();
  }

  paintCard();
  paintReport();

  if (location.search.indexOf("selftest=1") !== -1) runSelfTest();

  function textOf(id) {
    return document.getElementById(id).textContent;
  }

  function clickButton(rootId, label) {
    const buttons = document.querySelectorAll("#" + rootId + " button");
    for (let i = 0; i < buttons.length; i += 1) {
      if (buttons[i].textContent === label) {
        buttons[i].click();
        return true;
      }
    }
    return false;
  }

  async function runSelfTest() {
    const failures = [];
    function expect(condition, message) {
      if (!condition) failures.push(message);
    }
    const cardText = textOf("card-app");
    const reportText = textOf("report-app");
    expect(cardText.indexOf("1w 3d 20m left") !== -1, "epic remaining");
    expect(cardText.indexOf("Макеты онбординга") !== -1, "child name");
    expect(cardText.indexOf("1d 2h") !== -1, "design total");
    expect(reportText.indexOf("2d 10m") !== -1, "week total");
    expect(reportText.indexOf("Анна Ковалева") !== -1, "author");
    expect(reportText.indexOf("прошлая неделя") === -1, "old note hidden");

    expect(clickButton("report-app", "Bug"), "bug chip");
    expect(textOf("report-app").indexOf("Макеты онбординга") === -1, "label filter hides design");
    expect(textOf("report-app").indexOf("Поправить отчёт") !== -1, "label filter keeps bug");
    expect(textOf("report-app").indexOf("Релиз 1.0") === -1, "label filter hides epic");
    clickButton("report-app", "Bug");

    expect(clickButton("report-app", "Last week"), "last week");
    expect(textOf("report-app").indexOf("3h") !== -1, "last week hours");
    expect(textOf("report-app").indexOf("Макеты онбординга") === -1, "last week hides design");
    clickButton("report-app", "This week");

    clickButton("card-app", "Task");
    expect(document.querySelector("#card-app .epic").hidden, "Task tab hides epic view");
    document.querySelector("#card-app input[name=duration]").value = "45m";
    document.querySelector("#card-app form.log-form").requestSubmit();
    expect(textOf("card-app").indexOf("45m") !== -1, "logged 45m on epic");
    expect(textOf("card-app").indexOf("1w 3d 20m left") !== -1, "epic own time ignored");
    expect(textOf("report-app").indexOf("2d 55m") !== -1, "report includes epic log");

    expect(document.querySelector("#card-app .planning-estimate").textContent === "ETA", "ETA label");
    expect(!document.querySelector('#card-app .epic-heading'), "summary heading removed");
    clickButton("card-app", "Epic");
    expect(document.querySelector('#card-app .log-panel').hidden, "Epic tab hides task view");
    expect(document.querySelector('#card-app #epic-tab').getAttribute("aria-selected") === "true", "Epic tab selected");
    const settle = async function () { for (let i = 0; i < 5; i++) await Promise.resolve(); };
    document.querySelector('#card-app button[aria-label="Remove child card"]').click();
    await settle();
    expect(document.querySelectorAll("#card-app .child").length === 1, "remove child card");
    clickButton("card-app", "+ add child card");
    document.querySelector('#card-app input[name="card-link"]').value = "https://trello.com/c/design";
    document.querySelector("#card-app .link-form").requestSubmit();
    await settle();
    expect(document.querySelectorAll("#card-app .child").length === 2, "add child card");
    const cardHost = document.getElementById("card-app");
    clickButton("card-app", "Task");
    const taskDraft = cardHost.querySelector('[name="duration"]');
    taskDraft.value = "20m";
    const stableEntry = cardHost.querySelector(".entry");
    clickButton("card-app", "Epic");
    paintCard();
    expect(cardHost.querySelector('#epic-tab').getAttribute("aria-selected") === "true", "refresh preserves tab");
    clickButton("card-app", "Task");
    expect(taskDraft.value === "20m" && cardHost.querySelector(".entry") === stableEntry, "tabs preserve task draft and entries");
    taskDraft.value = "";
    cardHost.querySelector('#task-tab').dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(cardHost.querySelector('#epic-tab').getAttribute("aria-selected") === "true", "tab keyboard navigation");
    const observer = new MutationObserver(function () {});
    observer.observe(cardHost, { subtree: true, childList: true, attributes: true, characterData: true });
    expect(cardView.update(cardModel(selected())) === false, "unchanged model skipped");
    expect(observer.takeRecords().length === 0, "unchanged model leaves DOM untouched");
    observer.disconnect();
    const stableChild = cardHost.querySelector(".child");
    const savingModel = cardModel(selected());
    savingModel.saving = true;
    cardView.update(savingModel);
    expect(cardHost.querySelector(".child") === stableChild, "saving preserves child rows");
    paintCard();
    expect(cardHost.querySelector(".link-form").hidden, "add form hidden after save");
    const originalOrder = selected().kids.join(",");
    cardHost.querySelector(".drag-handle").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await settle();
    expect(selected().kids.join(",") !== originalOrder, "keyboard reorders children");
    const rows = cardHost.querySelectorAll(".child");
    const transfer = new DataTransfer();
    rows[0].querySelector(".drag-handle").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    rows[1].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientY: rows[1].getBoundingClientRect().bottom - 1, dataTransfer: transfer }));
    await settle();
    expect(selected().kids.join(",") === originalOrder, "drag restores order");
    clickButton("card-app", "+ add child card");
    const searchInput = cardHost.querySelector('[name="card-link"]');
    searchInput.value = "bug";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(!cardHost.querySelector(".child-suggestions").hidden, "autocomplete shows matches");
    // Search by the real display name; selection carries an ID, not a title match.
    searchInput.value = cards.find(function (card) { return card.id === "bug"; }).name.slice(0, 3);
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(!!searchInput.getAttribute("aria-activedescendant"), "autocomplete keyboard highlight");
    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    cardHost.querySelector(".link-form").requestSubmit();
    await settle();
    expect(selected().kids.includes("bug"), "autocomplete adds chosen card");
    cardHost.querySelector('[data-child-id="bug"] button[aria-label="Remove child card"]').click();
    await settle();
    expect(cardHost.querySelector(".epic-progress-track").getBoundingClientRect().height === 6, "thin progress bar");
    expect(cardHost.querySelector(".epic-progress-labels").getBoundingClientRect().bottom <= cardHost.querySelector(".epic-progress-track").getBoundingClientRect().top, "labels above progress bar");
    const originalLimit = selected().limitMinutes;
    selected().limitMinutes = 30;
    paintCard();
    expect(!!cardHost.querySelector(".epic-progress-over"), "over-budget segment");
    expect(cardHost.querySelector(".epic-progress").textContent.includes("Over by"), "over-budget value");
    selected().limitMinutes = originalLimit;
    paintCard();
    document.querySelector('#card-app button[aria-label="Edit planning"]').click();
    document.querySelector('#card-app input[name="estimate"]').value = "";
    document.querySelector('#card-app .planning-form').requestSubmit();
    await settle();
    expect(document.querySelectorAll("#card-app .child").length === 2, "child cards visible without a limit");
    expect(document.querySelector("#card-app .child strong").textContent !== "Unavailable", "time visible without limit");
    expect(document.documentElement.scrollWidth <= innerWidth, "no horizontal overflow");

    const result = document.getElementById("selftest-result");
    if (failures.length) {
      result.textContent = "SELFTEST FAIL: " + failures.join("; ");
    } else {
      result.textContent = "SELFTEST PASS";
    }
  }
})();
