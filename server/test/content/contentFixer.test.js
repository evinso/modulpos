const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { fakeModels, PAGE, json } = require('./fakeModels');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const O = require('../../src/content/services/opportunities');
const PR = require('../../src/content/services/providers');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const A = require('../../src/content/services/articles');
const W = require('../../src/content/services/writer');
const FX = require('../../src/content/services/fixer');
const SC = require('../../src/content/services/scheduler');
const BO = require('../../src/content/services/bots');
const AU = require('../../src/content/services/automation');
const { FetchError } = require('../../src/content/lib/safeFetch');

/**
 * The article-fixer bot: AI drafts that "Yayına hazır mı?" cannot clear get their problems worked on (checks that never ran, a missing category, text problems the model repairs from the
 * sources), then the SAME approval gate decides. Models are the fake vendors; what is verified is everything around them: what is asked, what is kept, what is refused, what is spent.
 */
const opts = { skip: H.skip };
const NOW = new Date('2026-11-21T12:00:00Z');
const KEY = { anthropic: 'sk-ant-test-key-0123456789', openai: 'sk-test-key-0123456789abcdef' };
const q = (sql, p = []) => H.db().query(sql, p).then((r) => r.rows);
const q1 = async (sql, p = []) => (await q(sql, p))[0];

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l]) => `<item><title>${t}</title><link>${l}</link><pubDate>Fri, 21 Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const feeds = (map) => async (url) => { if (!map[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: map[url], url }; };
async function vendors() { await PR.save('anthropic', { secret: KEY.anthropic, extra: { inputPricePerM: '3', outputPricePerM: '15' } }); await PR.save('openai', { secret: KEY.openai, extra: { model: 'gpt-test' } }); }
async function idea(pid) {
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await N.runDiscovery(pid, { fetchImpl: feeds({ 'https://a.example/feed': rssOf([['OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1']]), 'https://b.example/feed': rssOf([['ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1']]) }), now: NOW });
  await O.refresh(pid, { now: NOW }); await H.db().query("UPDATE content_opportunities SET eligible = true, ineligible_reason = ''");
  return (await O.list(pid)).items[0];
}
const pageFetcher = async (url) => { if (url === 'https://b.example/1') throw new FetchError('http', 'HTTP 403', { status: 403 }); return { body: PAGE() }; };
/** a project with two vendors and ONE written draft (needs_review); `m` is the fake model the writer used */
async function draft(m, { factFirst } = {}) {
  await P.seedDefault(); const pid = (await q1('SELECT id FROM content_projects')).id; await vendors();
  const i = await idea(pid);
  if (factFirst) m.st.override.fact = factFirst;
  await W.start(i.id, { fetchImpl: m.fetchImpl, fetcher: pageFetcher, now: NOW, background: false });
  const a = await q1('SELECT * FROM articles'); return { pid, id: a.id };
}
const sanity = async (id) => { const r = await A.readiness(id); return { ready: r.ready, codes: r.problems.filter((p) => p.blocking).map((p) => p.code) }; };
const badFact = () => ({ claims: [
  { claim: 'ChatGPT Plus will cost 99 dollars a month', importance: 'major', verdict: 'unsupported', sourceIds: [1], evidence: '', note: 'The source says 22 dollars.' },
  { claim: 'ChatGPT Plus will cost 22 dollars a month starting in January 2027', importance: 'major', verdict: 'supported', sourceIds: [1], evidence: 'ChatGPT Plus will cost 22 dollars a month starting in January 2027', note: '' }] });
const run = (id, m, o = {}) => FX.fixOne(id, { fetchImpl: m.fetchImpl, now: NOW, ...o });

test('a draft whose checks never ran: the bot runs them again, the SAME gate judges, approval stays with a person while manual approval is on', opts, async () => {
  const m = fakeModels(); const { pid, id } = await draft(m);
  assert.equal((await sanity(id)).ready, true, 'the fake writer + checks give a clean article (sanity of the setup)');
  await q('UPDATE articles SET fact_checked_at = NULL, quality_score = NULL, adsense_risk = NULL WHERE id = $1', [id]); await q('DELETE FROM article_checks WHERE article_id = $1', [id]);
  assert.deepEqual((await sanity(id)).codes.sort(), ['no_adsense', 'no_quality', 'not_fact_checked']);
  const before = m.calls.length;
  const r = await run(id, m);
  assert.equal(r.result, 'fixed'); assert.equal(r.remaining.length, 0);
  assert.deepEqual(r.steps.map((s) => s.step), ['checks']);
  assert.deepEqual(m.calls.slice(before).map((c) => c.role).sort(), ['fact', 'review'], 'only the checks were run: no rewrite for a missing check');
  assert.equal((await q1('SELECT status FROM articles WHERE id = $1', [id])).status, 'needs_review', 'manual approval is on: a person decides');
  assert.equal((await sanity(id)).ready, true);
  assert.equal((await q1("SELECT used FROM daily_work_usage WHERE work_type = 'article_fix' AND scope = 'global'")).used, 1, 'one place of the day for the attempt');
  const row = await q1('SELECT * FROM article_fixes'); assert.deepEqual([row.result, row.version_before, row.version_after, row.trigger], ['fixed', 1, 1, 'schedule']);
  assert.ok(row.cost_usd === null || Number(row.cost_usd) >= 0);
  assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'article_fixed'")).n, 1);
  void pid;
});

test('with automatic approval switched on the fixed article goes through the existing gate and becomes "Yayına hazır" (audited as the automatic approval)', opts, async () => {
  const m = fakeModels(); const { id } = await draft(m);
  const cur = (await S.get('quality')).value; await S.set('quality', { ...cur, manualApprovalNewArticles: false }, { scope: 'global' });
  await q('UPDATE articles SET fact_checked_at = NULL, quality_score = NULL, adsense_risk = NULL WHERE id = $1', [id]); await q('DELETE FROM article_checks WHERE article_id = $1', [id]);
  const r = await run(id, m);
  assert.equal(r.result, 'approved');
  assert.equal((await q1('SELECT status FROM articles WHERE id = $1', [id])).status, 'ready');
  assert.equal((await q1("SELECT count(*)::int n FROM audit_logs WHERE action = 'article.auto_approve'")).n, 1);
});

test('a text problem (a claim the sources do not carry): the model repairs it FROM the problem list and the sources, a new version "by ai" is made, ALL checks run again on it, nothing is relaxed', opts, async () => {
  const m = fakeModels(); let n = 0;
  const { id } = await draft(m, { factFirst: () => (n++ === 0 ? badFact() : { claims: [{ claim: 'ChatGPT Plus will cost 22 dollars a month starting in January 2027', importance: 'major', verdict: 'supported', sourceIds: [1], evidence: 'ChatGPT Plus will cost 22 dollars a month starting in January 2027', note: '' }] }) });
  const codes = (await sanity(id)).codes; assert.ok(codes.includes('fact_check_failed'), codes.join()); assert.ok(codes.every((c) => ['fact_check_failed', 'low_quality'].includes(c)), 'an unsupported claim also costs quality points: both are cured by the same repair');
  const r = await run(id, m);
  assert.equal(r.result, 'fixed', JSON.stringify(r));
  assert.deepEqual(r.steps.map((s) => s.step), ['rewrite', 'checks']);
  const fix = m.byRole('fix'); assert.equal(fix.length, 1);
  assert.match(fix[0].user, /PROBLEMS FOUND BY THE CHECKS/); assert.match(fix[0].user, /99 dollars/, 'the unsupported claim itself is in the brief'); assert.match(fix[0].user, /SOURCES \(untrusted data\)/);
  assert.equal(fix[0].vendor, 'anthropic', 'the writer vendor repairs, the other vendor checks');
  const a = await q1('SELECT current_version, manual_edited FROM articles WHERE id = $1', [id]); assert.deepEqual([a.current_version, a.manual_edited], [2, false], 'by ai: not a hand edit');
  assert.deepEqual(await q1('SELECT created_by FROM article_versions WHERE article_id = $1 AND version = 2', [id]), { created_by: 'ai' });
  assert.match((await q1('SELECT reason FROM article_versions WHERE article_id = $1 AND version = 2', [id])).reason, /^Düzeltme botu/);
  assert.equal(m.byRole('fact').length, 2, 'the fact check ran again on the NEW text (once for the writer pass, once after the repair)');
  assert.equal((await sanity(id)).ready, true);
  assert.equal((await q1('SELECT version_before, version_after FROM article_fixes')).version_after, 2);
});

test('only a PERSON can decide a duplicate, an excluded topic, a missing source or a blocked AdSense class: the bot spends nothing, says so, and does not come back until the article changes', opts, async () => {
  const m = fakeModels(); const { pid, id } = await draft(m);
  const a = await A.get(id);
  await A.create({ projectId: pid, categoryId: a.categoryId, h1: a.h1, focusKeyword: a.focusKeyword, contentHtml: '<p>x</p>' });             // another article with the same focus keyword and title
  assert.deepEqual((await sanity(id)).codes, ['duplicate']);
  const calls = m.calls.length;
  const r = await run(id, m);
  assert.equal(r.result, 'needs_person'); assert.match(r.message, /kişinin kararı/); assert.equal(m.calls.length, calls, 'no model was asked');
  assert.equal((await q1("SELECT count(*)::int n FROM daily_work_usage WHERE work_type = 'article_fix'")).n, 0, 'no place of the day was used');
  assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'article_fix_failed'")).n, 1);
  assert.deepEqual(await FX.candidates(pid), [], 'it is parked: the next pass does not pick it');
  await A.update(id, { metaDescription: `${'Edited by a person. '.repeat(5)}`, reason: 'person' }, { by: 'manual' });
  assert.equal((await FX.candidates(pid)).length, 1, 'a change by a person gives it a new chance');
  await q('UPDATE articles SET adsense_risk = $2 WHERE id = $1', [id, 'blocked']); await q("DELETE FROM articles WHERE h1 = $1 AND created_by <> 'ai'", [a.h1]);
  assert.equal((await run(id, m, { force: true })).result, 'needs_person', 'an AdSense class "blocked" is a person\'s decision too');
});

test('two attempts on one version, then it stops and says what is left; an edit by a person (new version) starts it again; a hand-edited text is never rewritten', opts, async () => {
  const m = fakeModels(); const { pid, id } = await draft(m, { factFirst: badFact });
  m.st.override.fact = badFact; m.st.override.fix = () => ({ fixed: ['Tried.'], unfixed: ['Could not fix it.'], fields: { contentHtml: `${(/x/.exec('x'), '<p>Changed text that still keeps the bad claim about 99 dollars a month.</p>'.repeat(8))}` } });
  const r1 = await run(id, m); assert.equal(r1.result, 'unresolved');
  const r2 = await run(id, m); assert.equal(r2.result, 'unresolved');
  assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'article_fix_failed'")).n, 1, 'told once, at the second attempt');
  assert.equal((await FX.history(id)).attempts, 2);
  assert.deepEqual(await FX.candidates(pid), [], 'stuck: not picked again');
  const r3 = await run(id, m); assert.equal(r3.result, 'skipped'); assert.match(r3.message, /2 deneme/);
  await A.update(id, { metaDescription: `${'A person fixed the meta text. '.repeat(4)}`, reason: 'person' }, { by: 'manual' });
  assert.equal((await FX.candidates(pid)).length, 1, 'the person\'s edit made a new chance');
  const calls = m.byRole('fix').length;
  const r4 = await run(id, m); assert.ok(r4.steps.some((s) => s.step === 'rewrite' && s.ok === false && /elle düzenlenmiş/.test(s.note)), 'a hand-edited article keeps its text');
  assert.equal(m.byRole('fix').length, calls, 'and the model was not asked to rewrite it');
});

test('free fixes: the idea\'s category goes back on an article that lost it; a person\'s own article and other statuses are never touched', opts, async () => {
  const m = fakeModels(); const { pid, id } = await draft(m);
  const cat = (await q1('SELECT category_id FROM content_opportunities WHERE article_id = $1', [id])).category_id;
  await q('UPDATE articles SET category_id = NULL WHERE id = $1', [id]);
  assert.deepEqual((await sanity(id)).codes, ['no_category']);
  const calls = m.calls.length; const r = await run(id, m);
  assert.deepEqual(r.steps.map((s) => [s.step, s.ok]), [['category', true]]); assert.equal(m.calls.length, calls, 'a free fix asks no model');
  assert.equal((await q1('SELECT category_id FROM articles WHERE id = $1', [id])).category_id, cat);
  assert.equal((await q1("SELECT count(*)::int n FROM daily_work_usage WHERE work_type = 'article_fix'")).n, 0);
  const own = await A.create({ projectId: pid, categoryId: cat, h1: 'My own words', contentHtml: '<p>x</p>' });
  await assert.rejects(run(own.id, m), (e) => e.status === 409 && /yapay zekânın yazdığı/.test(e.message));
  await q("UPDATE articles SET status = 'ready' WHERE id = $1", [id]);
  await assert.rejects(run(id, m), (e) => e.status === 409 && /İnceleme bekliyor/.test(e.message));
});

test('the daily "article_fix" limit and the budget stop it before any model is asked; a place nothing used is given back', opts, async () => {
  const m = fakeModels(); const { pid, id } = await draft(m);
  await q('UPDATE articles SET fact_checked_at = NULL, quality_score = NULL, adsense_risk = NULL WHERE id = $1', [id]); await q('DELETE FROM article_checks WHERE article_id = $1', [id]);
  assert.equal((await L.status({ projectId: pid, now: NOW })).items.find((i) => i.workType === 'article_fix').limit, 4, 'default 4 a day');
  await L.setGlobalLimits({ article_fix: 0 });
  const calls = m.calls.length;
  await assert.rejects(run(id, m), (e) => e.status === 409 && e.limit === true || /limit/i.test(e.message));
  assert.equal(m.calls.length, calls, 'no model call when the day\'s places are used up');
  assert.equal((await q1('SELECT count(*)::int n FROM article_fixes')).n, 0, 'and no row: it is simply tried again later');
  await L.setGlobalLimits({ article_fix: 4 });
  m.st.fail.fact = { status: 401, type: 'authentication_error', message: 'invalid key' }; m.st.fail.review = { status: 401, type: 'authentication_error', message: 'invalid key' };
  await assert.rejects(run(id, m), (e) => e.fatal === true && /anahtarı reddedildi/.test(e.message), 'a rejected key stops the attempt with the vendor\'s words');
  assert.equal((await q1('SELECT count(*)::int n FROM article_fixes')).n, 0, 'nothing is recorded as an attempt: the key is not the article\'s fault');
  assert.equal((await q1("SELECT coalesce(sum(used), 0)::int n FROM daily_work_usage WHERE work_type = 'article_fix'")).n, 0, 'and the place of the day was given back');
  const pass = await FX.runPass(pid, { fetchImpl: m.fetchImpl, now: NOW });
  assert.equal(pass.status, 'partial'); assert.match(pass.stats.stopped, /anahtarı reddedildi/, 'a pass stops at the first rejected key (the next pass looks again)');
});

test('the scheduled pass: only drafts with blocking problems, oldest first, perRun at most; nothing to do is a calm "skipped"; the bot is registered OFF and spends (so it is never switched on silently)', opts, async () => {
  const m = fakeModels(); const { pid, id } = await draft(m);
  assert.equal(SC.DEFAULTS.article_fixer.enabled, false); assert.equal(SC.DEFAULTS.article_fixer.spends, true);
  assert.equal((await BO.list()).items.length, 16); assert.equal((await BO.list()).items.find((b) => b.key === 'article_fixer').implemented, true);
  const none = await FX.runPass(pid, { fetchImpl: m.fetchImpl, now: NOW });
  assert.equal(none.status, 'skipped', 'a clean draft is not the bot\'s business (approval is the writer\'s gate and the owner\'s)');
  await q('UPDATE articles SET fact_checked_at = NULL, quality_score = NULL, adsense_risk = NULL WHERE id = $1', [id]); await q('DELETE FROM article_checks WHERE article_id = $1', [id]);
  const pass = await FX.runPass(pid, { fetchImpl: m.fetchImpl, now: NOW });
  assert.equal(pass.status, 'ok'); assert.deepEqual([pass.stats.found, pass.stats.fixed, pass.stats.approved], [1, 1, 0]);
  const run1 = await q1("SELECT bot_key, status FROM automation_runs WHERE bot_key = 'article_fixer'"); assert.equal(run1.status, 'ok');
  assert.equal((await SC.HANDLERS.article_fixer.run({ projectId: pid, trigger: 'schedule', payload: {} }, { fetchImpl: m.fetchImpl, now: NOW })).status, 'skipped');
});

test('Otomasyon Modu: the fixer is its own option (paid, needs a model, part of "Yarı otomatik" and "Tam otomatik"), switches the real bot schedule, and says that approval stays with the person while automatic approval is off', opts, async () => {
  await P.seedDefault(); const pid = (await q1('SELECT id FROM content_projects')).id;
  let o = await AU.overview(pid); const opt = o.options.find((x) => x.key === 'fixer');
  assert.deepEqual([opt.on, opt.ready, opt.spends, opt.group], [false, false, true, 'writing'], 'no model yet: it cannot be switched on');
  assert.ok(AU.MODES.semi.options.includes('fixer') && AU.MODES.full.options.includes('fixer'));
  await vendors();
  await AU.apply({ projectId: pid, mode: 'custom', options: { fixer: true } });
  assert.equal((await SC.getSchedule('article_fixer')).enabled, true);
  o = await AU.overview(pid); assert.ok(o.warnings.some((w) => /Eksikleri gideren bot açık ama otomatik onay kapalı/.test(w.text)));
});

const SENSITIVE_REVIEW = () => ({ categories: Object.fromEntries(['originality', 'user_value', 'source_accuracy', 'hallucination', 'copyright', 'keyword_stuffing', 'misleading_title', 'spam', 'low_value_auto', 'sensitive', 'ad_restrictions', 'image_rights', 'integrity']
  .map((k) => [k, k === 'sensitive' ? { status: 'warn', note: 'A data-breach story involving payment cards needs careful sourcing.' } : { status: 'pass', note: '' }])), risk: 'review', ratings: { originality: 82, usefulness: 80, editorial: 84 }, improvements: [], summary: 'Fine, but sensitive.' });

test('an AdSense class "review" that comes from the SUBJECT (the reviewer\'s sensitive-content category, as on the first real run: a data-breach story) is a person\'s decision: no place, no model call, and the note says what to do', opts, async () => {
  const m = fakeModels(); m.st.override.review = SENSITIVE_REVIEW;
  const { id } = await draft(m);
  assert.ok((await sanity(id)).codes.includes('adsense_risk'), 'the reviewer\'s subject warning makes the class "review"');
  const calls = m.calls.length;
  const r = await run(id, m);
  assert.equal(r.result, 'needs_person'); assert.equal(m.calls.length, calls, 'nothing was asked of a model'); assert.match(r.message, /konunun kendisi/);
  assert.match(r.remaining.find((p) => p.code === 'adsense_risk').message, /“AdSense risk sonucu”nu siz “Düşük” yapıp kaydedin/);
  assert.equal((await q1("SELECT count(*)::int n FROM daily_work_usage WHERE work_type = 'article_fix'")).n, 0);
  assert.equal((await q1("SELECT count(*)::int n FROM notifications WHERE type = 'article_fix_failed'")).n, 1);
  assert.equal((await FX.history(id)).parked, true, 'and it does not come back on its own');
});

test('checks that never ran: the bot runs them, finds the subject-level warning, and stops BEFORE the paid rewrite (the repair would not change it)', opts, async () => {
  const m = fakeModels(); m.st.override.review = SENSITIVE_REVIEW;
  const { id } = await draft(m);
  await q('UPDATE articles SET fact_checked_at = NULL, quality_score = NULL, adsense_risk = NULL WHERE id = $1', [id]); await q('DELETE FROM article_checks WHERE article_id = $1', [id]);
  const r = await run(id, m);
  assert.equal(r.result, 'needs_person'); assert.deepEqual(r.steps.map((s) => s.step), ['checks', 'person']);
  assert.equal(m.byRole('fix').length, 0, 'no rewrite was paid for');
  assert.equal((await q1("SELECT used FROM daily_work_usage WHERE work_type = 'article_fix' AND scope = 'global'")).used, 1, 'the check run did use the day\'s place');
});

test('with automatic approval on, a draft with NO blocker (for example after a person accepted its AdSense warning) is approved by the next pass at no cost; with it off the bot leaves it alone', opts, async () => {
  const m = fakeModels(); m.st.override.review = SENSITIVE_REVIEW;
  const { pid, id } = await draft(m);
  assert.deepEqual((await FX.candidates(pid)).map((c) => c.id), [id], 'blocked by the subject-level AdSense class: the bot sees it (and hands it to a person)');
  await A.acceptAdsense(id);                                               // the person accepts the reviewer's class
  assert.deepEqual(await FX.candidates(pid), [], 'manual approval is on: nothing for the bot to do');
  const cur = (await S.get('quality')).value; await S.set('quality', { ...cur, manualApprovalNewArticles: false }, { scope: 'global' });
  const found = await FX.candidates(pid); assert.deepEqual(found.map((c) => [c.id, c.problems.length]), [[id, 0]]);
  const calls = m.calls.length; const pass = await FX.runPass(pid, { fetchImpl: m.fetchImpl, now: NOW });
  assert.equal(pass.stats.approved, 1); assert.equal(m.calls.length, calls, 'approving a clean draft asks no model'); assert.equal((await q1('SELECT status FROM articles WHERE id = $1', [id])).status, 'ready');
  assert.equal((await q1("SELECT count(*)::int n FROM daily_work_usage WHERE work_type = 'article_fix'")).n, 0);
});
