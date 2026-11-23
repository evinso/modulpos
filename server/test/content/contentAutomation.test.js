process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { startFakeWp } = require('./fakeWordPress');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const PR = require('../../src/content/services/providers');
const SI = require('../../src/content/services/sites');
const SC = require('../../src/content/services/scheduler');
const AU = require('../../src/content/services/automation');
const AA = require('../../src/content/services/autoApprove');
const LV = require('../../src/content/services/automationLive');
const Q = require('../../src/content/services/queue');
const R = require('../../src/content/services/runs');

/**
 * "Otomasyon Modu": three modes and 15 checkboxes that are only a window onto the settings the other pages edit (bot schedules, publishing, quality, budget, limits).
 * Models / Apify / Serper keys are only stored (nothing is called); the WordPress site is the fake one, so "connection test passed" is real.
 */
const opts = { skip: H.skip };
const PASS = 'abcd efgh ijkl mnop';
let wp;
test.before(async () => { if (!H.skip) { await H.freshDatabase(); wp = await startFakeWp(); } });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await wp.close(); wp = await startFakeWp(); } });
test.after(async () => { if (!H.skip) { await wp.close(); await H.close(); } });

const setup = async () => (await P.seedDefault()).projectId;
const connectAll = async (pid) => {
  await PR.save('gemini', { secret: 'AIzaSyTestKey0123456789abcdef', extra: { model: 'gemini-test' } });
  await PR.save('openai', { secret: 'sk-test-key-0123456789abcdef', extra: { model: 'gpt-test' } });
  await PR.save('apify', { secret: 'apify_api_test_token_0123456789' }); await PR.save('serper', { secret: 'serper-key-0123456789abcdef' });
  const s = await SI.create(pid, { name: 'Test Blog', apiUrl: wp.url, username: 'editor', password: PASS }); const t = await SI.test(s.id); assert.equal(t.ok, true, t.message);
  return s;
};
const on = (o) => Object.fromEntries(o.options.map((x) => [x.key, x.on]));
const opt = (o, k) => o.options.find((x) => x.key === k);

test('a new project: free bots run, paid ones do not; every option says what it is missing; "tam otomatik" is not offered without a model and a tested WordPress site', opts, async () => {
  const pid = await setup(); const o = await AU.overview(pid);
  assert.equal(o.options.length, 16); assert.equal(o.mode, 'custom', 'the default is research only: not called "yarı otomatik" while the writer is off');
  assert.deepEqual(['news', 'opportunities', 'niche', 'health', 'links', 'adsense', 'reports'].every((k) => opt(o, k).on), true);
  assert.deepEqual(['keywords', 'serp', 'writer', 'images', 'autoApprove', 'publishing', 'publishLive', 'refresh', 'gsc'].map((k) => opt(o, k).on), Array(9).fill(false)); assert.match(opt(o, 'images').missing[0].text, /OpenAI anahtarı/);
  assert.match(opt(o, 'writer').missing[0].text, /yapay zekâ sağlayıcısı/); assert.match(opt(o, 'publishing').missing[0].text, /WordPress sitesi/); assert.equal(opt(o, 'news').ready, true);
  const full = o.modes.find((m) => m.key === 'full'); assert.equal(full.applicable, false); assert.ok(full.blockedBy.length >= 2);
  assert.match(o.summary, /Makale yazımı KAPALI.*WordPress’e gönderim KAPALI.*siz onaylarsınız/); assert.equal(o.checklist.find((c) => c.key === 'model').ok, false);
  assert.deepEqual([o.values.dailyArticles, o.values.dailyPublish, o.values.minQuality, o.values.dailyBudgetUsd], [3, 5, 85, null]);
  await assert.rejects(AU.apply({ projectId: pid, mode: 'full' }), (e) => e.status === 409 && /Tam otomatik mod için eksikler/.test(e.message) && e.extra.problems.length >= 2);
  assert.deepEqual(on(await AU.overview(pid)), on(o), 'a refused mode changes nothing');
});

