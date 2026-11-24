process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { fakeModels, PAGE } = require('./fakeModels');
const { fakeApify } = require('./fakeApify');
const { fakeSerper } = require('./fakeSerper');
const { startFakeWp } = require('./fakeWordPress');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const O = require('../../src/content/services/opportunities');
const PR = require('../../src/content/services/providers');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const SI = require('../../src/content/services/sites');
const SC = require('../../src/content/services/scheduler');
const AU = require('../../src/content/services/automation');
const PL = require('../../src/content/services/pipeline');
const { FetchError } = require('../../src/content/lib/safeFetch');

/**
 * THE PRODUCTION LINE ("Otomatik Üretim"), end to end: the scheduler's tick starts a cycle, the worker walks it through idea -> keyword data -> SERP -> suitability -> writing + checks ->
 * fixing -> publishing -> clean-up, one idea at a time, and only a step that SUCCEEDED passes the cycle on. Every outside service is a fake (models, Apify, Serper, the news, WordPress);
 * the database, the queue, the limits and the HTTP to the fake site are real.
 */
const opts = { skip: H.skip };
const D0 = new Date('2026-11-23T10:00:00Z');                      // Monday 13:00 in Istanbul
const plus = (d, min) => new Date(d.getTime() + min * 60000);
let wp;
test.before(async () => { if (!H.skip) { await H.freshDatabase(); wp = await startFakeWp(); } });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await wp.close(); wp = await startFakeWp(); } });
test.after(async () => { if (!H.skip) { await wp.close(); await H.close(); } });

