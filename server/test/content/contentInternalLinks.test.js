process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { startFakeWp } = require('./fakeWordPress');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const IL = require('../../src/content/services/internalLinks');
const SI = require('../../src/content/services/sites');
const PB = require('../../src/content/services/publishing');
const SC = require('../../src/content/services/scheduler');

/**
 * Phase 6b, internal links: suggestions come from words the articles ALREADY contain (no sentence is rewritten), never into headings or existing links, only drafts until the
 * target has a public address, applied by a person without withdrawing the fact check; plus the guard against the same article on two domains.
 */
const opts = { skip: H.skip };
let wp;
test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); if (wp) await wp.close(); wp = await startFakeWp(); } });
test.after(async () => { if (!H.skip) { if (wp) await wp.close(); await H.close(); } });

const setup = async () => (await P.seedDefault()).projectId;
const filler = (n) => Array.from({ length: n }, (_, i) => `Sentence ${n}-${i} gives plain background for the reader.`).join(' ');
let seq = 0;
async function art(pid, { title, focus, secondary = [], html, status = 'ready', createdAt, createdBy = 'ai' }) {
  seq++; const cats = await P.listCategories(pid);
  const a = await A.create({ projectId: pid, h1: title, seoTitle: title, metaDescription: 'm'.repeat(100), focusKeyword: focus, secondaryKeywords: secondary, categoryId: cats[0].id, contentHtml: html || `<h2>${title}</h2><p>${filler(40 + seq)}</p>`, articleType: 'evergreen_guide' });
  await H.db().query("UPDATE articles SET status = $2, created_at = COALESCE($3, created_at), created_by = $4, fact_checked_at = now(), adsense_risk = 'low', quality_score = 90 WHERE id = $1", [a.id, status, createdAt || null, createdBy]);
  return A.get(a.id);
}
const publish = async (pid, a, url) => H.db().query("INSERT INTO publications (project_id, article_id, site_id, mode, status, wp_post_id, wp_url, article_version) SELECT $1, $2, s.id, 'publish', 'published', 500, $3, $4 FROM wp_sites s LIMIT 1", [pid, a.id, url, a.currentVersion]);

test('anchors: found only in free text (not in headings or links), as whole words, case as written; inserted exactly once; a gone anchor is "not there"', opts, async () => {
  const html = '<h2>Wi-Fi 7 router guide</h2><p>Many readers ask about the <a href="/x/">wifi 7 router guide</a> and then the Wi-Fi 7 Router Guide again. A good wifi 7 router guide helps.</p><ul><li>Try the Best Mesh System today.</li></ul>';
  assert.deepEqual(IL.findAnchor(html, 'wifi 7 router guide'), { anchor: 'wifi 7 router guide', sentence: 'A good wifi 7 router guide helps.' }, 'the first FREE occurrence: not the heading, not the linked one');
  assert.equal(IL.findAnchor(html, 'router guid'), null, 'whole words only'); assert.equal(IL.findAnchor('<p>nothing here</p>', 'wifi 7'), null);
  assert.equal(IL.findAnchor(html, 'best mesh system').anchor, 'Best Mesh System', 'the case is kept as written');
  const out = IL.insertLink(html, 'wifi 7 router guide', 'https://s.test/guide/'); assert.equal((out.match(/<a /g) || []).length, 2); assert.ok(out.includes('A good <a href="https://s.test/guide/">wifi 7 router guide</a> helps.')); assert.ok(out.includes('<a href="/x/">wifi 7 router guide</a>'), 'the old link is untouched');
  assert.equal(IL.insertLink(html, 'not in the text', 'https://s.test/'), null); assert.ok(IL.insertLink('<p>a "quote" test phrase</p>', 'test phrase', 'https://s.test/a"b').includes('href="https://s.test/a%22b"'));
  assert.equal(IL.hasLinkTo('<p><a href="https://s.test/guide/">x</a></p>', { slug: 'guide' }), true); assert.equal(IL.hasLinkTo('<p>no</p>', { slug: 'guide' }), false);
});

