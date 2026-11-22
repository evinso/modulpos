process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');
const { fakeModels, SRC } = require('./fakeModels');
const { startFakeWp } = require('./fakeWordPress');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const PR = require('../../src/content/services/providers');
const HL = require('../../src/content/services/health');
const RF = require('../../src/content/services/refresh');
const PB = require('../../src/content/services/publishing');
const SI = require('../../src/content/services/sites');
const SC = require('../../src/content/services/scheduler');
const NT = require('../../src/content/services/notifications');
const R = require('../../src/content/services/runs');

/**
 * Phase 6a: link checks, content health, the refresh engine (update proposals, approval policy, applying as a new version of the SAME article and post) and version comparison.
 * Links are checked against a small real HTTP server; models are the fake vendors; the WordPress is the fake WordPress of phase 5.
 */
const opts = { skip: H.skip };
const NOW = new Date();
const plus = (d, days) => new Date(d.getTime() + days * 86400000);
let links; let wp;

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => {
  if (H.skip) return;
  await H.clean();
  if (links) await new Promise((r) => { links.closeAllConnections && links.closeAllConnections(); links.close(r); });
  links = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/ok') { res.writeHead(200); return res.end(req.method === 'HEAD' ? undefined : 'fine'); }
    if (path === '/gone') { res.writeHead(404); return res.end('no'); }
    if (path === '/removed') { res.writeHead(410); return res.end('no'); }
    if (path === '/nohead') { if (req.method === 'HEAD') { res.writeHead(405); return res.end(); } res.writeHead(200); return res.end('body'); }
    if (path === '/moved') { res.writeHead(301, { Location: '/ok' }); return res.end(); }
    if (path === '/forbidden') { res.writeHead(403); return res.end('bots not welcome'); }
    if (path === '/busy') { res.writeHead(503); return res.end(); }
    res.writeHead(404); return res.end();
  });
  await new Promise((r) => links.listen(0, '127.0.0.1', r)); links.url = `http://127.0.0.1:${links.address().port}`;
  if (wp) await wp.close(); wp = await startFakeWp();
});
test.after(async () => { if (!H.skip) { if (links) await new Promise((r) => { links.closeAllConnections && links.closeAllConnections(); links.close(r); }); if (wp) await wp.close(); await H.close(); } });

const setup = async () => (await P.seedDefault()).projectId;
let seq = 0;
/** a live article (status ready by default) with the given links in its text and one source whose page text is the standard one */
async function live(pid, o = {}) {
  seq++; const cats = await P.listCategories(pid);
  const body = (o.links || []).map((u, i) => `<p>See <a href="${u}">reference ${i}</a> for background.</p>`).join('');
  const a = await A.create({ projectId: pid, h1: o.title || `ChatGPT Plus pricing guide ${seq}`, seoTitle: `ChatGPT Plus pricing guide ${seq}`, metaDescription: 'm'.repeat(100), focusKeyword: o.focus || `chatgpt plus pricing ${seq}`, categoryId: cats[0].id,
    contentHtml: `<h2>The price</h2><p>${Array.from({ length: 40 }, (_, i) => `Note ${seq}-${i}: ChatGPT Plus is a paid plan and its price is 20 dollars a month today for subscriber group ${seq}-${i}.`).join(' ')}</p>${body}`, articleType: o.type || 'latest_update', tags: ['ai'], faq: [] });
  await H.db().query("UPDATE articles SET status = $2, fact_checked_at = now(), adsense_risk = 'low', quality_score = 90, created_by = $3, manual_edited = $4, created_at = $5, last_updated_at = $5 WHERE id = $1", [a.id, o.status || 'ready', o.createdBy || 'ai', o.manual === true, o.createdAt || plus(NOW, -3)]);
  await H.db().query("INSERT INTO article_sources (article_id, url, title, publisher, excerpt, reliability, read_ok, position) VALUES ($1, $2, 'Original report', 'Outlet A', $3, 80, true, 1)", [a.id, `${links.url}/ok`, SRC]);
  return A.get(a.id);
}
const news = async (pid, title, o = {}) => H.db().query(`INSERT INTO news_items (project_id, url, url_hash, title, source_name, reliability, status, relevance, published_at, fetched_at) VALUES ($1,$2,$3,$4,$5,$6,'relevant',80,$7,$7)`,
  [pid, o.url || `https://news.example/${Math.random().toString(36).slice(2)}`, Math.random().toString(36).slice(2), title, o.source || 'Outlet B', o.reliability ?? 80, o.at || new Date()]);

