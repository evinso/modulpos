const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/services/pricingEngine');

/**
 * Products added by hand: their "price" is the NET amount the owner wants to keep per sale; the marketplace price is the same
 * solver as every template, asked backwards (pricingEngine.netExplain).
 */
const near = (a, b, m = '', tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${m} ${a} !~ ${b}`);
const R = (o) => ({ id: 'r1', name: 'Elle eklenenler', isActive: true, priority: 0, createdAt: new Date(0), type: 'percentage', value: 0, applyTo: 'price_template', ...o });
// the owner's real template values (2026-11): 22% commission, 100 TL shipping, 13.19 TL service fee, 1% stopaj, VAT payer
const COSTS = { shippingCost: 100, packagingCost: 0, extraCost: 0, commissionPct: 22, extraPct: 0, serviceFee: 13.19, inputVat: true, purchaseVatRate: 20, withholdingPct: 1, commissionBasis: 'gross', vatRate: 20, roundingMode: 'none' };
const hand = (o = {}) => ({ id: 'h1', xmlSourceId: null, xmlPrice: 0, price: 100, vatRate: 20, category: '', brand: 'Atölye', ...o });

test('cash mode: exactly the amount stays after commission, service fee, shipping, stopaj and the VAT to pay', () => {
  const e = E.netExplain(100, COSTS);
  near(e.price, 302.84, 'price');
  near(e.profit, 100, 'what stays', 0.02);
  assert.equal(e.purchase, 0, 'no purchase in cash mode');
  assert.deepEqual(e.net, { amount: 100, mode: 'cash' });
  // the list on screen adds up: price - commission - fee - stopaj - VAT payable - shipping = what stays
  near(e.price - e.commissionAmount - e.serviceFee - e.withholding - e.payableVat - e.shippingCost, e.profit, 'the breakdown adds up', 0.03);
});

test('purchase mode: the amount is the purchase price and the profit is 0 (its VAT is deducted)', () => {
  const e = E.netExplain(100, { ...COSTS, netMode: 'purchase' });
  near(e.price, 276.87, 'price');
  near(e.profit, 0, 'profit', 0.02);
  assert.equal(e.purchase, 100);
  assert.deepEqual(e.net, { amount: 100, mode: 'purchase' });
  assert.ok(E.netExplain(100, COSTS).price > e.price, 'cash mode asks more: the VAT to pay is not softened by a purchase invoice');
});

test('an unknown netMode is the default (cash)', () => {
  assert.equal(E.netExplain(100, { ...COSTS, netMode: 'whatever' }).net.mode, 'cash');
});

test('property: for many amounts and commissions the cash price really leaves the amount (checked with the opposite function)', () => {
  for (const amount of [1, 9.9, 37.5, 100, 250, 999.99, 4000]) {
    for (const commissionPct of [0, 5, 10, 15, 22, 30]) {
      for (const tax of [true, false]) {
        const c = { ...COSTS, commissionPct, ...(tax ? {} : { inputVat: false, withholdingPct: 0 }) };
        const e = E.netExplain(amount, c);
        assert.ok(e && e.price > amount, `a price exists and is higher than the amount (${amount}, ${commissionPct}%, tax ${tax})`);
        const back = E.explainAtPrice(e.price, 0, c);
        near(back.profit, amount, `back-check ${amount}/${commissionPct}/${tax}`, 0.03);
      }
    }
  }
});

test('without the tax options the earlier plain formula is used (VAT-free revenue - costs - commission = amount)', () => {
  const c = { shippingCost: 50, packagingCost: 5, commissionPct: 20, commissionBasis: 'gross', vatRate: 20, roundingMode: 'none' };
  const e = E.netExplain(100, c);
  near(e.price, (100 + 55) / (1 / 1.2 - 0.2), 'price', 0.02);
  near(e.profit, 100, 'profit', 0.02);
});

test('price ending (rounding) only ever raises the price: the owner never gets less than the amount', () => {
  const e = E.netExplain(100, { ...COSTS, roundingMode: 'ending', roundingEnding: 0.9 });
  assert.equal(e.price, 302.9);
  assert.ok(e.profit >= 100 - 0.02);
});

test('a commission that eats the whole price cannot be priced: null, not a nonsense number', () => {
  assert.equal(E.netExplain(100, { ...COSTS, commissionPct: 99 }), null);
  assert.equal(E.netExplain(0, COSTS), null, 'and nothing to price without an amount');
});

test('a stored shipping table (older templates) is honoured in cash mode too', () => {
  const c = { ...COSTS, shippingCost: 0, shippingTiers: [{ upTo: 250, cost: 60 }, { upTo: null, cost: 100 }] };
  const e = E.netExplain(100, c);
  assert.ok(e.shippingTier >= 1, 'a row was chosen');
  near(E.explainAtPrice(e.price, 0, c).profit, 100, 'consistent with the row used', 0.05);
});

// ── in the pricing context ───────────────────────────────────────────────────────────────────────────────────
test('a hand-added product is priced from the net amount by the template of the scope "none"', () => {
  const rule = R({ conditions: JSON.stringify({ ...COSTS, xmlSourceIds: ['none'], netMode: 'cash' }) });
  const ctx = new E.PricingContext([rule], 'C');
  const p = ctx.priceFor(hand());
  near(p.price, 302.84, 'price');
  const ex = ctx.explainFor(hand());
  assert.equal(ex.kind, 'template'); assert.deepEqual(ex.net, { amount: 100, mode: 'cash' }); assert.equal(ex.purchase, 0);
  near(ex.breakdown.profit, 100, 'what stays', 0.02);
});

test('the template\'s net mode is used (purchase)', () => {
  const rule = R({ conditions: JSON.stringify({ ...COSTS, xmlSourceIds: ['none'], netMode: 'purchase' }) });
  const ctx = new E.PricingContext([rule], 'C');
  near(ctx.priceFor(hand()).price, 276.87, 'price');
  assert.equal(ctx.explainFor(hand()).purchase, 100);
});

test('profit settings of the template are ignored for hand-added products (the amount is the target)', () => {
  const rule = R({ value: 55, conditions: JSON.stringify({ ...COSTS, xmlSourceIds: ['none'], profitMode: 'percent_of_purchase', profitTiers: [{ upTo: 50, value: 10 }, { upTo: null, value: 90 }] }) });
  near(new E.PricingContext([rule], 'C').priceFor(hand()).price, 302.84, 'same as without profit settings');
});

test('the scope "none" only matches hand-added products; XML products and products of removed sources are not touched', () => {
  const rule = R({ conditions: JSON.stringify({ ...COSTS, xmlSourceIds: ['none'] }) });
  const ctx = new E.PricingContext([rule], 'C');
  assert.equal(ctx.priceFor({ id: 'x1', xmlSourceId: 'src-1', xmlPrice: 100, price: 100, vatRate: 20 }), null, 'an XML product is not matched');
  assert.equal(ctx.priceFor({ id: 'x2', xmlSourceId: null, xmlPrice: 50, price: 50, vatRate: 20 }), null, 'a product whose XML source was removed keeps its feed price and is not "hand-added"');
  assert.equal(ctx.priceFor({ id: 'x3', price: 100, vatRate: 20 }), null, 'a caller that did not load xmlSourceId never gets a hand-added price');
});

test('a template of one XML source does not price hand-added products; an unscoped template does (as net, cash by default)', () => {
  const xmlOnly = R({ conditions: JSON.stringify({ ...COSTS, xmlSourceIds: ['src-1'], profitMode: 'percent_of_purchase' }), value: 30 });
  assert.equal(new E.PricingContext([xmlOnly], 'C').priceFor(hand()), null);
  const open = R({ id: 'r2', conditions: JSON.stringify({ ...COSTS, profitMode: 'percent_of_purchase' }), value: 30 });
  const ctx = new E.PricingContext([xmlOnly, open], 'C');
  near(ctx.priceFor(hand()).price, 302.84, 'net, not purchase + 30% profit');
  // ... and the XML product of src-1 is still priced the old way by its own template
  const x = ctx.priceFor({ id: 'x1', xmlSourceId: 'src-1', xmlPrice: 100, price: 100, vatRate: 20 });
  near(x.price, E.computeTemplatePrice(100, 30, { ...COSTS, profitMode: 'percent_of_purchase' }), 'XML pricing unchanged');
});

test('the more specific template wins: "none" before an unscoped one', () => {
  const generic = R({ id: 'g', name: 'Genel', conditions: JSON.stringify({ ...COSTS, commissionPct: 10 }) });
  const special = R({ id: 's', name: 'Elle', conditions: JSON.stringify({ ...COSTS, commissionPct: 22, xmlSourceIds: ['none'] }) });
  const ex = new E.PricingContext([generic, special], 'C').explainFor(hand());
  assert.equal(ex.ruleName, 'Elle'); near(ex.price, 302.84, 'price');
});

test('a price typed in by hand still wins; the profit at that price is what stays (no purchase cost)', () => {
  const rule = R({ conditions: JSON.stringify({ ...COSTS, xmlSourceIds: ['none'] }) });
  const ctx = new E.PricingContext([rule], 'C', new Map([['h1', 350]]));
  assert.equal(ctx.priceFor(hand()).price, 350);
  const ex = ctx.explainFor(hand());
  assert.equal(ex.manual, true); assert.deepEqual(ex.net, { amount: 100, mode: 'cash' });
  assert.ok(ex.breakdown.profit > 100, 'a higher price leaves more than the amount');
  near(ex.templatePrice, 302.84, 'the template price is kept for comparison');
  assert.equal(E.sellsAtLoss(ex), false);
  const low = new E.PricingContext([rule], 'C', new Map([['h1', 140]])).explainFor(hand());
  assert.equal(E.sellsAtLoss(low), true, 'at 140 the costs eat more than the sale brings: a loss');
});

test('no amount typed (0 TL): no price', () => {
  const rule = R({ conditions: JSON.stringify({ ...COSTS, xmlSourceIds: ['none'] }) });
  assert.equal(new E.PricingContext([rule], 'C').priceFor(hand({ price: 0 })), null);
});

test('coverage of a template for hand-added products counts only them and bands by the net amount', () => {
  const conds = { ...COSTS, xmlSourceIds: ['none'], netMode: 'cash' };
  const products = [hand({ id: 'a', price: 50 }), hand({ id: 'b', price: 100 }), hand({ id: 'c', price: 400 }),
    { id: 'x', xmlSourceId: 'src-1', xmlPrice: 100, price: 100, vatRate: 20 }];
  const s = E.summarizeCoverage(products, 0, conds);
  assert.equal(s.covered, 3); assert.equal(s.priced, 3);
  near(s.totalProfit, 550, 'the amounts add up to what the owner keeps', 0.2);
  near(s.avgPurchase, 550 / 3, 'bands are by the net amount', 0.02);
});

test('isHandScope / isHandAdded', () => {
  assert.equal(E.isHandScope({ xmlSourceIds: ['none'] }), true);
  assert.equal(E.isHandScope({ xmlSourceIds: ['a'] }), false);
  assert.equal(E.isHandScope({}), false);
  assert.equal(E.isHandAdded({ xmlSourceId: null, xmlPrice: 0 }), true);
  assert.equal(E.isHandAdded({ xmlSourceId: null, xmlPrice: 10 }), false);
  assert.equal(E.isHandAdded({ xmlSourceId: 'a', xmlPrice: 0 }), false);
  assert.equal(E.isHandAdded({ xmlPrice: 0 }), false);
});
