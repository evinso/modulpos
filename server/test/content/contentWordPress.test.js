process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';            // lets the guarded fetcher reach the fake WordPress on 127.0.0.1 (tests only)
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { startFakeWp, PNG } = require('./fakeWordPress');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const SI = require('../../src/content/services/sites');
const PB = require('../../src/content/services/publishing');
const SC = require('../../src/content/services/scheduler');
const Q = require('../../src/content/services/queue');
const NT = require('../../src/content/services/notifications');
const WPC = require('../../src/content/services/wordpress');
const sched = require('../../src/content/lib/schedule');

/**
 * Phase 5: WordPress sites, category mapping, sending articles, limits, retries, planning many articles. The WordPress is a real HTTP server of the tests
 * (fakeWordPress.js) reached through the same guarded fetcher production uses; the queue and the worker are the real ones.
 */
const opts = { skip: H.skip };
const PASS = 'abcd efgh ijkl mnop';
let wp;

test.before(async () => { if (!H.skip) { await H.freshDatabase(); wp = await startFakeWp(); } });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await wp.close(); wp = await startFakeWp(); } });
test.after(async () => { if (!H.skip) { await wp.close(); await H.close(); } });

const setup = async () => (await P.seedDefault()).projectId;
const newSite = async (pid, extra = {}) => SI.create(pid, { name: 'Test Blog', apiUrl: wp.url, username: 'editor', password: PASS, ...extra });
const words = (n) => `<p>${'Plain, useful sentence about home networking basics for curious readers. '.repeat(Math.ceil(n / 9))}</p>`;
let seq = 0;
async function readyArticle(pid, o = {}) {
  const cats = await P.listCategories(pid); seq++;
  const a = await A.create({ projectId: pid, h1: o.title || `Router setup guide ${seq}`, seoTitle: `Router setup guide ${seq}: what to know`, metaDescription: 'A practical walk-through of setting up a home router, with the settings that matter most for speed and safety.', focusKeyword: `router setup ${seq}`,
    categoryId: o.categoryId === undefined ? cats[0].id : o.categoryId, contentHtml: `<h2>Start here</h2>${words(330)}`, tags: o.tags || ['networking', 'wifi'], faq: [{ q: 'Do I need a new router?', a: '<p>Not always.</p>' }], articleType: 'evergreen_guide' });
  await H.db().query("UPDATE articles SET status = $2, fact_checked_at = now(), adsense_risk = 'low', featured_image_url = $3 WHERE id = $1", [a.id, o.status || 'ready', o.image || '']);          // (the form only accepts https pictures; the fake site is http)
  return A.get(a.id);
}
const drain = async () => { let n = 0; for (;;) { const j = await SC.workOnce({ ctx: {} }); if (!j) return n; n++; if (n > 80) throw new Error('queue does not empty'); } };
const done = async (pid, day) => (await L.status({ projectId: pid, now: day })).items.find((i) => i.workType === 'publish').done;
const post = (id) => wp.posts.get(Number(id));

