const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { fakeModels, PAGE, sectionHtml } = require('./fakeModels');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const O = require('../../src/content/services/opportunities');
const PR = require('../../src/content/services/providers');
const L = require('../../src/content/services/limits');
const A = require('../../src/content/services/articles');
const W = require('../../src/content/services/writer');
const CMP = require('../../src/content/services/comparisons');
const NT = require('../../src/content/services/notifications');
const { FetchError } = require('../../src/content/lib/safeFetch');

/**
 * Phase 7c, the blind writer comparison: one idea, the same material and instructions to 2-3 ready vendors, the drafts read as A / B / C WITHOUT the vendor, one is picked (or none),
 * and only then who wrote what is shown. The promises: nothing that could give a vendor away leaves the server before the decision, only the picked draft becomes an article,
 * the place of the day is held (and given back when nothing is picked), and the tally of decisions is called what it is: the owner's preference.
 */
const opts = { skip: H.skip };
const NOW = new Date('2026-11-21T12:00:00Z');
const KEY = { anthropic: 'sk-ant-test-key-0123456789', openai: 'sk-test-key-0123456789abcdef', gemini: 'AIzaSyTestKey0123456789abcdef' };
const done = async (pid, workType) => (await L.status({ projectId: pid, now: NOW })).items.find((i) => i.workType === workType).done;
test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d || 'Fri, 21 Nov 2026 10:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;
const feeds = (map) => async (url) => { if (!map[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: map[url], url }; };
async function withEvent(pid) {
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await N.runDiscovery(pid, { fetchImpl: feeds({ 'https://a.example/feed': rssOf([['OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1']]), 'https://b.example/feed': rssOf([['ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1']]) }), now: NOW });
}
async function vendors(n = 3) {
  await PR.save('anthropic', { secret: KEY.anthropic, extra: { inputPricePerM: '3', outputPricePerM: '15' } });
  if (n >= 2) await PR.save('openai', { secret: KEY.openai, extra: { model: 'gpt-test' } });
  if (n >= 3) await PR.save('gemini', { secret: KEY.gemini, extra: { model: 'gemini-test', inputPricePerM: '1', outputPricePerM: '4' } });
}
async function idea(pid) { await withEvent(pid); await O.refresh(pid, { now: NOW }); await H.db().query("UPDATE content_opportunities SET eligible = true, ineligible_reason = ''"); return (await O.list(pid)).items[0]; }
const pageFetcher = async (url) => { if (url === 'https://b.example/1') throw new FetchError('http', 'HTTP 403', { status: 403 }); return { body: PAGE() }; };
/** each vendor writes a DIFFERENT text (a marker in the body, a different length) so a pick can be traced to its vendor */
const TAG = { anthropic: 'zulu', openai: 'xray', gemini: 'yankee' };          // neutral words: the text itself must not name the vendor, or the blind test would test the fixture
function distinct(m, lengths = { anthropic: 1, openai: 2, gemini: 3 }) {
  m.st.override.write = (user) => { const v = m.calls[m.calls.length - 1].vendor; const t = TAG[v]; const kw = (/FOCUS KEYWORD \(use exactly this phrase\): (.+)/.exec(user) || [])[1] || 'the topic';
    return { seoTitle: `${kw}: ${t} view`, h1: `${kw}: the ${t} take`, slug: `${kw.replace(/ /g, '-')}-${t}`, metaDescription: `What ${kw} means for readers, written by the ${t} desk, in plain words and with the facts that matter most.`, focusKeyword: kw, secondaryKeywords: [], excerpt: `A look at ${kw}.`,
      articleType: 'latest_update', contentHtml: `${sectionHtml(kw)}${`<p>Marker ${t} paragraph about ${kw} and what readers should do next with care.</p>`.repeat(lengths[v])}`, faq: [{ q: 'Will it change?', a: 'Existing subscribers keep the current price through December.' }], tags: ['ai'] }; };
}
const go = (id, m, o = {}) => CMP.start(id, { fetchImpl: m.fetchImpl, fetcher: pageFetcher, now: NOW, background: false, ...o });
const ALL_VENDOR_WORDS = /anthropic|openai|gemini|claude|gpt|sk-ant|cost|tokens|duration|model|provider/i;

test('guards: two ready vendors are needed, only ready known ones can be asked, an unfit or already open idea is refused, and the day\'s place is held', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(1); const i = await idea(pid); const m = fakeModels();
  await assert.rejects(go(i.id, m), (e) => e.status === 409 && /en az 2 hazır yapay zekâ sağlayıcısı gerekir \(şu an hazır: 1\)/.test(e.message)); assert.equal(m.calls.length, 0, 'nothing was asked'); assert.equal(await done(pid, 'new_article'), 0);
  await vendors(3); await assert.rejects(go(i.id, m, { providers: ['anthropic'] }), /en az 2/); await assert.rejects(go(i.id, m, { providers: ['anthropic', 'nobody'] }), (e) => e.status === 400 && /Bilinmeyen sağlayıcı/.test(e.message));
  await assert.rejects(go(i.id, m, { providers: 'anthropic' }), /liste/); await assert.rejects(go('00000000-0000-0000-0000-000000000001', m), /bulunamadı/);
  await H.db().query("UPDATE content_opportunities SET eligible = false, ineligible_reason = 'low score'"); await assert.rejects(go(i.id, m), /üretime uygun değil: low score/); await H.db().query("UPDATE content_opportunities SET eligible = true");
  await PR.save('gemini', { clearSecret: true }); await assert.rejects(go(i.id, m, { providers: ['anthropic', 'gemini'] }), (e) => e.status === 409 && /\(Gemini\) kullanılamıyor/.test(e.message)); await vendors(3);
  distinct(m); const r = await go(i.id, m); assert.equal(r.askedCount, 3); assert.equal(await done(pid, 'new_article'), 1, 'ONE place for the whole comparison, not three');
  assert.equal((await H.db().query('SELECT status FROM content_opportunities WHERE id = $1', [i.id])).rows[0].status, 'queued', 'the idea is taken: the normal writer cannot start on it meanwhile');
  await assert.rejects(W.start(i.id, { fetchImpl: m.fetchImpl, fetcher: pageFetcher, now: NOW, background: false }), /şu anda yazılıyor/); await assert.rejects(go(i.id, m), /şu anda yazılıyor/);
});

