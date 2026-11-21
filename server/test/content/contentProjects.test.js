const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const P = require('../../src/content/services/projects');

const opts = { skip: H.skip };
const sum = (cats) => cats.filter((c) => c.status !== 'archived').reduce((a, c) => a + c.targetSharePct, 0);

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

test('pure helpers: whole-phrase topic matching and share redistribution', () => {
  assert.deepEqual(P.matchExcluded('A football match ended 2-1', ['football match', 'porn']), ['football match']);
  assert.deepEqual(P.matchExcluded('Pornography laws', ['porn']), [], 'a part of a word is not a match');
  assert.deepEqual(P.matchExcluded('Celebrity-Gossip roundup', ['celebrity gossip']), ['celebrity gossip'], 'punctuation and case do not matter');
  assert.deepEqual(P.matchExcluded('Çok güvenlik', [{ topic: 'cok guvenlik' }]), ['cok guvenlik'], 'Turkish letters are folded');
  const m = P.redistribute([{ id: 'a', share: 35 }, { id: 'b', share: 25 }, { id: 'c', share: 15 }, { id: 'd', share: 15 }, { id: 'e', share: 10 }], 'a');
  assert.equal([...m.values()].reduce((x, y) => x + y, 0), 100, 'total stays 100');
  assert.ok(!m.has('a'));
  assert.ok(m.get('b') > 25 && m.get('e') > 10);
  for (const n of [1, 2, 3, 7, 11]) {                                 // any split keeps the total exactly 100
    const list = Array.from({ length: n + 1 }, (_, i) => ({ id: String(i), share: i === 0 ? 100 - 5 * n : 5 }));
    assert.equal([...P.redistribute(list, '0').values()].reduce((x, y) => x + y, 0), 100);
  }
  assert.equal(P.redistribute([{ id: 'a', share: 100 }], 'a').size, 0, 'the only category: nothing to give the share to');
});

test('the default project: created once, with the five categories 35/25/15/15/10, archive mode and no domain', opts, async () => {
  const first = await P.seedDefault();
  assert.equal(first.created, true);
  assert.equal((await P.seedDefault()).created, false, 'running it again changes nothing');
  const list = await P.listProjects();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Global Tech Content Site'); assert.equal(list[0].mode, 'archive'); assert.equal(list[0].domain, null);
  assert.equal(list[0].mainNiche, 'AI & Digital Technology Updates'); assert.equal(list[0].isDefault, true);
  const cats = await P.listCategories(first.projectId);
  assert.deepEqual(cats.map((c) => c.targetSharePct), [35, 25, 15, 15, 10]);
  assert.equal(sum(cats), 100);
  assert.deepEqual(cats.map((c) => c.nameEn), ['AI Tools & Updates', 'Apps & Software Updates', 'Digital Privacy & Security', 'Tech Guides & Solutions', 'Digital Services & Pricing']);
  assert.equal(cats[0].dailyMax, 3);
  const ex = await P.listExcluded(first.projectId);
  assert.ok(ex.length >= 20 && ex.every((x) => x.isDefault && x.isActive));
  const p = await P.getProject(first.projectId);
  assert.equal(p.niche.dailyArticleLimit, 3); assert.deepEqual(p.niche.targetCountries, ['US', 'GB', 'CA', 'AU']); assert.equal(p.niche.language, 'en-US');
});

test('projects: create / update / domain checks', opts, async () => {
  await assert.rejects(P.createProject({ name: 'X' }), /Ana niş zorunlu/, 'a new project must name its niche');
  const p = await P.createProject({ name: 'Garden Site', niche: { mainNiche: 'Home gardening', dailyArticleLimit: 2 } });
  assert.equal(p.isDefault, true, 'the first project is the default one');
  assert.equal(p.mode, 'archive'); assert.equal(p.niche.dailyArticleLimit, 2);
  const q = await P.createProject({ name: 'Second', niche: { mainNiche: 'Cars' } });
  assert.equal(q.isDefault, false);
  await assert.rejects(P.updateProject(p.id, { domain: 'https://example.com' }), /Alan adı geçerli/);
  const u = await P.updateProject(p.id, { domain: 'Example.com', name: 'Garden Site 2' });
  assert.equal(u.domain, 'example.com'); assert.equal(u.mode, 'connected'); assert.equal(u.name, 'Garden Site 2');
  const back = await P.updateProject(p.id, { domain: '' });
  assert.equal(back.domain, null); assert.equal(back.mode, 'archive');
  await assert.rejects(P.updateProject(p.id, { timezone: 'Mars/Base' }), /Saat dilimi/);
  await assert.rejects(P.getProject('00000000-0000-0000-0000-000000000001'), /bulunamadı/);
});

test('changing the main niche needs a confirmation, never moves articles, raises the version', opts, async () => {
  const { projectId } = await P.seedDefault();
  await H.db().query("INSERT INTO articles (project_id, slug, h1) VALUES ($1, 'a-1', 'A')", [projectId]);
  await assert.rejects(P.updateNiche(projectId, { mainNiche: 'Fitness' }), (e) => e.status === 409 && e.extra.requiresConfirmation === true && e.extra.articles === 1 && /silinmez/.test(e.message));
  assert.equal((await P.getProject(projectId)).niche.mainNiche, 'AI & Digital Technology Updates', 'nothing changed without the confirmation');
  const ok = await P.updateNiche(projectId, { mainNiche: 'Fitness', confirmNicheChange: true });
  assert.equal(ok.niche.mainNiche, 'Fitness'); assert.equal(ok.niche.version, 2);
  assert.equal((await H.db().query('SELECT count(*)::int n FROM articles WHERE project_id = $1', [projectId])).rows[0].n, 1, 'the article is still there');
  const same = await P.updateNiche(projectId, { mainNiche: 'Fitness', tone: 'Friendly' });
  assert.equal(same.niche.version, 2, 'other fields never ask and never raise the version'); assert.equal(same.niche.tone, 'Friendly');
  await assert.rejects(P.updateNiche(projectId, { dailyArticleLimit: 99 }), /0 ile 50/);
  await assert.rejects(P.updateNiche(projectId, { contentTypes: ['nonsense'] }), /Bilinmeyen içerik türü/);
});

