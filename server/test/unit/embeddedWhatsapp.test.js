const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { EmbeddedWhatsapp, WhatsappError, MIN_GAP_MS, MAX_PER_HOUR, BACKOFF_MS } = require('../../src/services/whatsapp/embeddedService');
const { createDbStore, createMemoryStore, useStoreAuthState, storeIsLinked } = require('../../src/services/whatsapp/authStore');
const whatsapp = require('../../src/services/whatsapp');
const WahaService = require('../../src/services/whatsapp/wahaService');

let real;   // the real Baileys module: only its pure helpers (BufferJSON, proto, initAuthCreds) are used, nothing connects
test.before(async () => { real = await import('@whiskeysockets/baileys'); });

// ── a fake WhatsApp: sockets are scripted by the test, nothing touches the network ──────────────────────────
const R = { loggedOut: 401, badSession: 500, restartRequired: 515, connectionReplaced: 440, forbidden: 403, connectionClosed: 428, timedOut: 408 };
const closeWith = (sock, statusCode) => sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: Object.assign(new Error('closed ' + statusCode), { output: { statusCode } }) } });
const open = (sock) => sock.ev.emit('connection.update', { connection: 'open' });
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const LINKED = JSON.stringify({ registered: true, me: { id: '905321234567:7@s.whatsapp.net' } });

function makeEngine({ onSocket, linked = false, loadFails = false, store = createMemoryStore() } = {}) {
  const sockets = []; const scheduled = []; const delays = []; let clock = 1_000_000;
  const makeWASocket = (config) => {
    const ev = new EventEmitter();
    const sock = {
      ev, config, sent: [], lookups: [], ended: false, loggedOut: false,
      async onWhatsApp(jid) { sock.lookups.push(jid); return [{ jid, exists: !jid.startsWith('905550000000') }]; },
      async sendMessage(jid, content) { sock.sent.push({ jid, content }); return { key: { id: `M${sock.sent.length}` } }; },
      async logout() { sock.loggedOut = true; },
      end() { sock.ended = true; },
    };
    sockets.push(sock);
    if (onSocket) setImmediate(() => onSocket(sock, sockets.length));
    return sock;
  };
  const mod = {
    default: makeWASocket, DisconnectReason: R, BufferJSON: real.BufferJSON, proto: real.proto, initAuthCreds: real.initAuthCreds,
    makeCacheableSignalKeyStore: (keys) => keys, Browsers: real.Browsers, fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  };
  const loads = { n: 0 };
  const engine = new EmbeddedWhatsapp({
    loadBaileys: async () => { loads.n++; if (loadFails) throw new Error('Cannot find package'); return mod; },
    store, qrToPng: async (qr) => `PNG(${qr})`,
    delay: async (ms) => { delays.push(ms); await new Promise((r) => setImmediate(r)); },
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return { unref() {} }; },
    now: () => clock, jitter: () => 0, log: () => {},
  });
  if (linked) store.m.set('creds', LINKED);
  return { engine, sockets, scheduled, delays, store, loads, tick: (ms) => { clock += ms; } };
}
const asUser = (e) => e.message;

// ── status / QR ────────────────────────────────────────────────────────────────────────────────────────────
test('never linked: the status says so and nothing is loaded or opened', async () => {
  const t = makeEngine();
  const s = await t.engine.getStatus();
  assert.equal(s.stateInstance, 'notAuthorized'); assert.equal(s.wahaStatus, 'NOT_LINKED'); assert.match(s.message, /QR Kodu Göster/);
  assert.equal(t.loads.n, 0); assert.equal(t.sockets.length, 0);
});