test('"yarı otomatik" with nothing connected skips what cannot run (and says so) instead of switching it on', opts, async () => {
  const pid = await setup(); const r = await AU.apply({ projectId: pid, mode: 'semi' });
  assert.deepEqual(r.applied.skipped.map((s) => s.key).sort(), ['gsc', 'images', 'keywords', 'publishing', 'serp', 'writer']); assert.ok(r.applied.skipped.every((s) => s.missing.length));
  assert.equal(opt(r, 'writer').on, false); assert.equal((await SC.getSchedule('article_writer')).enabled, false); assert.equal(r.mode, 'custom');
  assert.equal((await S.get('publishing', pid)).value.autoPublish, false);
});

test('"yarı otomatik" with everything connected: research + writing + checks run by themselves, approval stays with the person, WordPress only gets DRAFTS, recommended values are written', opts, async () => {
  const pid = await setup(); const site = await connectAll(pid);
  const r = await AU.apply({ projectId: pid, mode: 'semi' });
  assert.equal(r.mode, 'semi'); assert.deepEqual(r.applied.skipped.map((x) => x.key), ['gsc'], 'only Search Console is missing (no service-account key): it is skipped and named, nothing else');
  assert.deepEqual(['keywords', 'serp', 'writer', 'images', 'publishing'].map((k) => opt(r, k).on), [true, true, true, true, true]); assert.equal((await S.get('images', pid)).value.auto, true, 'covers are drawn for every new article'); assert.deepEqual([opt(r, 'autoApprove').on, opt(r, 'publishLive').on, opt(r, 'refresh').on], [false, false, false]);
  const pub = (await S.get('publishing', pid)).value; assert.deepEqual([pub.autoPublish, pub.mode, pub.siteId, pub.windowStart, pub.windowEnd, pub.weekends], [true, 'draft', site.id, '09:00', '21:00', false]);
  assert.equal((await S.get('quality', pid)).value.manualApprovalNewArticles, true, 'every article still waits for the person');
  const w = await SC.getSchedule('article_writer'); assert.deepEqual([w.enabled, w.windowStart, w.windowEnd, w.intervalMinutes, w.options.perRun], [true, '09:00', '23:00', 180, 1]);
  const p = await SC.getSchedule('content_publishing'); assert.deepEqual([p.enabled, p.windowStart, p.windowEnd, p.options.perRun, p.weekdaysOnly], [true, '09:00', '21:00', 2, true]);
  assert.deepEqual([r.values.dailyArticles, r.values.dailyPublish, r.values.dailyBudgetUsd, r.values.minQuality], [2, 2, 3, 85]);
  assert.equal((await S.get('budget')).value.dailyTotalUsd, 3);
  assert.ok(r.applied.changes.some((c) => /Makale yazımı.*açıldı/.test(c)) && r.applied.changes.some((c) => /taslak/.test(c)));
  assert.equal((await AU.apply({ projectId: pid, mode: 'semi' })).applied.changes.length, 0, 'applying the same mode again changes nothing');
  assert.equal((await AU.overview(pid)).warnings.some((w2) => /fiyat girilmemiş/.test(w2.text)), true, 'a model without prices: the budget cannot count its spending, and the page says so');
});

test('"tam otomatik" needs an explicit yes (the person leaves the loop), then turns approval and live publishing on; "elle" turns everything off and leaves the numbers alone', opts, async () => {
  const pid = await setup(); await connectAll(pid);
  await assert.rejects(AU.apply({ projectId: pid, mode: 'full' }), (e) => e.status === 409 && e.extra.requiresConfirmation === true && /SİZ BAKMADAN sitede herkese açık/.test(e.message) && e.extra.options.includes('publishLive'));
  assert.equal(opt(await AU.overview(pid), 'writer').on, false, 'nothing was changed before the yes');
  const r = await AU.apply({ projectId: pid, mode: 'full', confirm: true });
  assert.equal(r.mode, 'full'); assert.equal((await S.get('quality', pid)).value.manualApprovalNewArticles, false); assert.equal((await S.get('publishing', pid)).value.mode, 'publish');
  assert.deepEqual(['autoApprove', 'publishLive', 'refresh', 'writer', 'publishing'].map((k) => opt(r, k).on), Array(5).fill(true));
  assert.ok(r.applied.changes.some((c) => /Otomatik onay AÇILDI/.test(c)) && r.applied.changes.some((c) => /doğrudan yayımla/.test(c)));
  assert.equal((await AU.apply({ projectId: pid, mode: 'full' })).applied.changes.length, 0, 'once on, applying it again asks nothing and changes nothing');
  const off = await AU.apply({ projectId: pid, mode: 'manual' });
  assert.equal(off.mode, 'manual'); assert.deepEqual(off.options.filter((x) => x.on).map((x) => x.key), []);
  assert.deepEqual([(await S.get('quality', pid)).value.manualApprovalNewArticles, (await S.get('publishing', pid)).value.mode, (await S.get('publishing', pid)).value.autoPublish], [true, 'draft', false]);
  assert.deepEqual([off.values.dailyArticles, off.values.dailyPublish], [2, 2], '"Elle" does not touch the limits');
  assert.equal((await SC.getSchedule('news_discovery')).enabled, false);
});

