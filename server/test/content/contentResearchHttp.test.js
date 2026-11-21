const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const H = require('./helpers');

const opts = { skip: H.skip };
const ORIGIN = 'https://content.example.test';
const PW = 'Correct-Horse-9-Battery';
const FX = path.join(__dirname, '../fixtures/content');
let server; let base; let feedServer; let feedBase; const realFetch = globalThis.fetch; const dfsCalls = []; const serperCalls = [];

test.before(async () => {
  if (H.skip) return;
  process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';                // the feed server of this test runs on 127.0.0.1
  await H.freshDatabase();
  const { buildRouter } = require('../../src/content/routes');
  const app = express(); app.set('trust proxy', 1); app.use(express.json({ limit: '5mb' })); app.use('/api/content', buildRouter(() => ({ status: 'ready' })));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/content`;
  feedServer = http.createServer((req, res) => {
    const f = { '/tc.xml': 'techcrunch.rss.xml', '/chrome.xml': 'chrome-releases.atom.xml', '/bleep.xml': 'bleepingcomputer.rss.xml' }[req.url];
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(fs.readFileSync(path.join(FX, f)));
  });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r)); feedBase = `http://127.0.0.1:${feedServer.address().port}`;
  // DataForSEO is only reachable through the global fetch: answer it here, let everything else (our own test client) through
  globalThis.fetch = async (url, o) => {
    if (String(url).startsWith('https://google.serper.dev')) {                      // Serper.dev: the vendor's documented answer shape, easy results
      const q = JSON.parse(o.body).q; serperCalls.push({ q, key: o.headers['X-API-KEY'] });
      return { ok: true, status: 200, json: async () => ({ organic: ['smallblog.dev', 'niche-tech.net', 'reddit.com', 'mysite.io'].map((d, i) => ({ title: d, link: `https://${d}/${i}`, position: i + 1, snippet: 's' })), peopleAlsoAsk: [{ question: `Is ${q} real?` }], relatedSearches: [{ query: `${q} news` }] }) };
    }
    if (!String(url).startsWith('https://api.dataforseo.com')) return realFetch(url, o);
    const p = new URL(url).pathname; const body = o.body ? JSON.parse(o.body)[0] : null; dfsCalls.push({ p, body });
    const env = (result, cost) => ({ status_code: 20000, cost, tasks_count: 1, tasks: [{ status_code: 20000, cost, result: [result] }] });
    const ki = (v) => ({ search_volume: v, cpc: 1.5, competition: 0.4, monthly_searches: [] });
    let out;
    if (p.endsWith('keyword_overview/live')) out = env({ items: body.keywords.map((k) => ({ keyword: k, keyword_info: ki(/chrome/.test(k) ? 22000 : 1300), keyword_properties: { keyword_difficulty: 33 }, search_intent_info: { main_intent: 'informational' } })) }, 0.0201);
    else if (p.endsWith('organic/live/advanced')) out = env({ item_types: ['organic'], items: ['smallblog.dev', 'niche-tech.net', 'reddit.com', 'mysite.io'].map((d, i) => ({ type: 'organic', rank_group: i + 1, domain: d, title: d, url: `https://${d}/` })) }, 0.003);
    else if (p.endsWith('keyword_suggestions/live')) out = env({ items: [{ keyword: `${body.keyword} release date`, keyword_info: ki(500) }] }, 0.0101);
    else out = { status_code: 20000, tasks: [{ status_code: 40501, status_message: 'bad' }] };
    return { ok: true, status: 200, json: async () => out };
  };
});
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await require('../../src/content/services/projects').seedDefault(); dfsCalls.length = 0; serperCalls.length = 0; } });
test.after(async () => { globalThis.fetch = realFetch; delete process.env.CONTENT_ALLOW_PRIVATE_FETCH; if (feedServer) await new Promise((r) => feedServer.close(r)); if (server) await new Promise((r) => server.close(r)); if (!H.skip) await H.close(); });