test('sites: a connection is validated, its password is encrypted and never returned, the test says what is wrong in words, the first working site connects the project', opts, async () => {
  const pid = await setup();
  await assert.rejects(SI.create(pid, { name: 'x', apiUrl: 'ftp://nope', username: 'u', password: 'p' }), /geçerli değil|https/); await assert.rejects(SI.create(pid, { name: 'x', apiUrl: 'siteniz.com', username: 'u', password: 'p' }), /geçerli değil/);
  await assert.rejects(SI.create(pid, { name: 'x', apiUrl: wp.url, username: 'u' }), /Uygulama şifresi gerekli/); await assert.rejects(SI.create(pid, { name: 'x', apiUrl: wp.url, username: 'u', password: 'p', dailyLimit: 999 }), /0 ile 200/);
  const s = await newSite(pid, { apiUrl: `${wp.url}/wp-json/wp/v2/` }); assert.equal(s.apiUrl, wp.url, 'a pasted /wp-json part is removed'); assert.deepEqual([s.passwordLast4, s.hasPassword, s.dailyLimit, s.seoPlugin, s.status], ['mnop', true, 5, 'none', 'active']);
  assert.ok(!JSON.stringify(s).includes('abcd efgh') && !JSON.stringify(await SI.list(pid)).includes('abcd efgh'));
  assert.equal((await H.db().query('SELECT encrypted_password FROM wp_sites')).rows[0].encrypted_password.startsWith('enc:v1:'), true);
  await assert.rejects(newSite(pid), (e) => e.status === 409 && /zaten ekli/.test(e.message));
  assert.equal((await P.getProject(pid)).domain, null, 'before a working test the project stays "Not Connected"');
  wp.namespaces.push('rankmath/v1'); const t = await SI.test(s.id);
  assert.deepEqual([t.ok, t.info.user, t.info.canPublish, t.info.plugins.rankmath, t.info.restStyle], [true, 'Editor Joe', true, true, 'pretty']); assert.match(t.message, /“Fake Tech Blog”.*Rank Math bulundu/);
  const proj = await P.getProject(pid); assert.deepEqual([proj.domain, proj.mode], ['127.0.0.1', 'connected']);
  wp.canPublish = false; assert.match((await SI.test(s.id)).message, /yalnızca TASLAK yazabilir/); wp.canPublish = true;
  const bad = await SI.update(s.id, { password: 'wrong wrong wrong' }); assert.deepEqual([bad.lastTestedAt, bad.passwordLast4], [null, 'rong'], 'a new password clears the old test');
  const t2 = await SI.test(s.id); assert.deepEqual([t2.ok, /uygulama şifresini reddetti/.test(t2.message), t2.message.includes('wrong wrong')], [false, true, false]);
  await SI.update(s.id, { password: PASS }); wp.notWordPress = true; assert.match((await SI.test(s.id)).message, /JSON yok/); wp.notWordPress = false;
  wp.namespaces.splice(0, wp.namespaces.length, 'oembed/1.0'); assert.match((await SI.test(s.id)).message, /wp\/v2\) sunmuyor/); wp.namespaces.push('wp/v2');
  await SI.update(s.id, { username: 'someone-else' }); assert.equal((await SI.test(s.id)).ok, false); await SI.update(s.id, { username: 'editor' });
  await assert.rejects(SI.update(s.id, { seoPlugin: 'wix' }), /şunlardan biri|geçersiz/i); assert.equal((await SI.update(s.id, { dailyLimit: 3, seoPlugin: 'rankmath', timezone: 'America/New_York' })).dailyLimit, 3);
  const used = await readyArticle(pid); await PB.submit(used.id, s.id, { mode: 'draft' }); await drain();
  await assert.rejects(SI.remove(s.id), (e) => e.status === 409 && /silinemez/.test(e.message)); assert.equal((await SI.update(s.id, { status: 'paused' })).status, 'paused');
});

test('category map: our categories next to the site\'s, name matches are only suggestions, a missing category can be created on the site, mapping can be removed', opts, async () => {
  const pid = await setup(); const s = await newSite(pid);
  const m = await SI.categoryMap(s.id); const ai = m.categories.find((c) => c.name === 'AI Tools & Updates');
  assert.deepEqual([m.wpCategories.length, ai.wpCategoryId, ai.suggestion && ai.suggestion.id], [2, null, 5], 'the entity-encoded name of the site matches ours, as a suggestion only');
  const other = m.categories.find((c) => c.name !== 'AI Tools & Updates');
  const out = await SI.saveCategoryMap(s.id, [{ categoryId: ai.categoryId, wpCategoryId: 5, wpName: 'AI Tools & Updates' }, { categoryId: other.categoryId, create: true }]);
  assert.deepEqual(out, { mapped: 1, created: 1, unmapped: 0 }); assert.ok(wp.categories.some((c) => c.name === other.name));
  const again = await SI.categoryMap(s.id); assert.deepEqual([again.categories.find((c) => c.categoryId === ai.categoryId).wpCategoryId, again.categories.find((c) => c.categoryId === other.categoryId).wpName], [5, other.name]);
  const dup = await SI.saveCategoryMap(s.id, [{ categoryId: other.categoryId, create: true }]); assert.equal(dup.mapped, 1, 'a category that already exists on the site is mapped, not duplicated'); assert.equal(wp.categories.filter((c) => c.name === other.name).length, 1);
  assert.deepEqual(await SI.saveCategoryMap(s.id, [{ categoryId: ai.categoryId, wpCategoryId: null }]), { mapped: 0, created: 0, unmapped: 1 });
  await assert.rejects(SI.saveCategoryMap(s.id, [{ categoryId: '00000000-0000-0000-0000-000000000001', wpCategoryId: 3 }]), /projeye ait değil/);
  wp.failNext = { match: /GET \/wp\/v2\/categories/, status: 500 }; const off = await SI.categoryMap(s.id); assert.match(off.remoteError, /sunucusu hata verdi/); assert.equal(off.categories.length, 5, 'our side still loads when the site is down');
});