test('own choices: only what is ready can be switched on, "publish live" needs "send to WordPress", unknown / non-boolean input is refused, values are range-checked', opts, async () => {
  const pid = await setup();
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { writer: true } }), (e) => e.status === 409 && /Makale yazımı \(yapay zekâ\): Bağlı bir yapay zekâ sağlayıcısı/.test(e.message) && e.extra.problems[0].option === 'writer');
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { gsc: true } }), (e) => e.status === 409 && /Search Console/.test(e.message));
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { nope: true } }), /Bilinmeyen seçenek/);
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { news: 'yes' } }), /true\/false/);
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom' }), /Seçenekler gönderilmedi/); await assert.rejects(AU.apply({ projectId: pid, mode: 'weird' }), /Mod/);
  await connectAll(pid);
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { publishLive: true, publishing: false }, confirm: true }), /doğrudan yayımla.*gönder/);
  for (const [values, re] of [[{ dailyArticles: 0 }, /Günlük yeni makale/], [{ dailyArticles: 51 }, /Günlük yeni makale/], [{ writerFrom: '25:00' }, /SS:DD/], [{ publishFrom: '10:00', publishTo: '10:00' }, /aynı olamaz/], [{ minQuality: 10 }, /kalite/], [{ dailyBudgetUsd: -1 }, /bütçe/], [{ weekends: 'x' }, /true\/false/]]) {
    await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { news: true }, values }), re, JSON.stringify(values));
  }
  const r = await AU.apply({ projectId: pid, mode: 'custom', options: { writer: true, publishing: true, news: false }, values: { dailyArticles: 6, writerFrom: '08:00', writerTo: '20:00', dailyBudgetUsd: null, weekends: true } });
  assert.deepEqual([opt(r, 'writer').on, opt(r, 'publishing').on, opt(r, 'news').on, opt(r, 'autoApprove').on], [true, true, false, false]); assert.equal(r.mode, 'custom');
  const w = await SC.getSchedule('article_writer'); assert.deepEqual([w.windowStart, w.windowEnd, w.options.perRun], ['08:00', '20:00', 2], '6 a day over 4 runs of a 12 h window = 2 per run');
  assert.equal((await L.status({ projectId: pid })).items.find((i) => i.workType === 'new_article').limit, 6, 'the platform limit (3) would have capped the project: it is raised, never lowered');
  assert.deepEqual([r.values.dailyArticles, r.values.weekends, r.values.dailyBudgetUsd], [6, true, null]); assert.equal((await SC.getSchedule('content_publishing')).weekdaysOnly, false);
});

test('a closed per-project bot switch would silently stop a scheduled bot: the mode opens it and says so', opts, async () => {
  const pid = await setup(); await S.set('news', { ...(await S.get('news', pid)).value, enabled: false }, { scope: 'project', projectId: pid });
  await SC.updateSchedule('news_discovery', { enabled: false });
  const r = await AU.apply({ projectId: pid, mode: 'custom', options: { news: true } });
  assert.equal((await S.get('news', pid)).value.enabled, true); assert.ok(r.applied.changes.some((c) => /haber botu.*açıldı/.test(c)));
});