test('blind: nothing that could give a vendor away leaves before the decision (name, model, cost, tokens, time, error text), the letters are in a random order, the measured numbers are there', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(3); const i = await idea(pid); const m = fakeModels(); distinct(m); m.st.fail['gemini:write'] = { status: 401, type: 'invalid_api_key', message: 'Gemini says your key is bad' };
  const r = await go(i.id, m, { rng: () => 0 });
  const c = await CMP.load(r.id);
  const allowed = ['seoTitle', 'h1', 'slug', 'metaDescription', 'focusKeyword', 'secondaryKeywords', 'excerpt', 'articleType', 'contentHtml', 'faq', 'tags', 'image'];     // `image` = the scene the writer proposes for the cover picture (no vendor in it)
  for (const e of c.entries.filter((x) => x.ok)) assert.deepEqual(Object.keys(e.fields).filter((k) => !allowed.includes(k)), [], 'only article fields, nothing about the writer');
  const wire = JSON.stringify({ ...c, idea: undefined, entries: c.entries.map((e) => ({ ...e, fields: e.fields ? Object.keys(e.fields) : null })) });          // everything EXCEPT the article text (a text may legitimately talk about OpenAI: the news is about it)
  assert.deepEqual([c.status, c.blind, c.comparable, c.entries.map((e) => e.label), c.entries.map((e) => e.ok)].slice(0, 4), ['ready', true, true, ['A', 'B', 'C']], 'two usable drafts and one that failed'); assert.equal(c.entries.filter((e) => e.ok).length, 2);
  assert.ok(!ALL_VENDOR_WORDS.test(wire), `a vendor word leaked: ${(ALL_VENDOR_WORDS.exec(wire) || [])[0]}`);
  for (const e of c.entries) for (const k of ['provider', 'model', 'costUsd', 'inputTokens', 'outputTokens', 'durationMs']) assert.ok(!(k in e), `${k} must not be in a blind entry`);
  assert.ok(!('providers' in c) && c.askedCount === 3, 'who was asked is hidden too');
  const bad = c.entries.find((e) => !e.ok); assert.equal(bad.error, 'Bu taslak yazılamadı (ayrıntı karardan sonra gösterilir)'); assert.equal(bad.fields, null);
  // the drafts carry what a reader needs plus the free numbers
  const good = c.entries.find((e) => e.ok); assert.ok(good.fields.h1 && good.fields.contentHtml.includes('<h2>') && good.fields.faq.length === 1);
  assert.ok(good.measured.words > 100 && good.measured.h2 >= 3 && good.measured.readability !== null && good.measured.seoTitleChars > 0 && ['ok', 'warn', 'fail'].includes(good.measured.rules.status) && Array.isArray(good.measured.rules.problems), JSON.stringify(good.measured));
  // the three drafts are different texts
  const texts = c.entries.filter((e) => e.ok).map((e) => e.fields.contentHtml); assert.equal(new Set(texts).size, 2);
  // a decided one shows everything
  const lines = (await H.db().query('SELECT label, provider FROM writer_comparison_entries WHERE comparison_id = $1 ORDER BY label', [r.id])).rows; assert.equal(new Set(lines.map((x) => x.provider)).size, 3, 'the mapping exists on the server, one vendor per letter');
});