test('link check: gone pages are broken, blocked or busy ones are only "unknown", a refused HEAD falls back to GET, redirects are followed and named; stale rows disappear', opts, async () => {
  const pid = await setup(); const a = await live(pid, { links: [`${links.url}/ok`, `${links.url}/gone`, `${links.url}/removed`, `${links.url}/nohead`, `${links.url}/moved`, `${links.url}/forbidden`, `${links.url}/busy`, 'ftp://not-http.example/x'] });
  const r = await HL.checkLinks(a.id); assert.deepEqual([r.checked, r.broken.map((b) => b.url.replace(links.url, '')).sort(), r.redirects, r.unknown], [7, ['/gone', '/removed'], 1, 2]);
  const rows = Object.fromEntries((await H.db().query('SELECT url, status, http_status, final_url, note FROM link_checks WHERE article_id = $1', [a.id])).rows.map((x) => [x.url.replace(links.url, ''), x]));
  assert.deepEqual([rows['/ok'].status, rows['/nohead'].status, rows['/nohead'].http_status, rows['/moved'].status, rows['/moved'].final_url.replace(links.url, ''), rows['/forbidden'].status, rows['/busy'].status], ['ok', 'ok', 200, 'redirect', '/ok', 'error', 'error']);
  assert.match(rows['/gone'].note, /404/); assert.match(rows['/removed'].note, /410/); assert.match(rows['/forbidden'].note, /anlaşılamadı/);
  await A.update(a.id, { contentHtml: `<h2>Short</h2>${'<p>no links now, only plain sentences for the reader.</p>'.repeat(20)}` }); await HL.checkLinks(a.id);
  assert.deepEqual((await H.db().query('SELECT url FROM link_checks WHERE article_id = $1', [a.id])).rows.map((x) => x.url.replace(links.url, '')), ['/ok'], 'the links the text no longer has are forgotten; the source stays');
  assert.deepEqual(HL.linksOf('<a href="https://a.test/x">x</a> <a href=\'http://b.test/y\'>y</a> <a href="mailto:z@z.z">z</a> <a href="/rel">r</a> <a href="https://a.test/x">dup</a>'), ['https://a.test/x', 'http://b.test/y']);
});

