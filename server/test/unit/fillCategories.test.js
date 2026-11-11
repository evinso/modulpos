const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// fillCategories and the attribute-defaults routes run on stand-ins for the database, Trendyol, auth and credits: no network.
const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const ATTRS = {
  1001: { categoryAttributes: [
    { required: true, allowCustom: false, attribute: { id: 1192, name: 'Menşei' }, attributeValues: [{ id: 1, name: 'CN' }, { id: 2, name: 'TR' }] },
    { required: true, allowCustom: true, attribute: { id: 47, name: 'Renk' }, attributeValues: [] },
    { required: true, allowCustom: false, attribute: { id: 9, name: 'Cinsiyet' }, attributeValues: [{ id: 5, name: 'Unisex' }] },
    { required: false, allowCustom: false, attribute: { id: 99, name: 'Opsiyonel' }, attributeValues: [] },
  ] },
  1002: { categoryAttributes: [{ required: true, allowCustom: false, attribute: { id: 14, name: 'Materyal' }, attributeValues: [{ id: 7, name: 'Belirtilmemiş' }] }] },
};
let apiCalls = 0;
class FakeTrendyol { constructor() {} async getCategoryAttributes(id) { apiCalls++; if (!ATTRS[id]) throw new Error('boom'); return ATTRS[id]; } }
stub(src('services/trendyol/trendyolService.js'), FakeTrendyol);

const db = { overrides: [], mappings: [], updates: [], savedConfig: null };
stub(src('config/database.js'), {
  categoryMapping: { findMany: async () => db.mappings },
  productCategoryOverride: {
    findMany: async ({ where }) => db.overrides.filter((o) => o.marketplaceCategoryId === where.marketplaceCategoryId).map((o) => ({ id: o.id, attributes: o.attributes })),
    updateMany: async ({ where, data }) => { db.updates.push({ ids: where.id.in, data }); for (const o of db.overrides) if (where.id.in.includes(o.id)) o.attributes = data.attributes; return { count: where.id.in.length }; },
    groupBy: async () => [...new Set(db.overrides.map((o) => o.marketplaceCategoryId))].map((c) => ({ marketplaceCategoryId: c })),
  },
  marketplaceConnection: {
    findUnique: async () => db.conn,
    update: async ({ data }) => { db.savedConfig = data.config; db.conn = { ...db.conn, config: data.config }; return db.conn; },
  },
});
stub(src('middleware/auth.js'), { auth: (req, res, next) => next() });
stub(src('middleware/ownership.js'), { ownedParam: () => (req, res, next) => next(), userStoreIds: async () => [] });
stub(src('services/readiness.js'), { getReadinessContext: async () => ({ productMappings: new Map(), requiredAttrs: new Map() }) });
stub(src('services/productListCache.js'), { invalidate() {}, version: () => 1 });
stub(src('routes/credits.js'), { getSetting: async (k, d) => d, deductCredits: async () => {}, refundCredits: async () => {} });

const AD = require('../../src/services/attributeDefaults');
const router = require(src('routes/productCategories.js'));
const handlerOf = (method, p) => router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]).route.stack[0].handle;

const CFG = JSON.stringify({ attributeDefaults: { rules: [{ name: 'Menşei', value: 'TR' }, { name: 'Renk', value: 'Çok Renkli' }], fallback: { enabled: true, value: 'Belirtilmemiş' } } });
const reset = (overrides, config = CFG) => { apiCalls = 0; db.overrides = overrides; db.mappings = []; db.updates = []; db.savedConfig = null; db.conn = { id: 'c1', storeId: 's1', marketplaceType: 'trendyol', config }; };
const ov = (id, cat, attributes = null) => ({ id, marketplaceCategoryId: cat, attributes });