test('the letters are assigned in a random order: each vendor lands on each letter about a third of the time', opts, async () => {
  const counts = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0] };
  for (let n = 0; n < 6000; n++) { const s = CMP.shuffle(['a', 'b', 'c']); s.forEach((v, pos) => { counts[v][pos]++; }); }
  for (const v of Object.keys(counts)) for (const pos of [0, 1, 2]) assert.ok(counts[v][pos] > 1700 && counts[v][pos] < 2300, `${v} at ${pos}: ${counts[v][pos]} of 6000`);
  assert.deepEqual(CMP.shuffle(['a', 'b', 'c'], () => 0), ['b', 'c', 'a'], 'a fixed random source gives a fixed order (what the tests use)'); assert.deepEqual(CMP.shuffle([], () => 0), []);
});

test('picking: only the chosen draft becomes an article (with its checks, a different checker, the shared sources), then everything is revealed; a second decision is refused', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(3); const i = await idea(pid); const m = fakeModels(); distinct(m); const r = await go(i.id, m);
  assert.equal((await H.db().query('SELECT count(*)::int n FROM articles')).rows[0].n, 0, 'the drafts are NOT articles');
  const blindNow = await CMP.load(r.id); const chosen = blindNow.entries[1]; const truth = (await H.db().query("SELECT provider, model, cost_micros FROM writer_comparison_entries WHERE comparison_id = $1 AND label = $2", [r.id, chosen.label])).rows[0];
  await assert.rejects(CMP.pick(r.id, 'D', { fetchImpl: m.fetchImpl }), /Taslak/); await assert.rejects(CMP.pick('00000000-0000-0000-0000-000000000001', 'A'), /bulunamadı/);
  const out = await CMP.pick(r.id, chosen.label.toLowerCase(), { fetchImpl: m.fetchImpl, now: NOW, background: false });
  assert.equal(out.comparison.status, 'picked'); assert.equal(out.comparison.blind, false); assert.equal(out.comparison.pickedLabel, chosen.label);
  const a = await A.get(out.articleId); assert.deepEqual([a.status, a.createdBy, a.generation.provider, a.generation.blindPick, a.generation.comparisonId], ['needs_review', 'ai', truth.provider, chosen.label, r.id]);
  assert.ok(a.contentHtml.includes(`Marker ${TAG[truth.provider]} paragraph`), 'it is the text of the picked vendor'); assert.ok(a.qualityScore !== null && a.factCheckedAt !== null, 'the mandatory checks ran on it'); assert.notEqual(a.generation.checker, truth.provider, 'another vendor checks it');
  assert.equal((await H.db().query('SELECT count(*)::int n FROM articles')).rows[0].n, 1, 'still one article'); assert.ok((await A.get(out.articleId)).sources.length >= 1, 'the shared research material comes with it');
  const rev = out.comparison; assert.deepEqual(rev.providers.slice().sort(), ['anthropic', 'gemini', 'openai']); const e = rev.entries.find((x) => x.label === chosen.label); assert.deepEqual([e.provider, e.model], [truth.provider, truth.model]); assert.ok(rev.entries.every((x) => x.durationMs >= 0));
  assert.equal(rev.entries.find((x) => x.provider === 'anthropic').costUsd > 0, true); assert.equal(rev.entries.find((x) => x.provider === 'openai').costUsd, null, 'a vendor without prices: cost unknown, not 0');
  assert.equal((await H.db().query('SELECT status, article_id FROM content_opportunities WHERE id = $1', [i.id])).rows[0].status, 'written'); assert.equal(await done(pid, 'new_article'), 1);
  await assert.rejects(CMP.pick(r.id, 'A'), /karar zaten verildi/); await assert.rejects(CMP.discard(r.id), /karar zaten verildi/);
  assert.ok((await NT.list({})).items.some((n) => n.type === 'article_ready' && /Karşılaştırmada seçtiğiniz/.test(n.body)));
  const load = await CMP.load(r.id); assert.equal(load.blind, false, 'after the decision it stays revealed');
});

