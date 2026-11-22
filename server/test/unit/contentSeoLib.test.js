const test = require('node:test');
const assert = require('node:assert/strict');
const apify = require('../../src/content/services/apify');
const kd = require('../../src/content/lib/keywordData');
const serperLib = require('../../src/content/services/serper');
const { scoreSerp, kindOf } = require('../../src/content/services/serp');
const O = require('../../src/content/services/opportunities');
const trends = require('../../src/content/services/trends');
const K = require('../../src/content/services/keywords');

const reply = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const months = (vals) => vals.map((v, i) => ({ year: 2026 - (i < 1 ? 1 : 0), month: ((i + 11) % 12) + 1, search_volume: v }));
const norm = (arr) => arr.map((m) => ({ year: m.year, month: m.month, searchVolume: m.search_volume }));
/** the default actor's output as its public page describes it (field names from the page; NOT captured from a real run) */
const item = (keyword, volume, extra = {}) => ({ keyword, search_volume: volume, cpc: 1.25, competition: 0.42, competition_level: 'MEDIUM', keyword_difficulty: extra.kd ?? 38, search_intent: extra.intent || 'informational', monthly_searches: extra.monthly || [], data_status: extra.status || 'ok' });

test('Apify client: request shape (token in the header, the actor path with ~, the input of each actor), records read from BOTH actors\' field names, trend from the history', async () => {
  let seen; const f = async (url, o) => { seen = { url, o, body: JSON.parse(o.body) }; return { ok: true, status: 200, json: async () => [item('chatgpt pricing', 33100, { monthly: months([100, 100, 100, 100, 100, 100, 100, 100, 100, 150, 450, 300]), intent: 'commercial' }), { keyword: 'no data kw', data_status: 'no_data', monthly_searches: [] }] }; };
  const c = apify.createClient({ token: 'tok-secret', fetchImpl: f });
  const r = await c.keywordOverview({ keywords: ['chatgpt pricing', 'no data kw', 'silent one'], country: 'GB', language: 'en' });
  assert.equal(seen.url, 'https://api.apify.com/v2/acts/gaelasao~keyword-research-api/run-sync-get-dataset-items?timeout=240'); assert.equal(seen.o.method, 'POST'); assert.equal(seen.o.headers.Authorization, 'Bearer tok-secret'); assert.ok(!seen.url.includes('tok-secret'), 'never in the address');
  assert.deepEqual(seen.body, { keywords: ['chatgpt pricing', 'no data kw', 'silent one'], mode: 'metrics', location: 'GB', language: 'en', includeTrend: true });
  const a = r.records[0]; assert.deepEqual([a.keyword, a.found, a.searchVolume, a.cpc, a.paidCompetition, a.competitionLevel, a.keywordDifficulty, a.intent], ['chatgpt pricing', true, 33100, 1.25, 0.42, 'medium', 38, 'commercial']);
  assert.equal(kd.trendPct(a.monthly), 200, 'last 3 months 900 vs the 3 before 300 = +200%');
  assert.deepEqual([r.records[1].found, r.records[1].searchVolume], [false, null], 'the actor says "no data": that is an answer (null, not 0)'); assert.deepEqual([r.missing, r.units], [['silent one'], 3], 'a keyword the actor did not mention is "no answer", NOT "no data"');
  // the other actor, other field names and input
  let seen2; const c2 = apify.createClient({ token: 't', actor: 'plainrows/keyword-search-volume', fetchImpl: async (u, o) => { seen2 = { u, body: JSON.parse(o.body) }; return { ok: true, status: 200, json: async () => [{ keyword: 'a b', found: true, searchVolume: 880, cpcUsd: 0.9, competition: 'HIGH', competitionLevel: 'HIGH', keywordDifficulty: 51, searchIntent: ['transactional', 'x'], monthlySearches: [{ year: 2026, month: 1, searchVolume: 5 }] }, { keyword: 'c d', found: false }] }; } });
  const r2 = await c2.keywordOverview({ keywords: ['a b', 'c d'] });
  assert.match(seen2.u, /acts\/plainrows~keyword-search-volume\//); assert.deepEqual(seen2.body, { keywords: ['a b', 'c d'], mode: 'volume', country: 'US', languageCode: 'en', historyMonths: 12 });
  assert.deepEqual([r2.records[0].searchVolume, r2.records[0].cpc, r2.records[0].paidCompetition, r2.records[0].intent, r2.records[0].monthly], [880, 0.9, 0.8, 'transactional', [{ year: 2026, month: 1, searchVolume: 5 }]]); assert.equal(r2.records[1].found, false);
  assert.deepEqual(await c.keywordOverview({ keywords: [] }), { records: [], missing: [], units: 0 });
  await assert.rejects(c.keywordOverview({ keywords: Array.from({ length: 1001 }, (_, i) => `k${i}`) }), /en fazla 1000/); await assert.rejects(c.keywordOverview({ keywords: ['a b'], country: 'FR' }), /desteklenmiyor/);
  assert.throws(() => apify.createClient({ token: '' }), /belirteci gerekli/);
  assert.equal(kd.trendPct(norm(months([1, 2, 3]))), null, 'too little history'); assert.equal(kd.trendPct(norm(months([5, 5, 5, 5, 5, 5, 0, 0, 0, 1, 1, 1]))), null, 'earlier period had no searches');
});

test('Apify client: errors in words (token, credit, actor gone, run too long, rate limit, bad input, server, network, timeout), "maybe billed" only where it could be, the token never in a message, a non-list answer is refused', async () => {
  const mk = (resp, status) => apify.createClient({ token: 'TOPSECRET', fetchImpl: reply(resp, status) });
  const code = (p) => p.then(() => null, (e) => [e.code, e.message, !!e.maybeBilled, !!e.retryable]);
  const ask = (c) => c.keywordOverview({ keywords: ['a b'] });
  assert.deepEqual((await code(ask(mk({ error: { type: 'x', message: 'bad' } }, 401)))).slice(0, 1), ['auth']); assert.match((await code(ask(mk({}, 401))))[1], /reddedildi \(401\)/);
  assert.equal((await code(ask(mk({ error: { type: 'not-enough-usage', message: 'Not enough credit left' } }, 402))))[0], 'funds'); assert.equal((await code(ask(mk({ error: { message: 'Monthly usage limit exceeded' } }, 403))))[0], 'funds', '403 that talks about usage is the credit');
  const gone = await code(ask(mk({ error: { type: 'record-not-found' } }, 404))); assert.deepEqual([gone[0], /kaldırılmış ya da adı değişmiş/.test(gone[1])], ['not_found', true]);
  const slow = await code(ask(mk({}, 408))); assert.deepEqual([slow[0], slow[2], slow[3]], ['timeout', true, true], 'a run that did not finish may have been billed');
  assert.deepEqual((await code(ask(mk({}, 429)))).slice(0, 1), ['rate_limit']); assert.equal((await code(ask(mk({ error: { message: 'Input is not valid: keywords' } }, 400))))[0], 'bad_request');
  const srv = await code(ask(mk({}, 503))); assert.deepEqual([srv[0], srv[2], srv[3]], ['http', true, true]);
  const net = await code(ask(apify.createClient({ token: 'TOPSECRET', fetchImpl: async () => { throw new Error('connect failed TOPSECRET'); } }))); assert.equal(net[0], 'network'); assert.ok(!net[1].includes('TOPSECRET'));
  const to = await code(ask(apify.createClient({ token: 'x', fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } }))); assert.deepEqual([to[0], to[2]], ['timeout', true]);
  const notList = await code(ask(mk({ data: 'x' }, 200))); assert.deepEqual([notList[0], notList[2]], ['bad_answer', true]);
  for (const st of [401, 402, 404, 408, 429, 400, 503]) assert.ok(!(await code(ask(mk({ error: { message: 'TOPSECRET' } }, st))))[1].includes('TOPSECRET'), `status ${st}`);
});

