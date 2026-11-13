const test = require('node:test');
const assert = require('node:assert/strict');
const { BulkRunner, dayStartTr, sentTodayFor, FAIL_STREAK_PAUSE, TRANSIENT_STREAK_PAUSE, TRANSIENT_WAIT_MS, STUCK_AFTER_MS } = require('../../src/services/whatsapp/bulkRunner');

// ── a tiny in-memory database with just the calls the runner makes ────────────────────────────────────────────
function matches(row, where = {}) {
  return Object.entries(where).every(([k, w]) => {
    const v = row[k];
    if (w && typeof w === 'object' && !(w instanceof Date)) {
      if ('in' in w) return w.in.includes(v);
      if ('not' in w) return v !== w.not;
      if ('lt' in w) return v != null && v < w.lt;
      if ('gte' in w) return v != null && v >= w.gte;
    }
    return v === w;
  });
}
function table(clock, prefix) {
  const rows = []; let n = 0;
  const upd = (r, data) => { Object.assign(r, data); r.updatedAt = new Date(clock()); };
  const t = {
    rows,
    add: (data) => { const r = { id: `${prefix}${++n}`, createdAt: new Date(clock()), updatedAt: new Date(clock()), ...data }; rows.push(r); return r; },
    async findMany({ where, orderBy } = {}) {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy) { const [k, dir] = Object.entries(orderBy)[0]; out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
      return out.map((r) => ({ ...r }));
    },
    async findFirst(args) { return (await t.findMany(args))[0] || null; },
    async findUnique({ where }) { const r = rows.find((x) => matches(x, where)); return r ? { ...r } : null; },
    async count({ where } = {}) { return rows.filter((r) => matches(r, where)).length; },
    async update({ where, data }) { const r = rows.find((x) => matches(x, where)); if (!r) throw new Error('no row'); upd(r, data); return { ...r }; },
    async updateMany({ where, data }) { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => upd(r, data)); return { count: hit.length }; },
  };
  return t;
}

/**
 * A world: clock, database, fake WhatsApp (its answers are scripted per number), and a runner on top of them.
 * `random` plays the given numbers in turn, so the pauses are known.
 */
function world({ randoms = [0], outcomes = {}, now = Date.UTC(2026, 10, 13, 9, 0, 0) } = {}) {
  let clock = now; let ri = 0;
  const campaigns = table(() => clock, 'c'); const recipients = table(() => clock, 'r'); const settings = table(() => clock, 's');
  const prisma = { whatsappCampaign: campaigns, whatsappCampaignRecipient: recipients, systemSettings: settings };
  const sent = [];
  const client = { async sendMessage(phone, text, opts) {
    const o = outcomes[phone];
    if (typeof o === 'function') await o();
    if (o && o.error) throw Object.assign(new Error(o.error), { status: o.status, userMessage: o.error });
    sent.push({ phone, text, opts, at: clock });
    return { idMessage: 'x' };
  } };
  const timers = [];
  const make = () => new BulkRunner({
    prisma, getClient: async () => client, now: () => clock, random: () => randoms[ri++ % randoms.length], log: () => {},
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; }, clearTimer: (t) => { t.cleared = true; },
  });
  const runner = make();
  const campaign = (over = {}, people = ['905321111111', '905322222222', '905323333333']) => {
    const c = campaigns.add({ storeId: 'st1', name: 'K', message: 'Merhaba {ad}', minDelaySec: 12, maxDelaySec: 16, dailyLimit: 0, status: 'running', statusNote: null, nextSendAt: null, startedAt: new Date(clock), finishedAt: null, ...over });
    people.forEach((p, i) => recipients.add({ campaignId: c.id, position: i + 1, phone: p, name: `Kişi${i + 1}`, vars: null, status: 'pending', error: null, sentAt: null }));
    return c;
  };
  return {
    prisma, runner, make, client, sent, timers, campaigns, recipients, campaign,
    advance: (ms) => { clock += ms; }, at: () => clock, set: (ms) => { clock = ms; },
    rec: (phone) => recipients.rows.find((r) => r.phone === phone),
  };
}
const ms = (d) => (d ? new Date(d).getTime() : null);

