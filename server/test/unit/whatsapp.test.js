const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const WahaService = require('../../src/services/whatsapp/wahaService');
WahaService.delay = async () => {};   // no real waiting between the status polls

// whatsappService reads its settings through the database client; give it a stand-in instead of connecting
const dbPath = require.resolve('../../src/config/database');
let SETTINGS = {};
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { systemSettings: { findMany: async ({ where }) => Object.entries(SETTINGS).filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value })) } },
};
const wa = require('../../src/services/whatsappService');
const useSettings = (s) => { SETTINGS = s; wa.invalidateCache(); };

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');

// A tiny stand-in for a WAHA server. `routes` maps "METHOD /path" to { status, type, body } or a function (request) => that.
function fakeWaha(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      const url = new URL(req.url, 'http://x');
      const rec = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body };
      requests.push(rec);
      const hit = routes[`${req.method} ${url.pathname}`];
      const r = typeof hit === 'function' ? hit(rec) : hit;
      if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ statusCode: 404, message: 'not found' })); }
      const out = Buffer.isBuffer(r.body) ? r.body : Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}));
      res.writeHead(r.status || 200, { 'content-type': r.type || 'application/json' });
      res.end(out);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise((r) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(r); }),
  })));
}

async function withWaha(routes, fn) {
  const waha = await fakeWaha(routes);
  const saved = [process.env.WAHA_BASE_URL, process.env.WAHA_API_KEY];
  process.env.WAHA_BASE_URL = waha.url; process.env.WAHA_API_KEY = 'test-key';
  try { return await fn(waha); }
  finally {
    await waha.close();
    for (const [k, v] of [['WAHA_BASE_URL', saved[0]], ['WAHA_API_KEY', saved[1]]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const json = (body, status = 200) => ({ status, body });
const status = (s) => json({ name: 'default', status: s });

// ── phone numbers ──────────────────────────────────────────────────────────────────────────────────────────
test('Turkish numbers typed the local way get the country code; numbers that already have one are left alone', () => {
  const n = WahaService.normalizePhone;
  assert.equal(n('05321234567'), '905321234567');
  assert.equal(n('0532 123 45 67'), '905321234567');
  assert.equal(n('532 123 45 67'), '905321234567');
  assert.equal(n('+90 532 123 45 67'), '905321234567');
  assert.equal(n('905321234567'), '905321234567');
  assert.equal(n('00905321234567'), '905321234567');
  assert.equal(n('4915112345678'), '4915112345678');
  assert.equal(n('905321234567@c.us'), '905321234567@c.us');
  assert.equal(n(null), '');
  assert.equal(new WahaService()._normalizeChatId('05321234567'), '905321234567@c.us');
});

// ── error wording ──────────────────────────────────────────────────────────────────────────────────────────
test('error messages say what to fix', () => {
  const saved = process.env.WAHA_BASE_URL;
  try {
    delete process.env.WAHA_BASE_URL;
    assert.match(WahaService.describeError(new Error('ECONNREFUSED')), /WAHA_BASE_URL/);            // never configured
    process.env.WAHA_BASE_URL = 'https://waha.example.com/';
    assert.match(WahaService.describeError(new Error('ECONNREFUSED')), /ulaşılamıyor \(waha\.example\.com\)/);   // configured but down
    assert.match(WahaService.describeError({ response: { status: 401 } }), /WAHA_API_KEY/);
    assert.match(WahaService.describeError({ response: { status: 422, data: { message: 'Session status is not as expected' } } }), /Session status is not as expected/);
    assert.match(WahaService.describeError({ response: { status: 422, data: Buffer.from(JSON.stringify({ message: 'from a buffer' })) } }), /from a buffer/);
    assert.match(WahaService.describeError({ response: { status: 500 } }), /HTTP 500/);
  } finally { if (saved === undefined) delete process.env.WAHA_BASE_URL; else process.env.WAHA_BASE_URL = saved; }
});

// ── status ─────────────────────────────────────────────────────────────────────────────────────────────────
test('status: working / waiting for a scan / not created yet / key refused / server down', async () => {
  await withWaha({ 'GET /api/sessions/default': status('WORKING') }, async () => {
    assert.deepEqual(await new WahaService('default').getStatus(), { stateInstance: 'authorized', wahaStatus: 'WORKING' });
  });
  await withWaha({ 'GET /api/sessions/default': status('SCAN_QR_CODE') }, async () => {
    assert.equal((await new WahaService('default').getStatus()).stateInstance, 'notAuthorized');
  });
  await withWaha({}, async () => {
    const s = await new WahaService('default').getStatus();
    assert.equal(s.stateInstance, 'notAuthorized'); assert.equal(s.wahaStatus, 'NOT_CREATED'); assert.ok(s.message);
  });
  await withWaha({ 'GET /api/sessions/default': json({ message: 'Unauthorized' }, 401) }, async () => {
    const s = await new WahaService('default').getStatus();
    assert.equal(s.stateInstance, 'error'); assert.match(s.message, /WAHA_API_KEY/);
  });
  const down = await fakeWaha({}); await down.close();
  const saved = process.env.WAHA_BASE_URL; process.env.WAHA_BASE_URL = down.url;
  try {
    const s = await new WahaService('default').getStatus();
    assert.equal(s.stateInstance, 'unreachable'); assert.match(s.message, /ulaşılamıyor/);
  } finally { if (saved === undefined) delete process.env.WAHA_BASE_URL; else process.env.WAHA_BASE_URL = saved; }
});

// ── QR code ────────────────────────────────────────────────────────────────────────────────────────────────
test('QR: a new session is created, then the picture is asked for as image/png and returned as base64', async () => {
  let created = false;
  await withWaha({
    'GET /api/sessions/default': () => (created ? status('SCAN_QR_CODE') : json({ message: 'Session not found' }, 404)),
    'POST /api/sessions': () => { created = true; return json({ name: 'default', status: 'STARTING' }, 201); },
    'GET /api/default/auth/qr': { type: 'image/png', body: PNG },
  }, async (waha) => {
    const r = await new WahaService('default').getQR();
    assert.equal(r.type, 'qrCode'); assert.equal(r.message, PNG.toString('base64')); assert.equal(r.mimetype, 'image/png');
    const make = waha.requests.find((x) => x.method === 'POST' && x.path === '/api/sessions');
    assert.deepEqual(make.body, { name: 'default', config: { proxy: null } });
    const qr = waha.requests.find((x) => x.path === '/api/default/auth/qr');
    assert.equal(qr.headers.accept, 'image/png'); assert.equal(qr.query.format, 'image'); assert.equal(qr.headers['x-api-key'], 'test-key');
  });
});

test('QR: if WAHA answers with base64 JSON anyway, the base64 is used as it is (not encoded a second time)', async () => {
  await withWaha({
    'GET /api/sessions/default': status('SCAN_QR_CODE'),
    'GET /api/default/auth/qr': { type: 'application/json; charset=utf-8', body: { mimetype: 'image/jpeg', data: 'QUJD' } },
  }, async () => {
    const r = await new WahaService('default').getQR();
    assert.deepEqual(r, { type: 'qrCode', message: 'QUJD', mimetype: 'image/jpeg' });
  });
});

test('QR: already linked -> no QR is fetched', async () => {
  await withWaha({ 'GET /api/sessions/default': status('WORKING') }, async (waha) => {
    assert.equal((await new WahaService('default').getQR()).type, 'alreadyLogged');
    assert.equal(waha.requests.some((x) => x.path.endsWith('/auth/qr')), false);
  });
});

test('QR: a FAILED session is stopped and started again, a STOPPED one is started', async () => {
  for (const [from, calls] of [['FAILED', ['stop', 'start']], ['STOPPED', ['start']]]) {
    let st = from;
    await withWaha({
      'GET /api/sessions/default': () => status(st),
      'POST /api/sessions/default/stop': () => { st = 'STOPPED'; return json({}); },
      'POST /api/sessions/default/start': () => { st = 'SCAN_QR_CODE'; return json({}); },
      'GET /api/default/auth/qr': { type: 'image/png', body: PNG },
    }, async (waha) => {
      assert.equal((await new WahaService('default').getQR()).type, 'qrCode', from);
      assert.deepEqual(waha.requests.filter((x) => x.method === 'POST').map((x) => x.path.split('/').pop()), calls, from);
    });
  }
});

test('QR: problems come back as a readable error, never as an empty "loading"', async () => {
  await withWaha({ 'GET /api/sessions/default': json({ message: 'Unauthorized' }, 401) }, async () => {
    const r = await new WahaService('default').getQR();
    assert.equal(r.type, 'error'); assert.match(r.message, /WAHA_API_KEY/);
  });
  const down = await fakeWaha({}); await down.close();
  const saved = process.env.WAHA_BASE_URL; process.env.WAHA_BASE_URL = down.url;
  try {
    const r = await new WahaService('default').getQR();
    assert.equal(r.type, 'error'); assert.match(r.message, /ulaşılamıyor/);
  } finally { if (saved === undefined) delete process.env.WAHA_BASE_URL; else process.env.WAHA_BASE_URL = saved; }
  await withWaha({ 'GET /api/sessions/default': status('SCAN_QR_CODE'), 'GET /api/default/auth/qr': { type: 'text/html', body: '<html>login</html>' } }, async () => {
    const r = await new WahaService('default').getQR();
    assert.equal(r.type, 'error'); assert.match(r.message, /başka bir sayfa/);
  });
});

test('QR: "not ready yet" (422) and a session that is still starting are "loading", with a sentence', async () => {
  await withWaha({ 'GET /api/sessions/default': status('SCAN_QR_CODE'), 'GET /api/default/auth/qr': json({ message: 'Session status is not as expected' }, 422) }, async () => {
    const r = await new WahaService('default').getQR();
    assert.equal(r.type, 'loading'); assert.ok(r.message);
  });
  await withWaha({ 'GET /api/sessions/default': status('STARTING') }, async () => {
    const r = await new WahaService('default').getQR();
    assert.equal(r.type, 'loading'); assert.ok(r.message);
  });
});

// ── sending ────────────────────────────────────────────────────────────────────────────────────────────────
test('sending: chat id is completed, the session and key are sent, odd session names are URL-encoded', async () => {
  await withWaha({ 'POST /api/sendText': json({ id: 'm1' }), 'GET /api/sessions/a%20b': status('WORKING') }, async (waha) => {
    const svc = new WahaService('a b');
    assert.deepEqual(await svc.sendMessage('0532 123 45 67', 'merhaba'), { idMessage: 'm1' });
    const sent = waha.requests.find((x) => x.path === '/api/sendText');
    assert.deepEqual(sent.body, { chatId: '905321234567@c.us', text: 'merhaba', session: 'a b' });
    assert.equal(sent.headers['x-api-key'], 'test-key');
    await svc.getStatus();
    assert.ok(waha.requests.some((x) => x.path === '/api/sessions/a%20b'));
  });
});

test('the address may be typed with a trailing slash or without https://', async () => {
  await withWaha({ 'GET /api/sessions/default': status('WORKING') }, async (waha) => {
    process.env.WAHA_BASE_URL = `${waha.url}///`;
    assert.equal((await new WahaService('default').getStatus()).stateInstance, 'authorized');
    assert.equal(waha.requests[0].path, '/api/sessions/default');
  });
});

// ── who sends what to whom (whatsappService) ───────────────────────────────────────────────────────────────
const ADMIN = '905551112233';
const base = { waha_enabled: 'true', waha_session: 'default', waha_admin_phone: ADMIN, waha_events: JSON.stringify(['credit_topup']) };
const sentTo = (waha) => waha.requests.filter((r) => r.path === '/api/sendText').map((r) => r.body.chatId).sort();

test('a notification for a user goes out through the one session the admin linked: to the admin and to the user', async () => {
  useSettings(base);
  await withWaha({ 'POST /api/sendText': json({ id: 'x' }) }, async (waha) => {
    await wa.notifyCreditTopup({ name: 'Ali', email: 'ali@example.com', phone: '05321234567' }, 50);
    assert.deepEqual(sentTo(waha), ['905321234567@c.us', `${ADMIN}@c.us`].sort());
    const all = waha.requests.filter((r) => r.path === '/api/sendText');
    assert.ok(all.every((r) => r.body.session === 'default' && r.headers['x-api-key'] === 'test-key'));   // one sender, whoever the user is
  });
});

test('the session comes from the admin setting only', async () => {
  useSettings({ ...base, waha_session: 'hat1' });
  await withWaha({ 'POST /api/sendText': json({ id: 'x' }) }, async (waha) => {
    await wa.notifyCreditTopup({ email: 'ali@example.com', phone: '05321234567' }, 5);
    assert.ok(waha.requests.filter((r) => r.path === '/api/sendText').every((r) => r.body.session === 'hat1'));
  });
});

test('the same person typed two ways gets the message once; a user without a phone only the admin does', async () => {
  useSettings(base);
  await withWaha({ 'POST /api/sendText': json({ id: 'x' }) }, async (waha) => {
    await wa.notifyCreditTopup({ email: 'a@example.com', phone: '05551112233' }, 5);     // = the admin, local format
    assert.deepEqual(sentTo(waha), [`${ADMIN}@c.us`]);
    waha.requests.length = 0;
    await wa.notifyCreditTopup({ email: 'b@example.com', phone: null }, 5);
    assert.deepEqual(sentTo(waha), [`${ADMIN}@c.us`]);
  });
});

test('nothing is sent when notifications are off or the event is not ticked', async () => {
  await withWaha({ 'POST /api/sendText': json({ id: 'x' }) }, async (waha) => {
    useSettings({ ...base, waha_enabled: 'false' });
    await wa.notifyCreditTopup({ email: 'a@example.com', phone: '05321234567' }, 5);
    useSettings({ ...base, waha_events: JSON.stringify(['new_user']) });
    await wa.notifyCreditTopup({ email: 'a@example.com', phone: '05321234567' }, 5);
    assert.equal(waha.requests.length, 0);
  });
});

test('in-app notifications are forwarded to the user from the same session', async () => {
  useSettings(base);
  await withWaha({ 'POST /api/sendText': json({ id: 'x' }) }, async (waha) => {
    await wa.forwardInAppNotification('05321234567', 'Başlık', 'Mesaj');
    const r = waha.requests.find((x) => x.path === '/api/sendText');
    assert.equal(r.body.chatId, '905321234567@c.us'); assert.equal(r.body.session, 'default'); assert.match(r.body.text, /Başlık/);
  });
});

test('"Test Gönder" says why when it cannot send, and sends to the admin when it can', async () => {
  useSettings({ ...base, waha_enabled: 'false' });
  await assert.rejects(wa.sendAdminTest(), (e) => e.status === 400 && /kapalı/.test(e.message));
  useSettings({ ...base, waha_admin_phone: '' });
  await assert.rejects(wa.sendAdminTest(), (e) => e.status === 400 && /telefon/.test(e.message));
  useSettings(base);
  await withWaha({ 'POST /api/sendText': json({ message: 'Session status is not as expected' }, 422) }, async () => {
    await assert.rejects(wa.sendAdminTest(), (e) => e.status === 502 && /Session status is not as expected/.test(e.message));
  });
  await withWaha({ 'POST /api/sendText': json({ id: 'x' }) }, async (waha) => {
    await wa.sendAdminTest();
    assert.deepEqual(sentTo(waha), [`${ADMIN}@c.us`]);
  });
});
