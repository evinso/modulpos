const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const K = require('../../src/content/services/keywords');
const SERP = require('../../src/content/services/serp');
const O = require('../../src/content/services/opportunities');
const PR = require('../../src/content/services/providers');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const { FetchError } = require('../../src/content/lib/safeFetch');

/**
 * The FREE mode: SERP competition from Serper.dev, search volumes from an imported file, and ideas without a volume judged by a partial score that only
 * a person's shortlist call can turn into production. Real Serper calls have never been made (no key): these tests use a fake fetch shaped like the vendor's public example.
 */
const { fakeSerper } = require('./fakeSerper');
const opts = { skip: H.skip };
const NOW = new Date('2026-11-21T12:00:00Z');
const KEY = 'serper-key-0123456789abcdef';
const EASY = ['smallblog.dev', 'niche-tech.net', 'reddit.com', 'mysite.io', 'techie.org'];

const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d || 'Fri, 21 Nov 2026 10:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;
const feeds = (map) => async (url) => { if (!map[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: map[url], url }; };
async function withEvent(pid) {
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  const map = { 'https://a.example/feed': rssOf([['OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1']]),
    'https://b.example/feed': rssOf([['ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1', 'Fri, 21 Nov 2026 11:00:00 GMT']]) };
  await N.runDiscovery(pid, { fetchImpl: feeds(map), now: NOW, gapMs: 0 });
}
const done = async (pid, workType) => (await L.status({ projectId: pid, now: NOW })).items.find((i) => i.workType === workType).done;

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

test('Serper: needs its key; one query gives the organic estimate (source, credits, unknown cost recorded); cached; a rejected key gives the day\'s place back', opts, async () => {
  const { projectId: pid } = await P.seedDefault();
  assert.equal((await S.get('seo', pid)).value.serpProvider, 'serper', 'the free source is the default');
  await K.add(pid, ['chatgpt plus pricing']); const kw = (await K.list(pid)).items[0];
  const f = fakeSerper({ 'chatgpt plus pricing': EASY });
  await assert.rejects(SERP.analyze(kw.id, { fetchImpl: f.fetchImpl, now: NOW }), (e) => e.status === 409 && /Serper henüz ayarlanmadı/.test(e.message));
  assert.equal(f.calls.length, 0); assert.equal(await done(pid, 'serp_queries'), 0, 'nothing was reserved for a refused start');
  await PR.save('serper', { secret: KEY });
  const out = await SERP.analyze(kw.id, { fetchImpl: f.fetchImpl, now: NOW }); const a = out.analysis;
  assert.equal(out.cached, false); assert.equal(a.provider, 'serper'); assert.equal(a.providerLabel, 'Serper.dev');
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, { q: 'chatgpt plus pricing', gl: 'us', hl: 'en', num: 10 }); assert.equal(f.calls[0].key, KEY); assert.equal(f.calls[0].url, 'https://google.serper.dev/search'); assert.equal(f.calls[0].method, 'POST');
  assert.equal(typeof a.competition, 'number'); assert.ok(a.competition < 55, `small blogs and a forum: easy, got ${a.competition}`);
  assert.equal(a.results.length, 5); assert.equal(a.results[0].domain, 'smallblog.dev', 'the www. prefix is dropped'); assert.deepEqual(a.questions, ['Is it worth it?']); assert.deepEqual(a.related, ['chatgpt plus cost']); assert.deepEqual(a.features, ['featured_snippet', 'people_also_ask']);
  assert.equal(a.costUsd, null, 'a credit is not a dollar amount: unknown, never 0');
  assert.ok(a.factors.some((x) => x.key === 'fresh'), 'relative dates ("3 days ago") count for the freshness factor'); assert.ok(!a.factors.some((x) => x.key === 'authority'), 'Serper gives no referring domains: that factor is left out, not invented');
  const u = (await PR.usageReport({ now: NOW })).recent[0]; assert.deepEqual([u.provider, u.operation, u.units, u.costText], ['serper', 'serp_organic', 1, 'Bilinmiyor']);
  assert.equal(await done(pid, 'serp_queries'), 1);
  assert.equal((await SERP.analyze(kw.id, { fetchImpl: f.fetchImpl, now: NOW })).cached, true); assert.equal(f.calls.length, 1, 'inside the cache days nothing is asked again');
  f.state.status = 403;
  await assert.rejects(SERP.analyze(kw.id, { fetchImpl: f.fetchImpl, now: NOW, force: true }), (e) => e.status === 401 && /reddedildi/.test(e.message));
  assert.equal(await done(pid, 'serp_queries'), 1, 'a refused key was not billed: the place is given back');
  f.state.status = 400; f.state.body = { message: 'Not enough credits' };
  await assert.rejects(SERP.analyze(kw.id, { fetchImpl: f.fetchImpl, now: NOW, force: true }), (e) => e.status === 502 && /kredisi bitti/.test(e.message));
  f.state.status = 200; f.state.throwTimeout = true;
  await assert.rejects(SERP.analyze(kw.id, { fetchImpl: f.fetchImpl, now: NOW, force: true }), (e) => e.status === 502 && /cevap vermedi/.test(e.message));
  assert.equal(await done(pid, 'serp_queries'), 2, 'a timeout may have been billed: its place stays used');
  assert.equal((await PR.usageReport({ now: NOW })).providers.find((p) => p.provider === 'serper').errors, 3);
});

