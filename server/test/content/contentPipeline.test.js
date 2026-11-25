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
async function world({ noVolume = /^$/, items = ITEMS, freshHours = 0, suggest = {}, noApify = false, onlyGroq = false } = {}) {
  const pid = (await P.seedDefault()).projectId;
  if (!onlyGroq) { await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789', extra: { inputPricePerM: '3', outputPricePerM: '15' } });
    await PR.save('openai', { secret: 'sk-test-key-0123456789abcdef', extra: { model: 'gpt-test', inputPricePerM: '1', outputPricePerM: '4' } }); }
  else await PR.save('groq', { secret: 'gsk_testkey0123456789abcdef0123', extra: { inputPricePerM: '0.59', outputPricePerM: '0.79' } });
  if (!noApify) await PR.save('apify', { secret: 'apify_api_testtoken0123456789' }); await PR.save('serper', { secret: 'serper-test-key-0123456789' });
  const site = await SI.create(pid, { name: 'Tech Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); assert.equal((await SI.test(site.id)).ok, true);
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await H.db().query('UPDATE niche_profiles SET min_opportunity_score = 30 WHERE project_id = $1', [pid]); await H.db().query('UPDATE categories SET min_opportunity_score = NULL');
  await S.set('quality', { ...(await S.get('quality')).value, minScore: 50 }, { scope: 'global' }); await S.set('seo', { ...(await S.get('seo')).value, freshHours }, { scope: 'global' });
  const volumes = new Proxy({}, { get: (_, k) => (typeof k !== 'string' ? undefined : (noVolume.test(k) ? { none: true } : { volume: 5400, cpc: 1.2, comp: 0.4, kd: 35 })), has: () => true });
  const apify = fakeApify({ volumes }); const serper = fakeSerper({ '*': ['smallblog.example', 'nichesite.example', 'tinydocs.example', 'devnotes.example', 'forum.example'] }, suggest);
  const m = fakeModels(); m.st.long = true;                                                       // drafts of more than 1200 words: the line's minimum length
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

test('an idea whose keyword has NO volume data goes on all the same (owner: the volume number is a bonus, Apify is never required): it is judged on the parts that are real, written and published, nothing is thrown away', opts, async () => {
  const w = await world({ noVolume: /chatgpt|openai/ }); const { pid } = w;
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4))); assert.equal(d.attempt, 1, 'the first idea itself was written');
  assert.ok(d.trail.some((t) => /Aranma hacmi verisi yok.*zorunlu değil/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
  assert.ok(!d.trail.some((t) => /Fikir elendi/.test(t.text)), 'nothing was thrown away'); assert.equal(w.apify.asked().length, 1, 'ONE actor run asked for the keywords of the first ideas');
  assert.match((await q1('SELECT h1 FROM articles')).h1, /openai|chatgpt/i, 'the article is about the idea that had no volume data'); assert.equal(wp.posts.size, 1);
});

test('with the owner\'s switch OFF an article the checks cannot clear and only a person could decide (a sensitive subject) is archived, its idea is thrown away, and the cycle starts again with the next idea and publishes THAT', opts, async () => {
  const w = await world(); const { pid } = w; let reviews = 0;
  const sensitive = { categories: Object.fromEntries(['originality', 'user_value', 'source_accuracy', 'hallucination', 'copyright', 'keyword_stuffing', 'misleading_title', 'spam', 'low_value_auto', 'sensitive', 'ad_restrictions', 'image_rights', 'integrity'].map((k) => [k, k === 'sensitive' ? { status: 'warn', note: 'A data-breach story needs careful sourcing.' } : { status: 'pass', note: '' }])), risk: 'review', ratings: { originality: 82, usefulness: 80, editorial: 84 }, improvements: [], summary: 'Fine, but sensitive.' };
  w.m.st.override.review = () => { reviews++; if (reviews === 1) return sensitive; delete w.m.st.override.review; return undefined; };          // sensitive for the first article, the default (low) reviewer from then on
  await turnOn(pid, { adsenseCheck: true }); await PL.setConfig(pid, { acceptSubjectWarning: false });                              // the owner's switch OFF: such a warning stays a person's decision
  await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note); assert.equal(d.attempt, 2);
  assert.ok(d.trail.some((t) => /Fikir elendi: Bir kişinin kararı gerekiyor/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
  const arts = await q('SELECT status FROM articles ORDER BY created_at'); assert.deepEqual(arts.map((a) => a.status), ['published'], 'the draft that could not be cleared is DELETED (nothing piles up in the archive), the next one went live');
  assert.equal(wp.posts.size, 1);
});

const SENSITIVE = { categories: Object.fromEntries(['originality', 'user_value', 'source_accuracy', 'hallucination', 'copyright', 'keyword_stuffing', 'misleading_title', 'spam', 'low_value_auto', 'sensitive', 'ad_restrictions', 'image_rights', 'integrity'].map((k) => [k, k === 'sensitive' ? { status: 'warn', note: 'A data-breach story needs careful sourcing.' } : { status: 'pass', note: '' }])), risk: 'review', ratings: { originality: 82, usefulness: 80, editorial: 84 }, improvements: [], summary: 'Fine, but sensitive.' };

test('a SUBJECT-level AdSense warning is no longer left to a person (the owner\'s decision): the line rewrites the text neutrally ONCE, then accepts the warning itself, approves and publishes; the class is not rewritten and the acceptance says who did it', opts, async () => {
  const w = await world(); const { pid } = w; w.m.st.override.review = SENSITIVE;                          // the reviewer keeps flagging the subject, whatever the wording
  await turnOn(pid, { adsenseCheck: true }); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 1, 'no idea was thrown away for it');
  const a = await q1('SELECT status, adsense_risk, adsense_accepted_risk, adsense_accepted_note FROM articles');
  assert.equal(a.status, 'published'); assert.equal(a.adsense_risk, 'review', 'the reviewer\'s class stays what it said'); assert.equal(a.adsense_accepted_risk, 'review'); assert.match(a.adsense_accepted_note, /Otomatik Üretim: sahibinin izniyle/);
  assert.equal(w.m.byRole('fix').length, 1, 'ONE neutral rewrite was asked for (and its prompt names the subject)'); assert.match(w.m.byRole('fix')[0].user, /SUBJECT of the article as sensitive/);
  assert.equal((await q1("SELECT count(*)::int n FROM audit_logs WHERE action = 'article.adsense_accept_auto'")).n, 1, 'said in the audit log'); assert.equal(wp.posts.size, 1);
  assert.ok(d.trail.some((t) => /sahibin izniyle hat tarafından kabul edildi/.test(t.text)));
});

test('... and when the rewrite is enough the warning is simply gone: nothing is accepted', opts, async () => {
  const w = await world(); const { pid } = w; let n = 0; w.m.st.override.review = () => { n++; if (n === 1) return SENSITIVE; delete w.m.st.override.review; return undefined; };
  await turnOn(pid, { adsenseCheck: true }); await run(w, D0);
  await dbg('rewrite-is-enough'); assert.equal((await q1('SELECT status FROM pipeline_runs')).status, 'done'); const a = await q1('SELECT status, adsense_risk, adsense_accepted_at FROM articles');
  assert.deepEqual([a.status, a.adsense_risk, a.adsense_accepted_at], ['published', 'low', null]);
});

const BLOCKED = { ...SENSITIVE, risk: 'blocked', categories: { ...SENSITIVE.categories, sensitive: { status: 'pass', note: '' }, copyright: { status: 'fail', note: 'Copied.' } } };
/** the reviewer calls the first `k` reviews "blocked" (the writer's own check + the fix bot's re-checks), then the default reviewer answers */
const blockedFor = (m, k) => { let n = 0; m.st.override.review = () => { n++; if (n >= k) delete m.st.override.review; return BLOCKED; }; };

test('the AdSense FIX BOT works a draft the reviewer called "blocked" over (a text-level class is cured by a new text, never accepted): the idea is NOT lost', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 2);                                    // the writer\'s check says blocked, the first re-check (after the bot\'s rewrite) says fine
  await turnOn(pid, { adsenseCheck: true }); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 1);
  assert.deepEqual((await q('SELECT status FROM articles')).map((x) => x.status), ['published']); assert.ok(w.m.byRole('fix').length >= 1, 'the bot rewrote the text');
  assert.ok(d.trail.some((t) => /Düzeltme Botu devrede/.test(t.text))); assert.equal((await q1("SELECT count(*)::int n FROM articles WHERE adsense_accepted_at IS NOT NULL")).n, 0, 'a blocked class was not accepted');
  assert.equal((await q1("SELECT count(*)::int n FROM automation_runs WHERE bot_key = 'adsense_fixer'")).n, 1, 'the bot has its own run record');
});

