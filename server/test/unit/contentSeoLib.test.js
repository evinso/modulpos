const test = require('node:test');
const assert = require('node:assert/strict');
const dfs = require('../../src/content/services/dataforseo');
const { scoreSerp, kindOf } = require('../../src/content/services/serp');
const O = require('../../src/content/services/opportunities');
const trends = require('../../src/content/services/trends');
const K = require('../../src/content/services/keywords');

/** DataForSEO answers as documented: the envelope (status_code 20000, tasks[]) around result[0].items. Built by hand from the documentation; NOT captured from a real account. */
const envelope = (result, { cost = 0.0201, taskCode = 20000, topCode = 20000, msg = 'Ok.' } = {}) => ({ version: '0.1.20250101', status_code: topCode, status_message: msg, time: '0.2 sec.', cost, tasks_count: 1, tasks_error: taskCode === 20000 ? 0 : 1,
  tasks: [{ id: 'abc', status_code: taskCode, status_message: msg, time: '0.19 sec.', cost, result_count: result ? 1 : 0, path: ['v3'], data: {}, result: result ? [result] : null }] });
const reply = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const kwItem = (keyword, volume, extra = {}) => ({ keyword, keyword_info: { search_volume: volume, cpc: 1.25, competition: 0.42, competition_level: 'MEDIUM', monthly_searches: extra.monthly || [], low_top_of_page_bid: 0.5 },
  keyword_properties: { keyword_difficulty: extra.kd ?? 38 }, search_intent_info: { main_intent: extra.intent || 'informational' }, avg_backlinks_info: extra.refs === undefined ? undefined : { referring_domains: extra.refs } });
const months = (vals) => vals.map((v, i) => ({ year: 2026 - (i < 1 ? 1 : 0), month: ((i + 11) % 12) + 1, search_volume: v }));
const norm = (arr) => arr.map((m) => ({ year: m.year, month: m.month, searchVolume: m.search_volume }));

test('DataForSEO client: request shape, Basic auth, records read from the documented fields, trend from monthly history', async () => {
  let seen;
  const f = async (url, o) => { seen = { url, o, body: JSON.parse(o.body) }; return { ok: true, status: 200, json: async () => envelope({ se_type: 'google', location_code: 2840, language_code: 'en', items_count: 2, items: [kwItem('chatgpt pricing', 33100, { monthly: months([100, 100, 100, 100, 100, 100, 100, 100, 100, 200, 300, 400]), refs: 120 }), { keyword: 'no data kw', keyword_info: { search_volume: null, monthly_searches: [] } }] }) }; };
  const c = dfs.createClient({ login: 'me@example.com', password: 'secret', fetchImpl: f });
  const r = await c.keywordOverview({ keywords: ['chatgpt pricing', 'no data kw'], country: 'GB' });
  assert.equal(seen.url, 'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live');
  assert.equal(seen.o.headers.Authorization, `Basic ${Buffer.from('me@example.com:secret').toString('base64')}`);
  assert.deepEqual(seen.body, [{ keywords: ['chatgpt pricing', 'no data kw'], location_code: 2826, language_code: 'en', include_serp_info: false }], 'a JSON array with ONE task; GB = 2826');
  assert.equal(r.cost, 0.0201);
  const a = r.records[0]; assert.deepEqual([a.keyword, a.found, a.searchVolume, a.cpc, a.paidCompetition, a.keywordDifficulty, a.intent, a.avgReferringDomains], ['chatgpt pricing', true, 33100, 1.25, 0.42, 38, 'informational', 120]);
  assert.equal(dfs.trendPct(a.monthly), 200, 'last 3 months 900 vs the 3 before 300 = +200%');
  assert.equal(r.records[1].found, false, 'a keyword with no volume and no history has NO data (null, not 0)'); assert.equal(r.records[1].searchVolume, null);
  assert.equal(dfs.trendPct(norm(months([1, 2, 3]))), null, 'too little history'); assert.equal(dfs.trendPct(norm(months([5, 5, 5, 5, 5, 5, 0, 0, 0, 1, 1, 1]))), null, 'earlier period had no searches'); assert.equal(dfs.trendPct(norm(months([5, 5, 5, 5, 5, 5, 4, 4, 4, 2, 2, 2]))), -50);
  await assert.rejects(c.keywordOverview({ keywords: Array.from({ length: 701 }, (_, i) => `k${i}`) }), /en fazla 700/);
  assert.deepEqual(await c.keywordOverview({ keywords: [] }), { records: [], cost: 0 });
  assert.throws(() => dfs.createClient({ login: '', password: 'x' }), /login ve API şifresi/);
});