test('a draft: the content, FAQ, slug, excerpt, mapped category, tag ids and author arrive; the article stays in review; the history says what happened', opts, async () => {
  const pid = await setup(); const s = await newSite(pid, { defaultAuthorId: 7 }); const cats = await P.listCategories(pid);
  await SI.saveCategoryMap(s.id, [{ categoryId: cats[0].id, wpCategoryId: 5, wpName: 'x' }]);
  const a = await readyArticle(pid, { status: 'needs_review', tags: ['wifi', 'router tips'] });
  const pub = await PB.submit(a.id, s.id, { mode: 'draft' }); assert.deepEqual([pub.status, pub.mode], ['pending', 'draft']); assert.equal(await done(pid, new Date()), 0, 'a draft takes no place of the day');
  assert.equal(await drain() >= 1, true); const p = await PB.get(pub.id);
  assert.deepEqual([p.status, p.wpPostId > 0, p.articleVersion, p.attempts, p.lastError], ['draft', true, a.currentVersion, 1, null]); assert.match(p.wpUrl, new RegExp(`/${a.slug}/$`));
  const w = post(p.wpPostId); assert.deepEqual([w.status, w.slug, w.title, w.categories, w.author], ['draft', a.slug, a.h1, [5], 7]);
  assert.ok(w.content.includes('<h2>Start here</h2>') && w.content.includes('<h2>Frequently asked questions</h2><h3>Do I need a new router?</h3><p>Not always.</p>'), 'the FAQ is appended as plain HTML'); assert.equal(w.excerpt, a.metaDescription, 'no excerpt typed: the meta description');
  assert.equal(w.tags.length, 2); assert.deepEqual(wp.tags.map((t) => t.name), ['wifi', 'router tips']);
  assert.deepEqual((await A.get(a.id)).status, 'needs_review'); assert.ok(p.warnings.some((x) => /SEO eklentisi seçilmedi/.test(x)));
  assert.deepEqual((await PB.history(p.id)).map((h) => h.action), ['prepare', 'create']); assert.ok(wp.requests.every((r) => r.headers.authorization === undefined || r.headers.authorization.startsWith('Basic ')));
  assert.deepEqual((await PB.list(pid, { articleId: a.id })).map((x) => x.status), ['draft']);
});

test('going public: only a "ready" article, one place of the day, the same post is UPDATED later (never a second one), an edit shows as "update available"', opts, async () => {
  const pid = await setup(); const s = await newSite(pid);
  const review = await readyArticle(pid, { status: 'needs_review' });
  await assert.rejects(PB.submit(review.id, s.id, { mode: 'publish' }), (e) => e.status === 409 && /Yayına hazır” olmalı/.test(e.message)); assert.equal(await done(pid, new Date()), 0);
  const a = await readyArticle(pid); await H.db().query("UPDATE articles SET fact_checked_at = NULL WHERE id = $1", [a.id]);
  await assert.rejects(PB.submit(a.id, s.id, { mode: 'publish' }), /yayına hazır değil.*Doğruluk kontrolü/); await H.db().query("UPDATE articles SET fact_checked_at = now() WHERE id = $1", [a.id]);
  const pub = await PB.submit(a.id, s.id, { mode: 'publish' }); await drain(); const p = await PB.get(pub.id);
  assert.deepEqual([p.status, post(p.wpPostId).status, (await A.get(a.id)).status, await done(pid, new Date())], ['published', 'publish', 'published', 1]); assert.ok(p.publishedAt);
  const postsBefore = wp.posts.size; const postId = p.wpPostId;
  await A.update(a.id, { contentHtml: `<h2>Start here</h2>${words(340)}<p>An extra paragraph.</p>`, reason: 'update' }); await H.db().query("UPDATE articles SET status = 'published', fact_checked_at = now(), adsense_risk = 'low' WHERE id = $1", [a.id]);
  assert.equal((await PB.get(pub.id)).hasUpdate, true, 'the site has the old version');
  await PB.submit(a.id, s.id, { mode: 'publish' }); await drain(); const u = await PB.get(pub.id);
  assert.deepEqual([u.wpPostId, wp.posts.size, u.hasUpdate, u.articleVersion, post(postId).history.length], [postId, postsBefore, false, a.currentVersion + 1, 2], 'same post id, no new post');
  assert.equal(await done(pid, new Date()), 1, 'an update takes no new place'); assert.ok(post(postId).content.includes('An extra paragraph'));
  const dup = await H.db().query("SELECT count(*)::int n FROM publications WHERE article_id = $1", [a.id]); assert.equal(dup.rows[0].n, 1, 'one row per article and site');
  await assert.rejects(PB.submit(a.id, s.id, { mode: 'draft' }), /taslağa çevrilemez/);
  await assert.rejects(A.remove(a.id), (e) => e.status === 409 && /silinemez/.test(e.message));
});

