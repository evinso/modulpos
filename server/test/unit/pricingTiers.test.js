const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/services/pricingEngine');

const base = { commissionPct: 15, vatRate: 20, commissionBasis: 'gross' };
const SHIP = [{ upTo: 200, cost: 46 }, { upTo: 350, cost: 84 }, { upTo: null, cost: 190 }];
const near = (a, b, m = '') => assert.ok(Math.abs(a - b) < 0.011, `${m} ${a} !~ ${b}`);
const profitOf = (price, P, ship) => price / 1.2 - P - ship - price * 0.15; // net profit for a given gross price

test('no tables = exactly the old behaviour', () => {
  for (const P of [20, 100, 450]) {
    const old = E.computeTemplatePrice(P, 30, { ...base, shippingCost: 46 });
    assert.equal(E.computeTemplatePrice(P, 30, { ...base, shippingCost: 46, shippingTiers: [], profitTiers: undefined }), old);
  }
});

test('shipping table: row 1 when the price fits under its limit', () => {
  const r = E.resolveTemplate(40, 30, { ...base, shippingTiers: SHIP });
  assert.equal(r.shippingTier, 1); assert.ok(r.price <= 200);
  near(profitOf(r.price, 40, 46), 12);
});

test('shipping table: the flat-46 shortcut would lose money, the table moves to row 2 and keeps the profit', () => {
  const flat = E.computeTemplatePrice(100, 30, { ...base, shippingCost: 46 });
  assert.ok(flat > 200);                                  // price crossed the limit...
  assert.ok(profitOf(flat, 100, 84) < 0);                 // ...so real shipping (84) would have produced a loss
  const r = E.resolveTemplate(100, 30, { ...base, shippingTiers: SHIP });
  assert.equal(r.shippingTier, 2); assert.ok(r.price > 200 && r.price <= 350);
  near(profitOf(r.price, 100, 84), 30);                   // planned profit is kept
});

test('shipping table: last row ("and above")', () => {
  const r = E.resolveTemplate(400, 30, { ...base, shippingTiers: SHIP });
  assert.equal(r.shippingTier, 3); assert.ok(r.price > 350);
  near(profitOf(r.price, 400, 190), 120);
});

test('rounding that pushes the price over the limit moves to the next row', () => {
  // 199.95 would round up to 200.90 with a .90 ending
  const c = { ...base, roundingMode: 'ending', roundingEnding: 0.9, shippingTiers: [{ upTo: 200, cost: 46 }, { upTo: null, cost: 84 }] };
  for (let P = 90; P < 140; P += 0.5) {
    const r = E.resolveTemplate(P, 30, c);
    assert.ok(r.shippingTier === 1 ? r.price <= 200 : r.price > 200, `P=${P} tier ${r.shippingTier} price ${r.price}`);
  }
});

test('rows that get cheaper at higher prices never produce a loss', () => {
  const c = { ...base, shippingTiers: [{ upTo: 200, cost: 90 }, { upTo: null, cost: 0 }] };
  for (let P = 80; P < 200; P += 1) {
    const r = E.resolveTemplate(P, 30, c);
    const ship = r.price <= 200 ? 90 : 0;
    assert.ok(profitOf(r.price, P, ship) >= P * 0.3 - 0.02, `P=${P} price=${r.price}`);
  }
});

test('profit table picks the row by purchase price', () => {
  const profitTiers = [{ upTo: 100, value: 40 }, { upTo: 300, value: 30 }, { upTo: null, value: 20 }];
  assert.equal(E.resolveTemplate(80, 99, { ...base, profitTiers }).profitValue, 40);
  assert.equal(E.resolveTemplate(100, 99, { ...base, profitTiers }).profitTier, 1);   // limit is inclusive
  assert.equal(E.resolveTemplate(250, 99, { ...base, profitTiers }).profitValue, 30);
  assert.equal(E.resolveTemplate(900, 99, { ...base, profitTiers }).profitTier, 3);
  const single = E.computeTemplatePrice(80, 40, base);
  assert.equal(E.computeTemplatePrice(80, 99, { ...base, profitTiers }), single);   // same as typing 40% by hand
});

test('profit table with fixed profit uses TL', () => {
  const profitTiers = [{ upTo: 100, value: 15 }, { upTo: null, value: 40 }];
  const a = E.explainTemplatePrice(50, 0, { ...base, profitMode: 'fixed', profitTiers });
  const b = E.explainTemplatePrice(500, 0, { ...base, profitMode: 'fixed', profitTiers });
  near(a.profit, 15); near(b.profit, 40);
});

test('explain reports tiers, shipping used and the margin on the sale price', () => {
  const e = E.explainTemplatePrice(100, 30, { ...base, shippingTiers: SHIP });
  assert.equal(e.shippingTier, 2); assert.equal(e.shippingCost, 84); near(e.fixedCosts, 84);
  near(e.profit, 30);
  near(e.marginOnPricePct, e.profit / e.price * 100);
});

test('explain without tables keeps old fields and tier nulls', () => {
  const e = E.explainTemplatePrice(100, 30, { shippingCost: 10, commissionPct: 10, vatRate: 20 });
  assert.equal(e.price, 186.67); assert.equal(e.profit, 30); assert.equal(e.shippingTier, null); assert.equal(e.profitTier, null);
});

test('validation: good tables, empty tables, and each kind of bad input', () => {
  assert.equal(E.validateTiers(undefined, 'cost').error, null);
  assert.equal(E.validateTiers([], 'cost').error, null);
  assert.equal(E.validateTiers(SHIP, 'cost').error, null);
  for (const bad of [
    'x', [{ upTo: 100, cost: 5 }],                                    // one row only
    [{ upTo: 100, cost: 5 }, { upTo: 50, cost: 6 }, { upTo: null, cost: 7 }],   // not ascending
    [{ upTo: 100, cost: 5 }, { upTo: 200, cost: 7 }],                  // last row must be "and above"
    [{ upTo: 100, cost: -1 }, { upTo: null, cost: 7 }],                // negative
    [{ upTo: 100, cost: 'abc' }, { upTo: null, cost: 7 }],
    [{}, {}, {}, {}],                                                  // too many
    [{ upTo: null, cost: 5 }, { upTo: null, cost: 7 }],                // "and above" not last
  ]) assert.ok(E.validateTiers(bad, 'cost').error, JSON.stringify(bad));
});

test('a broken table that slipped in is ignored when pricing (feature off, no crash)', () => {
  const c = { ...base, shippingCost: 46, shippingTiers: [{ upTo: 'x' }] };
  assert.equal(E.computeTemplatePrice(100, 30, c), E.computeTemplatePrice(100, 30, { ...base, shippingCost: 46 }));
});

test('coverage uses the tables per product', () => {
  const products = [{ xmlPrice: 40, price: 40, vatRate: 20 }, { xmlPrice: 100, price: 100, vatRate: 20 }];
  const s = E.summarizeCoverage(products, 30, { ...base, shippingTiers: SHIP });
  assert.equal(s.priced, 2); assert.equal(s.losing, 0); near(s.totalProfit, 12 + 30);
});