test('QR: the connection is opened on demand and the QR comes back as a PNG', async () => {
  const t = makeEngine({ onSocket: (s) => s.ev.emit('connection.update', { connection: 'connecting', qr: '2@QRTEXT' }) });
  const r = await t.engine.getQR();
  assert.deepEqual(r, { type: 'qrCode', message: 'PNG(2@QRTEXT)', mimetype: 'image/png' });
  assert.equal(t.sockets.length, 1);
  assert.equal(t.sockets[0].config.version.join('.'), '2.3000.1');                     // the current WhatsApp Web version is asked for
  assert.equal(t.sockets[0].config.syncFullHistory, false); assert.equal(t.sockets[0].config.markOnlineOnConnect, false);
  assert.equal((await t.engine.getStatus()).wahaStatus, 'SCAN_QR_CODE');
  // QR renewed by WhatsApp: the next call returns the new one, still one connection
  t.sockets[0].ev.emit('connection.update', { qr: '2@NEWER' });
  assert.equal((await t.engine.getQR()).message, 'PNG(2@NEWER)'); assert.equal(t.sockets.length, 1);
});

test('QR: a real PNG is produced by the default converter', async () => {
  const { EmbeddedWhatsapp: E } = require('../../src/services/whatsapp/embeddedService');
  const e = new E({ loadBaileys: async () => ({ default: () => { const ev = new EventEmitter(); setImmediate(() => ev.emit('connection.update', { qr: '2@abc,def,ghi' })); return { ev, end() {} }; }, DisconnectReason: R, BufferJSON: real.BufferJSON, proto: real.proto, initAuthCreds: real.initAuthCreds, makeCacheableSignalKeyStore: (k) => k, Browsers: real.Browsers, fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }) }), store: createMemoryStore(), delay: () => new Promise((r) => setImmediate(r)), log: () => {} });
  const r = await e.getQR();
  assert.equal(r.type, 'qrCode');
  assert.equal(Buffer.from(r.message, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');   // PNG signature
});

test('QR: before WhatsApp has produced one, the answer is "loading", not an error', async () => {
  const t = makeEngine();                       // the socket never emits anything
  const r = await t.engine.getQR();
  assert.equal(r.type, 'loading'); assert.match(r.message, /QR hazırlanıyor/);
});

test('QR: a problem is reported in words', async () => {
  const t = makeEngine({ loadFails: true });
  const r = await t.engine.getQR();
  assert.equal(r.type, 'error'); assert.match(r.message, /bileşeni yüklenemedi/);
});

// ── scanning the QR ────────────────────────────────────────────────────────────────────────────────────────
test('after the scan WhatsApp asks for a restart: the connection is reopened with the same login and comes online', async () => {
  const t = makeEngine({ onSocket: (s, n) => { if (n === 1) s.ev.emit('connection.update', { qr: '2@Q' }); else open(s); } });
  await t.engine.getQR();
  const first = t.sockets[0];
  // the phone scanned: WhatsApp hands over the account, then drops the socket with "restart required"
  first.config.auth.creds.registered = true; first.config.auth.creds.me = { id: '905321234567:9@s.whatsapp.net' };
  first.ev.emit('creds.update', {});
  closeWith(first, R.restartRequired);
  await settle();
  assert.equal(t.sockets.length, 2);
  assert.equal(t.sockets[1].config.auth.creds, first.config.auth.creds, 'the live login object is reused (not re-read from the database)');
  assert.equal(first.config.auth.creds, t.engine.auth.state.creds);
  const s = await t.engine.getStatus();
  assert.equal(s.stateInstance, 'authorized'); assert.equal(s.message, 'Bağlı numara: ••••4567');
  assert.equal(await storeIsLinked(t.store), true, 'the login reached the store');
  assert.equal((await t.engine.getQR()).type, 'alreadyLogged');
});

// ── sending ────────────────────────────────────────────────────────────────────────────────────────────────
test('send: a saved login is reconnected on demand, the number is completed to 90… and looked up first', async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  const r = await t.engine.sendMessage('0532 123 45 67', 'merhaba');
  assert.deepEqual(r, { idMessage: 'M1' });
  const s = t.sockets[0];
  assert.deepEqual(s.lookups, ['905321234567@s.whatsapp.net']);
  assert.deepEqual(s.sent, [{ jid: '905321234567@s.whatsapp.net', content: { text: 'merhaba' } }]);
  assert.equal(t.sockets.length, 1);
});

