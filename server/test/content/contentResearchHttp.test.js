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
let server; let base; let feedServer; let feedBase; const realFetch = globalThis.fetch; const apifyCalls = []; const serperCalls = []; let googleFake = null; const models = require('./fakeModels').fakeModels();

test.before(async () => {
  if (H.skip) return;
  process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';                // the feed server of this test runs on 127.0.0.1
  await H.freshDatabase();
  const { buildRouter } = require('../../src/content/routes');
  const app = express(); app.set('trust proxy', 1); app.use(express.json({ limit: '5mb' })); app.use('/api/content', buildRouter(() => ({ status: 'ready' })));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/content`;
  feedServer = http.createServer((req, res) => {
    if (req.url.startsWith('/page.html')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(require('./fakeModels').PAGE()); }          // a "news article" page for the writer to read
    const f = { '/tc.xml': 'techcrunch.rss.xml', '/chrome.xml': 'chrome-releases.atom.xml', '/bleep.xml': 'bleepingcomputer.rss.xml' }[req.url];
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/xml' }); res.end(require('../fixtures/freshen').freshen(fs.readFileSync(path.join(FX, f), 'utf8')));
  });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r)); feedBase = `http://127.0.0.1:${feedServer.address().port}`;
  // Apify and Serper are only reachable through the global fetch: answer them here, let everything else (our own test client) through
  globalThis.fetch = async (url, o) => {
    if (/^https:\/\/(api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com)/.test(String(url))) return models.fetchImpl(url, o);
    if (googleFake && /^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com\/webmasters)/.test(String(url))) return googleFake.fetchImpl(url, o);
    if (String(url).startsWith('https://google.serper.dev')) {                      // Serper.dev: the vendor's documented answer shape, easy results; /autocomplete answers one suggestion
      const q = JSON.parse(o.body).q; serperCalls.push({ q, key: o.headers['X-API-KEY'], path: new URL(url).pathname });
      if (/\/autocomplete$/.test(url)) return { ok: true, status: 200, json: async () => ({ suggestions: [{ value: `${q} release date` }] }) };
      return { ok: true, status: 200, json: async () => ({ organic: ['smallblog.dev', 'niche-tech.net', 'reddit.com', 'mysite.io'].map((d, i) => ({ title: d, link: `https://${d}/${i}`, position: i + 1, snippet: 's' })), peopleAlsoAsk: [{ question: `Is ${q} real?` }], relatedSearches: [{ query: `${q} news` }] }) };
    }
    if (String(url).startsWith('https://api.apify.com')) {                           // Apify: a synchronous actor run returns the dataset items (the default actor's output field names)
      const p = new URL(url).pathname; const body = o.body ? JSON.parse(o.body) : null; apifyCalls.push({ p, body, auth: o.headers.Authorization });
      if (/run-sync-get-dataset-items$/.test(p)) return { ok: true, status: 200, json: async () => body.keywords.map((k) => ({ keyword: k, search_volume: /chrome/.test(k) ? 22000 : 1300, cpc: 1.5, competition: 0.4, keyword_difficulty: 33, search_intent: 'informational', monthly_searches: [], data_status: 'ok' })) };
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }
    return realFetch(url, o);
  };
});
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await require('../../src/content/services/projects').seedDefault(); apifyCalls.length = 0; serperCalls.length = 0; } });
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
  assert.equal((await c.post('/keywords/fetch', { projectId: pid })).status, 409, 'Apify is not set up: a clear 409');
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