test('when even the bot\'s 4 rounds cannot clear the draft the line tries ONCE more: a FRESH draft by the OTHER writer, told why the first one failed; only then the first one is archived', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 6);                                    // writer check + 4 bot re-checks blocked; the second draft is judged by the default reviewer
  await turnOn(pid, { adsenseCheck: true }); await run(w, D0); await dbg('redo');
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + ' ' + JSON.stringify(d.trail.map((t) => t.text).slice(-6))); assert.equal(d.attempt, 1, 'the SAME idea was written again');
  assert.deepEqual((await q('SELECT status FROM articles ORDER BY created_at')).map((x) => x.status), ['published'], 'the failed first draft is deleted, no archive pile');
  const writes = w.m.byRole('write'); assert.equal(writes.length, 2); assert.notEqual(writes[0].vendor, writes[1].vendor, 'another writer for the second draft'); assert.match(writes[1].user, /A PREVIOUS DRAFT OF THIS ARTICLE WAS REJECTED/); assert.doesNotMatch(writes[0].user, /PREVIOUS DRAFT/);
  assert.ok(d.trail.some((t) => /Fikir elenmeden önce yeniden deneniyor/.test(t.text)));
});

test('... only as many drafts per idea as the owner chose: when the last draft fails too the idea is thrown away and the next idea goes on', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 11);                                   // both drafts of the first idea (1 + 4, 1 + 4 checks) are blocked
  await turnOn(pid, { maxDrafts: 2, adsenseCheck: true }); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 2);
  assert.deepEqual((await q('SELECT status FROM articles ORDER BY created_at')).map((x) => x.status), ['published'], 'both failed drafts are deleted'); assert.equal(w.m.byRole('write').length, 3);
});

test('the line does not give up on the idea it found (owner): with 5 drafts allowed the 4th draft of the SAME idea is published, every failed draft is told to the next writer and deleted, nothing piles up', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 15);                                   // drafts 1-3 (1 + 4 checks each) are blocked, the 4th is judged fine
  await turnOn(pid, { adsenseCheck: true }); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + ' ' + JSON.stringify(d.trail.map((t) => t.text).slice(-8))); assert.equal(d.attempt, 1, 'the SAME idea all the way');
  assert.deepEqual((await q('SELECT status FROM articles')).map((x) => x.status), ['published'], 'no archive pile'); const writes = w.m.byRole('write'); assert.equal(writes.length, 4);
  assert.match(writes[3].user, /EARLIER DRAFTS FAILED ON/, 'the later writers hear about the earlier failures'); assert.notEqual(writes[2].vendor, writes[3].vendor, 'the writers take turns');
  assert.equal(await usedOf('new_article', 'global'), 1, 'and only the shared article is counted'); assert.equal(wp.posts.size, 1);
});

