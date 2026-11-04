/**
 * Restores a backup made by scripts/backup.js.
 *
 *   node scripts/restore.js <backup-folder> [--target-schema app] [--apply] [--force]
 *
 * Without --apply it only prints what it would do. Tables must already exist (run `npx prisma db push` on an empty
 * database first) and must be empty unless --force is given (rows that already exist are skipped, never overwritten).
 * Tables are loaded in foreign-key order.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Client } = require('pg');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(`--${name}`);

function connString() {
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('DIRECT_URL / DATABASE_URL is not set');
  const u = new URL(raw); u.searchParams.delete('schema'); u.searchParams.delete('pgbouncer');
  return u.toString();
}

async function* readRows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

(async () => {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) throw new Error('usage: node scripts/restore.js <backup-folder> [--target-schema app] [--apply] [--force]');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const target = arg('target-schema', manifest.schemas[0]);
  const apply = flag('apply'), force = flag('force');
  const sourceSchema = manifest.schemas[0];

  const tables = Object.keys(manifest.tables).filter((k) => k.startsWith(`${sourceSchema}.`)).map((k) => k.split('.')[1]);
  const client = new Client({ connectionString: connString(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  // foreign-key order (parents first)
  const fks = (await client.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`, [target])).rows;
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of fks) if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  const order = [];
  const seen = new Set();
  const visit = (t) => { if (seen.has(t)) return; seen.add(t); for (const p of deps.get(t)) visit(p); order.push(t); };
  tables.forEach(visit);

  console.log(`${apply ? 'RESTORING' : 'DRY RUN'}: ${tables.length} tables into schema "${target}" from ${dir}`);
  for (const t of order) {
    const expected = manifest.tables[`${sourceSchema}.${t}`].rows;
    const existing = parseInt((await client.query(`SELECT count(*) FROM "${target}"."${t}"`)).rows[0].count, 10);
    if (existing > 0 && !force) { console.log(`  ${t}: SKIPPED (already has ${existing} rows; use --force to add missing rows)`); continue; }
    if (!apply) { console.log(`  ${t}: would insert ${expected} rows`); continue; }

    let inserted = 0, chunk = [];
    const flush = async () => {
      if (!chunk.length) return;
      const r = await client.query(`INSERT INTO "${target}"."${t}" SELECT * FROM jsonb_populate_recordset(null::"${target}"."${t}", $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(chunk)]);
      inserted += r.rowCount; chunk = [];
    };
    for await (const row of readRows(path.join(dir, `${sourceSchema}.${t}.ndjson.gz`))) { chunk.push(row); if (chunk.length >= 500) await flush(); }
    await flush();
    console.log(`  ${t}: inserted ${inserted}/${expected}`);
  }
  await client.end();
})().catch((e) => { console.error('Restore failed:', e.message); process.exit(1); });
