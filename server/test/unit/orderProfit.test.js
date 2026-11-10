const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOrderProfit, summarize } = require('../../src/services/orderProfit');
const { windows, parseSettlements, parseCargoItems } = require('../../src/services/orderFinanceSync');
const { costMapFor, snapshotFor } = require('../../src/services/orderCosts');

// Two real, delivered orders of the store: what Trendyol reported (sale, commission) and invoiced (shipping)
const realOrder = (o = {}) => ({ status: 'delivered', totalAmount: 200, items: JSON.stringify([{ quantity: 1, barcode: '160800001', lineGrossAmount: 200, lineTotalDiscount: 0, lineSellerDiscount: 0, lineTyDiscount: 0, vatRate: 20, commission: 21, productName: 'Ürün' }]), ...o });
const costs = (unit) => new Map([['160800001', { unit, source: 'manual' }]]);
const settings = { serviceFee: 13.19, cargoEstimate: 95.99 };

test('real settled order: commission 42 (21% of 200) and cargo 103.49 come from Trendyol', () => {
  const r = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: costs(60), settings });
  assert.equal(r.gross, 200); assert.equal(r.customerPaid, 200);
  assert.equal(r.commission, 42); assert.equal(r.commissionSource, 'trendyol');
  assert.equal(r.cargo, 103.49); assert.equal(r.cargoSource, 'trendyol');
  assert.equal(r.serviceFee, 13.19);
  // 200 / 1.2 = 166.67 net - 42 - 13.19 - 103.49 - 60 = -52.01
  assert.equal(r.netRevenue, 166.67); assert.equal(r.profit, -52.01); assert.equal(r.exact, true);
});

test('without Trendyol figures the commission comes from the line rate and shipping from the estimate', () => {
  const r = computeOrderProfit(realOrder(), { finance: null, costs: costs(60), settings });
  assert.equal(r.commission, 42); assert.equal(r.commissionSource, 'estimate');
  assert.equal(r.cargo, 95.99); assert.equal(r.cargoSource, 'estimate'); assert.equal(r.exact, false);
});

test('a seller discount lowers the price the commission is charged on; the sale price column keeps the list price', () => {
  const items = JSON.stringify([{ quantity: 1, barcode: 'b', lineGrossAmount: 938.1, lineTotalDiscount: 56.34, lineSellerDiscount: 56.34, lineTyDiscount: 0, price: 881.76, vatRate: 20, commission: 16 }]);
  const r = computeOrderProfit({ status: 'processing', totalAmount: 881.76, items }, { costs: new Map([['b', { unit: 300, source: 'snapshot' }]]), settings });
  assert.equal(r.gross, 938.1); assert.equal(r.discounted, 881.76); assert.equal(r.customerPaid, 881.76);
  assert.equal(r.commission, 141.08);          // 881.76 * 16%
  assert.equal(r.mismatch, false);
});

test('a Trendyol-funded discount: the customer pays less, the seller still gets the price after the seller discount', () => {
  const items = JSON.stringify([{ quantity: 1, barcode: 'b', lineGrossAmount: 1000, lineSellerDiscount: 100, lineTyDiscount: 50, vatRate: 20, commission: 10 }]);
  const r = computeOrderProfit({ status: 'delivered', totalAmount: 850, items }, { costs: new Map([['b', { unit: 500, source: 'manual' }]]), settings: { serviceFee: 0, cargoEstimate: 0 } });
  assert.equal(r.discounted, 900); assert.equal(r.customerPaid, 850);
  assert.equal(r.commission, 90);
  assert.equal(r.profit, 160);                  // 900/1.2 = 750 - 90 - 0 - 0 - 500
});

test('no cost for an item: no profit is invented', () => {
  const r = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: new Map(), settings });
  assert.equal(r.costMissing, true); assert.equal(r.cost, null); assert.equal(r.profit, null); assert.equal(r.exact, false);
});

test('unknown shipping (no estimate, no invoice) also leaves the profit open', () => {
  const r = computeOrderProfit(realOrder(), { finance: null, costs: costs(60), settings: { serviceFee: 13.19, cargoEstimate: null } });
  assert.equal(r.cargo, null); assert.equal(r.profit, null);
});

