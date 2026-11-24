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
async function world({ noVolume = /^$/, items = ITEMS, freshHours = 0, suggest = {} } = {}) {
  const pid = (await P.seedDefault()).projectId;
  await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789', extra: { inputPricePerM: '3', outputPricePerM: '15' } });
  await PR.save('openai', { secret: 'sk-test-key-0123456789abcdef', extra: { model: 'gpt-test', inputPricePerM: '1', outputPricePerM: '4' } });
  await PR.save('apify', { secret: 'apify_api_testtoken0123456789' }); await PR.save('serper', { secret: 'serper-test-key-0123456789' });
  const site = await SI.create(pid, { name: 'Tech Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); assert.equal((await SI.test(site.id)).ok, true);
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await H.db().query('UPDATE niche_profiles SET min_opportunity_score = 30 WHERE project_id = $1', [pid]); await H.db().query('UPDATE categories SET min_opportunity_score = NULL');
  await S.set('quality', { ...(await S.get('quality')).value, minScore: 50 }, { scope: 'global' }); await S.set('seo', { ...(await S.get('seo')).value, freshHours }, { scope: 'global' });
  const volumes = new Proxy({}, { get: (_, k) => (typeof k !== 'string' ? undefined : (noVolume.test(k) ? { none: true } : { volume: 5400, cpc: 1.2, comp: 0.4, kd: 35 })), has: () => true });
  const apify = fakeApify({ volumes }); const serper = fakeSerper({ '*': ['smallblog.example', 'nichesite.example', 'tinydocs.example', 'devnotes.example', 'forum.example'] }, suggest);
  const m = fakeModels(); m.st.long = true;                                                       // drafts of more than 950 words: the line's minimum length
  const route = async (url, o) => { const u = String(url); if (u.includes('api.apify.com')) return apify.fetchImpl(url, o); if (u.includes('serper.dev')) return serper.fetchImpl(url, o); return m.fetchImpl(url, o); };
  const feed = { items, pub: undefined }; const ctx = { fetchImpl: route, fetcher: pageFetcher, get newsFetch() { return feedsOf(feed.items, feed.pub); }, gapMs: 0, probe: probeOk };
  return { pid, site, apify, serper, m, ctx, feed };
}
const dbg = async (label) => { if (process.env.DEBUG_PIPELINE) console.log(`TRAIL[${label}]`, JSON.stringify((await q('SELECT trail FROM pipeline_runs ORDER BY started_at DESC LIMIT 1'))[0].trail.map((t) => `${t.step}${t.ok === false ? '✗' : ''}: ${t.text}`.slice(0, 230)), null, 1)); };
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
  assert.equal(w.serper.calls.filter((c) => /\/search$/.test(c.url)).length, 1, 'only the idea that passed the keyword step got a SERP analysis (the Google suggestions for the keywords are separate calls)');
  const art = await q1('SELECT h1 FROM articles'); assert.match(art.h1, /gemini/i, 'the second idea (Gemini) is the one that became the article');
  assert.equal(wp.posts.size, 1);
});

