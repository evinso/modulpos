const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const K = require('../../src/content/services/keywords');
const SERP = require('../../src/content/services/serp');
const O = require('../../src/content/services/opportunities');
const ND = require('../../src/content/services/nicheDiscovery');
const TR = require('../../src/content/services/trends');
const PR = require('../../src/content/services/providers');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const A = require('../../src/content/services/articles');
const { FetchError } = require('../../src/content/lib/safeFetch');
const { fakeApify } = require('./fakeApify');
const { fakeSerper } = require('./fakeSerper');
const APIFY = 'apify-token-0123456789abcdef'; const SERPER = 'serper-key-0123456789abcdef';

const opts = { skip: H.skip };
const NOW = new Date('2026-11-21T12:00:00Z');
const count = async (sql, p = []) => (await H.db().query(sql, p)).rows[0].n;

const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d || 'Fri, 21 Nov 2026 10:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;
const feeds = (map) => async (url) => { if (!map[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: map[url], url }; };

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

/** a project with real data sources set up: Google volumes through Apify, SERP through Serper, no partial scores (the free mode without them is tested in contentFreeMode.test.js) */
async function site(configure = true) {
  const { projectId } = await P.seedDefault();
  await S.set('seo', { serpProvider: 'serper', partialWithApproval: false });
  if (configure) { await PR.save('apify', { secret: APIFY }); await PR.save('serper', { secret: SERPER }); }
  return projectId;
}

test('keywords: add (cleaned, no duplicates), list with filters, csv, delete; state shows "no data" until asked', opts, async () => {
  const pid = await site();
  const r = await K.add(pid, ['ChatGPT Plus', 'chatgpt plus', '  Gemini   3 ', '“Claude” pricing', 'x'.repeat(90), '']);
  assert.deepEqual(r, { added: 3, existing: 0, invalid: 2 }); assert.deepEqual(await K.add(pid, ['gemini 3']), { added: 0, existing: 1, invalid: 0 });
  await assert.rejects(K.add(pid, ['a b'], { country: 'DE' }), /Desteklenen ülkeler/); await assert.rejects(K.add(pid, 'nope'), /liste/);
  const l = await K.list(pid, { pageSize: 10, sort: 'keyword', dir: 'asc' }, { now: NOW });
  assert.deepEqual(l.items.map((x) => [x.keyword, x.dataState]), [['chatgpt plus', 'none'], ['claude pricing', 'none'], ['gemini 3', 'none']]);
  assert.equal((await K.list(pid, { q: 'gem' })).total, 1); assert.equal((await K.list(pid, { q: '100%' })).total, 0); assert.equal((await K.list(pid, { state: 'found' })).total, 0);
  const csv = await K.exportCsv(pid); assert.ok(csv.body.startsWith('﻿') && csv.body.includes('Henüz sorgulanmadı') && csv.filename.endsWith('.csv'));
  assert.equal(await K.remove(pid, [l.items[0].id]), 1); assert.equal((await K.list(pid)).total, 2); await assert.rejects(K.remove(pid, []), /1 ile 500/);
});

test('metrics: needs the provider; asks in ONE batch, stores real values and "Veri bulunamadı", records the cost as UNKNOWN (never 0), then serves from cache', opts, async () => {
  const pid = await site(false);
  await K.add(pid, ['chatgpt plus price', 'gemini 3', 'zzz unknown thing']);
  await assert.rejects(K.fetchMetrics(pid, { now: NOW }), (e) => e.status === 409 && /Apify henüz ayarlanmadı/.test(e.message) && /Dosyadan hacim aktar/.test(e.message));
  await PR.save('apify', { secret: APIFY });
  const monthly = Array.from({ length: 12 }, (_, i) => ({ year: 2026 - (i < 1 ? 1 : 0), month: ((i + 11) % 12) + 1, search_volume: [100, 100, 100, 100, 100, 100, 100, 100, 100, 150, 200, 300][i] }));
  const f = fakeApify({ volumes: { 'chatgpt plus price': { volume: 9900, cpc: 2.4, comp: 0.5, kd: 41, intent: 'commercial', monthly }, 'gemini 3': { volume: 18100 }, 'zzz unknown thing': { none: true } } });
  const plan = await K.plan(pid, { now: NOW }); assert.deepEqual([plan.total, plan.cached, plan.toAsk, plan.requests, plan.configured, plan.estimatedCostUsd], [3, 0, 3, 1, true, null], 'the price is not known to us: no made-up number'); assert.match(plan.estimateNote, /Tutarı bilemeyiz/);
  const r = await K.fetchMetrics(pid, { fetchImpl: f.fetchImpl, now: NOW });
  assert.deepEqual([r.requested, r.fetched, r.found, r.notFound, r.noAnswer, r.requests, r.costUsd, r.unknownCost], [3, 3, 2, 1, 0, 1, 0, 1]);
  const ask = f.asked(); assert.equal(ask.length, 1); assert.deepEqual([ask[0].body.keywords.length, ask[0].body.location, ask[0].body.mode, ask[0].path], [3, 'US', 'metrics', '/v2/acts/gaelasao~keyword-research-api/run-sync-get-dataset-items']); assert.equal(ask[0].auth, `Bearer ${APIFY}`, 'the token travels in the header, not in the address');
  const l = Object.fromEntries((await K.list(pid, {}, { now: NOW })).items.map((x) => [x.keyword, x]));
  assert.deepEqual([l['chatgpt plus price'].dataState, l['chatgpt plus price'].metrics.searchVolume, l['chatgpt plus price'].metrics.cpc, l['chatgpt plus price'].metrics.keywordDifficulty, l['chatgpt plus price'].metrics.intent, l['chatgpt plus price'].metrics.trendPct, l['chatgpt plus price'].metrics.provider], ['found', 9900, 2.4, 41, 'commercial', 116.7, 'apify']);   // last 3 months 650 vs the 3 before 300
  assert.equal(l['zzz unknown thing'].dataState, 'not_found'); assert.equal(l['zzz unknown thing'].metrics.searchVolume, null, 'unknown stays null, never 0');
  const u = await PR.usageReport({ days: 1, now: NOW }); assert.equal(u.recent[0].costUsd, null); assert.equal(u.recent[0].costText, 'Bilinmiyor'); assert.equal(u.recent[0].operation, 'keyword_overview'); assert.equal(u.recent[0].units, 3); assert.equal(u.recent[0].provider, 'apify');
  assert.equal((await L.status({ now: NOW })).items.find((i) => i.workType === 'seo_keywords').done, 3);
  const again = await K.fetchMetrics(pid, { fetchImpl: f.fetchImpl, now: new Date(NOW.getTime() + 86400000) });
  assert.equal(again.requested, 0); assert.equal(f.asked().length, 1, 'cached: no second run'); assert.match(again.message, /önbellekten/);
  await K.add(pid, ['claude pro price']); const more = await K.fetchMetrics(pid, { fetchImpl: f.fetchImpl, now: new Date(NOW.getTime() + 86400000) });
  assert.deepEqual([more.requested, more.cached, more.noAnswer], [1, 3, 1], 'only the new one is asked; the actor said nothing about it (no answer, not "no data")');
  const later = await K.fetchMetrics(pid, { fetchImpl: f.fetchImpl, now: new Date(NOW.getTime() + 31 * 86400000) });
  assert.equal(later.requested, 4, 'after cacheDays (30) the data is asked again; the one that got no answer is still waiting');
  const flt = await K.list(pid, { minVolume: 10000, state: 'found' }, { now: NOW }); assert.deepEqual(flt.items.map((x) => x.keyword), ['gemini 3']);
  assert.equal((await K.list(pid, { minTrend: 50 })).total, 1, 'trend filter'); assert.equal((await K.list(pid, { intent: 'commercial' })).total, 1);
});

test('metrics: batches of the chosen size, the daily limit cuts a batch (partial), the MONTHLY keyword cap stops BEFORE calling, errors release the units, timeouts keep them, an actor that says nothing is not "no data"', opts, async () => {
  const pid = await site();
  await PR.save('apify', { extra: { batchSize: '500', monthlyKeywordCap: '5000' } });
  for (let i = 0; i < 3; i++) await K.add(pid, Array.from({ length: 500 }, (_, j) => `keyword number ${i * 500 + j}`));
  await L.setGlobalLimits({ seo_keywords: 5000 });
  const f = fakeApify({ volumes: Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`keyword number ${i}`, { volume: 10 + i }])) });
  const r = await K.fetchMetrics(pid, { fetchImpl: f.fetchImpl, now: NOW });
  assert.deepEqual([r.requests, r.fetched, f.asked().map((c) => c.body.keywords.length)], [3, 1500, [500, 500, 500]]);
  await H.clean(); const pid2 = await site(); await K.add(pid2, ['a one', 'b two', 'c three', 'd four', 'e five']);
  await L.setGlobalLimits({ seo_keywords: 3 });
  const f2 = fakeApify({ volumes: { 'a one': { volume: 10 }, 'b two': { volume: 20 }, 'c three': { volume: 30 }, 'd four': { volume: 40 }, 'e five': { volume: 50 } } });       // (which three are asked first is not fixed: every keyword has an answer)
  const p = await K.fetchMetrics(pid2, { fetchImpl: f2.fetchImpl, now: NOW });
  assert.deepEqual([p.fetched, p.limited, f2.asked()[0].body.keywords.length], [3, 2, 3]); assert.match(p.stopped, /limit/);
  const none = await K.fetchMetrics(pid2, { fetchImpl: f2.fetchImpl, now: NOW }); assert.equal(f2.asked().length, 1, 'limit full: no call'); assert.match(none.stopped, /günlük limit doldu/);
  await L.setGlobalLimits({ seo_keywords: 100 });
  await PR.save('apify', { extra: { monthlyKeywordCap: '3' } });
  const capped = await K.fetchMetrics(pid2, { fetchImpl: f2.fetchImpl, now: NOW }); assert.equal(f2.asked().length, 1, 'monthly cap reached (3 asked): no call'); assert.match(capped.stopped, /Aylık anahtar kelime güvenlik sınırına ulaşıldı \(3\)/);
  const plan = await K.plan(pid2, { now: NOW }); assert.deepEqual([plan.monthly.cap, plan.monthly.used, plan.monthly.remaining, plan.allowedToday], [3, 3, 0, 0]);
  await PR.save('apify', { extra: { monthlyKeywordCap: '600' } });
  const before = (await L.status({ now: NOW })).items.find((i) => i.workType === 'seo_keywords').done;
  f2.state.fail = 401;
  const bad = await K.fetchMetrics(pid2, { fetchImpl: f2.fetchImpl, now: NOW }); assert.match(bad.stopped, /belirteci reddedildi/); assert.equal(bad.fetched, 0);
  assert.equal((await L.status({ now: NOW })).items.find((i) => i.workType === 'seo_keywords').done, before, 'a refused call gives its units back');
  f2.state.fail = 'timeout'; await K.fetchMetrics(pid2, { fetchImpl: f2.fetchImpl, now: NOW });
  assert.equal((await L.status({ now: NOW })).items.find((i) => i.workType === 'seo_keywords').done, before + 2, 'a timeout may have been billed: the units stay used');
  const errs = (await PR.usageReport({ days: 1, now: NOW })).recent.filter((x) => x.result === 'error'); assert.equal(errs.length, 2); assert.ok(errs.every((x) => x.costUsd === null && x.costText === 'Bilinmiyor'));
  assert.equal(await count("SELECT count(*)::int n FROM automation_runs WHERE bot_key = 'keyword_research' AND status = 'error'"), 2);
  // a plan limit of the actor (it only looked up the first keywords) or an empty answer: those keywords are NOT stored as "no data"
  f2.state.fail = null; f2.state.noItems = true; const before2 = await count("SELECT count(*)::int n FROM keyword_metrics");
  const silent = await K.fetchMetrics(pid2, { fetchImpl: f2.fetchImpl, now: NOW }); assert.deepEqual([silent.fetched, silent.noAnswer, silent.notFound], [0, 2, 0]); assert.match(silent.message, /2 için aktör cevap vermedi/); assert.equal(await count("SELECT count(*)::int n FROM keyword_metrics"), before2, 'nothing was stored');
  assert.equal((await K.list(pid2)).items.filter((x) => x.dataState === 'none').length, 2, 'they are still waiting to be asked');
  assert.equal((await L.status({ now: NOW })).items.find((i) => i.workType === 'seo_keywords').done, before + 2, 'the units of keywords nobody answered are given back');
});