const usedOf = async (type, scope) => (await q1("SELECT coalesce(sum(used), 0)::int n FROM daily_work_usage WHERE work_type = $1 AND scope = $2 AND day = '2026-11-23'", [type, scope])).n;

test('the day\'s counts grow only for what is SHARED (owner): drafts the line throws away give their new-article place and their fixing rounds back, so a day of failed drafts never fills the limit', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 11);                                   // both drafts of the first idea are thrown away, the next idea is published
  await turnOn(pid, { maxDrafts: 2, adsenseCheck: true }); await run(w, D0);
  assert.deepEqual((await q('SELECT status FROM articles ORDER BY created_at')).map((x) => x.status), ['published']); assert.equal(w.m.byRole('write').length, 3, 'three drafts were written');
  for (const scope of ['global', 'project', 'category']) assert.equal(await usedOf('new_article', scope), 1, `new_article (${scope}): one place for the ONE shared article`);
  const own = (await q1("SELECT count(*)::int n FROM article_fixes f JOIN articles a ON a.id = f.article_id WHERE f.calls > 0 AND a.status = 'published'")).n;
  assert.equal(await usedOf('article_fix', 'project'), own, 'only the rounds of the shared article stay counted');
});

test('migration 0025 brings the day\'s counts down to the articles that exist (a number that is too high is lowered, a true number is never raised), and leaves other work kinds alone', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 11); await turnOn(pid); await run(w, D0);
  const db = H.db(); await db.query("UPDATE articles SET created_at = '2026-11-23T10:30:00Z'"); await db.query("UPDATE article_fixes SET created_at = '2026-11-23T10:30:00Z'");      // the test clock is the 23rd, the database's own is not
  await db.query("UPDATE daily_work_usage SET used = 10 WHERE work_type IN ('new_article', 'article_fix') AND day = '2026-11-23'");
  await db.query("INSERT INTO daily_work_usage (day, work_type, scope, used) VALUES ('2026-11-23', 'serp_queries', 'global', 7) ON CONFLICT DO NOTHING"); await db.query("UPDATE daily_work_usage SET used = 7 WHERE work_type = 'serp_queries' AND day = '2026-11-23'");
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/content/migrations/0025_places_follow_shared.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  await db.query(sql.replace(/now\(\) AT TIME ZONE 'Europe\/Istanbul'/g, "'2026-11-23T12:00:00Z'::timestamptz AT TIME ZONE 'Europe/Istanbul'").replace(/now\(\) - interval '3 days'/g, "'2026-11-01'::timestamptz"));
  for (const scope of ['global', 'project', 'category']) assert.equal(await usedOf('new_article', scope), 1, `new_article (${scope})`);
  const own = (await q1("SELECT count(*)::int n FROM article_fixes f JOIN articles a ON a.id = f.article_id WHERE f.calls > 0 AND a.status = 'published'")).n;
  assert.equal(await usedOf('article_fix', 'project'), Math.min(10, own)); assert.equal(await usedOf('serp_queries', 'global'), 7, 'other kinds are not touched');
  await db.query(sql.replace(/now\(\) AT TIME ZONE 'Europe\/Istanbul'/g, "'2026-11-23T12:00:00Z'::timestamptz AT TIME ZONE 'Europe/Istanbul'").replace(/now\(\) - interval '3 days'/g, "'2026-11-01'::timestamptz")); assert.equal(await usedOf('new_article', 'global'), 1, 'a second run changes nothing');
});

test('migration 0026 removes the drafts the line archived before (AI-written, made after the line first ran, never sent) and nothing else', opts, async () => {
  const w = await world(); await turnOn(w.pid); await run(w, D0); const db = H.db();
  const copy = async (status, extra = {}) => { const n = (await q1('SELECT count(*)::int n FROM articles')).n; await db.query(`INSERT INTO articles SELECT (jsonb_populate_record(NULL::articles, to_jsonb(a) || $1::jsonb)).* FROM articles a WHERE a.status = 'published' LIMIT 1`, [JSON.stringify({ id: require('node:crypto').randomUUID(), status, slug: `copy-${n}`, h1: `Copy ${n}`, focus_keyword: `copy keyword ${n}`, ...extra })]); return (await q1('SELECT id FROM articles WHERE h1 = $1', [`Copy ${n}`])).id; };
  const gone = await copy('archived'); const human = await copy('archived', { created_by: 'manual' }); const old = await copy('archived', { created_at: '2026-01-01T00:00:00Z' }); const sent = await copy('archived');
  await db.query("INSERT INTO publications SELECT (jsonb_populate_record(NULL::publications, to_jsonb(p) || $1::jsonb)).* FROM publications p WHERE p.status = 'published' LIMIT 1", [JSON.stringify({ id: require('node:crypto').randomUUID(), article_id: sent, wp_post_id: 999 })]);
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/content/migrations/0026_clear_archived_drafts.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  await db.query(sql); const left = new Set((await q('SELECT id FROM articles')).map((r) => r.id));
  assert.ok(!left.has(gone), 'the line\'s archived draft is gone'); assert.ok(left.has(human), 'one written by a person stays'); assert.ok(left.has(old), 'older than the line stays');
  assert.equal((await q1("SELECT count(*)::int n FROM articles WHERE status = 'published'")).n, 1, 'the published article stays'); assert.ok(left.has(sent), 'one that was sent to WordPress stays');
});

const CK = require('../../src/content/services/checks');
const SENSITIVE_R = () => ({ ratings: { originality: 80, usefulness: 80, editorial: 80 }, adsenseRisk: 'review', adsense: { risk: 'review', reasons: ['Hassas içerik'] } });

