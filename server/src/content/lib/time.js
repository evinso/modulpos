/** Days and months in the configured time zone (default Europe/Istanbul), as 'YYYY-MM-DD' / 'YYYY-MM'. */
function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}

function dayKey(date = new Date(), tz = 'Europe/Istanbul') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
const monthKey = (date = new Date(), tz = 'Europe/Istanbul') => dayKey(date, tz).slice(0, 7);

/** The day key `n` days before `date` (calendar days in the time zone). */
function daysAgo(n, date = new Date(), tz = 'Europe/Istanbul') {
  const [y, m, d] = dayKey(date, tz).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - n * 86400000);
  return t.toISOString().slice(0, 10);
}

/** Offset of a time zone from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetMs(instant, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the local day 'YYYY-MM-DD' (or the month 'YYYY-MM') begins in the time zone. */
function startOfLocalDay(key, tz = 'Europe/Istanbul') {
  const full = key.length === 7 ? `${key}-01` : key;
  const [y, m, d] = full.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let t = new Date(wall - offsetMs(new Date(wall), tz));
  t = new Date(wall - offsetMs(t, tz));                                  // second pass: the offset at the result itself (zones that change offset)
  return t;
}
const startOfDay = (date = new Date(), tz = 'Europe/Istanbul') => startOfLocalDay(dayKey(date, tz), tz);
const startOfMonth = (date = new Date(), tz = 'Europe/Istanbul') => startOfLocalDay(monthKey(date, tz), tz);

module.exports = { isValidTimezone, dayKey, monthKey, daysAgo, startOfLocalDay, startOfDay, startOfMonth };