test('send: messages go out one at a time with a pause, even when asked in parallel', async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  const out = await Promise.all([t.engine.sendMessage('905321234567', 'bir'), t.engine.sendMessage('905551112233', 'iki'), t.engine.sendMessage('905559998877', 'üç')]);
  assert.deepEqual(out.map((o) => o.idMessage), ['M1', 'M2', 'M3']);
  assert.deepEqual(t.sockets[0].sent.map((m) => m.content.text), ['bir', 'iki', 'üç']);
  assert.ok(t.delays.filter((d) => d >= MIN_GAP_MS).length >= 2, `pauses: ${t.delays.join(',')}`);
});

test('send: nothing is sent, and nothing opened, when no phone has been linked', async () => {
  const t = makeEngine();
  await assert.rejects(t.engine.sendMessage('905321234567', 'x'), (e) => e instanceof WhatsappError && e.status === 409 && /QR Kodu Göster/.test(e.message));
  assert.equal(t.sockets.length, 0);
});

test('send: a number without WhatsApp is refused with a clear sentence', async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  await assert.rejects(t.engine.sendMessage('05550000000', 'x'), (e) => e.status === 422 && /WhatsApp hesabı bulunamadı/.test(e.message) && !/5550000000/.test(e.message));
  assert.equal(t.sockets[0].sent.length, 0);
});

test('send: if the connection cannot come up, the sentence says so', async () => {
  const t = makeEngine({ linked: true });                  // the socket never gets online
  await assert.rejects(t.engine.sendMessage('905321234567', 'x'), (e) => e.status === 503 && /zaman aşımı/.test(e.message));
});

test(`send: at most ${MAX_PER_HOUR} messages an hour (a runaway loop must not get the number blocked)`, async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  await t.engine.sendMessage('905321234567', 'ilk');
  t.engine.sentAt = Array.from({ length: MAX_PER_HOUR }, () => 1_000_000);
  await assert.rejects(t.engine.sendMessage('905321234567', 'fazla'), (e) => e.status === 429);
  t.tick(3_700_000);                                     // an hour later it works again
  assert.deepEqual(await t.engine.sendMessage('905321234567', 'yine'), { idMessage: 'M2' });
});

// ── things that go wrong ───────────────────────────────────────────────────────────────────────────────────
test('a dropped connection is retried with growing pauses, and the count starts over once it is back', async () => {
  const t = makeEngine({ linked: true, onSocket: (s, n) => { if (n !== 3) open(s); } });
  await t.engine.sendMessage('905321234567', 'x');
  closeWith(t.sockets[0], R.connectionClosed);
  assert.equal(t.scheduled.length, 1); assert.equal(t.scheduled[0].ms, BACKOFF_MS[0]);
  t.scheduled[0].fn(); await settle();                   // socket #2 comes online
  assert.equal(t.sockets.length, 2); assert.equal((await t.engine.getStatus()).stateInstance, 'authorized');
  closeWith(t.sockets[1], R.timedOut);
  assert.equal(t.scheduled[1].ms, BACKOFF_MS[0], 'the counter was reset by the successful reconnect');
  t.scheduled[1].fn(); await settle();                   // socket #3 never comes online
  closeWith(t.sockets[2], R.timedOut);
  assert.equal(t.scheduled[2].ms, BACKOFF_MS[1]);
});

test('the phone removed the device (logged out): the saved login is deleted and nothing reconnects', async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  await t.engine.sendMessage('905321234567', 'x');
  assert.equal(t.store.m.size > 0, true);
  closeWith(t.sockets[0], R.loggedOut); await settle();
  assert.equal(t.store.m.size, 0); assert.equal(t.scheduled.length, 0); assert.equal(t.sockets.length, 1);
  const s = await t.engine.getStatus();
  assert.equal(s.wahaStatus, 'NOT_LINKED'); assert.match(s.message, /telefondan kapatılmış/);
  await assert.rejects(t.engine.sendMessage('905321234567', 'y'), (e) => e.status === 409);
});