test('AdSense does not stand in the way of publishing (owner): a sensitive or "blocked" class from the reviewer is only shown, the line publishes the first draft, nothing is accepted on anyone\'s behalf', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 99);                                   // the reviewer says "blocked" on EVERY check
  await turnOn(pid); assert.equal((await S.get('pipeline', pid)).value.adsenseCheck, false, 'the check is off by default');
  await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + ' ' + JSON.stringify(d.trail.map((t) => t.text).slice(-6))); assert.equal(d.attempt, 1); assert.equal(wp.posts.size, 1);
  const a = await q1('SELECT status, adsense_risk, adsense_accepted_risk FROM articles'); assert.equal(a.status, 'published'); assert.equal(a.adsense_risk, 'blocked', 'the class is still recorded and shown'); assert.equal(a.adsense_accepted_risk, null, 'nobody "accepted" it');
  const r = await require('../../src/content/services/articles').readiness((await q1('SELECT id FROM articles')).id); assert.ok(r.problems.some((p) => p.code === 'adsense_info' && p.blocking === false), 'shown as information');
  assert.equal((await q('SELECT 1 FROM audit_logs WHERE action = $1', ['article.adsense_accept_auto'])).length, 0);
});

test('with the owner\'s switch ON ("AdSense kontrolü yayını engellesin") the old gate is back; the old flows (fix bot, redo, accepting the subject warning) work as before', opts, async () => {
  const w = await world(); const { pid } = w; blockedFor(w.m, 2);
  await turnOn(pid, { adsenseCheck: true }); assert.equal((await S.get('pipeline', pid)).value.adsenseCheck, true);
  await run(w, D0); const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text).slice(-6)));
  assert.ok(d.trail.some((t) => /Düzeltme Botu devrede/.test(t.text)), 'the bot worked on the blocked class');
});

test('the writer does its OWN research while the line is on: Google\'s questions and related searches go into the prompt, the pages of other publishers join the sources (the fact check can rest on them), the prompt carries E-E-A-T and Rank Math rules and the minimum length', opts, async () => {
  const w = await world(); const { pid } = w; await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note); const wr = w.m.byRole('write')[0];
  assert.match(wr.system, /E-E-A-T/); assert.match(wr.system, /Rank Math checklist/); assert.match(wr.system, /AT LEAST 1200 words/); assert.match(wr.user, /YOUR OWN RESEARCH/); assert.match(wr.user, /PEOPLE ALSO ASK[^\n]*Is it worth it\?/); assert.match(wr.user, /RELATED SEARCHES[^\n]*chatgpt plus cost/);
  const srcs = await q('SELECT publisher FROM article_sources'); assert.ok(srcs.some((s) => /\.example$/.test(s.publisher) && /smallblog|nichesite|tinydocs|devnotes/.test(s.publisher)), `research pages joined the sources: ${srcs.map((s) => s.publisher).join(', ')}`);
  assert.equal((await q1('SELECT generation->>\'promptVersion\' v FROM articles')).v, 'w6');
});

test('Rank Math\'s remaining on-page tests are in the free rules: the focus keyword in the slug and in a sub-heading', opts, async () => {
  const base = { focusKeyword: 'staples canada data breach', seoTitle: 'Staples Canada Data Breach: What to Know', h1: 'Staples Canada Data Breach', metaDescription: 'x'.repeat(100), contentHtml: '<p>Staples Canada data breach news.</p><h2>What happened</h2><p>Text here.</p><h2>What to do</h2><p>More.</p>' };
  const good = CK.ruleReport({ ...base, slug: 'staples-canada-data-breach-what-to-know', contentHtml: base.contentHtml.replace('What happened', 'The Staples Canada data breach explained') });
  assert.equal(good.items.find((i) => i.key === 'focus_slug').status, 'ok'); assert.equal(good.items.find((i) => i.key === 'focus_subheading').status, 'ok');
  const bad = CK.ruleReport({ ...base, slug: 'retailer-news' });
  assert.equal(bad.items.find((i) => i.key === 'focus_slug').status, 'warn'); assert.equal(bad.items.find((i) => i.key === 'focus_subheading').status, 'warn'); assert.ok(bad.scores.seo < good.scores.seo);
  assert.ok(!CK.ruleReport(base).items.some((i) => i.key === 'focus_slug'), 'an article object without a slug is not judged on it');
});

test('other ideas found the same day that share two names with the main idea are blended in as extra sections (their own pages become sources); an unrelated idea is never added', opts, async () => {
  const items = [['OpenAI raises ChatGPT Plus price for subscribers', 1], ['ChatGPT free users get new OpenAI voice limits this week', 2], ['Windows 11 KB5132057 update causes problems for some users', 3]];
  const w = await world({ items }); const { pid } = w; await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-5)));
  const wr = w.m.byRole('write')[0]; assert.match(wr.user, /RELATED STORIES FROM TODAY'S RESEARCH/); assert.match(wr.user, /voice limits/i, 'the related story is offered'); assert.doesNotMatch(wr.user, /RELATED STORIES[\s\S]*Windows 11/, 'an idea that shares no two names is not offered');
  assert.match(wr.system, /Related stories/); const n = (await q1('SELECT count(*)::int n FROM article_sources')).n; assert.ok(n >= 3, `the related story\'s pages joined the sources (${n})`);
});

