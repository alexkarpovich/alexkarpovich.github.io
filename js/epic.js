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

  function checkItemLabel(name) {
    const raw = String(name || "").trim();
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
    const label = checkItemLabel(name);
    if (label.shortLink) return label.shortLink;
    const embedded = String(name || "").match(/(?:^|[\s(])(?:https?:\/\/)?trello\.com\/c\/([A-Za-z0-9]+)(?=[/\s)#?]|$)/i)
      || String(name || "").match(/\]\(\s*(?:https?:\/\/)?trello\.com\/c\/([A-Za-z0-9]+)/i);
    return embedded ? embedded[1] : "";
  }

  function resolveCheckItemChildId(item, selfId, shortLinkToId, cardsByName) {
    const hostId = cardIdFromCheckItem(item);
    let id = hostId;
    // Trello often sets idCard to the host card, not the linked child card.
    if (id === selfId) id = "";
    const label = item && item.name ? checkItemLabel(item.name) : { title: "", shortLink: "" };
    const slug = !id && item && item.name ? shortLinkFromCheckItemName(item.name) : (label.shortLink || "");
    if (!id && slug) {
      if (!shortLinkToId) return { id: "", unresolved: true };
      id = shortLinkToId.get(slug) || "";
      if (!id) return { id: "", unresolved: true };
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

  // Trello sometimes returns checklist shells without items. Treat that as unknown.
  function inspectChecklists(checklists, selfId, shortLinkToId, cardsByName) {
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

  // Trello's iframe API often omits idCard or returns empty checkItems until REST is used.
  function needsRemoteChecklists(inspection, checklists) {
    if (!inspection || !inspection.complete) return true;
    if (inspection.childIds && inspection.childIds.length) return false;
    return (checklists || []).length > 0;
  }

  return {
    cardIdFromCheckItem: cardIdFromCheckItem,
    checkItemLabel: checkItemLabel,
    resolveCheckItemChildId: resolveCheckItemChildId,
    uniqueNameIndex: uniqueNameIndex,
    childIdsFromChecklists: childIdsFromChecklists,
    inspectChecklists: inspectChecklists,
    needsRemoteChecklists: needsRemoteChecklists,
    sameIds: sameIds
  };
});
