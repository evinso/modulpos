#!/usr/bin/env node
/**
 * Review aid for tuning the niche filter: reads the default sources over the REAL network into the TEST database and writes every headline with its verdict.
 *   CONTENT_TEST_DATABASE_URL=postgresql://…/content_test node scripts/content-relevance-dump.js <outfile.tsv>
 */
const url = process.env.CONTENT_TEST_DATABASE_URL || '';
if (!/_test$/.test((() => { try { return new URL(url).pathname.slice(1); } catch { return ''; } })())) { console.error('Set CONTENT_TEST_DATABASE_URL to a database whose name ends in _test (it is wiped).'); process.exit(2); }
Object.assign(process.env, { CONTENT_DATABASE_URL: url, CONTENT_ENCRYPTION_KEY: 'f6'.repeat(32) });
(async () => {
  const db = require('../src/content/db'); const { migrate } = require('../src/content/migrate');
  await db.query('DROP SCHEMA IF EXISTS public CASCADE'); await db.query('CREATE SCHEMA public'); await migrate();
  const P = require('../src/content/services/projects'); const N = require('../src/content/services/news');
  const { projectId } = await P.seedDefault(); await N.seedDefaultSources(projectId);
  const run = await N.runDiscovery(projectId, { trigger: 'manual' });
  const rows = (await db.query(`SELECT i.status, i.relevance, coalesce(c.name_en,'') AS cat, i.source_name, i.title, i.reason FROM news_items i LEFT JOIN categories c ON c.id = i.category_id ORDER BY i.status, i.relevance DESC, i.title`)).rows;
  const out = rows.map((r) => [r.status, r.relevance, r.cat, r.source_name, r.title.replace(/\t/g, ' '), r.reason].join('\t')).join('\n');
  require('node:fs').writeFileSync(process.argv[2] || 'relevance-dump.tsv', out);
  console.log(`run ${run.status}: ${rows.length} headlines -> ${process.argv[2] || 'relevance-dump.tsv'}`);
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
