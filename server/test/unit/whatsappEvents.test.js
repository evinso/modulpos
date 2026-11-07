const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { EVENTS, KEYS } = require('../../src/services/whatsapp/events');

// whatsappService reads its settings through the database client; give it a stand-in
const dbPath = require.resolve('../../src/config/database');
let SETTINGS = {};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { systemSettings: { findMany: async ({ where }) => Object.entries(SETTINGS).filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value })) } } };
const wa = require('../../src/services/whatsappService');
const { planSubscriptionAlerts } = require('../../src/services/subscriptionAlerts');

const src = path.join(__dirname, '../../src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const files = walk(src).filter((f) => !f.endsWith('events.js'));
const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

test('the event list is well formed: unique keys, label, group, audience', () => {
  assert.equal(new Set(KEYS).size, KEYS.length);
  for (const e of EVENTS) assert.ok(e.key && e.label && e.group && ['admin', 'user', 'both'].includes(e.to), e.key);
});

test('every event key used in the code exists in the list, and every listed event is wired somewhere', () => {
  const used = new Set([...text.matchAll(/isEventEnabled\('([a-z_]+)'\)/g)].map((m) => m[1]));
  for (const m of text.matchAll(/waEvent: '([a-z_]+)'/g)) used.add(m[1]);
  for (const k of used) assert.ok(KEYS.includes(k), `code uses unknown event "${k}"`);
  for (const k of KEYS) assert.ok(used.has(k), `event "${k}" is listed but nothing sends it`);
});

test('every notifier that checks an event is also called from a route or service', () => {
  const fns = [...fs.readFileSync(path.join(src, 'services/whatsappService.js'), 'utf8').matchAll(/^async function (notify[A-Za-z]+)\(/gm)].map((m) => m[1]);
  const other = files.filter((f) => !f.endsWith('whatsappService.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const f of fns) assert.ok(other.includes(`.${f}(`), `${f} is never called`);
});

const DAY = 86400000; const now = Date.UTC(2026, 10, 7, 12);
test('subscription alerts: 3 days before and just after, once per end date, never for old history', () => {
  const plan = (rows, markers = new Map()) => planSubscriptionAlerts(rows, markers, now);
  assert.equal(plan([{ userId: 'a', endDate: new Date(now + 2 * DAY) }])[0].kind, 'expiring');
  assert.equal(plan([{ userId: 'a', endDate: new Date(now + 5 * DAY) }]).length, 0);
  assert.equal(plan([{ userId: 'a', endDate: new Date(now - DAY) }])[0].kind, 'expired');
  assert.equal(plan([{ userId: 'a', endDate: new Date(now - 30 * DAY) }]).length, 0);
  assert.equal(plan([{ userId: 'a', endDate: null }]).length, 0);
  const first = plan([{ userId: 'a', endDate: new Date(now + 2 * DAY) }]);
  assert.equal(plan([{ userId: 'a', endDate: new Date(now + 2 * DAY) }], new Map([['a', first[0].marker]])).length, 0, 'already announced');
  const exp = plan([{ userId: 'a', endDate: new Date(now + 2 * DAY) }], new Map([['a', first[0].marker]]));
  assert.equal(exp.length, 0);
  assert.equal(planSubscriptionAlerts([{ userId: 'a', endDate: new Date(now + 2 * DAY) }], new Map([['a', first[0].marker]]), now + 3 * DAY)[0].kind, 'expired', 'the next kind is announced too');
});

// ── the notifiers against a fake WAHA ───────────────────────────────────────────────────────────────────────
function fakeWaha() {
  const sent = [];
  const server = http.createServer((req, res) => {
    const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
      if (req.url === '/api/sendText') sent.push(JSON.parse(Buffer.concat(c).toString()));
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"x"}');
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ sent, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((d) => { server.closeAllConnections(); server.close(d); }) })));
}
async function run(settings, fn) {
  SETTINGS = { waha_enabled: 'true', waha_admin_phone: '905551112233', waha_session: 'default', ...settings }; wa.invalidateCache();
  const w = await fakeWaha(); const saved = process.env.WAHA_BASE_URL; process.env.WAHA_BASE_URL = w.url;
  try { await fn(w.sent); } finally { await w.close(); if (saved === undefined) delete process.env.WAHA_BASE_URL; else process.env.WAHA_BASE_URL = saved; }
}
const to = (sent) => sent.map((m) => m.chatId).sort();
const ADMIN = '905551112233@c.us'; const USER = '905321234567@c.us';
const user = { name: 'Ali', email: 'ali@example.com', phone: '05321234567' };
const ON = (...k) => ({ waha_events: JSON.stringify(k) });

test('support: a customer message reaches the admin only; a status change reaches admin and customer', async () => {
  await run(ON('support_user_reply', 'support_status'), async (sent) => {
    await wa.notifySupportUserReply(user, 'Konu', 'Merhaba'); assert.deepEqual(to(sent), [ADMIN]); assert.match(sent[0].text, /Merhaba/);
    sent.length = 0; await wa.notifySupportStatus(user, 'Konu', 'resolved'); assert.deepEqual(to(sent), [USER, ADMIN].sort()); assert.match(sent[0].text, /Çözüldü/);
  });
  await run(ON('new_user'), async (sent) => { await wa.notifySupportUserReply(user, 'K', 'x'); await wa.notifySupportStatus(user, 'K', 'closed'); assert.equal(sent.length, 0, 'unticked events stay silent'); });
});

test('XML update: only when something changed; the message carries the numbers, incl. products that left the feed', async () => {
  await run(ON('product_sync'), async (sent) => {
    await wa.notifyProductSync('Mağaza', 'biii', 0, 0, 0, '05321234567'); assert.equal(sent.length, 0, 'nothing changed');
    await wa.notifyProductSync('Mağaza', 'biii', 2, 5, 3, '05321234567');
    assert.deepEqual(to(sent), [USER, ADMIN].sort()); assert.match(sent[0].text, /Yeni: 2/); assert.match(sent[0].text, /Güncellenen: 5/); assert.match(sent[0].text, /kalkan: 3/);
  });
});

test('bell notifications are forwarded only with an event key that is ticked', async () => {
  await run(ON('buybox'), async (sent) => {
    await wa.forwardInAppNotification('05321234567', 'T', 'M');                    // no event: never
    await wa.forwardInAppNotification('05321234567', 'T', 'M', 'product_send');    // not ticked
    assert.equal(sent.length, 0);
    await wa.forwardInAppNotification('05321234567', 'BuyBox', 'M', 'buybox'); assert.deepEqual(to(sent), [USER]);
  });
});

test('subscription ending soon goes to admin and user', async () => {
  await run(ON('subscription_expiring'), async (sent) => {
    await wa.notifySubscriptionExpiring(user, new Date(Date.now() + 2 * DAY), 2); assert.deepEqual(to(sent), [USER, ADMIN].sort()); assert.match(sent[0].text, /2 gün/);
  });
});