test('Apify client: the free account and actor checks read what is there and leave out what is not (usage is a bonus)', async () => {
  const route = (map) => async (url) => { const p = new URL(url).pathname; const hit = map[p]; return hit === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => hit }; };
  const full = apify.createClient({ token: 't', fetchImpl: route({ '/v2/users/me': { data: { username: 'me', plan: { id: 'FREE' } } }, '/v2/users/me/limits': { data: { current: { monthlyUsageUsd: 0.5 }, limits: { maxMonthlyUsageUsd: 5 } } }, '/v2/acts/gaelasao~keyword-research-api': { data: { name: 'keyword-research-api', username: 'gaelasao', title: 'T' } } }) });
  assert.deepEqual(await full.account(), { username: 'me', plan: 'FREE', usage: { usedUsd: 0.5, limitUsd: 5 } }); assert.deepEqual(await full.actorInfo(), { name: 'keyword-research-api', username: 'gaelasao', title: 'T' });
  const bare = apify.createClient({ token: 't', fetchImpl: route({ '/v2/users/me': { data: { username: 'me' } } }) }); assert.deepEqual(await bare.account(), { username: 'me', plan: null, usage: null }, 'no limits endpoint: no usage, no failure');
});

test('keyword data helpers: the countries, the trend rule, the question test, the empty record', () => {
  assert.deepEqual(kd.LOCATIONS, { US: 2840, GB: 2826, CA: 2124, AU: 2036 }); assert.deepEqual([kd.isQuestion('how to use chatgpt'), kd.isQuestion('chatgpt login'), kd.isQuestion('Is it real')], [true, false, true]);
  assert.deepEqual(kd.emptyRecord('ABC'), { keyword: 'abc', found: false, searchVolume: null, cpc: null, paidCompetition: null, competitionLevel: null, keywordDifficulty: null, intent: null, monthly: [], avgReferringDomains: null });
  assert.equal(kd.trendPct([{ searchVolume: 1 }, { searchVolume: 1 }, { searchVolume: 1 }, { searchVolume: 2 }, { searchVolume: 2 }, { searchVolume: 2 }]), 100);
});

