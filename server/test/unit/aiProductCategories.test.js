const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The route runs with stand-ins for the AI vendor, credits, auth, database and readiness: no network, no database.
const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const state = { create: null, charges: [], refunds: [], saved: [], cost: '0.05', products: [] };
class FakeAnthropic { constructor() { this.messages = { create: (...a) => state.create(...a) }; } }
stub('@anthropic-ai/sdk', FakeAnthropic);
stub(src('middleware/auth.js'), { auth: (req, res, next) => next() });
stub(src('middleware/ownership.js'), { ownedParam: () => (req, res, next) => next(), userStoreIds: async () => [] });
stub(src('services/readiness.js'), { getReadinessContext: async () => ({}) });
stub(src('services/productListCache.js'), { invalidate() {}, version: () => 1 });
stub(src('routes/credits.js'), {
  getSetting: async (k, d) => (k === 'credit_product_category_ai' ? state.cost : (k === 'anthropic_api_key' ? 'sk-test' : d)),
  deductCredits: async (uid, amount) => { state.charges.push(amount); },
  refundCredits: async (uid, amount) => { state.refunds.push(amount); },
});
const tx = [];
stub(src('config/database.js'), {
  marketplaceConnection: { findUnique: async () => ({ id: 'c1', storeId: 's1' }) },
  product: { findMany: async () => state.products },
  productCategoryOverride: { upsert: (a) => { tx.push(a); return a; } },
  $transaction: async (ops) => { state.saved.push(...ops); return ops; },
});
const router = require(src('routes/productCategories.js'));
const handler = router.stack.find((l) => l.route && l.route.path === '/connections/:id/product-categories/ai-match' && l.route.methods.post).route.stack[0].handle;

async function call(body, role = 'superadmin') {
  const res = { code: 200, body: null, headersSent: false, status(c) { this.code = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; } };
  let err = null;
  await handler({ params: { id: 'c1' }, body, user: { id: 'u1', role } }, res, (e) => { err = e; });
  return { res, err };
}
const reset = (products) => { state.charges = []; state.refunds = []; state.saved = []; tx.length = 0; state.cost = '0.05'; state.products = products; };
const prods = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, title: 'Çelik Pense ' + i, category: 'Hırdavat' }));

test('billing problem: stops, explains, refunds everything, saves nothing', async () => {
  reset(prods(40));
  let calls = 0;
  state.create = async () => { calls++; throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }); };
  const { res } = await call({ productIds: state.products.map((p) => p.id) });
  assert.equal(res.code, 502);
  assert.match(res.body.error, /Plans & Billing/);
  assert.ok(calls <= 3);
  assert.deepEqual(state.charges, [2]);
  assert.deepEqual(state.refunds, [2]);
  assert.equal(state.saved.length, 0);
});

test('a normal user never sees vendor details', async () => {
  reset(prods(2));
  state.create = async () => { throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }); };
  const { res } = await call({ productIds: ['p0', 'p1'] }, 'user');
  assert.equal(res.code, 502);
  assert.doesNotMatch(res.body.error, /anthropic|Billing/i);
});

test('success: only products with a result are charged, the rest is refunded, results are saved as "ai"', async () => {
  reset(prods(4));
  // The matcher picks the real tree; answer with the first candidate id for products 1 and 2, "none" for the others
  state.create = async (req) => {
    const text = req.messages[0].content;
    const ids = [...text.matchAll(/#(\d+)\n[\s\S]*?Adaylar \(id\|yol\):\n(\d+)\|/g)].map((m) => [m[1], Number(m[2])]);
    const picks = {};
    for (const [key, id] of ids) picks[key] = Number(key) <= 2 ? id : 0;
    return { content: [{ text: JSON.stringify({ picks }) }] };
  };
  const { res } = await call({ productIds: ['p0', 'p1', 'p2', 'p3'] });
  assert.equal(res.code, 200);
  assert.equal(res.body.matched, 2);
  assert.equal(res.body.unmatched, 2);
  assert.deepEqual(state.charges, [0.2]);
  assert.deepEqual(state.refunds, [0.1]);
  assert.equal(state.saved.length, 2);
  assert.equal(tx[0].create.source, 'ai');
  assert.equal(tx[0].create.connectionId, 'c1');
});

test('limits and validation', async () => {
  reset(prods(1));
  assert.equal((await call({})).res.code, 400);
  assert.equal((await call({ productIds: Array.from({ length: 101 }, (_, i) => 'x' + i) })).res.code, 400);
  assert.deepEqual(state.charges, []);
});

test('free price setting: nothing is charged or refunded', async () => {
  reset(prods(2));
  state.cost = '0';
  state.create = async () => ({ content: [{ text: '{"picks":{}}' }] });
  const { res } = await call({ productIds: ['p0', 'p1'] });
  assert.equal(res.code, 200);
  assert.deepEqual(state.charges, []);
  assert.deepEqual(state.refunds, []);
});
