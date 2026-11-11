const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSettlements, syncConnectionFinance, SETTLEMENT_TYPES } = require('../../src/services/orderFinanceSync');

// Real shape of the statement for order 11799048738 (list price 2630.47, seller discount 744.96 -> the statement books 3 rows)
const sale = { orderNumber: '11799048738', transactionDate: 1794000000000, commissionRate: 19, commissionAmount: 499.79, sellerRevenue: 2130.68 };
const discount = { orderNumber: '11799048738', commissionAmount: 138.69, sellerRevenue: 606.27 };
const coupon = { orderNumber: '11799048738', commissionAmount: 2.85, sellerRevenue: 12.15 };

test('the real commission is Sale - Discount - Coupon (it is charged on the price after discounts)', () => {
  const m = new Map();
  parseSettlements([sale], { sign: 1, sale: true, into: m });
  parseSettlements([discount], { sign: -1, sale: false, into: m });
  parseSettlements([coupon], { sign: -1, sale: false, into: m });
  const o = m.get('11799048738');
  assert.equal(Math.round(o.commissionAmount * 100) / 100, 358.25);
  assert.equal(o.commissionRate, 19);
  assert.equal(o.hasSale, true);
});

test('cancellations of a discount or coupon add the commission back', () => {
  const m = new Map();
  parseSettlements([sale], { into: m });
  parseSettlements([discount], { sign: -1, sale: false, into: m });
  parseSettlements([discount], { sign: 1, sale: false, into: m });   // DiscountCancel
  assert.equal(Math.round(m.get('11799048738').commissionAmount * 100) / 100, 499.79);
});

test('a discount row alone (no Sale row seen) is not a settled order', () => {
  const m = new Map();
  parseSettlements([discount], { sign: -1, sale: false, into: m });
  assert.equal(m.get('11799048738').hasSale, false);
});

test('the statement types that are read', () => {
  assert.deepEqual(SETTLEMENT_TYPES, [['Sale', 1], ['Discount', -1], ['DiscountCancel', 1], ['Coupon', -1], ['CouponCancel', 1]]);
});

// ---- the whole sync with a fake database and a fake Trendyol ----
function fake({ failTypes = [], rows = {}, invoices = [], items = {} } = {}) {
  const saved = [];
  const db = {
    order: { findMany: async () => [{ id: 'o1', marketplaceOrderId: '11799048738', orderDate: new Date(Date.now() - 6 * 86400000), finance: null }] },
    orderFinance: { upsert: async (a) => { saved.push(a); return a; } },
  };
  const service = {
    sellerId: 1, baseUrl: 'https://x',
    requestWithRetry: async ({ url, params }) => {
      if (url.endsWith('/settlements')) {
        if (failTypes.includes(params.transactionType)) { const e = new Error('boom'); e.response = { status: 500 }; throw e; }
        return { data: { content: rows[params.transactionType] || [], totalPages: 1 } };
      }
      if (url.endsWith('/otherfinancials')) return { data: { content: invoices, totalPages: 1 } };
      const serial = url.split('/cargo-invoice/')[1].split('/')[0];
      return { data: { content: items[serial] || [], totalPages: 1 } };
    },
  };
  return { db, service, saved };
}

test('sync saves the netted commission', async () => {
  const f = fake({ rows: { Sale: [sale], Discount: [discount], Coupon: [coupon] } });
  const r = await syncConnectionFinance({ db: f.db, service: f.service, connection: { id: 'c' } });
  assert.equal(r.matchedCommission, 1);
  assert.equal(f.saved[0].create.commissionAmount, 358.25);
});

test('if a discount page cannot be read the commission is NOT saved (it would be too high), the cargo still is', async () => {
  const f = fake({
    failTypes: ['Discount'], rows: { Sale: [sale] },
    invoices: [{ id: 'INV1', transactionType: 'Kargo Fatura' }], items: { INV1: [{ orderNumber: '11799048738', amount: 103.49, desi: 1 }] },
  });
  const r = await syncConnectionFinance({ db: f.db, service: f.service, connection: { id: 'c' } });
  assert.ok(r.errors.some((e) => /Discount/.test(e)));
  assert.equal(r.matchedCommission, 0);
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].create.commissionAmount, undefined);
  assert.equal(f.saved[0].create.cargoAmount, 103.49);
});
