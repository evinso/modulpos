#!/usr/bin/env node
/**
 * REAL-network check of the news engine (not part of CI: it depends on third-party sites). Reads the default sources of a throw-away project on the TEST database
 * and prints what came back.   CONTENT_TEST_DATABASE_URL=postgresql://…/content_test node scripts/content-live-news.js
 */
const url = process.env.CONTENT_TEST_DATABASE_URL || '';
if (!/_test$/.test((() => { try { return new URL(url).pathname.slice(1); } catch { return ''; } })())) { console.error('Set CONTENT_TEST_DATABASE_URL to a database whose name ends in _test (it is wiped).'); process.exit(2); }
Object.assign(process.env, { CONTENT_DATABASE_URL: url, CONTENT_ENCRYPTION_KEY: 'f6'.repeat(32) });
(async () => {
  const db = require('../src/content/db'); const { migrate } = require('../src/content/migrate');
  await db.query('DROP SCHEMA IF EXISTS public CASCADE'); await db.query('CREATE SCHEMA public'); await migrate();
  const P = require('../src/content/services/projects'); const N = require('../src/content/services/news');
  const { projectId } = await P.seedDefault(); const seeded = await N.seedDefaultSources(projectId);
  console.log(`default project + ${seeded} default sources (GDELT is off by default)`);
  const t0 = Date.now();
  const run = await N.runDiscovery(projectId, { trigger: 'manual' });
  console.log(`\nrun ${run.status} in ${Math.round((Date.now() - t0) / 1000)} s`, JSON.stringify({ ...run.stats, messages: undefined }));
  for (const m of run.stats.messages) console.log('  !', m);
  console.log('\nper source:');
  for (const s of await N.listSources(projectId)) console.log(`  ${s.lastStatus === 'ok' ? 'OK ' : s.enabled ? 'ERR' : 'off'} ${String(s.lastItemCount ?? '-').padStart(3)} items  ${s.name}${s.lastError ? `  -> ${s.lastError}` : ''}`);
  const clusters = await N.listClusters(projectId, { status: 'relevant', pageSize: 100 });
  console.log(`\nrelevant events: ${clusters.total}; with 2+ sources:`);
  for (const c of clusters.items.filter((x) => x.sourceCount >= 2).slice(0, 8)) console.log(`  [${c.sourceCount} sources] ${c.categoryName}: ${c.title.slice(0, 90)}`);
  console.log('\nsample relevant (first 10):'); for (const c of clusters.items.slice(0, 10)) console.log(`  ${String(c.relevance).padStart(3)} ${String(c.categoryName).padEnd(26)} ${c.title.slice(0, 80)}`);
  const O = require('../src/content/services/opportunities');
  const made = await O.refresh(projectId, { trigger: 'manual' });
  console.log(`\nideas from the relevant events: ${made.topicsCreated} topics, ${made.keywordsAdded} candidate keywords (they are only candidates: real search data decides if anyone searches for them)`);
  const rows = (await db.query("SELECT t.title, array_agg(k.keyword ORDER BY k.keyword) AS kws FROM topics t JOIN keywords k ON k.topic_id = t.id GROUP BY t.id, t.title ORDER BY t.created_at DESC LIMIT 12")).rows;
  for (const r of rows) console.log(`  ${r.title.slice(0, 70)}\n     -> ${r.kws.join(' | ')}`);
  await db.end(); process.exit(run.status === 'error' ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