test('the first number goes at once, every later one only after its random pause (min..max seconds)', async () => {
  const w = world({ randoms: [0, 1, 0.5] });     // pauses: min, max, middle
  const c = w.campaign({}, ['905321111111', '905322222222', '905323333333', '905324444444']);
  const t0 = w.at();
  await w.runner.tick();
  assert.equal(w.sent.length, 1); assert.equal(w.sent[0].phone, '905321111111');
  assert.equal(ms(c.nextSendAt), t0 + 12000, 'first pause = the minimum (12 s)');

  w.advance(11999); await w.runner.tick();
  assert.equal(w.sent.length, 1, 'nothing goes out before the pause is over');
  w.advance(1); await w.runner.tick();
  assert.equal(w.sent.length, 2);
  assert.equal(ms(c.nextSendAt), w.at() + 16000, 'second pause = the maximum (16 s)');

  w.advance(16000); await w.runner.tick();
  assert.equal(w.sent.length, 3);
  assert.equal(ms(c.nextSendAt), w.at() + 14000, 'third pause = the middle (14 s)');
  assert.ok(w.sent.every((s) => s.opts && s.opts.bulk === true), 'sent as bulk (the hourly valve of the notifications is left alone)');
});

test('every pause lies between the minimum and the maximum, with fractions of a second', async () => {
  const w = world({ randoms: [0.1234, 0.9876, 0.5, 0.0001, 0.9999] });
  const people = Array.from({ length: 6 }, (_, i) => `90532${String(1000000 + i)}`);
  const c = w.campaign({ minDelaySec: 12, maxDelaySec: 16 }, people);
  const seen = [];
  for (let i = 0; i < 5; i++) { await w.runner.tick(); seen.push(ms(c.nextSendAt) - w.at()); w.set(ms(c.nextSendAt)); }
  assert.ok(seen.every((d) => d >= 12000 && d <= 16000), seen.join(','));
  assert.notEqual(new Set(seen).size, 1, 'the pauses differ');
  assert.ok(seen.some((d) => d % 1000 !== 0), 'not only whole seconds');
});

test('a pause shorter than the floor is raised to it, equal min and max give a fixed pause', async () => {
  const w = world({ randoms: [0.7] });
  assert.equal(w.runner.delayMs({ minDelaySec: 1, maxDelaySec: 2 }), 5000);
  assert.equal(w.runner.delayMs({ minDelaySec: 30, maxDelaySec: 30 }), 30000);
  assert.equal(w.runner.delayMs({ minDelaySec: 12, maxDelaySec: 8 }), 12000, 'a reversed range never gives less than the minimum');
});

test('the message is made for each person and the last number ends the campaign without another wait', async () => {
  const w = world();
  const c = w.campaign({ message: 'Merhaba {ad}, {sehir|orada} için' }, ['905321111111', '905322222222']);
  w.rec('905321111111').vars = JSON.stringify({ sehir: 'Ankara' });
  await w.runner.tick();
  assert.equal(w.sent[0].text, 'Merhaba Kişi1, Ankara için');
  w.advance(20000); await w.runner.tick();
  assert.equal(w.sent[1].text, 'Merhaba Kişi2, orada için');
  assert.equal(c.status, 'done'); assert.ok(c.finishedAt); assert.equal(c.nextSendAt, null);
  assert.deepEqual(w.recipients.rows.map((r) => r.status), ['sent', 'sent']);
  assert.ok(w.recipients.rows.every((r) => r.sentAt), 'the time of sending is kept');
});

test('a campaign without numbers left is closed; a paused or draft campaign sends nothing', async () => {
  const w = world();
  const empty = w.campaign({}, []);
  const paused = w.campaign({ status: 'paused' }); const draft = w.campaign({ status: 'draft' });
  await w.runner.tick();
  assert.equal(empty.status, 'done'); assert.equal(w.sent.length, 0);
  assert.equal(paused.status, 'paused'); assert.equal(draft.status, 'draft');
});