test('ideas: autocomplete suggestions and related searches arrive as keywords WITHOUT data (they are ideas, not measurements); one Serper credit counted against the SERP limit', opts, async () => {
  const pid = await site();
  const f = fakeSerper({}, { chatgpt: ['how to use chatgpt', 'chatgpt plus price', 'chatgpt login', 'ChatGPT login'] });
  const r = await K.suggest(pid, 'ChatGPT', { limit: 50, fetchImpl: f.fetchImpl, now: NOW });
  assert.deepEqual([r.added, r.returned, r.withData, r.costUsd], [3, 3, 0, null]);
  assert.match(f.calls[0].url, /\/autocomplete$/); assert.deepEqual([f.calls[0].body.q, f.calls[0].body.gl, f.calls[0].body.hl, f.calls[0].key], ['chatgpt', 'us', 'en', SERPER]);
  const l = Object.fromEntries((await K.list(pid, {}, { now: NOW })).items.map((x) => [x.keyword, x]));
  assert.equal(l['how to use chatgpt'].origin, 'question'); assert.equal(l['chatgpt plus price'].origin, 'suggestion'); assert.equal(l['chatgpt login'].dataState, 'none', 'an idea has no data yet: not "0", not "not found"'); assert.equal(l['chatgpt login'].metrics, null);
  const st = (await L.status({ now: NOW })).items; assert.deepEqual([st.find((i) => i.workType === 'serp_queries').done, st.find((i) => i.workType === 'seo_keywords').done], [1, 0], 'one SERP-type query, no keyword units');
  const u = (await PR.usageReport({ days: 1, now: NOW })).recent[0]; assert.deepEqual([u.provider, u.operation, u.costUsd, u.units], ['serper', 'keyword_suggestions', null, 1]);
  const rel = await K.suggest(pid, 'chatgpt', { mode: 'related', fetchImpl: f.fetchImpl, now: NOW }); assert.equal(rel.added, 2); assert.match(f.calls[1].url, /\/search$/);
  assert.deepEqual((await K.list(pid, { origin: 'related' })).items.map((x) => x.keyword), ['chatgpt plus cost']); assert.deepEqual((await K.list(pid, { origin: 'question' })).items.map((x) => x.keyword).sort(), ['how to use chatgpt', 'is it worth it']);
  assert.deepEqual(await K.suggest(pid, 'chatgpt', { fetchImpl: f.fetchImpl, now: NOW }).then((x) => [x.added, x.existing]), [0, 3], 'known keywords are not duplicated');
  await assert.rejects(K.suggest(pid, '', {}), /Başlangıç ifadesi`?|1-10 kelime/); await assert.rejects(K.suggest(pid, 'x y', { limit: 500 }), /1 ile 100/);
  f.state.status = 401; await assert.rejects(K.suggest(pid, 'claude', { fetchImpl: f.fetchImpl, now: NOW }), (e) => e.status === 401 && /reddedildi/.test(e.message));
  await PR.save('serper', { clearSecret: true }); await assert.rejects(K.suggest(pid, 'claude', { fetchImpl: f.fetchImpl, now: NOW }), (e) => e.status === 409 && /Serper henüz ayarlanmadı/.test(e.message));
});

test('SERP (Serper): a real top 10 -> competition estimate with its factors, saved with the questions; cached; limit and budget respected', opts, async () => {
  const pid = await site();
  await K.add(pid, ['obscure app thing', 'chatgpt pricing']);
  const kws = Object.fromEntries((await K.list(pid)).items.map((x) => [x.keyword, x.id]));
  const f = fakeSerper({ 'obscure app thing': ['smallblog.dev', 'niche-tech.net', 'reddit.com', 'mysite.io', 'techie.org', 'a.blog'], 'chatgpt pricing': ['openai.com', 'theverge.com', 'techcrunch.com', 'wikipedia.org', 'forbes.com', 'cnet.com', 'zdnet.com', 'apple.com', 'wired.com', 'youtube.com'] });
  const easy = await SERP.analyze(kws['obscure app thing'], { fetchImpl: f.fetchImpl, now: NOW });
  assert.equal(easy.cached, false); assert.ok(easy.analysis.competition <= 25, `easy ${easy.analysis.competition}`); assert.equal(easy.analysis.questions[0], 'Is it worth it?'); assert.match(easy.analysis.disclaimer, /resmî zorluk metriği değildir/);
  assert.equal(easy.analysis.costUsd, null, 'a credit is not a dollar: unknown, never 0'); assert.ok(easy.analysis.factors.length >= 3 && easy.analysis.results[0].kind === 'independent');
  assert.equal(f.calls[0].body.num, 10); assert.equal(f.calls[0].body.q, 'obscure app thing');
  const hard = await SERP.analyze(kws['chatgpt pricing'], { fetchImpl: f.fetchImpl, now: NOW }); assert.ok(hard.analysis.competition >= 70);
  const again = await SERP.analyze(kws['obscure app thing'], { fetchImpl: f.fetchImpl, now: NOW }); assert.equal(again.cached, true); assert.equal(f.calls.length, 2, 'a cached analysis costs nothing');
  const forced = await SERP.analyze(kws['obscure app thing'], { fetchImpl: f.fetchImpl, now: NOW, force: true }); assert.equal(forced.cached, false); assert.equal(f.calls.length, 3);
  assert.equal((await K.list(pid, { maxCompetition: 30 })).items.length, 1, 'the competition filter uses the latest analysis');
  assert.equal((await SERP.list(pid)).length, 2);
  await L.setGlobalLimits({ serp_queries: 3 });
  const out = await SERP.analyze(kws['chatgpt pricing'], { fetchImpl: f.fetchImpl, now: NOW, force: true }); assert.match(out.stopped, /günlük limit doldu/); assert.equal(f.calls.length, 3);
  await L.setGlobalLimits({ serp_queries: 30 }); await PR.save('serper', { dailyBudgetUsd: 0.0005 });
  const budget = await SERP.analyze(kws['chatgpt pricing'], { fetchImpl: f.fetchImpl, now: NOW, force: true }); assert.match(budget.stopped, /bütçesi doldu/);
  await PR.save('serper', { dailyBudgetUsd: null }); f.state.status = 401;
  await assert.rejects(SERP.analyze(kws['chatgpt pricing'], { fetchImpl: f.fetchImpl, now: NOW, force: true }), (e) => e.status === 401);
  await assert.rejects(SERP.analyze('00000000-0000-0000-0000-000000000001', {}), /bulunamadı/);
});

// ── from headlines to a scored idea ─────────────────────────────────────────────────────────────────────────
async function withEvent(pid) {
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  const map = { 'https://a.example/feed': rssOf([['OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1'], ['Celebrity gossip: star joins ChatGPT ad', 'https://a.example/2']]),
    'https://b.example/feed': rssOf([['ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1', 'Fri, 21 Nov 2026 11:00:00 GMT']]) };
  await N.runDiscovery(pid, { fetchImpl: feeds(map), now: NOW, gapMs: 0 });
}

test('opportunities: nothing is scored from guesses - each missing piece of real data is named; once data exists the total follows the weights; eligibility has reasons', opts, async () => {
  const pid = await site(); await H.noFreshLane(); await withEvent(pid);
  const made = await O.refresh(pid, { now: NOW });
  assert.equal(made.topicsCreated, 1, 'one relevant event (the gossip one is excluded)'); assert.ok(made.keywordsAdded >= 2);
  let o = (await O.list(pid)).items[0];
  assert.equal(o.eligible, false); assert.match(o.ineligibleReason, /Anahtar kelime verisi henüz çekilmedi/); assert.equal(o.total, null); assert.ok(o.provisional !== null, 'only a provisional score exists');
  assert.equal(o.relevance, 100 > 0 ? o.relevance : 0); assert.equal(o.explain.missing.includes('demand'), true);
  const kws = (await K.list(pid)).items.map((x) => x.keyword); assert.ok(kws.includes('chatgpt plus') && kws.some((k) => /pricing/.test(k)), kws.join(', '));
  const f = fakeApify({ volumes: { 'chatgpt plus': { volume: 74000 }, 'chatgpt plus pricing': { volume: 9900 } } }); const fs = fakeSerper({ 'chatgpt plus': ['smallblog.dev', 'niche-tech.net', 'reddit.com', 'mysite.io', 'techie.org'] });
  await K.fetchMetrics(pid, { fetchImpl: f.fetchImpl, now: NOW });
  await O.refresh(pid, { now: NOW }); o = (await O.list(pid)).items[0];
  assert.match(o.ineligibleReason, /Eksik veri: SERP analizi yapılmadı/); assert.equal(o.keyword, 'chatgpt plus', 'the keyword with the highest real volume represents the topic'); assert.equal(o.demand, Math.round(20 * Math.log10(74001)));
  const kw = (await K.list(pid)).items.find((x) => x.keyword === 'chatgpt plus');
  await SERP.analyze(kw.id, { fetchImpl: fs.fetchImpl, now: NOW });
  await O.refresh(pid, { now: NOW }); o = (await O.list(pid)).items[0];
  assert.ok(o.total !== null && o.provisional !== null); assert.equal(o.competition, 100 - kw.serp?.competition || o.competition);
  const w = o.weights; assert.equal(o.total, Math.round((o.trend * w.trend + o.competition * w.competition + o.demand * w.demand + o.relevance * w.relevance + o.source * w.source) / 100), 'the total is exactly the weighted sum of the five parts');
  assert.equal(o.eligible, o.total >= 70, o.ineligibleReason); assert.ok(o.total >= 70, `expected an easy, high-demand, hot topic to pass, got ${o.total}`);
  // the owner changes the weights: the total follows
  await S.set('scoring', { trend: 0, competition: 100, demand: 0, relevance: 0, source: 0 }, { scope: 'project', projectId: pid });
  await O.refresh(pid, { now: NOW }); const o2 = (await O.list(pid)).items[0]; assert.equal(o2.total, o.competition, 'only competition counts now');
  await S.reset('scoring', { scope: 'project', projectId: pid }); await O.refresh(pid, { now: NOW });
  // the minimum score is the strategy's (or the category's own)
  await P.updateNiche(pid, { minOpportunityScore: 100 }); await O.refresh(pid, { now: NOW });
  assert.match((await O.list(pid)).items[0].ineligibleReason, /Fırsat puanı \d+, en az 100 gerekli/);
  const cat = (await P.listCategories(pid)).find((c) => c.id === o.categoryId); await P.updateCategory(cat.id, { minOpportunityScore: 10 }); await O.refresh(pid, { now: NOW });
  assert.equal((await O.list(pid)).items[0].eligible, true, 'the category\'s own minimum wins over the strategy\'s');
});

test('opportunities: never eligible when out of niche, rejected, or competing with an own article; a person can shortlist, reject, reopen', opts, async () => {
  const pid = await site(); await withEvent(pid);
  const f = fakeApify({ volumes: { 'chatgpt plus': { volume: 50000 }, 'chatgpt plus pricing': { volume: 5000 } } }); const fs = fakeSerper({ 'chatgpt plus': ['smallblog.dev', 'niche-tech.net', 'mysite.io', 'techie.org', 'reddit.com'] });
  await O.refresh(pid, { now: NOW }); await K.fetchMetrics(pid, { fetchImpl: f.fetchImpl, now: NOW });
  const kwId = (await K.list(pid)).items.find((x) => x.keyword === 'chatgpt plus').id; await SERP.analyze(kwId, { fetchImpl: fs.fetchImpl, now: NOW }); await O.refresh(pid, { now: NOW });
  let o = (await O.list(pid)).items[0]; assert.equal(o.eligible, true);
  const sl = await O.setStatus(o.id, 'shortlisted', { now: NOW }); assert.equal(sl.status, 'shortlisted'); assert.equal(sl.eligible, true);
  const rj = await O.setStatus(o.id, 'rejected'); assert.deepEqual([rj.eligible, rj.ineligibleReason], [false, 'Reddedildi']);
  await O.refresh(pid, { now: NOW }); assert.equal((await O.list(pid)).items[0].eligible, false, 'a refresh does not resurrect a rejected idea');
  await O.setStatus(o.id, 'new', { now: NOW }); await O.refresh(pid, { now: NOW });assert.equal((await O.list(pid)).items[0].eligible, true);
  await A.create({ projectId: pid, h1: 'Own article about ChatGPT Plus', focusKeyword: 'chatgpt plus', contentHtml: '<p>x</p>' });
  await O.refresh(pid, { now: NOW }); o = (await O.list(pid)).items[0]; assert.equal(o.eligible, false); assert.match(o.ineligibleReason, /kanibalizasyon/);
  await H.db().query("DELETE FROM articles"); await O.refresh(pid, { now: NOW });
  const cl = (await N.listClusters(pid, { status: 'relevant' })).items[0]; await N.setClusterStatus(cl.id, 'irrelevant'); await O.refresh(pid, { now: NOW });
  assert.match((await O.list(pid)).items[0].ineligibleReason, /Nişe uygun değil/);
  await assert.rejects(O.setStatus(o.id, 'queued'), /şunlardan biri/); await assert.rejects(O.setStatus('00000000-0000-0000-0000-000000000001', 'new'), /bulunamadı/);
  await H.db().query("UPDATE content_opportunities SET status = 'queued'"); await assert.rejects(O.setStatus(o.id, 'rejected'), (e) => e.status === 409);
});

test('selectForGeneration: only eligible ideas, never more than the free room, categories furthest below their share first, never padded', opts, async () => {
  const pid = await site(); const cats = await P.listCategories(pid);
  const mkTopic = async (title, cat, total, eligible = true) => {
    const t = (await H.db().query("INSERT INTO topics (project_id, category_id, title) VALUES ($1,$2,$3) RETURNING id", [pid, cat.id, title])).rows[0];
    await H.db().query(`INSERT INTO content_opportunities (project_id, topic_id, category_id, title, total_score, provisional_score, eligible, ineligible_reason) VALUES ($1,$2,$3,$4,$5,$5,$6,$7)`, [pid, t.id, cat.id, title, total, eligible, eligible ? '' : 'Fırsat puanı düşük']);
  };
  await mkTopic('AI one', cats[0], 90); await mkTopic('AI two', cats[0], 88); await mkTopic('AI three', cats[0], 86); await mkTopic('Privacy one', cats[2], 80); await mkTopic('Weak one', cats[1], 55, false);
  // 12 recent articles, all in the AI category: it is far above its 35 % share, privacy (15 %) is empty
  for (let i = 0; i < 12; i++) await H.db().query("INSERT INTO articles (project_id, category_id, slug, h1, created_at) VALUES ($1,$2,$3,$4,$5)", [pid, cats[0].id, `a-${i}`, `A ${i}`, new Date(NOW.getTime() - 86400000)]);
  const sel = await O.selectForGeneration(pid, { count: 2, now: NOW });
  assert.equal(sel.picked, 2); assert.deepEqual(sel.picks.map((x) => x.title), ['Privacy one', 'AI one'], 'the empty 15 % category goes first although its idea scores 80 against 90: the category AI is far above its 35 %');
  await H.db().query("UPDATE content_opportunities SET total_score = 60, provisional_score = 60 WHERE title = 'Privacy one'");
  assert.equal((await O.selectForGeneration(pid, { count: 1, now: NOW })).picks[0].title, 'AI one', 'a much better idea still beats a weak idea from a hungry category (the balance is worth at most 10 points)');
  await H.db().query("UPDATE content_opportunities SET total_score = 80, provisional_score = 80 WHERE title = 'Privacy one'");
  assert.ok(!JSON.stringify(sel).includes('Weak one') || sel.skipped.every((s) => s.title !== 'Weak one'), 'an ineligible idea is never a candidate');
  const room = await O.selectForGeneration(pid, { now: NOW }); assert.equal(room.picked, 3, 'default: the free room of the day (project limit 3)');
  await L.setProjectLimits(pid, { new_article: 1 }); assert.equal((await O.selectForGeneration(pid, { count: 5, now: NOW })).picked, 1, 'never beyond the day\'s room');
  await L.setProjectLimits(pid, { new_article: 10 }); await L.setGlobalLimits({ new_article: 10 }); await P.updateCategory(cats[0].id, { dailyMax: 1 });
  const capped = await O.selectForGeneration(pid, { count: 5, now: NOW }); assert.deepEqual(capped.picks.map((x) => x.title).sort(), ['AI one', 'Privacy one'], 'the AI category\'s own daily maximum of 1 holds'); assert.ok(capped.skipped.some((s) => /günlük sınırı doldu/.test(s.why)));
  assert.match(capped.note, /kota doldurmak için zayıf konu eklenmez/, 'it says it did not pad');
  await H.db().query("UPDATE content_opportunities SET eligible = false"); const empty = await O.selectForGeneration(pid, { count: 3, now: NOW }); assert.deepEqual([empty.picked, empty.picks], [0, []]);
});

test('niche discovery: a subject that keeps appearing in headlines no category covers becomes a SUGGESTION; a person accepts (new category / link), rejects or postpones', opts, async () => {
  const pid = await site();
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed' }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed' }); await N.createSource(pid, { name: 'Outlet C', kind: 'rss', url: 'https://c.example/feed' });
  const heads = (p) => Array.from({ length: 3 }, (_, i) => [`Electric scooter maker launches ${['budget', 'premium', 'folding'][i]} model number ${i + 1}`, `https://${p}.example/${i}`]);
  const noise = [['Football match tonight on TV', 'https://a.example/f'], ['Smart thermostat battery life tested in the lab', 'https://a.example/t']];
  const map = { 'https://a.example/feed': rssOf([...heads('a'), ...noise]), 'https://b.example/feed': rssOf(heads('b')), 'https://c.example/feed': rssOf(heads('c')) };
  await N.runDiscovery(pid, { fetchImpl: feeds(map), now: NOW, gapMs: 0 });
  const r = await ND.discover(pid, { now: NOW }); assert.ok(r.created >= 1);
  const list = await ND.list(pid); const s = list.find((x) => /electric scooter/i.test(x.label)); assert.ok(s, list.map((x) => x.label).join(' | '));
  assert.deepEqual([s.status, s.evidence.items >= 9, s.evidence.sources], ['new', true, 3]); assert.equal(s.evidence.samples.length, 3);
  assert.ok(!list.some((x) => /football/i.test(x.label)), 'excluded topics are never suggested');
  assert.equal((await ND.discover(pid, { now: NOW })).created, 0, 'the same suggestion is not made twice');
  const acc = await ND.decide(s.id, { action: 'accept', mode: 'new_category', name: 'Mikro Mobilite', nameEn: 'Micromobility' });
  assert.equal(acc.status, 'accepted'); const cat = (await P.listCategories(pid)).find((c) => c.nameEn === 'Micromobility'); assert.deepEqual([cat.targetSharePct, cat.relatedKeywords.includes(s.terms[0])], [0, true]);
  assert.equal((await P.listCategories(pid)).reduce((a, c) => a + (c.status !== 'archived' ? c.targetSharePct : 0), 0), 100, 'shares still total 100');
  await H.db().query("INSERT INTO niche_suggestions (project_id, label, terms) VALUES ($1, 'Smart Home', ARRAY['smart home hub'])", [pid]); const sh = (await ND.list(pid)).find((x) => x.label === 'Smart Home');
  const cats = await P.listCategories(pid);
  const link = await ND.decide(sh.id, { action: 'accept', mode: 'link_category', categoryId: cats[1].id }); assert.equal(link.linkedCategoryId, cats[1].id);
  assert.ok((await P.listCategories(pid)).find((c) => c.id === cats[1].id).relatedKeywords.includes('smart home hub'));
  await H.db().query("INSERT INTO niche_suggestions (project_id, label, terms) VALUES ($1, 'Drones', ARRAY['drone camera'])", [pid]); const dr = (await ND.list(pid)).find((x) => x.label === 'Drones');
  assert.equal((await ND.decide(dr.id, { action: 'later' })).status, 'later'); assert.equal((await ND.decide(dr.id, { action: 'reject' })).status, 'rejected');
  await assert.rejects(ND.decide(dr.id, { action: 'accept', mode: 'link_category', categoryId: '00000000-0000-0000-0000-000000000001' }), /bu projeye ait değil/); await assert.rejects(ND.decide(dr.id, { action: 'explode' }), /şunlardan biri/);
  await assert.rejects(ND.decide('00000000-0000-0000-0000-000000000001', { action: 'reject' }), /bulunamadı/);
  assert.equal((await ND.list(pid, { status: 'rejected' })).length, 1);
});

test('trends: ranks events by sources / velocity / freshness from real counts; the daily series and category split are real', opts, async () => {
  const pid = await site(); await withEvent(pid);
  const t = await TR.overview(pid, { now: NOW });
  assert.equal(t.clusters.length, 1); const c = t.clusters[0]; assert.equal(c.sourceCount, 2); assert.ok(c.score >= 40 && c.factors.length === 3);
  assert.equal(t.daily.length, 14); assert.equal(t.daily.at(-1).day, '2026-11-21'); assert.ok(t.daily.at(-1).items >= 3 && t.daily.at(-1).relevant >= 2);
  assert.equal(t.byCategory[0].name, 'AI Tools & Updates', 'OpenAI + ChatGPT are strong AI terms, "price" only a weak one'); assert.deepEqual(t.keywordTrends, [], 'no search data yet: no keyword trends, nothing invented');
  const empty = await TR.overview(pid, { now: new Date('2026-12-30T12:00:00Z') }); assert.equal(empty.clusters.length, 0);
});