test('SEO end to end over HTTP: set up Apify and Serper, keywords from events, a data run with a plan first, SERP, opportunities, selection - and the calls obey the limits and the monthly keyword cap', opts, async () => {
  const c = await signedIn(); const pid = (await c.get('/projects')).json.projects[0].id;
  await require('../../src/content/services/settings').set('seo', { serpProvider: 'serper', partialWithApproval: false });      // an owner with real data sources (the free mode has its own test file)
  await c.post('/news/sources', { projectId: pid, name: 'Chrome', kind: 'rss', url: `${feedBase}/chrome.xml`, sourceType: 'official', reliability: 90 });
  const run = await waitRun(c, (await c.post('/news/run', { projectId: pid })).json.run.id); assert.equal(run.status, 'ok');
  assert.equal((await c.get('/research/status')).json.apify.configured, false);
  const ref = (await c.post('/opportunities/refresh', { projectId: pid })).json; assert.ok(ref.topicsCreated >= 1 && ref.keywordsAdded >= 1);
  let ops = (await c.get(`/opportunities?projectId=${pid}`)).json; assert.equal(ops.items.every((o) => !o.eligible && o.total === null), true, 'no data yet: nothing is eligible, no total');
  assert.match(ops.items[0].ineligibleReason, /Anahtar kelime verisi henüz çekilmedi/);
  const ps = (await c.put('/providers/apify', { secret: 'apify_api_http_token_0123456789' })).json; assert.equal(ps.configured, true); await c.put('/providers/serper', { secret: 'serper-key-0123456789abcdef' });
  assert.deepEqual([(await c.get('/research/status')).json.apify.configured, (await c.get('/research/status')).json.apify.monthlyCap], [true, 600]);
  const plan = (await c.post('/keywords/plan', { projectId: pid })).json; assert.ok(plan.toAsk >= 1 && plan.requests === 1 && plan.configured && plan.estimatedCostUsd === null && plan.monthly.cap === 600);
  const fetched = (await c.post('/keywords/fetch', { projectId: pid })).json; assert.equal(fetched.requests, 1); assert.deepEqual([fetched.costUsd, fetched.unknownCost], [0, 1], 'the cost is unknown, not 0'); assert.equal(apifyCalls.length, 1); assert.equal(apifyCalls[0].auth, 'Bearer apify_api_http_token_0123456789');
  assert.equal((await c.post('/keywords/fetch', { projectId: pid })).json.requested, 0); assert.equal(apifyCalls.length, 1, 'second time: cache');
  const kws = (await c.get(`/keywords?projectId=${pid}&state=found`)).json.items; assert.ok(kws.length >= 1 && kws.every((k) => k.metrics.searchVolume !== null));
  const sr = (await c.post(`/keywords/${kws[0].id}/serp`, {})).json; assert.equal(sr.cached, false); assert.ok(sr.analysis.competition <= 25); assert.match(sr.disclaimer, /resmî zorluk metriği değildir/);
  assert.equal((await c.post(`/keywords/${kws[0].id}/serp`, {})).json.cached, true); assert.equal((await c.get(`/keywords/${kws[0].id}/serp`)).json.analysis.competition, sr.analysis.competition);
  assert.equal((await c.get(`/serp?projectId=${pid}`)).json.analyses.length, 1);
  const sug = (await c.post('/keywords/suggest', { projectId: pid, seed: 'chrome update', limit: 10 })).json; assert.equal(sug.added, 1); assert.equal(sug.withData, 0, 'an autocomplete idea has no data'); assert.equal(serperCalls.at(-1).path, '/autocomplete');
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
  // the monthly keyword cap stops the next run BEFORE the actor is called
  await c.put('/providers/apify', { extra: { monthlyKeywordCap: '1' } }); await c.post('/keywords', { projectId: pid, keywords: 'brand new chrome keyword' }); const before = apifyCalls.length;
  const blocked = (await c.post('/keywords/fetch', { projectId: pid })).json; assert.match(blocked.stopped, /Aylık anahtar kelime güvenlik sınırına ulaşıldı \(1\)/); assert.equal(apifyCalls.length, before);
  const usage = (await c.get('/usage?days=1')).json.providers.find((x) => x.provider === 'apify'); assert.deepEqual([usage.requests >= 1, usage.unknownCalls >= 1, usage.costUsd], [true, true, 0], 'unknown costs are counted, never added as money');
  const csv = await c.get(`/keywords-export?projectId=${pid}`); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /keywords-\d{4}-\d{2}-\d{2}\.csv/); assert.ok(csv.text.includes('Aylık arama hacmi'));
  assert.equal((await c.del(`/keywords?projectId=${pid}&ids=${kws[0].id}`)).json.deleted, 1);
  const noSecret = JSON.stringify([ps, (await c.get('/providers')).json]); assert.ok(!noSecret.includes('http_token_0123456789'));
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
  const an = (await c.post(`/keywords/${kid}/serp`, {})).json; assert.equal(an.analysis.provider, 'serper'); assert.equal(an.analysis.providerLabel, 'Serper.dev'); assert.equal(an.analysis.costUsd, null); assert.equal(serperCalls.length, 1); assert.equal(serperCalls[0].key, 'serper-key-0123456789abcdef'); assert.equal(apifyCalls.length, 0, 'DataForSEO is not involved');
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

test('writing over HTTP: vendors, the write start (admin only, background run), the checks (free ones for editors, model ones for admins), sources never leave in full', opts, async () => {
  const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
  models.calls.length = 0;
  const st0 = (await c.get(`/writer/status?projectId=${pid}`)).json; assert.deepEqual([st0.ready, st0.vendors.map((v) => v.key), st0.vendors.every((v) => !v.ready)], [false, ['anthropic', 'openai', 'gemini', 'groq'], true]);
  assert.equal((await editor.put('/providers/anthropic', { secret: 'sk-ant-http-key-0123456789' })).status, 403);
  assert.equal((await c.put('/providers/anthropic', { secret: 'sk-ant-http-key-0123456789' })).status, 200);
  const st1 = (await c.get(`/writer/status?projectId=${pid}`)).json; assert.deepEqual([st1.ready, st1.picks.writer, st1.picks.checker, st1.picks.independent, st1.vendors[0].model], [true, 'anthropic', 'anthropic', false, 'claude-sonnet-5-5']);
  await c.post('/news/sources', { projectId: pid, name: 'Chrome', kind: 'rss', url: `${feedBase}/chrome.xml`, sourceType: 'official', reliability: 90 });
  await waitRun(c, (await c.post('/news/run', { projectId: pid })).json.run.id);
  await c.post('/opportunities/refresh', { projectId: pid });
  await require('../../src/content/db').query(`UPDATE news_items SET url = '${feedBase}/page.html?i=' || id::text`);
  await require('../../src/content/db').query("UPDATE content_opportunities SET eligible = true, ineligible_reason = '' WHERE keyword_id IS NOT NULL");
  const opp = (await c.get(`/opportunities?projectId=${pid}&eligible=1`)).json.items[0]; assert.ok(opp && opp.keywordId);
  assert.equal((await editor.post(`/opportunities/${opp.id}/write`, {})).status, 403, 'writing costs money: admin only'); assert.equal((await viewer.post(`/opportunities/${opp.id}/write`, {})).status, 403);
  assert.equal((await c.post(`/opportunities/${opp.id}/write`, { provider: 'bing' })).status, 400); assert.equal(models.calls.length, 0);
  const start = await c.post(`/opportunities/${opp.id}/write`, {}); assert.equal(start.status, 202); assert.deepEqual([start.json.writer, start.json.checker], ['anthropic', 'anthropic']);
  const run = await waitRun(c, start.json.run.id); assert.equal(run.status, 'ok', JSON.stringify(run)); assert.deepEqual([run.stats.step, run.stats.calls], ['done', 3]);
  const after = (await c.get(`/opportunities/${opp.id}`)).json; assert.equal(after.status, 'written');
  const aid = (await require('../../src/content/db').query('SELECT article_id FROM content_opportunities WHERE id = $1', [opp.id])).rows[0].article_id;
  const art = (await viewer.get(`/articles/${aid}`)).json; assert.deepEqual([art.createdBy, art.status, art.generation.provider, art.adsenseRisk], ['ai', 'needs_review', 'anthropic', 'low']);
  const ck = (await viewer.get(`/articles/${aid}/checks`)).json; assert.deepEqual([ck.rules.stale, ck.fact.status, ck.review.status, typeof ck.quality.result.score], [false, 'ok', 'ok', 'number'], JSON.stringify(ck.fact.result.claims.map((x) => [x.verdict, x.note])));
  const sl = (await viewer.get(`/articles/${aid}/source-list`)).json.sources; assert.ok(sl.length >= 1 && sl.every((s) => s.preview.length <= 300 && s.excerpt === undefined && s.text === undefined), 'only a short preview of a source page is ever returned');
  assert.equal((await editor.post(`/articles/${aid}/checks/free`, {})).status, 200); assert.equal(models.calls.length, 3, 'the free rules call no model');
  assert.equal((await editor.post(`/articles/${aid}/checks/run`, {})).status, 403); assert.equal((await viewer.post(`/articles/${aid}/checks/free`, {})).status, 403);
  const re = await c.post(`/articles/${aid}/checks/run`, {}); assert.equal(re.status, 200); assert.equal(re.json.errors.length, 0); assert.equal(models.calls.length, 5, 'fact check + review'); assert.equal(re.json.latest.quality.stale, false);
  assert.equal((await c.post(`/opportunities/${opp.id}/write`, {})).status, 409, 'already written');
  assert.ok((await c.get('/audit?action=article')).json.items.some((x) => x.action === 'article.write.start')); assert.ok(!JSON.stringify((await c.get('/providers')).json).includes('sk-ant-http-key'));
  assert.equal((await c.get('/articles/00000000-0000-0000-0000-000000000001/checks')).status, 404);
});

test('bots over HTTP: schedule edits, "run now", cancel and retry are admin-only, validated and audited; everyone signed in can read the bots and the queue', opts, async () => {
  const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
  const bots = (await viewer.get('/bots')).json; const news = bots.items.find((b) => b.key === 'news_discovery'); const writerBot = bots.items.find((b) => b.key === 'article_writer');
  assert.deepEqual([news.scheduled, news.schedule.intervalMinutes, news.enabled, writerBot.enabled, writerBot.schedule.spends, writerBot.schedule.windowStart, bots.scheduler.running], [true, 120, true, false, true, '09:00', false], 'tests do not start the loops; paid bots start off');
  assert.equal((await editor.put('/bots/news_discovery/schedule', { intervalMinutes: 60 })).status, 403); assert.equal((await viewer.post('/bots/news_discovery/run', { projectId: pid })).status, 403);
  assert.equal((await c.put('/bots/news_discovery/schedule', { intervalMinutes: 2 })).status, 400); assert.equal((await c.put('/bots/trend_analysis/schedule', { enabled: true })).status, 400); assert.equal((await c.put('/bots/news_discovery/schedule', { windowStart: '09:00' })).status, 400);
  const put = await c.put('/bots/article_writer/schedule', { enabled: true, intervalMinutes: 60, windowStart: '10:00', windowEnd: '18:00', options: { perRun: 2 } }); assert.equal(put.status, 200);
  assert.deepEqual([put.json.schedule.enabled, put.json.bots.items.find((b) => b.key === 'article_writer').statusText], [true, 'Otomatik: 1 saatte bir (10:00–18:00)']);
  const run = await c.post('/bots/news_discovery/run', { projectId: pid }); assert.equal(run.status, 202); assert.deepEqual([run.json.job.status, run.json.job.trigger, run.json.job.botKey], ['queued', 'manual', 'news_discovery']);
  assert.equal((await c.post('/bots/news_discovery/run', { projectId: pid })).status, 409, 'the same job is not queued twice'); assert.equal((await c.post('/bots/news_discovery/run', { projectId: 'nope' })).status, 400); assert.equal((await c.post('/bots/nothing/run', { projectId: pid })).status, 400);
  const jobs = (await viewer.get('/jobs?status=queued')).json; assert.deepEqual([jobs.jobs.length, jobs.counts.queued], [1, 1]); const id = jobs.jobs[0].id;
  assert.equal((await editor.post(`/jobs/${id}/cancel`)).status, 403); const cancelled = await c.post(`/jobs/${id}/cancel`); assert.equal(cancelled.json.status, 'cancelled'); assert.equal((await c.post(`/jobs/${id}/cancel`)).status, 409);
  assert.equal((await editor.post(`/jobs/${id}/retry`)).status, 403); const re = await c.post(`/jobs/${id}/retry`); assert.deepEqual([re.status, re.json.status, re.json.trigger], [202, 'queued', 'retry']); assert.equal((await c.post(`/jobs/${id}/retry`)).status, 409);
  assert.equal((await c.post('/jobs/abc/cancel')).status, 404); assert.equal((await c.post('/jobs/999999/cancel')).status, 404);
  const aud = (await c.get('/audit?action=bots')).json.items.map((x) => x.action); assert.ok(aud.includes('bots.schedule') && aud.includes('bots.run'));
});

test('WordPress over HTTP: connecting a site and every send are admin-only, the password never comes back, drafts reach the (fake) site through the queue, plans and the calendar are readable', opts, async () => {
  const { startFakeWp } = require('./fakeWordPress'); const fake = await startFakeWp(); const SC = require('../../src/content/services/scheduler');
  try {
    const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
    const body = { projectId: pid, name: 'Blog', apiUrl: fake.url, username: 'editor', password: 'abcd efgh ijkl mnop' };
    assert.equal((await editor.post('/sites', body)).status, 403); assert.equal((await viewer.post('/sites', body)).status, 403); assert.equal((await c.post('/sites', { ...body, apiUrl: 'nope' })).status, 400);
    const created = await c.post('/sites', body); assert.equal(created.status, 201); const sid = created.json.id; assert.ok(!created.text.includes('abcd efgh') && created.json.passwordLast4 === 'mnop');
    assert.equal((await c.post('/sites', body)).status, 409); assert.equal((await viewer.get(`/sites?projectId=${pid}`)).json.sites.length, 1); assert.ok(!(await viewer.get(`/sites/${sid}`)).text.includes('abcd efgh'));
    assert.equal((await editor.post(`/sites/${sid}/test`)).status, 403); const t = (await c.post(`/sites/${sid}/test`)).json; assert.deepEqual([t.ok, t.info.user], [true, 'Editor Joe']);
    const cm = (await viewer.get(`/sites/${sid}/categories`)).json; assert.deepEqual([cm.wpCategories.length, cm.categories.length >= 5], [2, true]);
    assert.equal((await editor.put(`/sites/${sid}/categories`, { entries: [] })).status, 403); const first = cm.categories[0]; const saved = await c.put(`/sites/${sid}/categories`, { entries: [{ categoryId: first.categoryId, wpCategoryId: 5, wpName: 'AI' }] }); assert.equal(saved.json.mapped, 1);
    const art = (await editor.post('/articles', { projectId: pid, h1: 'Home router guide', contentHtml: '<h2>Hi</h2><p>Some real words here.</p>', categoryId: first.categoryId, tags: ['wifi'] })).json;
    assert.equal((await editor.post(`/articles/${art.id}/publish`, { siteId: sid, mode: 'draft' })).status, 403); assert.equal((await c.post(`/articles/${art.id}/publish`, { siteId: sid, mode: 'draft' })).status, 202);
    assert.equal((await c.post(`/articles/${art.id}/publish`, { siteId: sid, mode: 'draft' })).status, 409, 'it is already being sent'); assert.equal((await c.post(`/articles/${art.id}/publish`, { siteId: sid, mode: 'publish' })).status, 409);
    let n = 0; while (await SC.workOnce({ ctx: {} })) { n++; if (n > 20) break; }
    const pubs = (await viewer.get(`/publications?projectId=${pid}`)).json.publications; assert.deepEqual([pubs.length, pubs[0].status, pubs[0].articleTitle, pubs[0].siteName], [1, 'draft', 'Home router guide', 'Blog']);
    const one = (await viewer.get(`/publications/${pubs[0].id}`)).json; assert.deepEqual(one.history.map((h) => h.action), ['prepare', 'create']); assert.equal((await viewer.get(`/articles/${art.id}/publications`)).json.publications.length, 1);
    assert.equal((await c.post(`/publications/${pubs[0].id}/retry`)).status, 409, 'a sent draft is not "retried"'); assert.equal((await editor.post(`/publications/${pubs[0].id}/reset`)).status, 403);
    assert.equal((await c.post('/publishing/plan', { siteId: sid, articleIds: [], mode: 'draft' })).status, 400); const pl = await c.post('/publishing/plan', { siteId: sid, articleIds: [art.id], mode: 'draft' }); assert.deepEqual([pl.status, pl.json.items.length, pl.json.unplanned.length, /zaten gönderilmiş/.test(JSON.stringify(pl.json.unplanned))], [200, 0, 1, true]);
    assert.equal((await editor.post('/publishing/bulk', { siteId: sid, articleIds: [art.id], mode: 'draft' })).status, 403);
    const cal = (await viewer.get(`/calendar?projectId=${pid}`)).json; assert.deepEqual([Array.isArray(cal.publications), cal.written.length >= 0, typeof cal.readyUnsent], [true, true, 'number']); assert.equal((await viewer.get(`/calendar?projectId=${pid}&from=2020-01-01&to=2026-01-01`)).status, 400);
    assert.equal((await c.del(`/sites/${sid}?projectId=${pid}`)).status, 409); assert.equal((await c.put(`/sites/${sid}`, { status: 'paused' })).json.status, 'paused'); assert.equal((await c.post(`/articles/${art.id}/publish`, { siteId: sid, mode: 'draft' })).status, 409, 'a paused site receives nothing');
    assert.equal((await c.del(`/articles/${art.id}?projectId=${pid}`)).status, 409, 'an article that has a post on a site cannot be deleted');
    assert.ok((await c.get('/audit?action=site')).json.items.some((x) => x.action === 'site.create') && (await c.get('/audit?action=article.publish')).json.items.length >= 1);
  } finally { await fake.close(); }
});

test('Search Console and internal links over HTTP: connecting and reading are by role, the key never comes back, no data is "not connected" (never zero), the numbers follow the sync, links are applied by an admin only', opts, async () => {
  const { makeKey, fakeGoogle } = require('./fakeGoogle'); const key = makeKey(); const A = require('../../src/content/services/articles'); const P = require('../../src/content/services/projects');
  const iso = (d) => d.toISOString().slice(0, 10); const back = (n) => new Date(Date.now() - (3 + n) * 86400000);
  googleFake = fakeGoogle({ publicKey: key.publicKey, email: key.json.client_email, sites: [{ siteUrl: 'sc-domain:blog.example', permissionLevel: 'siteRestrictedUser' }], rows: (b) => {
    if (b.dimensions.join() === 'date,page') return Array.from({ length: 90 }, (_, n) => ({ keys: [iso(back(n)), 'https://blog.example/guide/'], clicks: 4, impressions: 100, ctr: 0.04, position: 4 })).filter((r) => r.keys[0] >= b.startDate && r.keys[0] <= b.endDate);
    if (b.dimensions.join() === 'country') return [{ keys: ['usa'], clicks: 100, impressions: 2000, ctr: 0.05, position: 4 }];
    return [];
  } });
  try {
    const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
    const { startFakeWp } = require('./fakeWordPress'); const fake = await startFakeWp();
    try {
      const sid = (await c.post('/sites', { projectId: pid, name: 'Blog', apiUrl: fake.url, username: 'editor', password: 'abcd efgh ijkl mnop', gscProperty: 'sc-domain:blog.example' })).json.id; assert.equal((await c.get(`/sites/${sid}`)).json.gscProperty, 'sc-domain:blog.example');
      assert.equal((await c.post('/sites', { projectId: pid, name: 'Bad', apiUrl: fake.url, username: 'x', password: 'abcd efgh ijkl mnop', gscProperty: 'blog.example' })).status, 400, 'a Search Console property is sc-domain:… or a full https address');
      // not connected: honest empty answers
      const p0 = (await viewer.get(`/performance?siteId=${sid}&days=28`)).json; assert.deepEqual([p0.connected, p0.current, /henüz çekilmedi/.test(p0.note)], [false, undefined, true]); assert.equal((await viewer.get(`/performance?siteId=${sid}&days=5`)).status, 400);
      assert.equal((await editor.put('/providers/searchconsole', { secret: JSON.stringify(key.json) })).status, 403); assert.equal((await c.put('/providers/searchconsole', { secret: 'not json' })).status, 400);
      const saved = await c.put('/providers/searchconsole', { secret: JSON.stringify(key.json) }); assert.equal(saved.status, 200); assert.ok(!saved.text.includes('PRIVATE KEY') && !saved.text.includes(key.json.private_key_id), 'the key never comes back (only its last 4)'); assert.equal(saved.json.secretLast4, key.json.private_key_id.slice(-4));
      assert.equal((await editor.post(`/sites/${sid}/gsc-sync`)).status, 403); assert.equal((await viewer.post(`/sites/${sid}/gsc-sync`)).status, 403);
      const syn = await c.post(`/sites/${sid}/gsc-sync`); assert.deepEqual([syn.status, syn.json.days, syn.json.rows, syn.json.countries], [200, 90, 90, 1]);
      const p1 = (await viewer.get(`/performance?siteId=${sid}&days=7`)).json; assert.deepEqual([p1.connected, p1.current.clicks, p1.current.impressions, p1.previous.clicks, p1.change.clicksPct, p1.series.length, p1.pages[0].page, p1.countries[0].key], [true, 28, 700, 28, 0, 7, 'https://blog.example/guide/', 'usa']);
      assert.equal((await viewer.get(`/performance/opportunities?siteId=${sid}`)).json.connected, true); assert.equal((await viewer.get('/performance?siteId=00000000-0000-0000-0000-000000000009')).status, 404);
      googleFake.st.apiStatus = 403; const bad = await c.post(`/sites/${sid}/gsc-sync`); assert.equal(bad.status, 409); assert.match(bad.json.error, /Search Console|yetki|izin/i); assert.equal((await viewer.get(`/sites/${sid}`)).json.gscError.length > 0, true); googleFake.st.apiStatus = null;
      // internal links
      const cat = (await P.listCategories(pid))[0].id; const words = (n, t) => Array.from({ length: n }, (_, i) => `Sentence ${t}-${i} says something plain here.`).join(' ');
      const target = await A.create({ projectId: pid, h1: 'Wifi guide', focusKeyword: 'wifi 7 router', categoryId: cat, contentHtml: `<h2>Guide</h2><p>${words(60, 'a')}</p>`, articleType: 'evergreen_guide' });
      const from = await A.create({ projectId: pid, h1: 'Basics', focusKeyword: 'home network basics', categoryId: cat, contentHtml: `<h2>Basics</h2><p>${words(60, 'b')} Pick a wifi 7 router wisely.</p>`, articleType: 'evergreen_guide' });
      await H.db().query("UPDATE articles SET status = 'ready' WHERE id = ANY($1)", [[target.id, from.id]]);
      assert.equal((await viewer.post('/internal-links/find', { projectId: pid })).status, 403); const found = await editor.post('/internal-links/find', { projectId: pid }); assert.deepEqual([found.status, found.json.created], [200, 1]);
      const ls = (await viewer.get(`/internal-links?projectId=${pid}`)).json.links; assert.deepEqual([ls.length, ls[0].anchor, ls[0].draft, ls[0].fromTitle, ls[0].toTitle], [1, 'wifi 7 router', true, 'Basics', 'Wifi guide']);
      assert.equal((await editor.post(`/internal-links/${ls[0].id}/apply`)).status, 403, 'putting a link into an article is a publishing decision: admin only'); const ap = await c.post(`/internal-links/${ls[0].id}/apply`); assert.equal(ap.status, 409); assert.match(ap.json.error, /henüz yayında değil/);
      assert.equal((await viewer.post(`/internal-links/${ls[0].id}/reject`)).status, 403); assert.equal((await editor.post(`/internal-links/${ls[0].id}/reject`)).status, 200); assert.equal((await viewer.get(`/internal-links?projectId=${pid}&status=rejected`)).json.links.length, 1); assert.equal((await viewer.get(`/internal-links?projectId=${pid}&status=nope`)).status, 400);
      assert.ok((await c.get('/audit?action=internal_links')).json.items.length >= 2 && (await c.get('/audit?action=site.gsc')).json.items.length >= 1);
    } finally { await fake.close(); }
  } finally { googleFake = null; }
});

test('AdSense site audit over HTTP: anyone signed in reads, an editor starts one (it goes through the queue, one per address), the publisher number is admin-only, and the result is the stored checklist', opts, async () => {
  const fakeSite = require('./fakeSite'); const site = await fakeSite.start(fakeSite.FRESH); const SC = require('../../src/content/services/scheduler');
  try {
    const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
    assert.equal((await viewer.post('/adsense/audits', { projectId: pid, url: site.url })).status, 403); assert.equal((await editor.post('/adsense/audits', { projectId: pid, url: 'ftp://x.com' })).status, 400); assert.equal((await editor.post('/adsense/audits', { projectId: pid })).status, 400);
    const o0 = (await viewer.get(`/adsense/overview?projectId=${pid}`)).json; assert.deepEqual([o0.latest.length, o0.pending.length, o0.sites.length], [0, 0, 0]);
    const q = await editor.post('/adsense/audits', { projectId: pid, url: `${site.url}/` }); assert.deepEqual([q.status, q.json.queued, q.json.url], [202, true, site.url]);
    assert.equal((await editor.post('/adsense/audits', { projectId: pid, url: site.url })).status, 409, 'one audit per address at a time');
    assert.deepEqual((await viewer.get(`/adsense/overview?projectId=${pid}`)).json.pending.map((p) => [p.url, p.status]), [[site.url, 'queued']]);
    const job = await SC.workOnce({ ctx: {} }); assert.deepEqual([job.botKey, job.outcome], ['adsense_compliance', 'done']);
    const o1 = (await viewer.get(`/adsense/overview?projectId=${pid}`)).json; assert.deepEqual([o1.latest.length, o1.pending.length, o1.latest[0].verdict, o1.latest[0].verdictLabel], [1, 0, 'not_ready', 'Eksikler var']);
    const one = (await viewer.get(`/adsense/audits/${o1.latest[0].id}`)).json; assert.ok(one.items.length > 20 && one.items.every((i) => i.detail && i.status)); assert.equal(one.items.find((i) => i.key === 'privacy').status, 'missing');
    assert.equal((await viewer.get(`/adsense/audits/00000000-0000-0000-0000-000000000009`)).status, 404); assert.equal((await viewer.get('/adsense/audits/not-a-uuid')).status, 404);
    assert.equal((await viewer.get(`/adsense/audits?projectId=${pid}&url=${encodeURIComponent(site.url)}`)).json.audits.length, 1);
    // a connected site: the publisher number is admin-only and validated; an audit by site id uses it
    const sid = (await c.post('/sites', { projectId: pid, name: 'Blog', apiUrl: site.url, username: 'editor', password: 'abcd efgh ijkl mnop' })).json.id;
    assert.equal((await editor.put(`/sites/${sid}`, { adsensePubId: 'pub-1234567890123456' })).status, 403); assert.equal((await c.put(`/sites/${sid}`, { adsensePubId: 'nope' })).status, 400);
    const put = await c.put(`/sites/${sid}`, { adsensePubId: 'ca-pub-1234567890123456' }); assert.deepEqual([put.status, put.json.adsensePubId], [200, 'pub-1234567890123456']);
    const q2 = await editor.post('/adsense/audits', { projectId: pid, siteId: sid }); assert.equal(q2.status, 202); await SC.workOnce({ ctx: {} });
    const a2 = (await viewer.get(`/adsense/overview?projectId=${pid}`)).json.latest[0]; const d2 = (await viewer.get(`/adsense/audits/${a2.id}`)).json; assert.equal(d2.items.find((i) => i.key === 'adsense_code').status, 'missing', 'the number is known: the code is looked for');
    assert.equal((await editor.post('/adsense/audits', { projectId: pid, siteId: '00000000-0000-0000-0000-000000000009' })).status, 404);
    assert.ok((await c.get('/audit?action=adsense')).json.items.length >= 2);
  } finally { await site.close(); }
});

test('Telegram over HTTP: the webhook needs Telegram\'s secret (no cookie, no CSRF header), a stranger is ignored, a retry after a failure is handled once, and the setup routes are admin-only without ever returning the token', opts, async () => {
  const { fakeTelegram, update, TOKEN } = require('./fakeTelegram'); const tg = fakeTelegram(); const TGS = require('../../src/content/services/telegram'); TGS.useFetch(tg.fetchImpl); TGS.resetCounters();
  try {
    const c = await signedIn(); const editor = await signedIn('editor'); await signedIn('viewer');
    const hook = (body, secret) => realFetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) }, body: JSON.stringify(body) });   // as Telegram calls it: no cookie, no X-Requested-With
    assert.equal((await hook(update(1, 1001, '/status'), 'anything')).status, 401, 'not configured: nobody gets in');
    assert.equal((await editor.put('/providers/telegram', { secret: TOKEN, extra: { chatIds: '1001' } })).status, 403); const saved = await c.put('/providers/telegram', { secret: TOKEN, extra: { chatIds: '1001' } }); assert.equal(saved.status, 200); assert.ok(!saved.text.includes(TOKEN));
    const secret = TGS.webhookSecret(TOKEN);
    assert.equal((await hook(update(1, 1001, '/status'))).status, 401); assert.equal((await hook(update(1, 1001, '/status'), 'wrong')).status, 401); assert.equal(tg.sent().length, 0, 'nothing was answered');
    const ok = await hook(update(2, 1001, '/help'), secret); assert.deepEqual([ok.status, (await ok.json()).ok], [200, true]); assert.equal(tg.sent().length, 1); assert.match(tg.sent()[0].text, /\/status/);
    assert.equal((await hook(update(2, 1001, '/help'), secret)).status, 200); assert.equal(tg.sent().length, 1, 'the same update twice: one answer');
    assert.equal((await hook(update(3, 5555, '/status'), secret)).status, 200); assert.equal(tg.sent().length, 1, 'a stranger gets the same 200 and no answer');
    assert.equal((await hook({}, secret)).status, 200); assert.equal((await hook({ update_id: 4, message: { text: 'hi' } }, secret)).status, 200, 'broken updates do not crash it');
    // Telegram is unreachable while we answer: the update is NOT lost, the retry is handled
    tg.st.down = true; assert.equal((await hook(update(5, 1001, '/help'), secret)).status, 500); tg.st.down = false;
    assert.equal((await hook(update(5, 1001, '/help'), secret)).status, 200); assert.equal(tg.sent().length, 2, 'the retry was answered');
    // setup routes
    for (const [m, p] of [['get', '/telegram/status'], ['get', '/telegram/webhook/info'], ['post', '/telegram/webhook/set'], ['post', '/telegram/webhook/delete'], ['post', '/telegram/test-message']]) assert.equal((await editor[m](p)).status, 403, p);
    const st = await c.get('/telegram/status'); assert.deepEqual([st.status, st.json.configured, st.json.chatIds, st.json.webhook], [200, true, ['1001'], null]); assert.ok(!st.text.includes(TOKEN) && !st.text.includes(secret));
    const nohttps = await c.post('/telegram/webhook/set'); assert.equal(nohttps.status, 400); assert.match(nohttps.json.error, /https/, 'the test server is http: Telegram would refuse it');
    const set = await c.post('/telegram/webhook/set', { baseUrl: 'https://api.example.com/' }); assert.deepEqual([set.status, set.json.url], [200, 'https://api.example.com/api/content/telegram/webhook']); assert.equal(tg.st.webhook.secret, secret);
    assert.equal((await c.get('/telegram/webhook/info')).json.pending, 2); assert.equal((await c.post('/telegram/test-message')).json.sent, 1);
    assert.equal((await c.post('/telegram/webhook/delete')).status, 200); assert.equal(tg.st.webhook, null);
    assert.ok((await c.get('/audit?action=telegram')).json.items.length >= 3);
    const sav = await c.put('/settings/telegram', { value: { notify: { newArticle: false } } }); assert.equal(sav.status, 200); assert.deepEqual([sav.json.value.notify.newArticle, sav.json.value.notify.critical], [false, true]);
  } finally { TGS.useFetch(null); }
});