test('taken over by another instance (440) or restricted (403): no fight, and the status explains', async () => {
  for (const [code, text] of [[R.connectionReplaced, /başka bir yerde/], [R.forbidden, /kısıtlamış/]]) {
    const t = makeEngine({ linked: true, onSocket: (s, n) => { if (n === 1) open(s); } });
    await t.engine.sendMessage('905321234567', 'x');
    closeWith(t.sockets[0], code); await settle();
    assert.equal(t.scheduled.length, 0, `no automatic reconnect after ${code}`);
    const s = await t.engine.getStatus();
    assert.equal(s.stateInstance, 'notAuthorized'); assert.match(s.message, text);
    assert.equal(t.sockets.length, 1, 'polling the status does not reopen it either');
  }
});

test('a saved login whose connection is down is brought back by the status check, and by the QR button', async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  assert.equal((await t.engine.getStatus()).stateInstance, 'starting');
  await settle();
  assert.equal((await t.engine.getStatus()).stateInstance, 'authorized');

  const u = makeEngine({ linked: true, onSocket: (s) => open(s) });
  assert.equal((await u.engine.getQR()).type, 'alreadyLogged');                       // no second device is linked
  assert.equal(u.sockets.length, 1);
});

test('logout unlinks the device, forgets the login and ends the connection', async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  await t.engine.sendMessage('905321234567', 'x');
  await t.engine.logout();
  assert.equal(t.sockets[0].loggedOut, true); assert.equal(t.sockets[0].ended, true);
  assert.equal(t.store.m.size, 0);
  assert.equal((await t.engine.getStatus()).wahaStatus, 'NOT_LINKED');
  closeWith(t.sockets[0], R.loggedOut); await settle();                                // WhatsApp confirms: the late event is ignored
  assert.equal(t.scheduled.length, 0);
});

test('reboot reopens the connection without touching the saved login', async () => {
  const t = makeEngine({ linked: true, onSocket: (s) => open(s) });
  await t.engine.sendMessage('905321234567', 'x');
  await t.engine.reboot(); await settle();
  assert.equal(t.sockets.length, 2); assert.equal(t.sockets[0].ended, true); assert.equal(t.store.m.get('creds'), LINKED);
  assert.equal((await t.engine.getStatus()).stateInstance, 'authorized');
});