test('with the owner\'s switch OFF an article the checks cannot clear and only a person could decide (a sensitive subject) is archived, its idea is thrown away, and the cycle starts again with the next idea and publishes THAT', opts, async () => {
  const w = await world(); const { pid } = w; let reviews = 0;
  const sensitive = { categories: Object.fromEntries(['originality', 'user_value', 'source_accuracy', 'hallucination', 'copyright', 'keyword_stuffing', 'misleading_title', 'spam', 'low_value_auto', 'sensitive', 'ad_restrictions', 'image_rights', 'integrity'].map((k) => [k, k === 'sensitive' ? { status: 'warn', note: 'A data-breach story needs careful sourcing.' } : { status: 'pass', note: '' }])), risk: 'review', ratings: { originality: 82, usefulness: 80, editorial: 84 }, improvements: [], summary: 'Fine, but sensitive.' };
  w.m.st.override.review = () => { reviews++; if (reviews === 1) return sensitive; delete w.m.st.override.review; return undefined; };          // sensitive for the first article, the default (low) reviewer from then on
  await turnOn(pid); await PL.setConfig(pid, { acceptSubjectWarning: false });                              // the owner's switch OFF: such a warning stays a person's decision
  await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note); assert.equal(d.attempt, 2);
  assert.ok(d.trail.some((t) => /Fikir elendi: Bir kişinin kararı gerekiyor/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
  const arts = await q('SELECT status FROM articles ORDER BY created_at'); assert.deepEqual(arts.map((a) => a.status), ['archived', 'published'], 'the draft that could not be cleared is archived (a person can still take it back), the next one went live');
  assert.equal(wp.posts.size, 1);
});

const SENSITIVE = { categories: Object.fromEntries(['originality', 'user_value', 'source_accuracy', 'hallucination', 'copyright', 'keyword_stuffing', 'misleading_title', 'spam', 'low_value_auto', 'sensitive', 'ad_restrictions', 'image_rights', 'integrity'].map((k) => [k, k === 'sensitive' ? { status: 'warn', note: 'A data-breach story needs careful sourcing.' } : { status: 'pass', note: '' }])), risk: 'review', ratings: { originality: 82, usefulness: 80, editorial: 84 }, improvements: [], summary: 'Fine, but sensitive.' };

test('a SUBJECT-level AdSense warning is no longer left to a person (the owner\'s decision): the line rewrites the text neutrally ONCE, then accepts the warning itself, approves and publishes; the class is not rewritten and the acceptance says who did it', opts, async () => {
  const w = await world(); const { pid } = w; w.m.st.override.review = SENSITIVE;                          // the reviewer keeps flagging the subject, whatever the wording
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 1, 'no idea was thrown away for it');
  const a = await q1('SELECT status, adsense_risk, adsense_accepted_risk, adsense_accepted_note FROM articles');
  assert.equal(a.status, 'published'); assert.equal(a.adsense_risk, 'review', 'the reviewer\'s class stays what it said'); assert.equal(a.adsense_accepted_risk, 'review'); assert.match(a.adsense_accepted_note, /Otomatik Üretim: sahibinin izniyle/);
  assert.equal(w.m.byRole('fix').length, 1, 'ONE neutral rewrite was asked for (and its prompt names the subject)'); assert.match(w.m.byRole('fix')[0].user, /SUBJECT of the article as sensitive/);
  assert.equal((await q1("SELECT count(*)::int n FROM audit_logs WHERE action = 'article.adsense_accept_auto'")).n, 1, 'said in the audit log'); assert.equal(wp.posts.size, 1);
  assert.ok(d.trail.some((t) => /sahibin izniyle hat tarafından kabul edildi/.test(t.text)));
});

test('... and when the rewrite is enough the warning is simply gone: nothing is accepted', opts, async () => {
  const w = await world(); const { pid } = w; let n = 0; w.m.st.override.review = () => { n++; if (n === 1) return SENSITIVE; delete w.m.st.override.review; return undefined; };
  await turnOn(pid); await run(w, D0);
  await dbg('rewrite-is-enough'); assert.equal((await q1('SELECT status FROM pipeline_runs')).status, 'done'); const a = await q1('SELECT status, adsense_risk, adsense_accepted_at FROM articles');
  assert.deepEqual([a.status, a.adsense_risk, a.adsense_accepted_at], ['published', 'low', null]);
});

const BLOCKED = { ...SENSITIVE, risk: 'blocked', categories: { ...SENSITIVE.categories, sensitive: { status: 'pass', note: '' }, copyright: { status: 'fail', note: 'Copied.' } } };
/** the reviewer calls the first `k` reviews "blocked" (the writer's own check + the fix bot's re-checks), then the default reviewer answers */
const blockedFor = (m, k) => { let n = 0; m.st.override.review = () => { n++; if (n >= k) delete m.st.override.review; return BLOCKED; }; };

test('the AdSense FIX BOT works a draft the reviewer called "blocked" over (a text-level class is cured by a new text, never accepted): the idea is NOT lost', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 2);                                    // the writer\'s check says blocked, the first re-check (after the bot\'s rewrite) says fine
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 1);
  assert.deepEqual((await q('SELECT status FROM articles')).map((x) => x.status), ['published']); assert.ok(w.m.byRole('fix').length >= 1, 'the bot rewrote the text');
  assert.ok(d.trail.some((t) => /AdSense Düzeltme Botu devrede/.test(t.text))); assert.equal((await q1("SELECT count(*)::int n FROM articles WHERE adsense_accepted_at IS NOT NULL")).n, 0, 'a blocked class was not accepted');
  assert.equal((await q1("SELECT count(*)::int n FROM automation_runs WHERE bot_key = 'adsense_fixer'")).n, 1, 'the bot has its own run record');
});

