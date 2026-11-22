/**
 * Working hours and "when next" in a time zone (default Europe/Istanbul). Pure functions: the scheduler passes the clock in, tests move it.
 * A window may run past midnight (22:00-02:00). Steps of one minute, looking at most 9 days ahead.
 */
const fmt = new Map();
function formatter(tz) {
  if (!fmt.has(tz)) fmt.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }));
  return fmt.get(tz);
}
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** { weekday: 1 (Mon) .. 7 (Sun), minutes: minutes since local midnight } */
function localParts(date, tz = 'Europe/Istanbul') {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { weekday: WD[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const toMinutes = (hm) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** @param s { windowStart, windowEnd, weekdaysOnly, timezone } */
function inWindow(date, s) {
  const { weekday, minutes } = localParts(date, s.timezone);
  if (s.weekdaysOnly && weekday > 5) return false;
  const a = toMinutes(s.windowStart); const b = toMinutes(s.windowEnd);
  if (a === null || b === null || a === b) return true;                    // no window = always
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** The first moment at or after `from` that is inside the window (the minute's start), or null when there is none within 9 days. */
function nextOpen(from, s) {
  const start = new Date(Math.ceil(from.getTime() / 60000) * 60000);
  if (inWindow(from, s)) return from;
  for (let i = 0; i <= 9 * 1440; i++) { const t = new Date(start.getTime() + i * 60000); if (inWindow(t, s)) return t; }
  return null;
}

/** when the next run is due after one that was queued at `now`: one interval later, moved into the window */
function nextRun(now, intervalMinutes, s) {
  const candidate = new Date(now.getTime() + (intervalMinutes || 60) * 60000);
  return nextOpen(candidate, s);
}

module.exports = { localParts, toMinutes, inWindow, nextOpen, nextRun };