const rssOf = (items, pub = 'Sat, 22 Nov 2026 10:00:00 GMT') => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l]) => `<item><title>${t}</title><link>${l}</link><pubDate>${pub}</pubDate><description>${t}.</description></item>`).join('')}</channel></rss>`;
const ITEMS = [['OpenAI raises ChatGPT Plus price for subscribers', 1], ['Google Chrome update fixes critical security flaw in latest release', 2], ['Windows 11 KB5132057 update causes problems for some users', 3],
  ['How to fix iPhone WiFi not working after iOS update', 4], ['Netflix raises subscription prices again for premium plan', 5], ['Gemini 3 launches with new features for Google AI users', 6], ['Hackers leak data of millions after breach at major retailer', 7]];
const feedFor = (items, host, pub) => rssOf(items.map(([t, n]) => [t, `https://${host}.example/${n}`]), pub);
const feedsOf = (items, pub) => { const m = { 'https://a.example/feed': feedFor(items, 'a', pub), 'https://b.example/feed': feedFor(items, 'b', pub) }; return async (url) => { if (!m[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: m[url], url }; }; };
const pageFetcher = async () => ({ body: PAGE() });
const probeOk = async () => ({ status: 'ok', http: 200, finalUrl: null, note: '' });
const drain = async (now, ctx) => { let n = 0; const done = []; for (;;) { const j = await SC.workOnce({ now, ctx }); if (!j) return done; done.push(`${j.botKey}:${j.outcome}`); if (++n > 80) throw new Error('the queue does not empty'); } };
const q = (sql, p = []) => H.db().query(sql, p).then((r) => r.rows);
const q1 = async (sql, p = []) => (await q(sql, p))[0];

/** a project with every service connected and the news of `items` scanned by the line itself (nothing is done by hand but the switch) */
async function world({ noVolume = /^$/, items = ITEMS, freshHours = 0 } = {}) {
  const pid = (await P.seedDefault()).projectId;
  await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789', extra: { inputPricePerM: '3', outputPricePerM: '15' } });
  await PR.save('openai', { secret: 'sk-test-key-0123456789abcdef', extra: { model: 'gpt-test', inputPricePerM: '1', outputPricePerM: '4' } });
  await PR.save('apify', { secret: 'apify_api_testtoken0123456789' }); await PR.save('serper', { secret: 'serper-test-key-0123456789' });
  const site = await SI.create(pid, { name: 'Tech Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); assert.equal((await SI.test(site.id)).ok, true);
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await H.db().query('UPDATE niche_profiles SET min_opportunity_score = 30 WHERE project_id = $1', [pid]); await H.db().query('UPDATE categories SET min_opportunity_score = NULL');
  await S.set('quality', { ...(await S.get('quality')).value, minScore: 50 }, { scope: 'global' }); await S.set('seo', { ...(await S.get('seo')).value, freshHours }, { scope: 'global' });
  const volumes = new Proxy({}, { get: (_, k) => (typeof k !== 'string' ? undefined : (noVolume.test(k) ? { none: true } : { volume: 5400, cpc: 1.2, comp: 0.4, kd: 35 })), has: () => true });
  const apify = fakeApify({ volumes }); const serper = fakeSerper({ '*': ['smallblog.example', 'nichesite.example', 'tinydocs.example', 'devnotes.example', 'forum.example'] });
  const m = fakeModels();
  const route = async (url, o) => { const u = String(url); if (u.includes('api.apify.com')) return apify.fetchImpl(url, o); if (u.includes('serper.dev')) return serper.fetchImpl(url, o); return m.fetchImpl(url, o); };
  const feed = { items, pub: undefined }; const ctx = { fetchImpl: route, fetcher: pageFetcher, get newsFetch() { return feedsOf(feed.items, feed.pub); }, gapMs: 0, probe: probeOk };
  return { pid, site, apify, serper, m, ctx, feed };
}
const turnOn = (pid, extra = {}) => PL.setConfig(pid, { enabled: true, confirm: true, ...extra });
/** the clock of the line: queue what is due, then let the worker work until nothing is left */
const run = async (w, now) => { await SC.tick({ now }); return drain(now, w.ctx); };

test('the whole cycle: the line starts by itself, walks every step, publishes ONE article on the first category, throws the day\'s research away, and says what it did', opts, async () => {
  const w = await world(); const { pid } = w;
  await assert.rejects(PL.setConfig(pid, { enabled: true }), (e) => e.extra.requiresConfirmation === true, 'turning it on needs an explicit yes (it publishes without anybody looking)');
  const on = await turnOn(pid); assert.equal(on.enabled, true);
  assert.equal((await S.get('quality', pid)).value.manualApprovalNewArticles, false, 'the line cannot finish without automatic approval: switched on, and said so');
  assert.ok(on.changes.some((c) => /AÇILDI/.test(c)));

  const ran = await run(w, D0); assert.ok(ran.includes('daily_pipeline:done'), ran.join(' '));
  const r = await PL.openRun(pid); assert.equal(r, null, 'the cycle is over');
  const done = await q1("SELECT * FROM pipeline_runs"); assert.equal(done.status, 'done'); assert.equal(done.step, 'cleanup'); assert.equal(done.attempt, 1);
  const cat = await q1('SELECT name_en FROM categories WHERE id = $1', [done.category_id]); assert.equal(cat.name_en, 'AI Tools & Updates', 'the first category of the fixed order');
  assert.deepEqual(done.trail.filter((t) => t.ok === true).map((t) => t.step).filter((x, i, a) => a.indexOf(x) === i), ['idea', 'keyword', 'serp', 'check', 'write', 'fix', 'publish', 'cleanup']);
  const art = await q('SELECT id, status, category_id FROM articles'); assert.equal(art.length, 1); assert.equal(art[0].status, 'published'); assert.equal(art[0].category_id, done.category_id);
  const posts = [...wp.posts.values()]; assert.equal(posts.length, 1); assert.equal(posts[0].status, 'publish', 'live, not a draft');
  assert.equal((await q1('SELECT status FROM publications')).status, 'published');
  assert.equal((await L.status({ projectId: pid, now: D0 })).items.find((i) => i.workType === 'new_article').done, 1);

  // the research is gone, the memory is not
  assert.equal((await q1('SELECT count(*)::int n FROM content_opportunities')).n, 0, 'every idea of the day is gone');
  assert.equal((await q1("SELECT count(*)::int n FROM keywords WHERE origin <> 'manual'")).n, 0); assert.equal((await q1('SELECT count(*)::int n FROM keyword_metrics')).n, 0); assert.equal((await q1('SELECT count(*)::int n FROM serp_analyses')).n, 0);
  assert.equal((await q1("SELECT count(*)::int n FROM topics WHERE status <> 'used'")).n, 0, 'the leftover topics are closed, so the same events do not come back as ideas');
  assert.ok((await q1('SELECT count(*)::int n FROM news_items')).n > 0, 'the news items stay: a re-scan must not treat them as new');
  assert.equal((await q1("SELECT count(*)::int n FROM cleanup_log WHERE trigger = 'pipeline'")).n, 1);
  assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'pipeline_published'")).n, 1);
  assert.ok((await q1('SELECT count(*)::int n FROM article_sources')).n > 0, 'the article keeps its own copy of the sources');

  // later ticks inside the interval start nothing: ONE article a day
  await run(w, plus(D0, 600)); assert.equal((await q1('SELECT count(*)::int n FROM pipeline_runs')).n, 1); assert.equal(wp.posts.size, 1);
});

test('the gate rule: an idea whose keyword has NO volume data is thrown away at that step (no SERP money spent on it) and the next idea of the same category is used', opts, async () => {
  const w = await world({ noVolume: /chatgpt|openai/ }); const { pid } = w;
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done'); assert.equal(d.attempt, 2, 'the first idea was dropped, the second one was written');
  const dropped = d.trail.filter((t) => /Fikir elendi/.test(t.text)); assert.equal(dropped.length, 1); assert.equal(dropped[0].step, 'keyword'); assert.match(dropped[0].text, /Anahtar kelime verisi bulunamadı/);
  assert.equal(w.serper.calls.length, 1, 'only the idea that passed the keyword step got a SERP analysis');
  const art = await q1('SELECT h1 FROM articles'); assert.match(art.h1, /gemini/i, 'the second idea (Gemini) is the one that became the article');
  assert.equal(wp.posts.size, 1);
});

test('an article the checks cannot clear and only a person could decide (a sensitive subject) is archived, its idea is thrown away, and the cycle starts again with the next idea and publishes THAT', opts, async () => {
  const w = await world(); const { pid } = w; let reviews = 0;
  const sensitive = { categories: Object.fromEntries(['originality', 'user_value', 'source_accuracy', 'hallucination', 'copyright', 'keyword_stuffing', 'misleading_title', 'spam', 'low_value_auto', 'sensitive', 'ad_restrictions', 'image_rights', 'integrity'].map((k) => [k, k === 'sensitive' ? { status: 'warn', note: 'A data-breach story needs careful sourcing.' } : { status: 'pass', note: '' }])), risk: 'review', ratings: { originality: 82, usefulness: 80, editorial: 84 }, improvements: [], summary: 'Fine, but sensitive.' };
  const base = w.m.st.override.review; w.m.st.override.review = (user, n) => { reviews++; return reviews === 1 ? sensitive : (base ? base(user, n) : undefined) || require('./fakeModels').fakeModels().st.override.review; };
  // (the default reviewer answer is used from the second call on: ask the fake for it by clearing the override)
  w.m.st.override.review = (user, n) => { reviews++; if (reviews === 1) return sensitive; delete w.m.st.override.review; return undefined; };
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note); assert.equal(d.attempt, 2);
  assert.ok(d.trail.some((t) => /Fikir elendi: Bir kişinin kararı gerekiyor/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
  const arts = await q('SELECT status FROM articles ORDER BY created_at'); assert.deepEqual(arts.map((a) => a.status), ['archived', 'published'], 'the draft that could not be cleared is archived (a person can still take it back), the next one went live');
  assert.equal(wp.posts.size, 1);
});

test('categories are used in turns: the next cycle starts in the category after the one that produced the last article; a category with nothing is skipped', opts, async () => {
  const w = await world(); const { pid } = w;
  await turnOn(pid); await run(w, D0);
  const first = await q1("SELECT c.name_en FROM pipeline_runs r JOIN categories c ON c.id = r.category_id WHERE r.status = 'done'");
  assert.equal(first.name_en, 'AI Tools & Updates');
  // a day later the news are about software updates: the cycle starts in the category AFTER the first one (and would skip a category with nothing, see the next test)
  await q("UPDATE articles SET status = 'archived'");      // (the fake writer repeats the same paragraphs for every idea; the own-article similarity check, which is real, would flag the second one. Real articles differ.)
  w.feed.items = [['WhatsApp rolling out redesign of the Android app with a new chat list', 11], ['Slack changelog: rolls out new canvas features to all workspaces', 12]];
  await run(w, plus(D0, 1500));
  const second = await q('SELECT c.name_en, r.status FROM pipeline_runs r JOIN categories c ON c.id = r.category_id ORDER BY r.started_at');
  assert.deepEqual(second.map((x) => [x.name_en, x.status]), [['AI Tools & Updates', 'done'], ['Apps & Software Updates', 'done']], JSON.stringify(second));
  assert.equal(wp.posts.size, 2);
  // the third day: only a how-to story. The turn would be "Digital Privacy & Security", which has nothing: it is skipped (said in the trail) and the cycle works in the next category that has something
  await q("UPDATE articles SET status = 'archived'");
  w.feed.items = [['How to turn off Spotify autoplay on iPhone step by step', 21]]; w.feed.pub = 'Tue, 25 Nov 2026 08:00:00 GMT';
  await run(w, plus(D0, 3000));
  const third = await q1("SELECT c.name_en, r.status, r.trail FROM pipeline_runs r LEFT JOIN categories c ON c.id = r.category_id ORDER BY r.started_at DESC LIMIT 1");
  assert.equal(third.status, 'done', JSON.stringify(third.trail.map((t) => t.text)));
  assert.ok(third.trail.some((t) => /Digital Privacy & Security: uygun fikir yok, sıradaki kategoriye geçildi/.test(t.text)), 'the empty category is skipped, and it says so');
  assert.equal(wp.posts.size, 3);
});

test('a daily limit makes the cycle WAIT (it does not give up or lose its place); it goes on the next day, from the step it was at', opts, async () => {
  const w = await world(); const { pid } = w;
  await turnOn(pid);
  await H.db().query("UPDATE niche_profiles SET daily_article_limit = 1 WHERE project_id = $1", [pid]); await L.setGlobalLimits({ new_article: 1 });
  await L.reserve({ workType: 'new_article', projectId: pid, amount: 1, manual: true, now: D0 });          // today's only place is already used
  await run(w, D0);
  const r = await PL.openRun(pid); assert.equal(r.status, 'waiting'); assert.equal(r.step, 'idea'); assert.match(r.note, /Günlük yeni makale sınırı doldu/);
  assert.ok(new Date(r.waitUntil) > plus(D0, 600), 'waits for the next local day');
  await run(w, plus(D0, 300)); assert.equal((await PL.openRun(pid)).status, 'waiting', 'nothing happens while it waits');
  assert.equal(wp.posts.size, 0);
  await L.setGlobalLimits({ new_article: 3 }); await H.db().query("UPDATE niche_profiles SET daily_article_limit = 3");
  await run(w, plus(D0, 1500));                                                                              // the next day
  assert.equal((await q1('SELECT status FROM pipeline_runs')).status, 'done'); assert.equal(wp.posts.size, 1);
});

test('a problem no other idea can cure (a rejected key) STOPS the cycle once, tells the owner once, and the cycle goes on by itself when the key works again', opts, async () => {
  const w = await world(); const { pid } = w;
  w.m.st.fail.write = { status: 401, type: 'authentication_error', message: 'invalid x-api-key' };
  await turnOn(pid); await run(w, D0);
  let r = await PL.openRun(pid); assert.equal(r.status, 'stopped', r.note); assert.match(r.note, /anahtar|reddedildi/i); assert.equal(r.step, 'write');
  assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'pipeline_stopped'")).n, 1);
  await run(w, plus(D0, 5)); assert.equal((await PL.openRun(pid)).status, 'stopped', 'not looked at again for a while'); assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'pipeline_stopped'")).n, 1);
  delete w.m.st.fail.write;                                                                                     // the owner fixed the key
  await run(w, plus(D0, 40)); assert.equal((await q1('SELECT status FROM pipeline_runs')).status, 'done'); assert.equal(wp.posts.size, 1);
});

test('WordPress is down at the LAST step: nothing is lost or sent twice; the cycle waits at "publish", tries again later and publishes ONCE; a refused login stops it instead', opts, async () => {
  const w = await world(); const { pid } = w;
  wp.failNext = { match: /POST \/wp\/v2\/posts/, status: 503, keep: true };
  await turnOn(pid); await run(w, D0);
  let r = await PL.openRun(pid); assert.equal(r.status, 'waiting', r.note); assert.equal(r.step, 'publish'); assert.match(r.note, /yeniden denenecek/);
  assert.equal((await q1("SELECT status FROM articles")).status, 'ready', 'the approved article waits; the research is NOT deleted before the post is live');
  assert.ok((await q1('SELECT count(*)::int n FROM keywords')).n > 0);
  wp.failNext = null;
  await run(w, plus(D0, 5)); assert.equal((await PL.openRun(pid)).status, 'waiting', 'not before the pause is over');
  await run(w, plus(D0, 15));
  assert.equal((await q1('SELECT status FROM pipeline_runs')).status, 'done'); assert.equal(wp.posts.size, 1, 'one post, not two'); assert.equal((await q1('SELECT count(*)::int n FROM keywords WHERE origin <> \'manual\'')).n, 0, 'cleaned up after the post is live');
});

test('a WordPress login that is refused stops the cycle (no other idea could help) and tells the owner', opts, async () => {
  const w = await world(); const { pid } = w;
  await turnOn(pid);
  await H.db().query("UPDATE wp_sites SET username = 'someone-else'");                                           // the password no longer fits the account (the stored connection test still says passed: the login is refused only at the post)
  await run(w, D0);
  const r = await PL.openRun(pid); assert.equal(r.status, 'stopped', r.note); assert.equal(r.step, 'publish'); assert.match(r.note, /WordPress/);
  assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'pipeline_stopped'")).n, 1); assert.equal(wp.posts.size, 0);
});

test('an idea that did not make it is taken out of the research pages AT ONCE, with its keywords, volumes and SERP data (nothing piles up while the line works); its topic is closed so it does not come back', opts, async () => {
  const w = await world({ noVolume: /.*/ }); const { pid } = w;                                                  // no keyword has data: every idea fails at the keyword step
  await turnOn(pid); await run(w, D0);
  const r = await PL.openRun(pid); assert.equal(r.status, 'waiting'); assert.match(r.note, /Hiçbir kategoride uygun fikir yok/); assert.ok(r.attempt > 1, 'several ideas were tried');
  assert.deepEqual((await q('SELECT title FROM content_opportunities')).map((x) => x.title.split(' ')[0]), ['Hackers'], 'every TRIED idea is gone (not left as "rejected"); only the headline without a name, which was never tried, waits for the clean-up');
  assert.equal((await q1("SELECT count(*)::int n FROM keywords k JOIN topics t ON t.id = k.topic_id WHERE t.status = 'used'")).n, 0, 'no keyword of a closed topic is left'); assert.equal((await q1('SELECT count(*)::int n FROM keyword_metrics')).n, 0);
  assert.equal((await q1("SELECT count(*)::int n FROM topics WHERE status <> 'used'")).n, 1, 'the tried ideas\' topics are closed (only the never-tried one is still open)');
  await O.refresh(pid, { now: plus(D0, 5) }); assert.equal((await q1('SELECT count(*)::int n FROM content_opportunities')).n, 1, 'a re-scoring does not bring the tried ones back');
});

test('the fresh-news lane marks even a FULLY scored idea: such an idea must still pass the suitability step (it was wrongly thrown away on the first live run: score 73-76 against a minimum of 70)', opts, async () => {
  const w = await world({ freshHours: 36 }); const { pid } = w;
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text)));
  assert.ok(d.trail.some((t) => /^Uygun: fırsat puanı \d+/.test(t.text)), 'the suitability step said yes with a real score'); assert.equal(wp.posts.size, 1);
});

test('Apify\'s free plan gives 5 runs a day: when the actor answers with nothing and its log says so, the cycle WAITS for the reset (00:05 UTC) - it neither burns ideas nor retries - and goes on after it', opts, async () => {
  const w = await world(); const { pid } = w; w.apify.state.freeLimit = true;
  await turnOn(pid); await run(w, D0);
  const r = await PL.openRun(pid); assert.equal(r.status, 'waiting', r.note); assert.equal(r.step, 'keyword'); assert.match(r.note, /ücretsiz planında günlük 5 çalıştırma/); assert.equal(r.attempt, 1, 'no idea was thrown away for it');
  assert.equal(new Date(r.waitUntil).toISOString(), '2026-11-24T00:05:00.000Z', 'the next 00:05 UTC');
  assert.equal(w.apify.asked().length, 1, 'ONE call was spent finding out');
  await run(w, plus(D0, 600)); assert.equal(w.apify.asked().length, 1, 'nothing is asked again before the reset');
  w.apify.state.freeLimit = false;
  await run(w, new Date('2026-11-24T00:10:00Z')); assert.equal((await q1('SELECT status FROM pipeline_runs')).status, 'done'); assert.equal(wp.posts.size, 1);
});

test('keywords the platform would pay for must hold a NAME of the headline; a generic word ("leaked") is not asked for, and an idea with no such keyword is skipped without being counted as a try', opts, async () => {
  assert.equal(PL.sane('staples canada', 'Staples Canada says customer information accessed in data breach'), true);
  assert.equal(PL.sane('leaked', 'Phoebe confirms patient information leaked in former third-party vendor data breach'), false);
  assert.equal(PL.sane('how to', 'How to fix iPhone WiFi not working'), false); assert.equal(PL.sane('windows 11', 'Windows 11 update causes problems'), true); assert.equal(PL.sane('gemini 3', 'Gemini 3 launches with new features'), true);
  const w = await world({ items: [['Hackers leak data of millions after breach at major retailer', 7], ['Gemini 3 launches with new features for Google AI users', 6]] }); const { pid } = w;
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 1, 'the headline without a name was never tried');
  assert.match((await q1('SELECT h1 FROM articles')).h1, /gemini/i);
});