test('scheduled posts count for THEIR day; limits (the site\'s and the project\'s) refuse the extra one; a post that went live is read back; a failed send gives the place back', opts, async () => {
  const pid = await setup(); const s = await newSite(pid, { dailyLimit: 1 });
  const when = new Date(Date.now() + 3 * 86400000); when.setUTCHours(10, 0, 0, 0);
  const a = await readyArticle(pid); const pub = await PB.submit(a.id, s.id, { mode: 'schedule', scheduledAt: when }); await drain(); const p = await PB.get(pub.id);
  assert.deepEqual([p.status, post(p.wpPostId).status, post(p.wpPostId).date_gmt, (await A.get(a.id)).status], ['scheduled', 'future', when.toISOString().replace(/\.\d+Z$/, ''), 'scheduled']);
  assert.deepEqual([await done(pid, when), await done(pid, new Date())], [1, 0], 'the place is taken on the day of the post, not today');
  const b = await readyArticle(pid); const sameDay = new Date(when.getTime() + 3600000);
  await assert.rejects(PB.submit(b.id, s.id, { mode: 'schedule', scheduledAt: sameDay }), (e) => e.status === 409 && /günlük yayın limiti \(1\).*dolu/.test(e.message)); assert.equal(await done(pid, sameDay), 1, 'a refused send takes no place');
  const day2 = new Date(when.getTime() + 86400000); const ok = await PB.submit(b.id, s.id, { mode: 'schedule', scheduledAt: day2 }); await drain(); assert.equal((await PB.get(ok.id)).status, 'scheduled');
  await assert.rejects(PB.submit((await readyArticle(pid)).id, s.id, { mode: 'schedule', scheduledAt: new Date(Date.now() + 60000) }), /en az 5 dakika/); await assert.rejects(PB.submit((await readyArticle(pid)).id, s.id, { mode: 'schedule', scheduledAt: 'soon' }), /geçerli değil/);
  await SI.update(s.id, { dailyLimit: 9 }); await L.setProjectLimits(pid, { publish: 1 }); const c = await readyArticle(pid);
  await assert.rejects(PB.submit(c.id, s.id, { mode: 'schedule', scheduledAt: new Date(when.getTime() + 7200000) }), (e) => e.extra && e.extra.limit === true && /limit/i.test(e.message)); await L.setProjectLimits(pid, { publish: 5 });
  // WordPress made the post public at its time: the read-back updates the panel
  wp.goLive(p.wpPostId); await H.db().query("UPDATE publications SET scheduled_at = now() - interval '1 minute' WHERE id = $1", [pub.id]);
  assert.deepEqual(await PB.syncDue({ projectId: pid }), { checked: 1, published: 1, errors: 0 }); assert.deepEqual([(await PB.get(pub.id)).status, (await A.get(a.id)).status], ['published', 'published']);
  // a send that fails for good (the user may not publish) gives the place back and tells the owner
  const day3 = new Date(when.getTime() + 2 * 86400000); const d = await readyArticle(pid); wp.canPublish = false;
  const bad = await PB.submit(d.id, s.id, { mode: 'schedule', scheduledAt: day3 }); assert.equal(await done(pid, day3), 1); await drain();
  const f = await PB.get(bad.id); assert.deepEqual([f.status, /yayımlayamıyor/.test(f.lastError), await done(pid, day3)], ['failed', true, 0]);
  assert.equal((await Q.list({ status: 'failed' })).length, 1, 'the job failed for good (no retry can help)'); assert.ok((await NT.list({ limit: 20 })).items.some((n) => n.type === 'publish_failed'));
  wp.canPublish = true; await PB.submit(d.id, s.id, { mode: 'schedule', scheduledAt: day3 }); await drain(); assert.equal((await PB.get(bad.id)).status, 'scheduled', 'after the fix a retry reuses the same row');
});