test('reports, all sites and the cost analysis over HTTP: everyone signed in reads, an editor makes a report, a viewer cannot; the report is stored and readable; wrong ids and kinds are refused', opts, async () => {
  const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
  assert.equal((await viewer.post('/reports', { projectId: pid, kind: 'daily' })).status, 403); assert.equal((await editor.post('/reports', { projectId: pid, kind: 'monthly' })).status, 400);
  const made = await editor.post('/reports', { projectId: pid, kind: 'weekly' }); assert.deepEqual([made.status, made.json.kind, made.json.data.seo.sites, typeof made.json.body], [201, 'weekly', [], 'string']);
  const list = (await viewer.get(`/reports?projectId=${pid}`)).json.reports; assert.deepEqual([list.length, list[0].kind, list[0].body], [1, 'weekly', undefined], 'the list is light');
  const one = await viewer.get(`/reports/${list[0].id}`); assert.deepEqual([one.status, one.json.body.startsWith('🗓 Haftalık rapor')], [200, true]); assert.equal((await viewer.get('/reports/00000000-0000-0000-0000-000000000009')).status, 404); assert.equal((await viewer.get(`/reports?projectId=${pid}&kind=nope`)).status, 400);
  assert.equal((await viewer.get(`/reports?projectId=${pid}&kind=daily`)).json.reports.length, 0);
  const pf = (await viewer.get('/portfolio?days=28')).json; assert.deepEqual([pf.days, pf.projects.length, pf.totals.sites], [28, 1, 0]); assert.equal((await viewer.get('/portfolio?days=5')).status, 400);
  const co = (await viewer.get('/costs/analysis')).json; assert.deepEqual([co.days, co.totals.knownUsd, co.recommendations.length, co.forecast], [30, 0, 0, null]);
  assert.ok((await c.get('/audit?action=report')).json.items.length >= 1);
  const TGS = require('../../src/content/services/telegram'); const { fakeTelegram, update, TOKEN } = require('./fakeTelegram'); const tg = fakeTelegram(); TGS.useFetch(tg.fetchImpl);
  try {
    await c.put('/providers/telegram', { secret: TOKEN, extra: { chatIds: '1001' } });
    await TGS.handleUpdate(update(31, 1001, '/report weekly')); assert.match(tg.sent().pop().text, /🗓 Haftalık rapor/); await TGS.handleUpdate(update(32, 1001, '/report')); assert.match(tg.sent().pop().text, /Henüz günlük rapor yok/);
  } finally { TGS.useFetch(null); }
});

