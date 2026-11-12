const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Routes and services run with stand-ins for the AI vendor, credits, auth, database and readiness: no network, no database.
const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const db = { rows: [], products: [], mappings: [], sources: [{ id: 'src1', storeId: 's1' }] };
const state = { create: null, charges: [], refunds: [], cost: '0.1', apiKey: 'sk-test', creditError: null, prompts: [] };
class FakeAnthropic { constructor() { this.messages = { create: (...a) => state.create(...a) }; } }
stub('@anthropic-ai/sdk', FakeAnthropic);
stub(src('middleware/auth.js'), { auth: (req, res, next) => next() });
stub(src('middleware/ownership.js'), { ownedParam: () => (req, res, next) => next(), userStoreIds: async () => [] });
stub(src('services/productListCache.js'), { invalidate() {}, version: () => 1 });
stub(src('routes/credits.js'), {
  getSetting: async (k, d) => (k === 'credit_product_attribute_ai' ? state.cost : (k === 'anthropic_api_key' ? state.apiKey : d)),
  deductCredits: async (uid, amount) => { if (state.creditError) throw new Error(state.creditError); state.charges.push(amount); },
  refundCredits: async (uid, amount) => { state.refunds.push(amount); },
});
const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
  return row[k] === v;
});
stub(src('config/database.js'), {
  marketplaceConnection: { findUnique: async () => ({ id: 'c1', storeId: 's1', config: null }) },
  productCategoryOverride: {
    findMany: async ({ where }) => db.rows.filter((r) => match(r, where)).map((r) => ({ ...r })),
    update: async ({ where, data }) => { const r = db.rows.find((x) => x.id === where.id); Object.assign(r, data); return r; },
    updateMany: async ({ where, data }) => { const hit = db.rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
  },
  categoryMapping: { findMany: async () => db.mappings },
  product: { findMany: async ({ where }) => db.products.filter((p) => match(p, where)).map((p) => ({ ...p })) },
  xmlSource: { findFirst: async ({ where }) => db.sources.find((s) => s.id === where.id && s.storeId === where.storeId) || null },
  $transaction: async (ops) => Promise.all(ops),
});

// value lists of the required attributes per Trendyol category
const LISTS = {
  K1: [
    { id: '10', name: 'Renk', allowCustom: false, values: ['Kırmızı', 'Mavi', 'Siyah', 'Çok Renkli'].map((n, i) => ({ id: 100 + i, name: n })) },
    { id: '11', name: 'Cinsiyet', allowCustom: false, values: ['Kadın', 'Erkek', 'Unisex'].map((n, i) => ({ id: 200 + i, name: n })) },
  ],
  K2: [{ id: '12', name: 'Garanti Süresi', allowCustom: false, values: ['1 Yıl', '2 Yıl', '5 Yıl'].map((n, i) => ({ id: 300 + i, name: n })) }],
};
const AD = require(src('services/attributeDefaults.js'));
AD.loadRequiredDefs = async (connection, ids) => { const map = new Map(); for (const id of ids) if (LISTS[String(id)]) map.set(String(id), LISTS[String(id)]); return { map, pending: 0 }; };

const PA = require(src('services/productAttributes.js'));
const PC = require(src('services/productCategories.js'));
stub(src('services/readiness.js'), {
  getReadinessContext: async () => ({
    productMappings: PC.buildOverrideMappings(db.rows, db.mappings),
    requiredAttrs: new Map(Object.entries(LISTS).map(([k, v]) => [k, v.map((d) => ({ id: d.id, name: d.name }))])),
  }),
});
const router = require(src('routes/productCategories.js'));
const route = (p, method) => router.stack.find((l) => l.route && l.route.path === `/connections/:id/product-categories/${p}` && l.route.methods[method]).route.stack[0].handle;
async function call(handler, { body = {}, query = {}, role = 'superadmin' } = {}) {
  const res = { code: 200, body: null, headersSent: false, status(c) { this.code = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; } };
  let err = null;
  await handler({ params: { id: 'c1' }, body, query, user: { id: 'u1', role } }, res, (e) => { err = e; });
  if (err) throw err;
  return res;
}

const row = (productId, cat, attrs = null) => ({ id: 'o-' + productId, connectionId: 'c1', productId, marketplaceCategoryId: cat, marketplaceCategoryName: 'Yol > ' + cat, attributes: attrs ? JSON.stringify(attrs) : null, source: 'rule' });
const prod = (id, title, description = '', extra = {}) => ({ id, storeId: 's1', xmlSourceId: 'src1', title, description, ...extra });
const attrsOf = (id) => JSON.parse(db.rows.find((r) => r.productId === id).attributes || '{}');
const reset = () => { db.rows = []; db.products = []; db.mappings = []; state.charges = []; state.refunds = []; state.cost = '0.1'; state.apiKey = 'sk-test'; state.creditError = null; state.prompts = []; };
const typed = (id, name, valueId, valueName, extra = {}) => ({ [id]: { name, valueId, valueName, ...extra } });

// ── free step ──
test('free step: fills what is open from title and description, per product, marked with where it was read', async () => {
  reset();
  db.rows = [row('p1', 'K1'), row('p2', 'K1'), row('p3', 'K1')];
  db.products = [prod('p1', 'Kırmızı Bayan Çanta'), prod('p2', 'Cüzdan', '<p>Erkek kullanıcılar için, <b>siyah</b> deri cüzdan.</p>'), prod('p3', 'Anahtarlık')];
  const r = await PA.fillFromText({ id: 'c1', storeId: 's1' });
  assert.deepEqual(attrsOf('p1'), { 10: { name: 'Renk', valueId: '100', valueName: 'Kırmızı', from: 'title' }, 11: { name: 'Cinsiyet', valueId: '200', valueName: 'Kadın', from: 'title' } });
  assert.deepEqual(attrsOf('p2'), { 10: { name: 'Renk', valueId: '102', valueName: 'Siyah', from: 'description' }, 11: { name: 'Cinsiyet', valueId: '201', valueName: 'Erkek', from: 'description' } });
  assert.deepEqual(attrsOf('p3'), {}, 'nothing in the text: nothing invented');
  assert.equal(r.products, 3);
  assert.equal(r.filledProducts, 2);
  assert.equal(r.filledAttributes, 4);
  assert.deepEqual(r.byFrom, { title: 2, description: 2 });
  assert.deepEqual(r.stillMissing, [{ name: 'Renk', products: 1 }, { name: 'Cinsiyet', products: 1 }]);
});

test('a value read for one product is never taken over by another product of the category', async () => {
  reset();
  db.rows = [row('p1', 'K1'), row('p2', 'K1')];
  db.products = [prod('p1', 'Kırmızı Bayan Çanta'), prod('p2', 'Anahtarlık')];
  await PA.fillFromText({ id: 'c1', storeId: 's1' });
  const eff = PC.buildOverrideMappings(db.rows, []);
  assert.equal(JSON.parse(eff.get('p1').attributes)[10].valueName, 'Kırmızı');
  assert.equal(eff.get('p2').attributes, null, 'p2 does not get p1\'s colour');
});

test('values typed for the category are kept, shared and copied into the product\'s own entry', async () => {
  reset();
  db.rows = [row('p1', 'K2', typed(12, 'Garanti Süresi', '301', '2 Yıl')), row('p2', 'K1'), row('p3', 'K1', typed(11, 'Cinsiyet', '202', 'Unisex'))];
  db.products = [prod('p1', 'Kablo'), prod('p2', 'Kırmızı Kemer'), prod('p3', 'Mavi Kemer')];
  await PA.fillFromText({ id: 'c1', storeId: 's1' });
  assert.equal(attrsOf('p3')[11].valueName, 'Unisex', 'hand-typed Cinsiyet stays');
  assert.equal(attrsOf('p3')[10].valueName, 'Mavi');
  assert.equal(attrsOf('p3')[11].from, undefined, 'and is not marked as read from text');
  // p2 shared p3\'s typed Cinsiyet (K1) and gets its own colour on top
  assert.equal(attrsOf('p2')[10].valueName, 'Kırmızı');
  assert.equal(attrsOf('p2')[11].valueName, 'Unisex', 'the shared value was copied in, so it is not lost');
});

test('default answers are only replaced when asked for', async () => {
  reset();
  db.rows = [row('p1', 'K1', typed(10, 'Renk', '103', 'Çok Renkli', { auto: true }))];
  db.products = [prod('p1', 'Siyah Kemer')];
  await PA.fillFromText({ id: 'c1', storeId: 's1' });
  assert.equal(attrsOf('p1')[10].valueName, 'Çok Renkli', 'default answer stays');
  const r = await PA.fillFromText({ id: 'c1', storeId: 's1' }, { includeRuleValues: true });
  assert.equal(attrsOf('p1')[10].valueName, 'Siyah');
  assert.equal(attrsOf('p1')[10].auto, undefined, 'no longer a default answer: the rules refresh leaves it alone');
  assert.equal(r.filledAttributes, 1);
});

test('a default answer is replaced only by what the TITLE says, and only when it is a different value', async () => {
  reset();
  db.rows = [row('p1', 'K1', typed(10, 'Renk', '103', 'Çok Renkli', { auto: true })), row('p2', 'K1', typed(10, 'Renk', '103', 'Çok Renkli', { auto: true })), row('p3', 'K1', typed(10, 'Renk', '102', 'Siyah', { auto: true }))];
  db.products = [prod('p1', 'Kemer', 'Siyah deri kemer.'), prod('p2', 'Mavi Kemer'), prod('p3', 'Siyah Kemer')];
  const r = await PA.fillFromText({ id: 'c1', storeId: 's1' }, { includeRuleValues: true });
  assert.equal(attrsOf('p1')[10].valueName, 'Çok Renkli', 'only the description says Siyah: the safe default answer stays');
  assert.equal(attrsOf('p1')[10].auto, true);
  assert.equal(attrsOf('p2')[10].valueName, 'Mavi', 'the title says Mavi');
  assert.equal(attrsOf('p2')[10].from, 'title');
  assert.equal(attrsOf('p3')[10].auto, true, 'the title says what the default already is: nothing to change');
  assert.equal(r.filledAttributes, 1);
});

test('only the listed products, or only one XML source, are looked at', async () => {
  reset();
  db.rows = [row('p1', 'K1'), row('p2', 'K1'), row('p3', 'K1')];
  db.products = [prod('p1', 'Kırmızı Kemer'), prod('p2', 'Mavi Kemer'), prod('p3', 'Siyah Kemer', '', { xmlSourceId: null })];
  await PA.fillFromText({ id: 'c1', storeId: 's1' }, { productIds: ['p1'] });
  assert.equal(attrsOf('p1')[10].valueName, 'Kırmızı');
  assert.deepEqual(attrsOf('p2'), {});
  await PA.fillFromText({ id: 'c1', storeId: 's1' }, { xmlSourceId: 'none' });
  assert.equal(attrsOf('p3')[10].valueName, 'Siyah', 'xmlSourceId "none" = products added by hand');
  assert.deepEqual(attrsOf('p2'), {}, 'p2 belongs to src1');
});

test('changing the category drops what was read for the old one', () => {
  const defs = [{ id: '10', name: 'Renk', allowCustom: false, values: [{ id: 100, name: 'Kırmızı' }] }];
  const existing = JSON.stringify({ 99: { name: 'Eski özellik', valueId: '5', valueName: 'x', from: 'title' }, 98: { name: 'Elle yazılan', valueId: '6', valueName: 'y' } });
  const out = AD.computeAttributes(defs, existing, null, AD.compile({ rules: [], fallback: { enabled: false, value: '' } }));
  const kept = JSON.parse(out.json);
  assert.equal(kept[99], undefined, 'read from the text for the old category: gone');
  assert.ok(kept[98], 'typed by hand: stays, as before');
});

// ── routes ──
test('route: free step reads the body, refuses a foreign XML source', async () => {
  reset();
  db.rows = [row('p1', 'K1')]; db.products = [prod('p1', 'Kırmızı Kemer')];
  const h = route('attributes-from-text', 'post');
  assert.equal((await call(h, { body: { xmlSourceId: 'someone-elses' } })).code, 404);
  assert.equal((await call(h, { body: { productIds: 'x' } })).code, 400);
  const ok = await call(h, { body: { xmlSourceId: 'src1' } });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.filledAttributes, 1);
});