test('Serper is the only SERP source: each analysis remembers where it came from; a setting that names anything else is refused; an old stored value is repaired by the migration', opts, async () => {
  const { projectId: pid } = await P.seedDefault();
  await K.add(pid, ['gemini 3']); const kw = (await K.list(pid)).items[0];
  await PR.save('serper', { secret: KEY }); const f = fakeSerper({ 'gemini 3': EASY });
  await SERP.analyze(kw.id, { fetchImpl: f.fetchImpl, now: NOW });
  assert.equal((await SERP.latest(kw.id)).provider, 'serper'); assert.equal(f.calls.length, 1);
  await assert.rejects(S.set('seo', { serpProvider: 'dataforseo' }), /şunlardan biri|geçersiz|seçenek/i); await assert.rejects(S.set('seo', { serpProvider: 'bing' }), /şunlardan biri|geçersiz|seçenek/i);
  // a database that still holds what DataForSEO left (the owner's saved login/password and the old setting): the migration removes the credentials and repairs the setting
  await H.db().query("INSERT INTO api_providers (key, label, encrypted_secret, secret_last4, extra) VALUES ('dataforseo', 'DataForSEO', 'enc:v1:secret', 'word', '{\"login\":\"me@example.com\"}')");
  await H.db().query("INSERT INTO automation_settings (scope, project_id, key, value) VALUES ('global', NULL, 'seo', '{\"serpProvider\":\"dataforseo\",\"cacheDays\":7}') ON CONFLICT DO NOTHING");
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/content/migrations/0013_remove_dataforseo.sql'), 'utf8'); await H.db().query(sql);
  assert.equal((await H.db().query("SELECT count(*)::int n FROM api_providers WHERE key = 'dataforseo'")).rows[0].n, 0, 'the saved credentials are gone'); const st = await S.get('seo'); assert.deepEqual([st.value.serpProvider, st.value.cacheDays], ['serper', 7], 'the setting is repaired and the rest of it is kept');
  assert.deepEqual(Object.keys((await PR.list()).reduce((a, p) => ({ ...a, [p.key]: 1 }), {})).includes('dataforseo'), false, 'the provider does not exist any more');
});

test('Serper connection test: says what happened in words, and the key never appears in the stored sentence', opts, async () => {
  await P.seedDefault();
  await assert.rejects(PR.test('serper', {}), /önce api anahtarı/i);
  await assert.rejects(PR.save('serper', { secret: 'short' }), /beklenen biçimde değil/);
  await PR.save('serper', { secret: KEY });
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const ok = await PR.test('serper', { fetchImpl: reply(200, { organic: [] }) }); assert.deepEqual([ok.ok, /1 kredi/.test(ok.message)], [true, true]);
  assert.match((await PR.test('serper', { fetchImpl: reply(403, { message: 'Unauthorized.' }) })).message, /reddedildi/);
  assert.match((await PR.test('serper', { fetchImpl: reply(400, { message: 'Not enough credits' }) })).message, /kredisi bitmiş/);
  assert.match((await PR.test('serper', { fetchImpl: reply(429, {}) })).message, /sınırladı/);
  const leaked = await PR.test('serper', { fetchImpl: async () => { throw new Error(`boom ${KEY}`); } }); assert.equal(leaked.ok, false); assert.ok(!leaked.message.includes(KEY));
  const row = (await PR.list()).find((p) => p.key === 'serper'); assert.equal(row.configured, true); assert.equal(row.secretLast4, KEY.slice(-4)); assert.ok(!JSON.stringify(row).includes(KEY));
});

