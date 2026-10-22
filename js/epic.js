(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeEpic = api;
})(typeof self !== "undefined" ? self : this, function () {
  function cardIdFromCheckItem(item) {
    if (!item || typeof item !== "object") return "";
    if (item.idCard != null && item.idCard !== "") return String(item.idCard);
    if (item.card) {
      if (typeof item.card === "string") return item.card;
      if (item.card.id) return String(item.card.id);
    }
    return "";
  }

  function normalizeCheckItemText(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
  }

  function shortLinksInText(name) {
    const text = normalizeCheckItemText(name);
    if (!text) return [];
    const re = /(?:https?:\/\/)?trello\.com\/c\/([A-Za-z0-9]+)/gi;
    const out = [];
    const seen = new Set();
    let match = re.exec(text);
    while (match) {
      const slug = match[1];
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(slug);
      }
      match = re.exec(text);
    }
    return out;
  }

  function collectShortLinksFromChecklists(checklists) {
    const slugs = [];
    const seen = new Set();
    (checklists || []).forEach(function (list) {
      (list.checkItems || []).forEach(function (item) {
        shortLinksInText(item && item.name).forEach(function (slug) {
          if (!seen.has(slug)) {
            seen.add(slug);
            slugs.push(slug);
          }
        });
      });
    });
    return slugs;
  }

  function checkItemLabel(name) {
    const raw = normalizeCheckItemText(name);
    if (!raw) return { title: "", shortLink: "" };
    const markdown = raw.match(/^\[([^\]]*)\]\(\s*(?:https?:\/\/)?trello\.com\/c\/([A-Za-z0-9]+)/i);
    if (markdown) {
      return { title: String(markdown[1] || "").trim(), shortLink: markdown[2] };
    }
    const plainUrl = raw.match(/^(?:https?:\/\/)?trello\.com\/c\/([A-Za-z0-9]+)/i);
    if (plainUrl) return { title: "", shortLink: plainUrl[1] };
    return { title: raw, shortLink: "" };
  }

  function shortLinkFromCheckItemName(name) {
    const links = shortLinksInText(name);
    return links.length ? links[0] : "";
  }

  function resolveCheckItemChildId(item, selfId, shortLinkToId, cardsByName) {
    const hostId = cardIdFromCheckItem(item);
    let id = hostId;
    // Trello often sets idCard to the host card, not the linked child card.
    if (id === selfId) id = "";
    const label = item && item.name ? checkItemLabel(item.name) : { title: "", shortLink: "" };
    if (!id && item && item.name && shortLinkToId) {
      const slugs = shortLinksInText(item.name);
      for (let i = 0; i < slugs.length; i += 1) {
        const mapped = shortLinkToId.get(slugs[i]);
        if (mapped && mapped !== selfId) {
          id = mapped;
          break;
        }
      }
      if (!id && slugs.length) return { id: "", unresolved: true };
    } else if (!id && item && item.name && shortLinksInText(item.name).length) {
      return { id: "", unresolved: true };
    }
    if (!id && cardsByName) {
      if (label.title) id = cardsByName.get(label.title.toLowerCase()) || "";
      if (!id && item && item.name) {
        id = cardsByName.get(String(item.name).trim().toLowerCase()) || "";
      }
    }
    if (id === selfId) id = "";
    return { id: id, unresolved: false };
  }

  function uniqueNameIndex(cards) {
    const counts = new Map();
    (cards || []).forEach(function (card) {
      if (!card || !card.name) return;
      const key = String(card.name).trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const index = new Map();
    (cards || []).forEach(function (card) {
      if (!card || !card.id || !card.name) return;
      const key = String(card.name).trim().toLowerCase();
      if (counts.get(key) === 1) index.set(key, String(card.id));
    });
    return index;
  }

  function childIdsFromChecklists(checklists, selfId, shortLinkToId, cardsByName) {
    const ids = [];
    const seen = new Set();
    let unlinked = 0;
    let unresolved = 0;
    (checklists || []).forEach(function (list) {
      (list.checkItems || []).forEach(function (item) {
        const hostId = cardIdFromCheckItem(item);
        const resolved = resolveCheckItemChildId(item, selfId, shortLinkToId, cardsByName);
        if (resolved.unresolved) {
          unresolved += 1;
          return;
        }
        const id = resolved.id;
        if (!id) {
          if (hostId === selfId) return;
          unlinked += 1;
          return;
        }
        if (seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      });
    });
    return { childIds: ids, unlinkedCount: unlinked, unresolvedCount: unresolved };
  }

  function orderedChecklists(checklists) {
    const lists = (checklists || []).filter(Boolean);
    // SDK shells may omit position; in that case preserve the supplied order.
    return lists.every(function (list) { return Number.isFinite(list.pos); })
      ? lists.sort(function (a, b) { return a.pos - b.pos; }) : lists;
  }

  // null means automatic; false means the saved choice could not be read.
  function selectChecklists(checklists, selectedId) {
    if (!Array.isArray(checklists) || selectedId === false) return null;
    const selected = selectedId
      ? checklists.find(function (list) { return list && list.id === selectedId; })
      : orderedChecklists(checklists)[0];
    return selected ? [selected] : selectedId ? null : [];
  }

  // Trello sometimes returns checklist shells without items. Treat that as unknown.
  function inspectChecklists(checklists, selfId, shortLinkToId, cardsByName, selectedId) {
    checklists = selectChecklists(checklists, selectedId);
    if (!Array.isArray(checklists)) return { complete: false, childIds: null, unlinkedCount: 0 };
    if (checklists.length === 0) return { complete: true, childIds: [], unlinkedCount: 0 };
    const missingItems = checklists.some(function (list) { return !list || !Array.isArray(list.checkItems); });
    if (missingItems) return { complete: false, childIds: null, unlinkedCount: 0 };
    const parsed = childIdsFromChecklists(checklists, selfId, shortLinkToId, cardsByName);
    return { complete: parsed.unresolvedCount === 0, childIds: parsed.childIds, unlinkedCount: parsed.unlinkedCount, unresolvedCount: parsed.unresolvedCount };
  }

  function sameIds(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
    return true;
  }

  function estimateFinish(remaining, settings, today) {
    if (!Number.isFinite(remaining) || remaining <= 0) return "";
    const configured = Number(settings ? settings.hoursPerDay : undefined);
    const hours = Number.isFinite(configured) ? Math.max(1, Math.min(24, Math.round(configured))) : 8;
    const workday = function (date) {
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) return false;
      const ymd = date.toISOString().slice(0, 10);
      return !(settings && settings.excludedDates || []).includes(ymd);
    };
    const current = today || new Date();
    // Use the viewer's calendar date; UTC arithmetic avoids DST drift.
    const date = new Date(Date.UTC(current.getFullYear(), current.getMonth(), current.getDate(), 12));
    if (!Number.isFinite(date.getTime())) return "";
    const needed = Math.ceil(remaining / (hours * 60));
    let added = 0;
    while (added < needed && added < 3650) { date.setUTCDate(date.getUTCDate() + 1); if (workday(date)) added++; }
    return added === needed ? date.toISOString().slice(0, 10) : "";
  }

  // Trello's iframe API often omits idCard or returns empty checkItems until REST is used.
  function needsRemoteChecklists(inspection, checklists) {
    if (!inspection || !inspection.complete) return true;
    if (inspection.childIds && inspection.childIds.length) return false;
    return (checklists || []).length > 0;
  }

  return {
    orderedChecklists: orderedChecklists,
    selectChecklists: selectChecklists,
    cardIdFromCheckItem: cardIdFromCheckItem,
    checkItemLabel: checkItemLabel,
    shortLinksInText: shortLinksInText,
    collectShortLinksFromChecklists: collectShortLinksFromChecklists,
    resolveCheckItemChildId: resolveCheckItemChildId,
    uniqueNameIndex: uniqueNameIndex,
    childIdsFromChecklists: childIdsFromChecklists,
    inspectChecklists: inspectChecklists,
    needsRemoteChecklists: needsRemoteChecklists,
    sameIds: sameIds,
    estimateFinish: estimateFinish
  };
});