test('while the line is on the old modes page is PASSIVE: the server refuses to apply a mode or the checkboxes (they would switch the batch bots the line runs), and it works again when the line is off', opts, async () => {
  const w = await world(); const { pid } = w; void w;
  assert.equal((await AU.overview(pid)).pipelineOn, false);
  await turnOn(pid);
  assert.equal((await AU.overview(pid)).pipelineOn, true, 'the page learns it from the overview');
  await assert.rejects(AU.apply({ projectId: pid, mode: 'manual' }), (e) => e.status === 409 && /pasif/.test(e.message));
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { news: false } }), (e) => e.status === 409);
  await PL.setConfig(pid, { enabled: false });
  const ok = await AU.apply({ projectId: pid, mode: 'custom', options: { news: false } }); assert.equal(ok.options.find((o) => o.key === 'news').on, false);
});

test('turning it on: missing connections are named; limits only go UP for the pace; the old batch bots stop queueing for this project while the line is on, and come back when it is off', opts, async () => {
  const pid = (await P.seedDefault()).projectId;
  await assert.rejects(PL.setConfig(pid, { enabled: true, confirm: true }), (e) => e.status === 409 && e.extra.problems.some((x) => x.key === 'model') && e.extra.problems.some((x) => x.key === 'wordpress'));
  const w = await world(); void w;
  await L.setGlobalLimits({ new_article: 40 });
  const on = await PL.setConfig(pid, { enabled: true, confirm: true, everyMinutes: 120 });                       // 12 cycles a day
  const st = (await L.status({ projectId: pid })).items; assert.equal(st.find((i) => i.workType === 'new_article').limit, 40, 'a higher limit the owner set is never lowered');
  assert.ok(st.find((i) => i.workType === 'publish').limit >= 12, 'the publishing limit follows the pace'); assert.equal(on.cyclesPerDay, 12);
  assert.ok(on.warnings.some((x) => /hızlı bir tempo/.test(x.text)), 'a fast pace is said to be fast');
  await SC.saveSchedule('article_writer', { enabled: true, nextRunAt: null });
  const t1 = await SC.tick({ now: D0 }); assert.ok(!t1.enqueued.some((e) => e.bot === 'article_writer'), 'the old writer bot does not queue while the line is on');
  await PL.setConfig(pid, { enabled: false });
  await SC.saveSchedule('article_writer', { nextRunAt: null }); await q('UPDATE jobs SET status = \'cancelled\' WHERE status = \'queued\'');
  const t2 = await SC.tick({ now: plus(D0, 5) }); assert.ok(t2.enqueued.some((e) => e.bot === 'article_writer'), 'switched off: the old schedules apply again');
});

