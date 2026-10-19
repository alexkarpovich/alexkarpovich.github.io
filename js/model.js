(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeModel = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_PLUGIN_CHARS = 4000;

  function emptyState() {
    return { limitMinutes: null, kids: null, entries: [] };
  }

  function normalizeCreatedAt(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
  }

  function cloneState(state) {
    return {
      limitMinutes: state.limitMinutes,
      kids: state.kids ? state.kids.slice() : null,
      entries: state.entries.map(cloneEntry)
    };
  }

  function cloneEntry(entry) {
    return {
      id: entry.id,
      ymd: entry.ymd,
      minutes: entry.minutes,
      memberId: entry.memberId,
      memberName: entry.memberName,
      note: entry.note || "",
      createdAt: entry.createdAt || 0
    };
  }

  function pack(state) {
    const who = [];
    const index = new Map();
    function whoIndex(id, name) {
      const key = id + "\n" + name;
      if (index.has(key)) return index.get(key);
      const next = who.length;
      who.push([id, name]);
      index.set(key, next);
      return next;
    }

    const entries = state.entries.map(function (entry) {
      const row = [entry.id, entry.ymd, entry.minutes, whoIndex(entry.memberId, entry.memberName)];
      if (entry.note) row.push(entry.note);
      const ts = normalizeCreatedAt(entry.createdAt);
      if (ts) {
        while (row.length < 5) row.push("");
        row[5] = Math.floor(ts / 1000);
      }
      return row;
    });

    const packed = { e: entries };
    if (who.length) packed.who = who;
    if (state.limitMinutes != null) packed.lim = state.limitMinutes;
    if (state.kids) packed.kids = state.kids;
    return packed;
  }

  function pluginChars(packed) {
    return JSON.stringify({ time: packed }).length;
  }

  function decode(raw) {
    const state = emptyState();
    if (!raw || typeof raw !== "object") return state;
    if (Number.isFinite(Number(raw.lim)) && Number(raw.lim) > 0) state.limitMinutes = Math.round(Number(raw.lim));
    if (Array.isArray(raw.kids)) state.kids = raw.kids.filter(function (id) { return typeof id === "string" && id; });
    const who = Array.isArray(raw.who) ? raw.who : [];
    if (!Array.isArray(raw.e)) return state;
    raw.e.forEach(function (row) {
      if (!Array.isArray(row) || row.length < 4) return;
      const person = who[row[3]] || [];
      const minutes = Math.round(Number(row[2]));
      const ymd = Math.round(Number(row[1]));
      if (!minutes || minutes < 0 || ymd < 19700101 || ymd > 29991231) return;
      const note = row[4] && typeof row[4] === "string" ? row[4] : "";
      const createdAt = row[5] ? normalizeCreatedAt(Number(row[5])) : ymd * 86400000;
      state.entries.push({
        id: String(row[0]),
        ymd: ymd,
        minutes: minutes,
        memberId: String(person[0] || ""),
        memberName: String(person[1] || "Unknown"),
        note: note,
        createdAt: createdAt
      });
    });
    return state;
  }

  function createEntry(fields) {
    return {
      id: Math.random().toString(36).slice(2, 8),
      ymd: fields.ymd,
      minutes: fields.minutes,
      memberId: fields.memberId,
      memberName: fields.memberName || "Unknown",
      note: String(fields.note || "").trim(),
      createdAt: normalizeCreatedAt(fields.createdAt) || Date.now()
    };
  }

  function sortEntries(entries) {
    return (entries || []).slice().sort(function (a, b) {
      const ta = a.createdAt || 0;
      const tb = b.createdAt || 0;
      if (ta !== tb) return tb - ta;
      if (a.ymd !== b.ymd) return b.ymd - a.ymd;
      return a.id < b.id ? 1 : -1;
    });
  }

  function mergeSameDay(state) {
    const map = new Map();
    const order = [];
    state.entries.forEach(function (entry) {
      const key = entry.ymd + "\n" + entry.memberId;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, cloneEntry(entry));
        order.push(key);
        return;
      }
      prev.minutes += entry.minutes;
      prev.createdAt = Math.min(prev.createdAt || Date.now(), entry.createdAt || Date.now());
      if (entry.note && prev.note.indexOf(entry.note) === -1) {
        prev.note = prev.note ? prev.note + "; " + entry.note : entry.note;
      }
    });
    return {
      limitMinutes: state.limitMinutes,
      kids: state.kids ? state.kids.slice() : null,
      entries: order.map(function (key) {
        const entry = map.get(key);
        if (entry.note && entry.note.length > 80) entry.note = entry.note.slice(0, 77) + "...";
        return entry;
      })
    };
  }

  function stripNotes(state) {
    return {
      limitMinutes: state.limitMinutes,
      kids: state.kids ? state.kids.slice() : null,
      entries: state.entries.map(function (entry) {
        const copy = cloneEntry(entry);
        copy.note = "";
        return copy;
      })
    };
  }

  function fitState(state) {
    const attempts = [
      { state: cloneState(state), warning: null },
      { state: mergeSameDay(state), warning: "Same-day entries were merged to save space on the card." },
      { state: stripNotes(mergeSameDay(state)), warning: "Notes were removed from older entries to save space on the card." }
    ];
    for (let i = 0; i < attempts.length; i += 1) {
      const packed = pack(attempts[i].state);
      if (pluginChars(packed) <= MAX_PLUGIN_CHARS) {
        return { state: attempts[i].state, packed: packed, warning: attempts[i].warning };
      }
    }
    const error = new Error("This card is out of storage (Trello limit is about 4 KB). Delete old entries.");
    error.code = "STORAGE_FULL";
    throw error;
  }

  function isEmpty(state) {
    return !state.entries.length && state.limitMinutes == null;
  }

  function totalMinutes(entries) {
    return (entries || []).reduce(function (sum, entry) { return sum + entry.minutes; }, 0);
  }

  function storageRatio(state) {
    if (isEmpty(state)) return 0;
    return pluginChars(pack(state)) / MAX_PLUGIN_CHARS;
  }

  function findEntry(state, id) {
    return (state.entries || []).find(function (entry) { return entry.id === id; });
  }

  return {
    MAX_PLUGIN_CHARS: MAX_PLUGIN_CHARS,
    emptyState: emptyState,
    pack: pack,
    decode: decode,
    pluginChars: pluginChars,
    createEntry: createEntry,
    sortEntries: sortEntries,
    fitState: fitState,
    isEmpty: isEmpty,
    totalMinutes: totalMinutes,
    storageRatio: storageRatio,
    findEntry: findEntry,
    cloneEntry: cloneEntry
  };
});