// ── search volumes from a file ──────────────────────────────────────────────────────────────────────────────
const PLANNER = ['Keyword Stats 2026-11-21 at 10_00_00', 'Nov 2025 - Oct 2026', ['Keyword', 'Currency', 'Avg. monthly searches', 'Three month change', 'Competition', 'Competition (indexed value)', 'Top of page bid (low range)', 'Searches: Jun 2026', 'Searches: Jul 2026', 'Searches: Aug 2026', 'Searches: Sep 2026', 'Searches: Oct 2026', 'Searches: Nov 2026'].join('\t'),
  ['chatgpt plus pricing', 'USD', '9900', '0%', 'Low', '12', '0.5', '100', '100', '100', '200', '200', '200'].join('\t'),
  ['windows 11', 'USD', '1K – 10K', '0%', 'High', '80', '1.2', '', '', '', '', '', ''].join('\t'),
  ['Airpods Pro 3', 'USD', '880', '0%', 'Medium', '45', '0.9', '', '', '', '', '', ''].join('\t'),
  ['airpods pro 3', 'USD', '1,200', '0%', 'Medium', '45', '0.9', '', '', '', '', '', ''].join('\t'),
  ['iphone 17', 'USD', '', '', '', '', '', '', '', '', '', '', ''].join('\t')].join('\r\n');

test('import: exact volumes become the newest real data; ranges and empty rows are skipped AND counted; new words are added; no limit or budget is touched', opts, async () => {
  const { projectId: pid } = await P.seedDefault();
  await K.add(pid, ['airpods pro 3']);
  const r = await K.importMetrics(pid, PLANNER, { now: NOW });
  assert.deepEqual([r.imported, r.added, r.updated], [2, 1, 1], 'chatgpt plus pricing is new, airpods pro 3 existed (the later of its two rows wins)');
  assert.deepEqual([r.skipped.range, r.skipped.empty], [1, 1]); assert.deepEqual(r.examples.range, ['windows 11']); assert.match(r.message, /2 anahtar kelimenin hacmi içe aktarıldı.*2 satır atlandı/);
  const l = Object.fromEntries((await K.list(pid, {}, { now: NOW })).items.map((x) => [x.keyword, x]));
  assert.deepEqual([l['chatgpt plus pricing'].dataState, l['chatgpt plus pricing'].metrics.searchVolume, l['chatgpt plus pricing'].metrics.provider, l['chatgpt plus pricing'].metrics.paidCompetition], ['found', 9900, 'csv', 0.12]);
  assert.equal(l['chatgpt plus pricing'].metrics.trendPct, 100, 'last 3 months 600 against 300 before');
  assert.equal(l['airpods pro 3'].metrics.searchVolume, 1200); assert.equal(l['windows 11'], undefined, 'a range is not a volume: the word is not even added');
  assert.equal(await done(pid, 'seo_keywords'), 0, 'no provider was asked: the daily keyword limit is untouched');
  assert.equal((await H.db().query('SELECT count(*)::int n FROM api_usage')).rows[0].n, 0);
  await K.importMetrics(pid, 'keyword,volume\nchatgpt plus pricing,12000', { now: new Date('2026-11-22T12:00:00Z') });
  assert.equal((await K.list(pid, {}, { now: NOW })).items.find((x) => x.keyword === 'chatgpt plus pricing').metrics.searchVolume, 12000, 'a newer import replaces the older numbers');
  assert.equal((await H.db().query('SELECT count(*)::int n FROM keywords')).rows[0].n, 2, 'importing again adds no duplicate keyword');
});

test('import: refuses what it cannot read honestly (empty, no volume column, wrong country, UTF-16 garbage, too many rows)', opts, async () => {
  const { projectId: pid } = await P.seedDefault();
  await assert.rejects(K.importMetrics(pid, '   '), /Dosya boş/);
  await assert.rejects(K.importMetrics(pid, 'Keyword\nchatgpt\ngemini'), /Hacim sütunu bulunamadı/);
  await assert.rejects(K.importMetrics(pid, 'foo,bar\n1,2'), /Anahtar kelime sütunu bulunamadı/);
  await assert.rejects(K.importMetrics(pid, 'keyword,volume\na b,10', { country: 'DE' }), /Desteklenen ülkeler/);
  await assert.rejects(K.importMetrics(pid, 'k\u0000e\u0000y\u0000'), /UTF-16/);
  const many = `keyword,volume\n${Array.from({ length: 2001 }, (_, i) => `word ${i},${i + 1}`).join('\n')}`;
  await assert.rejects(K.importMetrics(pid, many), /en fazla 2000 satır/);
  const none = await K.importMetrics(pid, 'keyword,volume\nonly a range,1K - 10K\nrounded one,10K'); assert.equal(none.imported, 0); assert.match(none.message, /kesin hacmi olan satır bulunamadı/); assert.equal((await K.list(pid)).total, 0);
  const sc = await K.importMetrics(pid, 'Search term;Search Volume;CPC\n"best, cheap vpn";"1.200";"$1,25"\nplain word;300;2'); assert.deepEqual([sc.imported, sc.delimiter], [2, ';']);
  const m = (await K.list(pid)).items.find((x) => x.keyword === 'best cheap vpn'); assert.deepEqual([m.metrics.searchVolume, m.metrics.cpc], [1200, 1.25]);
});