test('when even the bot\'s 4 rounds cannot clear the draft the line tries ONCE more: a FRESH draft by the OTHER writer, told why the first one failed; only then the first one is archived', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 6);                                    // writer check + 4 bot re-checks blocked; the second draft is judged by the default reviewer
  await turnOn(pid); await run(w, D0); await dbg('redo');
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + ' ' + JSON.stringify(d.trail.map((t) => t.text).slice(-6))); assert.equal(d.attempt, 1, 'the SAME idea was written again');
  assert.deepEqual((await q('SELECT status FROM articles ORDER BY created_at')).map((x) => x.status), ['archived', 'published']);
  const writes = w.m.byRole('write'); assert.equal(writes.length, 2); assert.notEqual(writes[0].vendor, writes[1].vendor, 'another writer for the second draft'); assert.match(writes[1].user, /A PREVIOUS DRAFT OF THIS ARTICLE WAS REJECTED/); assert.doesNotMatch(writes[0].user, /PREVIOUS DRAFT/);
  assert.ok(d.trail.some((t) => /Fikir elenmeden önce yeniden deneniyor/.test(t.text)));
});

test('... only ONCE per idea: when the second draft fails too the idea is thrown away and the next idea goes on', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 11);                                   // both drafts of the first idea (1 + 4, 1 + 4 checks) are blocked
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 2);
  assert.deepEqual((await q('SELECT status FROM articles ORDER BY created_at')).map((x) => x.status), ['archived', 'archived', 'published']); assert.equal(w.m.byRole('write').length, 3);
});

test('... and not for what no new draft can cure: a person-only problem of the IDEA (here the owner keeps the subject-level warning for a person) is dropped at once, one draft per idea', opts, async () => {
  const w = await world(); const { pid } = w; let n = 0; w.m.st.override.review = () => { n++; if (n === 1) return SENSITIVE; delete w.m.st.override.review; return undefined; };
  await turnOn(pid); await PL.setConfig(pid, { acceptSubjectWarning: false }); await run(w, D0);
  assert.equal(w.m.byRole('write').length, 2, 'one draft for the first idea (no second try), one for the next idea'); assert.equal((await q1('SELECT attempt FROM pipeline_runs')).attempt, 2);
});

test('a writer that fails WITHOUT a draft (unreadable answers) gets a second try with the other vendor before the idea is dropped', opts, async () => {
  const w = await world(); const { pid } = w; let n = 0; w.m.st.override.write = () => { n++; if (n === 2) delete w.m.st.override.write; return 'this is not json at all'; };            // the first two answers (the writer asks twice) are unreadable, from the third on the default writer answers
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 1);
  assert.ok(d.trail.some((t) => /Taslak çıkmadı/.test(t.text))); assert.equal(wp.posts.size, 1);
});

test('Apify\'s daily run limit no longer means waiting for hours: ONE run serves the first ideas of the category, and when the limit is hit anyway a FRESH news idea goes on by the news lane (real SERP, no volume); with the switch off the line waits', opts, async () => {
  const w = await world({ noVolume: /chatgpt|openai/ }); await turnOn(w.pid); await run(w, D0);
  assert.equal(w.apify.asked().length, 1, 'ONE actor run asked for the keywords of both ideas (the first has no data, the second does): the second idea cost no run of its own');
  assert.equal((await q1('SELECT attempt FROM pipeline_runs')).attempt, 2);
  await H.clean(); await wp.close(); wp = await startFakeWp();
  const w2 = await world({ freshHours: 36 }); w2.apify.state.freeLimit = true; await turnOn(w2.pid); await run(w2, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text)));
  assert.ok(d.trail.some((t) => /taze haber hattıyla devam ediliyor/.test(t.text)) && d.trail.some((t) => /^Uygun \(hacim verisi olmadan/.test(t.text))); assert.equal(wp.posts.size, 1);
  await H.clean(); await wp.close(); wp = await startFakeWp();
  const w3 = await world({ freshHours: 36 }); w3.apify.state.freeLimit = true; await turnOn(w3.pid); await PL.setConfig(w3.pid, { newsFallback: false }); await run(w3, D0);
  const r = await PL.openRun(w3.pid); assert.equal(r.status, 'waiting'); assert.match(r.note, /ücretsiz planında günlük 5 çalıştırma/); assert.equal(wp.posts.size, 0);
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
  assert.ok(d.trail.some((t) => /^Uygun \(tam puan\): fırsat puanı \d+/.test(t.text)), 'the suitability step said yes with a real score'); assert.equal(wp.posts.size, 1);
});