test('the clean-up never touches what a person typed in or put on the short list, nor articles, news items, or manual keywords', opts, async () => {
  const w = await world(); const { pid } = w;
  await N.runDiscovery(pid, { fetchImpl: feedsOf(ITEMS), now: D0, gapMs: 0 }); await O.refresh(pid, { now: D0 });
  const [keep, other] = await q('SELECT id, topic_id FROM content_opportunities ORDER BY provisional_score DESC LIMIT 2');
  await O.setStatus(keep.id, 'shortlisted', { now: D0 });
  await H.db().query("INSERT INTO keywords (project_id, keyword, country, language, origin) VALUES ($1, 'my own typed keyword', 'US', 'en', 'manual')", [pid]);
  const out = await PL.cleanLeftovers(pid, D0);
  assert.equal((await q1('SELECT count(*)::int n FROM content_opportunities')).n, 1, 'only the short-listed idea is left'); assert.equal((await q1('SELECT id FROM content_opportunities')).id, keep.id);
  assert.equal((await q1("SELECT count(*)::int n FROM keywords WHERE origin = 'manual'")).n, 1);
  assert.ok(out.usedIdeas === 6 && out.closedTopics >= 5 && out.keywords > 0, JSON.stringify(out));
  assert.equal((await q1('SELECT status FROM topics WHERE id = $1', [other.topic_id])).status, 'used');
});