test('route: groups count the products that lack an attribute, and the form starts without product-specific values', async () => {
  reset();
  db.rows = [row('p1', 'K1', { ...typed(10, 'Renk', '100', 'Kırmızı', { from: 'title' }), ...typed(11, 'Cinsiyet', '200', 'Kadın') }), row('p2', 'K1'), row('p3', 'K1', typed(11, 'Cinsiyet', '200', 'Kadın'))];
  const res = await call(route('groups', 'get'));
  const g = res.body.find((x) => x.categoryId === 'K1');
  assert.equal(g.count, 3);
  assert.deepEqual(g.missing.map((m) => [m.name, m.products]), [['Renk', 2]], 'p1 has a colour of its own; p2 and p3 lack it. p2 shares the typed Cinsiyet of its sisters, so it does not lack that');
  assert.equal(g.lackingProducts, 2);
  assert.deepEqual(Object.keys(g.attributes), ['11'], 'the form starts with the shareable values only (no colour read for p1)');
});

test('route: typing values for the category leaves a product\'s own text-read value alone', async () => {
  reset();
  db.rows = [row('p1', 'K1', typed(10, 'Renk', '100', 'Kırmızı', { from: 'title' })), row('p2', 'K1'), row('p3', 'K1', typed(10, 'Renk', '101', 'Mavi', { auto: true }))];
  const typedValues = { 10: { name: 'Renk', valueId: '103', valueName: 'Çok Renkli' }, 11: { name: 'Cinsiyet', valueId: '202', valueName: 'Unisex' } };
  const res = await call(route('attributes', 'put'), { body: { categoryId: 'K1', attributes: typedValues } });
  assert.equal(res.body.updated, 3);
  assert.equal(attrsOf('p1')[10].valueName, 'Kırmızı', 'own value stays');
  assert.equal(attrsOf('p1')[11].valueName, 'Unisex', 'the rest is typed in');
  assert.equal(attrsOf('p2')[10].valueName, 'Çok Renkli');
  assert.equal(attrsOf('p3')[10].valueName, 'Çok Renkli', 'a default answer is replaced, as before');
});

