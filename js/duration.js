(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeDuration = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MINUTE_WORDS = new Set(["m", "min", "mins", "minute", "minutes", "м", "мин", "минута", "минуты", "минут", "минуту"]);
  const HOUR_WORDS = new Set(["h", "hr", "hrs", "hour", "hours", "ч", "час", "часа", "часов"]);
  const DAY_WORDS = new Set(["d", "day", "days", "д", "день", "дня", "дней"]);
  const WEEK_WORDS = new Set(["w", "wk", "wks", "week", "weeks", "н", "нед", "неделя", "недели", "недель"]);
  const MONTH_WORDS = new Set(["mo", "mon", "month", "months", "мес", "месяц", "месяца", "месяцев"]);

  const PARSE_ERROR = "Example: 1h 40m, 30m, 1d, 1w, 1M, 1:40";

  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      hoursPerDay: clampInt(source.hoursPerDay, 1, 24, 8),
      daysPerWeek: clampInt(source.daysPerWeek, 1, 7, 5),
      daysPerMonth: clampInt(source.daysPerMonth, 1, 31, 20),
      weekStartsOn: Number(source.weekStartsOn) === 0 ? 0 : 1,
      excludedDates: Array.from(new Set((Array.isArray(source.excludedDates) ? source.excludedDates : []).filter(function (value) {
        const date = String(value || "");
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && !!parseYmd(date);
      }))).sort()
    };
  }

  function unitMinutes(settings) {
    const normalized = normalizeSettings(settings);
    const day = normalized.hoursPerDay * 60;
    return {
      hoursPerDay: normalized.hoursPerDay,
      daysPerWeek: normalized.daysPerWeek,
      day: day,
      week: normalized.daysPerWeek * day,
      month: normalized.daysPerMonth * day
    };
  }

  function unitMultiplier(unit, settings) {
    if (unit === "M" || unit === "M.") return unitMinutes(settings).month;
    const clean = String(unit || "").toLowerCase().replace(/\.$/, "").replace(/ё/g, "е");
    if (MINUTE_WORDS.has(clean)) return 1;
    if (HOUR_WORDS.has(clean)) return 60;
    const units = unitMinutes(settings);
    if (DAY_WORDS.has(clean)) return units.day;
    if (WEEK_WORDS.has(clean)) return units.week;
    if (MONTH_WORDS.has(clean)) return units.month;
    return 0;
  }

  function parseDuration(input, settings) {
    const text = String(input || "").trim().replace(/ё/g, "е");
    if (!text) return { ok: false, error: PARSE_ERROR };

    const clock = text.match(/^(\d+)\s*:\s*(\d{1,2})$/);
    if (clock) {
      const hours = Number(clock[1]);
      const mins = Number(clock[2]);
      if (mins >= 60 || hours < 0) return { ok: false, error: PARSE_ERROR };
      const minutes = hours * 60 + mins;
      if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > 1000000) return { ok: false, error: PARSE_ERROR };
      return { ok: true, minutes: minutes };
    }

    const re = /(\d+(?:[.,]\d+)?)\s*([a-zа-яё.]+)/gi;
    let minutes = 0;
    let found = false;
    let cursor = 0;
    let match;
    while ((match = re.exec(text))) {
      if (text.slice(cursor, match.index).trim()) return { ok: false, error: PARSE_ERROR };
      const amount = Number(match[1].replace(",", "."));
      const multiplier = unitMultiplier(match[2], settings);
      if (!Number.isFinite(amount) || amount < 0 || !multiplier) return { ok: false, error: PARSE_ERROR };
      minutes += amount * multiplier;
      found = true;
      cursor = match.index + match[0].length;
    }
    if (!found || text.slice(cursor).trim()) return { ok: false, error: PARSE_ERROR };
    const rounded = Math.round(minutes);
    if (rounded <= 0 || rounded > 1000000) return { ok: false, error: PARSE_ERROR };
    return { ok: true, minutes: rounded };
  }

  function formatDuration(minutes, settings) {
    let left = Math.round(Number(minutes) || 0);
    if (!left) return "0m";
    const negative = left < 0;
    left = Math.abs(left);
    const units = unitMinutes(settings);
    const parts = [];
    const months = Math.floor(left / units.month);
    left -= months * units.month;
    const weeks = Math.floor(left / units.week);
    left -= weeks * units.week;
    const days = Math.floor(left / units.day);
    left -= days * units.day;
    const hours = Math.floor(left / 60);
    const mins = left % 60;
    if (months) parts.push(months + "M");
    if (weeks) parts.push(weeks + "w");
    if (days) parts.push(days + "d");
    if (hours) parts.push(hours + "h");
    if (mins) parts.push(mins + "m");
    const text = parts.join(" ") || "0m";
    return negative ? "-" + text : text;
  }

  function formatYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseYmd(ymd) {
    const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (formatYmd(date) !== ymd) return null;
    return date;
  }

  function ymdNumber(ymd) {
    return Number(String(ymd).replace(/-/g, ""));
  }

  function ymdString(value) {
    const s = String(value).padStart(8, "0");
    return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
  }

  function addDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfWeek(date, weekStartsOn) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = (start.getDay() - (weekStartsOn === 0 ? 0 : 1) + 7) % 7;
    start.setDate(start.getDate() - diff);
    return start;
  }

  function periodRange(preset, today, settings) {
    const normalized = normalizeSettings(settings);
    const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (preset === "week" || preset === "last-week") {
      let start = startOfWeek(current, normalized.weekStartsOn);
      if (preset === "last-week") start = addDays(start, -7);
      return { from: formatYmd(start), to: formatYmd(addDays(start, 6)) };
    }
    if (preset === "month") {
      const start = new Date(current.getFullYear(), current.getMonth(), 1);
      const end = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      return { from: formatYmd(start), to: formatYmd(end) };
    }
    return null;
  }

  function inYmdRange(ymd, from, to) {
    return String(ymd) >= String(from) && String(ymd) <= String(to);
  }

  return {
    PARSE_ERROR: PARSE_ERROR,
    normalizeSettings: normalizeSettings,
    parseDuration: parseDuration,
    formatDuration: formatDuration,
    formatYmd: formatYmd,
    parseYmd: parseYmd,
    ymdNumber: ymdNumber,
    ymdString: ymdString,
    addDays: addDays,
    startOfWeek: startOfWeek,
    periodRange: periodRange,
    inYmdRange: inYmdRange
  };
});
