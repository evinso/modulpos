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
    [{ upTo: null, cost: 5 }, { upTo: null, cost: 7 }],                // "and above" not last
  ]) assert.ok(E.validateTiers(bad, 'cost').error, JSON.stringify(bad));
});

// A table with N rows: upTo 1..N-1, then "and above"
const table = (n, key) => Array.from({ length: n - 1 }, (_, i) => ({ upTo: i + 1, [key]: 5 })).concat([{ upTo: null, [key]: 5 }]);

test('there is no small row limit: 4, 40 and the safety ceiling are valid, one more is refused', () => {
  assert.equal(E.validateTiers(table(4, 'value'), 'value').error, null);               // four rows used to be refused
  assert.equal(E.validateTiers(table(40, 'value'), 'value').tiers.length, 40);
  assert.equal(E.validateTiers(table(E.MAX_TIERS, 'cost'), 'cost').error, null);
  assert.match(E.validateTiers(table(E.MAX_TIERS + 1, 'cost'), 'cost').error, new RegExp(`En fazla ${E.MAX_TIERS} kademe`));
  assert.ok(E.MAX_TIERS >= 1000, 'the ceiling is only a safety net, far above real use');
});

test('a long profit table picks the right row at every boundary (limits are inclusive)', () => {
  const rows = Array.from({ length: 29 }, (_, i) => ({ upTo: (i + 1) * 10, value: 60 - i })).concat([{ upTo: null, value: 20 }]);
  const c = { ...base, profitTiers: rows };
  for (const [P, tier, pct] of [[5, 1, 60], [10, 1, 60], [10.01, 2, 59], [145, 15, 46], [290, 29, 32], [290.01, 30, 20], [900, 30, 20]]) {
    const r = E.resolveTemplate(P, 0, c);
    assert.equal(r.profitTier, tier, `P=${P}`); assert.equal(r.profitValue, pct, `P=${P}`);
    near(r.price, E.computeTemplatePrice(P, pct, { ...base }), `P=${P}`);                     // same as a single profit value of that row
  }
});

test('a long shipping table (12 rows) keeps the planned profit for every product', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ upTo: 100 + i * 50, cost: 40 + i * 6 })).concat([{ upTo: null, cost: 120 }]);
  const c = { ...base, shippingTiers: rows };
  for (const P of [10, 60, 100, 250, 400, 900]) {
    const r = E.resolveTemplate(P, 30, c);
    assert.ok(r.shippingTier >= 1 && r.shippingTier <= 12, `P=${P} row ${r.shippingTier}`);
    const row = rows[r.shippingTier - 1], prev = r.shippingTier > 1 ? rows[r.shippingTier - 2].upTo : 0;
    assert.ok(row.upTo === null || r.price <= row.upTo + 0.011, `P=${P}: ${r.price} fits under the row limit`);
    assert.ok(r.price > prev - 0.011, `P=${P}: ${r.price} is above the previous limit`);
    near(profitOf(r.price, P, row.cost), P * 0.3, `P=${P}`);
  }
});

