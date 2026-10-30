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
  function entryDate(entry) {
    const value = String(entry.ymd || "");
    const date = value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6, 8);
    return validDate(date) ? date : null;
  }
  function localToday() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
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
    if (!validDate(options.start)) throw new Error("Pick a valid start date.");
    const today = validDate(options.today) ? options.today : localToday();
    const forecastStart = options.start > today ? options.start : today;
    const offset = date => (Date.parse(date) - Date.parse(options.start)) / 86400000;
    const boundary = offset(today) + 0.5;
    const loggedEntries = card => (card && card.entries || []).filter(entry => !entryDate(entry) || entryDate(entry) <= today);
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
    // Every explicit ETA contributes work; only unestimated leaves use a parent's ETA.
    const estimatedGroups = new Set(cards.filter(function (card) {
      const kids = card.linkedIds || card.kids || [];
      return !card.missing && card.limitMinutes != null && kids.length;
    }).map(function (card) { return card.id; }));
    const estimateOwner = new Map();
    scope.forEach(function (id) {
      const card = g.byId.get(id);
      if (!card || card.missing || card.limitMinutes != null || card.dueComplete || (card.linkedIds || card.kids || []).length) return;
      const queue = (g.parents.get(id) || []).slice(), seen = new Set([id]);
      for (const parent of queue) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        if (scope.has(parent) && estimatedGroups.has(parent)) { estimateOwner.set(id, parent); break; }
        queue.push(...(g.parents.get(parent) || []));
      }
    });
    function workSpent(id) {
      const ids = [id];
      estimateOwner.forEach((owner, child) => { if (owner === id) ids.push(child); });
      return ids.reduce((sum, key) => sum + loggedEntries(g.byId.get(key)).reduce((total, entry) => total + entry.minutes, 0), 0);
    }
    const leafCache = new Map();
    function leaves(id, path) {
      if (leafCache.has(id)) return leafCache.get(id);
      path = new Set(path || []);
      if (path.has(id)) return [id];
      path.add(id);
      const card = g.byId.get(id), kids = card && (card.linkedIds || card.kids || []);
      const ids = !kids || !kids.length ? (estimateOwner.has(id) ? [] : [id]) :
        Array.from(new Set((estimatedGroups.has(id) ? [id] : []).concat(kids.flatMap(function (kid) { return leaves(kid, path); }))));
      leafCache.set(id, ids); return ids;
    }
    // DFS in saved child order determines priority; shared work appears only once.
    const order = [], ordered = new Set();
    function prioritize(id) {
      if (estimateOwner.has(id) && scope.has(estimateOwner.get(id))) return;
      if (ordered.has(id)) return; ordered.add(id);
      const card = g.byId.get(id), kids = card && (card.linkedIds || card.kids || []);
      if (kids) kids.forEach(prioritize);
      if (estimatedGroups.has(id) || !kids || !kids.length) order.push(id);
    }
    roots.forEach(prioritize); scope.forEach(prioritize);
    function workDependencies(id) {
      const dependencies = new Set(g.dependencies(id));
      // External prerequisites still gate the covering ETA. Dependencies between
      // children must not block the parent's independent work.
      estimateOwner.forEach(function (owner, child) {
        if (owner === id) g.dependencies(child).forEach(function (dep) {
          if (dep !== id && !g.ancestors(dep).has(id)) dependencies.add(dep);
        });
      });
      return Array.from(new Set(Array.from(dependencies).flatMap(function (dep) {
        return estimateOwner.has(dep) ? [estimateOwner.get(dep)] : leaves(dep);
      }))).filter(function (dep) { return dep !== id; });
    }
    const tasks = order.map(function (id) {
      const card = g.byId.get(id), done = !!card && (estimatedGroups.has(id) ? alreadyComplete(id) : card.dueComplete === true);
      const spent = workSpent(id);
      const estimate = card && card.limitMinutes;
      const overrun = estimate != null ? Math.max(0, spent - estimate) : 0;
      const remaining = done ? 0 : estimate != null ? Math.max(0, estimate - spent) : null;
      const issue = !card || card.missing ? "Unavailable" : cycleIds.has(id) ? "Circular links" :
        !done && remaining == null ? "Set ETA" : !done && remaining <= EPS ? "ETA exhausted · update ETA or mark Done" : "";
      return { id: id, estimate: estimate, spent: spent, overrun: overrun, nativeDone: done, remaining: remaining || 0, total: remaining || 0, issue: issue, done: done && !issue,
        start: null, finish: done && !issue ? forecastStart : null, startTime: null, finishTime: done && !issue ? offset(forecastStart) : null,
        deps: workDependencies(id),
        caps: Array.from(g.ancestors(id)).concat(id).map(function (key) {
          const ancestor = g.byId.get(key), setting = ancestor && ancestor.planning || {};
          // An empty Maximum FTE inherits the pool for tasks and epics alike.
          // Only an explicit limit may prevent a team increase from speeding up work.
          return { id: key, calendar: normalizeCalendar({ baseFte: setting.maxFte, changes: setting.changes }, 100) };
        }) };
    });
    const byTask = new Map(tasks.map(function (task) { return [task.id, task]; }));
    function ready(task) { return !task.deps.some(function (id) { return !byTask.has(id) || !byTask.get(id).done; }); }
    const days = [];
    const hours = Number(options.settings && options.settings.hoursPerDay) || 8;
    const excluded = new Set(options.settings && options.settings.excludedDates || []);
    const date = new Date(forecastStart + "T12:00:00Z");
    let elapsed = offset(forecastStart);
    const horizon = Math.min(options.horizon || 3650, 3650);
    for (let day = 0; day < horizon && tasks.some(function (task) { return !task.done; }); day++) {
      const ymd = date.toISOString().slice(0, 10), workday = ![0, 6].includes(date.getUTCDay()) && !excluded.has(ymd);
      const available = workday ? capacity(calendar, ymd) : 0;
      let time = 0, used = 0;
      // Split today's column visually: logs on the left, forecast on the right.
      // Capacity still represents a full configured workday, not half a workday.
      const position = value => elapsed + (ymd === today ? 0.5 + value * 0.5 : value);
      while (time < 1 - EPS && available > EPS) {
        let free = available;
        const capUsed = new Map(), running = [];
        tasks.forEach(function (task) {
          if (task.done || task.issue || !ready(task)) return;
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
          if (task.start == null) { task.start = ymd; task.startTime = position(time); }
          task.remaining = Math.max(0, task.remaining - minutes); task.lastDate = ymd; used += minutes;
          if (task.remaining < EPS) { task.done = true; task.finish = ymd; task.finishTime = position(time + step); }
        });
        time += step;
      }
      days.push({ date: ymd, availableFte: available, usedFte: used / (hours * 60), minutes: used, workday: workday });
      date.setUTCDate(date.getUTCDate() + 1); elapsed++;
    }
    function history(id) {
      const seen = new Set(), dates = new Map();
      function visit(key) {
        if (seen.has(key)) return;
        seen.add(key);
        const card = g.byId.get(key);
        loggedEntries(card).forEach(function (entry) {
          const date = entryDate(entry);
          if (date) dates.set(date, (dates.get(date) || 0) + entry.minutes);
        });
        if (card) (card.linkedIds || card.kids || []).forEach(visit);
      }
      visit(id);
      return Array.from(dates, ([date, minutes]) => ({ date, minutes, start: offset(date), finish: Math.min(offset(date) + 1, boundary) })).sort((a, b) => a.start - b.start);
    }
    const rows = new Map();
    scope.forEach(function (id) {
      const card = g.byId.get(id), taskIds = leaves(id), items = taskIds.map(function (key) { return byTask.get(key); }).filter(Boolean);
      const complete = items.length > 0 && items.every(function (task) { return task.done; }) && !cycleIds.has(id);
      const starts = items.map(function (task) { return task.start; }).filter(Boolean).sort();
      const finishes = items.map(function (task) { return task.finish; }).filter(Boolean).sort();
      const issues = Array.from(new Set(items.map(function (task) { return task.issue; }).filter(Boolean)));
      const owner = estimateOwner.get(id), ownerCard = owner && g.byId.get(owner);
      const ownTask = byTask.get(id);
      const actual = history(id);
      const spentMinutes = actual.reduce((sum, segment) => sum + segment.minutes, 0);
      const nativeDone = items.length > 0 && items.every(task => task.nativeDone);
      const actualFinish = actual.length ? actual[actual.length - 1].date : null;
      const startTimes = items.map(function (task) { return task.startTime; }).filter(function (value) { return value != null; });
      const status = owner && !items.length ? "Included in " + (ownerCard ? ownerCard.name : "parent") + " ETA" :
        complete ? (items.every(function (task) { return task.nativeDone; }) ? "Done" : "Scheduled") :
          issues.join(" · ") || "Blocked / beyond 10-year horizon";
      rows.set(id, { id: id, card: card, start: actual.length ? actual[0].date : starts[0] || (complete ? forecastStart : null), finish: nativeDone && actualFinish ? actualFinish : complete ? finishes[finishes.length - 1] : null,
        startTime: actual.length ? actual[0].start : startTimes.length ? Math.min(...startTimes) : complete ? offset(forecastStart) : null,
        estimate: ownTask ? ownTask.estimate : null, spent: actual.length ? spentMinutes : ownTask ? ownTask.spent : 0, overrun: ownTask ? ownTask.overrun : 0,
        spentSegments: actual,
        remainingSegments: items.filter(task => task.startTime != null && !task.nativeDone).map(task => ({ start: task.startTime, finish: task.finishTime != null ? task.finishTime : offset(task.lastDate) + 1 })),
        minutes: items.reduce(function (sum, task) { return sum + task.total; }, 0), complete: complete, status: status, dependencies: g.dependencies(id) });
    });
    const incomplete = tasks.filter(function (task) { return !task.done; });
    if (incomplete.length) warnings.push(incomplete.length + " work item(s) have no reliable finish. Check ETA, dependencies and available FTE.");
    // Keep useful context for a finished/empty plan without rendering ten years of blocked days.
    const lastWork = days.findLastIndex(function (day) { return day.minutes > EPS; });
    const visibleCount = Math.max(28, offset(forecastStart) + lastWork + 1, boundary + 1);
    const firstTracked = Array.from(rows.values()).flatMap(row => row.spentSegments).map(segment => segment.date).sort()[0] || today;
    if (Array.from(scope).some(id => (g.byId.get(id)?.entries || []).some(entry => entryDate(entry) > today))) warnings.push("Future-dated entries excluded from actuals and remaining work.");
    const dayMap = new Map(days.map(day => [day.date, day]));
    const visibleDays = [];
    while (visibleDays.length < visibleCount) {
      const next = new Date(options.start + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + visibleDays.length);
      const ymd = next.toISOString().slice(0, 10), workday = ![0, 6].includes(next.getUTCDay()) && !excluded.has(ymd);
      visibleDays.push(dayMap.get(ymd) || { date: ymd, availableFte: workday ? capacity(calendar, ymd) : 0, usedFte: 0, minutes: 0, workday: workday });
    }
    return { roots: roots, rows: rows, tasks: tasks, days: visibleDays, warnings: warnings, complete: !incomplete.length && !cycleIds.size,
      start: options.start, today: today, firstTracked: firstTracked, boundary: boundary,
      finish: incomplete.length || cycleIds.size ? null : tasks.map(function (task) { return task.finish; }).filter(Boolean).sort().pop() || null,
      graph: g, calendar: calendar };
  }
  return { validDate: validDate, normalizeCalendar: normalizeCalendar, capacity: capacity,
    graph: graph, validateLinks: validateLinks, plan: plan };
});
