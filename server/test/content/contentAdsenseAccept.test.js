const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const S = require('../../src/content/services/settings');

/**
 * A person accepts the reviewer's AdSense class "inceleme gerekli" (and, with it, approves); a LIVE article keeps reading "Yayımlandı" and is never moved back to "Onay bekliyor";
 * the list says which articles are live. The class itself is never rewritten: the record keeps what the reviewer said.
 */
const opts = { skip: H.skip };
const q = (sql, p = []) => H.db().query(sql, p).then((r) => r.rows);
const q1 = async (sql, p = []) => (await q(sql, p))[0];
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

/** an article that fails ONLY on the AdSense class (class "review", everything else in order) */
async function reviewArticle(extra = {}) {
  const { projectId } = await P.seedDefault(); const cats = await P.listCategories(projectId);
  const a = await A.create({ projectId, categoryId: cats[0].id, h1: `Signal blocks agents ${Math.random().toString(36).slice(2, 7)}`, seoTitle: 'Signal blocks AI agents from reading chats', metaDescription: 'x'.repeat(100), focusKeyword: `signal agents ${Math.random().toString(36).slice(2, 7)}`, articleType: 'how_to_guide', contentHtml: `<h2>Intro</h2><p>${words(420)}</p>`, ...extra });
  await A.update(a.id, { adsenseRisk: 'review' }); await A.markFactChecked(a.id); await A.setSources(a.id, [{ url: 'https://example.com/news', title: 'Source', publisher: 'Example' }]);
  return { projectId, id: a.id };
}
const blocking = async (id) => (await A.readiness(id)).problems.filter((p) => p.blocking).map((p) => p.code);
const publish = async (projectId, id, over = {}) => {
  const site = (await q1("INSERT INTO wp_sites (project_id, name, api_url, username, encrypted_password) VALUES ($1, 'Site' || substr(md5(random()::text), 1, 5), 'https://wp' || substr(md5(random()::text), 1, 8) || '.example', 'u', 'x') RETURNING id", [projectId])).id;
  return (await q1("INSERT INTO publications (project_id, article_id, site_id, status, mode, wp_post_id, wp_url, published_at, article_version) VALUES ($1,$2,$3,'published','draft','386','https://wp.example/signal/', now(), $4) RETURNING id", [projectId, id, site, over.version || 1])).id;
};

test('accepting the AdSense class: the class stays what the reviewer said, readiness stops blocking on it (a note remains), "approve" puts it on "Yayına hazır", and taking it back blocks again', opts, async () => {
  const { id } = await reviewArticle();
  assert.deepEqual(await blocking(id), ['adsense_risk']);
  const r = await A.acceptAdsense(id);
  assert.deepEqual([r.article.adsenseRisk, r.article.adsenseAccepted, r.approved, r.article.status], ['review', true, false, 'needs_review'], 'accepted, not approved: that is a separate choice');
  assert.deepEqual(await blocking(id), []); assert.ok((await A.readiness(id)).problems.some((p) => p.code === 'adsense_accepted' && p.blocking === false && /siz kabul ettiniz/.test(p.message)));
  const w = await A.acceptAdsense(id, { accept: false }); assert.deepEqual([w.article.adsenseAccepted, await blocking(id)], [false, ['adsense_risk']]);
  const go = await A.acceptAdsense(id, { accept: true, approve: true });
  assert.deepEqual([go.approved, go.article.status, go.article.adsenseRisk], [true, 'ready', 'review']);
});

test('what cannot be accepted: "yayınlanamaz", a class that is already low, a class that was never measured; and an acceptance with ANOTHER blocker keeps the acceptance and says what else stops it', opts, async () => {
  const { id } = await reviewArticle();
  await A.update(id, { adsenseRisk: 'blocked' }); await assert.rejects(A.acceptAdsense(id), (e) => e.status === 409 && /kabul edilemez/.test(e.message));
  await A.update(id, { adsenseRisk: 'low' }); await assert.rejects(A.acceptAdsense(id), (e) => e.status === 409 && /zaten “düşük”/.test(e.message));
  await q('UPDATE articles SET adsense_risk = NULL WHERE id = $1', [id]); await assert.rejects(A.acceptAdsense(id), (e) => e.status === 409 && /henüz belirlenmedi/.test(e.message));
  await A.update(id, { adsenseRisk: 'review' }); await q('UPDATE articles SET fact_checked_at = NULL WHERE id = $1', [id]);          // the fact check is missing too
  const r = await A.acceptAdsense(id, { accept: true, approve: true });
  assert.deepEqual([r.approved, r.article.adsenseAccepted, r.article.status], [false, true, 'needs_review']); assert.match(r.reason, /Doğruluk kontrolü yapılmadı/);
});