test('quantity multiplies the cost; two lines add up', () => {
  const items = JSON.stringify([
    { quantity: 2, barcode: 'a', lineGrossAmount: 240, vatRate: 20, commission: 10 },
    { quantity: 1, barcode: 'b', lineGrossAmount: 120, vatRate: 20, commission: 20 },
  ]);
  const r = computeOrderProfit({ status: 'delivered', totalAmount: 360, items }, { costs: new Map([['a', { unit: 40, source: 'manual' }], ['b', { unit: 30, source: 'manual' }]]), settings: { serviceFee: 0, cargoEstimate: 0 } });
  assert.equal(r.cost, 110); assert.equal(r.commission, 48);   // 24 + 24
  assert.equal(r.profit, 142);                                   // 360/1.2 = 300 - 48 - 110
});

test('cancelled / returned orders are listed but left out of the totals', () => {
  const ok = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: costs(60), settings });
  const gone = computeOrderProfit(realOrder({ status: 'cancelled' }), { finance: null, costs: costs(60), settings });
  const s = summarize([ok, gone]);
  assert.equal(s.orders, 1); assert.equal(s.excluded, 1); assert.equal(s.customerPaid, 200); assert.equal(s.profit, -52.01);
});

test('summary counts what is estimated or unknown', () => {
  const exact = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: costs(60), settings });
  const est = computeOrderProfit(realOrder(), { finance: null, costs: costs(60), settings });
  const unknown = computeOrderProfit(realOrder(), { finance: null, costs: new Map(), settings });
  const s = summarize([exact, est, unknown]);
  assert.equal(s.orders, 3); assert.equal(s.profitOrders, 2); assert.equal(s.unknownProfit, 1); assert.equal(s.estimated, 2);
});

test('windows: 15-day pieces covering the range, newest first, never longer than 15 days', () => {
  const day = 86400000; const to = 100 * day; const from = to - 40 * day;
  const w = windows(from, to);
  assert.equal(w.length, 3); assert.equal(w[0][1], to); assert.equal(w[w.length - 1][0], from);
  assert.ok(w.every(([a, b]) => b - a <= 15 * day && b > a));
});

test('settlement rows are summed per order number', () => {
  const m = parseSettlements([
    { orderNumber: 11663533487, commissionAmount: 42, commissionRate: 21, sellerRevenue: 158, transactionDate: 1759300000000 },
    { orderNumber: '11255808882', commissionAmount: 56.93, commissionRate: 22.5, sellerRevenue: 196.07 },
    { orderNumber: '11663533487', commissionAmount: 8, sellerRevenue: 10 },
    { commissionAmount: 5 },
  ]);
  assert.equal(m.size, 2); assert.equal(m.get('11663533487').commissionAmount, 50); assert.equal(m.get('11255808882').commissionRate, 22.5);
});

test('cargo items are summed per order number (a return fee joins its order)', () => {
  const m = parseCargoItems([
    { shipmentPackageType: 'Gönderi Kargo Bedeli', orderNumber: '11663533487', amount: 103.49, desi: 1 },
    { shipmentPackageType: 'İade Kargo Bedeli', orderNumber: '11663533487', amount: 50, desi: 1 },
    { orderNumber: '11255808882', amount: 88.49, desi: 1 },
  ]);
  assert.equal(m.get('11663533487').amount, 153.49); assert.equal(m.get('11255808882').amount, 88.49);
});

test('costs: manual beats the snapshot, which beats today\'s product; the snapshot keeps the old cost', () => {
  const lines = [{ barcode: 'x', merchantSku: 'sku-x' }];
  const products = new Map([['x', { barcode: 'x', xmlPrice: 90, price: 120 }]]);
  assert.equal(costMapFor(lines, { manual: { x: 70 }, snapshot: { x: 80 }, products }).get('x').source, 'manual');
  assert.deepEqual(costMapFor(lines, { snapshot: { x: 80 }, products }).get('x'), { unit: 80, source: 'snapshot' });
  assert.deepEqual(costMapFor(lines, { products }).get('x'), { unit: 90, source: 'product' });
  assert.equal(costMapFor(lines, {}).size, 0);
  assert.deepEqual(snapshotFor(lines, products), { x: 90 });
  assert.equal(snapshotFor([{ barcode: 'nope' }], products), null);
});