test('Rank Math\'s mechanical tests are put right in code: a 91-character link is cut to the focus keyword, and the cover picture\'s alt text always holds the exact focus keyword; the title tests (keyword first, number, strong word) and a low density are in the free rules', opts, async () => {
  const w = await world(); const { pid } = w; await turnOn(pid);
  w.m.st.override.write = (user) => { const base = w.m.defaults.write(user); base.slug = 'a-very-long-slug-that-goes-on-and-on-about-the-subscription-price-change-of-the-chatgpt-plus-plan-in-detail'; base.image = { prompt: 'a calm scene', alt: 'A calm desk with a laptop and a coffee cup', query: 'desk' }; return base; };
  await run(w, D0); const a = await q1('SELECT slug, focus_keyword FROM articles WHERE status = \'published\'');
  assert.ok(a && a.slug.length <= 60 && a.slug.includes(a.focus_keyword.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')), `slug: ${a && a.slug}`);
  const alt = (await q1('SELECT alt FROM article_images LIMIT 1')); if (alt) assert.match(alt.alt.toLowerCase(), new RegExp(a.focus_keyword.toLowerCase().split(' ')[0]), `alt: ${alt.alt}`);
  const base = { focusKeyword: 'staples canada data breach', metaDescription: 'x'.repeat(100), h1: 'Staples Canada Data Breach', slug: 'staples-canada-data-breach', contentHtml: `<p>${'Words about something else entirely. '.repeat(120)}Staples Canada data breach.</p><h2>The Staples Canada data breach</h2><p>More.</p>` };
  const good = CK.ruleReport({ ...base, seoTitle: 'Staples Canada Data Breach: 5 Key Facts, Explained' }); const bad = CK.ruleReport({ ...base, seoTitle: 'What happened at the retailer' });
  for (const k of ['title_start', 'title_number', 'title_power']) { assert.equal(good.items.find((i) => i.key === k).status, 'ok', k); assert.equal(bad.items.find((i) => i.key === k).status, 'warn', k); }
  assert.equal(good.items.find((i) => i.key === 'density').status, 'warn', 'two mentions in 600+ words is below 0.5%'); assert.ok(bad.scores.seo < good.scores.seo + 1);
  assert.ok(CK.ruleReport({ ...base, slug: 'x'.repeat(91), seoTitle: 'a' }).items.some((i) => i.key === 'slug_length'));
});

const SN = require('../../src/content/services/sensitive');

test('Sensitive Content Bot: it finds a data breach, ransomware, personal data in the text, a scam, minors, health data; says what and where; plain text gives nothing', opts, async () => {
  const t = SN.scanText('Hackers stole customer records in a data breach at the retailer. The ransomware gang sent a ransom note and demanded a payment. Call 555-123-4567 or write john@example.com. Children data was exposed in the leak. Patients were told to watch for phishing. A quiet paragraph about camera batteries.');
  const kinds = t.map((x) => x.kind); for (const k of ['data_breach', 'ransomware', 'personal_data', 'minors', 'health', 'phishing_scam']) assert.ok(kinds.includes(k), `${k} found in ${kinds}`);
  assert.equal(t[0].severity, 'high', 'the serious ones come first'); assert.match(t.find((x) => x.kind === 'ransomware').snippet, /ransom/i); assert.ok(t.find((x) => x.kind === 'personal_data').what.includes('e-posta adresi'));
  assert.deepEqual(SN.scanText('A plain article about a new phone camera, its battery life and the price. Nothing risky is said here.'), []); assert.equal(SN.scanText('Card 4111 1111 1111 1111 was shown').find((x) => x.kind === 'personal_data').count, 1, 'a card-shaped number that passes the check digit test');
  assert.deepEqual(SN.scanText('Order number 1234 5678 9012 3456 was shipped'), [], 'a long number that is not a card number is not personal data');
});

test('Sensitive Content Bot: one scan per text version, a new version is scanned again, the owner is told ONCE per kind (a quiet rescan says nothing), the editor list shows it as information that never blocks, and the scheduled bot finds unscanned articles', opts, async () => {
  const w = await world(); const { pid } = w; await turnOn(pid); await run(w, D0); const aid = (await q1('SELECT id FROM articles')).id; await H.db().query('DELETE FROM sensitive_findings'); await H.db().query('DELETE FROM notifications');
  const A = require('../../src/content/services/articles'); const db = H.db();
  assert.equal((await SN.scanArticle(aid)).kinds.length, 0, 'the fake article is plain'); assert.equal((await SN.scanArticle(aid)).scanned, false, 'the same version is not scanned twice');
  await db.query("UPDATE articles SET content_html = content_html || '<p>The retailer confirmed a ransomware attack and a data breach that exposed customer data.</p>', current_version = current_version + 1 WHERE id = $1", [aid]);
  const r = await SN.scanArticle(aid); assert.equal(r.scanned, true); assert.deepEqual(r.notified.sort(), ['data_breach', 'ransomware']); assert.equal((await q("SELECT 1 FROM notifications WHERE type = 'sensitive_found'")).length, 1);
  await db.query("UPDATE articles SET content_html = content_html || '<p>More words.</p>', current_version = current_version + 1 WHERE id = $1", [aid]); assert.deepEqual((await SN.scanArticle(aid)).notified, [], 'a rescan of the same kinds does not speak again'); assert.equal((await q("SELECT 1 FROM notifications WHERE type = 'sensitive_found'")).length, 1);
  const ready = await A.readiness(aid); const info = ready.problems.find((p) => p.code === 'sensitive_info'); assert.ok(info && info.blocking === false && /Veri ihlali/.test(info.message) && /Fidye yazılımı/.test(info.message), JSON.stringify(ready.problems.map((p) => p.code)));
  await db.query('DELETE FROM sensitive_findings'); const st = await SN.scanProject(pid); assert.deepEqual([st.scanned, st.withFindings], [1, 1]); assert.deepEqual(await SN.scanProject(pid), { scanned: 0, withFindings: 0, kinds: {} });
  const job = await SC.runNow('sensitive_scanner', pid, { now: D0 }); assert.ok(job); await db.query('DELETE FROM sensitive_findings'); const done = await SC.workOnce({ now: D0, ctx: w.ctx }); assert.deepEqual([done.botKey, done.outcome], ['sensitive_scanner', 'done']); assert.equal((await q("SELECT status FROM automation_runs WHERE bot_key = 'sensitive_scanner'")).length, 1, 'the Botlar page has a last run to show');
});

test('the line still PUBLISHES an article with a sensitive detail (the bot only shows it): the finding is made before publishing, the cycle says so, the card gets a badge, the owner a notification', opts, async () => {
  const w = await world(); const { pid } = w; await turnOn(pid);
  w.m.st.override.write = (user) => { const base = w.m.defaults.write(user); base.contentHtml += '<h2>What the company said</h2><p>The company confirmed a ransomware attack and a data breach that exposed customer records, and said an investigation is under way.</p>'; return base; };
  await run(w, D0); const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4))); assert.equal(wp.posts.size, 1, 'published all the same');
  assert.ok(d.trail.some((t) => /Sensitive Content Bot: .*Fidye yazılımı.* bulundu \(yayını engellemez\)/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
  const f = await q1('SELECT kinds, severity FROM sensitive_findings'); assert.ok(f.kinds.some((k) => k.kind === 'ransomware') && f.kinds.some((k) => k.kind === 'data_breach')); assert.equal((await q("SELECT 1 FROM notifications WHERE type = 'sensitive_found'")).length, 1);
  const ov = await PL.overview(pid); assert.ok(ov.recent[0].sensitive.includes('Fidye yazılımı') && ov.recent[0].sensitive.includes('Veri ihlali'), JSON.stringify(ov.recent[0]));
});

test('the NEXT writer is told exactly which claims the sources did not carry (and how many words short the draft was), not just "the checks failed"', opts, async () => {
  const w = await world(); const { pid } = w; let n = 0;
  w.m.st.override.fact = () => { n++; if (n > 5) { delete w.m.st.override.fact; return undefined; } return { claims: [{ claim: 'The company will refund every user in March', importance: 'major', verdict: 'unsupported', sourceIds: [], evidence: '', note: 'no source says this' }] }; };
  await turnOn(pid); await run(w, D0); const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-5))); assert.equal(d.attempt, 1, 'the same idea, a second draft');
  const writes = w.m.byRole('write'); assert.equal(writes.length, 2); assert.match(writes[1].user, /CLAIMS THE SOURCES DID NOT CARRY[^\n]*The company will refund every user in March/); assert.doesNotMatch(writes[0].user, /CLAIMS THE SOURCES DID NOT CARRY/);
});

