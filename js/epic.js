(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeEpic = api;
})(typeof self !== "undefined" ? self : this, function () {
  function childIdsFromChecklists(checklists, selfId, shortLinkToId) {
    const ids = [];
    const seen = new Set();
    let unlinked = 0;
    (checklists || []).forEach(function (list) {
      (list.checkItems || []).forEach(function (item) {
        let id = item && item.idCard ? String(item.idCard) : "";
        if (!id && item && item.name) {
          const match = String(item.name).match(/trello\.com\/c\/([A-Za-z0-9]+)/);
          if (match && shortLinkToId && shortLinkToId.get(match[1])) id = shortLinkToId.get(match[1]);
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
    return { childIds: ids, unlinkedCount: unlinked };
  }

  // Trello sometimes returns checklist shells without items. Treat that as unknown.
  function inspectChecklists(checklists, selfId, shortLinkToId) {
    if (!Array.isArray(checklists)) return { complete: false, childIds: null, unlinkedCount: 0 };
    if (checklists.length === 0) return { complete: true, childIds: [], unlinkedCount: 0 };
    const missingItems = checklists.some(function (list) { return !Array.isArray(list.checkItems); });
    if (missingItems) return { complete: false, childIds: null, unlinkedCount: 0 };
    const parsed = childIdsFromChecklists(checklists, selfId, shortLinkToId);
    return { complete: true, childIds: parsed.childIds, unlinkedCount: parsed.unlinkedCount };
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