test('unit: category order wraps round and skips what was already tried; the next free place of the day is after local midnight; errors are told apart', opts, async () => {
  const cats = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(PL.nextCategory(cats, null, []).id, 'a'); assert.equal(PL.nextCategory(cats, 'a', []).id, 'b'); assert.equal(PL.nextCategory(cats, 'c', []).id, 'a');
  assert.equal(PL.nextCategory(cats, 'a', ['b']).id, 'c'); assert.equal(PL.nextCategory(cats, 'a', ['a', 'b', 'c']), null); assert.equal(PL.nextCategory([], null, []), null);
  const t = PL.tomorrow(new Date('2026-11-23T10:00:00Z'));                                              // 13:00 in Istanbul (UTC+3): tomorrow starts 2026-11-23T21:00Z
  assert.equal(t.toISOString(), '2026-11-23T21:05:00.000Z');
  const now = D0; const E = (props, Cls = Error) => Object.assign(new Cls('x'), props);
  assert.ok(PL.classify(E({ budget: true }), now).wait, 'a full budget waits for tomorrow');
  assert.ok(PL.classify(E({ code: 'auth' }), now).stop, 'a rejected key stops the cycle'); assert.ok(PL.classify(E({ fatal: true }), now).stop);
  assert.ok(PL.classify(E({ code: 'overloaded', retryable: true }), now).retry, 'a busy service is tried again later'); assert.ok(PL.classify(E({ status: 503 }), now).retry);
  assert.ok(PL.classify(new Error('something odd'), now).unknown, 'anything else belongs to the idea or the step');
});