// ── ideas without a volume: partial score, a person decides ─────────────────────────────────────────────────
test('partial score: no volume anywhere -> judged on the most specific candidate phrase, labelled partial, eligible ONLY after a person shortlists it; real data later gives a normal score', opts, async () => {
  const { projectId: pid } = await P.seedDefault(); await withEvent(pid);
  await O.refresh(pid, { now: NOW });
  let o = (await O.list(pid)).items[0];
  const cand = o.keyword; assert.ok(cand && cand.split(' ').length >= 2, `the most specific candidate phrase, not a bare name: ${cand}`); assert.equal(o.total, null); assert.equal(o.partial, false);
  assert.match(o.ineligibleReason, /SERP analizi yapılmadı/, 'without a real SERP check there is nothing to judge');
  await PR.save('serper', { secret: KEY }); const f = fakeSerper({ '*': EASY });
  await P.updateNiche(pid, { minOpportunityScore: 10 });
  await SERP.analyze(o.keywordId, { fetchImpl: f.fetchImpl, now: NOW });
  await O.refresh(pid, { now: NOW }); o = (await O.list(pid)).items[0];
  assert.deepEqual([o.partial, o.total, o.eligible], [true, null, false]); assert.ok(o.provisional !== null && o.competition !== null && o.demand === null);
  assert.match(o.ineligibleReason, /Kısa liste/); assert.match(o.explain.note, /KISMİ PUAN/);
  const w = o.weights; assert.equal(o.provisional, Math.round((o.trend * w.trend + o.competition * w.competition + o.relevance * w.relevance + o.source * w.source) / (w.trend + w.competition + w.relevance + w.source)), 'the average of the four REAL parts, nothing else');
  assert.equal((await O.selectForGeneration(pid, { count: 3, now: NOW })).picked, 0, 'not shortlisted: never selected');
  const sl = await O.setStatus(o.id, 'shortlisted', { now: NOW }); assert.deepEqual([sl.eligible, sl.total, sl.partial, sl.ineligibleReason], [true, null, true, '']);
  const sel = await O.selectForGeneration(pid, { count: 3, now: NOW }); assert.equal(sel.picked, 1); assert.match(sel.picks[0].why, /Kısmi puan \d+ \(hacim verisi yok, sizin onayınızla\)/);
  await O.refresh(pid, { now: NOW }); assert.equal((await O.list(pid)).items[0].eligible, true, 'a refresh keeps the person\'s decision');
  assert.equal((await O.list(pid, { minScore: String(o.provisional) })).total, 1, 'the minimum-score filter understands partial scores'); assert.equal((await O.list(pid, { minScore: '100' })).total, 0);
  await P.updateNiche(pid, { minOpportunityScore: 100 }); await O.refresh(pid, { now: NOW });
  assert.match((await O.list(pid)).items[0].ineligibleReason, /Kısmi puan \d+, en az 100 gerekli/);
  await P.updateNiche(pid, { minOpportunityScore: 10 }); await O.setStatus(o.id, 'new', { now: NOW }); assert.equal((await O.list(pid)).items[0].eligible, false, 'taking it off the shortlist withdraws the approval');
  await O.setStatus(o.id, 'shortlisted', { now: NOW });
  // real volume arrives (an imported file): the same idea now has a full, normal score and no approval is needed
  await K.importMetrics(pid, `keyword,volume\n${cand},9900`, { now: NOW }); await O.setStatus(o.id, 'new', { now: NOW }); await O.refresh(pid, { now: NOW });
  o = (await O.list(pid)).items[0]; assert.deepEqual([o.partial, o.total !== null, o.eligible, o.status], [false, true, true, 'new']); assert.equal(o.demand, Math.round(20 * Math.log10(9901)));
});

test('partial score: switched off in the settings, an idea without a volume is simply not eligible (the old strict behaviour)', opts, async () => {
  const { projectId: pid } = await P.seedDefault(); await withEvent(pid);
  await S.set('seo', { partialWithApproval: false });
  await O.refresh(pid, { now: NOW }); const o = (await O.list(pid)).items[0];
  assert.deepEqual([o.keyword, o.partial, o.eligible], [null, false, false]); assert.match(o.ineligibleReason, /Anahtar kelime verisi henüz çekilmedi/);
  assert.equal((await O.rescore(o.id, { now: NOW })).explain.partial, false);
});