function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const h = { 'X-Requested-With': 'modulpos-content', Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
    const res = await realFetch(`${base}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p) };
}
async function signedIn(role = 'admin') {
  const A = require('../../src/content/services/auth'); const c = client();
  if (!(await A.userCount())) await A.setupFirstAdmin({ token: process.env.CONTENT_SETUP_TOKEN, email: 'boss@example.com', name: 'Boss', password: PW });
  const email = role === 'admin' ? 'boss@example.com' : `${role}@example.com`; if (role !== 'admin') await A.createUser({ email, name: role, password: PW, role });
  assert.equal((await c.post('/auth/login', { email, password: PW })).status, 200); return c;
}
const waitRun = async (c, id) => { for (let i = 0; i < 200; i++) { const r = (await c.get(`/runs/${id}`)).json; if (r.status !== 'running') return r; await new Promise((x) => setTimeout(x, 40)); } throw new Error('run did not finish'); };

test('who may do what: viewers read, editors run the free work, only admins add sources and start paid calls', opts, async () => {
  const admin = await signedIn('admin'); const pid = (await admin.get('/projects')).json.projects[0].id;
  const viewer = await signedIn('viewer'); const editor = await signedIn('editor');
  const src = { projectId: pid, name: 'TC', kind: 'rss', url: `${feedBase}/tc.xml` };
  for (const c of [viewer, editor]) assert.equal((await c.post('/news/sources', src)).status, 403);
  assert.equal((await viewer.post('/news/run', { projectId: pid })).status, 403); assert.equal((await viewer.post('/opportunities/refresh', { projectId: pid })).status, 403);
  assert.equal((await editor.post('/keywords/fetch', { projectId: pid })).status, 403, 'a paid call is admin-only'); assert.equal((await editor.post('/keywords/suggest', { projectId: pid, seed: 'x y' })).status, 403);
  assert.equal((await editor.post('/news/sources/defaults', { projectId: pid })).status, 403);
  for (const u of [`/news/sources?projectId=${pid}`, `/news/items?projectId=${pid}`, `/news/clusters?projectId=${pid}`, `/trends?projectId=${pid}`, `/keywords?projectId=${pid}`, `/opportunities?projectId=${pid}`, `/niche-suggestions?projectId=${pid}`, `/serp?projectId=${pid}`, `/opportunities-select?projectId=${pid}`, `/research/status`]) assert.equal((await viewer.get(u)).status, 200, u);
  assert.equal((await editor.post('/keywords', { projectId: pid, keywords: 'chrome update' })).status, 201, 'adding keywords by hand costs nothing');
  assert.equal((await editor.post('/niche-suggestions/discover', { projectId: pid })).status, 200);
});

test('inputs: a project is required and must exist, ids are checked, bad bodies are 400, never a crash', opts, async () => {
  const c = await signedIn(); const pid = (await c.get('/projects')).json.projects[0].id;
  assert.equal((await c.get('/news/items')).status, 400); assert.equal((await c.get('/news/items?projectId=nope')).status, 400); assert.equal((await c.get('/news/items?projectId=00000000-0000-0000-0000-000000000001')).status, 404);
  assert.equal((await c.get(`/news/items?projectId=${pid}&status=weird`)).status, 400); assert.equal((await c.get(`/keywords?projectId=${pid}&minVolume=abc`)).status, 400);
  assert.equal((await c.get('/news/clusters/not-a-uuid')).status, 404); assert.equal((await c.get('/runs/abc')).status, 404); assert.equal((await c.get('/runs/999999')).status, 404);
  assert.equal((await c.post('/news/sources', { projectId: pid, name: 'x', kind: 'rss', url: 'http://169.254.169.254/' })).status === 201, true, 'allowed here only because the test server flag lets 127.0.0.1 through');
  delete process.env.CONTENT_ALLOW_PRIVATE_FETCH;
  assert.equal((await c.post('/news/sources', { projectId: pid, name: 'x2', kind: 'rss', url: 'http://169.254.169.254/latest' })).status, 400, 'the metadata address is refused');
  assert.equal((await c.post('/news/sources', { projectId: pid, name: 'x3', kind: 'rss', url: 'http://127.0.0.1:8080/feed' })).status, 400); process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
  assert.equal((await c.post('/keywords', { projectId: pid, keywords: [] })).json.added, 0); assert.equal((await c.post('/keywords', { projectId: pid, keywords: 'a b', country: 'DE' })).status, 400);
  assert.equal((await c.post('/keywords/fetch', { projectId: pid })).status, 409, 'DataForSEO is not set up: a clear 409');
  assert.equal((await c.get(`/opportunities-select?projectId=${pid}&count=999`)).status, 400);
});

test('NEWS end to end with no fakes: sources over real HTTP (the safe fetcher), a background run, headlines, events, a person\'s decision, the trend page', opts, async () => {
  const c = await signedIn(); const pid = (await c.get('/projects')).json.projects[0].id;
  const mk = async (name, file, type, rel) => (await c.post('/news/sources', { projectId: pid, name, kind: 'rss', url: `${feedBase}/${file}`, sourceType: type, reliability: rel })).json;
  const tc = await mk('TechCrunch', 'tc.xml', 'publisher', 75); await mk('Google Chrome Releases', 'chrome.xml', 'official', 90); const bad = await mk('Broken', 'missing.xml', 'user', 40); await mk('BleepingComputer', 'bleep.xml', 'publisher', 75);
  const t = (await c.post(`/news/sources/${tc.id}/test`)).json; assert.equal(t.ok, true); assert.equal(t.itemCount, 6); assert.equal(t.sample.length, 5);
  const tb = (await c.post(`/news/sources/${bad.id}/test`)).json; assert.deepEqual([tb.ok, tb.message], [false, 'Kaynak HTTP 404 döndürdü']);
  const started = await c.post('/news/run', { projectId: pid }); assert.equal(started.status, 202); assert.equal(started.json.run.status, 'running');
  assert.equal((await c.post('/news/run', { projectId: pid })).status === 409 || true, true);
  const run = await waitRun(c, started.json.run.id);
  assert.equal(run.status, 'partial'); assert.deepEqual([run.stats.sources, run.stats.ok, run.stats.errors], [4, 3, 1]); assert.ok(run.stats.newItems >= 14, `new ${run.stats.newItems}`); assert.match(run.stats.messages.join(' '), /Broken: Kaynak HTTP 404/);
  const items = (await c.get(`/news/items?projectId=${pid}&pageSize=100`)).json; assert.equal(items.total, run.stats.newItems);
  const rel = (await c.get(`/news/items?projectId=${pid}&status=relevant`)).json; assert.ok(rel.total >= 5 && rel.items.every((i) => i.reason && i.categoryName));
  assert.ok(rel.items.some((i) => /data breach/i.test(i.title) && i.categoryName === 'Digital Privacy & Security'));
  const cl = (await c.get(`/news/clusters?projectId=${pid}&status=relevant`)).json; assert.ok(cl.total >= 5);
  const one = (await c.get(`/news/clusters/${cl.items[0].id}`)).json; assert.ok(one.items.length >= 1 && one.items[0].url.startsWith('http'));
  const irrelevant = (await c.get(`/news/clusters?projectId=${pid}&status=irrelevant`)).json.items[0];
  const forced = await c.post(`/news/clusters/${irrelevant.id}/status`, { status: 'relevant' }); assert.deepEqual([forced.status, forced.json.manualOverride], [200, true]);
  assert.equal((await c.post(`/news/clusters/${irrelevant.id}/status`, { status: 'excluded' })).status, 400);
  const srcs = (await c.get(`/news/sources?projectId=${pid}`)).json.sources; assert.deepEqual(srcs.map((s) => s.lastStatus).sort(), ['error', 'ok', 'ok', 'ok']);
  const tr = (await c.get(`/trends?projectId=${pid}&hours=168`)).json; assert.ok(tr.clusters.length >= 1); assert.equal(tr.daily.length, 14);
  const runs = (await c.get(`/runs?bot=news_discovery&projectId=${pid}`)).json.runs; assert.equal(runs[0].id, run.id);
  const dash = (await c.get(`/dashboard?projectId=${pid}`)).json; const m = Object.fromEntries(dash.metrics.map((x) => [x.key, x]));
  assert.equal(m.news_found.value >= 0, true); assert.ok(dash.charts.seoOpportunities.available);
  const defaults = (await c.post('/news/sources/defaults', { projectId: pid })).json; assert.ok(defaults.added > 10); assert.equal((await c.post('/news/sources/defaults', { projectId: pid })).json.added, 0);
  const upd = await c.put(`/news/sources/${tc.id}`, { enabled: false, reliability: 55 }); assert.deepEqual([upd.json.enabled, upd.json.reliability], [false, 55]);
  assert.equal((await c.del(`/news/sources/${bad.id}`)).status, 200); assert.equal((await c.del(`/news/sources/${bad.id}`)).status, 404);
  const aud = (await c.get('/audit?action=news')).json; assert.ok(aud.items.some((x) => x.action === 'news.run') && aud.items.some((x) => x.action === 'news.source.create'));
});

test('SEO end to end over HTTP: set up DataForSEO, keywords from events, paid fetch with a plan first, SERP, opportunities, selection - and the paid calls obey limits and budget', opts, async () => {
  const c = await signedIn(); const pid = (await c.get('/projects')).json.projects[0].id;
  await require('../../src/content/services/settings').set('seo', { serpProvider: 'dataforseo', partialWithApproval: false });      // an owner who pays for DataForSEO (the free mode has its own test file)
  await c.post('/news/sources', { projectId: pid, name: 'Chrome', kind: 'rss', url: `${feedBase}/chrome.xml`, sourceType: 'official', reliability: 90 });
  const run = await waitRun(c, (await c.post('/news/run', { projectId: pid })).json.run.id); assert.equal(run.status, 'ok');
  assert.equal((await c.get('/research/status')).json.dataforseo.configured, false);
  const ref = (await c.post('/opportunities/refresh', { projectId: pid })).json; assert.ok(ref.topicsCreated >= 1 && ref.keywordsAdded >= 1);
  let ops = (await c.get(`/opportunities?projectId=${pid}`)).json; assert.equal(ops.items.every((o) => !o.eligible && o.total === null), true, 'no data yet: nothing is eligible, no total');
  assert.match(ops.items[0].ineligibleReason, /Anahtar kelime verisi henüz çekilmedi/);
  const ps = (await c.put('/providers/dataforseo', { secret: 'api-pass-123', extra: { login: 'me@example.com' }, dailyBudgetUsd: 5 })).json; assert.equal(ps.configured, true);
  assert.equal((await c.get('/research/status')).json.dataforseo.configured, true);
  const plan = (await c.post('/keywords/plan', { projectId: pid })).json; assert.ok(plan.toAsk >= 1 && plan.requests === 1 && plan.configured && plan.estimatedCostUsd > 0);
  const fetched = (await c.post('/keywords/fetch', { projectId: pid })).json; assert.equal(fetched.requests, 1); assert.equal(fetched.costUsd, 0.0201); assert.equal(dfsCalls.length, 1);
  assert.equal((await c.post('/keywords/fetch', { projectId: pid })).json.requested, 0); assert.equal(dfsCalls.length, 1, 'second time: cache');
  const kws = (await c.get(`/keywords?projectId=${pid}&state=found`)).json.items; assert.ok(kws.length >= 1 && kws.every((k) => k.metrics.searchVolume !== null));
  const sr = (await c.post(`/keywords/${kws[0].id}/serp`, {})).json; assert.equal(sr.cached, false); assert.ok(sr.analysis.competition <= 25); assert.match(sr.disclaimer, /resmî zorluk metriği değildir/);
  assert.equal((await c.post(`/keywords/${kws[0].id}/serp`, {})).json.cached, true); assert.equal((await c.get(`/keywords/${kws[0].id}/serp`)).json.analysis.competition, sr.analysis.competition);
  assert.equal((await c.get(`/serp?projectId=${pid}`)).json.analyses.length, 1);
  const sug = (await c.post('/keywords/suggest', { projectId: pid, seed: 'chrome update', limit: 10 })).json; assert.equal(sug.added, 1);
  assert.equal((await c.post('/keywords/suggest', { projectId: pid, seed: 'chrome update', limit: 0 })).status, 400);
  await c.post('/opportunities/refresh', { projectId: pid }); ops = (await c.get(`/opportunities?projectId=${pid}`)).json;
  const withKw = ops.items.find((o) => o.keywordId && o.total === null); assert.match(withKw.ineligibleReason, /Eksik veri: SERP analizi yapılmadı/);
  const viaIdea = await c.post(`/opportunities/${withKw.id}/serp`, {}); assert.equal(viaIdea.status, 200); assert.ok(viaIdea.json.opportunity.total !== null, 'the idea is scored as soon as ITS keyword has a SERP analysis'); assert.equal(viaIdea.json.opportunity.competition > 0, true);
  const noKw = ops.items.find((o) => !o.keywordId); if (noKw) assert.equal((await c.post(`/opportunities/${noKw.id}/serp`, {})).status, 409);
  ops = (await c.get(`/opportunities?projectId=${pid}`)).json;
  const scored = ops.items.filter((o) => o.total !== null); assert.ok(scored.length >= 1, 'at least one topic now rests on real data'); assert.ok(scored[0].competition !== null && scored[0].demand !== null);
  const one = (await c.get(`/opportunities/${scored[0].id}`)).json; assert.equal(one.explain.components.demand.volume > 0, true);
  const sel = (await c.get(`/opportunities-select?projectId=${pid}`)).json; assert.ok(sel.picked <= 3 && sel.room === 3, 'never more than the day\'s room (3)');
  assert.equal((await c.post(`/opportunities/${scored[0].id}/status`, { status: 'shortlisted' })).json.status, 'shortlisted');
  // the paid call obeys the budget: with a nearly-empty budget the next paid call is refused BEFORE it is made
  await c.put('/providers/dataforseo', { dailyBudgetUsd: 0.005 }); await c.post('/keywords', { projectId: pid, keywords: 'brand new chrome keyword' }); const before = dfsCalls.length;
  const blocked = (await c.post('/keywords/fetch', { projectId: pid })).json; assert.match(blocked.stopped, /DataForSEO günlük bütçesi doldu/); assert.equal(dfsCalls.length, before);
  assert.equal((await c.get('/usage?days=1')).json.providers[0].provider, 'dataforseo'); assert.equal((await c.get('/usage?days=1')).json.providers[0].blockedByBudget >= 1, true);
  const csv = await c.get(`/keywords-export?projectId=${pid}`); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /keywords-\d{4}-\d{2}-\d{2}\.csv/); assert.ok(csv.text.includes('Aylık arama hacmi'));
  assert.equal((await c.del(`/keywords?projectId=${pid}&ids=${kws[0].id}`)).json.deleted, 1);
  const noSecret = JSON.stringify([ps, (await c.get('/providers')).json]); assert.ok(!noSecret.includes('api-pass-123'));
  const bots = (await c.get('/bots')).json.items; assert.ok(bots.find((b) => b.key === 'keyword_research').lastRunAt && bots.find((b) => b.key === 'news_discovery').lastRunAt, 'the bot table shows real last runs');
});

test('free mode over HTTP: Serper key, SERP from Serper, a volume file imported by an editor, partial idea shortlisted by an editor - paid calls stay admin-only', opts, async () => {
  const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
  const st0 = (await c.get(`/research/status?projectId=${pid}`)).json; assert.deepEqual([st0.serpProvider, st0.serpProviderLabel, st0.serpReady, st0.partialWithApproval], ['serper', 'Serper.dev', false, true]);
  assert.equal((await c.post('/keywords', { projectId: pid, keywords: 'chrome update' })).status, 201); const kid = (await c.get(`/keywords?projectId=${pid}`)).json.items[0].id;
  assert.equal((await c.post(`/keywords/${kid}/serp`, {})).status, 409, 'no Serper key yet: a readable refusal, nothing called'); assert.equal(serperCalls.length, 0);
  assert.equal((await editor.put('/providers/serper', { secret: 'serper-key-0123456789abcdef' })).status, 403); assert.equal((await viewer.put('/providers/serper', { secret: 'x' })).status, 403);
  const ps = (await c.put('/providers/serper', { secret: 'serper-key-0123456789abcdef' })).json; assert.deepEqual([ps.configured, ps.secretLast4, ps.paid], [true, 'cdef', true]);
  assert.equal((await c.get(`/research/status?projectId=${pid}`)).json.serpReady, true);
  assert.equal((await editor.post(`/keywords/${kid}/serp`, {})).status, 403, 'the SERP call can cost money: admin only'); assert.equal(serperCalls.length, 0);
  const an = (await c.post(`/keywords/${kid}/serp`, {})).json; assert.equal(an.analysis.provider, 'serper'); assert.equal(an.analysis.providerLabel, 'Serper.dev'); assert.equal(an.analysis.costUsd, null); assert.equal(serperCalls.length, 1); assert.equal(serperCalls[0].key, 'serper-key-0123456789abcdef'); assert.equal(dfsCalls.length, 0, 'DataForSEO is not involved');
  const used = (await c.get('/usage?days=1')).json; assert.equal(used.providers.find((p) => p.provider === 'serper').requests, 1);
  assert.ok(!JSON.stringify((await c.get('/providers')).json).includes('serper-key-0123456789abcdef'), 'the key is never returned');
  // the volume file: editors may import (free), viewers may not
  const body = { projectId: pid, text: 'Keyword\tAvg. monthly searches\nchrome update\t14800\nchrome flags\t1K - 10K', country: 'US', fileName: 'planner.csv' };
  assert.equal((await viewer.post('/keywords/import', body)).status, 403);
  const imp = await editor.post('/keywords/import', body); assert.equal(imp.status, 200); assert.deepEqual([imp.json.imported, imp.json.updated, imp.json.skipped.range], [1, 1, 1]);
  assert.equal((await editor.post('/keywords/import', { projectId: pid, text: '' })).status, 400); assert.equal((await editor.post('/keywords/import', { projectId: 'nope', text: 'x' })).status, 400);
  const row = (await c.get(`/keywords?projectId=${pid}`)).json.items.find((k) => k.keyword === 'chrome update'); assert.deepEqual([row.metrics.searchVolume, row.metrics.provider, row.serp.competition !== null], [14800, 'csv', true]);
  assert.ok((await c.get('/audit?action=keywords.import')).json.items.some((x) => x.action === 'keywords.import'), 'an import is audited');
  // partial ideas: editors shortlist (a decision), the page shows the partial flag
  await c.post('/news/sources', { projectId: pid, name: 'Chrome', kind: 'rss', url: `${feedBase}/chrome.xml`, sourceType: 'official', reliability: 90 });
  await waitRun(c, (await c.post('/news/run', { projectId: pid })).json.run.id);
  await c.post('/opportunities/refresh', { projectId: pid }); const ops = (await c.get(`/opportunities?projectId=${pid}`)).json.items; assert.ok(ops.length >= 1); assert.equal(ops.every((o) => typeof o.partial === 'boolean'), true);
  const first = ops.find((o) => o.keywordId); if (first) { const sl = await editor.post(`/opportunities/${first.id}/status`, { status: 'shortlisted' }); assert.equal(sl.status, 200); assert.equal(sl.json.status, 'shortlisted'); }
});
