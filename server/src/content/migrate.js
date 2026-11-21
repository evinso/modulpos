const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

/**
 * SQL migrations (src/content/migrations/NNNN_name.sql), applied in file order, each in its own transaction, recorded in table _migrations with a
 * checksum. A migration that was already applied is NEVER edited (a changed checksum stops the start and says so): add a new file instead.
 * An advisory lock makes two processes (the old and the new one during a deploy) take turns instead of racing.
 */
const DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 727001;

const files = () => fs.readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function migrate({ log = () => {} } = {}) {
  const client = await db.acquire();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query('CREATE TABLE IF NOT EXISTS _migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Map((await client.query('SELECT id, checksum FROM _migrations')).rows.map((r) => [r.id, r.checksum]));
    const applied = [];
    for (const f of files()) {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      const sum = sha(sql);
      if (done.has(f)) {
        if (done.get(f) !== sum) throw new Error(`Migration ${f} was changed after it was applied. Never edit an applied migration; add a new one.`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (id, checksum) VALUES ($1, $2)', [f, sum]);
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* gone */ }
        throw new Error(`Migration ${f} failed: ${err.message}`);
      }
      applied.push(f); log(`migration applied: ${f}`);
    }
    return { applied, total: files().length };
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch { /* connection closing */ }
    client.release();
  }
}

module.exports = { migrate, files };