test('Serper autocomplete: suggestions read as { value } or plain strings, lower-cased and de-duplicated; one credit; an empty or odd answer is an empty list', async () => {
  let seen; const mk = (body) => serperLib.createClient({ apiKey: 'K', fetchImpl: async (u, o) => { seen = { u, body: JSON.parse(o.body), key: o.headers['X-API-KEY'] }; return { ok: true, status: 200, json: async () => body }; } });
  const r = await mk({ suggestions: [{ value: 'ChatGPT login' }, { value: 'chatgpt plus' }, 'chatgpt plus', { value: ' ' }, null] }).autocomplete({ keyword: 'chatgpt', country: 'GB', language: 'en' });
  assert.deepEqual([seen.u, seen.body, seen.key], ['https://google.serper.dev/autocomplete', { q: 'chatgpt', gl: 'gb', hl: 'en' }, 'K']); assert.deepEqual([r.suggestions, r.cost, r.units], [['chatgpt login', 'chatgpt plus'], null, 1]);
  assert.deepEqual((await mk({}).autocomplete({ keyword: 'x' })).suggestions, []); assert.deepEqual((await mk({ suggestions: 'nope' }).autocomplete({ keyword: 'x' })).suggestions, []);
});

test('SERP competition: facts of the top 10 -> a 0-100 estimate with every factor visible; forums and small sites lower it; no results = no score', () => {
  const mk = (domains, extra = {}) => domains.map((d, i) => ({ rank: i + 1, domain: d, title: d, url: `https://${d}/`, ...extra }));
  assert.equal(kindOf('www.reddit.com', new Set()), 'forum'); assert.equal(kindOf('support.apple.com', new Set()), 'official'); assert.equal(kindOf('openai.com', new Set()), 'official');
  assert.equal(kindOf('theverge.com', new Set()), 'big'); assert.equal(kindOf('smallblog.dev', new Set()), 'independent'); assert.equal(kindOf('smallblog.dev', new Set(['smallblog'])), 'official', 'the site named in the query is its own official source');
  assert.equal(kindOf('forums.macrumors.com', new Set()), 'forum'); assert.equal(kindOf('cisa.gov', new Set()), 'official'); assert.equal(kindOf('www.energy.gov', new Set()), 'official');
  const hard = scoreSerp(mk(['openai.com', 'theverge.com', 'techcrunch.com', 'wikipedia.org', 'forbes.com', 'cnet.com', 'zdnet.com', 'apple.com', 'wired.com', 'youtube.com']), { keyword: 'chatgpt pricing' });
  const easy = scoreSerp(mk(['smallblog.dev', 'niche-tech.net', 'reddit.com', 'quora.com', 'mysite.io', 'techie.org', 'a.blog', 'b.blog', 'c.blog', 'd.blog']), { keyword: 'obscure app thing' });
  assert.ok(hard.competition >= 75, `hard SERP scored ${hard.competition}`); assert.ok(easy.competition <= 20, `easy SERP scored ${easy.competition}`); assert.equal(hard.label, 'Çok yüksek'); assert.equal(easy.label, 'Düşük');
  assert.ok(easy.reducers.some((r) => r.key === 'forum') && easy.reducers.some((r) => r.key === 'independent'));
  assert.deepEqual(hard.factors.map((f) => f.key), ['big', 'official', 'top3'], 'no freshness / authority factor without that data'); assert.ok(hard.factors.every((f) => f.weight > 0 && f.note));
  const withAuth = scoreSerp(mk(['smallblog.dev', 'niche-tech.net', 'mysite.io', 'techie.org', 'a.blog']), { keyword: 'x y', avgReferringDomains: 2500 });
  assert.ok(withAuth.factors.some((f) => f.key === 'authority' && f.value === 100), 'authority factor appears only when the provider returned it');
  const fresh = scoreSerp(mk(['a.com', 'b.com', 'c.com', 'd.com'], { timestamp: '2026-11-20 10:00:00 +00:00' }), { keyword: 'x y', now: new Date('2026-11-21T00:00:00Z') });
  assert.equal(fresh.factors.find((f) => f.key === 'fresh').value, 100);
  const none = scoreSerp([], { keyword: 'x y' }); assert.deepEqual([none.competition, none.label], [null, 'Organik sonuç bulunamadı']);
  assert.equal(scoreSerp(mk(['a.com', 'b.com']), { keyword: 'x' }).small, true, 'fewer than 5 results are flagged');
});

