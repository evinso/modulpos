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

// ── supplier service fee (set on the XML source, paid per unit after the order is placed) ──
const { feeMapFor, feeSnapshotFor } = require('../../src/services/orderCosts');

test('the supplier fee is taken per unit and lowers the profit', () => {
  const base = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: costs(60), settings });
  const withFee = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: costs(60), fees: new Map([['160800001', { unit: 30, source: 'source' }]]), settings });
  assert.equal(base.supplierFee, 0); assert.equal(withFee.supplierFee, 30);
  assert.equal(withFee.profit, Math.round((base.profit - 30) * 100) / 100);
  assert.equal(withFee.lines[0].unitFee, 30);
});

test('quantity multiplies the supplier fee', () => {
  const items = JSON.stringify([{ quantity: 3, barcode: 'a', lineGrossAmount: 600, vatRate: 20, commission: 10 }]);
  const r = computeOrderProfit({ status: 'delivered', totalAmount: 600, items }, { costs: new Map([['a', { unit: 50, source: 'manual' }]]), fees: new Map([['a', { unit: 30, source: 'source' }]]), settings: { serviceFee: 0, cargoEstimate: 0 } });
  assert.equal(r.supplierFee, 90);
});

test('a product that is not from a fee-charging source pays nothing; the totals add the fee up', () => {
  const only = computeOrderProfit(realOrder(), { costs: costs(60), fees: new Map([['other', { unit: 30, source: 'source' }]]), settings });
  assert.equal(only.supplierFee, 0);
  const a = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: costs(60), fees: new Map([['160800001', { unit: 30, source: 'source' }]]), settings });
  const b = computeOrderProfit(realOrder(), { finance: { commissionAmount: 42, cargoAmount: 103.49 }, costs: costs(60), fees: new Map([['160800001', { unit: 30, source: 'source' }]]), settings });
  assert.equal(summarize([a, b]).supplierFee, 60);
});

test('fee per line: the fee of the XML source of the sold product; other sources and unknown products pay none', () => {
  const lines = [{ barcode: 'x1' }, { barcode: 'y1' }, { barcode: 'z1' }];
  const products = new Map([['x1', { xmlSourceId: 'biii' }], ['y1', { xmlSourceId: 'other' }]]);   // z1 is not a known product
  const feeBySource = new Map([['biii', 30]]);
  const m = feeMapFor(lines, { products, feeBySource });
  assert.deepEqual([...m.keys()], ['x1']); assert.deepEqual(m.get('x1'), { unit: 30, source: 'source' });
  assert.deepEqual(feeSnapshotFor(lines, products, feeBySource), { x1: 30 });
});

test('a saved fee snapshot wins over the source\'s current fee, also when it says "none"', () => {
  const lines = [{ barcode: 'x1' }];
  const products = new Map([['x1', { xmlSourceId: 'biii' }]]);
  const feeBySource = new Map([['biii', 45]]);   // raised later
  assert.deepEqual(feeMapFor(lines, { snapshot: { x1: 30 }, products, feeBySource }).get('x1'), { unit: 30, source: 'snapshot' });
  assert.equal(feeMapFor(lines, { snapshot: {}, products, feeBySource }).size, 0);                  // arrived when there was no fee
  assert.deepEqual(feeMapFor(lines, { snapshot: null, products, feeBySource }).get('x1'), { unit: 45, source: 'source' });   // no snapshot: current fee
});

// ---- tax model: recoverable VAT on costs + stopaj (same model as the price template) ----
const { taxOptions } = require('../../src/services/orderProfit');
const TAX = { serviceFee: 13.19, cargoEstimate: null, inputVat: true, purchaseVatRate: 20, withholdingPct: 1 };
const refOrder = () => ({ status: 'delivered', totalAmount: 586.9, items: JSON.stringify([{ quantity: 1, barcode: 'ref', lineGrossAmount: 586.9, lineSellerDiscount: 0, lineTyDiscount: 0, vatRate: 20, commission: 22 }]) });

test('the owner\'s reference sale: every figure of the profit screen, to the cent (586,90 -> net 114,77)', () => {
  const r = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12, cargoAmount: 106 }, costs: new Map([['ref', { unit: 195, source: 'manual' }]]), settings: TAX });
  assert.equal(r.commission, 129.12); assert.equal(r.serviceFee, 13.19); assert.equal(r.cargo, 106); assert.equal(r.cost, 195);
  assert.equal(r.stopaj, 4.89);
  assert.equal(r.payableVat, 23.93);
  assert.deepEqual(r.vatDetail, { sale: 97.82, purchase: 32.5, cargo: 17.67, commission: 21.52, serviceFee: 2.2, total: 23.93 });
  assert.equal(r.profit, 114.77);
  assert.equal(r.taxModel, true);
  assert.equal(Math.round((586.9 - 129.12 - 13.19 - 4.89 - 23.93 - 106 - 195) * 100) / 100, r.profit, 'the list adds up');
});