test('category shares: exactly 100, every category named, archive and delete hand the share to the others', opts, async () => {
  const { projectId } = await P.seedDefault();
  const cats = await P.listCategories(projectId);
  const body = (shares) => cats.map((c, i) => ({ id: c.id, share: shares[i] }));
  await assert.rejects(P.setShares(projectId, body([30, 25, 15, 15, 10])), /toplamı %100 olmalı \(şu an %95\)/);
  await assert.rejects(P.setShares(projectId, body([30, 25, 15, 15, 10]).slice(0, 4)), /payı gönderilmedi/);
  await assert.rejects(P.setShares(projectId, [...body([20, 20, 20, 20, 20]), { id: cats[0].id, share: 0 }]), /iki kez/);
  const ok = await P.setShares(projectId, body([20, 20, 20, 20, 20]));
  assert.equal(sum(ok), 100);

  const arch = await P.archiveCategory(cats[0].id);
  assert.equal(arch.status, 'archived'); assert.equal(arch.targetSharePct, 0);
  const after = await P.listCategories(projectId);
  assert.equal(sum(after), 100, 'the archived share went to the others');
  assert.deepEqual(after.filter((c) => c.status !== 'archived').map((c) => c.targetSharePct), [25, 25, 25, 25]);
  assert.equal(after[after.length - 1].status, 'archived', 'archived categories are listed last');
  await assert.rejects(P.updateCategory(cats[0].id, { name: 'x' }), /Arşivlenmiş/);
  await assert.rejects(P.setShares(projectId, body([20, 20, 20, 20, 20])), /arşivlenmiş/, 'an archived category cannot get a share');

  await H.db().query("INSERT INTO articles (project_id, category_id, slug, h1) VALUES ($1, $2, 'a-1', 'A')", [projectId, cats[1].id]);
  await assert.rejects(P.deleteCategory(cats[1].id), (e) => e.status === 409 && /arşivleyin/.test(e.message));
  await P.deleteCategory(cats[4].id);                                  // no articles: deleted, its 25 goes to the three left
  const left = await P.listCategories(projectId);
  assert.equal(left.filter((c) => c.status !== 'archived').length, 3); assert.equal(sum(left), 100);
});

test('categories: create starts at 0%, same English name refused, fields validated', opts, async () => {
  const { projectId } = await P.seedDefault();
  const c = await P.createCategory(projectId, { name: 'Oyun', nameEn: 'Gaming Tech', dailyMax: 1 });
  assert.equal(c.targetSharePct, 0); assert.equal(c.dailyMax, 1);
  assert.equal(sum(await P.listCategories(projectId)), 100, 'a new category does not break the total');
  await assert.rejects(P.createCategory(projectId, { name: 'Oyun 2', nameEn: 'gaming tech' }), /aynı İngilizce adla/);
  await assert.rejects(P.createCategory(projectId, { name: 'Oyun 3', nameEn: 'X', dailyMax: 80 }), /0 ile 50/);
  const u = await P.updateCategory(c.id, { dailyMax: null, relatedKeywords: ['a', 'A', 'b'] });
  assert.equal(u.dailyMax, null); assert.deepEqual(u.relatedKeywords, ['a', 'b']);
});

test('excluded topics: add / duplicate / switch off / remove, and the check uses project and category lists', opts, async () => {
  const { projectId } = await P.seedDefault();
  const cats = await P.listCategories(projectId);
  const t = await P.addExcluded(projectId, { topic: 'Crypto airdrops', reason: 'Spekülatif' });
  await assert.rejects(P.addExcluded(projectId, { topic: 'crypto AIRDROPS' }), /zaten listede/);
  await assert.rejects(P.addExcluded(projectId, { topic: '!!!' }), /harf ya da rakam/);
  let r = await P.checkTopic(projectId, 'Top 5 crypto airdrops this week');
  assert.equal(r.allowed, false); assert.equal(r.matched[0].reason, 'Spekülatif');
  assert.equal((await P.checkTopic(projectId, 'New ChatGPT feature explained')).allowed, true);
  await P.setExcludedActive(t.id, false);
  assert.equal((await P.checkTopic(projectId, 'Crypto airdrops')).allowed, true, 'switched off topics do not block');
  r = await P.checkTopic(projectId, 'How to find hacking tutorials', cats[2].id);
  assert.equal(r.allowed, false, "the category's own excluded list (Digital Privacy & Security: hacking tutorials) applies");
  assert.equal((await P.checkTopic(projectId, 'How to find hacking tutorials', cats[0].id)).allowed, true, 'but not in other categories');
  await P.removeExcluded(t.id);
  await assert.rejects(P.removeExcluded(t.id), /bulunamadı/);
  const other = await P.createProject({ name: 'Other', niche: { mainNiche: 'Cars' } });
  await assert.rejects(P.addExcluded(other.id, { topic: 'x y', categoryId: cats[0].id }), /bu projeye ait değil/);
});
