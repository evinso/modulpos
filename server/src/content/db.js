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

const query = (text, params) => getPool().query(text, params);

async function tx(fn) {
  const client = await getPool().connect();
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

module.exports = { query, tx, end, getPool };