test('a wait for a BUDGET ends the moment the owner raises or removes it (the cycle does not sit until tomorrow on a limit that is gone)', opts, async () => {
  const w = await world(); const { pid } = w; await S.set('budget', { dailyTotalUsd: 0.0000001, monthlyTotalUsd: null }, { scope: 'global' });
  await turnOn(pid); await run(w, D0); const r = await PL.openRun(pid); assert.equal(r.status, 'waiting', r.note); assert.match(r.note, /bütçe/i); assert.ok(new Date(r.waitUntil) > plus(D0, 600), 'the wait runs to tomorrow');
  await run(w, plus(D0, 3)); assert.equal((await PL.openRun(pid)).status, 'waiting', 'still waiting while the budget is full'); assert.equal(wp.posts.size, 0);
  await S.set('budget', { dailyTotalUsd: null, monthlyTotalUsd: null }, { scope: 'global' }); await run(w, plus(D0, 6));
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4))); assert.equal(wp.posts.size, 1); assert.ok(d.trail.some((t) => /Bütçe artık uygun/.test(t.text)));
});

test('the focus keyword is ABOUT the headline: it is built from the headline\'s names ("california openai"), the Google suggestions are asked for that phrase, and a suggestion that shares only one name ("california pizza kitchen") never wins', opts, async () => {
  assert.equal(PL.namePhrase('Google unveils Gemini 4 Hydrogen, its new AI model built for speed'), 'google gemini 4 hydrogen'); assert.equal(PL.namePhrase('California sues OpenAI over model security, public safety'), 'california openai');
  assert.equal(PL.namePhrase('WhatsApp scheduled messages feature rolling out for chats and groups'), null, 'one name is not a phrase'); assert.equal(PL.namePhrase('Staples Canada Data Breach: What Customers Should Know'), 'staples canada');
  const items = [['California sues OpenAI over ChatGPT model security', 1], ['Windows 11 KB5132057 update causes problems for some users', 3]];
  const w = await world({ items, suggest: { '*': ['california pizza kitchen menu', 'california pizza kitchen near me', 'california openai lawsuit what to know'] } }); const { pid } = w; await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4)));
  const fk = (await q1('SELECT focus_keyword FROM articles')).focus_keyword; assert.ok(/openai/.test(fk) && /california/.test(fk) && !/pizza/.test(fk), `focus keyword: "${fk}"`);
  assert.ok(w.serper.calls.some((c) => /autocomplete$/.test(c.url) && /california openai/.test(c.body.q)), 'the suggestions were asked for the headline\'s phrase: ' + JSON.stringify(w.serper.calls.filter((c) => /autocomplete$/.test(c.url)).map((c) => c.body.q)));
});

test('the cover picture\'s alt text always holds the focus keyword (a stock photo\'s own tags do not)', opts, async () => {
  const WR = require('../../src/content/services/writer');
  assert.equal(WR.altWithKeyword('Photo of coffee, winter, cafe', 'google gemini 4 hydrogen'), 'Google gemini 4 hydrogen: Photo of coffee, winter, cafe');
  assert.equal(WR.altWithKeyword('A desk with the google gemini 4 hydrogen model on a screen', 'google gemini 4 hydrogen'), 'A desk with the google gemini 4 hydrogen model on a screen', 'already holds it');
  assert.ok(WR.altWithKeyword('x'.repeat(300), 'staples canada').length <= 125);
});