test('route: the gaps list gives ids, the attribute names and the AI price', async () => {
  reset();
  db.rows = [row('p1', 'K1'), row('p2', 'K1'), row('p3', 'K2', typed(12, 'Garanti Süresi', '301', '2 Yıl'))];
  const res = await call(route('attribute-gaps', 'get'), { query: {} });
  assert.deepEqual(res.body.ids.sort(), ['p1', 'p2'], 'p3 has everything it needs');
  assert.equal(res.body.products, 2);
  assert.deepEqual(res.body.attributes, [{ name: 'Renk', products: 2 }, { name: 'Cinsiyet', products: 2 }]);
  assert.equal(res.body.aiCostPerProduct, 0.1);
  assert.equal((await call(route('attribute-gaps', 'get'), { query: { xmlSourceId: 'someone-elses' } })).code, 404);
});

// ── AI step ──
// answers by the position of the product in the prompt ("#1", "#2" ...): { '1': { '10': 'Kırmızı' } }
const answer = (picks) => { state.create = async (req) => { state.prompts.push(req.messages[0].content); return { content: [{ text: JSON.stringify({ picks }) }] }; }; };

test('AI step: asks only about open attributes with allowed values, saves valid answers as "ai", charges only products that got one', async () => {
  reset();
  db.rows = [row('p1', 'K1'), row('p2', 'K1'), row('p3', 'K2', typed(12, 'Garanti Süresi', '301', '2 Yıl'))];
  db.products = [prod('p1', 'Kemer', 'Hasır örgülü kemer, kadınlar için.'), prod('p2', 'Bilinmeyen ürün', 'Açıklama yok'), prod('p3', 'Bir şey')];
  answer({ 1: { 10: 'Siyah', 11: 'Kadın' }, 2: { 10: null, 11: 'Marsli' } });   // p2: nothing valid ("Marsli" is not in the list)
  const res = await call(route('attributes-ai', 'post'), { body: { productIds: ['p1', 'p2', 'p3'] } });
  assert.equal(res.code, 200);
  assert.equal(res.body.asked, 2, 'p3 has nothing open: not asked, not charged');
  assert.equal(res.body.filledProducts, 1);
  assert.equal(res.body.filledAttributes, 2);
  assert.equal(res.body.unfilled, 1);
  assert.deepEqual(state.charges, [0.2], 'both asked products are paid for up front');
  assert.deepEqual(state.refunds, [0.1], 'the one without a result is given back');
  assert.equal(res.body.charged, 0.1);
  assert.deepEqual(attrsOf('p1'), { 10: { name: 'Renk', valueId: '102', valueName: 'Siyah', from: 'ai' }, 11: { name: 'Cinsiyet', valueId: '200', valueName: 'Kadın', from: 'ai' } });
  assert.deepEqual(attrsOf('p2'), {});
  assert.match(state.prompts[0], /Renk: Kırmızı \| Mavi \| Siyah \| Çok Renkli/, 'the allowed values are in the prompt');
  assert.match(state.prompts[0], /null/, 'and the AI is told it may answer null');
  assert.doesNotMatch(state.prompts[0], /Bir şey/, 'p3 is not in the prompt');
});

