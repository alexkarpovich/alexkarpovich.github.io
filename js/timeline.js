(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeTimeline = api;
})(typeof self !== "undefined" ? self : this, function () {
  const EPS = 1e-7;
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1970-01-01" && value <= "2999-12-31" &&
      Number.isFinite(Date.parse(value + "T12:00:00Z")) && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
  }
  function fte(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100; }
  function normalizeCalendar(raw, fallback) {
    raw = raw || {};
    const changes = new Map();
    (Array.isArray(raw.changes) ? raw.changes : []).forEach(function (row) {
      if (row && validDate(row.date) && fte(row.fte)) changes.set(row.date, { date: row.date, fte: row.fte });
    });
    return { baseFte: fte(raw.baseFte) ? raw.baseFte : fallback == null ? 1 : fallback,
      changes: Array.from(changes.values()).sort(function (a, b) { return a.date.localeCompare(b.date); }) };
  }
  function capacity(calendar, date) {
    let value = calendar.baseFte;
    for (const row of calendar.changes) { if (row.date > date) break; value = row.fte; }
    return value;
  }
  function graph(cards) {
    const byId = new Map(cards.map(function (card) { return [card.id, card]; }));
    const parents = new Map();
    cards.forEach(function (card) { (card.linkedIds || card.kids || []).forEach(function (id) {
      if (!parents.has(id)) parents.set(id, []);
      parents.get(id).push(card.id);
    }); });
    function ancestors(id, seen) {
      seen = seen || new Set();
      (parents.get(id) || []).forEach(function (parent) { if (!seen.has(parent)) { seen.add(parent); ancestors(parent, seen); } });
      return seen;
    }
    function dependencies(id) {
      const result = new Set((byId.get(id) || {}).dependencyIds || []);
      ancestors(id).forEach(function (parent) { ((byId.get(parent) || {}).dependencyIds || []).forEach(function (dep) { result.add(dep); }); });
      return Array.from(result);
    }
    const edges = new Map();
    cards.forEach(function (card) { edges.set(card.id, Array.from(new Set((card.linkedIds || card.kids || []).concat(dependencies(card.id))))); });
    return { byId: byId, parents: parents, ancestors: ancestors, dependencies: dependencies, edges: edges };
  }
  function cycles(g, roots) {
    const active = new Set(), visited = new Set(), found = new Set();
    function visit(id) {
      if (active.has(id)) { active.forEach(function (key) { found.add(key); }); return; }
      if (visited.has(id)) return;
      active.add(id);
      (g.edges.get(id) || []).forEach(visit);
      active.delete(id); visited.add(id);
    }
    (roots || Array.from(g.byId.keys())).forEach(visit);
    return Array.from(found);
  }
  function validateLinks(cards) {
    if (cycles(graph(cards)).length) throw new Error("This link would create a circular dependency or hierarchy.");
  }
  function plan(cards, options) {
    options = options || {};
    if (!validDate(options.start)) throw new Error("Pick a valid forecast start date.");
    const g = graph(cards), calendar = normalizeCalendar(options.calendar);
    const roots = options.rootIds || cards.filter(function (card) { return !g.parents.has(card.id); }).map(function (card) { return card.id; });
    const scope = new Set(), completed = new Map();
    function alreadyComplete(id, path) {
      if (completed.has(id)) return completed.get(id);
      path = new Set(path || []);
      if (path.has(id)) return false;
      path.add(id);
      const card = g.byId.get(id), kids = card && (card.linkedIds || card.kids || []);
      const done = !!card && !card.missing && (kids.length ? kids.every(function (kid) { return alreadyComplete(kid, path); }) : card.dueComplete === true);
      completed.set(id, done); return done;
    }
    function include(id) {
      if (scope.has(id)) return;
      scope.add(id);
      const card = g.byId.get(id);
      if (card) (card.linkedIds || card.kids || []).forEach(include);
      if (!alreadyComplete(id)) g.dependencies(id).forEach(include);
    }
    roots.forEach(include);
    const cycleIds = new Set(cycles(g, roots));
    const warnings = [];
    if (cycleIds.size) warnings.push("Circular links block the affected work. Remove the cycle to calculate its dates.");
    const leafCache = new Map();
    function leaves(id, path) {
      if (leafCache.has(id)) return leafCache.get(id);
      path = new Set(path || []);
      if (path.has(id)) return [id];
      path.add(id);
      const card = g.byId.get(id), kids = card && (card.linkedIds || card.kids || []);
      const ids = !kids || !kids.length ? [id] : Array.from(new Set(kids.flatMap(function (kid) { return leaves(kid, path); })));
      leafCache.set(id, ids); return ids;
    }
    // DFS in saved child order determines priority; shared work appears only once.
    const order = [], ordered = new Set();
    function prioritize(id) {
      if (ordered.has(id)) return; ordered.add(id);
      const card = g.byId.get(id), kids = card && (card.linkedIds || card.kids || []);
      if (kids && kids.length) kids.forEach(prioritize); else order.push(id);
    }
    roots.forEach(prioritize); scope.forEach(prioritize);
    const tasks = order.map(function (id) {
      const card = g.byId.get(id), p = card && card.planning || {}, done = !!card && card.dueComplete === true;
      const remaining = done ? 0 : card && card.limitMinutes != null
        ? Math.max(0, card.limitMinutes - (card.entries || []).reduce(function (sum, e) { return sum + e.minutes; }, 0)) : null;
      const issue = !card || card.missing ? "Unavailable" : cycleIds.has(id) ? "Circular links" : !done && (!remaining || remaining < EPS) ? "Needs remaining estimate" : "";
      return { id: id, remaining: remaining || 0, total: remaining || 0, issue: issue, done: done && !issue,
        start: null, finish: done && !issue ? options.start : null, startTime: null, finishTime: done && !issue ? 0 : null,
        deps: Array.from(new Set(g.dependencies(id).flatMap(function (dep) { return leaves(dep); }))),
        caps: Array.from(g.ancestors(id)).concat(id).map(function (key) {
          const ancestor = g.byId.get(key), setting = ancestor && ancestor.planning || {};
          return { id: key, calendar: normalizeCalendar({ baseFte: setting.maxFte, changes: setting.changes }, key === id ? 1 : 100) };
        }) };
    });
    const byTask = new Map(tasks.map(function (task) { return [task.id, task]; }));
    const days = [];
    const hours = Number(options.settings && options.settings.hoursPerDay) || 8;
    const excluded = new Set(options.settings && options.settings.excludedDates || []);
    const date = new Date(options.start + "T12:00:00Z");
    let elapsed = 0;
    const horizon = Math.min(options.horizon || 3650, 3650);
    for (let day = 0; day < horizon && tasks.some(function (task) { return !task.done; }); day++) {
      const ymd = date.toISOString().slice(0, 10), workday = ![0, 6].includes(date.getUTCDay()) && !excluded.has(ymd);
      const available = workday ? capacity(calendar, ymd) : 0;
      let time = 0, used = 0;
      while (time < 1 - EPS && available > EPS) {
        let free = available;
        const capUsed = new Map(), running = [];
        tasks.forEach(function (task) {
          if (task.done || task.issue || task.deps.some(function (id) { return !byTask.has(id) || !byTask.get(id).done; })) return;
          let rate = free;
          task.caps.forEach(function (cap) { rate = Math.min(rate, capacity(cap.calendar, ymd) - (capUsed.get(cap.id) || 0)); });
          if (rate <= EPS) return;
          running.push({ task: task, rate: rate }); free -= rate;
          task.caps.forEach(function (cap) { capUsed.set(cap.id, (capUsed.get(cap.id) || 0) + rate); });
        });
        if (!running.length) break;
        const step = Math.min(1 - time, ...running.map(function (item) { return item.task.remaining / (hours * 60 * item.rate); }));
        running.forEach(function (item) {
          const task = item.task, minutes = step * hours * 60 * item.rate;
          if (task.start == null) { task.start = ymd; task.startTime = elapsed + time; }
          task.remaining = Math.max(0, task.remaining - minutes); task.lastDate = ymd; used += minutes;
          if (task.remaining < EPS) { task.done = true; task.finish = ymd; task.finishTime = elapsed + time + step; }
        });
        time += step;
      }
      days.push({ date: ymd, availableFte: available, usedFte: used / (hours * 60), minutes: used, workday: workday });
      date.setUTCDate(date.getUTCDate() + 1); elapsed++;
    }
    const rows = new Map();
    scope.forEach(function (id) {
      const card = g.byId.get(id), taskIds = leaves(id), items = taskIds.map(function (key) { return byTask.get(key); }).filter(Boolean);
      const complete = items.length > 0 && items.every(function (task) { return task.done; }) && !cycleIds.has(id);
      const starts = items.map(function (task) { return task.start; }).filter(Boolean).sort();
      const finishes = items.map(function (task) { return task.finish; }).filter(Boolean).sort();
      const scheduledThrough = items.map(function (task) { return task.lastDate || task.finish; }).filter(Boolean).sort().pop() || null;
      const issues = Array.from(new Set(items.map(function (task) { return task.issue; }).filter(Boolean)));
      const status = complete ? (items.every(function (task) { return task.total === 0; }) ? "Done" : "Scheduled") : issues.join(" · ") || "Blocked / beyond 10-year horizon";
      rows.set(id, { id: id, card: card, start: starts[0] || (complete ? options.start : null), finish: complete ? finishes[finishes.length - 1] : null,
        scheduledThrough: scheduledThrough, minutes: items.reduce(function (sum, task) { return sum + task.total; }, 0), complete: complete, status: status, dependencies: g.dependencies(id) });
    });
    const incomplete = tasks.filter(function (task) { return !task.done; });
    if (incomplete.length) warnings.push(incomplete.length + " task(s) have no reliable finish. Check remaining work, dependencies and available FTE.");
    // Keep useful context for a finished/empty plan without rendering ten years of blocked days.
    const lastWork = days.findLastIndex(function (day) { return day.minutes > EPS; });
    const visibleDays = days.slice(0, Math.max(28, lastWork + 1));
    while (visibleDays.length < 28) {
      const next = new Date(options.start + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + visibleDays.length);
      const ymd = next.toISOString().slice(0, 10), workday = ![0, 6].includes(next.getUTCDay()) && !excluded.has(ymd);
      visibleDays.push({ date: ymd, availableFte: workday ? capacity(calendar, ymd) : 0, usedFte: 0, minutes: 0, workday: workday });
    }
    return { roots: roots, rows: rows, tasks: tasks, days: visibleDays, warnings: warnings, complete: !incomplete.length && !cycleIds.size,
      finish: incomplete.length || cycleIds.size ? null : Array.from(rows.values()).map(function (row) { return row.finish; }).filter(Boolean).sort().pop() || null,
      graph: g, calendar: calendar };
  }
  return { validDate: validDate, normalizeCalendar: normalizeCalendar, capacity: capacity,
    graph: graph, validateLinks: validateLinks, plan: plan };
});