test('no second copy: a lost answer leaves the post "unknown", the retry finds it by slug and uses it; a post that already uses the slug is never taken over', opts, async () => {
  const pid = await setup(); const s = await newSite(pid); const a = await readyArticle(pid);
  wp.dropAfterCreate = true; const pub = await PB.submit(a.id, s.id, { mode: 'draft' });
  const first = await SC.workOnce({ ctx: {} }); assert.equal(first.outcome, 'retry'); let p = await PB.get(pub.id); assert.deepEqual([p.status, wp.posts.size], ['unknown', 1], 'the post exists, our row does not know its number yet');
  await H.db().query("UPDATE jobs SET run_after = now() - interval '1 second'"); await drain(); p = await PB.get(pub.id);
  assert.deepEqual([p.status, wp.posts.size, p.wpPostId === [...wp.posts.keys()][0], p.warnings.some((w) => /yeniden kullanıldı/.test(w))], ['draft', 1, true, true]);
  const b = await readyArticle(pid); wp.posts.set(999, { id: 999, slug: b.slug, status: 'publish', content: 'someone else', categories: [], tags: [], history: [] });
  const clash = await PB.submit(b.id, s.id, { mode: 'draft' }); const j = await SC.workOnce({ ctx: {} }); assert.equal(j.outcome, 'failed'); const cp = await PB.get(clash.id);
  assert.deepEqual([cp.status, /zaten bir yazıda kullanılıyor/.test(cp.lastError), wp.posts.size, wp.posts.get(999).content], ['failed', true, 2, 'someone else']);
  // two sends racing for the same article: exactly one post
  const c = await readyArticle(pid); const x = await PB.prepare(c.id, s.id, { mode: 'draft' }); await Promise.all([PB.send(x.id), PB.send(x.id), PB.send(x.id)]);
  assert.equal([...wp.posts.values()].filter((w) => w.slug === c.slug).length, 1); assert.equal((await PB.get(x.id)).attempts, 1);
  await assert.rejects(PB.prepare(c.id, s.id, { mode: 'draft' }).then(() => PB.prepare(c.id, s.id, { mode: 'draft' })), (e) => e.status === 409);
  wp.failNext = { match: /POST \/wp\/v2\/posts\/\d+/, status: 404, body: { code: 'rest_post_invalid_id', message: 'gone' } }; const u = await PB.prepare(a.id, s.id, { mode: 'draft' });
  await PB.enqueue(u.id); const g = await SC.workOnce({ ctx: {} }); assert.equal(g.outcome, 'failed'); assert.match((await PB.get(u.id)).lastError, /artık yok/);
  const r = await PB.reset(u.id); assert.deepEqual([r.wpPostId, r.status], [null, 'failed']);
});