test('assessment: only EVIDENCE flags an article (a broken link, new relevant developments from a reliable outlet that are not its own sources); being old alone never does; the timetable moves on', opts, async () => {
  const pid = await setup(); const old = await live(pid, { createdAt: plus(NOW, -200), focus: 'chatgpt plus pricing zeta' });
  let c = await HL.checkOne(old.id, { now: NOW }); assert.deepEqual([c.flagged, c.assessment.overdue, c.assessment.overdueDays > 100, c.assessment.needsUpdate, (await A.get(old.id)).status], [false, true, true, false, 'ready'], 'old but no evidence: left alone');
  const row = (await H.db().query('SELECT last_checked_at, next_check_at, health FROM articles WHERE id = $1', [old.id])).rows[0]; assert.ok(row.next_check_at > row.last_checked_at); assert.equal(row.health.overdueDays > 100, true);
  await news(pid, 'ChatGPT Plus pricing zeta changes again in January', { reliability: 40 }); await news(pid, 'Totally unrelated story about cats', { reliability: 90 });
  assert.equal((await HL.assess(old.id, { now: NOW })).developments.length, 0, 'a weak outlet and an unrelated headline are not evidence');
  await news(pid, 'ChatGPT Plus pricing zeta: OpenAI confirms a new tier', { reliability: 85 }); await news(pid, 'Older piece ChatGPT Plus pricing zeta', { reliability: 85, at: plus(NOW, -300) });
  await H.db().query("INSERT INTO news_items (project_id, url, url_hash, title, source_name, reliability, status, relevance, published_at, fetched_at) VALUES ($1, $2, 'h-own', 'ChatGPT Plus pricing zeta own source story', 'Outlet A', 90, 'relevant', 80, now(), now())", [pid, `${links.url}/ok`]);
  const as = await HL.assess(old.id, { now: NOW }); assert.deepEqual([as.developments.length, as.developments[0].title.startsWith('ChatGPT Plus pricing zeta: OpenAI'), as.signals.map((s) => s.code)], [1, true, ['developments']]);
  c = await HL.checkOne(old.id, { now: NOW }); assert.deepEqual([c.flagged, (await A.get(old.id)).status], [true, 'needs_update']);
  const broken = await live(pid, { links: [`${links.url}/gone`], status: 'published' }); c = await HL.checkOne(broken.id, { now: NOW }); assert.deepEqual([c.flagged, c.assessment.signals[0].code, c.links.broken.length, (await A.get(broken.id)).status], [true, 'broken_links', 1, 'needs_update']);
  const fine = await live(pid, { links: [`${links.url}/ok`], createdAt: NOW }); assert.equal((await HL.checkOne(fine.id, { now: NOW })).flagged, false);
  assert.deepEqual(HL.due ? (await HL.due(pid, { now: NOW, limit: 10 })).length : 0, 0, 'everything was just looked at'); assert.equal((await HL.due(pid, { now: plus(NOW, 30), limit: 10 })).length, 3, 'a month later all three are due again');
  assert.deepEqual([HL.classOf('breaking_news_explainer'), HL.classOf('latest_update', 'AI Tools & Updates'), HL.classOf('how_to_guide', 'AI Tools'), HL.classOf('how_to_guide', 'Privacy'), HL.classOf('comparison'), HL.classOf('evergreen_guide')], ['breaking', 'aiTools', 'aiTools', 'guides', 'comparisons', 'evergreen']);
});

test('health overview: counts that mean something, the list in update order (critical proposals, broken links, developments, AdSense risk, overdue), nothing invented about performance', opts, async () => {
  const pid = await setup();
  const a = await live(pid, { status: 'published', links: [`${links.url}/gone`] }); const b = await live(pid, { status: 'published', createdAt: plus(NOW, -400) }); const c = await live(pid, { status: 'ready' }); await live(pid, { status: 'needs_review' });
  await H.db().query("UPDATE articles SET adsense_risk = 'review' WHERE id = $1", [c.id]); await HL.checkOne(a.id, { now: NOW });
  const o = await HL.overview(pid, { now: NOW });
  assert.deepEqual([o.counts.published, o.counts.live, o.counts.awaitingUpdate, o.counts.withBrokenLinks, o.counts.adsenseRisky, o.counts.criticalPending, o.counts.outdated, o.counts.neverChecked], [1, 3, 1, 1, 1, 0, 1, 2]);
  assert.deepEqual(o.items.map((i) => i.id), [a.id, b.id, c.id].sort((x, y) => o.items.findIndex((i) => i.id === x) - o.items.findIndex((i) => i.id === y)), 'sorted'); assert.equal(o.items[0].id, a.id, 'broken link + flagged first');
  assert.ok(o.items.find((i) => i.id === b.id).overdueDays > 300); assert.equal(o.performance.connected, false); assert.match(o.performance.note, /uydurulmaz/);
  await H.db().query("INSERT INTO refresh_proposals (project_id, article_id, kind, base_version, proposed) VALUES ($1, $2, 'critical', 1, '{}')", [pid, c.id]); const o2 = await HL.overview(pid, { now: NOW }); assert.deepEqual([o2.items[0].id, o2.counts.criticalPending, o2.counts.openProposals], [c.id, 1, 1], 'a critical correction waiting goes first');
});