test('Groq instead of Claude and OpenAI (owner: no credit for them): with ONLY a Groq key the line writes, checks, fixes and publishes - the one vendor does every job', opts, async () => {
  const w = await world({ onlyGroq: true }); const { pid } = w; const pre = await PL.prerequisites(pid); assert.equal(pre.ok, true, JSON.stringify(pre.items.map((i) => [i.key, i.ok])));
  await turnOn(pid); await run(w, D0); const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4))); assert.equal(wp.posts.size, 1);
  assert.ok(w.m.calls.length >= 3 && w.m.calls.every((c) => !c.vendor || c.vendor === 'groq' || c.role === 'models'), `every model call went to Groq: ${[...new Set(w.m.calls.map((c) => c.vendor))]}`);
  const a = await q1('SELECT generation FROM articles'); assert.equal(a.generation.provider, 'groq'); assert.equal(a.generation.independentChecker, false, 'one vendor: the check is not independent (said in the record)');
});

test('a vendor whose credit ran out is skipped by "Otomatik" for 3 hours: the line does not keep choosing a service the owner cannot fund, it goes on with the next ready one', opts, async () => {
  const w = await world(); const { pid } = w; await PR.save('groq', { secret: 'gsk_testkey0123456789abcdef0123' });
  w.m.st.fail.anthropic = { status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API' };
  await turnOn(pid); await run(w, D0); const r1 = await PL.openRun(pid); assert.equal(r1.status, 'stopped', r1.note); assert.match(r1.note, /kredisi\/bakiyesi yetersiz/);
  const av = await require('../../src/content/services/llm').available({ now: plus(D0, 5) }); assert.equal(av.find((x) => x.key === 'anthropic').ready, false); assert.match(av.find((x) => x.key === 'anthropic').reason, /Kredisi/);
  await run(w, plus(D0, 40)); const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4))); assert.equal(wp.posts.size, 1);
  assert.notEqual((await q1('SELECT generation FROM articles')).generation.provider, 'anthropic', 'the dry vendor did not write');
  assert.equal((await require('../../src/content/services/llm').available({ now: new Date(Date.now() + 4 * 3600e3) })).find((x) => x.key === 'anthropic').ready, true, 'after 3 hours it is tried again (the usage rows carry the database clock)');
});

test('migration 0029 gives up a cycle that was waiting for Apify (nothing to wait for any more) and leaves every other waiting cycle alone; the next tick starts a fresh one', opts, async () => {
  const w = await world(); const { pid } = w; await turnOn(pid, { everyMinutes: 480 }); const db = H.db();
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/content/migrations/0029_apify_wait_ends.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  await db.query("INSERT INTO pipeline_runs (project_id, trigger, status, step, attempt, note, wait_until, started_at) VALUES ($1, 'schedule', 'waiting', 'idea', 29, 'Apify ücretsiz planında günlük 5 çalıştırma hakkı bitti', now() + interval '15 hours', $2)", [pid, plus(D0, -600)]);
  assert.equal((await q("SELECT 1 FROM pipeline_runs WHERE status = 'waiting'")).length, 1); await db.query(sql);
  const r = await q1('SELECT status, note FROM pipeline_runs'); assert.equal(r.status, 'cancelled'); assert.match(r.note, /Apify artık zorunlu değil/);
  const t = await PL.tick({ now: D0 }); assert.equal(t.started.length, 1, 'a fresh cycle starts at once (the pace is long past)');
  await db.query("UPDATE pipeline_runs SET status = 'cancelled', finished_at = now() WHERE status <> 'cancelled'");
  await db.query("INSERT INTO pipeline_runs (project_id, trigger, status, step, note, wait_until) VALUES ($1, 'schedule', 'waiting', 'idea', 'Günlük yeni makale sınırı doldu (3/3); yarın devam edilecek', now() + interval '5 hours')", [pid]); await db.query(sql);
  assert.equal((await q1("SELECT status FROM pipeline_runs WHERE status <> 'cancelled'")).status, 'waiting', 'a wait for something else stays');
});

test('migration 0027 raises the saved minimum length to 1200 words and never lowers a higher one', opts, async () => {
  const pid = (await P.seedDefault()).projectId; const db = H.db();
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/content/migrations/0027_min_words_1200.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const put = (v) => db.query("INSERT INTO automation_settings (scope, project_id, key, value) VALUES ('project', $1, 'pipeline', $2::jsonb) ON CONFLICT (scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO UPDATE SET value = $2::jsonb", [pid, JSON.stringify(v)]);
  const get = async () => (await q1("SELECT (value->>'minWords')::int n FROM automation_settings WHERE key = 'pipeline'")).n;
  await put({ enabled: true, minWords: 1050 }); await db.query(sql); assert.equal(await get(), 1200);
  await put({ enabled: true }); await db.query(sql); assert.equal(await get(), 1200, 'a row without the number gets it');
  await put({ enabled: true, minWords: 1500 }); await db.query(sql); assert.equal(await get(), 1500, 'a higher number of the owner stays');
});

test('... and not for what no new draft can cure: a person-only problem of the IDEA (here the owner keeps the subject-level warning for a person) is dropped at once, one draft per idea', opts, async () => {
  const w = await world(); const { pid } = w; let n = 0; w.m.st.override.review = () => { n++; if (n === 1) return SENSITIVE; delete w.m.st.override.review; return undefined; };
  await turnOn(pid, { adsenseCheck: true }); await PL.setConfig(pid, { acceptSubjectWarning: false }); await run(w, D0);
  assert.equal(w.m.byRole('write').length, 2, 'one draft for the first idea (no second try), one for the next idea'); assert.equal((await q1('SELECT attempt FROM pipeline_runs')).attempt, 2);
});