test('featured image, tags and SEO fields: the image is fetched through the guarded fetcher and uploaded once; a bad image or a missing right is a warning, not a failure; each SEO plugin is handled in its supported way', opts, async () => {
  const pid = await setup(); const s = await newSite(pid, { seoPlugin: 'rankmath' }); wp.namespaces.push('rankmath/v1');
  const a = await readyArticle(pid, { image: `${wp.url}/img/ok.png` }); const pub = await PB.submit(a.id, s.id, { mode: 'draft' }); await drain(); let p = await PB.get(pub.id);
  assert.deepEqual([wp.media.length, wp.media[0].mime, wp.media[0].bytes, wp.media[0].alt, post(p.wpPostId).featured_media === wp.media[0].id], [1, 'image/png', PNG.length, a.h1, true]); assert.ok(wp.media[0].filename.endsWith('.png'));
  assert.deepEqual(wp.rankMath[0], { objectID: p.wpPostId, objectType: 'post', meta: { rank_math_title: a.seoTitle, rank_math_description: a.metaDescription, rank_math_focus_keyword: a.focusKeyword } });
  assert.ok(!p.warnings.some((w) => /Rank Math|Kapak/.test(w)));
  await PB.submit(a.id, s.id, { mode: 'draft' }); await drain(); assert.equal(wp.media.length, 1, 'the same image is not uploaded twice on an update');
  const b = await readyArticle(pid, { image: `${wp.url}/img/page.html` }); const pb = await PB.submit(b.id, s.id, { mode: 'draft' }); await drain(); p = await PB.get(pb.id);
  assert.deepEqual([p.status, p.warnings.some((w) => /Kapak görseli aktarılamadı: desteklenmeyen dosya türü/.test(w)), post(p.wpPostId).featured_media], ['draft', true, 0]);
  const c = await readyArticle(pid, { image: `${wp.url}/img/ok.png` }); wp.canUpload = false; const pc = await PB.submit(c.id, s.id, { mode: 'draft' }); await drain(); p = await PB.get(pc.id); assert.ok(p.warnings.some((w) => /Kapak görseli aktarılamadı/.test(w))); assert.equal(p.status, 'draft'); wp.canUpload = true;
  wp.failNext = { match: /POST \/rankmath/, status: 404 }; const d = await readyArticle(pid); const pd = await PB.submit(d.id, s.id, { mode: 'draft' }); await drain(); assert.ok((await PB.get(pd.id)).warnings.some((w) => /Rank Math SEO alanları yazılamadı/.test(w)));
  await SI.update(s.id, { seoPlugin: 'yoast' }); const e = await readyArticle(pid); const pe = await PB.submit(e.id, s.id, { mode: 'draft' }); await drain(); let q = await PB.get(pe.id);
  assert.ok(q.warnings.some((w) => /Yoast SEO alanları yazılamadı/.test(w))); assert.equal(post(q.wpPostId).history[0].meta._yoast_wpseo_focuskw, e.focusKeyword, 'the fields were SENT');
  wp.yoastMeta = true; const f = await readyArticle(pid); const pf = await PB.submit(f.id, s.id, { mode: 'draft' }); await drain(); q = await PB.get(pf.id); assert.ok(!q.warnings.some((w) => /Yoast/.test(w)), 'a site that exposes the fields gets no warning');
});

