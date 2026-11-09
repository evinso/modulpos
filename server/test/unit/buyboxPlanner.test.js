const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/services/pricingEngine');
const { planBuyboxAdjust, pickCheckWindow } = require('../../src/services/buyboxPlanner');

const rule = {
  id: 'r1', name: 'Genel', isActive: true, priority: 0, createdAt: new Date(0), type: 'percentage', value: 30, applyTo: 'price_template',
  conditions: JSON.stringify({ shippingCost: 10, commissionPct: 10, commissionBasis: 'gross', vatRate: null, roundingMode: 'none' }),
};
const ctx = new E.PricingContext([rule], 'C');
const prod = (id, o = {}) => ({ id, title: id, sku: id, xmlPrice: 100, price: 100, vatRate: 20, xmlSourceId: 's', category: 'K', brand: null, ...o });
const P = new Map([['a', prod('a')], ['b', prod('b')], ['c', prod('c')]]);
const plan = (records, extra = {}) => planBuyboxAdjust({
  records, products: P, currentPrices: new Map([['a', 200], ['b', 200], ['c', 200]]), priceCtx: ctx, mode: 'equal', amount: 0, ...extra,
});
const rec = (barcode, productId, buyboxPrice) => ({ barcode, productId, buyboxPrice });

test('equal: lowers to the BuyBox price', () => {
  const { items, skipped } = plan([rec('1', 'a', 180)]);
  assert.deepEqual(items, [{ barcode: '1', productId: 'a', oldPrice: 200, newPrice: 180 }]);
  assert.deepEqual(skipped, { noProduct: 0, notLower: 0, loss: 0 });
});

test('undercut: goes below by the amount, never under 0.01', () => {
  assert.equal(plan([rec('1', 'a', 180)], { mode: 'undercut', amount: 1.5 }).items[0].newPrice, 178.5);
  assert.equal(plan([rec('1', 'a', 150)], { mode: 'undercut', amount: -5 }).items[0].newPrice, 150);   // a negative amount cannot raise the price
});

test('a BuyBox price that is not below ours is never applied (price is not why we lose)', () => {
  const { items, skipped } = plan([rec('1', 'a', 250), rec('2', 'b', 200)]);
  assert.equal(items.length, 0); assert.equal(skipped.notLower, 2);
});

test('a price that would lose money is refused, a profitable one still goes through', () => {
  const { items, skipped } = plan([rec('1', 'a', 100), rec('2', 'b', 180)]);   // 100 TL sale for a 100 TL purchase: loss
  assert.deepEqual(items.map(i => i.barcode), ['2']); assert.equal(skipped.loss, 1);
});

test('records without product or BuyBox price are skipped; duplicate barcodes appear once', () => {
  const { items, skipped } = plan([rec('1', null, 150), rec('2', 'zzz', 150), rec('3', 'a', null), rec('4', 'a', 150), rec('4', 'a', 150)]);
  assert.deepEqual(items.map(i => i.barcode), ['4']); assert.equal(skipped.noProduct, 3);
});

test('without a stored marketplace price the price engine price is the reference', () => {
  const none = (rs) => planBuyboxAdjust({ records: rs, products: P, currentPrices: new Map(), priceCtx: ctx, mode: 'equal', amount: 0 });
  const tpl = ctx.priceFor(P.get('a')).price;
  assert.equal(none([rec('1', 'a', tpl + 20)]).items.length, 0);
  assert.equal(none([rec('1', 'a', tpl - 1)]).items[0].oldPrice, tpl);
});

const many = (n) => Array.from({ length: n }, (_, i) => ({ barcode: 'bc-' + String((i * 7919) % n).padStart(5, '0') }));   // scrambled order

test('windows by offset visit every product exactly once, in a fixed order', () => {
  const items = many(450); const seen = [];
  for (let off = 0; off < items.length; off += 200) seen.push(...pickCheckWindow(items, { offset: off, batchSize: 200 }));
  assert.equal(seen.length, 450); assert.equal(new Set(seen.map(i => i.barcode)).size, 450);
  assert.deepEqual(seen.map(i => i.barcode), [...seen.map(i => i.barcode)].sort());
});

test('windows ignore what was checked before (products without a record cannot block the walk)', () => {
  const items = many(30); const lastChecked = new Map(items.slice(0, 10).map(i => [i.barcode, new Date()]));
  const a = pickCheckWindow(items, { offset: 0, batchSize: 10, lastChecked }).map(i => i.barcode);
  const b = pickCheckWindow(items, { offset: 10, batchSize: 10, lastChecked }).map(i => i.barcode);
  assert.equal(new Set([...a, ...b]).size, 20);
});

test('a window past the end is empty; the size is kept between 10 and 500', () => {
  assert.equal(pickCheckWindow(many(30), { offset: 40, batchSize: 10 }).length, 0);
  assert.equal(pickCheckWindow(many(600), { offset: 0, batchSize: 5000 }).length, 500);
  assert.equal(pickCheckWindow(many(600), { offset: 0, batchSize: 1 }).length, 10);
});

test('rotation: never-checked first, oldest next, batchSize 0 means all; input untouched', () => {
  const items = [{ barcode: 'a' }, { barcode: 'b' }, { barcode: 'c' }];
  const lastChecked = new Map([['a', new Date(3000)], ['b', new Date(1000)]]);
  assert.deepEqual(pickCheckWindow(items, { batchSize: 2, lastChecked }).map(i => i.barcode), ['c', 'b']);
  assert.equal(pickCheckWindow(items, { batchSize: 0, lastChecked }).length, 3);
  assert.deepEqual(items.map(i => i.barcode), ['a', 'b', 'c']);
});