test('Apify\'s free plan gives 5 runs a day: when the actor answers with nothing and its log says so, the cycle WAITS for the reset (00:05 UTC) - it neither burns ideas nor retries - and goes on after it', opts, async () => {
  const w = await world(); const { pid } = w; w.apify.state.freeLimit = true;
  await turnOn(pid); await run(w, D0);
  const r = await PL.openRun(pid); assert.equal(r.status, 'waiting', r.note); assert.equal(r.step, 'idea', 'nothing could go on: every idea waits for the data (put aside, none thrown away)'); assert.match(r.note, /ücretsiz planında günlük 5 çalıştırma/); assert.equal(r.attempt, 1, 'no idea was thrown away for it');
  assert.equal(new Date(r.waitUntil).toISOString(), '2026-11-24T00:05:00.000Z', 'the next 00:05 UTC');
  assert.equal(w.apify.asked().length, 1, 'ONE call was spent finding out');
  await run(w, plus(D0, 600)); assert.equal(w.apify.asked().length, 1, 'nothing is asked again before the reset');
  w.apify.state.freeLimit = false;
  await run(w, new Date('2026-11-24T00:10:00Z')); assert.equal((await q1('SELECT status FROM pipeline_runs')).status, 'done'); assert.equal(wp.posts.size, 1);
});

/** the old way of working, before the line: the news scanned and the keywords asked for by hand (what a pile of earlier research looks like); `skip` keeps some ideas without data */
async function preseed(w, skip = /^$/) {
  const KW = require('../../src/content/services/keywords');
  await N.runDiscovery(w.pid, { trigger: 'manual', userId: null, fetchImpl: w.ctx.newsFetch, now: D0, gapMs: 0, force: false }); await O.refresh(w.pid, { trigger: 'manual', userId: null, now: D0 });
  const ids = (await q('SELECT k.id, o.title FROM keywords k JOIN content_opportunities o ON o.topic_id = k.topic_id')).filter((r) => !skip.test(r.title)).map((r) => r.id);
  await KW.fetchMetrics(w.pid, { ids, manual: true, trigger: 'manual', userId: null, fetchImpl: w.ctx.fetchImpl, now: D0 }); await O.refresh(w.pid, { trigger: 'manual', userId: null, now: D0 });
  return ids.length;
}