test('a change of the text of an AI article resets its checks and the acceptance goes with them; a person\'s own article keeps its class and acceptance', opts, async () => {
  const { id } = await reviewArticle(); await q("UPDATE articles SET created_by = 'ai' WHERE id = $1", [id]);
  await A.acceptAdsense(id); assert.equal((await A.get(id)).adsenseAccepted, true);
  await A.update(id, { contentHtml: `<h2>Intro</h2><p>${words(430)}</p>` });
  const a = await A.get(id); assert.deepEqual([a.adsenseRisk, a.adsenseAccepted, a.adsenseAcceptedAt], [null, false, null], 'the class was about the OLD text');
});

test('a LIVE article (its publication is "published"): the list says so, it can never be put on "Onay bekliyor" / "Yayına hazır", "Güncelleme bekliyor" can go back to "Yayımlandı", an archived live one comes back as published; a NOT live one cannot be called published by hand', opts, async () => {
  const { projectId, id } = await reviewArticle(); const other = await reviewArticle();
  await publish(projectId, id, { version: 1 });
  await A.setStatus(id, 'needs_update');
  await assert.rejects(A.setStatus(id, 'needs_review'), (e) => e.status === 409 && /WordPress’te yayında/.test(e.message));
  assert.equal((await A.setStatus(id, 'published')).status, 'published', 'no update needed: it stays what it is');
  const v0 = (await A.get(id)).currentVersion;
  await A.update(id, { metaDescription: `${'A person improved the meta text. '.repeat(4)}` });                       // a newer version is written
  await assert.rejects(A.setStatus(id, 'archived'), (e) => e.status === 409, 'a published article is not archived by hand');
  await q("UPDATE articles SET status = 'archived', archived_at = now() WHERE id = $1", [id]); assert.equal((await A.setStatus(id, 'needs_review')).status, 'published', 'restore of a live article gives back what it is');
  const list = await A.list({ projectId }); const live = list.items.find((x) => x.id === id); const notLive = list.items.find((x) => x.id === other.id);
  assert.deepEqual([live.live.url, live.live.version, live.currentVersion, live.status], ['https://wp.example/signal/', 1, v0 + 1, 'published'], 'live on the site as v1 while the page has a newer version');
  assert.equal(notLive.live, null);
  assert.equal((await A.get(id)).live.url, 'https://wp.example/signal/');
  await A.setStatus(other.id, 'needs_update'); await assert.rejects(A.setStatus(other.id, 'published'), (e) => e.status === 409 && /WordPress modülüyle/.test(e.message));
});

test('the data repair of migration 0019: a live article that reads "Onay bekliyor" becomes "Yayımlandı", a live "review" class is marked as accepted by publishing, a NOT live article is left alone', opts, async () => {
  const a = await reviewArticle(); const b = await reviewArticle(); const c = await reviewArticle();
  await publish(a.projectId, a.id); await publish(b.projectId, b.id); await q("UPDATE articles SET status = 'needs_update' WHERE id = $1", [b.id]);
  await q('UPDATE articles SET adsense_accepted_risk = NULL, adsense_accepted_at = NULL, adsense_accepted_note = NULL');
  const sql = fs.readFileSync(path.join(__dirname, '../../src/content/migrations/0019_adsense_accept_and_live_status.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((x) => x.trim()).filter((x) => /^UPDATE/i.test(x));
  assert.equal(sql.length, 2); for (const st of sql) await q(st);
  const A1 = await A.get(a.id); const B1 = await A.get(b.id); const C1 = await A.get(c.id);
  assert.deepEqual([A1.status, A1.adsenseAccepted, B1.status, B1.adsenseAccepted, C1.status, C1.adsenseAccepted], ['published', true, 'needs_update', true, 'needs_review', false]);
  assert.match(A1.adsenseAcceptedNote, /yayımlandı/);
});

test('bulk "accept AdSense warning and approve": each article on its own; one with another blocker is reported, the others go through', opts, async () => {
  const a = await reviewArticle(); const b = await reviewArticle(); await q('UPDATE articles SET fact_checked_at = NULL WHERE id = $1', [b.id]);
  const out = await A.bulk({ ids: [a.id, b.id], action: 'accept_adsense' });
  assert.deepEqual(out.done, [a.id]); assert.equal(out.failed.length, 1); assert.match(out.failed[0].message, /kabul edildi ama onaylanamadı/);
  assert.deepEqual([(await A.get(a.id)).status, (await A.get(b.id)).status, (await A.get(b.id)).adsenseAccepted], ['ready', 'needs_review', true]);
});
