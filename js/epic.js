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

  function childIdsFromChecklists(checklists, selfId, shortLinkToId) {
    const ids = [];
    const seen = new Set();
    let unlinked = 0;
    let unresolved = 0;
    (checklists || []).forEach(function (list) {
      (list.checkItems || []).forEach(function (item) {
        let id = cardIdFromCheckItem(item);
        if (!id && item && item.name) {
          const match = String(item.name).match(/(?:^|[\s(])(?:https?:\/\/)?trello\.com\/c\/([A-Za-z0-9]+)(?=[/\s)#?]|$)/i);
          if (match) {
            if (shortLinkToId) id = shortLinkToId.get(match[1]) || "";
            if (!id) unresolved++;
          }
        }
        if (!id) {
          unlinked += 1;
          return;
        }
        if (id === selfId || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      });
    });
    return { childIds: ids, unlinkedCount: unlinked, unresolvedCount: unresolved };
  }

  // Trello sometimes returns checklist shells without items. Treat that as unknown.
  function inspectChecklists(checklists, selfId, shortLinkToId) {
    if (!Array.isArray(checklists)) return { complete: false, childIds: null, unlinkedCount: 0 };
    if (checklists.length === 0) return { complete: true, childIds: [], unlinkedCount: 0 };
    const missingItems = checklists.some(function (list) { return !list || !Array.isArray(list.checkItems); });
    if (missingItems) return { complete: false, childIds: null, unlinkedCount: 0 };
    const parsed = childIdsFromChecklists(checklists, selfId, shortLinkToId);
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
    childIdsFromChecklists: childIdsFromChecklists,
    inspectChecklists: inspectChecklists,
    needsRemoteChecklists: needsRemoteChecklists,
    sameIds: sameIds
  };
});
