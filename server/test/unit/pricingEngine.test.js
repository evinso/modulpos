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

const { summarizeCoverage, explainTemplatePrice } = require('../../src/services/pricingEngine');

test('explain: profit matches the formula (purchase 100, ship 10, 10% commission, 20% VAT, 30% profit)', () => {
  const e = explainTemplatePrice(100, 30, { shippingCost: 10, commissionPct: 10, vatRate: 20 });
  assert.equal(e.price, 186.67); assert.equal(e.profit, 30);
});
test('coverage: sums profit over the matching products only, each with its own VAT', () => {
  const products = [
    { xmlSourceId: 'A', xmlPrice: 100, price: 100, vatRate: 20 },
    { xmlSourceId: 'A', xmlPrice: 200, price: 200, vatRate: 10 },
    { xmlSourceId: 'B', xmlPrice: 999, price: 999, vatRate: 20 },   // other source -> ignored
  ];
  const s = summarizeCoverage(products, 30, { xmlSourceIds: ['A'], shippingCost: 10, vatRate: null });
  assert.equal(s.covered, 2); assert.equal(s.priced, 2);
  assert.equal(s.totalProfit, 90);      // 30% of 100 + 30% of 200, VAT does not change the profit
  assert.equal(s.avgProfit, 45); assert.equal(s.minProfit, 30); assert.equal(s.maxProfit, 60);
});
test('coverage: flags products sold at a loss', () => {
  const s = summarizeCoverage([{ xmlPrice: 100, price: 100, vatRate: 0 }], 0, { shippingCost: 30, profitMode: 'fixed', minPrice: 1, maxPrice: 110 });
  assert.equal(s.losing, 1); assert.ok(s.minProfit < 0);
});

test('gross commission basis: commission is taken on the VAT-inclusive price and the stated profit is really left over', () => {
  const c0 = { shippingCost: 10, commissionPct: 10, vatRate: 20, commissionBasis: 'gross' };
  const e = explainTemplatePrice(100, 30, c0);                 // 30 TL profit on a 100 TL purchase
  assert.equal(e.profit, 30);
  assert.ok(Math.abs(e.commissionAmount - e.price * 0.10) < 0.011);   // 10% of the gross price
  assert.ok(e.price > c(100, 30, { shippingCost: 10, commissionPct: 10, vatRate: 20 }));  // dearer than the legacy formula, which under-charged commission
  const exVat = e.price / 1.2;
  assert.ok(Math.abs(exVat - e.commissionAmount - 110 - e.profit) < 0.02);
});
test('gross basis: margin on price and fixed profit also hit their targets', () => {
  const m = explainTemplatePrice(100, 20, { commissionPct: 12, vatRate: 20, profitMode: 'margin_on_price', commissionBasis: 'gross' });
  assert.ok(Math.abs(m.profit / (m.price / 1.2) - 0.20) < 0.005);      // 20% of the VAT-exclusive price
  const f = explainTemplatePrice(100, 25, { commissionPct: 12, vatRate: 10, profitMode: 'fixed', commissionBasis: 'gross' });
  assert.equal(f.profit, 25);
});
test('gross basis: impossible combinations return null', () => {
  assert.equal(c(100, 10, { commissionPct: 90, vatRate: 20, commissionBasis: 'gross' }), null);
});
test('legacy formula is unchanged when no basis is given', () => {
  assert.equal(c(100, 30, { shippingCost: 10, commissionPct: 10, vatRate: 20 }), 186.67);
});