async function ready(pid) { await L.setGlobalLimits({ refresh: 50 }); await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789', extra: { inputPricePerM: '3', outputPricePerM: '15' } }); await S.set('quality', { minScore: 50 }); }
const flagged = async (pid, o = {}) => { const a = await live(pid, { links: [`${links.url}/gone`], ...o }); await HL.checkOne(a.id, { now: NOW }); return A.get(a.id); };

test('proposal: no evidence = no proposal and no place used; with evidence the model drafts, the SAME mandatory checks judge the PROPOSED text, and the article is untouched until a decision', opts, async () => {
  const pid = await setup(); await ready(pid); const m = fakeModels(); await S.set('update', { policy: 'manual' });
  const calm = await live(pid, { links: [`${links.url}/ok`] }); await HL.checkOne(calm.id, { now: NOW }); const calls0 = m.calls.length;
  const none = await RF.propose(calm.id, { fetchImpl: m.fetchImpl, now: NOW }); assert.deepEqual([none.status, m.calls.length, (await L.status({ projectId: pid })).items.find((i) => i.workType === 'refresh').done], ['no_evidence', calls0, 0]);
  const a = await flagged(pid); const v0 = a.currentVersion;
  const r = await RF.propose(a.id, { fetchImpl: m.fetchImpl, now: NOW }); assert.equal(r.status, 'proposed'); const p = r.proposal;
  assert.deepEqual([p.kind, p.status, p.baseVersion, p.diffStats.added > 0, p.reasons.length >= 1, p.checks.rules !== 'fail', p.checks.fact, p.checks.risk, typeof p.checks.quality], ['minor', 'proposed', v0, true, true, true, 'ok', 'low', 'number']);
  assert.deepEqual(m.calls.map((c) => c.role), ['update', 'fact', 'review']); assert.ok(m.byRole('update')[0].user.includes('DETECTED ISSUES') && /broken|bozuk|bağlantı/i.test(m.byRole('update')[0].user)); assert.match(m.byRole('update')[0].system, /untrusted data/);
  const now = await A.get(a.id); assert.deepEqual([now.currentVersion, now.contentHtml.includes('Update: the plan details'), now.status], [v0, false, 'needs_update'], 'nothing changed yet');
  assert.equal((await L.status({ projectId: pid })).items.find((i) => i.workType === 'refresh').done, 1);
  await assert.rejects(RF.propose(a.id, { fetchImpl: m.fetchImpl, now: NOW }), (e) => e.status === 409 && /bekleyen bir güncelleme taslağı/.test(e.message));
  const d = await RF.detail(p.id); const c = d.fields.find((f) => f.field === 'İçerik'); assert.ok(c.added > 5 && c.runs.some((x) => x.t === 'ins' && /Update: the plan details/.test(x.text)));
  assert.equal((await NT.list({ limit: 20 })).items.some((n) => n.type === 'update_proposed'), true);
  assert.equal((await RF.list(pid, { status: 'proposed' })).length, 1);
});

test('applying: a NEW VERSION of the same article (same slug), its checks and sources, "Last Updated" only for a meaningful change, the WordPress post updated (same post id); a stale draft is refused', opts, async () => {
  const pid = await setup(); await ready(pid); const m = fakeModels(); await S.set('update', { policy: 'manual' });
  const s = await SI.create(pid, { name: 'Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' });
  const a0 = await live(pid, { status: 'published', links: [`${links.url}/gone`] }); const pub = await PB.prepare(a0.id, s.id, { mode: 'publish' }); await PB.send(pub.id); const postId = (await PB.get(pub.id)).wpPostId; assert.equal(wp.posts.size, 1);
  await HL.checkOne(a0.id, { now: NOW }); const a = await A.get(a0.id); assert.equal(a.status, 'needs_update');
  const v0 = a.currentVersion; const lastUpd0 = (await H.db().query('SELECT last_updated_at FROM articles WHERE id = $1', [a.id])).rows[0].last_updated_at;
  const { proposal } = await RF.propose(a.id, { fetchImpl: m.fetchImpl, now: NOW });
  const done = await RF.apply(proposal.id, { userId: null, now: NOW }); const after = await A.get(a.id);
  assert.deepEqual([done.status, done.appliedVersion, after.currentVersion, after.slug === a.slug, after.contentHtml.includes('Update: the plan details'), after.contentHtml.includes('/gone'), after.status], ['applied', v0 + 1, v0 + 1, true, true, false, 'published']);
  assert.deepEqual([(await H.db().query('SELECT last_updated_at FROM articles WHERE id = $1', [a.id])).rows[0].last_updated_at.getTime(), (await A.get(a.id)).factCheckedAt !== null, after.adsenseRisk, typeof after.qualityScore], [lastUpd0.getTime(), true, 'low', 'number'], 'a small correction does not move "Last Updated"; the checks of the new text are on the article');
  assert.equal((await A.listVersions(a.id)).find((v) => v.version === v0 + 1).createdBy, 'ai'); assert.deepEqual(done.generation.wp, [{ siteId: s.id, queued: true }]);
  while (await SC.workOnce({ ctx: {} })) { /* the queued WordPress update */ }
  assert.deepEqual([wp.posts.size, [...wp.posts.keys()][0] === postId, wp.posts.get(postId).content.includes('Update: the plan details'), (await PB.get(pub.id)).articleVersion], [1, true, true, v0 + 1], 'the SAME post was updated');
  await assert.rejects(RF.apply(proposal.id, {}), (e) => e.status === 409 && /zaten “applied”/.test(e.message));
  // a meaningful (major, price change) update moves "Last Updated"; an edit after the proposal makes it stale
  await HL.checkLinks(a.id); await H.db().query("UPDATE articles SET status = 'needs_update' WHERE id = $1", [a.id]);
  m.st.override.update = (user) => ({ noChange: false, changeType: 'major', reasons: [{ code: 'price_change', text: 'The price rose to 22 dollars.' }], summary: 'New price.', fields: { contentHtml: `<h2>The price</h2><p>${'ChatGPT Plus is a paid plan. Its price is 22 dollars a month from January. '.repeat(30)}</p>` } });
  const big = await RF.propose(a.id, { fetchImpl: m.fetchImpl, now: NOW, force: true }); assert.equal(big.proposal.kind, 'major'); await A.update(a.id, { tags: ['ai', 'edited'] });
  await assert.rejects(RF.apply(big.proposal.id, {}), (e) => e.status === 409 && /eskidi/.test(e.message)); assert.equal((await RF.get(big.proposal.id)).status, 'stale');
  const again = await RF.propose(a.id, { fetchImpl: m.fetchImpl, now: NOW, force: true }); await RF.apply(again.proposal.id, { now: NOW });
  assert.ok((await H.db().query('SELECT last_updated_at FROM articles WHERE id = $1', [a.id])).rows[0].last_updated_at > lastUpd0, 'a price change is a meaningful update');
  const srcs = (await H.db().query('SELECT position FROM article_sources WHERE article_id = $1 ORDER BY position', [a.id])).rows.map((x) => x.position); assert.equal(srcs[0], 1);
});

test('the approval policy: manual never applies by itself; minor-auto and low-risk-auto apply only minor changes of articles nobody edited by hand, the latter only when every audit passed; major and critical always wait (critical alerts the owner)', opts, async () => {
  const pid = await setup(); await ready(pid);
  const run = async (policy, o = {}, override) => { const m = fakeModels(); if (override) m.st.override.update = override; await S.set('update', { policy }); const a = await flagged(pid, o); const r = await RF.propose(a.id, { fetchImpl: m.fetchImpl, now: NOW }); return { a, r, m }; };
  assert.equal((await run('manual')).r.status, 'proposed');
  let x = await run('minor_auto'); assert.deepEqual([x.r.status, x.r.proposal.auto, (await A.get(x.a.id)).currentVersion], ['applied', true, x.a.currentVersion + 1]);
  x = await run('low_risk_auto'); assert.deepEqual([x.r.status, x.r.proposal.auto], ['applied', true]); assert.match(x.r.message, /otomatik uygulandı/);
  x = await run('low_risk_auto', { manual: true, createdBy: 'manual' }); assert.deepEqual([x.r.status, (await A.get(x.a.id)).currentVersion], ['proposed', x.a.currentVersion], 'a hand-edited article is never updated by itself');
  x = await run('low_risk_auto', {}, () => ({ noChange: false, changeType: 'major', reasons: [{ code: 'new_development', text: 'New feature.' }], summary: 's', fields: { contentHtml: `<h2>Changed</h2><p>${'A completely different and much longer text about the new plan and its features. '.repeat(40)}</p>` } })); assert.deepEqual([x.r.status, x.r.proposal.kind], ['proposed', 'major']);
  const big = await run('minor_auto', {}, (u) => ({ noChange: false, changeType: 'minor', reasons: [{ code: 'other', text: 'tiny' }], summary: 's', fields: { contentHtml: `<h2>Rewritten</h2><p>${'Everything here has been rewritten from scratch in new words entirely unlike before. '.repeat(40)}</p>` } })); assert.equal(big.r.proposal.kind, 'major', 'the model called it minor; the word diff says otherwise');
  x = await run('low_risk_auto', {}, () => ({ noChange: false, changeType: 'critical', reasons: [{ code: 'factual_error', text: 'The old text was wrong.' }], summary: 'Wrong price corrected.', fields: { contentHtml: `<h2>The price</h2><p>${'ChatGPT Plus is a paid plan. Its price is 20 dollars a month today. '.repeat(30)} Correction: this was wrongly stated before.</p>` } }));
  assert.deepEqual([x.r.status, x.r.proposal.kind], ['proposed', 'critical']); assert.ok((await NT.list({ limit: 50 })).items.some((n) => n.type === 'critical_correction' && n.severity === 'critical'));
  // the low-risk policy needs the audits to have PASSED: a failing fact check keeps a minor change waiting
  const m2 = fakeModels(); m2.st.override.fact = { claims: [{ claim: 'The price is 99 dollars', importance: 'major', verdict: 'supported', sourceIds: [1], evidence: 'made up quote that is not in the source at all' }] }; await S.set('update', { policy: 'low_risk_auto' });
  const y = await flagged(pid); const r2 = await RF.propose(y.id, { fetchImpl: m2.fetchImpl, now: NOW }); assert.deepEqual([r2.status, r2.proposal.checks.fact], ['proposed', 'warn']);
  await S.set('update', { policy: 'minor_auto' }); const z = await flagged(pid); const m3 = fakeModels(); m3.st.override.fact = m2.st.override.fact; assert.equal((await RF.propose(z.id, { fetchImpl: m3.fetchImpl, now: NOW })).status, 'applied', 'the lighter policy B does not need the fact check to pass, only not to FAIL');
});

test('"nothing to change": the day\'s place is given back and a flagged article returns to its state; a rejected draft too, and the same evidence is not offered again; model failures keep the place only when billed', opts, async () => {
  const pid = await setup(); await ready(pid); await S.set('update', { policy: 'manual' }); const done = async () => (await L.status({ projectId: pid })).items.find((i) => i.workType === 'refresh').done;
  const m = fakeModels(); m.st.override.update = { noChange: true, reason: 'The new reports only repeat what the article says.' }; const a = await flagged(pid, { status: 'published' });
  const r = await RF.propose(a.id, { fetchImpl: m.fetchImpl, now: NOW }); assert.deepEqual([r.status, await done(), (await A.get(a.id)).status, /yalnızca tekrar/.test(r.message) || /repeat/.test(r.message)], ['no_change', 0, 'ready', true], 'a "published" article without a publication row settles to ready/review: the status follows the publications');
  const m2 = fakeModels(); const b = await flagged(pid); const p = await RF.propose(b.id, { fetchImpl: m2.fetchImpl, now: NOW });
  const rej = await RF.reject(p.proposal.id, { note: 'not now', now: NOW }); assert.deepEqual([rej.status, rej.note, (await A.get(b.id)).status], ['rejected', 'not now', 'ready']); await assert.rejects(RF.reject(p.proposal.id), /bekleyen taslak/);
  const m3 = fakeModels(); m3.st.fail.update = { status: 401, type: 'authentication_error', message: 'invalid x-api-key' }; const c = await flagged(pid); const used = await done();
  await assert.rejects(RF.propose(c.id, { fetchImpl: m3.fetchImpl, now: NOW }), (e) => e.fatal === true); assert.equal(await done(), used, 'a rejected key was not billed: the place is back');
  const m4 = fakeModels(); m4.st.override.update = 'I would rather write a poem'; const d = await flagged(pid); const used2 = await done(); await assert.rejects(RF.propose(d.id, { fetchImpl: m4.fetchImpl, now: NOW }), (e) => e.code === 'bad_json'); assert.equal(await done(), used2 + 1, 'an unreadable answer WAS billed: the place stays used');
  await L.setGlobalLimits({ refresh: 0 }); const e = await flagged(pid); await assert.rejects(RF.propose(e.id, { fetchImpl: m.fetchImpl, now: NOW }), (er) => er.status === 409 && er.extra.limit === true);
});

test('the bots: the health bot looks at due articles within the daily check limit and flags only with evidence; the refresh bot drafts for flagged articles (never when nothing is flagged), a person can force one article', opts, async () => {
  const pid = await setup(); await ready(pid); await S.set('update', { policy: 'manual' }); const m = fakeModels();
  const a = await live(pid, { links: [`${links.url}/gone`] }); await live(pid, { links: [`${links.url}/ok`] }); await live(pid, { links: [] });
  await SC.updateSchedule('content_health', { enabled: true, intervalMinutes: 60 }); await L.setGlobalLimits({ old_check: 2 });
  const tick = async (bot) => { await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"); await SC.saveSchedule(bot, { nextRunAt: null }); await SC.tick({ now: NOW }); let j; do { j = await SC.workOnce({ now: NOW, ctx: { fetchImpl: m.fetchImpl, newsFetch: async () => ({ status: 200, body: '<rss version="2.0"><channel></channel></rss>', url: 'x' }), gapMs: 0 } }); } while (j && j.botKey !== bot); return j; };
  let j = await tick('content_health'); assert.deepEqual([j.outcome, j.result.status, j.result.stats.checked], ['done', 'partial', 2], 'the daily check limit (2) cut the pass'); assert.match(j.result.message, /2 makale kontrol edildi/);
  await L.setGlobalLimits({ old_check: 10 }); await H.db().query('UPDATE articles SET next_check_at = NULL'); j = await tick('content_health'); assert.deepEqual([j.result.stats.checked, j.result.stats.flagged], [3, 0], 'the broken-link article was already flagged in the first pass'); assert.equal((await A.get(a.id)).status, 'needs_update');
  j = await tick('content_health'); assert.deepEqual([j.outcome, /zamanı gelen makale yok/.test(j.result.message)], ['skipped', true]);
  await SC.updateSchedule('content_refresh', { enabled: true }); j = await tick('content_refresh'); assert.deepEqual([j.outcome, j.result.stats.proposed], ['done', 1], JSON.stringify(j.result)); assert.equal((await RF.list(pid, { status: 'proposed' })).length, 1);
  j = await tick('content_refresh'); assert.equal(j.outcome, 'skipped', 'the flagged article already has an open draft: nothing more to do');
  const calm = (await H.db().query("SELECT id FROM articles WHERE status = 'ready' LIMIT 1")).rows[0].id; await RF.reject((await RF.list(pid, { status: 'proposed' }))[0].id, {});
  const forced = await SC.runNow('content_refresh', pid, { now: NOW }); await H.db().query("UPDATE jobs SET payload = $2 WHERE id = $1", [forced.id, JSON.stringify({ articleId: calm })]);
  j = await SC.workOnce({ now: NOW, ctx: { fetchImpl: m.fetchImpl } }); assert.deepEqual([j.botKey, j.result.stats.result], ['content_refresh', 'proposed'], 'a person asked: no evidence needed');
});

test('version comparison: what changed between two versions, field by field, with the words that went and came', opts, async () => {
  const pid = await setup(); const a = await live(pid);
  await A.update(a.id, { h1: 'ChatGPT Plus pricing guide, updated', contentHtml: a.contentHtml.replace('20 dollars', '22 dollars'), tags: ['ai', 'pricing'], reason: 'price' });
  const d = await A.compareVersions(a.id, 1, 2); const by = Object.fromEntries(d.fields.map((f) => [f.field, f]));
  assert.deepEqual([d.from.version, d.to.version, d.fields.map((f) => f.field).sort()], [1, 2, ['Ana başlık (H1)', 'Etiketler', 'İçerik'].sort()]);
  assert.ok(by['İçerik'].runs.some((r) => r.t === 'del' && /20/.test(r.text)) && by['İçerik'].runs.some((r) => r.t === 'ins' && /22/.test(r.text))); assert.equal(by['Ana başlık (H1)'].added, 2);
  assert.deepEqual((await A.compareVersions(a.id, 2, 2)).fields, []); await assert.rejects(A.compareVersions(a.id, 1, 9), /bulunamadı/);
});