test('planning many: drafts all go; "publish now" stops at today\'s limit; "spread" fills each day up to the limits inside the working window, skips weekends and sends the strongest first; unplannable ones say why', opts, async () => {
  const pid = await setup(); const s = await newSite(pid, { dailyLimit: 2 });
  const arts = []; for (let i = 0; i < 7; i++) { const a = await readyArticle(pid); await H.db().query('UPDATE articles SET quality_score = $2 WHERE id = $1', [a.id, 80 + i]); arts.push(a); }
  const review = await readyArticle(pid, { status: 'needs_review' }); const ids = [...arts.map((a) => a.id), review.id];
  const draft = await PB.plan({ siteId: s.id, articleIds: ids, mode: 'draft' }); assert.deepEqual([draft.items.length, draft.unplanned.length], [8, 0]);
  const now = await PB.plan({ siteId: s.id, articleIds: ids, mode: 'publish_now' }); assert.equal(now.items.length, 2, 'the site allows 2 a day'); assert.ok(now.unplanned.some((u) => /Bugünkü yayın limiti doldu/.test(u.reason)) && now.unplanned.some((u) => /Yayına hazır” olmalı/.test(u.reason)));
  const from = new Date(Date.now() + 2 * 86400000); from.setUTCHours(0, 0, 0, 0); while (from.getUTCDay() !== 5) from.setUTCDate(from.getUTCDate() + 1);       // a Friday
  const sp = await PB.plan({ siteId: s.id, articleIds: ids, mode: 'spread', startAt: from.toISOString() });
  assert.equal(sp.items.length, 7); assert.equal(sp.unplanned.length, 1);
  const perDay = {}; for (const it of sp.items) perDay[it.day] = (perDay[it.day] || 0) + 1;
  assert.deepEqual(Object.values(perDay).sort(), [1, 2, 2, 2], 'two a day, the rest on the last day'); assert.ok(sp.items.every((it) => { const lp = sched.localParts(new Date(it.scheduledAt), s.timezone); return lp.weekday <= 5 && lp.minutes >= 540 && lp.minutes <= 1260; }), 'weekdays only, inside 09:00-21:00');
  assert.deepEqual(sp.items.slice(0, 2).map((i) => i.articleId), [arts[6].id, arts[5].id], 'the highest quality score goes first'); assert.ok(sp.items.every((it, i) => i === 0 || new Date(it.scheduledAt) >= new Date(sp.items[i - 1].scheduledAt)));
  const two = sp.items.filter((i) => i.day === sp.items[0].day); assert.ok(new Date(two[1].scheduledAt) - new Date(two[0].scheduledAt) >= 5 * 60000);
  await S.set('publishing', { weekends: true }); const wk = await PB.plan({ siteId: s.id, articleIds: ids.slice(0, 6), mode: 'spread', startAt: from.toISOString() }); assert.ok(wk.items.some((it) => sched.localParts(new Date(it.scheduledAt), s.timezone).weekday > 5), 'weekends are used when the setting allows');
  await L.setProjectLimits(pid, { publish: 1 }); const lim = await PB.plan({ siteId: s.id, articleIds: ids.slice(0, 3), mode: 'spread', startAt: from.toISOString() }); assert.ok(Object.values(lim.items.reduce((m, i) => ({ ...m, [i.day]: (m[i.day] || 0) + 1 }), {})).every((n) => n === 1), 'the project\'s own limit is respected');
  await assert.rejects(PB.plan({ siteId: s.id, articleIds: [], mode: 'draft' }), /1 ile 200/); await assert.rejects(PB.plan({ siteId: s.id, articleIds: ids, mode: 'now' }), /şunlardan biri|geçersiz/i);
});

test('bulk: one batch job turns a plan into publications and one queue job each; articles that fail the checks are reported, the rest go; the queue sends them all', opts, async () => {
  const pid = await setup(); const s = await newSite(pid, { dailyLimit: 5 }); const good = []; for (let i = 0; i < 4; i++) good.push(await readyArticle(pid));
  const bad = await readyArticle(pid); await H.db().query('UPDATE articles SET adsense_risk = NULL WHERE id = $1', [bad.id]);
  const from = new Date(Date.now() + 2 * 86400000); from.setUTCHours(0, 0, 0, 0);
  const out = await PB.submitBatch({ siteId: s.id, articleIds: [...good, bad].map((a) => a.id), mode: 'spread', startAt: from.toISOString() }); assert.equal(out.planned, 5); assert.equal(out.job.status, 'queued');
  let j; do { j = await SC.workOnce({ ctx: {} }); } while (j && !(j.result && j.result.stats && j.result.stats.created));
  assert.deepEqual([j.result.stats.created.length, j.result.stats.rejected.length, /AdSense risk kontrolü yapılmadı/.test(j.result.stats.rejected[0].reason), j.result.status], [4, 1, true, 'partial']);
  await drain(); const list = await PB.list(pid, { siteId: s.id }); assert.deepEqual([list.length, list.every((p) => p.status === 'scheduled'), wp.posts.size], [4, true, 4]);
  assert.ok([...wp.posts.values()].every((w) => w.status === 'future'));
});

