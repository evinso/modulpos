const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const log = { overrideDeletes: [], mappingDeletes: [], sources: [] };
stub(src('config/database.js'), {
  marketplaceConnection: { findUnique: async () => ({ id: 'c1', storeId: 's1' }) },
  xmlSource: { findFirst: async ({ where }) => (where.id === 'mine' && where.storeId === 's1' ? { id: 'mine' } : null) },
  productCategoryOverride: { deleteMany: async (a) => { log.overrideDeletes.push(a.where); return { count: 7 }; } },
  categoryMapping: { deleteMany: async (a) => { log.mappingDeletes.push(a.where); return { count: 3 }; } },
});
stub(src('middleware/auth.js'), { auth: (req, res, next) => next() });
stub(src('middleware/ownership.js'), { ownedParam: () => (req, res, next) => next(), userStoreIds: async () => [] });
stub(src('services/readiness.js'), { getReadinessContext: async () => ({}) });
let invalidated = 0;
stub(src('services/productListCache.js'), { invalidate() { invalidated++; }, version: () => 1 });
stub(src('routes/credits.js'), { getSetting: async (k, d) => d, deductCredits: async () => {}, refundCredits: async () => {} });
const router = require(src('routes/productCategories.js'));
const handler = router.stack.find((l) => l.route && l.route.path === '/connections/:id/product-categories/reset' && l.route.methods.post).route.stack[0].handle;

async function call(body) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let err = null;
  await handler({ params: { id: 'c1' }, body }, res, (e) => { err = e; });
  if (err) throw err;
  return res;
}
const reset = () => { log.overrideDeletes = []; log.mappingDeletes = []; invalidated = 0; };

test('resets the per-product categories of ONE source of this connection, mappings stay', async () => {
  reset();
  const r = await call({ xmlSourceId: 'mine' });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { removedProducts: 7, removedMappings: 0 });
  assert.deepEqual(log.overrideDeletes, [{ connectionId: 'c1', product: { storeId: 's1', xmlSourceId: 'mine' } }]);
  assert.equal(log.mappingDeletes.length, 0);
  assert.equal(invalidated, 1, 'the product list is refreshed');
});

test('mappings of that source are deleted only when asked', async () => {
  reset();
  const r = await call({ xmlSourceId: 'mine', includeMappings: true });
  assert.deepEqual(r.body, { removedProducts: 7, removedMappings: 3 });
  assert.deepEqual(log.mappingDeletes, [{ connectionId: 'c1', xmlSourceId: 'mine' }]);
  reset();
  await call({ xmlSourceId: 'mine', includeMappings: 'true' });
  assert.equal(log.mappingDeletes.length, 0, 'only a real true counts');
});

test('hand-added products (no XML source) never lose mappings', async () => {
  reset();
  const r = await call({ xmlSourceId: 'none', includeMappings: true });
  assert.equal(r.code, 200);
  assert.deepEqual(log.overrideDeletes, [{ connectionId: 'c1', product: { storeId: 's1', xmlSourceId: null } }]);
  assert.equal(log.mappingDeletes.length, 0);
});

test('a source of another store, or none at all, deletes nothing', async () => {
  reset();
  assert.equal((await call({ xmlSourceId: 'someone-elses' })).code, 404);
  assert.equal((await call({})).code, 400);
  assert.equal((await call({ xmlSourceId: 42 })).code, 400);
  assert.equal(log.overrideDeletes.length, 0);
  assert.equal(log.mappingDeletes.length, 0);
});