test('fills the required attributes of every product of a category, one update per distinct state', async () => {
  reset([ov('a', '1001'), ov('b', '1001'), ov('c', '1002')]);
  const r = await AD.fillCategories({ ...db.conn, id: 'cx1' }, ['1001', '1002']);
  assert.equal(r.categories, 2); assert.equal(r.products, 3);
  assert.equal(db.updates.length, 2, 'products a and b share one update');
  const a = JSON.parse(db.overrides[0].attributes);
  assert.equal(a['1192'].valueName, 'TR'); assert.equal(a['47'].valueName, 'Çok Renkli'); assert.equal(a['9'], undefined);
  assert.equal(JSON.parse(db.overrides[2].attributes)['14'].valueName, 'Belirtilmemiş');
  assert.deepEqual(r.unresolved, [{ name: 'Cinsiyet', categories: 1 }]);
});

test('running it again changes nothing (no writes), and hand-typed values survive', async () => {
  reset([ov('a', '1001', JSON.stringify({ 1192: { name: 'Menşei', valueId: '1', valueName: 'CN' } }))]);
  await AD.fillCategories({ ...db.conn, id: 'cx2' }, ['1001']);
  assert.equal(JSON.parse(db.overrides[0].attributes)['1192'].valueName, 'CN');
  db.updates = [];
  const r = await AD.fillCategories({ ...db.conn, id: 'cx2' }, ['1001']);
  assert.equal(db.updates.length, 0);
  assert.equal(r.products, 0);
});

test('an unreachable category is reported as pending, never as an error', async () => {
  reset([ov('a', '9999')]);
  const r = await AD.fillCategories({ ...db.conn, id: 'cx3' }, ['9999']);
  assert.equal(r.categories, 0);
  assert.ok(r.pending >= 1);
  assert.equal(db.updates.length, 0);
});

test('PUT attribute-defaults validates, saves on the connection and applies to every chosen category', async () => {
  reset([ov('a', '1001'), ov('c', '1002')], JSON.stringify({ sendSettings: { minStock: 3 } }));
  const put = handlerOf('put', '/connections/:id/product-categories/attribute-defaults');
  const call = async (body) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; let err = null; await put({ params: { id: 'c1' }, body }, res, (e) => { err = e; }); if (err) throw err; return res; };

  assert.equal((await call({})).code, 400);
  assert.equal((await call({ rules: [{ name: 'Menşei', value: '' }] })).code, 400, 'half a rule');
  assert.equal((await call({ rules: [], fallback: { enabled: true, value: '' } })).code, 400, 'fallback without a value');
  assert.equal((await call({ rules: Array.from({ length: 41 }, (_, i) => ({ name: 'a' + i, value: 'v' })) })).code, 400);
  assert.equal(db.savedConfig, null, 'nothing saved by refused requests');

  const ok = await call({ rules: [{ name: 'Menşei', value: 'TR' }, { name: '', value: '' }], fallback: { enabled: true, value: 'Belirtilmemiş' } });
  assert.equal(ok.code, 200);
  const saved = JSON.parse(db.savedConfig);
  assert.deepEqual(saved.sendSettings, { minStock: 3 }, 'other connection settings are untouched');
  assert.deepEqual(saved.attributeDefaults.rules, [{ name: 'Menşei', value: 'TR' }], 'empty rows are dropped');
  assert.equal(ok.body.categories, 2);
  assert.ok(JSON.parse(db.overrides[0].attributes)['1192']);
});

test('GET attribute-defaults: the suggestion before anything is saved, the saved rules afterwards', async () => {
  const get = handlerOf('get', '/connections/:id/product-categories/attribute-defaults');
  const call = async () => { const res = { body: null, json(b) { this.body = b; return this; } }; await get({ params: { id: 'c1' } }, res, (e) => { throw e; }); return res.body; };
  reset([], null);
  const before = await call();
  assert.equal(before.saved, false);
  assert.deepEqual(before.rules.map((r) => r.value), ['TR', 'Çok Renkli']);
  assert.equal(before.fallback.value, 'Belirtilmemiş');
  reset([], CFG);
  const after = await call();
  assert.equal(after.saved, true);
});