test('the WordPress bot: the scheduled pass reads scheduled posts back, and only when the owner allowed auto-publish does it send approved ("ready") articles (as drafts or public), a few per run', opts, async () => {
  const pid = await setup(); const s = await newSite(pid);
  const a = await readyArticle(pid); const b = await readyArticle(pid); await readyArticle(pid, { status: 'needs_review' });
  await SC.updateSchedule('content_publishing', { enabled: true, intervalMinutes: 30, windowStart: null, windowEnd: null, options: { perRun: 1 } });
  const run = async () => { await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"); await SC.saveSchedule('content_publishing', { nextRunAt: null }); await SC.tick({ now: new Date() }); let j; do { j = await SC.workOnce({ ctx: {} }); } while (j && j.botKey !== 'content_publishing'); await drain(); return j; };
  let j = await run(); assert.deepEqual([j.outcome, /Otomatik yayın kapalı/.test(j.result.message)], ['skipped', true]); assert.equal(wp.posts.size, 0, 'auto-publish is off: nothing is sent');
  await S.set('publishing', { autoPublish: true, siteId: s.id, mode: 'draft' }); j = await run(); assert.match(j.result.message, /1 makale taslak olarak gönderime alındı/); assert.equal(wp.posts.size, 1); assert.equal([...wp.posts.values()][0].status, 'draft');
  await S.set('publishing', { autoPublish: true, siteId: s.id, mode: 'publish' }); j = await run(); assert.equal(wp.posts.size, 2, JSON.stringify(j.result)); assert.equal([...wp.posts.values()][1].status, 'publish'); assert.equal((await PB.list(pid, { status: 'published' })).length, 1);
  j = await run(); assert.match(j.result.message, /onaylı.*makale yok/, 'the article in review is never sent'); assert.equal(wp.posts.size, 2);
  void a; void b;
});

test('the client: every WordPress refusal becomes a sentence; REST routes of sites without pretty permalinks work; a redirect never carries the password', opts, async () => {
  const mk = (request, extra = {}) => WPC.createClient({ apiUrl: 'https://blog.example.com', username: 'u', password: 'p p', request, ...extra });
  const reply = (status, body) => async () => ({ status, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body), url: 'x' });
  const code = async (status, body) => { try { await mk(reply(status, body)).me(); } catch (e) { return [e.code, e.retryable === true, e.message]; } return null; };
  assert.deepEqual((await code(401, { code: 'incorrect_password' })).slice(0, 2), ['auth', false]); assert.equal((await code(403, { code: 'rest_cannot_create' }))[0], 'rights'); assert.match((await code(403, { code: 'rest_cannot_publish' }))[2], /Katkıda bulunan/);
  assert.equal((await code(404, { code: 'rest_no_route' }))[0], 'no_rest'); assert.deepEqual((await code(503, 'oops')).slice(0, 2), ['server', true]); assert.equal((await code(400, { code: 'x', message: '<b>bad</b> thing' }))[2].includes('<b>'), false);
  assert.equal((await code(200, '<html>shop</html>'))[0], 'not_wp'); const noisy = await mk(reply(200, 'PHP Notice: x\n{"id":3,"name":"A","roles":[],"capabilities":{"edit_posts":true}}')).me(); assert.equal(noisy.id, 3, 'JSON after a PHP notice is still read');
  let seen; await mk(async (u, o) => { seen = { u, o }; return { status: 200, headers: {}, body: '[]' }; }, { style: 'query' }).categories(); assert.match(seen.u, /^https:\/\/blog\.example\.com\/\?rest_route=%2Fwp%2Fv2%2Fcategories&per_page=100/); assert.equal(seen.o.headers.Authorization, `Basic ${Buffer.from('u:p p').toString('base64')}`);
  const netErr = async () => { throw Object.assign(new Error('x'), { name: 'FetchError', code: 'timeout' }); }; await assert.rejects(mk(netErr).createPost({}), (e) => e.code === 'timeout' && e.maybeSent === true && e.retryable === true); await assert.rejects(mk(netErr).me(), (e) => e.maybeSent === false);
  delete process.env.CONTENT_ALLOW_PRIVATE_FETCH; assert.throws(() => WPC.normalizeSite('http://blog.example.com'), /https ile başlamalı/); process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1'; assert.equal(WPC.normalizeSite('https://blog.example.com/blog/wp-admin/edit.php'), 'https://blog.example.com/blog');
  // a redirect from a real server: refused, the credentials are not forwarded
  const redir = await startFakeWp(); redir.failNext = { match: /GET \/wp\/v2\/users\/me/, status: 301, body: {} };
  const s = await SI.create(await setup(), { name: 'r', apiUrl: redir.url, username: 'editor', password: PASS }); const t = await SI.test(s.id); assert.equal(t.ok, false); await redir.close();
});
