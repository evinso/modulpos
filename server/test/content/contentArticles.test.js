const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');

const opts = { skip: H.skip };
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const body = (extra = {}) => `<h2>Intro</h2><p>${words(extra.n || 320)}</p>`;

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

async function site() { const { projectId } = await P.seedDefault(); return { projectId, cats: await P.listCategories(projectId) }; }
async function article(extra = {}) {
  const { projectId, cats } = await site();
  return A.create({ projectId, categoryId: cats[0].id, h1: 'A New AI Tool Explained', seoTitle: 'A New AI Tool Explained for Everyone', metaDescription: 'x'.repeat(100), focusKeyword: 'new ai tool', articleType: 'how_to_guide', contentHtml: body(), ...extra });
}

test('create: sanitised HTML, slug from the title (made unique), version 1, word count, needs_review', opts, async () => {
  const a = await article({ contentHtml: `<h1>Big</h1><p onclick="x()">Hi <script>alert(1)</script><b>there</b> <a href="javascript:alert(1)">bad</a> <a href="https://example.com/x">ok</a></p><img src="http://insecure/x.png"><iframe src="https://evil"></iframe><style>p{}</style>` });
  assert.equal(a.slug, 'a-new-ai-tool-explained'); assert.equal(a.status, 'needs_review'); assert.equal(a.currentVersion, 1); assert.equal(a.createdBy, 'manual'); assert.equal(a.manualEdited, true);
  assert.ok(!/script|onclick|javascript:|iframe|<style|http:\/\/insecure/.test(a.contentHtml), a.contentHtml);
  assert.ok(a.contentHtml.includes('<h2>Big</h2>') && a.contentHtml.includes('href="https://example.com/x"') && a.contentHtml.includes('rel="noopener"'));
  const b = await A.create({ projectId: a.projectId, h1: 'A New AI Tool Explained', contentHtml: body() });
  assert.equal(b.slug, 'a-new-ai-tool-explained-2');
  await assert.rejects(A.create({ projectId: a.projectId, h1: 'Other', slug: 'a-new-ai-tool-explained' }), (e) => e.status === 409);
  await assert.rejects(A.create({ projectId: a.projectId, h1: 'Other', slug: 'Bad Slug!' }), /küçük harf/);
  await assert.rejects(A.create({ projectId: a.projectId, h1: '' }), /zorunlu/);
  await assert.rejects(A.create({ projectId: a.projectId, h1: 'x', featuredImageUrl: 'http://x.com/a.png' }), /https/);
  await assert.rejects(A.create({ projectId: '00000000-0000-0000-0000-000000000001', h1: 'x' }), /Proje bulunamadı/);
  const versions = await A.listVersions(a.id); assert.deepEqual(versions.map((v) => v.version), [1]);
});

test('update: new version only when something changed; "Last Updated" moves only on a meaningful update; changed facts must be checked again', opts, async () => {
  const a = await article();
  await A.markFactChecked(a.id);
  assert.ok((await A.get(a.id)).factCheckedAt);
  const same = await A.update(a.id, { h1: a.h1 });
  assert.equal(same.currentVersion, 1, 'nothing changed: no new version'); assert.equal(same.lastUpdatedAt, null);
  const meta = await A.update(a.id, { metaDescription: 'y'.repeat(120), reason: 'Meta düzeltildi' });
  assert.equal(meta.currentVersion, 2); assert.equal(meta.lastUpdatedAt, null, 'a typo-level change does not move Last Updated');
  assert.ok(meta.factCheckedAt, 'a meta change does not invalidate the fact check');
  const body2 = await A.update(a.id, { contentHtml: body({ n: 400 }), meaningful: true, reason: 'Yeni bölüm' });
  assert.equal(body2.currentVersion, 3); assert.ok(body2.lastUpdatedAt); assert.equal(body2.wordCount, 401, 'Intro + 400 words'); assert.equal(body2.factCheckedAt, null, 'new content = checked again');
  const only = await A.update(a.id, { meaningful: true });
  assert.equal(only.currentVersion, 3, 'meaningful without a change: the date moves, no new version');
  const v = await A.listVersions(a.id);
  assert.deepEqual(v.map((x) => [x.version, x.reason]), [[3, 'Yeni bölüm'], [2, 'Meta düzeltildi'], [1, 'İlk sürüm']]);
  assert.equal(v[0].wordCount, 401);
  await assert.rejects(A.update(a.id, { slug: 'x y' }), /küçük harf/);
  await assert.rejects(A.update(a.id, { faq: [{ q: 'only question', a: '' }] }), /boş olamaz/);
  const faq = await A.update(a.id, { faq: [{ q: 'Is it free?', a: '<p>Yes <script>x</script></p>' }], tags: ['ai', 'AI', 'tools'] });
  assert.deepEqual(faq.faq, [{ q: 'Is it free?', a: '<p>Yes </p>' }]); assert.deepEqual(faq.tags, ['ai', 'tools']);
});