test('discarding: nothing becomes an article, the vendors are shown, the idea is free again and the day\'s place is given back (the calls were still paid for)', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(2); const i = await idea(pid); const m = fakeModels(); distinct(m); const r = await go(i.id, m);
  assert.equal(await done(pid, 'new_article'), 1); const usageBefore = (await H.db().query("SELECT count(*)::int n FROM api_usage WHERE operation = 'article_write'")).rows[0].n; assert.equal(usageBefore, 2);
  const d = await CMP.discard(r.id, { note: 'both read like a press release' }); assert.deepEqual([d.status, d.blind, d.note, d.providers.slice().sort()], ['discarded', false, 'both read like a press release', ['anthropic', 'openai']]);
  assert.equal(await done(pid, 'new_article'), 0, 'the place is back'); assert.equal((await H.db().query('SELECT count(*)::int n FROM articles')).rows[0].n, 0);
  assert.equal((await H.db().query('SELECT status FROM content_opportunities WHERE id = $1', [i.id])).rows[0].status, 'new', 'the idea is as before');
  await assert.rejects(CMP.discard(r.id), /karar zaten verildi/); await assert.rejects(CMP.pick(r.id, 'A'), /karar zaten verildi/);
  const again = await go(i.id, m); assert.ok(again.id !== r.id, 'a new comparison of the same idea may be started once the old one is decided');
});