test('a table of the safety-ceiling size still prices a whole catalogue quickly', () => {
  const tiers = Array.from({ length: E.MAX_TIERS - 1 }, (_, i) => ({ upTo: (i + 1) * 5, value: 40 })).concat([{ upTo: null, value: 20 }]);
  const rule = { id: 'r', name: 'n', isActive: true, priority: 0, createdAt: new Date(0), type: 'percentage', value: 0, applyTo: 'price_template', conditions: JSON.stringify({ ...base, profitTiers: tiers }) };
  const ctx = new E.PricingContext([rule], 'C');
  const t0 = Date.now();
  let priced = 0;
  for (let i = 0; i < 4100; i++) if (ctx.priceFor({ id: 'p' + i, xmlPrice: 5 + (i * 7919) % 4900, price: 100, vatRate: 20, xmlSourceId: null, category: 'x' })) priced++;
  assert.equal(priced, 4100);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);                       // ~0.1 s in practice; the bound only catches an accidental O(n^2)
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

test('auto bands: round edges, roughly equal counts, no empty or duplicate bands', () => {
  const prices = [];
  for (let i = 0; i < 1000; i++) prices.push(10 + (i % 100) * 3 + (i % 7));
  const edges = E.autoBandEdges(prices);
  assert.ok(edges.length >= 2 && edges.length <= 4);
  for (let i = 1; i < edges.length; i++) assert.ok(edges[i] > edges[i - 1]);
  assert.ok(edges.every((e) => e % 10 === 0));
  assert.deepEqual(E.autoBandEdges([]), []); assert.deepEqual(E.autoBandEdges([50]), []); assert.deepEqual(E.autoBandEdges([50, 50, 50]), []);
});

test('coverage bands add up to the totals and show the shipping row per band', () => {
  const products = [];
  for (let i = 0; i < 300; i++) products.push({ id: 'p' + i, title: 'T' + i, xmlPrice: 20 + i * 2, price: 20 + i * 2, vatRate: 20 });
  const s = E.summarizeCoverage(products, 30, { ...base, shippingTiers: SHIP });
  assert.ok(s.bands.length >= 3);
  assert.equal(s.bands.reduce((t, b) => t + b.count, 0), s.priced);                       // every product is in exactly one band
  near(s.bands.reduce((t, b) => t + b.avgProfit * b.count, 0), s.totalProfit, 'profit') ;
  assert.equal(s.bands[0].from, 0); assert.equal(s.bands[s.bands.length - 1].to, null);
  assert.ok(s.bands[0].shippingTier === 1 && s.bands[s.bands.length - 1].shippingTier >= 2);
  assert.ok(s.marginOnPricePct > 0);
});

test('coverage lists the worst losing products first', () => {
  const products = [{ id: 'a', title: 'A', xmlPrice: 100, price: 100, vatRate: 20 }, { id: 'b', title: 'B', xmlPrice: 100, price: 100, vatRate: 20 }];
  const s = E.summarizeCoverage(products, 30, { ...base, minPrice: 50, maxPrice: 60 });   // price clamped below cost => loss
  assert.equal(s.losing, 2); assert.equal(s.losingSamples.length, 2); assert.ok(s.losingSamples[0].profit < 0);
});

test('tariff-style (VAT-exclusive) shipping table: same result as the converted VAT-inclusive table', () => {
  const ex = { ...base, shippingTiersExVat: true, shippingTiers: [{ upTo: 200, cost: 48.33 }, { upTo: 350, cost: 79.16 }, { upTo: null, cost: 88.96 }] };
  const inc = { ...base, shippingTiers: [{ upTo: 240, cost: 58.0 }, { upTo: 420, cost: 94.99 }, { upTo: null, cost: 106.75 }] };
  for (const P of [20, 40, 60, 96, 120, 300, 800]) {
    const a = E.resolveTemplate(P, 30, ex), b = E.resolveTemplate(P, 30, inc);
    near(a.price, b.price, `P=${P}`); assert.equal(a.shippingTier, b.shippingTier);
    near(a.shippingCost, b.shippingCost, 'cost');
  }
});

test('VAT-exclusive limits follow the product VAT rate (10% VAT: 200 becomes 220)', () => {
  const c = { ...base, vatRate: 10, shippingTiersExVat: true, shippingTiers: [{ upTo: 200, cost: 48.33 }, { upTo: null, cost: 100 }] };
  const r = E.resolveTemplate(20, 30, c);
  assert.equal(r.shippingTier, 1); assert.ok(r.price <= 220.001);
  const big = E.resolveTemplate(150, 30, c);
  assert.equal(big.shippingTier, 2);
});

test('explain shows the VAT-inclusive shipping that was really charged', () => {
  const e = E.explainTemplatePrice(40, 30, { ...base, shippingTiersExVat: true, shippingTiers: [{ upTo: 200, cost: 48.33 }, { upTo: null, cost: 88.96 }] });
  assert.equal(e.shippingTier, 1); near(e.shippingCost, 58.0, 'gross'); near(e.fixedCosts, 58.0, 'fixed');
});

test('without the flag nothing changes', () => {
  const a = E.computeTemplatePrice(100, 30, { ...base, shippingTiers: SHIP });
  const b = E.computeTemplatePrice(100, 30, { ...base, shippingTiers: SHIP, shippingTiersExVat: false });
  assert.equal(a, b);
});

test('net margin mode: profit is exactly value% of the VAT-inclusive sale price (no rounding)', () => {
  for (const m of [5, 10, 15]) for (const P of [20, 96, 300]) {
    const c = { commissionPct: 22.37, vatRate: 20, packagingCost: 16.39, shippingCost: 58, profitMode: 'margin_on_gross' };
    const e = E.explainTemplatePrice(P, m, c);
    near(e.profit / e.price * 100, m, `m=${m} P=${P}`);
    near(e.marginOnPricePct, m);
  }
});

test('net margin mode works with the commission basis missing (always gross) and with shipping tiers', () => {
  const c = { commissionPct: 22.37, vatRate: 20, packagingCost: 16.39, profitMode: 'margin_on_gross', shippingTiersExVat: true,
    shippingTiers: [{ upTo: 199.99, cost: 48.33 }, { upTo: 349.99, cost: 79.16 }, { upTo: null, cost: 88.96 }] };
  const cheap = E.explainTemplatePrice(20, 10, c), mid = E.explainTemplatePrice(96, 10, c), big = E.explainTemplatePrice(400, 10, c);
  assert.equal(cheap.shippingTier, 1); assert.equal(mid.shippingTier, 2); assert.equal(big.shippingTier, 3);
  for (const e of [cheap, mid, big]) assert.ok(e.profit / e.price * 100 >= 9.99, `margin ${e.profit / e.price * 100}`);
});

test('net margin mode: a margin the costs cannot support gives no price instead of nonsense', () => {
  assert.equal(E.computeTemplatePrice(100, 90, { commissionPct: 22, vatRate: 20, profitMode: 'margin_on_gross' }), null);
});

test('net margin can be tiered by purchase price', () => {
  const c = { commissionPct: 22.37, vatRate: 20, packagingCost: 10, shippingCost: 50, profitMode: 'margin_on_gross', profitTiers: [{ upTo: 50, value: 14 }, { upTo: null, value: 8 }] };
  near(E.explainTemplatePrice(30, 0, c).marginOnPricePct, 14); near(E.explainTemplatePrice(300, 0, c).marginOnPricePct, 8);
});