test('two editors: a save based on an old version is refused, never silently overwrites', opts, async () => {
  const a = await article();
  await A.update(a.id, { h1: 'Editor one title', expectedVersion: 1 });
  await assert.rejects(A.update(a.id, { h1: 'Editor two title', expectedVersion: 1 }), (e) => e.status === 409 && e.extra.currentVersion === 2);
  assert.equal((await A.get(a.id)).h1, 'Editor one title');
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => A.update(a.id, { seoTitle: `Concurrent ${i}`, expectedVersion: 2 })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'of six simultaneous saves on the same version exactly one wins');
  assert.equal((await A.get(a.id)).currentVersion, 3);
});

test('versions: read one, restore as a NEW version, the link and a gone category are kept', opts, async () => {
  const a = await article();
  await A.update(a.id, { h1: 'Second title', slug: 'second-title', contentHtml: body({ n: 350 }) });
  const v1 = await A.getVersion(a.id, 1);
  assert.equal(v1.snapshot.h1, 'A New AI Tool Explained'); assert.equal(v1.snapshot.slug, 'a-new-ai-tool-explained');
  const r = await A.restoreVersion(a.id, 1);
  assert.equal(r.h1, 'A New AI Tool Explained'); assert.equal(r.currentVersion, 3); assert.equal(r.slug, 'second-title', 'the link does not change by a restore'); assert.equal(r.restoredFrom, 1);
  assert.deepEqual((await A.listVersions(a.id)).map((v) => v.version), [3, 2, 1], 'history is never rewritten');
  await assert.rejects(A.getVersion(a.id, 99), /Sürüm bulunamadı/);
  const cats = await P.listCategories(a.projectId);
  await A.update(a.id, { categoryId: cats[1].id });
  await P.archiveCategory(cats[0].id);
  const again = await A.restoreVersion(a.id, 1);
  assert.equal(again.categoryId, cats[1].id, 'the archived old category is not forced back');
});

test('readiness and "ready": every mandatory check is a blocking problem until it is done', opts, async () => {
  const a = await article({ h1: 'Unrelated Gardening Tips For Spring', focusKeyword: 'spring gardening', articleType: 'latest_update', contentHtml: body({ n: 100 }) });
  let r = await A.readiness(a.id);
  const codes = () => r.problems.filter((p) => p.blocking).map((p) => p.code).sort();
  assert.deepEqual(codes(), ['adsense_risk'].filter(() => false).concat(['no_adsense', 'no_sources', 'not_fact_checked', 'too_short']).sort());
  await assert.rejects(A.setStatus(a.id, 'ready'), (e) => e.status === 409 && /yayına hazır değil/.test(e.message) && e.extra.problems.length >= 4);
  await A.update(a.id, { contentHtml: body({ n: 420 }), adsenseRisk: 'review' });
  await A.markFactChecked(a.id); await A.setSources(a.id, [{ url: 'https://example.com/news', title: 'Source', publisher: 'Example' }]);
  r = await A.readiness(a.id); assert.deepEqual(codes(), ['adsense_risk']);
  assert.match(r.problems.find((p) => p.code === 'adsense_risk').message, /inceleme gerekli/);
  await A.update(a.id, { adsenseRisk: 'blocked' }); r = await A.readiness(a.id); assert.match(r.problems.find((p) => p.code === 'adsense_risk').message, /yayınlanamaz/);
  await A.update(a.id, { adsenseRisk: 'low' }); await A.markFactChecked(a.id);                     // the edit reset the fact check
  r = await A.readiness(a.id); assert.deepEqual(codes(), [], JSON.stringify(r.problems));
  assert.equal((await A.setStatus(a.id, 'ready')).status, 'ready');
  assert.equal((await A.setStatus(a.id, 'needs_review')).status, 'needs_review');
});