test('AI step: an answer that is not one of the allowed values is ignored, however it is spelled', async () => {
  reset();
  db.rows = [row('p1', 'K1')]; db.products = [prod('p1', 'Kemer')];
  answer({ 1: { 10: 'siyah ', 11: 'Hanım' } });   // different case/spaces = the same value; "Hanım" is not in the list
  const res = await call(route('attributes-ai', 'post'), { body: { productIds: ['p1'] } });
  assert.equal(res.body.filledAttributes, 1);
  assert.equal(attrsOf('p1')[10].valueName, 'Siyah');
  assert.equal(attrsOf('p1')[11], undefined);
});

test('AI step: a vendor problem refunds everything and says so; nothing is saved', async () => {
  reset();
  db.rows = [row('p1', 'K1'), row('p2', 'K1')]; db.products = [prod('p1', 'Kemer'), prod('p2', 'Çanta')];
  state.create = async () => { throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }); };
  const res = await call(route('attributes-ai', 'post'), { body: { productIds: ['p1', 'p2'] } });
  assert.equal(res.code, 502);
  assert.equal(res.body.refunded, true);
  assert.deepEqual(state.charges, [0.2]);
  assert.deepEqual(state.refunds, [0.2]);
  assert.deepEqual(attrsOf('p1'), {});
});

