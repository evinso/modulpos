const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const runs = require('../../src/content/services/runs');
const { FetchError } = require('../../src/content/lib/safeFetch');

const opts = { skip: H.skip };
const FX = path.join(__dirname, '../fixtures/content');
const fx = (n) => fs.readFileSync(path.join(FX, n), 'utf8');
const NOW = new Date('2026-11-21T12:00:00Z');
const U = { tc: 'https://techcrunch.com/feed/', chrome: 'https://chromereleases.googleblog.com/feeds/posts/default', cisa: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', gn: 'https://news.google.com/rss/search?q=ai', bleep: 'https://www.bleepingcomputer.com/feed/', gdelt: 'https://api.gdeltproject.org/api/v2/doc/doc?query=x', down: 'https://down.example/feed' };
const FILES = { [U.tc]: 'techcrunch.rss.xml', [U.chrome]: 'chrome-releases.atom.xml', [U.cisa]: 'cisa-advisories.rss.xml', [U.gn]: 'google-news.rss.xml', [U.bleep]: 'bleepingcomputer.rss.xml', [U.gdelt]: 'gdelt-artlist.json' };

/** the network: serves the real fixtures, can fail, remembers what it was asked */
function net(extra = {}) {
  const calls = []; const state = { fail: new Set(), limited: new Set(), etags: {} };
  const fetchImpl = async (url, o = {}) => {
    calls.push({ url, etag: o.etag });
    if (state.fail.has(url)) throw new FetchError('http', 'Kaynak HTTP 500 döndürdü', { status: 500 });
    if (state.limited.has(url)) throw new FetchError('rate_limited', 'Kaynak istek sınırı koydu (HTTP 429)', { retryAfterSec: 600 });
    if (extra[url]) return { status: 200, body: extra[url], url };
    if (url.startsWith('https://api.gdeltproject.org/')) return { status: 200, body: fx('gdelt-artlist.json'), url };
    if (!FILES[url]) throw new FetchError('http', 'Kaynak HTTP 404 döndürdü', { status: 404 });
    if (o.etag && state.etags[url] === o.etag) return { status: 304, body: '', notModified: true, etag: o.etag };
    return { status: 200, body: fx(FILES[url]), url, etag: state.etags[url] || null };
  };
  return { fetchImpl, calls, state, extra };
}
const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d || 'Fri, 21 Nov 2026 10:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

async function site() { const { projectId } = await P.seedDefault(); return projectId; }
const src = (projectId, name, kind, url, extra = {}) => N.createSource(projectId, { name, kind, ...(kind === 'rss' ? { url } : { query: 'q' }), reliability: 70, ...extra });
const run = (projectId, deps) => N.runDiscovery(projectId, { now: NOW, gapMs: 0, ...deps });
const count = async (sql, p = []) => (await H.db().query(sql, p)).rows[0].n;

test('sources: validation, uniqueness, SSRF-safe addresses, kinds build their own address', opts, async () => {
  const pid = await site();
  const a = await N.createSource(pid, { name: 'TechCrunch', kind: 'rss', url: U.tc, sourceType: 'publisher', reliability: 75 });
  assert.equal(a.kind, 'rss'); assert.equal(a.enabled, true); assert.match(a.termsNote, /tam metni alınmaz/);
  await assert.rejects(N.createSource(pid, { name: 'dup', kind: 'rss', url: U.tc }), (e) => e.status === 409);
  for (const bad of ['http://127.0.0.1/feed', 'http://169.254.169.254/', 'ftp://x.com/a', 'http://user:p@x.com/', 'http://x.com:22/']) await assert.rejects(N.createSource(pid, { name: 'bad', kind: 'rss', url: bad }), (e) => e.status === 400, bad);
  const g = await N.createSource(pid, { name: 'GN', kind: 'google_news', query: '"data breach" when:1d' });
  assert.match(g.url, /^https:\/\/news\.google\.com\/rss\/search\?q=%22data%20breach%22/); assert.equal(g.sourceType, 'user');
  await assert.rejects(N.createSource(pid, { name: 'no query', kind: 'google_news' }), /sorgusu zorunlu/);
  await assert.rejects(N.createSource(pid, { name: 'x', kind: 'rss', url: 'https://ok.example/f', reliability: 120 }), /0 ile 100/);
  const u = await N.updateSource(a.id, { reliability: 80, enabled: false, name: 'TC' });
  assert.deepEqual([u.reliability, u.enabled, u.name], [80, false, 'TC']);
  await assert.rejects(N.updateSource(a.id, { kind: 'gdelt' }), /değiştirilemez/);
  await assert.rejects(N.updateSource(a.id, { url: 'http://10.0.0.1/x' }), (e) => e.status === 400);
  await N.deleteSource(g.id); await assert.rejects(N.deleteSource(g.id), /bulunamadı/);
});

test('default sources: seeded once per project (deleted ones do not come back); every default address is a public https address', opts, async () => {
  const pid = await site();
  const n = await N.seedDefaultSources(pid);
  assert.equal(n, N.DEFAULT_SOURCES.length); assert.equal(await N.seedDefaultSources(pid), 0, 'a second call adds nothing');
  const list = await N.listSources(pid);
  assert.ok(list.some((x) => x.sourceType === 'official' && x.reliability >= 90) && list.some((x) => x.kind === 'google_news') && list.some((x) => x.kind === 'gdelt' && !x.enabled), 'official, Google News and a disabled GDELT');
  assert.ok(list.every((x) => /^https:\/\//.test(x.url)));
  await N.deleteSource(list[0].id); await N.seedDefaultSources(pid);
  assert.equal((await N.listSources(pid)).length, n - 1);
});

test('a discovery run over REAL feeds: headlines stored with sources and dates, filtered by niche, clustered; the second run adds nothing', opts, async () => {
  const pid = await site();
  const sources = [await src(pid, 'TechCrunch', 'rss', U.tc, { reliability: 75 }), await src(pid, 'Google Chrome Releases', 'rss', U.chrome, { reliability: 90, sourceType: 'official' }),
    await src(pid, 'CISA Advisories', 'rss', U.cisa, { reliability: 95, sourceType: 'official' }), await src(pid, 'BleepingComputer', 'rss', U.bleep, { reliability: 75 })];
  await H.db().query('UPDATE news_sources SET url = $1 WHERE id = $2', [U.chrome, sources[1].id]);
  const n = net();
  const r1 = await run(pid, { fetchImpl: n.fetchImpl });
  assert.equal(r1.status, 'ok', JSON.stringify(r1));
  assert.equal(r1.stats.sources, 4); assert.equal(r1.stats.ok, 4); assert.equal(r1.stats.errors, 0);
  assert.equal(r1.stats.newItems, 22, 'every real headline of the 4 fixtures is new, except the Siemens bulletin of 17 Nov that is older than 72 hours'); assert.equal(r1.stats.tooOld, 1); assert.equal(r1.stats.newItems, r1.stats.relevant + r1.stats.irrelevant + r1.stats.excluded);
  assert.ok(r1.stats.relevant >= 8 && r1.stats.irrelevant >= 5, `relevant ${r1.stats.relevant}, irrelevant ${r1.stats.irrelevant}`);
  const items = (await N.listItems(pid, { pageSize: 100 })).items;
  assert.equal(items.length, 22);
  const breach = items.find((i) => /Vendor data breach/.test(i.title));
  assert.equal(breach.status, 'relevant'); assert.match(breach.reason, /Digital Privacy & Security/); assert.equal(breach.categoryName, 'Digital Privacy & Security'); assert.equal(breach.sourceName, 'BleepingComputer'); assert.ok(breach.publishedAt);
  assert.ok(breach.summary.length > 0 && breach.summary.length <= 401, 'a short summary only'); assert.ok(breach.keywords.length > 0 && breach.matchedTerms.includes('data breach'));
  const noise = items.find((i) => /Chips can survive the space environment/.test(i.title)); assert.equal(noise.status, 'irrelevant');
  const cisa = items.filter((i) => i.sourceName === 'CISA Advisories').filter((i) => /Known Exploited/.test(i.title));
  assert.equal(cisa.length, 2); assert.notEqual(cisa[0].clusterId, cisa[1].clusterId, 'two posts of one source with the same template headline are two events');
  const chrome = items.filter((i) => i.sourceName === 'Google Chrome Releases'); assert.equal(new Set(chrome.map((c) => c.clusterId)).size, chrome.length, 'Chrome update posts are separate events');
  const rows = await N.listSources(pid); assert.ok(rows.every((s) => s.lastStatus === 'ok' && s.failCount === 0 && s.lastItemCount > 0 && s.lastFetchedAt));
  assert.equal(await count('SELECT count(*)::int n FROM news_items WHERE title = $1', ['x']), 0);
  assert.equal(await count("SELECT count(*)::int n FROM automation_runs WHERE bot_key = 'news_discovery' AND status = 'ok'"), 1);
  // the same feeds again: nothing new, nothing doubled
  const r2 = await run(pid, { fetchImpl: n.fetchImpl });
  assert.deepEqual([r2.stats.newItems, r2.stats.duplicates], [0, 22]); assert.equal(await count('SELECT count(*)::int n FROM news_items'), 22);
});

test('events: the same story from different sources is ONE cluster whose source count is the trend signal; other stories stay apart', opts, async () => {
  const pid = await site();
  await src(pid, 'Outlet A', 'rss', 'https://a.example/feed'); await src(pid, 'Outlet B', 'rss', 'https://b.example/feed'); await src(pid, 'Outlet C', 'rss', 'https://c.example/feed');
  const feeds = {
    'https://a.example/feed': rssOf([['OpenAI unveils new reasoning model for ChatGPT subscribers', 'https://a.example/1'], ['Apple releases iOS 26.2 with new features', 'https://a.example/2']]),
    'https://b.example/feed': rssOf([['ChatGPT gets a new reasoning model, OpenAI says', 'https://b.example/1', 'Fri, 21 Nov 2026 10:30:00 GMT'], ['Apple releases iOS 26.1 security update', 'https://b.example/2']]),
    'https://c.example/feed': rssOf([['OpenAI’s new reasoning model arrives in ChatGPT for paying subscribers', 'https://c.example/1', 'Fri, 21 Nov 2026 11:00:00 GMT']]),
  };
  const r = await run(pid, { fetchImpl: net(feeds).fetchImpl });
  assert.equal(r.stats.newItems, 5); assert.equal(r.stats.newClusters, 3, 'OpenAI story (3 sources) + two different iOS versions');
  const cl = (await N.listClusters(pid, { pageSize: 50 })).items;
  const openai = cl.find((c) => /reasoning model/i.test(c.title));
  assert.deepEqual([openai.itemCount, openai.sourceCount, openai.status], [3, 3, 'relevant']);
  assert.equal(cl.filter((c) => /iOS/.test(c.title)).length, 2, 'iOS 26.2 and 26.1 are different events');
  assert.equal((await N.getCluster(openai.id)).items.length, 3);
  assert.equal((await N.listClusters(pid, { multiSource: '1' })).items.length, 1);
  // a later pass adds a fourth report to the same event and keeps the cluster
  const feeds2 = { ...feeds, 'https://a.example/feed': rssOf([['OpenAI unveils new reasoning model for ChatGPT subscribers', 'https://a.example/1'], ['Hands-on: the new reasoning model OpenAI added to ChatGPT subscribers', 'https://a.example/9', 'Fri, 21 Nov 2026 11:30:00 GMT']]) };
  const r2 = await run(pid, { fetchImpl: net(feeds2).fetchImpl, now: new Date('2026-11-21T13:00:00Z') });
  assert.equal(r2.stats.newItems, 1); assert.equal(r2.stats.joined, 1);
  const again = await N.getCluster(openai.id); assert.deepEqual([again.itemCount, again.sourceCount], [4, 3], 'one more item, still 3 outlets');
});

test('the niche filter in a run: excluded topics are kept for the record, never candidates; a person overrides and the filter respects it', opts, async () => {
  const pid = await site();
  await src(pid, 'Mixed', 'rss', 'https://m.example/feed');
  const feeds = { 'https://m.example/feed': rssOf([['Football match tonight: who plays and where to stream', 'https://m.example/1'], ['Celebrity gossip: the star who joined the new ChatGPT ad', 'https://m.example/2'], ['Google rolls out Gemini update to Android phones', 'https://m.example/3'],
    ['Local bakery wins regional award', 'https://m.example/4'], ['Hackers leak customer data in major data breach', 'https://m.example/5']]) };
  const r = await run(pid, { fetchImpl: net(feeds).fetchImpl });
  assert.deepEqual([r.stats.relevant, r.stats.excluded, r.stats.irrelevant], [2, 2, 1]);
  const by = Object.fromEntries((await N.listClusters(pid, { pageSize: 50 })).items.map((c) => [c.title.split(':')[0].slice(0, 12), c]));
  assert.equal(by['Football mat'].status, 'excluded'); assert.match(by['Football mat'].reason, /football match/);
  const bakery = by['Local bakery']; assert.equal(bakery.status, 'irrelevant');
  const forced = await N.setClusterStatus(bakery.id, 'relevant'); assert.deepEqual([forced.status, forced.manualOverride], ['relevant', true]);
  await run(pid, { fetchImpl: net({ 'https://m.example/feed': rssOf([['Local bakery wins regional award', 'https://m.example/4'], ['Local bakery award: how the winner was chosen', 'https://m.example/44']]) }).fetchImpl });
  assert.equal((await N.getCluster(bakery.id)).status, 'relevant', 'a refresh does not undo the person\'s decision');
  await assert.rejects(N.setClusterStatus(bakery.id, 'excluded'), /şunlardan biri/);
  const cats = await P.listCategories(pid);
  assert.equal((await N.setClusterStatus(bakery.id, 'irrelevant', { categoryId: cats[1].id })).categoryName, 'Apps & Software Updates');
  await assert.rejects(N.setClusterStatus('00000000-0000-0000-0000-000000000001', 'relevant'), /bulunamadı/);
  const f = await N.listItems(pid, { status: 'excluded' }); assert.equal(f.total, 2);
  assert.equal((await N.listItems(pid, { q: '100%' })).total, 0); assert.equal((await N.listItems(pid, { q: 'gemini' })).total, 1);
});

test('limits: the daily "news_items" limit stops a run part-way, never beyond; items too old are skipped', opts, async () => {
  const pid = await site();
  await src(pid, 'A', 'rss', 'https://a.example/feed'); await src(pid, 'B', 'rss', 'https://b.example/feed');
  const mk = (p, n, start = 0) => rssOf(Array.from({ length: n }, (_, i) => [`Gemini feature number ${start + i} lands on Android`, `https://${p}.example/${start + i}`, 'Fri, 21 Nov 2026 10:00:00 GMT']));
  const old = rssOf([['Gemini ancient story', 'https://a.example/old', 'Mon, 10 Nov 2026 10:00:00 GMT']]);
  await L.setGlobalLimits({ news_items: 12 });
  const r = await run(pid, { fetchImpl: net({ 'https://a.example/feed': mk('a', 8) + old.slice(0, 0), 'https://b.example/feed': mk('b', 8) }).fetchImpl });
  assert.equal(r.status, 'partial'); assert.equal(r.stats.newItems, 12); assert.equal(r.stats.limited, 4);
  assert.equal(await count('SELECT count(*)::int n FROM news_items'), 12); assert.ok(r.stats.messages.some((m) => /günlük haber limiti/.test(m)));
  assert.equal((await L.status({ now: NOW })).items.find((i) => i.workType === 'news_items').done, 12);
  const r2 = await run(pid, { fetchImpl: net({ 'https://a.example/feed': mk('a', 8, 100), 'https://b.example/feed': mk('b', 8, 100) }).fetchImpl });
  assert.equal(r2.stats.newItems, 0); assert.ok(r2.stats.messages[0].includes('günlük limit doldu'));
  await L.setGlobalLimits({ news_items: 200 }); await S.set('news', { maxAgeHours: 24 }, { scope: 'project', projectId: pid });
  const r3 = await run(pid, { fetchImpl: net({ 'https://a.example/feed': old, 'https://b.example/feed': rssOf([]) }).fetchImpl });
  assert.deepEqual([r3.stats.newItems, r3.stats.tooOld], [0, 1], 'older than the project\'s "maxAgeHours"');
  await S.set('news', { maxItemsPerSource: 5 }, { scope: 'project', projectId: pid });
  const r4 = await run(pid, { fetchImpl: net({ 'https://a.example/feed': mk('a', 20, 200), 'https://b.example/feed': rssOf([]) }).fetchImpl });
  assert.equal(r4.stats.newItems, 5, 'at most maxItemsPerSource per source and pass');
});

test('failing sources: error text, back-off, rate limits with Retry-After, conditional requests; other sources still work', opts, async () => {
  const pid = await site();
  const ok = await src(pid, 'Good', 'rss', U.tc); const bad = await src(pid, 'Down', 'rss', U.down); const lim = await src(pid, 'Limited', 'rss', U.bleep);
  const n = net(); n.state.fail.add(U.down); n.state.limited.add(U.bleep);
  const r = await run(pid, { fetchImpl: n.fetchImpl });
  assert.equal(r.status, 'partial'); assert.deepEqual([r.stats.ok, r.stats.errors, r.stats.rateLimited], [1, 1, 1]);
  const rows = Object.fromEntries((await N.listSources(pid)).map((s) => [s.name, s]));
  assert.deepEqual([rows.Down.lastStatus, rows.Down.failCount], ['error', 1]); assert.match(rows.Down.lastError, /HTTP 500/); assert.ok(new Date(rows.Down.nextFetchAfter) > NOW);
  assert.equal(rows.Limited.lastStatus, 'rate_limited'); assert.ok(Math.abs(new Date(rows.Limited.nextFetchAfter) - NOW - 600000) < 5000, 'Retry-After of 600 s is respected');
  assert.equal(rows.Good.lastStatus, 'ok');
  n.calls.length = 0;
  const r2 = await run(pid, { fetchImpl: n.fetchImpl });
  assert.equal(r2.stats.skipped, 2); assert.deepEqual(n.calls.map((c) => c.url), [U.tc], 'sources in back-off are not asked again');
  n.state.fail.clear(); n.state.limited.clear(); n.calls.length = 0;
  n.extra[U.down] = rssOf([['Gemini feature lands on Android', 'https://down.example/1']]);
  const r3 = await run(pid, { fetchImpl: n.fetchImpl, force: true });
  assert.equal(r3.stats.skipped, 0); assert.equal(r3.status, 'ok'); const after = Object.fromEntries((await N.listSources(pid)).map((s) => [s.name, s]));
  assert.deepEqual([after.Down.failCount, after.Down.lastStatus, after.Down.nextFetchAfter], [0, 'ok', null], 'a good read clears the back-off');
  // conditional requests: the feed says "not modified"
  n.state.etags[U.tc] = '"abc"'; await run(pid, { fetchImpl: n.fetchImpl, force: true }); n.calls.length = 0;
  const r4 = await run(pid, { fetchImpl: n.fetchImpl, force: true, sourceIds: [ok.id] });
  assert.equal(n.calls[0].etag, '"abc"'); assert.deepEqual([r4.stats.notModified, r4.stats.newItems], [1, 0]);
  const t = await N.testSource(bad.id, { fetchImpl: async () => { throw new FetchError('timeout', 'Sunucu 15 saniyede cevap vermedi'); } });
  assert.deepEqual([t.ok, t.message], [false, 'Sunucu 15 saniyede cevap vermedi']);
  const t2 = await N.testSource(ok.id, { fetchImpl: n.fetchImpl }); assert.equal(t2.ok, true); assert.equal(t2.itemCount, 6); assert.equal(t2.sample.length, 5);
  const t3 = await N.testSource(ok.id, { fetchImpl: async () => ({ status: 200, body: '<html>nope</html>', url: U.tc }) }); assert.equal(t3.ok, false); assert.match(t3.message, /RSS\/Atom|okunamadı/);
  assert.equal(await count('SELECT count(*)::int n FROM news_items'), 13, 'TechCrunch 6 + Bleeping 6 + Down 1: the test reads and failed reads stored nothing extra');
});

test('all sources down: the run is an error and a notification is raised; GDELT items are read through the same path', opts, async () => {
  const pid = await site();
  await src(pid, 'Down 1', 'rss', U.down); await src(pid, 'Down 2', 'rss', 'https://down2.example/feed');
  const n = net(); n.state.fail.add(U.down); n.state.fail.add('https://down2.example/feed');
  const r = await run(pid, { fetchImpl: n.fetchImpl });
  assert.equal(r.status, 'error'); assert.match(r.error, /HTTP 500/);
  assert.equal(await count("SELECT count(*)::int n FROM notifications WHERE type = 'news_sources_failed'"), 1);
  const g = await N.createSource(pid, { name: 'GDELT', kind: 'gdelt', query: 'chatgpt', sourceType: 'aggregator', reliability: 50 });
  const r2 = await run(pid, { fetchImpl: n.fetchImpl, sourceIds: [g.id] });
  assert.equal(r2.stats.newItems, 2); const gd = (await N.listItems(pid, { q: 'reasoning' })).items; assert.equal(gd.length, 2);
  assert.deepEqual(gd.map((x) => [x.country, x.status]).sort(), [['GB', 'relevant'], ['US', 'relevant']], 'country comes from GDELT\'s sourcecountry');
  assert.equal((await N.listClusters(pid)).items.filter((c) => c.sourceCount === 2).length, 1, 'the two GDELT articles about one model are one event');
});

test('background start: the run returns at once, a second start is refused while it works, stale runs are closed', opts, async () => {
  const pid = await site();
  await src(pid, 'Good', 'rss', U.tc);
  let release; const gate = new Promise((r) => { release = r; });
  const n = net(); const slow = async (u, o) => { await gate; return n.fetchImpl(u, o); };
  const started = await N.startDiscovery(pid, { fetchImpl: slow, now: NOW, gapMs: 0 });
  assert.equal(started.status, 'running');
  await assert.rejects(N.startDiscovery(pid, { fetchImpl: slow, now: NOW }), (e) => e.status === 409 && e.extra.runId === started.id);
  release();
  for (let i = 0; i < 100 && (await runs.get(started.id)).status === 'running'; i++) await new Promise((r) => setTimeout(r, 30));
  const done = await runs.get(started.id); assert.equal(done.status, 'ok'); assert.equal(done.stats.newItems, 6); assert.ok(done.finishedAt);
  await H.db().query("INSERT INTO automation_runs (bot_key, project_id, status, started_at) VALUES ('news_discovery', $1, 'running', now() - interval '2 hours')", [pid]);
  assert.equal(await runs.closeStale(), 1);
  assert.equal((await runs.list({ botKey: 'news_discovery' })).filter((r) => r.status === 'error' && /yeniden başladığı/.test(r.error)).length, 1);
  assert.equal((await runs.lastByBot()).get('news_discovery').runs, 2);
});

/** every statement of every connection goes through pg's Client.prototype.query: count them */
async function countQueries(fn) {
  const { Client } = require('pg'); const orig = Client.prototype.query; let n = 0;
  Client.prototype.query = function counted(...a) { n++; return orig.apply(this, a); };
  try { await fn(); } finally { Client.prototype.query = orig; }
  return n;
}

test('PERFORMANCE: the database is far away (Render Singapore, Supabase Tokyo): a scan and an idea refresh use a number of statements that does NOT grow with the number of headlines / topics', opts, async () => {
  const O = require('../../src/content/services/opportunities');
  const mk = (p, n, start) => rssOf(Array.from({ length: n }, (_, i) => [`ChatGPT and Gemini ${["Plus", "Pro", "Team"][i % 3]} release ${start + i} brings feature ${start + i} to Android users`, `https://${p}.example/${start + i}`, 'Fri, 21 Nov 2026 10:00:00 GMT']));
  const measure = async (perSource) => {
    await H.clean(); const pid = await site();
    for (const p of ['a', 'b', 'c']) await src(pid, `Outlet ${p}`, 'rss', `https://${p}.example/feed`);
    const map = Object.fromEntries(['a', 'b', 'c'].map((p, i) => [`https://${p}.example/feed`, mk(p, perSource, i * 1000)]));
    await S.set('news', { maxItemsPerSource: 100 }, { scope: 'project', projectId: pid });
    let run;
    const scan = await countQueries(async () => { run = await N.runDiscovery(pid, { fetchImpl: net(map).fetchImpl, now: NOW, gapMs: 0 }); });
    const refresh = await countQueries(() => O.refresh(pid, { now: NOW }));
    return { items: run.stats.newItems, scan, refresh, topics: await count('SELECT count(*)::int n FROM topics') };
  };
  const small = await measure(10); const big = await measure(60);
  console.log(`  [statements] scan: ${small.scan} for ${small.items} headlines, ${big.scan} for ${big.items}; refresh: ${small.refresh} for ${small.topics} topics, ${big.refresh} for ${big.topics}`);
  assert.equal(small.items, 30); assert.equal(big.items, 180);
  assert.ok(big.scan <= small.scan + 6, `scan: ${small.scan} statements for ${small.items} headlines, ${big.scan} for ${big.items}`);
  assert.ok(big.scan < 80, `a scan of 3 sources used ${big.scan} statements`);
  assert.ok(big.topics > small.topics && big.topics >= 50, `${small.topics} -> ${big.topics} topics`);
  assert.ok(big.refresh <= small.refresh + 4 && big.refresh < 30, `refresh: ${small.refresh} statements for ${small.topics} topics, ${big.refresh} for ${big.topics}`);
});

test('reclassify: editing the keyword lists / excluded topics takes effect on the headlines already stored (a person\'s decisions stay), in a fixed number of statements', opts, async () => {
  const pid = await site();
  await src(pid, 'Mixed', 'rss', 'https://m.example/feed');
  const feeds = { 'https://m.example/feed': rssOf([['Google rolls out Gemini update to Android phones', 'https://m.example/1'], ['Quantum widgets are trending among hobbyists', 'https://m.example/2'], ['Photon gadget maker raises prices for subscribers', 'https://m.example/3'], ['Hackers leak customer data in major data breach', 'https://m.example/4'], ['Weekend sale on gadgets', 'https://m.example/5']]) };
  await N.runDiscovery(pid, { fetchImpl: net(feeds).fetchImpl, now: NOW, gapMs: 0 });
  const by = async () => Object.fromEntries((await N.listItems(pid, { pageSize: 50 })).items.map((i) => [i.title.split(' ')[0], i]));
  let m = await by(); assert.deepEqual([m.Google.status, m.Quantum.status, m.Photon.status, m.Hackers.status], ['relevant', 'irrelevant', 'relevant', 'relevant']);
  // the owner teaches the filter: a new strong term for a category, a new excluded topic, and decides about one event by hand
  const cats = await P.listCategories(pid);
  await P.updateCategory(cats[1].id, { relatedKeywords: [...cats[1].relatedKeywords, 'quantum widgets'] });
  await P.addExcluded(pid, { topic: 'photon gadget', reason: 'test' });
  const hackers = (await N.listClusters(pid, { q: 'Hackers' })).items[0]; await N.setClusterStatus(hackers.id, 'irrelevant');
  await P.addExcluded(pid, { topic: 'data breach', reason: 'test' });
  const stmts = await countQueries(async () => { var r = await N.reclassify(pid, { now: NOW }); assert.deepEqual([r.checked, r.becameRelevant, r.becameExcluded], [4, 1, 1], JSON.stringify(r)); });
  assert.ok(stmts < 20, `${stmts} statements`);
  m = await by();
  assert.deepEqual([m.Quantum.status, m.Photon.status, m.Google.status], ['relevant', 'excluded', 'relevant']);
  assert.equal(m.Hackers.status, 'relevant', 'the stored item of an event a person decided on is not touched (the event itself keeps the person\'s decision)'); assert.equal((await N.getCluster(hackers.id)).status, 'irrelevant');
  assert.match(m.Photon.reason, /photon gadget/); assert.match(m.Quantum.reason, /quantum widgets/);
  assert.equal((await N.listClusters(pid, { q: 'Quantum' })).items[0].status, 'relevant', 'the event follows its headlines');
  const again = await N.reclassify(pid, { now: NOW }); assert.deepEqual([again.changed, again.becameRelevant], [0, 0], 'a second pass changes nothing');
});
