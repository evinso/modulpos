const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/services/pricingEngine');
// manualPriceAlerts pulls in the database client; the decision itself is pure, so load it without connecting
const { detectNewLosses } = require('../../src/services/manualPriceAlerts');

const rule = {
  id: 'r1', name: 'Genel', isActive: true, priority: 0, createdAt: new Date(0), type: 'percentage', value: 30, applyTo: 'price_template',
  conditions: JSON.stringify({ shippingCost: 10, commissionPct: 10, commissionBasis: 'gross', vatRate: null, roundingMode: 'none' }),
};
const ctx = new E.PricingContext([rule], 'C');
const bare = new E.PricingContext([], 'C');

// state AFTER the sync (purchase 140) and what the sync saw BEFORE (100)
const product = (o = {}) => ({ id: 'p1', title: 'Kolye', sku: 'K1', xmlPrice: 140, price: 140, vatRate: 20, xmlSourceId: 's', category: 'Kolye', brand: null, ...o });
const run = (c, price, after, move) => detectNewLosses(c, [{ productId: after.id, price }], new Map([[after.id, after]]), new Map([[after.id, move]]));

test('sellsAtLoss: with a template it is the real profit, without one only price (ex VAT) below purchase', () => {
  const pv = ctx.previewAt(product({ xmlPrice: 100, price: 100 }), 200);
  assert.ok(pv.breakdown.profit > 0); assert.equal(E.sellsAtLoss(pv), false);
  assert.equal(E.sellsAtLoss(ctx.previewAt(product({ xmlPrice: 150, price: 150 }), 200)), true);
  assert.equal(E.sellsAtLoss(bare.previewAt(product({ xmlPrice: 100, price: 100 }), 119)), true);   // 119/1.2 = 99.2 < 100
  assert.equal(E.sellsAtLoss(bare.previewAt(product({ xmlPrice: 100, price: 100 }), 121)), false);
  assert.equal(E.sellsAtLoss(null), false);
});

test('explainFor on a hand-priced product exposes the purchase price it was judged on', () => {
  const c = new E.PricingContext([rule], 'C', new Map([['p1', 200]]));
  const ex = c.explainFor(product({ xmlPrice: 100, price: 100 }));
  assert.equal(ex.manual, true); assert.equal(ex.purchase, 100); assert.equal(E.sellsAtLoss(ex), false);
  assert.equal(E.sellsAtLoss(c.explainFor(product({ xmlPrice: 150, price: 150 }))), true);
});

test('a price that earned money and now loses after the purchase price rose is reported', () => {
  const r = run(ctx, 200, product(), { oldXmlPrice: 100, oldPrice: 100 });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'p1'); assert.equal(r[0].purchaseOld, 100); assert.equal(r[0].purchaseNew, 140); assert.equal(r[0].price, 200);
  assert.ok(r[0].profit < 0);
});

test('a rise that still leaves a profit is not reported', () => {
  assert.deepEqual(run(ctx, 200, product({ xmlPrice: 110, price: 110 }), { oldXmlPrice: 100, oldPrice: 100 }), []);
});

test('a product that was already losing before this sync is not reported again', () => {
  assert.deepEqual(run(ctx, 200, product({ xmlPrice: 180, price: 180 }), { oldXmlPrice: 150, oldPrice: 150 }), []);
});

test('without a template the simple check applies (price ex VAT below purchase)', () => {
  const r = run(bare, 120, product({ xmlPrice: 110, price: 110 }), { oldXmlPrice: 100, oldPrice: 100 });
  assert.equal(r.length, 1); assert.equal(r[0].profit, null);
  assert.deepEqual(run(bare, 120, product({ xmlPrice: 99, price: 99 }), { oldXmlPrice: 90, oldPrice: 90 }), []);
});

test('only products that really changed in this sync are looked at; unknown ids are ignored', () => {
  const p = product();
  assert.deepEqual(detectNewLosses(ctx, [{ productId: 'other', price: 200 }], new Map([[p.id, p]]), new Map([[p.id, { oldXmlPrice: 100, oldPrice: 100 }]])), []);
  assert.deepEqual(detectNewLosses(ctx, [{ productId: p.id, price: 200 }], new Map([[p.id, p]]), new Map()), []);
});

test('several products: only the ones that crossed into loss, in the order given', () => {
  const a = product({ id: 'a', xmlPrice: 140, price: 140 });   // crosses
  const b = product({ id: 'b', xmlPrice: 105, price: 105 });   // still fine
  const c = product({ id: 'c', xmlPrice: 150, price: 150 });   // crosses
  const moves = new Map([['a', { oldXmlPrice: 100, oldPrice: 100 }], ['b', { oldXmlPrice: 100, oldPrice: 100 }], ['c', { oldXmlPrice: 100, oldPrice: 100 }]]);
  const r = detectNewLosses(ctx, ['a', 'b', 'c'].map((id) => ({ productId: id, price: 200 })), new Map([a, b, c].map((x) => [x.id, x])), moves);
  assert.deepEqual(r.map((x) => x.id), ['a', 'c']);
});
