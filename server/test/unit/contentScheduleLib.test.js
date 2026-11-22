const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/content/lib/schedule');

const IST = { timezone: 'Europe/Istanbul' };

test('working hours: a plain window, an overnight window, no window, weekdays only (in the time zone of the bot, not the server)', () => {
  const day = { ...IST, windowStart: '09:00', windowEnd: '23:00' };
  assert.deepEqual([new Date('2026-11-23T05:59:00Z'), new Date('2026-11-23T06:00:00Z'), new Date('2026-11-23T19:59:00Z'), new Date('2026-11-23T20:00:00Z')].map((d) => S.inWindow(d, day)), [false, true, true, false], '09:00 Istanbul = 06:00 UTC; the end is exclusive');
  const night = { ...IST, windowStart: '22:00', windowEnd: '02:00' };
  assert.deepEqual([new Date('2026-11-23T18:59:00Z'), new Date('2026-11-23T19:00:00Z'), new Date('2026-11-23T22:59:00Z'), new Date('2026-11-23T23:00:00Z')].map((d) => S.inWindow(d, night)), [false, true, true, false]);
  assert.equal(S.inWindow(new Date('2026-11-23T03:00:00Z'), { ...IST }), true); assert.equal(S.inWindow(new Date(), { ...IST, windowStart: '10:00', windowEnd: '10:00' }), true, 'equal ends = no window');
  const wk = { ...IST, weekdaysOnly: true };
  assert.deepEqual([new Date('2026-11-27T10:00:00Z'), new Date('2026-11-28T10:00:00Z'), new Date('2026-11-29T10:00:00Z'), new Date('2026-11-30T10:00:00Z')].map((d) => S.inWindow(d, wk)), [true, false, false, true]);
  assert.equal(S.inWindow(new Date('2026-11-27T22:00:00Z'), wk), false, '01:00 Saturday in Istanbul is already the weekend');
  const ny = { timezone: 'America/New_York', windowStart: '09:00', windowEnd: '17:00' };
  assert.deepEqual([new Date('2026-07-01T13:00:00Z'), new Date('2026-12-01T13:00:00Z')].map((d) => S.inWindow(d, ny)), [true, false], 'daylight saving time is the zone\'s business: 09:00 EDT = 13:00Z, 09:00 EST = 14:00Z');
});

test('next run: one interval later, moved into the window; never "now" when it is closed; null only when no moment exists', () => {
  const day = { ...IST, windowStart: '09:00', windowEnd: '23:00' };
  assert.equal(S.nextRun(new Date('2026-11-23T10:00:00Z'), 120, day).toISOString(), '2026-11-23T12:00:00.000Z');
  assert.equal(S.nextRun(new Date('2026-11-23T19:00:00Z'), 120, day).toISOString(), '2026-11-24T06:00:00.000Z', '22:00 + 2 h = 00:00 is closed: tomorrow 09:00');
  assert.equal(S.nextOpen(new Date('2026-11-23T10:00:00Z'), day).toISOString(), '2026-11-23T10:00:00.000Z', 'already open: unchanged');
  assert.equal(S.nextOpen(new Date('2026-11-28T10:00:00Z'), { ...IST, weekdaysOnly: true }).toISOString(), '2026-11-29T21:00:00.000Z');
  assert.equal(S.nextOpen(new Date('2026-11-23T10:00:00Z'), { ...IST, windowStart: '09:00', windowEnd: '10:00', weekdaysOnly: true }).toISOString(), '2026-11-24T06:00:00.000Z');
  assert.deepEqual([S.toMinutes('09:30'), S.toMinutes('24:00'), S.toMinutes('9:00'), S.toMinutes(null)], [570, null, null, null]);
});