test('readiness: cannibalisation, excluded topics, quality score, category and source rules', opts, async () => {
  const a = await article();
  const b = await A.create({ projectId: a.projectId, categoryId: a.categoryId, h1: 'Different headline', focusKeyword: 'new ai tool', contentHtml: body() });
  assert.ok((await A.readiness(b.id)).problems.some((p) => p.code === 'duplicate' && p.blocking), 'same focus keyword');
  await A.setStatus(a.id, 'archived');
  assert.ok(!(await A.readiness(b.id)).problems.some((p) => p.code === 'duplicate'), 'an archived article does not compete');
  const c = await A.create({ projectId: a.projectId, categoryId: a.categoryId, h1: 'Football match tonight: who plays', focusKeyword: 'tonight', contentHtml: body() });
  assert.ok((await A.readiness(c.id)).problems.some((p) => p.code === 'excluded_topic'));
  const d = await A.create({ projectId: a.projectId, h1: 'No category here', contentHtml: body() });
  assert.ok((await A.readiness(d.id)).problems.some((p) => p.code === 'no_category' && p.blocking));
  await H.db().query('UPDATE articles SET quality_score = 60 WHERE id = $1', [b.id]);
  assert.ok((await A.readiness(b.id)).problems.some((p) => p.code === 'low_quality'), 'the quality setting minScore (85) applies');
  assert.equal((await A.readiness(b.id)).problems.find((p) => p.code === 'no_sources').blocking, false, 'sources are required only for news types');
});

test('status machine: manual transitions only, engine states cannot be set, archive / restore / delete rules', opts, async () => {
  const a = await article();
  await assert.rejects(A.setStatus(a.id, 'published'), (e) => e.status === 409 && /WordPress/.test(e.message));
  await assert.rejects(A.setStatus(a.id, 'generating'), /yapılamaz/);
  await assert.rejects(A.setStatus(a.id, 'nonsense'), /şunlardan biri/);
  const arch = await A.setStatus(a.id, 'archived'); assert.equal(arch.status, 'archived'); assert.ok(arch.archivedAt);
  const back = await A.setStatus(a.id, 'needs_review'); assert.equal(back.archivedAt, null);
  await H.db().query("UPDATE articles SET status = 'published' WHERE id = $1", [a.id]);
  await assert.rejects(A.remove(a.id), (e) => e.status === 409 && /silinemez/.test(e.message));
  await assert.rejects(A.update(a.id, { h1: 'x' }).then(() => H.db().query("UPDATE articles SET status = 'generating' WHERE id = $1", [a.id])).then(() => A.update(a.id, { h1: 'y' })), /üretiliyor/);
  await H.db().query("UPDATE articles SET status = 'archived' WHERE id = $1", [a.id]);
  await A.remove(a.id);
  await assert.rejects(A.get(a.id), /bulunamadı/);
  assert.equal((await H.db().query('SELECT count(*)::int n FROM article_versions')).rows[0].n, 0, 'versions go with the article');
});

test('list: filters, search (with % and _ taken literally), sorting, paging', opts, async () => {
  const { projectId, cats } = await site();
  const mk = (h1, extra = {}) => A.create({ projectId, h1, contentHtml: body({ n: 50 }), ...extra });
  const a1 = await mk('Alpha guide', { categoryId: cats[0].id, focusKeyword: 'alpha' });
  const a2 = await mk('Beta 100% review', { categoryId: cats[1].id, articleType: 'comparison' });
  await mk('Gamma_snake notes', { categoryId: cats[1].id });
  await A.setStatus(a1.id, 'archived');
  assert.equal((await A.list({ projectId })).total, 3);
  assert.deepEqual((await A.list({ projectId, status: 'archived' })).items.map((x) => x.h1), ['Alpha guide']);
  assert.equal((await A.list({ projectId, status: 'archived,needs_review' })).total, 3);
  assert.equal((await A.list({ projectId, categoryId: cats[1].id })).total, 2);
  assert.equal((await A.list({ projectId, type: 'comparison' })).total, 1);
  assert.deepEqual((await A.list({ projectId, q: '100%' })).items.map((x) => x.id), [a2.id], '% is literal');
  assert.equal((await A.list({ projectId, q: 'a_s' })).total, 1, '_ is literal'); assert.equal((await A.list({ projectId, q: 'a%s' })).total, 0);
  assert.deepEqual((await A.list({ projectId, sort: 'title', dir: 'asc' })).items.map((x) => x.h1), ['Alpha guide', 'Beta 100% review', 'Gamma_snake notes']);
  const p = await A.list({ projectId, pageSize: 2, page: 2, sort: 'title', dir: 'asc' }); assert.deepEqual([p.total, p.items.length], [3, 1]);
  assert.ok(!('contentHtml' in p.items[0]), 'the list never carries the article bodies');
  await assert.rejects(A.list({ status: 'nope' }), /Bilinmeyen durum/); await assert.rejects(A.list({ from: '1.1.2026' }), /YYYY/);
  assert.equal((await A.list({ projectId, from: '2020-01-01', to: '2099-01-01' })).total, 3);
  assert.equal((await A.list({ projectId, to: '2020-01-01' })).total, 0);
});

