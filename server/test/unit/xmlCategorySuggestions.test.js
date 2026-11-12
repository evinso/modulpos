const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

// ── route dependencies (the route test at the bottom calls the handler directly) ──
const log = { productQueries: [] };
stub(src('config/database.js'), {
  marketplaceConnection: { findUnique: async () => ({ id: 'c1', storeId: 's1' }) },
  xmlSource: { findFirst: async ({ where }) => (where.id === 'mine' && where.storeId === 's1' ? { id: 'mine' } : null) },
  product: { findMany: async (q) => { log.productQueries.push(q); return [{ title: 'Gümüş Kolye Kalpli', category: 'Kolye' }, { title: 'Çelik Kolye Zirkon', category: 'Kolye' }, { title: 'x', category: null }]; } },
});
stub(src('middleware/auth.js'), { auth: (req, res, next) => next() });
stub(src('middleware/ownership.js'), { ownedParam: () => (req, res, next) => next(), userStoreIds: async () => [] });
stub(src('services/readiness.js'), { getReadinessContext: async () => ({}) });
stub(src('services/productListCache.js'), { invalidate() {}, version: () => 1 });
stub(src('routes/credits.js'), { getSetting: async (k, d) => d, deductCredits: async () => {}, refundCredits: async () => {} });

const { suggestForCategories, spread } = require(src('services/xmlCategorySuggestions.js'));
const { getMatcher } = require(src('services/categoryMatcher.js'));

// A matcher whose answers are chosen by a word in the title: "word:leafId,leafId,leafId"
const LEAVES = {
  kolyeCelik: { id: 1, name: 'Çelik Kolye', path: 'Takı & Mücevher > Kolye > Çelik Kolye' },
  kolyeZirkon: { id: 2, name: 'Zirkon Kolye', path: 'Takı & Mücevher > Kolye > Zirkon Kolye' },
  kolyeGumus: { id: 3, name: 'Gümüş Kolye', path: 'Takı & Mücevher > Kolye > Gümüş Kolye' },
  pirinc: { id: 4, name: 'Pirinç', path: 'Süpermarket > Kuru Bakliyat > Pirinç' },
  tencere: { id: 5, name: 'Tencere', path: 'Ev > Mutfak > Tencere' },
  paspas: { id: 6, name: 'Paspas', path: 'Ev > Temizlik > Paspas' },
  lamba: { id: 7, name: 'Lamba', path: 'Ev > Aydınlatma > Lamba' },
  setCelik: { id: 8, name: 'Çelik Set', path: 'Takı & Mücevher > Set & Takım > Çelik Set' },
};
const fake = (rules, byName = {}) => ({
  suggest(title, { top = 3 } = {}) {
    const hit = (rules[Object.keys(rules).find((k) => String(title).includes(k))] || byName[title] || []);
    return hit.slice(0, top).map((k, i) => ({ ...LEAVES[k], score: 10 - i, coverage: 1 }));
  },
});
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test('a plain category: the suggestions, how many titles back them, not mixed', () => {
  const m = fake({ celik: ['kolyeCelik', 'kolyeZirkon', 'kolyeGumus'], zirkon: ['kolyeZirkon', 'kolyeCelik', 'kolyeGumus'] });
  const products = [...many(10, () => ({ title: 'celik kolye', category: 'Kolye' })), ...many(10, () => ({ title: 'zirkon kolye', category: 'Kolye' }))];
  const [r] = suggestForCategories(products, m);
  assert.equal(r.category, 'Kolye');
  assert.equal(r.total, 20);
  assert.equal(r.suggestions.length, 3);
  assert.ok(r.suggestions.every((s) => s.share === 1), 'all three are in the top 3 of every title');
  assert.equal(r.agree, 1, 'both leaves are of one family (Takı & Mücevher > Kolye)');
  assert.equal(r.mixed, false);
  assert.equal(r.weak, false);
  assert.deepEqual(Object.keys(r.suggestions[0]).sort(), ['id', 'name', 'path', 'share']);
});

test('titles that split over material variants of one kind do not make a category "mixed"', () => {
  const m = fake({ celik: ['kolyeCelik'], zirkon: ['kolyeZirkon'], gumus: ['kolyeGumus'] });
  const products = [...many(10, () => ({ title: 'celik', category: 'Kolye' })), ...many(10, () => ({ title: 'zirkon', category: 'Kolye' })), ...many(10, () => ({ title: 'gumus', category: 'Kolye' }))];
  const [r] = suggestForCategories(products, m);
  assert.equal(r.agree, 1);
  assert.equal(r.mixed, false);
});

test('titles that point to different kinds of products: mixed, and the different answers are all kept', () => {
  const m = fake({ tencere: ['tencere'], paspas: ['paspas'], lamba: ['lamba'] });
  const products = [...many(10, () => ({ title: 'tencere', category: 'Ev ve Yaşam' })), ...many(10, () => ({ title: 'paspas', category: 'Ev ve Yaşam' })), ...many(10, () => ({ title: 'lamba', category: 'Ev ve Yaşam' }))];
  const [r] = suggestForCategories(products, m);
  assert.equal(r.mixed, true);
  assert.ok(r.agree < 0.4);
  assert.equal(r.suggestions.length, 3, 'a mixed category keeps its different suggestions, the user decides');
});