// ── auto approval ────────────────────────────────────────────────────────────────────────────────
const filler = (n) => Array.from({ length: n }, (_, i) => `Sentence ${n}-${i} gives plain background for the reader of this guide.`).join(' ');
let seq = 0;
async function draft(pid, o = {}) {
  seq++; const cats = await P.listCategories(pid);
  const a = await A.create({ projectId: pid, h1: `Auto approve ${seq}`, seoTitle: `Auto approve ${seq}`, metaDescription: 'm'.repeat(100), focusKeyword: `auto approve ${seq}`, categoryId: cats[0].id, contentHtml: `<h2>Start</h2><p>${filler(40)}</p>`, articleType: 'evergreen_guide' });
  await H.db().query("UPDATE articles SET status = 'needs_review', created_by = $2, fact_checked_at = $3, adsense_risk = $4, quality_score = $5 WHERE id = $1", [a.id, o.by || 'ai', o.fact === false ? null : new Date(), o.adsense === undefined ? 'low' : o.adsense, o.score === undefined ? 90 : o.score]);
  return a.id;
}
const status = async (id) => (await H.db().query('SELECT status FROM articles WHERE id = $1', [id])).rows[0].status;

test('auto approval: OFF by default; when ON it approves exactly what a person could approve (same readiness gate) and explains every refusal; people\'s articles are never touched', opts, async () => {
  const pid = await setup(); const id = await draft(pid);
  assert.deepEqual(await AA.approveIfClean(id), { approved: false, reason: 'manual' }); assert.equal(await status(id), 'needs_review');
  await S.set('quality', { ...(await S.get('quality', pid)).value, manualApprovalNewArticles: false }, { scope: 'global' });
  const ok = await AA.approveIfClean(id); assert.deepEqual([ok.approved, ok.qualityScore], [true, 90]); assert.equal(await status(id), 'ready');
  assert.equal((await AA.approveIfClean(id)).reason, 'not_applicable', 'a second call finds nothing to do');
  const audit = (await H.db().query("SELECT after FROM audit_logs WHERE action = 'article.auto_approve'")).rows; assert.equal(audit.length, 1); assert.equal(audit[0].after.by, 'automation');
  const low = await draft(pid, { score: 70 }); const lr = await AA.approveIfClean(low); assert.deepEqual([lr.approved, lr.reason], [false, 'blocked']); assert.match(lr.problems.join(' '), /Kalite puanı 70/); assert.equal(await status(low), 'needs_review');
  const risky = await draft(pid, { adsense: 'review' }); assert.match((await AA.approveIfClean(risky)).problems.join(' '), /AdSense/);
  const unchecked = await draft(pid, { fact: false }); assert.match((await AA.approveIfClean(unchecked)).problems.join(' '), /Doğruluk kontrolü/);
  const human = await draft(pid, { by: 'manual' }); assert.equal((await AA.approveIfClean(human)).reason, 'not_applicable'); assert.equal(await status(human), 'needs_review');
  const dup = await draft(pid); await H.db().query("UPDATE articles SET focus_keyword = (SELECT focus_keyword FROM articles WHERE id = $1) WHERE id = $2", [id, dup]);
  assert.match((await AA.approveIfClean(dup)).problems.join(' '), /Aynı odak/, 'a duplicate of an approved article is not approved either');
});

// ── the live picture ─────────────────────────────────────────────────────────────────────────────
const NOWL = new Date('2026-11-23T12:00:00Z');
const botOf = (l, k) => l.bots.find((b) => b.key === k);

