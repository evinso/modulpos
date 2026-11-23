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
  await PR.save('apify', { secret: 'apify_api_test_token_0123456789' }); await PR.save('serper', { secret: 'serper-key-0123456789abcdef' });
  const s = await SI.create(pid, { name: 'Test Blog', apiUrl: wp.url, username: 'editor', password: PASS }); const t = await SI.test(s.id); assert.equal(t.ok, true, t.message);
  return s;
};
const on = (o) => Object.fromEntries(o.options.map((x) => [x.key, x.on]));
const opt = (o, k) => o.options.find((x) => x.key === k);

test('a new project: free bots run, paid ones do not; every option says what it is missing; "tam otomatik" is not offered without a model and a tested WordPress site', opts, async () => {
  const pid = await setup(); const o = await AU.overview(pid);
  assert.equal(o.options.length, 15); assert.equal(o.mode, 'custom', 'the default is research only: not called "yarı otomatik" while the writer is off');
  assert.deepEqual(['news', 'opportunities', 'niche', 'health', 'links', 'adsense', 'reports'].every((k) => opt(o, k).on), true);
  assert.deepEqual(['keywords', 'serp', 'writer', 'autoApprove', 'publishing', 'publishLive', 'refresh', 'gsc'].map((k) => opt(o, k).on), Array(8).fill(false));
  assert.match(opt(o, 'writer').missing[0].text, /yapay zekâ sağlayıcısı/); assert.match(opt(o, 'publishing').missing[0].text, /WordPress sitesi/); assert.equal(opt(o, 'news').ready, true);
  const full = o.modes.find((m) => m.key === 'full'); assert.equal(full.applicable, false); assert.ok(full.blockedBy.length >= 2);
  assert.match(o.summary, /Makale yazımı KAPALI.*WordPress’e gönderim KAPALI.*siz onaylarsınız/); assert.equal(o.checklist.find((c) => c.key === 'model').ok, false);
  assert.deepEqual([o.values.dailyArticles, o.values.dailyPublish, o.values.minQuality, o.values.dailyBudgetUsd], [3, 5, 85, null]);
  await assert.rejects(AU.apply({ projectId: pid, mode: 'full' }), (e) => e.status === 409 && /Tam otomatik mod için eksikler/.test(e.message) && e.extra.problems.length >= 2);
  assert.deepEqual(on(await AU.overview(pid)), on(o), 'a refused mode changes nothing');
});

test('"yarı otomatik" with nothing connected skips what cannot run (and says so) instead of switching it on', opts, async () => {
  const pid = await setup(); const r = await AU.apply({ projectId: pid, mode: 'semi' });
  assert.deepEqual(r.applied.skipped.map((s) => s.key).sort(), ['gsc', 'keywords', 'publishing', 'serp', 'writer']); assert.ok(r.applied.skipped.every((s) => s.missing.length));
  assert.equal(opt(r, 'writer').on, false); assert.equal((await SC.getSchedule('article_writer')).enabled, false); assert.equal(r.mode, 'custom');
  assert.equal((await S.get('publishing', pid)).value.autoPublish, false);
});

test('"yarı otomatik" with everything connected: research + writing + checks run by themselves, approval stays with the person, WordPress only gets DRAFTS, recommended values are written', opts, async () => {
  const pid = await setup(); const site = await connectAll(pid);
  const r = await AU.apply({ projectId: pid, mode: 'semi' });
  assert.equal(r.mode, 'semi'); assert.deepEqual(r.applied.skipped.map((x) => x.key), ['gsc'], 'only Search Console is missing (no service-account key): it is skipped and named, nothing else');
  assert.deepEqual(['keywords', 'serp', 'writer', 'publishing'].map((k) => opt(r, k).on), [true, true, true, true]); assert.deepEqual([opt(r, 'autoApprove').on, opt(r, 'publishLive').on, opt(r, 'refresh').on], [false, false, false]);
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