test('a writer that fails WITHOUT a draft (unreadable answers) gets a second try with the other vendor before the idea is dropped', opts, async () => {
  const w = await world(); const { pid } = w; let n = 0; w.m.st.override.write = () => { n++; if (n === 2) delete w.m.st.override.write; return 'this is not json at all'; };            // the first two answers (the writer asks twice) are unreadable, from the third on the default writer answers
  await turnOn(pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(d.attempt, 1);
  assert.ok(d.trail.some((t) => /Taslak çıkmadı/.test(t.text))); assert.equal(wp.posts.size, 1);
});

test('Apify\'s daily run limit is no obstacle (owner: never mandatory): the cycle neither waits nor drops the idea, it goes on with the real parts - a fresh news idea or not - and publishes; the limit is remembered so the next idea does not ask again', opts, async () => {
  const w = await world(); w.apify.state.freeLimit = true; await turnOn(w.pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4))); assert.equal(d.attempt, 1); assert.equal(wp.posts.size, 1);
  assert.ok(d.trail.some((t) => /ücretsiz planında günlük 5 çalıştırma.*zorunlu değil/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text))); assert.ok(!d.trail.some((t) => /Bekleniyor/.test(t.text)), 'no waiting at all');
  assert.equal(w.apify.asked().length, 1, 'ONE call was spent finding out');
  await H.clean(); await wp.close(); wp = await startFakeWp();
  const w2 = await world({ freshHours: 36 }); w2.apify.state.freeLimit = true; await turnOn(w2.pid); await run(w2, D0);
  const d2 = await q1('SELECT * FROM pipeline_runs'); assert.equal(d2.status, 'done', JSON.stringify(d2.trail.map((t) => t.text).slice(-4))); assert.equal(wp.posts.size, 1);
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
  const w = await world(); const { pid } = w; await H.db().query('UPDATE niche_profiles SET min_opportunity_score = 90');       // the bar is higher than any idea's real parts reach: every idea fails at the suitability step
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

test('Apify is not even connected: the line can be switched on without it, asks it nothing, says so in words and publishes', opts, async () => {
  const w = await world({ noApify: true }); const { pid } = w;
  const pre = await PL.prerequisites(pid); assert.equal(pre.ok, true, JSON.stringify(pre.items.map((i) => [i.key, i.ok]))); assert.ok(pre.items.find((i) => i.key === 'apify').optional);
  await turnOn(pid); await run(w, D0); const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', d.note + JSON.stringify(d.trail.map((t) => t.text).slice(-4)));
  assert.ok(d.trail.some((t) => /Apify bağlı değil.*zorunlu değil/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text))); assert.equal(w.apify.asked().length, 0, 'it was never asked'); assert.equal(wp.posts.size, 1);
});

/** the old way of working, before the line: the news scanned and the keywords asked for by hand (what a pile of earlier research looks like); `skip` keeps some ideas without data */
async function preseed(w, skip = /^$/) {
  const KW = require('../../src/content/services/keywords');
  await N.runDiscovery(w.pid, { trigger: 'manual', userId: null, fetchImpl: w.ctx.newsFetch, now: D0, gapMs: 0, force: false }); await O.refresh(w.pid, { trigger: 'manual', userId: null, now: D0 });
  const ids = (await q('SELECT k.id, o.title FROM keywords k JOIN content_opportunities o ON o.topic_id = k.topic_id')).filter((r) => !skip.test(r.title)).map((r) => r.id);
  await KW.fetchMetrics(w.pid, { ids, manual: true, trigger: 'manual', userId: null, fetchImpl: w.ctx.fetchImpl, now: D0 }); await O.refresh(w.pid, { trigger: 'manual', userId: null, now: D0 });
  return ids.length;
}

test('Apify\'s limit does not touch an idea that ALREADY has volume data: the new Google keywords just have no volume, the line goes on with the data it has', opts, async () => {
  const w = await world({ suggest: { '*': ['openai pricing plans 2026', 'openai chatgpt plus price increase'] } }); assert.ok(await preseed(w) > 3); w.apify.state.freeLimit = true;
  await turnOn(w.pid); await run(w, D0);
  const d = await q1('SELECT * FROM pipeline_runs'); assert.equal(d.status, 'done', JSON.stringify(d.trail.map((t) => t.text))); assert.equal(wp.posts.size, 1);
  assert.ok(d.trail.some((t) => /aranma verisi bulundu/.test(t.text)), JSON.stringify(d.trail.map((t) => t.text)));
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

test('the minimum length (1200 words): the writer is told, a shorter draft is blocked by readiness (and worked on by the fix bot), and the number is the owner\'s to change', opts, async () => {
  const w = await world(); const { pid } = w; w.m.st.long = false;                                          // the fake writer's drafts have ~570 words
  await turnOn(pid); await run(w, D0);
  assert.match(w.m.byRole('write')[0].system, /AT LEAST 1200 words/, 'the writer prompt carries the minimum');
  assert.equal(wp.posts.size, 0, 'a 570-word draft is not published'); const art = await q('SELECT word_count, status FROM articles'); assert.ok(art.every((x) => x.word_count < 1200 && x.status !== 'archived'), 'no draft of 1200+ words, and nothing archived');
  assert.ok((await q1('SELECT trail FROM pipeline_runs')).trail.some((t) => /en az 1200 gerekli/.test(t.text)), 'the reason is told in words');
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
