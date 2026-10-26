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
    // An explicit group ETA overrides its child totals. Child estimates remain visible as detail.
    const aggregateGroups = new Set(cards.filter(function (card) {
      const kids = card.linkedIds || card.kids || [];
      return !card.missing && card.limitMinutes != null && kids.length;
    }).map(function (card) { return card.id; }));
    const aggregateOwner = new Map();
    aggregateGroups.forEach(function (id) {
      if (!scope.has(id) || Array.from(g.ancestors(id)).some(function (parent) { return scope.has(parent) && aggregateGroups.has(parent); })) return;
      function mark(child, path) {
        if (path.has(child)) return;
        path = new Set(path); path.add(child);
        aggregateOwner.set(child, id);
        const card = g.byId.get(child);
        if (card) (card.linkedIds || card.kids || []).forEach(function (kid) { mark(kid, path); });
      }
      (g.byId.get(id).linkedIds || g.byId.get(id).kids || []).forEach(function (child) { mark(child, new Set([id])); });
    });
    if (Array.from(aggregateGroups).some(function (id) { return scope.has(id); })) warnings.push("An epic's own ETA overrides child totals. Child bars show separate estimates; they do not add to the epic's planned load.");
    function aggregateSpent(id) {
      const seen = new Set();
      function total(key) {
        if (seen.has(key)) return 0;
        seen.add(key);
        const card = g.byId.get(key), kids = card && (card.linkedIds || card.kids || []);
        return kids && kids.length ? kids.reduce(function (sum, child) { return sum + total(child); }, 0) :
          (card && card.entries || []).reduce(function (sum, entry) { return sum + entry.minutes; }, 0);
      }
      return total(id);
    }
    const leafCache = new Map();
    function leaves(id, path) {
      if (leafCache.has(id)) return leafCache.get(id);
      path = new Set(path || []);
      if (path.has(id)) return [id];
      path.add(id);
      const card = g.byId.get(id), kids = card && (card.linkedIds || card.kids || []);
      const ids = aggregateGroups.has(id) || !kids || !kids.length ? [id] : Array.from(new Set(kids.flatMap(function (kid) { return leaves(kid, path); })));
      leafCache.set(id, ids); return ids;
    }
    // DFS in saved child order determines priority; shared work appears only once.
    const order = [], ordered = new Set();
    function prioritize(id) {
      if (aggregateOwner.has(id) && scope.has(aggregateOwner.get(id))) return;
      if (ordered.has(id)) return; ordered.add(id);
      const card = g.byId.get(id), kids = card && (card.linkedIds || card.kids || []);
      if (aggregateGroups.has(id) || !kids || !kids.length) order.push(id); else kids.forEach(prioritize);
    }
    roots.forEach(prioritize); scope.forEach(prioritize);
    function workDependencies(id) {
      const dependencies = new Set(g.dependencies(id));
      if (aggregateGroups.has(id)) {
        const seen = new Set([id]);
        function visit(key) {
          if (seen.has(key)) return;
          seen.add(key);
          const card = g.byId.get(key);
          if (!card) return;
          (card.dependencyIds || []).forEach(function (dep) { dependencies.add(dep); });
          (card.linkedIds || card.kids || []).forEach(visit);
        }
        const card = g.byId.get(id);
        (card.linkedIds || card.kids || []).forEach(visit);
        seen.forEach(function (key) { dependencies.delete(key); });
      }
      return Array.from(new Set(Array.from(dependencies).flatMap(function (dep) {
        return aggregateOwner.has(dep) ? [aggregateOwner.get(dep)] : leaves(dep);
      }))).filter(function (dep) { return dep !== id; });
    }
    const tasks = order.map(function (id) {
      const card = g.byId.get(id), done = !!card && (aggregateGroups.has(id) ? alreadyComplete(id) : card.dueComplete === true);
      const remaining = done ? 0 : card && card.limitMinutes != null
        ? Math.max(0, card.limitMinutes - (aggregateGroups.has(id) ? aggregateSpent(id) : (card.entries || []).reduce(function (sum, e) { return sum + e.minutes; }, 0))) : null;
      const issue = !card || card.missing ? "Unavailable" : cycleIds.has(id) ? "Circular links" : !done && (!remaining || remaining < EPS) ? "Set or increase ETA" : "";
      return { id: id, remaining: remaining || 0, total: remaining || 0, issue: issue, done: done && !issue,
        start: null, finish: done && !issue ? options.start : null, startTime: null, finishTime: done && !issue ? 0 : null,
        deps: workDependencies(id),
        caps: Array.from(g.ancestors(id)).concat(id).map(function (key) {
          const ancestor = g.byId.get(key), setting = ancestor && ancestor.planning || {};
          return { id: key, calendar: normalizeCalendar({ baseFte: setting.maxFte, changes: setting.changes }, key === id && !aggregateGroups.has(id) ? 1 : 100) };
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
      const owner = aggregateOwner.get(id), ownerCard = owner && g.byId.get(owner);
      const status = owner && !items.length ? "Included in " + (ownerCard ? ownerCard.name : "parent") + " ETA" :
        complete ? (items.every(function (task) { return task.total === 0; }) ? "Done" : aggregateGroups.has(id) ? "Scheduled from group ETA" : "Scheduled") :
          issues.join(" · ") || "Blocked / beyond 10-year horizon";
      rows.set(id, { id: id, card: card, start: starts[0] || (complete ? options.start : null), finish: complete ? finishes[finishes.length - 1] : null,
        scheduledThrough: scheduledThrough, minutes: items.reduce(function (sum, task) { return sum + task.total; }, 0), complete: complete, status: status, dependencies: g.dependencies(id) });
    });
    if (options.details !== false && !cycleIds.size) tasks.forEach(function (task) {
      if (!aggregateGroups.has(task.id) || !task.start) return;
      const descendants = new Set();
      function collect(id) {
        if (descendants.has(id)) return;
        descendants.add(id);
        const card = g.byId.get(id);
        if (card) (card.linkedIds || card.kids || []).forEach(collect);
      }
      const kids = g.byId.get(task.id).linkedIds || g.byId.get(task.id).kids || [];
      kids.forEach(collect);
      const detailCards = cards.map(function (card) { return Object.assign({}, card, {
        dependencyIds: (card.dependencyIds || []).filter(function (id) { return descendants.has(id); })
      }); });
      const detail = plan(detailCards, Object.assign({}, options, { rootIds: kids, start: task.start }));
      detail.rows.forEach(function (row, id) {
        if (descendants.has(id) && row.start) rows.set(id, Object.assign({}, row, { status: "Child ETA · " + row.status }));
      });
    });
    const incomplete = tasks.filter(function (task) { return !task.done; });
    if (incomplete.length) warnings.push(incomplete.length + " work item(s) have no reliable finish. Check ETA, dependencies and available FTE.");
    // Keep useful context for a finished/empty plan without rendering ten years of blocked days.
    const lastWork = days.findLastIndex(function (day) { return day.minutes > EPS; });
    const detailDays = Math.min(3650, Math.max(0, ...Array.from(rows.values()).map(function (row) {
      return row.finish || row.scheduledThrough ? Math.round((Date.parse(row.finish || row.scheduledThrough) - Date.parse(options.start)) / 86400000) + 1 : 0;
    })));
    const visibleCount = Math.max(28, lastWork + 1, detailDays);
    const visibleDays = days.slice(0, visibleCount);
    while (visibleDays.length < visibleCount) {
      const next = new Date(options.start + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + visibleDays.length);
      const ymd = next.toISOString().slice(0, 10), workday = ![0, 6].includes(next.getUTCDay()) && !excluded.has(ymd);
      visibleDays.push({ date: ymd, availableFte: workday ? capacity(calendar, ymd) : 0, usedFte: 0, minutes: 0, workday: workday });
    }
    return { roots: roots, rows: rows, tasks: tasks, days: visibleDays, warnings: warnings, complete: !incomplete.length && !cycleIds.size,
      finish: incomplete.length || cycleIds.size ? null : tasks.map(function (task) { return task.finish; }).filter(Boolean).sort().pop() || null,
      graph: g, calendar: calendar };
  }
  return { validDate: validDate, normalizeCalendar: normalizeCalendar, capacity: capacity,
    graph: graph, validateLinks: validateLinks, plan: plan };
});