test('AI step: not enough credits stops before anything is asked; no key, no products, too many products are refused', async () => {
  reset();
  db.rows = [row('p1', 'K1')]; db.products = [prod('p1', 'Kemer')];
  let asked = 0; state.create = async () => { asked++; return { content: [{ text: '{"picks":{}}' }] }; };
  state.creditError = 'Yetersiz kredi';
  assert.equal((await call(route('attributes-ai', 'post'), { body: { productIds: ['p1'] } })).code, 402);
  assert.equal(asked, 0);
  state.creditError = null; state.apiKey = '';
  assert.equal((await call(route('attributes-ai', 'post'), { body: { productIds: ['p1'] } })).code, 500);
  state.apiKey = 'sk-test';
  assert.equal((await call(route('attributes-ai', 'post'), { body: { productIds: [] } })).code, 400);
  assert.equal((await call(route('attributes-ai', 'post'), { body: { productIds: Array.from({ length: 41 }, (_, i) => 'x' + i) } })).code, 400);
});

test('AI step: attributes about the seller and lists that cannot be shown are not asked; a product with nothing to ask is free', async () => {
  reset();
  LISTS.K3 = [{ id: '20', name: 'Menşei', allowCustom: false, values: [{ id: 1, name: 'TR' }, { id: 2, name: 'Çin' }] }, { id: '21', name: 'Yazar', allowCustom: false, values: Array.from({ length: 300 }, (_, i) => ({ id: 1000 + i, name: `Yazar Adı${i} Soyadı${i}` })) }];
  db.rows = [row('p1', 'K3')]; db.products = [prod('p1', 'Roman', 'Kapakta yazan kimse yok')];
  let asked = 0; state.create = async () => { asked++; return { content: [{ text: '{"picks":{}}' }] }; };
  const res = await call(route('attributes-ai', 'post'), { body: { productIds: ['p1'] } });
  assert.equal(res.body.asked, 0);
  assert.equal(asked, 0);
  assert.deepEqual(state.charges, []);
  delete LISTS.K3;
});
