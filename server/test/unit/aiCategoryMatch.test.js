const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The route is loaded with stand-ins for the AI vendor, credits, auth, database and Trendyol, so no network is used.
const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const state = { create: null, charges: [], refunds: [], cost: '0.5' };
class FakeAnthropic { constructor() { this.messages = { create: (...a) => state.create(...a) }; } }
stub('@anthropic-ai/sdk', FakeAnthropic);
stub(src('middleware/auth.js'), { auth: (req, res, next) => next() });
stub(src('config/database.js'), {});
stub(src('services/trendyol/trendyolService.js'), class { });
const credits = {
  getSetting: async (k, d) => (k === 'credit_category_ai' ? state.cost : (k === 'anthropic_api_key' ? 'sk-test' : d)),
  deductCredits: async (uid, amount) => { state.charges.push(amount); },
  refundCredits: async (uid, amount) => { state.refunds.push(amount); },
};
stub(src('routes/credits.js'), credits);
const router = require(src('routes/ai.js'));
const handler = router.stack.find((l) => l.route && l.route.path === '/category-match').route.stack[0].handle;

async function call(body, role = 'superadmin') {
  const res = { code: 200, body: null, headersSent: false, status(c) { this.code = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; } };
  let nextErr = null;
  await handler({ body, user: { id: 'u1', role } }, res, (e) => { nextErr = e; });
  return { res, nextErr };
}
const reset = () => { state.charges = []; state.refunds = []; state.cost = '0.5'; };
const cats = Array.from({ length: 78 }, (_, i) => `Kategori ${i}`);

test('empty Anthropic account: stops at the first call, says why, gives every credit back', async () => {
  reset();
  let calls = 0;
  state.create = async () => { calls++; throw Object.assign(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing"}}'), { status: 400 }); };
  const { res } = await call({ xmlCategories: cats });
  assert.equal(res.code, 502);
  assert.match(res.body.error, /Plans & Billing/);
  assert.equal(calls, 1, 'no further calls after a fatal error');
  assert.deepEqual(state.charges, [39]);
  assert.deepEqual(state.refunds, [39]);
});

test('a normal user sees no vendor details', async () => {
  reset();
  state.create = async () => { throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }); };
  const { res } = await call({ xmlCategories: cats.slice(0, 4) }, 'user');
  assert.equal(res.code, 502);
  assert.doesNotMatch(res.body.error, /anthropic|Billing/i);
  assert.deepEqual(state.refunds, [2]);
});

test('every call fails with a temporary error: reported (not "no match") and refunded', async () => {
  reset();
  state.create = async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); };
  const { res } = await call({ xmlCategories: cats.slice(0, 5) });
  assert.equal(res.code, 502);
  assert.match(res.body.error, /yoğun/);
  assert.deepEqual(state.refunds, [2.5]);
});

test('success: charged for the categories, nothing refunded', async () => {
  reset();
  // Step 1 -> top-level 0 is not in the tree, so the keyword fallback path is used; Step 2 returns a real leaf id.
  const data = require('../../src/data/trendyolCategories');
  const root = data.categories || data;
  const walk = (c) => (c.subCategories && c.subCategories.length ? walk(c.subCategories[0]) : c);
  const leaf = walk(Array.isArray(root) ? root[0] : root);
  state.create = async (req) => {
    const text = req.messages[0].content;
    if (/ANA kategorilerinden/.test(text)) return { stop_reason: 'end_turn', content: [{ text: JSON.stringify({ mappings: { 'Kategori 1': Number((Array.isArray(root) ? root[0] : root).id) } }) }] };
    return { stop_reason: 'end_turn', content: [{ text: JSON.stringify({ matches: { 'Kategori 1': { id: leaf.id, path: leaf.name } } }) }] };
  };
  const { res } = await call({ xmlCategories: ['Kategori 1'] });
  assert.equal(res.code, 200);
  assert.equal(res.body.matches['Kategori 1'].id, leaf.id);
  assert.deepEqual(state.charges, [0.5]);
  assert.deepEqual(state.refunds, []);
});

test('partial result: only the categories without a result are refunded', async () => {
  reset();
  const data = require('../../src/data/trendyolCategories');
  const root = data.categories || data;
  const top = Array.isArray(root) ? root[0] : root;
  const walk = (c) => (c.subCategories && c.subCategories.length ? walk(c.subCategories[0]) : c);
  const leaf = walk(top);
  state.create = async (req) => {
    const text = req.messages[0].content;
    if (/ANA kategorilerinden/.test(text)) return { stop_reason: 'end_turn', content: [{ text: JSON.stringify({ mappings: { A: Number(top.id) } }) }] }; // B is left out by the AI
    return { stop_reason: 'end_turn', content: [{ text: JSON.stringify({ matches: { A: { id: leaf.id, path: leaf.name } } }) }] };
  };
  const { res } = await call({ xmlCategories: ['A', 'B'] });
  assert.equal(res.code, 200);
  assert.ok(res.body.matches.A);
  assert.deepEqual(state.charges, [1]);
  assert.ok(state.refunds.length <= 1);
  const matched = Object.values(res.body.matches).filter(Boolean).length;
  assert.equal(state.refunds.reduce((a, b) => a + b, 0), (2 - matched) * 0.5);
});