test('Apify\'s limit never stops an idea that ALREADY has volume data: the new Google keywords just have no volume, the line goes on with the data it has (no waiting until 03:00)', opts, async () => {
  const w = await world({ suggest: { '*': ['openai pricing plans 2026', 'openai chatgpt plus price increase'] } }); assert.ok(await preseed(w) > 3); w.apify.state.freeLimit = true;
  await turnOn(w.pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(wp.posts.size, 1);
  assert.ok(d.trail.some((t) => /aranma verisi zaten var, onunla devam ediliyor/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
});

test('Apify\'s limit with an idea that has NO volume data: the idea is put aside (not thrown away) and the cycle takes the next idea that already has its data; it waits for the reset only when none can go on', opts, async () => {
  const w = await world(); await preseed(w, /openai|chatgpt/i); w.apify.state.freeLimit = true;
  await turnOn(w.pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(wp.posts.size, 1);
  assert.ok(d.trail.some((t) => /fikir kuyrukta bırakıldı, verisi hazır başka fikre geçiliyor/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
  assert.equal(d.attempt, 1, 'putting an idea aside is not a failed try'); assert.ok(!/openai|chatgpt/i.test(d.result.title), `the article is about an idea with data: ${d.result.title}`);
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

test('keywords are no longer single names: Google\'s own suggestions are added once per idea and the focus keyword is a multi-word phrase that holds the name (and has volume when there is some)', opts, async () => {
  const w = await world({ suggest: { '*': ['openai pricing plans 2026', 'openai chatgpt plus price increase', 'how to cancel'] } }); const { pid } = w;
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text)));
  assert.ok(d.trail.some((t) => /Google önerilerinden \d+ zengin anahtar kelime eklendi/.test(t.text)), 'the suggestions were added'); assert.equal(w.serper.calls.filter((c) => /autocomplete$/.test(c.url)).length, 1, 'one Serper credit for the idea');
  const fk = (await q1('SELECT focus_keyword FROM articles')).focus_keyword; assert.ok(fk.split(' ').length >= 3 && /openai/.test(fk) && !/'/.test(fk), `the focus keyword is a phrase: "${fk}"`);
  assert.ok(d.trail.some((t) => /Odak anahtar kelime seçildi: “/.test(t.text)));
});

test('the SERP analysis is NOT required: when Serper fails (or its limit is used up) the cycle goes on without it, judged on the parts that are real, and publishes', opts, async () => {
  const w = await world(); const { pid } = w; w.serper.state.status = 500;
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.ok(d.trail.some((t) => /SERP atlandı \(zorunlu değil\)/.test(t.text)));
  assert.ok(d.trail.some((t) => /^Uygun \(SERP verisi olmadan/.test(t.text))); assert.equal(wp.posts.size, 1);
});

test('the minimum length (950 words): the writer is told, a shorter draft is blocked by readiness (and worked on by the fix bot), and the number is the owner\'s to change', opts, async () => {
  const w = await world(); const { pid } = w; w.m.st.long = false;                                          // the fake writer's drafts have ~570 words
  await turnOn(pid); await run(w, D0);
  assert.match(w.m.byRole('write')[0].system, /AT LEAST 950 words/, 'the writer prompt carries the minimum');
  assert.equal(wp.posts.size, 0, 'a 570-word draft is not published'); const art = await q('SELECT word_count, status FROM articles'); assert.ok(art.length > 0 && art.every((x) => x.word_count < 950));
  assert.ok((await q1('SELECT trail FROM pipeline_runs')).trail.some((t) => /en az 950 gerekli/.test(t.text)), 'the reason is told in words');
  await H.clean(); await wp.close(); wp = await startFakeWp();
  const w2 = await world(); w2.m.st.long = false; await turnOn(w2.pid, { minWords: 500 }); await run(w2, D0);
  assert.equal(wp.posts.size, 1, 'with the minimum at 500 the same draft goes out'); assert.equal((await S.get('pipeline', w2.pid)).value.minWords, 500);
});

test('the AdSense fix bot is a bot of its own in the registry (it runs inside the line) and a line that is on gets the places its rounds need', opts, async () => {
  const BO = require('../../src/content/services/bots'); assert.ok(BO.BOTS.some((b) => b.key === 'adsense_fixer') && BO.IMPLEMENTED.has('adsense_fixer'));
  const w = await world(); await turnOn(w.pid); const fix = (await L.status({ projectId: w.pid })).items.find((i) => i.workType === 'article_fix'); assert.ok(fix.limit >= 12, `article_fix places: ${fix.limit}`);
});

test('migration 0024 raises a project\'s own article_fix limit to what the pace needs, never lowers it, and leaves a project with the line off alone', opts, async () => {
  const w = await world(); await turnOn(w.pid, { everyMinutes: 480 });
  const db = H.db(); const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/content/migrations/0024_pipeline_fix_places_project.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const setP = (n) => db.query("INSERT INTO daily_work_limits (scope, project_id, category_id, work_type, max_per_day) VALUES ('project', $1, NULL, 'article_fix', $2) ON CONFLICT (scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid), work_type) DO UPDATE SET max_per_day = $2", [w.pid, n]);
  const getP = async () => (await db.query("SELECT max_per_day FROM daily_work_limits WHERE scope = 'project' AND project_id = $1 AND work_type = 'article_fix'", [w.pid])).rows[0].max_per_day;
  await setP(10); await db.query(sql); assert.equal(await getP(), 28, '3 cycles a day x 8 rounds + 4');
  await setP(60); await db.query(sql); assert.equal(await getP(), 60, 'a higher value of the owner stays');
  await setP(10); await db.query("UPDATE automation_settings SET value = jsonb_set(value, '{enabled}', 'false') WHERE key = 'pipeline' AND project_id = $1", [w.pid]); await db.query(sql); assert.equal(await getP(), 10, 'a project with the line off is left alone');
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