test('DataForSEO client: errors are read from the answer AND from each task; "no results" is empty; the secret never appears in a message', async () => {
  const mk = (resp, status) => dfs.createClient({ login: 'l', password: 'TOPSECRET', fetchImpl: reply(resp, status) });
  const code = async (p) => { try { await p; } catch (e) { return [e.code, e.message, e.retryable]; } return ['none']; };
  assert.equal((await code(mk({}, 401).keywordOverview({ keywords: ['a b'] })))[0], 'auth');
  // seen on a REAL, not yet verified account: HTTP 403 with the reason in the JSON body (status_code 40104)
  const unverified = await code(mk({ version: '0.1', status_code: 40104, status_message: 'Please verify your account before using the API.', cost: 0, tasks_count: 0, tasks: null }, 403).keywordOverview({ keywords: ['a b'] }));
  assert.equal(unverified[0], 'verify'); assert.match(unverified[1], /henüz doğrulanmamış.*app\.dataforseo\.com/);
  assert.equal((await code(mk({}, 402).keywordOverview({ keywords: ['a b'] })))[0], 'funds');
  assert.equal((await code(mk({}, 500).keywordOverview({ keywords: ['a b'] })))[0], 'http');
  const topErr = await code(mk(envelope(null, { topCode: 40100, taskCode: 40100, msg: 'Authentication failed' })).keywordOverview({ keywords: ['a b'] })); assert.equal(topErr[0], 'auth'); assert.match(topErr[1], /kod 40100/);
  const taskErr = await code(mk(envelope(null, { taskCode: 40210, msg: 'insufficient funds' })).keywordOverview({ keywords: ['a b'] })); assert.equal(taskErr[0], 'funds', 'the HTTP and the top-level code were fine, the TASK failed');
  const rl = await code(mk(envelope(null, { taskCode: 40202 })).keywordOverview({ keywords: ['a b'] })); assert.deepEqual([rl[0], rl[2]], ['rate_limit', true]);
  const empty = await mk(envelope(null, { taskCode: 40102, cost: 0 })).serpOrganic({ keyword: 'zzzz qqqq' }); assert.deepEqual([empty.organic.length, empty.empty, empty.cost], [0, true, 0]);
  assert.equal((await code(mk(null).keywordOverview({ keywords: ['a b'] })))[0], 'bad_answer');
  const net = await code(dfs.createClient({ login: 'l', password: 'TOPSECRET', fetchImpl: async () => { const e = new Error('connect failed TOPSECRET'); throw e; } }).keywordOverview({ keywords: ['a b'] }));
  assert.equal(net[0], 'network'); assert.ok(!net[1].includes('TOPSECRET'));
  const to = await code(dfs.createClient({ login: 'l', password: 'x', fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } }).keywordOverview({ keywords: ['a b'] })); assert.equal(to[0], 'timeout');
});

test('DataForSEO client: suggestions (flat items), related keywords (nested keyword_data), SERP (organic, people also ask, related searches, features), balance', async () => {
  const sug = envelope({ seed_keyword: 'chatgpt', total_count: 2, items_count: 2, items: [kwItem('how to use chatgpt', 5400), kwItem('chatgpt plus price', 880)] }, { cost: 0.0101 });
  const s = await dfs.createClient({ login: 'l', password: 'p', fetchImpl: reply(sug) }).keywordSuggestions({ keyword: 'chatgpt', limit: 50 });
  assert.deepEqual(s.records.map((x) => [x.keyword, x.searchVolume]), [['how to use chatgpt', 5400], ['chatgpt plus price', 880]]); assert.equal(s.total, 2); assert.equal(s.cost, 0.0101);
  const rel = envelope({ items_count: 1, items: [{ depth: 1, keyword_data: kwItem('chat gpt login', 1900), related_keywords: ['x'] }] });
  assert.deepEqual((await dfs.createClient({ login: 'l', password: 'p', fetchImpl: reply(rel) }).relatedKeywords({ keyword: 'chatgpt' })).records.map((x) => x.keyword), ['chat gpt login']);
  const serp = envelope({ keyword: 'chatgpt pricing', se_results_count: 85600000, item_types: ['organic', 'people_also_ask', 'related_searches', 'featured_snippet'], items: [
    { type: 'organic', rank_group: 1, rank_absolute: 1, domain: 'openai.com', title: 'Pricing | OpenAI', url: 'https://openai.com/pricing', description: 'Plans', timestamp: '2026-11-01 10:00:00 +00:00' },
    { type: 'organic', rank_group: 2, domain: 'www.theverge.com', title: 'ChatGPT Plus costs…', url: 'https://www.theverge.com/x' },
    { type: 'people_also_ask', items: [{ type: 'people_also_ask_element', title: 'Is ChatGPT free?' }, { title: 'How much is ChatGPT Plus?' }] },
    { type: 'related_searches', items: ['chatgpt plus price', { title: 'chatgpt pro' }] }, { type: 'featured_snippet', title: 'x' }] }, { cost: 0.003 });
  const sr = await dfs.createClient({ login: 'l', password: 'p', fetchImpl: reply(serp) }).serpOrganic({ keyword: 'chatgpt pricing' });
  assert.deepEqual(sr.organic.map((o) => [o.rank, o.domain]), [[1, 'openai.com'], [2, 'www.theverge.com']]);
  const evil = envelope({ items: [{ type: 'organic', rank_group: 1, domain: 'x.test', title: 'x', url: 'javascript:alert(1)' }, { type: 'organic', rank_group: 2, domain: 'y.test', title: 'y', url: 'https://y.test/a' }] });
  assert.deepEqual((await dfs.createClient({ login: 'l', password: 'p', fetchImpl: reply(evil) }).serpOrganic({ keyword: 'a b' })).organic.map((o) => o.url), ['', 'https://y.test/a'], 'a javascript: address from the provider never becomes a link'); assert.deepEqual(sr.questions, ['Is ChatGPT free?', 'How much is ChatGPT Plus?']);
  assert.deepEqual(sr.related, ['chatgpt plus price', 'chatgpt pro']); assert.deepEqual(sr.features, ['people_also_ask', 'related_searches', 'featured_snippet']); assert.equal(sr.resultsCount, 85600000); assert.equal(sr.cost, 0.003);
  const u = await dfs.createClient({ login: 'l', password: 'p', fetchImpl: reply(envelope({ login: 'l', money: { total: 10, balance: 7.5 } }, { cost: 0 })) }).userData(); assert.equal(u.balance, 7.5);
  assert.deepEqual(dfs.LOCATIONS, { US: 2840, GB: 2826, CA: 2124, AU: 2036 });
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