test('opportunity score: the five parts, the weights, demand on a log scale, a TOTAL only when every part rests on real data', () => {
  assert.deepEqual([0, 9, 99, 999, 9999, 99999, 1e6].map(O.demandScore).map((x) => Math.round(x / 10) * 10), [0, 20, 40, 60, 80, 100, 100]);
  assert.equal(O.demandScore(null), null); assert.equal(O.keywordTrendScore(-30), 0); assert.equal(O.keywordTrendScore(100), 50); assert.equal(O.keywordTrendScore(400), 100); assert.equal(O.keywordTrendScore(null), null);
  const now = new Date('2026-11-21T12:00:00Z'); const W = { trend: 30, competition: 25, demand: 20, relevance: 15, source: 10 };
  const cluster = { sourceCount: 5, recent12: 5, lastSeenAt: new Date('2026-11-21T11:00:00Z'), relevance: 80, reliability: 90 };
  const full = O.components({ cluster, metrics: { found: true, searchVolume: 9999, trendPct: null }, serp: { competition: 20 }, now });
  assert.deepEqual([full.trend.score, full.competition.score, full.demand.score, full.relevance.score, full.source.score], [100, 80, 80, 80, 95]);
  const t = O.combine(full, W); assert.equal(t.total, Math.round((100 * 30 + 80 * 25 + 80 * 20 + 80 * 15 + 95 * 10) / 100)); assert.deepEqual(t.missing, []);
  const noSerp = O.components({ cluster, metrics: { found: true, searchVolume: 9999 }, serp: null, now }); const c2 = O.combine(noSerp, W);
  assert.deepEqual([c2.total, c2.missing], [null, ['competition']]); assert.ok(c2.provisional > 0, 'a provisional score exists, but it is not a score');
  const noData = O.components({ cluster, metrics: { found: false }, serp: null, now }); assert.deepEqual(O.combine(noData, W).missing, ['competition', 'demand']);
  const brandNew = O.components({ cluster: { ...cluster, sourceCount: 1, recent12: 1 }, metrics: { found: true, searchVolume: 5, trendPct: 300 }, serp: { competition: 10 }, now });
  assert.equal(brandNew.trend.score, 100, 'a rising search trend lifts a story the news count alone would rate low'); assert.match(brandNew.trend.note, /Arama trendi/);
  assert.equal(O.combine(full, { trend: 0, competition: 100, demand: 0, relevance: 0, source: 0 }).total, 80, 'weights are the owner\'s to change');
});

