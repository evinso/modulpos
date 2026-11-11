// Reads what Trendyol really charged for delivered orders: commission from the current account statement ("Sale" rows,
// matched by order number) and shipping from the cargo invoices ("Kargo Fatura" -> its items, matched by order number).
// Both appear some days after delivery; orders not settled yet are simply tried again next time.
// Read-only towards Trendyol. Writes only OrderFinance rows (derived data), never touches orders or products.

const DAY = 86400000;
const WINDOW_DAYS = 15;          // the statement allows at most 15 days per request
const MAX_DAYS = 365;            // how far back one run looks
const PAGE = 500;                // the finance API only accepts size 500 or 1000

/** [startMs, endMs] pairs of at most 15 days covering [fromMs, toMs], newest first. */
function windows(fromMs, toMs, days = WINDOW_DAYS) {
  const out = [];
  for (let end = toMs; end > fromMs; end -= days * DAY) out.push([Math.max(fromMs, end - days * DAY), end]);
  return out;
}

// The statement books an order in several rows. The commission of the "Sale" row is charged on the LIST price; a seller discount ("Discount")
// or coupon ("Coupon") gives the commission of the discounted part back, so the real commission is Sale - Discount - Coupon (+ their cancellations).
// Checked on real orders: 499,79 - 138,69 - 2,85 = 358,25 = commission rate x the price after discounts.
const SETTLEMENT_TYPES = [['Sale', 1], ['Discount', -1], ['DiscountCancel', 1], ['Coupon', -1], ['CouponCancel', 1]];

/**
 * Statement rows -> Map orderNumber -> { commissionAmount, commissionRate, sellerRevenue, settledAt, hasSale } (summed over the order's rows).
 * `sign` = +1 for rows that add commission (Sale, cancellations), -1 for rows that give it back (Discount, Coupon); `sale` marks the Sale rows.
 */
function parseSettlements(rows, { sign = 1, sale = true, into = new Map() } = {}) {
  const out = into;
  for (const r of rows || []) {
    if (!r || !r.orderNumber) continue;
    const key = String(r.orderNumber);
    const cur = out.get(key) || { commissionAmount: 0, commissionRate: null, sellerRevenue: 0, settledAt: null, hasSale: false };
    cur.commissionAmount += sign * (Number(r.commissionAmount) || 0);
    cur.sellerRevenue += sign * (Number(r.sellerRevenue) || 0);
    if (sale) {
      cur.hasSale = true;
      if (r.commissionRate != null) cur.commissionRate = Number(r.commissionRate);
      if (r.transactionDate) cur.settledAt = new Date(Number(r.transactionDate));
    }
    out.set(key, cur);
  }
  return out;
}

/** Cargo invoice items -> Map orderNumber -> { amount, desi } (a returned parcel's fee is added to the same order). */
function parseCargoItems(items, into = new Map()) {
  for (const x of items || []) {
    if (!x || !x.orderNumber) continue;
    const key = String(x.orderNumber);
    const cur = into.get(key) || { amount: 0, desi: null };
    cur.amount += Number(x.amount) || 0;
    if (x.desi != null && cur.desi === null) cur.desi = Number(x.desi);
    into.set(key, cur);
  }
  return into;
}

const money = (n) => Math.round(n * 100) / 100;

async function fetchAll(service, path, params) {
  const rows = [];
  for (let page = 0; page < 20; page++) {
    const r = await service.requestWithRetry({ method: 'get', url: `${service.baseUrl}/finance/che/sellers/${service.sellerId}/${path}`, params: { ...params, page, size: PAGE } });
    const d = r.data || {};
    rows.push(...(d.content || []));
    if (page + 1 >= (d.totalPages || 1)) break;
  }
  return rows;
}

/**
 * One Trendyol connection. `db` = prisma, `service` = a TrendyolService, `now` injectable.
 * dryRun: compute and return the matches without saving anything.
 * Returns { pending, matchedCommission, matchedCargo, saved, windows, errors, preview }
 */