test('failures: one vendor failing is shown as a failed draft (blind) and the others still compare; a single draft is flagged not comparable; all failing gives the place back unless a call was billed', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(3); const i = await idea(pid); const m = fakeModels(); distinct(m);
  m.st.fail['anthropic:write'] = { status: 401, message: 'bad key' }; m.st.fail['openai:write'] = { status: 401, message: 'bad key' };
  let r = await go(i.id, m); let c = await CMP.load(r.id); assert.deepEqual([c.status, c.comparable, c.entries.filter((e) => e.ok).length], ['ready', false, 1]);
  const lone = c.entries.find((e) => e.ok); const picked = await CMP.pick(r.id, lone.label, { fetchImpl: m.fetchImpl, now: NOW, background: false }); assert.equal(picked.comparison.status, 'picked', 'one usable draft can still be taken');
  // everything fails (nothing billed): failed, place back, idea free
  await H.clean(); const pid2 = (await P.seedDefault()).projectId; await vendors(3); const i2 = await idea(pid2); const m2 = fakeModels(); for (const v of ['anthropic', 'openai', 'gemini']) m2.st.fail[`${v}:write`] = { status: 401, message: 'bad key' };
  r = await go(i2.id, m2); c = await CMP.load(r.id); assert.deepEqual([c.status, c.blind, /Hiçbir sağlayıcı taslak veremedi/.test(c.error)], ['failed', false, true]); assert.equal(await done(pid2, 'new_article'), 0, 'nothing was billed: the place is back');
  assert.equal((await H.db().query('SELECT status FROM content_opportunities WHERE id = $1', [i2.id])).rows[0].status, 'new');
  assert.ok(c.entries.every((e) => !e.ok && /reddedildi|401|anahtar/i.test(e.error)), 'after the decision the real error is shown');
  // billed but unusable output (a model that answers without an article): the place stays used
  await H.clean(); const pid3 = (await P.seedDefault()).projectId; await vendors(2); const i3 = await idea(pid3); const m3 = fakeModels(); m3.st.override.write = { seoTitle: 'x' };
  r = await go(i3.id, m3); c = await CMP.load(r.id); assert.equal(c.status, 'failed'); assert.equal(await done(pid3, 'new_article'), 1, 'the calls were answered (and billed): the place stays used'); assert.equal((await H.db().query('SELECT status FROM content_opportunities WHERE id = $1', [i3.id])).rows[0].status, 'new');
  // an idea without readable sources fails before any call
  await H.clean(); const pid4 = (await P.seedDefault()).projectId; await vendors(2); const i4 = await idea(pid4); await H.db().query('UPDATE topics SET cluster_id = NULL'); const m4 = fakeModels();
  r = await go(i4.id, m4); assert.equal((await CMP.load(r.id)).status, 'failed'); assert.equal(m4.calls.length, 0); assert.equal(await done(pid4, 'new_article'), 0);
});

test('a pick that cannot complete is undone: the comparison goes back to "ready" so it can be tried again', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(2); const i = await idea(pid); const m = fakeModels(); distinct(m); const r = await go(i.id, m);
  const lab = (await CMP.load(r.id)).entries[0].label; await PR.save('anthropic', { clearSecret: true }); await PR.save('openai', { clearSecret: true });
  await assert.rejects(CMP.pick(r.id, lab, { fetchImpl: m.fetchImpl, now: NOW }), /gerekli|kullanılamıyor/); assert.equal((await CMP.load(r.id)).status, 'ready', 'not stuck in "picking"'); assert.equal((await H.db().query('SELECT count(*)::int n FROM articles')).rows[0].n, 0);
  await vendors(2); assert.equal((await CMP.pick(r.id, lab, { fetchImpl: m.fetchImpl, now: NOW, background: false })).comparison.status, 'picked');
  // two picks at once: exactly one wins
  await H.clean(); const pid2 = (await P.seedDefault()).projectId; await vendors(2); const i2 = await idea(pid2); const m2 = fakeModels(); distinct(m2); const r2 = await go(i2.id, m2);
  const res = await Promise.allSettled([CMP.pick(r2.id, 'A', { fetchImpl: m2.fetchImpl, now: NOW, background: false }), CMP.pick(r2.id, 'B', { fetchImpl: m2.fetchImpl, now: NOW, background: false })]);
  assert.deepEqual(res.map((x) => x.status).sort(), ['fulfilled', 'rejected']); assert.equal((await H.db().query('SELECT count(*)::int n FROM articles')).rows[0].n, 1, 'one article, not two');
});

