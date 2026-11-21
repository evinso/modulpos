const { env } = require('./env');

/**
 * The content module's OWN PostgreSQL connection (node-pg, a small pool): nothing here touches the ModulPOS database or its Prisma client.
 * `query` for single statements, `tx(fn)` for a transaction (BEGIN / COMMIT / ROLLBACK on one connection).
 */
let pool = null;

function getPool() {
  if (pool) return pool;
  const { Pool, types } = require('pg');
  const e = env();
  // a `date` column is a calendar day, not an instant: hand it over as 'YYYY-MM-DD' (node-pg would build a Date at local midnight, which shifts the day in other time zones)
  const typeParsers = { getTypeParser: (oid, format) => (oid === 1082 ? (v) => v : types.getTypeParser(oid, format)) };
  pool = new Pool({
    types: typeParsers,
    connectionString: e.databaseUrl,
    max: e.poolMax,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 20000,
    ...(e.dbSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  pool.on('error', (err) => console.error('[Content DB] idle connection error:', err.message));
  return pool;
}

/**
 * A pooled connection, ready to use. A Supabase project exposes its `public` schema through the REST API, so the content tables live in their own schema
 * (CONTENT_DB_SCHEMA, not exposed): every connection gets `SET search_path` once, before its first statement. Needs a session-level connection
 * (Supavisor session mode, port 5432); a transaction pooler would forget the setting between statements. (The role's own search_path is set as well.)
 */
const prepared = new WeakSet();
async function acquire() {
  const client = await getPool().connect();
  const schema = env().schema;
  if (schema && !prepared.has(client)) {
    try { await client.query(`SET search_path TO "${schema}"`); prepared.add(client); }
    catch (err) { client.release(err); throw err; }
  }
  return client;
}

// a SQL error (it has a SQLSTATE code) leaves the connection fine; anything else (reset, timeout) throws the connection away
const done = (client, err) => client.release(err && !err.code ? err : undefined);

async function query(text, params) {
  const client = await acquire();
  try { const r = await client.query(text, params); done(client); return r; }
  catch (err) { done(client, err); throw err; }
}

async function tx(fn) {
  const client = await acquire();
  try {
    await client.query('BEGIN');
    const out = await fn({ query: (t, p) => client.query(t, p) });
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally { client.release(); }
}

async function end() { if (pool) { const p = pool; pool = null; await p.end(); } }

module.exports = { query, tx, end, getPool, acquire };