async function syncConnectionFinance({ db, service, connection, dryRun = false, now = Date.now() }) {
  const pending = await db.order.findMany({
    where: { connectionId: connection.id, marketplaceOrderId: { not: null }, status: { in: ['delivered', 'shipped', 'returned'] }, orderDate: { gt: new Date(now - MAX_DAYS * DAY) } },
    select: { id: true, marketplaceOrderId: true, orderDate: true, finance: { select: { commissionAmount: true, cargoAmount: true } } },
  });
  const todo = pending.filter((o) => !o.finance || o.finance.commissionAmount == null || o.finance.cargoAmount == null);
  const result = { pending: todo.length, matchedCommission: 0, matchedCargo: 0, saved: 0, windows: 0, errors: [], preview: [] };
  if (todo.length === 0) return result;

  const from = Math.min(...todo.map((o) => new Date(o.orderDate).getTime()));
  const ws = windows(from, now);
  result.windows = ws.length;

  const settlements = new Map();
  const cargo = new Map();
  let commissionComplete = true;   // a missing Discount/Coupon page would leave the commission too high: then it is not saved this time
  for (const [start, end] of ws) {
    for (const [type, sign] of SETTLEMENT_TYPES) {
      try {
        parseSettlements(await fetchAll(service, 'settlements', { transactionType: type, startDate: start, endDate: end }), { sign, sale: type === 'Sale', into: settlements });
      } catch (e) {
        commissionComplete = false;
        result.errors.push(`Komisyon ${type} (${new Date(start).toISOString().slice(0, 10)}): ${e.response ? e.response.status : e.message}`);
      }
    }
    try {
      const invoices = (await fetchAll(service, 'otherfinancials', { transactionType: 'DeductionInvoices', startDate: start, endDate: end }))
        .filter((r) => /kargo/i.test(r.transactionType || '') && r.id);
      for (const inv of invoices) {
        try {
          parseCargoItems(await fetchItems(service, inv.id), cargo);
        } catch (e) { result.errors.push(`Kargo faturası ${inv.id}: ${e.response ? e.response.status : e.message}`); }
      }
    } catch (e) { result.errors.push(`Kargo (${new Date(start).toISOString().slice(0, 10)}): ${e.response ? e.response.status : e.message}`); }
  }

  for (const o of todo) {
    const key = String(o.marketplaceOrderId);
    const s0 = settlements.get(key); const c = cargo.get(key);
    const s = s0 && s0.hasSale && commissionComplete ? s0 : null;
    if (!s && !c) continue;
    const data = {};
    if (s) { data.commissionAmount = money(s.commissionAmount); data.commissionRate = s.commissionRate; data.sellerRevenue = money(s.sellerRevenue); data.settledAt = s.settledAt; result.matchedCommission++; }
    if (c) { data.cargoAmount = money(c.amount); data.cargoDesi = c.desi; result.matchedCargo++; }
    if (dryRun) { result.preview.push({ order: key, ...data }); continue; }
    await db.orderFinance.upsert({ where: { orderId: o.id }, create: { orderId: o.id, ...data }, update: { ...data, fetchedAt: new Date() } });
    result.saved++;
  }
  return result;
}

async function fetchItems(service, serial) {
  const items = [];
  for (let page = 0; page < 20; page++) {
    const r = await service.requestWithRetry({ method: 'get', url: `${service.baseUrl}/finance/che/sellers/${service.sellerId}/cargo-invoice/${serial}/items`, params: { page, size: PAGE } });
    const d = r.data || {};
    items.push(...(d.content || []));
    if (page + 1 >= (d.totalPages || 1)) break;
  }
  return items;
}

/** All active Trendyol connections of a store. Never throws: problems are collected in `errors`. */
async function syncStoreFinance(storeId, { db = require('../config/database'), TrendyolService = require('./trendyol/trendyolService'), dryRun = false } = {}) {
  const total = { pending: 0, matchedCommission: 0, matchedCargo: 0, saved: 0, errors: [], preview: [] };
  const connections = await db.marketplaceConnection.findMany({ where: { storeId, marketplaceType: 'trendyol', status: 'active' } });
  for (const connection of connections) {
    try {
      const r = await syncConnectionFinance({ db, service: new TrendyolService(connection), connection, dryRun });
      for (const k of ['pending', 'matchedCommission', 'matchedCargo', 'saved']) total[k] += r[k];
      total.errors.push(...r.errors); total.preview.push(...r.preview);
    } catch (e) { total.errors.push(e.message); }
  }
  return total;
}

module.exports = { SETTLEMENT_TYPES, windows, parseSettlements, parseCargoItems, syncConnectionFinance, syncStoreFinance };