// ── which engine is used ───────────────────────────────────────────────────────────────────────────────────
test('engine choice: WAHA only when a WAHA address is configured (or forced)', () => {
  const saved = [process.env.WAHA_BASE_URL, process.env.WHATSAPP_ENGINE];
  try {
    delete process.env.WAHA_BASE_URL; delete process.env.WHATSAPP_ENGINE;
    assert.equal(whatsapp.engineName(), 'embedded');
    assert.equal(whatsapp.createClient('x'), whatsapp.createClient('y'), 'one shared connection');
    process.env.WAHA_BASE_URL = 'https://waha.example.com';
    assert.equal(whatsapp.engineName(), 'waha'); assert.ok(whatsapp.createClient('default') instanceof WahaService);
    process.env.WHATSAPP_ENGINE = 'embedded'; assert.equal(whatsapp.engineName(), 'embedded');
    process.env.WHATSAPP_ENGINE = 'WAHA'; delete process.env.WAHA_BASE_URL; assert.equal(whatsapp.engineName(), 'waha');
    process.env.WHATSAPP_ENGINE = 'bogus'; assert.equal(whatsapp.engineName(), 'embedded');
    assert.equal(whatsapp.describeError(new WhatsappError('Cümle')), 'Cümle');
    assert.match(whatsapp.describeError(new Error('boom')), /WhatsApp hatası: boom/);
  } finally {
    for (const [k, v] of [['WAHA_BASE_URL', saved[0]], ['WHATSAPP_ENGINE', saved[1]]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ── the stored login ───────────────────────────────────────────────────────────────────────────────────────
function fakePrisma() {
  const rows = new Map();
  const match = (key, where) => (where.key.in ? where.key.in.includes(key) : where.key.startsWith !== undefined ? key.startsWith(where.key.startsWith) : key === where.key);
  return {
    rows,
    whatsappAuthState: {
      findUnique: async ({ where }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
      findMany: async ({ where }) => [...rows].filter(([k]) => match(k, where)).map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create, update }) => { rows.set(where.key, rows.has(where.key) ? update.value : create.value); },
      deleteMany: async ({ where }) => { for (const k of [...rows.keys()]) if (match(k, where)) rows.delete(k); },
    },
  };
}

test('stored login: encrypted in the database, readable back, scoped to its namespace, unreadable rows count as "not stored"', async () => {
  const saved = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const db = fakePrisma(); const store = createDbStore(db);
    await store.set('creds', '{"secret":"value"}');
    assert.match(db.rows.get('default:creds'), /^enc:v1:/); assert.ok(!db.rows.get('default:creds').includes('secret'));
    assert.equal(await store.get('creds'), '{"secret":"value"}');
    await store.setMany([['session-a', 'A'], ['session-b', 'B']]);
    const many = await store.getMany(['session-a', 'session-b', 'session-zz']);
    assert.deepEqual([...many], [['session-a', 'A'], ['session-b', 'B']]);
    await store.del(['session-a']); assert.equal(await store.get('session-a'), null);
    db.rows.set('other:creds', 'untouched');
    db.rows.set('default:broken', 'enc:v1:AAAA:BBBB:CCCC');                            // e.g. written with a key that is gone
    assert.equal(await store.get('broken'), null);
    await store.clear();
    assert.deepEqual([...db.rows.keys()], ['other:creds']);
  } finally { if (saved === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = saved; }
});

test('stored login: credentials and keys survive a restart, Buffers included', async () => {
  const store = createMemoryStore();
  const a = await useStoreAuthState(store, real);
  assert.equal(a.isLinked(), false);
  a.state.creds.registered = true; a.state.creds.me = { id: '905321234567:1@s.whatsapp.net' };
  await a.saveCreds();
  await a.state.keys.set({
    session: { x: Buffer.from([1, 2, 3]) },
    'app-state-sync-key': { k1: { keyData: Buffer.from([9, 9]), timestamp: 5 } },
    'pre-key': { 7: { private: Buffer.from([4]), public: Buffer.from([5]) }, 8: { private: Buffer.from([6]), public: Buffer.from([7]) } },
  });

  const b = await useStoreAuthState(store, real);                                     // "after the restart"
  assert.equal(b.isLinked(), true);
  assert.deepEqual(Buffer.from(b.state.creds.noiseKey.private), Buffer.from(a.state.creds.noiseKey.private));
  assert.equal(b.state.creds.registrationId, a.state.creds.registrationId);
  const got = await b.state.keys.get('session', ['x', 'nope']);
  assert.deepEqual(Buffer.from(got.x), Buffer.from([1, 2, 3])); assert.equal(got.nope, null);
  const sync = (await b.state.keys.get('app-state-sync-key', ['k1'])).k1;
  assert.ok(sync instanceof real.proto.Message.AppStateSyncKeyData, 'converted back to the protobuf type');
  assert.deepEqual(Buffer.from(sync.keyData), Buffer.from([9, 9]));
  await b.state.keys.set({ 'pre-key': { 7: null } });                                 // null = delete
  const pre = await b.state.keys.get('pre-key', ['7', '8']);
  assert.equal(pre['7'], null); assert.deepEqual(Buffer.from(pre['8'].private), Buffer.from([6]));
  await b.state.keys.clear(); assert.equal(store.m.size, 0);
});
