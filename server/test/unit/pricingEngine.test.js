const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTemplatePrice: c, PricingContext } = require('../../src/services/pricingEngine');

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} !~ ${b}`);

test('legacy range formula', () => near(c(100, 30, { shippingCost: 10, commissionPct: 10, vatRate: 20 }), (110 + 30) / 0.9 * 1.2));
test('percent of cost', () => near(c(100, 20, { shippingCost: 10, profitMode: 'percent_of_cost' }), 110 * 1.2));
test('fixed profit', () => near(c(100, 25, { profitMode: 'fixed' }), 125));
test('margin on price', () => near(c(100, 20, { commissionPct: 10, profitMode: 'margin_on_price' }), 100 / 0.7));
test('ending .90', () => near(c(100, 17.44, { roundingMode: 'ending', roundingEnding: 0.9 }), 117.9));
test('ending bumps to next unit', () => near(c(100, 17.95, { roundingMode: 'ending', roundingEnding: 0.9 }), 118.9));
test('clamps', () => { near(c(10, 5, { minPrice: 50 }), 50); near(c(100, 100, { maxPrice: 150 }), 150); });
test('invalid inputs give null', () => { assert.equal(c(100, 10, { commissionPct: 96 }), null); assert.equal(c(0, 10, {}), null); });

const R = (o) => ({ id: 'r', name: 'r', isActive: true, priority: 0, createdAt: new Date(0), type: 'percentage', value: 30, applyTo: 'price_template', ...o });
test('sale VAT defaults to the product VAT', () => {
  const ctx = new PricingContext([R({ conditions: JSON.stringify({ vatRate: null }) })], 'C');
  assert.equal(ctx.priceFor({ price: 100, xmlPrice: 100, vatRate: 20 }).price, 156);
  assert.equal(ctx.priceFor({ price: 100, xmlPrice: 100, vatRate: 0 }).price, 130);
});
test('more specific scope wins, other connection ignored', () => {
  const ctx = new PricingContext([
    R({ id: 'all', conditions: '{}' }),
    R({ id: 'cat', value: 50, conditions: JSON.stringify({ categories: ['Kolye'] }) }),
    R({ id: 'other', conditions: JSON.stringify({ connectionId: 'C9' }) }),
  ], 'C1');
  assert.equal(ctx.priceFor({ price: 100, xmlPrice: 100, category: 'Kadın|Kolye|' }).ruleId, 'cat');
  assert.equal(ctx.priceFor({ price: 100, xmlPrice: 100, category: 'Bileklik' }).ruleId, 'all');
});