test('the tally is only your preference: it appears from three decisions, counts what was shown and picked, keeps unknown costs apart, and says it is not a quality measurement', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(3); assert.deepEqual([(await CMP.stats()).decisions, (await CMP.stats()).leader], [0, null]); assert.match((await CMP.stats()).note, /En az 3 karardan sonra/);
  const i = await idea(pid);
  const decided = async (status, pickedLabel, entries) => { const c = (await H.db().query("INSERT INTO writer_comparisons (project_id, opportunity_id, providers, status, picked_label, decided_at) VALUES ($1,$2,'{anthropic,openai,gemini}',$3,$4, now()) RETURNING id", [pid, i.id, status, pickedLabel])).rows[0];
    for (const [label, provider, st, cost, words] of entries) await H.db().query("INSERT INTO writer_comparison_entries (comparison_id, label, provider, status, fields, measured, cost_micros) VALUES ($1,$2,$3,$4,$5,$6,$7)", [c.id, label, provider, st, st === 'ok' ? '{}' : null, st === 'ok' ? JSON.stringify({ words }) : null, cost]); return c.id; };
  const E = (a, b, c) => [['A', a, 'ok', a === 'anthropic' ? 40000 : null, 900], ['B', b, 'ok', b === 'anthropic' ? 40000 : null, 1100], ['C', c, 'ok', c === 'anthropic' ? 40000 : null, 1000]];
  await decided('picked', 'B', E('openai', 'anthropic', 'gemini')); await decided('picked', 'A', E('anthropic', 'gemini', 'openai')); assert.equal((await CMP.stats(pid)).leader, null, 'two decisions are not a trend');
  await decided('discarded', null, E('gemini', 'openai', 'anthropic')); await decided('picked', 'C', [['A', 'openai', 'error', null, null], ['B', 'gemini', 'ok', null, 800], ['C', 'anthropic', 'ok', 40000, 1200]]);
  const s = await CMP.stats(pid); assert.deepEqual([s.decisions, s.picks, s.none, s.leader], [4, 3, 1, 'anthropic']);
  const an = s.providers.find((p) => p.provider === 'anthropic'); const oa = s.providers.find((p) => p.provider === 'openai'); const ge = s.providers.find((p) => p.provider === 'gemini');
  assert.deepEqual([an.shown, an.picked, an.pickRate, oa.shown, oa.picked, ge.picked], [4, 3, 75, 3, 0, 0], 'a draft that failed was never shown, so it is not counted as a loss'); assert.equal(oa.avgCostUsd, null, 'no prices: unknown, never 0'); assert.equal(oa.unknownCostDrafts, 3); assert.equal(an.avgCostUsd, 0.04); assert.equal(an.avgWords, 1050);
  assert.match(s.note, /YALNIZCA sizin seçimlerinizdir.*kalite ölçümü değildir/); assert.equal(s.providers[0].provider, 'anthropic', 'sorted by picks');
  // an open comparison leaks nothing into the tally and is blind in the list
  const m = fakeModels(); distinct(m); await H.db().query("DELETE FROM writer_comparisons WHERE status IN ('picked', 'discarded') AND false"); await go(i.id, m);
  assert.equal((await CMP.stats(pid)).decisions, 4); const list = await CMP.list(pid); assert.equal(list.length, 5);
  const open = list.find((c) => c.status === 'ready'); assert.ok(open.blind && open.entries.every((e) => !('provider' in e) && !('costUsd' in e)), 'the list is blind for an open one'); assert.ok(list.filter((c) => c.status !== 'ready').every((c) => c.entries.every((e) => 'provider' in e)));
});

test('a comparison that was running when the process died is closed (its idea is free again); an old stuck pick returns to "ready"', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await vendors(2); const i = await idea(pid);
  const c = (await H.db().query("INSERT INTO writer_comparisons (project_id, opportunity_id, providers, prev_status, created_at) VALUES ($1,$2,'{anthropic,openai}','new', now() - interval '1 hour') RETURNING id", [pid, i.id])).rows[0];
  await H.db().query("UPDATE content_opportunities SET status = 'queued' WHERE id = $1", [i.id]); assert.equal(await CMP.closeStale(), 1);
  assert.deepEqual([(await CMP.load(c.id)).status, (await H.db().query('SELECT status FROM content_opportunities WHERE id = $1', [i.id])).rows[0].status], ['failed', 'new']);
  const p = (await H.db().query("INSERT INTO writer_comparisons (project_id, opportunity_id, providers, status, created_at) VALUES ($1,$2,'{anthropic,openai}','picking', now() - interval '3 hours') RETURNING id", [pid, i.id])).rows[0]; assert.equal(await CMP.closeStale(), 1); assert.equal((await CMP.load(p.id)).status, 'ready');
});