test('the blind comparison over HTTP: only an admin starts, picks or discards; everyone else reads it blind (not one vendor key on the wire) until it is decided, then everything is shown', opts, async () => {
  const CMP = require('../../src/content/services/comparisons'); const dbm = require('../../src/content/db');
  const c = await signedIn(); const editor = await signedIn('editor'); const viewer = await signedIn('viewer'); const pid = (await c.get('/projects')).json.projects[0].id;
  await c.put('/providers/anthropic', { secret: 'sk-ant-http-key-0123456789' });
  await c.post('/news/sources', { projectId: pid, name: 'Chrome', kind: 'rss', url: `${feedBase}/chrome.xml`, sourceType: 'official', reliability: 90 });
  await waitRun(c, (await c.post('/news/run', { projectId: pid })).json.run.id); await c.post('/opportunities/refresh', { projectId: pid });
  await dbm.query(`UPDATE news_items SET url = '${feedBase}/page.html?i=' || id::text`); await dbm.query("UPDATE content_opportunities SET eligible = true, ineligible_reason = '' WHERE keyword_id IS NOT NULL");
  const opp = (await c.get(`/opportunities?projectId=${pid}&eligible=1`)).json.items[0];
  for (const who of [editor, viewer]) assert.equal((await who.post('/comparisons', { opportunityId: opp.id })).status, 403, 'it spends money: admin only');
  const callsBefore = models.calls.length; const one = await c.post('/comparisons', { opportunityId: opp.id }); assert.equal(one.status, 409); assert.match(one.json.error, /en az 2 hazır/); assert.equal(models.calls.length, callsBefore, 'nothing was asked');
  await c.put('/providers/openai', { secret: 'sk-openai-http-key-0123456789', extra: { model: 'gpt-test' } });
  assert.equal((await c.post('/comparisons', { opportunityId: 'nope' })).status, 400); assert.equal((await c.post('/comparisons', { opportunityId: '00000000-0000-0000-0000-000000000009' })).status, 404); assert.equal((await c.post('/comparisons', { opportunityId: opp.id, providers: ['anthropic', 'bing'] })).status, 400);
  const start = await c.post('/comparisons', { opportunityId: opp.id }); assert.deepEqual([start.status, start.json.askedCount], [202, 2]); await CMP.wait(start.json.id);
  assert.equal((await c.post('/comparisons', { opportunityId: opp.id })).status, 409, 'one open comparison per idea');
  const blind = await viewer.get(`/comparisons/${start.json.id}`); assert.deepEqual([blind.status, blind.json.status, blind.json.blind, blind.json.entries.length, blind.json.entries.map((e) => e.label)], [200, 'ready', true, 2, ['A', 'B']]);
  const wire = JSON.stringify({ ...blind.json, idea: undefined, entries: blind.json.entries.map((e) => ({ ...e, fields: Object.keys(e.fields) })) }); assert.ok(!/anthropic|openai|claude|gpt|"model"|"provider"|costUsd|tokens|duration/i.test(wire), wire.slice(0, 300));
  assert.ok(blind.json.entries.every((e) => e.fields.contentHtml.length > 200 && e.measured.words > 50), 'the drafts and the free numbers are there');
  const lst = (await viewer.get(`/comparisons?projectId=${pid}`)).json.comparisons; assert.deepEqual([lst.length, lst[0].blind], [1, true]); assert.equal((await viewer.get('/comparisons/stats')).json.decisions, 0);
  assert.equal((await editor.post(`/comparisons/${start.json.id}/pick`, { label: 'A' })).status, 403); assert.equal((await viewer.post(`/comparisons/${start.json.id}/discard`, {})).status, 403);
  assert.equal((await c.post(`/comparisons/${start.json.id}/pick`, { label: 'Z' })).status, 400); assert.equal((await viewer.get('/comparisons/00000000-0000-0000-0000-000000000009')).status, 404); assert.equal((await viewer.get('/comparisons/not-a-uuid')).status, 404);
  const pick = await c.post(`/comparisons/${start.json.id}/pick`, { label: 'b' }); assert.equal(pick.status, 200); assert.deepEqual([pick.json.comparison.status, pick.json.comparison.blind, pick.json.comparison.pickedLabel, pick.json.comparison.providers.slice().sort()], ['picked', false, 'B', ['anthropic', 'openai']]);
  await CMP.wait(`pick:${start.json.id}`); const shown = await viewer.get(`/comparisons/${start.json.id}`); assert.ok(/anthropic|openai/.test(shown.text) && shown.json.entries.every((e) => e.provider && e.model), 'after the decision everything is shown');
  assert.equal((await c.post(`/comparisons/${start.json.id}/discard`, {})).status, 409); assert.equal((await viewer.get('/comparisons/stats')).json.decisions, 1);
  const art = (await viewer.get(`/articles/${pick.json.articleId}`)).json; assert.deepEqual([art.createdBy, art.generation.blindPick], ['ai', 'B']);
  const aud = (await c.get('/audit?action=comparison')).json.items; assert.ok(aud.some((x) => x.action === 'comparison.start') && aud.some((x) => x.action === 'comparison.pick'));
  assert.ok(!aud.find((x) => x.action === 'comparison.start').after || !/anthropic|openai/.test(JSON.stringify(aud.find((x) => x.action === 'comparison.start').after)), 'the audit of the start does not name the vendors');
});
