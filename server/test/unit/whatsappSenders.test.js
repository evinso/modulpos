const test = require('node:test');
const assert = require('node:assert/strict');
const { createDbStore, storeIsLinked, storeAccount } = require('../../src/services/whatsapp/authStore');
const { SenderRegistry, IDLE_MS, MAX_SENDERS } = require('../../src/services/whatsapp/senders');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

// an in-memory table WhatsappAuthState with the calls the store makes
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    whatsappAuthState: {
      async findUnique({ where }) { return rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null; },
      async findMany({ where }) { return [...rows].filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value })); },
      async upsert({ where, create, update }) { rows.set(where.key, rows.has(where.key) ? update.value : create.value); },
      async deleteMany({ where }) {
        const hit = [...rows.keys()].filter((k) => (where.key.startsWith ? k.startsWith(where.key.startsWith) : where.key.in.includes(k)));
        hit.forEach((k) => rows.delete(k)); return { count: hit.length };
      },
    },
  };
}
const LINKED = (n) => JSON.stringify({ registered: false, me: { id: `${n}:7@s.whatsapp.net` } });

test('the login of a sender and the platform\'s login never touch each other', async () => {
  const db = fakeDb();
  const platform = createDbStore(db, 'default'); const s1 = createDbStore(db, 's-aaa'); const s2 = createDbStore(db, 's-aab');
  await platform.set('creds', LINKED('905320000001')); await platform.set('pre-key-1', 'P');
  await s1.set('creds', LINKED('905320000002')); await s1.set('pre-key-1', 'S1');
  await s2.set('creds', LINKED('905320000003'));

  assert.equal(await storeAccount(platform), '905320000001:7@s.whatsapp.net');
  assert.equal(await storeAccount(s1), '905320000002:7@s.whatsapp.net');
  assert.equal(await s1.get('pre-key-1'), 'S1'); assert.equal(await platform.get('pre-key-1'), 'P');

  await s1.clear();                                                      // a sender is unlinked / deleted
  assert.equal(await storeIsLinked(s1), false);
  assert.equal(await storeIsLinked(platform), true, 'the platform stays linked');
  assert.equal(await platform.get('pre-key-1'), 'P');
  assert.equal(await storeIsLinked(s2), true, 'a sender whose id starts the same way is not touched either');
  assert.equal(await s2.get('pre-key-1'), null);

  await platform.clear();                                                // the platform is unlinked
  assert.equal(await storeIsLinked(s2), true, 'senders keep their login');
  assert.deepEqual([...db.rows.keys()].filter((k) => !k.startsWith('s-')), []);
});

test('a stored login is encrypted, and a wrong key reads as "not stored"', async () => {
  const db = fakeDb();
  const st = createDbStore(db, 's-x');
  await st.set('creds', LINKED('905320000009'));
  assert.ok(![...db.rows.values()][0].includes('905320000009'), 'the number is not readable in the table');
  db.rows.set('s-x:creds', 'enc:v1:AAAA:BBBB:CCCC');                           // a value that this key cannot open (rotated / wrong key)
  assert.equal(await st.get('creds'), null);
});

function fakeConn() {
  const c = { state: 'open', idle: 0, suspended: 0, loggedOut: 0,
    idleFor() { return c.state === 'idle' ? Infinity : c.idle; }, suspend() { c.suspended++; c.state = 'idle'; }, async logout() { c.loggedOut++; } };
  return c;
}

test('registry: one connection per sender, created on demand, nothing opened by creating it', () => {
  const made = [];
  const reg = new SenderRegistry({ make: (id) => { const c = fakeConn(); c.id = id; made.push(id); return c; }, setTimer: () => ({}) });
  const a = reg.get('A'); const a2 = reg.get('A'); const b = reg.get('B');
  assert.equal(a, a2); assert.notEqual(a, b); assert.deepEqual(made, ['A', 'B']);
});

test('registry: only numbers nobody used for a while are hung up (their login stays)', () => {
  const reg = new SenderRegistry({ make: () => fakeConn(), setTimer: () => ({}), log: () => {} });
  const busy = reg.get('busy'); const idle = reg.get('idle'); const closed = reg.get('closed');
  busy.idle = 60 * 1000; idle.idle = IDLE_MS + 1000; closed.state = 'idle';
  assert.equal(reg.reap(), 1);
  assert.equal(idle.suspended, 1); assert.equal(busy.suspended, 0); assert.equal(closed.suspended, 0);
  assert.equal(reg.reap(), 0, 'already hung up: nothing to do');
});

test('registry: removing a sender logs it out and forgets it', async () => {
  let made = 0;
  const reg = new SenderRegistry({ make: () => { made++; return fakeConn(); }, setTimer: () => ({}) });
  const a = reg.get('A');
  await reg.remove('A');
  assert.equal(a.loggedOut, 1);
  reg.get('A'); assert.equal(made, 2, 'a later sender with that id would get a fresh connection');
});

test('registry: the reaper timer is started once', () => {
  let timers = 0;
  const reg = new SenderRegistry({ make: () => fakeConn(), setTimer: () => { timers++; return {}; } });
  reg.get('A'); reg.get('B'); reg.get('A');
  assert.equal(timers, 1);
  assert.equal(MAX_SENDERS, 3);
});