test('without the tax options the earlier method is unchanged (profit 45.77 for the same sale)', () => {
  const r = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12, cargoAmount: 106 }, costs: new Map([['ref', { unit: 195, source: 'manual' }]]), settings: { serviceFee: 13.19, cargoEstimate: null } });
  assert.equal(r.profit, 45.77);
  assert.equal(r.taxModel, false); assert.equal(r.stopaj, null); assert.equal(r.payableVat, null); assert.equal(r.vatDetail, null);
});

test('a non-VAT-payer: no VAT comes back (the VAT of the sale is paid in full), stopaj still applies', () => {
  const r = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12, cargoAmount: 106 }, costs: new Map([['ref', { unit: 195, source: 'manual' }]]), settings: { ...TAX, inputVat: false } });
  assert.equal(r.payableVat, 97.82);
  assert.equal(r.stopaj, 4.89);
  assert.equal(r.profit, 40.88);                 // 45.77 (earlier method) - 4.89 stopaj
});

test('a purchase without VAT credit (rate 0) only loses the purchase part of the credit', () => {
  const r = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12, cargoAmount: 106 }, costs: new Map([['ref', { unit: 195, source: 'manual' }]]), settings: { ...TAX, purchaseVatRate: 0 } });
  assert.equal(r.vatDetail.purchase, 0);
  assert.equal(r.profit, 82.27);                 // 114.77 - 32.50
});

test('the supplier\'s service fee gets no VAT credit', () => {
  const fees = new Map([['ref', { unit: 30, source: 'xml' }]]);
  const a = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12, cargoAmount: 106 }, costs: new Map([['ref', { unit: 195, source: 'manual' }]]), fees, settings: TAX });
  assert.equal(a.supplierFee, 30);
  assert.equal(a.profit, 84.77);                 // 114.77 - 30, the VAT to pay is unchanged
  assert.equal(a.payableVat, 23.93);
});

test('mixed VAT rates: VAT of each line and stopaj on the VAT-exclusive revenue', () => {
  const items = JSON.stringify([
    { quantity: 1, barcode: 'a', lineGrossAmount: 120, vatRate: 20, commission: 10 },
    { quantity: 1, barcode: 'b', lineGrossAmount: 110, vatRate: 10, commission: 10 },
  ]);
  const r = computeOrderProfit({ status: 'delivered', totalAmount: 230, items }, { finance: { commissionAmount: 23, cargoAmount: 60 }, costs: new Map([['a', { unit: 40, source: 'manual' }], ['b', { unit: 30, source: 'manual' }]]), settings: { serviceFee: 0, inputVat: true, purchaseVatRate: 20, withholdingPct: 1 } });
  assert.equal(r.netRevenue, 200);               // 100 + 100
  assert.equal(r.vat, 30);                       // 20 + 10
  assert.equal(r.stopaj, 2);
  // input VAT: purchase 70 * 1/6 = 11.67, cargo 60 / 6 = 10, commission 23 / 6 = 3.83 -> to pay 30 - 25.5 = 4.5
  assert.equal(r.vatDetail.purchase, 11.67); assert.equal(r.vatDetail.cargo, 10); assert.equal(r.vatDetail.commission, 3.83);
  assert.equal(r.payableVat, 4.5);
  assert.equal(r.profit, 230 - 23 - 60 - 70 - 2 - 4.5);
});

test('unknown cost or shipping: stopaj is known, VAT to pay and profit are not invented', () => {
  const r = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12 }, costs: new Map(), settings: TAX });
  assert.equal(r.profit, null); assert.equal(r.payableVat, null); assert.equal(r.vatDetail, null);
  assert.equal(r.stopaj, 4.89);
});

test('summary adds stopaj over all orders and VAT to pay over the orders whose profit is known', () => {
  const ok = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12, cargoAmount: 106 }, costs: new Map([['ref', { unit: 195, source: 'manual' }]]), settings: TAX });
  const unknown = computeOrderProfit(refOrder(), { finance: { commissionAmount: 129.12 }, costs: new Map(), settings: TAX });
  const s = summarize([ok, unknown]);
  assert.equal(s.stopaj, 9.78); assert.equal(s.payableVat, 23.93); assert.equal(s.profit, 114.77); assert.equal(s.taxModel, true);
});

test('taxOptions: off unless set; the purchase VAT defaults to 20', () => {
  assert.equal(taxOptions(undefined).active, false);
  assert.equal(taxOptions({ serviceFee: 13.19 }).active, false);
  assert.equal(taxOptions({ withholdingPct: 1 }).active, true);
  const t = taxOptions({ inputVat: true });
  assert.ok(Math.abs(t.kp - 1 / 6) < 1e-12 && Math.abs(t.ki - 1 / 6) < 1e-12);
});