test('live: what works right now and on what, what waits, what is off or stopped and why, what finished lately - read only, nothing invented', opts, async () => {
  const pid = await setup(); await SC.updateSchedule('article_writer', { enabled: true, windowStart: '09:00', windowEnd: '23:00' }); void NOWL;
  let l = await LV.live(pid, { now: NOWL });
  assert.equal(l.bots.length, 13); assert.deepEqual([l.summary.running, l.summary.queued], [0, 0]); assert.equal(l.paused, false);
  assert.deepEqual([botOf(l, 'news_discovery').state, botOf(l, 'keyword_research').state, botOf(l, 'news_discovery').last], ['waiting', 'off', null], 'no run yet: no invented "last run"');
  assert.deepEqual(l.events, []); assert.deepEqual([l.pipeline.needsReview, l.pipeline.ready], [0, 0]); assert.deepEqual(l.today.articles, { done: 0, limit: 3 });

  // a job a worker is running: the bot "works", for how long, and what it says it is doing
  const a = (await Q.enqueue({ botKey: 'news_discovery', projectId: pid, dedupeKey: 'n1', trigger: 'schedule', runAfter: new Date(NOWL.getTime() - 60000) })).job;
  const claimed = await Q.claim('w1', { now: new Date(NOWL.getTime() - 42000) }); assert.equal(claimed.id, a.id);
  await H.db().query('UPDATE jobs SET started_at = $2 WHERE id = $1', [a.id, new Date(NOWL.getTime() - 42000)]);
  // the writer reports its step through the run log
  const run = await R.start('article_writer', { projectId: pid, trigger: 'schedule' }); await R.progress(run.id, { step: 'writing', idea: 'ChatGPT Plus price goes up' });
  await H.db().query('UPDATE automation_runs SET started_at = $2 WHERE id = $1', [run.id, new Date(NOWL.getTime() - 20000)]);           // (the test clock is not the database clock)
  // another job waits, another one waits for its retry
  await Q.enqueue({ botKey: 'content_opportunity', projectId: pid, dedupeKey: 'o1', trigger: 'schedule', runAfter: new Date(NOWL.getTime() - 1000) });
  const r = (await Q.enqueue({ botKey: 'content_health', projectId: pid, dedupeKey: 'h1', trigger: 'schedule' })).job; await H.db().query("UPDATE jobs SET run_after = $2, last_error = 'WordPress meşgul' WHERE id = $1", [r.id, new Date(NOWL.getTime() + 300000)]);
  l = await LV.live(pid, { now: NOWL });
  const news = botOf(l, 'news_discovery'); assert.deepEqual([news.state, news.doing, news.runningForSeconds, news.trigger], ['running', 'Haber kaynakları taranıyor', 42, 'schedule']);
  assert.deepEqual([botOf(l, 'article_writer').state, botOf(l, 'article_writer').doing], ['running', 'Makale yazılıyor: “ChatGPT Plus price goes up”']);
  assert.equal(botOf(l, 'content_opportunity').state, 'queued'); const hb = botOf(l, 'content_health'); assert.deepEqual([hb.state, !!hb.retryAt], ['retry', true]); assert.match(hb.note, /WordPress meşgul/);
  assert.deepEqual([l.summary.running, l.summary.queued], [2, 2]); assert.deepEqual(l.bots.slice(0, 2).map((b) => b.state), ['running', 'running'], 'running bots are listed first');
  await R.progress(run.id, { step: 'checking', idea: 'ChatGPT Plus price goes up' }); assert.match(botOf(await LV.live(pid, { now: NOWL }), 'article_writer').doing, /^Zorunlu kontroller yapılıyor.*ChatGPT Plus/);

  // finished: the result sentence of the job is the bot's last result and the newest line of the feed
  await Q.complete(a.id, { status: 'done', result: { status: 'ok', message: '12 yeni haber, 5 nişe uygun' } }, { now: new Date(NOWL.getTime() - 5000) });
  await R.finish(run.id, { status: 'ok', stats: { idea: 'ChatGPT Plus price goes up' } });
  await H.db().query('UPDATE automation_runs SET finished_at = $2 WHERE id = $1', [run.id, new Date(NOWL.getTime() - 6000)]);          // (a run stamps the DATABASE clock, which has moved past this test's fixed clock)
  // (a job is claimable only from its run_after: the default is the REAL clock, which moves past this test's fixed clock)
  const bad = (await Q.enqueue({ botKey: 'seo_performance', projectId: pid, dedupeKey: 'g1', trigger: 'schedule', maxAttempts: 1, runAfter: new Date(NOWL.getTime() - 4000) })).job; await Q.claim('w1', { now: new Date(NOWL.getTime() - 3000) }); await Q.fail({ ...bad, attempts: 1, maxAttempts: 1 }, new Error('Search Console anahtarı reddedildi'), { now: new Date(NOWL.getTime() - 2000) });
  l = await LV.live(pid, { now: NOWL });
  assert.deepEqual([botOf(l, 'news_discovery').state, botOf(l, 'news_discovery').last.outcome, botOf(l, 'news_discovery').last.message], ['waiting', 'ok', '12 yeni haber, 5 nişe uygun']);
  const sp = botOf(l, 'seo_performance'); assert.deepEqual([sp.state, sp.last.outcome, sp.last.message], ['off', 'error', 'Search Console anahtarı reddedildi'], 'a bot that is off still shows how its last attempt ended');
  assert.equal(l.events[0].bot, 'seo_performance', 'the newest line first'); assert.ok(l.events.some((e) => e.bot === 'news_discovery' && e.message === '12 yeni haber, 5 nişe uygun' && e.outcome === 'ok'));
  assert.ok(l.events.some((e) => e.outcome === 'error' && /anahtarı reddedildi/.test(e.message)), 'a failure shows its reason in the feed');
  assert.equal(l.events.filter((e) => e.bot === 'article_writer').length, 1, 'a run nobody queued is shown once');
  for (let i = 1; i < l.events.length; i++) assert.ok(new Date(l.events[i - 1].at) >= new Date(l.events[i].at), 'newest first');
});