test('trend score from news counts only; keyword candidates are plausible queries built from the headline', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const hot = trends.trendScore({ sourceCount: 5, recent12: 6, lastSeenAt: new Date('2026-11-21T11:00:00Z') }, now); assert.deepEqual([hot.score, hot.label], [100, 'Yükseliyor']);
  const one = trends.trendScore({ sourceCount: 1, recent12: 1, lastSeenAt: new Date('2026-11-21T11:00:00Z') }, now); assert.deepEqual([one.score, one.label], [32, 'İlgi var']);
  const old = trends.trendScore({ sourceCount: 1, recent12: 0, lastSeenAt: new Date('2026-11-18T12:00:00Z') }, now); assert.deepEqual([old.score, old.label], [0, 'Zayıf']);
  const cases = [
    ['Staples Canada says customer information accessed in data breach', ['data breach'], ['staples canada', 'staples canada data breach']],
    ['WhatsApp Patches 3 Security Flaws, Including Android Bug Suspected of Spyware Use', ['security flaw', 'android'], ['whatsapp', 'whatsapp security flaw']],
    ['Windows 11 KB5132057 update released with 28 changes and fixes', ['windows 11', 'windows'], ['windows 11', 'windows 11 update', 'kb5132057']],
    ['Google rolls out Gemini 3 update to Chrome users with new features', ['gemini', 'chrome', 'rolls out'], ['gemini 3', 'chrome']],
    ['Black Friday deals: AirPods Max 2 $130 off, AirPods Pro 3', [], ['airpods max 2']],
    ['ChatGPT Plus price increase hits subscribers in the US', ['chatgpt', 'price increase'], ['chatgpt plus', 'chatgpt plus pricing', 'chatgpt plus price increase']],
  ];
  for (const [title, matched, must] of cases) { const c = K.candidatesFor(title, { matched }); for (const m of must) assert.ok(c.includes(m), `${title} -> ${c.join(' | ')} lacks "${m}"`); assert.ok(c.length <= 5 && c.every((x) => x === x.toLowerCase())); assert.ok(!c.some((x) => /^(\S+) \1$/.test(x)), 'no doubled names'); }
  for (const t of ['Everything Is a Web Application, Including Your Firewall', 'How to stream the big game this weekend', 'Vendor data breach exposes customer info']) assert.ok(!K.candidatesFor(t, { matched: ['data breach'] }).some((x) => /^(everything|how|vendor|stream)\b/.test(x)), `${t} must not produce a made-up name`);
  assert.deepEqual(K.candidatesFor('Everything Is a Web Application, Including Your Firewall'), [], 'no name, no candidate: nothing is guessed');
  assert.equal(K.normalize('  “ChatGPT”   Plus!!  '), 'chatgpt plus'); assert.equal(K.normalize('x'.repeat(81)), null); assert.equal(K.normalize('a b c d e f g h i j k'), null); assert.equal(K.normalize('   '), null);
});
