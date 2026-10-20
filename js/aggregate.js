(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeAggregate = api;
})(typeof self !== "undefined" ? self : this, function () {
  function labelText(label) {
    if (!label) return "label";
    if (label.name) return label.name;
    const names = {
      green: "green",
      yellow: "yellow",
      orange: "orange",
      red: "red",
      purple: "purple",
      blue: "blue",
      sky: "sky",
      lime: "lime",
      pink: "pink",
      black: "black"
    };
    return names[label.color] || label.color || "label";
  }

  function cardMatchesLabels(card, labelIds) {
    if (!labelIds || (labelIds instanceof Set ? !labelIds.size : !labelIds.length)) return true;
    const selected = labelIds instanceof Set ? labelIds : new Set(labelIds);
    const labels = card.labels || [];
    if (selected.has("none") && labels.length === 0) return true;
    return labels.some(function (label) { return selected.has(label.id); });
  }

  function entryInRange(entry, from, to) {
    const ymd = String(entry.ymd).length === 8
      ? String(entry.ymd).slice(0, 4) + "-" + String(entry.ymd).slice(4, 6) + "-" + String(entry.ymd).slice(6, 8)
      : String(entry.ymd);
    return ymd >= from && ymd <= to;
  }

  function ymdOf(entry) {
    const raw = String(entry.ymd);
    if (raw.length === 8 && raw.indexOf("-") === -1) {
      return raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8);
    }
    return raw;
  }

  function buildReport(cards, filters) {
    const from = filters.from;
    const to = filters.to;
    const labelIds = new Set(filters.labelIds || []);
    const memberIds = filters.memberIds || [];
    const memberFilter = new Set(memberIds);
    const byId = new Map();
    cards.forEach(function (card) { byId.set(card.id, card); });

    const dated = [];
    cards.forEach(function (card) {
      if (card.missing) return;
      (card.entries || []).forEach(function (entry) {
        if (!entryInRange(entry, from, to)) return;
        dated.push({ card: card, entry: entry });
      });
    });

    const labelMap = new Map();
    const authorMap = new Map();
    dated.forEach(function (row) {
      (row.card.labels || []).forEach(function (label) {
        labelMap.set(label.id, { id: label.id, name: labelText(label), color: label.color || "" });
      });
      if (!row.card.labels || !row.card.labels.length) labelMap.set("none", { id: "none", name: "No label", color: "" });
      const prev = authorMap.get(row.entry.memberId);
      if (!prev || ymdOf(row.entry) >= prev.ymd) {
        authorMap.set(row.entry.memberId, { id: row.entry.memberId, name: row.entry.memberName || "Unknown", ymd: ymdOf(row.entry) });
      }
    });

    const groups = new Map();
    const flat = [];
    dated.forEach(function (row) {
      if (!cardMatchesLabels(row.card, labelIds)) return;
      if (memberFilter.size && !memberFilter.has(row.entry.memberId)) return;
      const key = row.entry.memberId + "\n" + row.card.id;
      let group = groups.get(row.entry.memberId);
      if (!group) {
        group = {
          memberId: row.entry.memberId,
          memberName: row.entry.memberName || "Unknown",
          minutes: 0,
          rows: new Map()
        };
        groups.set(row.entry.memberId, group);
      }
      if (ymdOf(row.entry) >= (group.latest || "")) {
        group.memberName = row.entry.memberName || group.memberName;
        group.latest = ymdOf(row.entry);
      }
      group.minutes += row.entry.minutes;
      let cardRow = group.rows.get(key);
      if (!cardRow) {
        cardRow = {
          cardId: row.card.id,
          cardName: row.card.name,
          cardUrl: row.card.url || "",
          listName: row.card.listName || "",
          labels: row.card.labels || [],
          minutes: 0
        };
        group.rows.set(key, cardRow);
      }
      cardRow.minutes += row.entry.minutes;
      flat.push({
        ymd: ymdOf(row.entry),
        memberId: row.entry.memberId,
        memberName: row.entry.memberName || "Unknown",
        cardId: row.card.id,
        cardName: row.card.name,
        cardUrl: row.card.url || "",
        listName: row.card.listName || "",
        labels: row.card.labels || [],
        minutes: row.entry.minutes,
        note: row.entry.note || ""
      });
    });

    const groupList = Array.from(groups.values()).map(function (group) {
      const rows = Array.from(group.rows.values()).sort(function (a, b) { return b.minutes - a.minutes; });
      return {
        memberId: group.memberId,
        memberName: group.memberName,
        minutes: group.minutes,
        rows: rows
      };
    }).sort(function (a, b) { return a.memberName.localeCompare(b.memberName, "en"); });

    flat.sort(function (a, b) {
      if (a.ymd !== b.ymd) return a.ymd < b.ymd ? 1 : -1;
      return a.memberName.localeCompare(b.memberName, "en");
    });

    const epics = cards.filter(function (card) {
      return !card.missing && card.limitMinutes != null && cardMatchesLabels(card, labelIds);
    }).map(function (card) {
      if (!card.kids) {
        return {
          cardId: card.id,
          cardName: card.name,
          cardUrl: card.url || "",
          labels: card.labels || [],
          limitMinutes: card.limitMinutes,
          spentMinutes: null,
          remainingMinutes: null,
          known: false,
          children: []
        };
      }
      let spent = 0;
      const children = card.kids.map(function (id) {
        const child = byId.get(id);
        const minutes = child ? (child.entries || []).reduce(function (sum, entry) { return sum + entry.minutes; }, 0) : 0;
        spent += minutes;
        return {
          id: id,
          name: child && !child.missing ? child.name : "Unavailable card",
          minutes: minutes,
          missing: !child || !!child.missing
        };
      });
      const known = !children.some(function (child) { return child.missing; });
      return {
        cardId: card.id,
        cardName: card.name,
        cardUrl: card.url || "",
        labels: card.labels || [],
        limitMinutes: card.limitMinutes,
        spentMinutes: known ? spent : null,
        remainingMinutes: known ? card.limitMinutes - spent : null,
        known: known,
        children: children
      };
    }).sort(function (a, b) { return a.cardName.localeCompare(b.cardName, "en"); });

    const cardIds = new Set();
    groupList.forEach(function (group) {
      group.rows.forEach(function (row) { cardIds.add(row.cardId); });
    });

    return {
      from: from,
      to: to,
      totalMinutes: groupList.reduce(function (sum, group) { return sum + group.minutes; }, 0),
      cardCount: cardIds.size,
      authorCount: groupList.length,
      groups: groupList,
      entries: flat,
      epics: epics,
      labelOptions: Array.from(labelMap.values()).sort(function (a, b) { return a.name.localeCompare(b.name, "en"); }),
      authorOptions: Array.from(authorMap.values()).map(function (author) {
        return { id: author.id, name: author.name };
      }).sort(function (a, b) { return a.name.localeCompare(b.name, "en"); })
    };
  }

  return {
    labelText: labelText,
    buildReport: buildReport
  };
});