test('live: stopped by errors vs switched off vs paused vs closed window, the pipeline and the day\'s places', opts, async () => {
  const pid = await setup();
  await SC.saveSchedule('news_discovery', { enabled: false, failStreak: 5, disabledReason: 'Art arda 5 başarısız çalışma' });
  let l = await LV.live(pid, { now: NOWL }); const n = botOf(l, 'news_discovery'); assert.deepEqual([n.state, n.note, n.failStreak], ['stopped', 'Art arda 5 başarısız çalışma', 5]);
  assert.equal(botOf(l, 'keyword_research').state, 'off');
  await SC.updateSchedule('content_opportunity', { enabled: true, windowStart: '02:00', windowEnd: '03:00' });
  const closed = botOf(await LV.live(pid, { now: NOWL }), 'content_opportunity'); assert.equal(closed.state, 'waiting'); assert.match(closed.note, /Çalışma saati dışında \(02:00–03:00\)/);
  const cats = await P.listCategories(pid);
  for (const [i, st] of ['needs_review', 'needs_review', 'ready'].entries()) { const a = await A.create({ projectId: pid, h1: `Live ${i}`, contentHtml: '<p>x</p>', categoryId: cats[0].id }); await H.db().query('UPDATE articles SET status = $2 WHERE id = $1', [a.id, st]); }
  await L.reserve({ workType: 'new_article', projectId: pid, amount: 1, now: NOWL });
  l = await LV.live(pid, { now: NOWL }); assert.deepEqual([l.pipeline.needsReview, l.pipeline.ready], [2, 1]); assert.deepEqual(l.today.articles, { done: 1, limit: 3 });
  await S.set('bots', { paused: true, pausedAt: NOWL.toISOString(), pausedBy: 'test' }, { scope: 'global' });
  l = await LV.live(pid, { now: NOWL }); assert.equal(l.paused, true); assert.deepEqual([botOf(l, 'content_opportunity').state, botOf(l, 'content_opportunity').nextRunAt], ['paused', null], 'a paused platform shows no "next run"');
  await assert.rejects(LV.live('00000000-0000-0000-0000-000000000001', { now: NOWL }), (e) => e.status === 404);
});