test('a category that is not mixed drops answers from another top-level category (brass vs rice)', () => {
  const m = fake({ celik: ['kolyeCelik', 'pirinc', 'setCelik'] });
  const products = many(20, () => ({ title: 'celik', category: 'Kolye' }));
  const [r] = suggestForCategories(products, m);
  assert.equal(r.mixed, false);
  assert.deepEqual(r.suggestions.map((s) => s.id), [1, 8], 'rice is gone; the jewelry set stays');
});

test('a small category is marked weak, and no category is mixed on fewer than 5 voters', () => {
  const m = fake({ tencere: ['tencere'], paspas: ['paspas'] });
  const [r] = suggestForCategories([{ title: 'tencere', category: 'Kutu' }, { title: 'paspas', category: 'Kutu' }], m);
  assert.equal(r.weak, true);
  assert.equal(r.mixed, false);
});

test('the category\'s own name decides when the titles say nothing', () => {
  const m = fake({}, { Tencere: ['tencere'] });
  const [r] = suggestForCategories(many(8, () => ({ title: 'ürün', category: 'Tencere' })), m);
  assert.equal(r.suggestions[0].id, 5);
  assert.equal(r.agree, 0, 'no title voted');
});

test('categories without a name are skipped, the name is kept exactly as stored, the biggest category comes first', () => {
  const m = fake({});
  const rows = suggestForCategories([
    { title: 'a', category: null }, { title: 'b', category: '' }, { title: 'c', category: '  ' },
    { title: 'd', category: 'Oyuncak &amp; Kırtasiye' }, { title: 'e', category: 'Küçük' }, { title: 'f', category: 'Oyuncak &amp; Kırtasiye' },
  ], m);
  assert.deepEqual(rows.map((r) => [r.category, r.total]), [['Oyuncak &amp; Kırtasiye', 2], ['Küçük', 1]]);
});

test('titles are sampled over the WHOLE category, not only its first products', () => {
  const list = many(300, (i) => i);
  const picked = spread(list, 30);
  assert.equal(picked.length, 30);
  assert.equal(picked[0], 0);
  assert.ok(picked[29] >= 280, 'reaches the end of the list');
  assert.deepEqual(spread([1, 2, 3], 30), [1, 2, 3]);
  // a feed sorted so that the first 30 products are necklaces and the rest are rings: the rings must be seen
  const m = fake({ kolye: ['kolyeCelik'], yuzuk: ['paspas'] });
  const products = [...many(60, () => ({ title: 'kolye', category: 'Takı' })), ...many(240, () => ({ title: 'yuzuk', category: 'Takı' }))];
  const [r] = suggestForCategories(products, m);
  assert.ok(r.suggestions.some((s) => s.id === 6), 'the later products were looked at');
});

test('with the real Trendyol tree: necklace titles give a necklace category', () => {
  const products = [
    'Gümüş Kalpli Kolye', 'Çelik Zirkon Taşlı Kolye', 'Altın Kaplama Zincir Kolye', 'Kadın Harf Kolye', 'İnci Detaylı Kolye', 'Zirkon Taşlı Kolye Çelik',
  ].map((title) => ({ title, category: 'Kolye' }));
  const [r] = suggestForCategories(products, getMatcher());
  assert.ok(/kolye/i.test(r.suggestions[0].path), r.suggestions[0].path);
  assert.equal(r.mixed, false);
});

// ── the route ──
const router = require(src('routes/productCategories.js'));
const handler = router.stack.find((l) => l.route && l.route.path === '/connections/:id/product-categories/category-suggestions' && l.route.methods.get).route.stack[0].handle;
async function call(query) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let err = null;
  await handler({ params: { id: 'c1' }, query }, res, (e) => { err = e; });
  if (err) throw err;
  return res;
}

test('route: needs a XML source (not "none", not missing)', async () => {
  assert.equal((await call({})).code, 400);
  assert.equal((await call({ xmlSourceId: 'none' })).code, 400);
});

test('route: a source of another store is not found and no product is read', async () => {
  log.productQueries = [];
  const r = await call({ xmlSourceId: 'someone-elses' });
  assert.equal(r.code, 404);
  assert.equal(log.productQueries.length, 0);
});

test('route: reads only the products of this store and source that have a category, answers per XML category', async () => {
  log.productQueries = [];
  const r = await call({ xmlSourceId: 'mine' });
  assert.equal(r.code, 200);
  assert.deepEqual(log.productQueries[0].where, { storeId: 's1', xmlSourceId: 'mine', category: { not: null } });
  assert.equal(r.body.categories.length, 1, 'the product without a category is left out');
  assert.equal(r.body.categories[0].category, 'Kolye');
  assert.equal(r.body.categories[0].total, 2);
  assert.ok(r.body.categories[0].suggestions.length > 0);
});