test('only the oldest running campaign sends: the number is shared', async () => {
  const w = world();
  const a = w.campaign({ name: 'A', startedAt: new Date(w.at() - 5000) }, ['905321111111', '905322222222']);
  const b = w.campaign({ name: 'B', startedAt: new Date(w.at()) }, ['905329999999']);
  await w.runner.tick(); w.advance(20000); await w.runner.tick();
  assert.deepEqual(w.sent.map((s) => s.phone), ['905321111111', '905322222222']);
  assert.equal(a.status, 'done'); assert.equal(b.status, 'running');
  await w.runner.tick();   // A is over: B takes its turn
  assert.deepEqual(w.sent.map((s) => s.phone).slice(2), ['905329999999']);
});

test('a number with no WhatsApp account is marked failed and the campaign goes on (it is not a fault of the connection)', async () => {
  const w = world({ outcomes: { '905322222222': { status: 422, error: '••••2222 numarasında WhatsApp hesabı bulunamadı.' } } });
  const c = w.campaign();
  for (let i = 0; i < 3; i++) { await w.runner.tick(); w.advance(20000); }
  assert.deepEqual(w.sent.map((s) => s.phone), ['905321111111', '905323333333']);
  assert.equal(w.rec('905322222222').status, 'failed'); assert.match(w.rec('905322222222').error, /hesabı bulunamadı/);
  assert.equal(c.status, 'done');
});

test(`${FAIL_STREAK_PAUSE} failed sends in a row stop the campaign by itself and say why; a success in between resets the count`, async () => {
  const bad = { status: 502, error: 'WhatsApp mesajı gönderemedi: timeout' };
  const people = Array.from({ length: 11 }, (_, i) => `90532${String(1000000 + i)}`);
  const outcomes = {}; people.slice(0, 4).forEach((p) => { outcomes[p] = bad; });          // 4 failures, 1 success, then failures again
  people.slice(5).forEach((p) => { outcomes[p] = bad; });
  const w = world({ outcomes });
  const c = w.campaign({}, people);
  for (let i = 0; i < 5; i++) { await w.runner.tick(); w.advance(20000); }
  assert.equal(c.status, 'running', '4 failures, then a success: still running');
  for (let i = 0; i < 5; i++) { await w.runner.tick(); w.advance(20000); }
  assert.equal(c.status, 'paused');
  assert.match(c.statusNote, /Üst üste 5 mesaj gönderilemedi/); assert.match(c.statusNote, /timeout/);
  assert.equal(w.recipients.rows.filter((r) => r.status === 'failed').length, 9);
  assert.equal(w.recipients.rows.filter((r) => r.status === 'pending').length, 1, 'the 11th waits for the admin to continue');
  const before = w.sent.length; await w.runner.tick();
  assert.equal(w.sent.length, before, 'a paused campaign sends nothing');
});

test('WhatsApp not linked / restricted: the campaign pauses with the sentence, the number is not marked failed', async () => {
  const w = world({ outcomes: { '905321111111': { status: 409, error: 'WhatsApp henüz bağlanmadı. WhatsApp sayfasında “QR Kodu Göster” ile telefonunuzu bağlayın.' } } });
  const c = w.campaign();
  await w.runner.tick();
  assert.equal(c.status, 'paused'); assert.match(c.statusNote, /henüz bağlanmadı/);
  assert.equal(w.rec('905321111111').status, 'pending', 'it will be sent when the campaign is continued');
  assert.equal(w.sent.length, 0);
  const f = world({ outcomes: { '905321111111': { status: 403, error: 'WhatsApp bu numaraya erişimi kısıtlamış görünüyor (403).' } } });
  const c2 = f.campaign(); await f.runner.tick();
  assert.equal(c2.status, 'paused'); assert.match(c2.statusNote, /kısıtlamış/);
});