test('values: the page shows what REALLY applies (the narrowest of platform, project and site limit); a project limit above the platform limit is raised on "Seçimi uygula" (and said so); a mode button keeps a number the person set; the publishing bot\'s own hours are compared', opts, async () => {
  const pid = await setup(); const eff = async () => (await AU.overview(pid)).effective;
  const gl = async (t) => (await L.status({ projectId: null })).items.find((i) => i.workType === t).limit;
  await L.setProjectLimits(pid, { new_article: 5 });
  let e = await eff(); assert.deepEqual([e.dailyArticles.value, e.dailyArticles.limitedBy, e.dailyArticles.caps.map((c) => [c.scope, c.limit])], [3, ['platform'], [['platform', 3], ['project', 5]]], 'the page used to show 5 here while only 3 per day could ever be written');
  assert.deepEqual([(await AU.overview(pid)).values.dailyArticles, e.dailyPublish.value, e.dailyPublish.limitedBy], [5, 5, ['platform']], 'the typed number is still the project\'s own');
  // applying with the number as shown makes it real: the platform limit follows (and the change list says so)
  const r = await AU.apply({ projectId: pid, mode: 'custom', options: {} });
  assert.equal(await gl('new_article'), 5); assert.ok(r.applied.changes.some((c) => /Platform limiti yükseltildi.*new_article 5/.test(c)), JSON.stringify(r.applied.changes)); assert.deepEqual([r.effective.dailyArticles.value, r.effective.dailyArticles.limitedBy.sort()], [5, ['platform', 'project']]);
  assert.equal(await gl('publish'), 5, 'nothing else was touched');
  // a mode button keeps what the person set (5 articles), and only brings a factory-value limit (5 posts) to the recommended 2
  const semi = await AU.apply({ projectId: pid, mode: 'semi' }); assert.deepEqual([semi.values.dailyArticles, semi.values.dailyPublish], [5, 2]);
  // the publishing bot follows its OWN hours: a difference is shown
  await SC.updateSchedule('content_publishing', { windowStart: '10:00', windowEnd: '18:00' }); await S.set('publishing', { ...(await S.get('publishing', pid)).value, autoPublish: true, siteId: (await SI.create(pid, { name: 'Blog', apiUrl: wp.url, username: 'editor', password: PASS })).id }, { scope: 'project', projectId: pid });
  await SC.updateSchedule('content_publishing', { enabled: true }); const w = (await AU.overview(pid)).warnings.find((x) => /kendi çalışma saatleri/.test(x.text)); assert.ok(w, 'a mismatch between the bot\'s hours and the publishing hours is named'); assert.match(w.text, /10:00–18:00/);
});

test('hours: the page shows the REAL working hours of the writer (none = "every hour"), says so in a warning, an empty pair is a valid answer, one empty end is refused, and applying a mode writes the hours', opts, async () => {
  const pid = await setup(); await SC.updateSchedule('article_writer', { enabled: true, windowStart: null, windowEnd: null });
  let o = await AU.overview(pid); assert.deepEqual([o.values.writerFrom, o.values.writerTo], [null, null], 'it used to show the recommended 09:00-23:00 while the bot ran at any hour');
  assert.ok(o.warnings.some((w) => /Makale botunun çalışma saati sınırı YOK/.test(w.text)));
  await AU.apply({ projectId: pid, mode: 'custom', options: {} });                                       // untouched empty hours: nothing to write, nothing refused
  assert.deepEqual([(await AU.overview(pid)).values.writerFrom, (await SC.getSchedule('article_writer')).windowStart], [null, null]);
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: {}, values: { writerFrom: '09:00', writerTo: '' } }), /ikisi de yazılmalı/);
  const set = await AU.apply({ projectId: pid, mode: 'custom', options: {}, values: { writerFrom: '10:00', writerTo: '20:00' } });
  assert.deepEqual([set.values.writerFrom, set.values.writerTo, (await SC.getSchedule('article_writer')).windowStart], ['10:00', '20:00', '10:00']); assert.ok(!set.warnings.some((w) => /çalışma saati sınırı YOK/.test(w.text)));
  const cleared = await AU.apply({ projectId: pid, mode: 'custom', options: {}, values: { writerFrom: '', writerTo: null } }); assert.deepEqual([cleared.values.writerFrom, (await SC.getSchedule('article_writer')).windowEnd], [null, null], 'both empty = no working hours, on purpose');
  await AU.apply({ projectId: pid, mode: 'semi' }); assert.deepEqual([(await SC.getSchedule('article_writer')).windowStart, (await SC.getSchedule('article_writer')).windowEnd], ['09:00', '23:00'], 'a mode button writes the recommended hours (they were empty = not the person\'s own choice)');
});