test('suggestions: a phrase an article already contains becomes the anchor; limits, directions, drafts, and decisions that are never undone by a new search', opts, async () => {
  const pid = await setup();
  const target = await art(pid, { title: 'Wi-Fi 7 router guide', focus: 'wifi 7 router', secondary: ['mesh wifi system'], createdAt: new Date(Date.now() - 5 * 86400000) });
  const mentioner = await art(pid, { title: 'Home network basics', focus: 'home network basics', html: `<h2>Basics</h2><p>${filler(30)} Many people now consider a Wifi 7 Router for the living room. ${filler(5)} A mesh wifi system covers large homes.</p><p>Also see the wifi 7 router again.</p>` });
  const heading = await art(pid, { title: 'Only in a heading', focus: 'only heading', html: '<h2>wifi 7 router</h2><p>Nothing else about it here, only plain words follow in this paragraph.</p>' });
  const linked = await art(pid, { title: 'Already links', focus: 'already links', html: `<p>${filler(20)} Our <a href="https://x.test/${target.slug}/">wifi 7 router</a> piece. A mesh wifi system too.</p>` });
  const r = await IL.suggest(pid); assert.deepEqual([r.created, r.articles], [1, 4], 'only the mentioner: the heading-only and the already-linked article give nothing, nobody else mentions anything');
  const all = await IL.list(pid); const m = all.find((x) => x.fromArticleId === mentioner.id && x.toArticleId === target.id);
  assert.deepEqual([m.anchor, m.direction, m.draft, m.toUrl, m.status, /Wifi 7 Router for the living room/.test(m.context)], ['Wifi 7 Router', 'new_to_old', true, null, 'suggested', true]);
  assert.ok(!all.some((x) => x.fromArticleId === heading.id), 'a phrase only inside a heading is not an anchor'); assert.ok(!all.some((x) => x.fromArticleId === linked.id && x.toArticleId === target.id), 'already linked: no duplicate link');
  assert.equal(all.filter((x) => x.fromArticleId === mentioner.id && x.toArticleId === target.id).length, 1, 'one suggestion per target'); assert.ok(all.every((x) => x.score >= 50 && x.score <= 100));
  assert.ok(!all.some((x) => x.anchor.toLowerCase() === 'mesh wifi system' && x.fromArticleId === mentioner.id), 'a target is linked once, with its best phrase');
  await IL.reject(m.id); await assert.rejects(IL.reject(m.id), /bekleyen öneri/); const again = await IL.suggest(pid); assert.equal(again.created, 0, 'nothing new');
  assert.equal((await IL.list(pid, { status: 'rejected' })).length, 1, 'a rejected suggestion is not offered again');
  const older = await art(pid, { title: 'Old piece', focus: 'old piece topic', createdAt: new Date(Date.now() - 90 * 86400000), html: `<p>${filler(20)} The wifi 7 router guide is the newest one to read.</p>` });
  await IL.suggest(pid); const o2 = (await IL.list(pid)).find((x) => x.fromArticleId === older.id); assert.deepEqual([o2.direction, o2.toArticleId], ['old_to_new', target.id], 'an OLD article pointing to a NEWER one is found and labelled');
  const orph = await IL.orphans(pid); assert.equal(orph.includes(heading.id), true, 'nothing links to the heading-only article'); assert.equal(orph.includes(target.id), false, 'the "Already links" article links to the target');
});