test('a connection that does not come up: the same number is tried again in a minute, and after 5 tries the campaign pauses', async () => {
  const w = world({ outcomes: { '905321111111': { status: 503, error: 'WhatsApp bağlantısı kurulamadı (zaman aşımı).' } } });
  const c = w.campaign();
  await w.runner.tick();
  assert.equal(c.status, 'running'); assert.equal(w.rec('905321111111').status, 'pending');
  assert.equal(ms(c.nextSendAt), w.at() + TRANSIENT_WAIT_MS); assert.match(c.statusNote, /1 dakika sonra/);
  for (let i = 1; i < TRANSIENT_STREAK_PAUSE; i++) { w.advance(TRANSIENT_WAIT_MS); await w.runner.tick(); }
  assert.equal(c.status, 'paused'); assert.match(c.statusNote, /5 denemede kurulamadı/);
  assert.equal(w.rec('905321111111').status, 'pending');
});

test('the connection comes back after a failed try: the note disappears and the campaign carries on', async () => {
  let down = true;
  const w = world({ outcomes: { '905321111111': async () => { if (down) throw Object.assign(new Error('x'), { status: 503, userMessage: 'bağlantı yok' }); } } });
  const c = w.campaign();
  await w.runner.tick(); assert.ok(c.statusNote);
  down = false; w.advance(TRANSIENT_WAIT_MS); await w.runner.tick();
  assert.equal(w.sent.length, 1); assert.equal(c.statusNote, null);
});

test('daily limit: counts what all campaigns sent today, waits for 09:00 the next morning, then continues', async () => {
  const w = world({ now: Date.UTC(2026, 10, 13, 15, 0, 0) });          // 18:00 in Turkey
  const old = w.campaign({ status: 'done' }, ['905320000001', '905320000002']);
  old.status = 'done'; w.recipients.rows.forEach((r) => { r.status = 'sent'; r.sentAt = new Date(w.at() - 3600000); });
  const c = w.campaign({ dailyLimit: 2 });
  await w.runner.tick();
  assert.equal(w.sent.length, 0, 'the other campaign already used the 2 messages of today');
  const tomorrow9 = Date.UTC(2026, 10, 14, 6, 0, 0);                    // 09:00 Turkey = 06:00 UTC
  assert.equal(ms(c.nextSendAt), tomorrow9); assert.match(c.statusNote, /Günlük sınıra \(2 mesaj\)/); assert.equal(c.status, 'running');
  w.set(tomorrow9 - 1000); await w.runner.tick(); assert.equal(w.sent.length, 0);
  w.set(tomorrow9); await w.runner.tick(); assert.equal(w.sent.length, 1, 'a new day: it goes on by itself');
  assert.equal(c.statusNote, null);
});

test('the day of the daily limit is the Turkish day', () => {
  assert.equal(dayStartTr(Date.UTC(2026, 10, 12, 21, 30, 0)), Date.UTC(2026, 10, 12, 21, 0, 0), '00:30 in Turkey belongs to the new day');
  assert.equal(dayStartTr(Date.UTC(2026, 10, 12, 20, 59, 0)), Date.UTC(2026, 10, 11, 21, 0, 0));
});

test('messages sent yesterday do not count today', async () => {
  const w = world({ now: Date.UTC(2026, 10, 13, 9, 0, 0) });
  const c = w.campaign({}, ['905320000001']);
  w.rec('905320000001').status = 'sent'; w.rec('905320000001').sentAt = new Date(Date.UTC(2026, 10, 12, 20, 0, 0));   // 23:00 yesterday in Turkey
  assert.equal(await sentTodayFor(w.prisma, 'st1', w.at()), 0);
  w.rec('905320000001').sentAt = new Date(Date.UTC(2026, 10, 12, 21, 0, 0));                                       // 00:00 today
  assert.equal(await sentTodayFor(w.prisma, 'st1', w.at()), 1);
  assert.ok(c);
});

test('pausing while a message is on its way is not undone by the runner', async () => {
  const w = world();
  let c;
  w.client.sendMessage = async (phone, text, opts) => { c.status = 'paused'; w.sent.push({ phone, text, opts }); };   // the admin presses “Duraklat” meanwhile
  c = w.campaign();
  await w.runner.tick();
  assert.equal(c.status, 'paused', 'still paused'); assert.equal(c.nextSendAt, null);
  assert.equal(w.rec('905321111111').status, 'sent', 'the message that was on its way is recorded');
  await w.runner.tick(); assert.equal(w.sent.length, 1);
});

