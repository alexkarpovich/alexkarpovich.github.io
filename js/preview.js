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
      if (minutes == null) card.kids = null;
      else if (card.id === "epic") card.kids = ["design", "api"];
      paintCard();
      paintReport();
      return Promise.resolve();
    },
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
      settings: settings,
      members: members,
      currentMemberId: "anna",
      canWrite: true,
      canAdd: true,
      entries: window.TimeModel.sortEntries(card.entries),
      limitMinutes: card.limitMinutes,
      kidsKnown: true,
      unlinkedCount: card.id === "epic" ? 1 : 0,
      warning: "",
      error: "",
      limitError: "",
      saving: false,
      storageRatio: window.TimeModel.storageRatio({
        entries: card.entries,
        limitMinutes: card.limitMinutes,
        kids: card.kids
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

  function runSelfTest() {
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

    document.querySelector("#card-app input[name=duration]").value = "45m";
    document.querySelector("#card-app form.log-form").requestSubmit();
    expect(textOf("card-app").indexOf("45m") !== -1, "logged 45m on epic");
    expect(textOf("card-app").indexOf("1w 3d 20m left") !== -1, "epic own time ignored");
    expect(textOf("report-app").indexOf("2d 55m") !== -1, "report includes epic log");

    const result = document.getElementById("selftest-result");
    if (failures.length) {
      result.textContent = "SELFTEST FAIL: " + failures.join("; ");
    } else {
      result.textContent = "SELFTEST PASS";
    }
  }
})();
