/**
 * Logical backup of the database to gzip-compressed NDJSON files (one per table) plus a manifest.
 * Works with any Postgres version (does not depend on a matching pg_dump).
 *
 *   node scripts/backup.js [--dir ~/modulpos-backups] [--schema app] [--keep 14] [--include-public]
 *                          [--flat] [--plain] [--exclude Table1,Table2]
 *
 *   --flat     write straight into --dir (no timestamped sub-folder) – meant for a git repository, where the
 *              history of the files IS the version history
 *   --plain    uncompressed NDJSON in a stable (primary-key) order, so git can store day-to-day changes as small deltas
 *   --exclude  skip tables (e.g. noisy log tables that can be rebuilt)
 *
 * Connection: DIRECT_URL (or DATABASE_URL) from the environment / server/.env, e.g. the Supabase session URL (port 5432).
 * The files contain personal data and encrypted credentials – store them somewhere private. Old backups beyond --keep are removed.
 * Restore: node scripts/restore.js <backup-folder>   (see that file)
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Client } = require('pg');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(`--${name}`);

function connString() {
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('DIRECT_URL / DATABASE_URL is not set');
  const u = new URL(raw);
  u.searchParams.delete('schema'); u.searchParams.delete('pgbouncer');
  return u.toString();
}

async function primaryKeyOrder(client, schema, table) {
  const r = await client.query(
    `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary AND i.indrelid = ('"' || $1 || '"."' || $2 || '"')::regclass
      ORDER BY array_position(i.indkey::int[], a.attnum::int)`, [schema, table]);
  return r.rows.length ? r.rows.map((x) => `"${x.attname}"`).join(', ') : 'ctid';
}

async function backupSchema(client, schema, outDir, { plain, exclude }) {
  const skip = new Set(exclude);
  const tables = (await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`, [schema])).rows.map((r) => r.table_name).filter((t) => !skip.has(t));
  const manifest = {};
  for (const t of tables) {
    const file = path.join(outDir, `${schema}.${t}.ndjson${plain ? '' : '.gz'}`);
    const gz = plain ? new (require('stream').PassThrough)() : zlib.createGzip();
    const out = fs.createWriteStream(file, { mode: 0o600 });
    gz.pipe(out);
    const order = await primaryKeyOrder(client, schema, t);
    let n = 0;
    // keyset-free paging via OFFSET is fine for these sizes; ctid order is stable inside one transaction
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      for (let offset = 0; ; offset += 2000) {
        const { rows } = await client.query(`SELECT to_jsonb(x) AS j FROM "${schema}"."${t}" x ORDER BY ${order} LIMIT 2000 OFFSET $1`, [offset]);
        for (const r of rows) { gz.write(JSON.stringify(r.j) + '\n'); n++; }
        if (rows.length < 2000) break;
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    await new Promise((res) => { out.on('finish', res); gz.end(); });
    manifest[`${schema}.${t}`] = { rows: n, bytes: fs.statSync(file).size, plain };
  }
  return manifest;
}

(async () => {
  const baseDir = (arg('dir', path.join(os.homedir(), 'modulpos-backups'))).replace(/^~/, os.homedir());
  const keep = parseInt(arg('keep', '14'), 10);
  const schemas = [arg('schema', 'app')];
  if (flag('include-public')) schemas.push('public');

  const flat = flag('flat'), plain = flag('plain');
  const exclude = String(arg('exclude', '')).split(',').map((x) => x.trim()).filter(Boolean);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = flat ? baseDir : path.join(baseDir, `backup-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  if (flat) for (const f of fs.readdirSync(outDir)) if (/\.ndjson(\.gz)?$/.test(f) || f === 'manifest.json') fs.rmSync(path.join(outDir, f)); // drop tables that no longer exist

  const client = new Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const manifest = { createdAt: new Date().toISOString(), server: (await client.query('show server_version')).rows[0].server_version, schemas, tables: {} };
  for (const s of schemas) Object.assign(manifest.tables, await backupSchema(client, s, outDir, { plain, exclude }));
  await client.end();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  const total = Object.values(manifest.tables).reduce((a, t) => a + t.rows, 0);
  console.log(`Backup written to ${outDir}  (${Object.keys(manifest.tables).length} tables, ${total} rows)`);

  if (flat) return; // in a git repo the history is the retention
  const old = fs.readdirSync(baseDir).filter((d) => d.startsWith('backup-')).sort();
  for (const d of old.slice(0, Math.max(0, old.length - keep))) fs.rmSync(path.join(baseDir, d), { recursive: true, force: true });
})().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