test('after a restart the next number is sent, nobody is sent twice; one that was in flight is marked failed, not resent', async () => {
  const w = world();
  const c = w.campaign({}, ['905321111111', '905322222222', '905323333333']);
  await w.runner.tick();                                                  // number 1 sent, then the process "dies"
  w.rec('905322222222').status = 'sending'; w.rec('905322222222').updatedAt = new Date(w.at());   // number 2 was in flight
  w.advance(STUCK_AFTER_MS + 1000);
  const fresh = w.make();                                                 // the new process
  await fresh.resume();
  assert.equal(w.rec('905322222222').status, 'failed'); assert.match(w.rec('905322222222').error, /kesildi/);
  assert.ok(w.timers.some((t) => !t.cleared), 'a wake-up was planned');
  await fresh.tick();
  assert.deepEqual(w.sent.map((s) => s.phone), ['905321111111', '905323333333'], 'number 1 is not sent again, number 2 is not resent');
  assert.equal(c.status, 'done');
});

test('a number that is in flight right now (another process) is left alone', async () => {
  const w = world();
  w.campaign({}, ['905321111111']);
  w.rec('905321111111').status = 'sending'; w.rec('905321111111').updatedAt = new Date(w.at());
  w.advance(10000);
  assert.equal(await w.runner.heal(true), 0);
  assert.equal(w.rec('905321111111').status, 'sending');
});

test('two processes at the same moment: every number is sent once', async () => {
  const w = world();
  w.campaign({}, ['905321111111', '905322222222']);
  const other = w.make();
  await Promise.all([w.runner.tick(), other.tick()]);
  assert.equal(w.sent.length, 1, 'one claimed the number, the other did not send it too');
  assert.equal(w.rec('905321111111').status, 'sent');
});

test('a tick that is already running is not started twice', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const w = world({ outcomes: { '905321111111': () => gate } });
  w.campaign({}, ['905321111111', '905322222222']);
  const first = w.runner.tick();
  await new Promise((r) => setImmediate(r));
  await w.runner.tick();                                                  // returns at once: busy
  release(); await first;
  assert.equal(w.sent.length, 1);
});

test('the wake-up timer is planned for the end of the pause, and only one exists at a time', async () => {
  const w = world({ randoms: [0.5] });
  w.campaign();
  await w.runner.tick();
  const live = w.timers.filter((t) => !t.cleared);
  assert.equal(live.length, 1); assert.equal(live[0].ms, 14000);
  w.runner.kick();                                                         // sooner: replaces the planned one
  assert.equal(w.timers.filter((t) => !t.cleared).length, 1); assert.equal(w.timers.filter((t) => !t.cleared)[0].ms, 0);
  w.runner.schedule(60000);                                                // later: ignored
  assert.equal(w.timers.filter((t) => !t.cleared).length, 1);
});

test('ensure() starts a looker only when nobody is looking', async () => {
  const w = world();
  w.runner.ensure(); assert.equal(w.timers.length, 1);
  w.runner.ensure(); assert.equal(w.timers.length, 1);
});

test('nothing breaks when the database fails: the round is tried again later', async () => {
  const w = world();
  w.campaign();
  const real = w.campaigns.findMany; let boom = true;
  w.campaigns.findMany = async (a) => { if (boom) { boom = false; throw new Error('db down'); } return real(a); };
  await w.runner.tick();
  assert.equal(w.sent.length, 0);
  const t = w.timers.filter((x) => !x.cleared).pop();
  assert.equal(t.ms, 30000);
});

test('the fifth failure on the very last number just ends the campaign (nothing is left to continue)', async () => {
  const bad = { status: 502, error: 'WhatsApp mesajı gönderemedi: x' };
  const people = Array.from({ length: 5 }, (_, i) => `90532${String(1000000 + i)}`);
  const w = world({ outcomes: Object.fromEntries(people.map((p) => [p, bad])) });
  const c = w.campaign({}, people);
  for (let i = 0; i < 5; i++) { await w.runner.tick(); w.advance(20000); }
  assert.equal(c.status, 'done');
  assert.equal(w.recipients.rows.filter((r) => r.status === 'failed').length, 5);
});
