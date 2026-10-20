(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeEpic = api;
})(typeof self !== "undefined" ? self : this, function () {
  function childIdsFromChecklists(checklists, selfId, shortLinkToId) {
    const ids = [];
    const seen = new Set();
    let unlinked = 0;
    let unresolved = 0;
    (checklists || []).forEach(function (list) {
      (list.checkItems || []).forEach(function (item) {
        let id = item && item.idCard ? String(item.idCard) : "";
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

  return {
    childIdsFromChecklists: childIdsFromChecklists,
    inspectChecklists: inspectChecklists,
    sameIds: sameIds
  };
});