test('applying: needs the target\'s public address (else it stays a draft); the link goes in as a new version WITHOUT withdrawing the checks; the post on the site follows; a changed text makes the suggestion stale', opts, async () => {
  const pid = await setup(); const s = await SI.create(pid, { name: 'Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' });
  const target = await art(pid, { title: 'Wi-Fi 7 router guide', focus: 'wifi 7 router' }); const from = await art(pid, { title: 'Home network basics', focus: 'home network basics', html: `<h2>Basics</h2><p>${filler(45)} Consider a wifi 7 router for the living room. ${filler(4)}</p>` });
  const sent = await PB.prepare(from.id, s.id, { mode: 'publish' }); await PB.send(sent.id); const postId = (await PB.get(sent.id)).wpPostId; assert.equal(wp.posts.size, 1);
  await IL.suggest(pid); const l = (await IL.list(pid))[0]; assert.equal(l.fromArticleId, from.id);
  await assert.rejects(IL.apply(l.id), (e) => e.status === 409 && /henüz yayında değil/.test(e.message)); assert.equal((await IL.list(pid))[0].status, 'suggested');
  await publish(pid, target, 'https://blog.example/wifi-7-router-guide/'); const v0 = from.currentVersion; const words0 = (await A.get(from.id)).wordCount;
  const out = await IL.apply(l.id, { userId: null }); const after = await A.get(from.id);
  assert.deepEqual([out.link.status, after.currentVersion, /<a href="https:\/\/blog\.example\/wifi-7-router-guide\/"[^>]*>wifi 7 router<\/a>/.test(after.contentHtml), after.wordCount, words0, after.factCheckedAt !== null, after.adsenseRisk, after.qualityScore], ['applied', v0 + 1, true, words0, words0, true, 'low', 90], 'not one word changed: the checks stay');
  assert.equal((await A.listVersions(from.id))[0].reason, 'İç bağlantı: “wifi 7 router”'); assert.deepEqual(out.wp, [{ siteId: s.id, queued: true }]);
  while (await SC.workOnce({ ctx: {} })) { /* the queued post update */ } assert.deepEqual([wp.posts.size, wp.posts.get(postId).content.includes('wifi-7-router-guide'), wp.posts.size], [1, true, 1], 'the SAME post got the link');
  await assert.rejects(IL.apply(l.id), /zaten “applied”/); await assert.rejects(IL.apply('00000000-0000-0000-0000-000000000001'), /bulunamadı/);
  // a person edits the paragraph so the anchor is gone: the suggestion goes stale instead of corrupting the text
  const b = await art(pid, { title: 'Another', focus: 'another topic here', html: `<p>${filler(25)} A wifi 7 router again appears here for readers.</p>` }); await IL.suggest(pid); const l2 = (await IL.list(pid)).find((x) => x.fromArticleId === b.id);
  await A.update(b.id, { contentHtml: '<p>The paragraph was rewritten and now has other words only, for a long enough article text to stay valid.</p>' }); await assert.rejects(IL.apply(l2.id), (e) => e.status === 409 && /artık metinde yok/.test(e.message)); assert.equal((await IL.list(pid, { status: 'stale' })).length, 1);
  // engine edits keep the checks; a PERSON's edit still withdraws them (preserveChecks is not reachable from a request body)
  await A.update(from.id, { contentHtml: `${(await A.get(from.id)).contentHtml}<p>Added by a person.</p>`, preserveChecks: true }, { userId: null }); assert.equal((await A.get(from.id)).factCheckedAt, null, 'a request body cannot keep the checks');
});

test('the internal-linking bot suggests every day (free) and never applies; the same article cannot go to a second domain unless a person says so', opts, async () => {
  const pid = await setup(); await art(pid, { title: 'Wi-Fi 7 router guide', focus: 'wifi 7 router' }); await art(pid, { title: 'Home network basics', focus: 'home network basics', html: `<p>${filler(30)} Consider a wifi 7 router at home.</p>` });
  await SC.tick({ now: new Date() }); let j; do { j = await SC.workOnce({ ctx: { newsFetch: async () => ({ status: 200, body: '<rss version="2.0"><channel></channel></rss>', url: 'x' }), gapMs: 0 } }); } while (j && j.botKey !== 'internal_linking');
  assert.deepEqual([j.outcome, j.result.stats.created, /1 yeni iç bağlantı önerisi/.test(j.result.message)], ['done', 1, true]); assert.equal((await IL.list(pid, { status: 'applied' })).length, 0, 'the bot only suggests');
  // two domains
  const s1 = await SI.create(pid, { name: 'First', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); const wp2 = await startFakeWp(); const s2 = await SI.create(pid, { name: 'Second', apiUrl: wp2.url, username: 'editor', password: 'abcd efgh ijkl mnop' });
  try {
    const a = await art(pid, { title: 'Shared text', focus: 'shared text topic' }); await PB.submit(a.id, s1.id, { mode: 'draft' }); while (await SC.workOnce({ ctx: {} })) { /* sent */ }
    await assert.rejects(PB.prepare(a.id, s2.id, { mode: 'draft' }), (e) => e.status === 409 && e.extra.duplicateDomain === true && /“First” sitesine gönderilmiş.*kopya içerik/.test(e.message)); assert.equal((await H.db().query('SELECT count(*)::int n FROM publications WHERE site_id = $1', [s2.id])).rows[0].n, 0);
    const ok = await PB.prepare(a.id, s2.id, { mode: 'draft', allowCrossDomain: true }); assert.equal(ok.status, 'pending'); await PB.send(ok.id); assert.equal(wp2.posts.size, 1);
    const b = await art(pid, { title: 'Failed first', focus: 'failed first topic' }); wp.failNext = { match: /POST \/wp\/v2\/posts/, status: 403, body: { code: 'rest_cannot_create', message: 'no' } }; await PB.submit(b.id, s1.id, { mode: 'draft' }); while (await SC.workOnce({ ctx: {} })) { /* failed */ }
    assert.equal((await PB.prepare(b.id, s2.id, { mode: 'draft' })).status, 'pending', 'a send that failed does not count as "already on another domain"');
  } finally { await wp2.close(); }
});