test('bulk: every article is tried on its own and failures are named', opts, async () => {
  const { projectId, cats } = await site();
  const [x, y, z] = await Promise.all([1, 2, 3].map((i) => A.create({ projectId, h1: `Bulk ${i}`, contentHtml: body({ n: 50 }) })));
  await H.db().query("UPDATE articles SET status = 'published' WHERE id = $1", [z.id]);
  const arch = await A.bulk({ ids: [x.id, y.id, z.id], action: 'archive' });
  assert.deepEqual(arch.done.sort(), [x.id, y.id].sort()); assert.equal(arch.failed.length, 1); assert.equal(arch.failed[0].id, z.id); assert.match(arch.failed[0].message, /yapılamaz/);
  assert.equal((await A.bulk({ ids: [x.id, y.id], action: 'restore' })).done.length, 2);
  const cat = await A.bulk({ ids: [x.id, y.id], action: 'set_category', categoryId: cats[2].id });
  assert.equal(cat.done.length, 2); assert.equal((await A.get(x.id)).categoryId, cats[2].id);
  const del = await A.bulk({ ids: [x.id, z.id], action: 'delete' }); assert.deepEqual(del.done, [x.id]); assert.equal(del.failed[0].id, z.id);
  await assert.rejects(A.bulk({ ids: [], action: 'archive' }), /1 ile 200/); await assert.rejects(A.bulk({ ids: [x.id], action: 'explode' }), /şunlardan biri/);
  await assert.rejects(A.bulk({ ids: ['not-a-uuid'], action: 'archive' }), /geçersiz/);
});

test('export: csv (formula-safe, BOM), json, html, markdown; filters and ids', opts, async () => {
  const a = await article({ h1: '=HYPERLINK("http://evil")', contentHtml: '<h2>Title</h2><p>Hello <strong>world</strong> and <a href="https://example.com">a link</a>.</p><ul><li>one</li><li>two</li></ul>' });
  await A.setSources(a.id, [{ url: 'https://example.com/src', title: 'S' }]);
  await A.create({ projectId: a.projectId, h1: 'Second article', contentHtml: body({ n: 30 }) });
  const csv = await A.exportArticles({ projectId: a.projectId }, 'csv');
  assert.equal(csv.count, 2); assert.ok(csv.body.startsWith('﻿')); assert.ok(csv.body.includes("'=HYPERLINK"), 'a leading = is neutralised'); assert.ok(csv.body.includes('https://example.com/src'));
  assert.match(csv.filename, /^articles-\d{4}-\d{2}-\d{2}\.csv$/); assert.match(csv.contentType, /text\/csv/);
  const json = JSON.parse((await A.exportArticles({ ids: [a.id] }, 'json')).body);
  assert.equal(json.count, 1); assert.equal(json.articles[0].sources[0].url, 'https://example.com/src'); assert.ok(json.articles[0].contentHtml.includes('<strong>world</strong>'));
  const md = (await A.exportArticles({ ids: [a.id] }, 'markdown')).body;
  assert.ok(md.startsWith('---\ntitle: ') && md.includes('**world**') && md.includes('[a link](https://example.com)') && md.includes('- one\n- two'), md);
  const html = (await A.exportArticles({ ids: [a.id] }, 'html')).body;
  assert.ok(html.includes('<article data-slug=') && html.includes('&quot;http://evil&quot;') && !html.includes('<h1>=HYPERLINK("http'), 'the title is escaped in the html export');
  await assert.rejects(A.exportArticles({}, 'pdf'), /Biçim/);
  assert.equal((await A.exportArticles({ projectId: a.projectId, q: 'Second' }, 'json')).count, 1);
});

test('sources and counts: validation, replace-all, numbers for the dashboard', opts, async () => {
  const a = await article();
  await assert.rejects(A.setSources(a.id, [{ url: 'ftp://x.com/a' }]), /http ya da https/); await assert.rejects(A.setSources(a.id, [{ url: 'nonsense' }]), /geçerli değil/);
  assert.equal(await A.setSources(a.id, [{ url: 'https://a.com/1' }, { url: 'https://b.com/2', title: 'B', publisher: 'B Inc' }]), 2);
  assert.equal((await A.get(a.id)).sources.length, 2);
  assert.equal(await A.setSources(a.id, []), 0); assert.equal((await A.get(a.id)).sources.length, 0);
  const c = await A.counts(a.projectId);
  assert.equal(c.total, 1); assert.equal(c.status.needs_review, 1); assert.equal(c.status.published, 0); assert.equal(c.adsenseUnchecked, 1); assert.equal(c.categories.length, 5); assert.equal(c.categories[0].articles, 1);
  assert.equal(c.daily.length, 1); assert.equal(c.daily[0].count, 1);
});
