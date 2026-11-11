const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// pricingEngine.js pulls in the database module; a stand-in keeps this test free of any connection
const f = require.resolve(path.join(__dirname, '../../src/config/database.js'));
require.cache[f] = { id: f, filename: f, loaded: true, exports: {} };
const E = require('../../src/services/pricingEngine');

// The owner's reference sale (a marketplace profit screen): price 586.90, purchase 195 (VAT 20% inside), shipping 106,
// commission 22% of the VAT-inclusive price, service fee 13.19, stopaj 1% of the price without VAT.
const BASE = { vatRate: 20, shippingCost: 106, commissionPct: 22, commissionBasis: 'gross' };
const TAX = { ...BASE, serviceFee: 13.19, inputVat: true, purchaseVatRate: 20, withholdingPct: 1 };

test('the owner\'s reference sale: every figure of the profit screen is reproduced', () => {
  const b = E.explainAtPrice(586.90, 195, TAX);
  assert.equal(b.commissionAmount, 129.12);
  assert.equal(b.serviceFee, 13.19);
  assert.equal(b.withholding, 4.89);
  assert.equal(b.payableVat, 23.93);
  assert.equal(b.shippingCost, 106);
  assert.equal(b.purchase, 195);
  assert.equal(b.profit, 114.77);
  assert.deepEqual(b.vatDetail, { sale: 97.82, purchase: 32.5, shipping: 17.67, commission: 21.52, serviceFee: 2.2, other: 0, total: 23.93 });
  // the list adds up to the profit
  assert.equal(Math.round((586.90 - 129.12 - 13.19 - 4.89 - 23.93 - 106 - 195) * 100) / 100, b.profit);
});

test('the earlier calculation is what a template without the new options still gets (and it misses the recoverable VAT)', () => {
  const old = E.explainAtPrice(586.90, 195, { ...BASE, packagingCost: 13.19 });
  assert.equal(old.profit, 45.78);
  assert.equal(old.taxModel, undefined);
  // options present but switched off = identical to absent
  const off = E.explainAtPrice(586.90, 195, { ...BASE, packagingCost: 13.19, inputVat: false, withholdingPct: 0 });
  assert.deepEqual(off, old);
  const a = E.explainTemplatePrice(195, 40, { ...BASE, packagingCost: 13.19 });
  const b = E.explainTemplatePrice(195, 40, { ...BASE, packagingCost: 13.19, inputVat: false, withholdingPct: 0 });
  assert.deepEqual(a, b);
});

test('the service fee is a fixed cost, like packaging, in the earlier model too', () => {
  const viaFee = E.explainTemplatePrice(100, 30, { ...BASE, serviceFee: 13.19 });
  const viaPackaging = E.explainTemplatePrice(100, 30, { ...BASE, packagingCost: 13.19 });
  assert.equal(viaFee.price, viaPackaging.price);
  assert.equal(viaFee.profit, viaPackaging.profit);
});

test('the tax options need the gross commission basis; without it they are ignored', () => {
  const c = { vatRate: 20, shippingCost: 10, commissionPct: 20, inputVat: true, withholdingPct: 1, purchaseVatRate: 20 };
  assert.equal(E.taxModel(c).active, false);
  const b = E.explainAtPrice(300, 100, c);
  assert.equal(b.taxModel, undefined);
});

test('every profit method solves back to its target when the tax options are on (price -> profit round trip)', () => {
  const cases = [
    ['percent_of_purchase', 30, (b) => b.purchase * 0.30],
    ['fixed', 40, () => 40],
    ['percent_of_cost', 20, (b) => b.cost * 0.20],
    ['margin_on_price', 12, (b) => (b.price - b.vatAmount) * 0.12],
    ['margin_on_gross', 10, (b) => b.price * 0.10],
  ];
  for (const P of [20, 96, 195, 640]) {
    for (const [mode, value, want] of cases) {
      const e = E.explainTemplatePrice(P, value, { ...TAX, profitMode: mode });
      assert.ok(e, `${mode} P=${P}`);
      const target = want(e);
      assert.ok(Math.abs(e.profit - target) < 0.03 * Math.max(1, e.price / 100) + 0.02, `${mode} P=${P}: profit ${e.profit}, wanted ${target.toFixed(2)} (price ${e.price})`);
    }
  }
});

test('stopaj alone and recoverable VAT alone also solve back to the target', () => {
  for (const extra of [{ withholdingPct: 1 }, { inputVat: true, purchaseVatRate: 20 }, { inputVat: true, purchaseVatRate: 10, withholdingPct: 1 }]) {
    const e = E.explainTemplatePrice(150, 35, { ...BASE, serviceFee: 13.19, profitMode: 'fixed', ...extra });
    assert.ok(Math.abs(e.profit - 35) < 0.05, JSON.stringify({ extra, profit: e.profit, price: e.price }));
  }
});

test('the same target needs a LOWER sale price once the VAT on costs comes back', () => {
  const older = E.explainTemplatePrice(195, 30, { ...BASE, packagingCost: 13.19, profitMode: 'percent_of_purchase' });
  const newer = E.explainTemplatePrice(195, 30, { ...TAX, profitMode: 'percent_of_purchase' });
  assert.ok(newer.price < older.price, `${newer.price} < ${older.price}`);
  assert.ok(Math.abs(newer.profit - 58.5) < 0.1, String(newer.profit));
});

test('a purchase price without VAT credit (supplier without VAT) is respected', () => {
  const withCredit = E.explainAtPrice(300, 100, { ...BASE, inputVat: true, purchaseVatRate: 20 });
  const noCredit = E.explainAtPrice(300, 100, { ...BASE, inputVat: true, purchaseVatRate: 0 });
  assert.ok(withCredit.profit > noCredit.profit);
  assert.equal(noCredit.vatDetail.purchase, 0);
});

test('shipping tariff (VAT-exclusive table) still works with the tax options', () => {
  const c = { ...TAX, profitMode: 'fixed', shippingCost: 0, shippingTiersExVat: true, shippingTiers: [{ upTo: 199.99, cost: 48.33 }, { upTo: 349.99, cost: 79.16 }, { upTo: null, cost: 88.96 }] };
  for (const P of [30, 90, 200]) {
    const e = E.explainTemplatePrice(P, 25, c);
    assert.ok(Math.abs(e.profit - 25) < 0.1 || e.profit > 25, `P=${P} profit ${e.profit}`);
    assert.ok(e.shippingTier >= 1);
  }
});

test('a hand-typed price is judged with the same model (loss detection)', () => {
  const c = { ...BASE, serviceFee: 13.19 };
  const price = 470; const P = 195;
  const olderLoss = E.explainAtPrice(price, P, c);                                   // earlier model
  const newer = E.explainAtPrice(price, P, { ...c, inputVat: true, purchaseVatRate: 20, withholdingPct: 1 });
  assert.ok(newer.profit > olderLoss.profit);
  assert.equal(E.sellsAtLoss({ breakdown: newer }), newer.profit < 0);
});
