// Where the built-in WhatsApp connection keeps its login (credentials + signal keys).
// The free hosting has no disk that survives a sleep, so every item is a row of table WhatsappAuthState.
// The stored text is JSON (Buffers via Baileys' BufferJSON) encrypted with ENCRYPTION_KEY, like the marketplace credentials.
const { encrypt, decrypt } = require('../../utils/secretBox');

/**
 * Database-backed store. All methods deal in plain text; encryption happens here.
 * `prisma` is injectable for tests; `ns` leaves room for more than one linked number later.
 */
function createDbStore(prisma, ns = 'default') {
  const db = prisma || require('../../config/database');
  const k = (key) => `${ns}:${key}`;
  const open = (value) => { try { return decrypt(value); } catch { return null; } };   // wrong/rotated key: behave as "not stored"
  return {
    async get(key) {
      const row = await db.whatsappAuthState.findUnique({ where: { key: k(key) } });
      return row ? open(row.value) : null;
    },
    async getMany(keys) {
      const out = new Map();
      if (!keys.length) return out;
      const rows = await db.whatsappAuthState.findMany({ where: { key: { in: keys.map(k) } } });
      for (const r of rows) { const v = open(r.value); if (v !== null) out.set(r.key.slice(ns.length + 1), v); }
      return out;
    },
    async set(key, text) {
      const value = encrypt(text);
      await db.whatsappAuthState.upsert({ where: { key: k(key) }, create: { key: k(key), value }, update: { value } });
    },
    async setMany(entries) {
      await Promise.all(entries.map(([key, text]) => this.set(key, text)));
    },
    async del(keys) {
      if (keys.length) await db.whatsappAuthState.deleteMany({ where: { key: { in: keys.map(k) } } });
    },
    async clear() {
      await db.whatsappAuthState.deleteMany({ where: { key: { startsWith: `${ns}:` } } });
    },
  };
}

/** Same interface in memory (tests). */
function createMemoryStore() {
  const m = new Map();
  return {
    m,
    async get(key) { return m.has(key) ? m.get(key) : null; },
    async getMany(keys) { const out = new Map(); for (const key of keys) if (m.has(key)) out.set(key, m.get(key)); return out; },
    async set(key, text) { m.set(key, text); },
    async setMany(entries) { for (const [key, text] of entries) m.set(key, text); },
    async del(keys) { for (const key of keys) m.delete(key); },
    async clear() { m.clear(); },
  };
}

/**
 * Baileys' AuthenticationState on top of such a store (the counterpart of its useMultiFileAuthState).
 * `mod` is the Baileys module (initAuthCreds, BufferJSON, proto).
 * saveCreds() must be called whenever Baileys emits creds.update; without it a restart loses the login.
 */
async function useStoreAuthState(store, mod) {
  const { initAuthCreds, BufferJSON, proto } = mod;
  const dump = (v) => JSON.stringify(v, BufferJSON.replacer);
  const load = (t) => (t === null || t === undefined ? null : JSON.parse(t, BufferJSON.reviver));

  const creds = load(await store.get('creds')) || initAuthCreds();
  const keys = {
    async get(type, ids) {
      const rows = await store.getMany(ids.map((id) => `${type}-${id}`));
      const out = {};
      for (const id of ids) {
        let v = load(rows.get(`${type}-${id}`));
        if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
        out[id] = v;
      }
      return out;
    },
    async set(data) {
      const puts = []; const dels = [];
      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type])) {
          const v = data[type][id];
          if (v) puts.push([`${type}-${id}`, dump(v)]); else dels.push(`${type}-${id}`);
        }
      }
      await Promise.all([puts.length ? store.setMany(puts) : null, dels.length ? store.del(dels) : null]);
    },
    async clear() { await store.clear(); },
  };
  return {
    state: { creds, keys },
    saveCreds: () => store.set('creds', dump(creds)),
    /** true once a phone has been linked (not just a QR shown) */
    isLinked: () => !!(creds && creds.registered && creds.me),
  };
}

/** Is a phone linked in this store? Cheap: reads one row, loads nothing else. */
async function storeIsLinked(store) {
  const text = await store.get('creds');
  if (!text) return false;
  try { const c = JSON.parse(text); return !!(c && c.registered && c.me); } catch { return false; }
}

module.exports = { createDbStore, createMemoryStore, useStoreAuthState, storeIsLinked };
