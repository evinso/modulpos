const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/services/pricingEngine');

const near = (a, b, m = '') => assert.ok(Math.abs(a - b) < 0.011, `${m} ${a} !~ ${b}`);
const R = (o) => ({ id: 'r1', name: 'Genel', isActive: true, priority: 0, createdAt: new Date(0), type: 'percentage', value: 30, applyTo: 'price_template', ...o });
const conds = { shippingCost: 10, commissionPct: 10, commissionBasis: 'gross', vatRate: null, roundingMode: 'none' };
const rule = R({ conditions: JSON.stringify(conds) });
const prod = (o = {}) => ({ id: 'p1', xmlPrice: 100, price: 100, vatRate: 20, xmlSourceId: null, category: 'Kolye', ...o });

test('without manual prices nothing changes', () => {
  const plain = new E.PricingContext([rule], 'C');
  const withEmpty = new E.PricingContext([rule], 'C', new Map());
  assert.deepEqual(plain.priceFor(prod()), withEmpty.priceFor(prod()));
  assert.equal(plain.explainFor(prod()).kind, 'template');
  assert.equal(plain.priceFor(prod()).manual, undefined);
  assert.equal(new E.PricingContext([], 'C').priceFor(prod()), null);
});

test('a hand-typed price wins over the template, only for that product and marketplace', () => {
  const ctx = new E.PricingContext([rule], 'C', new Map([['p1', 250.5]]));
  const own = ctx.priceFor(prod());
  assert.equal(own.price, 250.5); assert.equal(own.manual, true); assert.equal(own.ruleName, E.MANUAL_RULE_NAME); assert.equal(own.ruleId, 'r1');
  const other = ctx.priceFor(prod({ id: 'p2' }));
  assert.equal(other.manual, undefined); assert.notEqual(other.price, 250.5);
});

test('a hand-typed price makes a product without any template sendable', () => {
  const ctx = new E.PricingContext([], 'C', new Map([['p1', 199.9]]));
  assert.equal(ctx.priceFor(prod()).price, 199.9);
  assert.equal(ctx.priceFor(prod({ id: 'p2' })), null);
  const ex = ctx.explainFor(prod());
  assert.equal(ex.kind, 'manual'); assert.equal(ex.breakdown, null); assert.equal(ex.templatePrice, null);
});

test('nonsense values are ignored (zero, negative, not a number)', () => {
  for (const bad of [0, -5, NaN, undefined, null, '12']) {
    const ctx = new E.PricingContext([rule], 'C', new Map([['p1', bad]]));
    const r = ctx.priceFor(prod());
    assert.equal(r.manual, undefined, String(bad));
  }
});

test('explainFor at a manual price: profit follows the template costs, template price is kept for comparison', () => {
  const tpl = new E.PricingContext([rule], 'C').explainFor(prod());
  const man = new E.PricingContext([rule], 'C', new Map([['p1', tpl.price + 50]])).explainFor(prod());
  assert.equal(man.kind, 'manual'); assert.equal(man.manual, true);
  near(man.templatePrice, tpl.price);
  assert.ok(man.breakdown.profit > tpl.breakdown.profit + 30, 'more profit at a higher price');
  const low = new E.PricingContext([rule], 'C', new Map([['p1', 100]])).explainFor(prod());
  assert.ok(low.breakdown.profit < 0, 'selling at the purchase price loses money after costs');
});

test('explainAtPrice agrees with the template solver at the template price', () => {
  for (const P of [40, 100, 450]) {
    const c = { ...conds, vatRate: 20 };
    const t = E.explainTemplatePrice(P, 30, c);
    const a = E.explainAtPrice(t.price, P, c);
    near(a.profit, t.profit, `P=${P}`); near(a.commissionAmount, t.commissionAmount); near(a.vatAmount, t.vatAmount);
  }
});

test('explainAtPrice: worked example (price 240 incl. 20% VAT, cost 100, shipping 10, 10% commission on the gross price)', () => {
  const a = E.explainAtPrice(240, 100, { shippingCost: 10, commissionPct: 10, commissionBasis: 'gross', vatRate: 20 });
  assert.equal(a.vatAmount, 40); assert.equal(a.commissionAmount, 24); assert.equal(a.fixedCosts, 10); assert.equal(a.profit, 66);
  assert.equal(a.marginOnPricePct, 27.5);
  // older rules: commission on the VAT-exclusive price
  const b = E.explainAtPrice(240, 100, { shippingCost: 10, commissionPct: 10, vatRate: 20 });
  assert.equal(b.commissionAmount, 20); assert.equal(b.profit, 70);
});

test('explainAtPrice: invalid price gives nothing; a shipping table row is picked by the price', () => {
  assert.equal(E.explainAtPrice(0, 100, conds), null);
  const c = { commissionPct: 0, vatRate: 20, packagingCost: 0, shippingTiers: [{ upTo: 100, cost: 10 }, { upTo: null, cost: 50 }] };
  assert.equal(E.explainAtPrice(90, 50, c).shippingCost, 10);    // table written VAT-inclusive: 90 <= 100 -> first row
  assert.equal(E.explainAtPrice(120, 50, c).shippingTier, 2);
  assert.equal(E.explainAtPrice(120, 50, { ...c, shippingTiersExVat: true }).shippingTier, 1);   // limit 100 ex VAT = 120 incl. VAT
  assert.equal(E.explainAtPrice(300, 50, { ...c, shippingTiersExVat: true }).shippingTier, 2);
});

test('previewAt reports the template price next to the typed one', () => {
  const ctx = new E.PricingContext([rule], 'C');
  const pv = ctx.previewAt(prod(), 300);
  assert.equal(pv.price, 300); assert.ok(pv.templatePrice > 0); assert.ok(pv.breakdown && typeof pv.breakdown.profit === 'number');
  assert.equal(new E.PricingContext([], 'C').previewAt(prod(), 300).breakdown, null);
});
