// Profit of a marketplace order, from the order's own lines plus (when known) what Trendyol really charged.
// Pure: no database, no network. The method is the same as the price template's ("kâr"): the VAT-exclusive revenue minus
// commission, fees, shipping and the purchase cost (the template subtracts those amounts as they are charged, too).
//
//   revenue (KDV dahil)  = gross - seller discount          (Trendyol's own discount is paid back to the seller)
//   customer paid        = gross - seller discount - Trendyol discount
//   net revenue          = revenue / (1 + VAT)
//   profit               = net revenue - commission - platform fee - supplier service fee - shipping - purchase cost
//   supplier service fee = what the supplier (XML source) charges per unit after the order is placed, set on the XML source

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const has = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

const EXCLUDED = new Set(['cancelled', 'returned']);

function parseLines(items) {
  if (!items) return [];
  try { const v = typeof items === 'string' ? JSON.parse(items) : items; return Array.isArray(v) ? v : []; } catch { return []; }
}

/** The money of one order line (line totals, as Trendyol sends them). */
function lineFigures(line) {
  const qty = Math.max(1, num(line.quantity) || 1);
  const gross = has(line.lineGrossAmount) ? num(line.lineGrossAmount) : (has(line.amount) ? num(line.amount) : num(line.price) * qty);
  let sellerDisc = has(line.lineSellerDiscount) ? num(line.lineSellerDiscount) : num(line.discount);
  const tyDisc = has(line.lineTyDiscount) ? num(line.lineTyDiscount) : num(line.tyDiscount);
  // only a total is given: it is the seller's own discount
  if (sellerDisc === 0 && tyDisc === 0 && num(line.lineTotalDiscount) > 0) sellerDisc = num(line.lineTotalDiscount);
  const revenue = gross - sellerDisc;
  const vatRate = has(line.vatRate) ? num(line.vatRate) : (has(line.vatBaseAmount) ? num(line.vatBaseAmount) : 20);
  return {
    name: line.productName || line.stockCode || line.barcode || '',
    barcode: line.barcode || line.merchantSku || line.stockCode || '',
    sku: line.merchantSku || line.stockCode || null,
    qty, gross, sellerDisc, tyDisc, revenue, paid: revenue - tyDisc,
    vatRate, commissionRate: num(line.commission),
  };
}

/**
 * costs: Map barcode -> { unit, source }   (source: 'snapshot' | 'product' | 'manual')
 * finance: { commissionAmount, cargoAmount, ... } from Trendyol, or null
 * fees: Map barcode -> { unit, source }  supplier service fee per unit (XML source setting); missing = no fee
 * settings: { serviceFee, cargoEstimate }  (cargoEstimate may be null = unknown)
 */
function computeOrderProfit(order, { finance = null, costs = new Map(), fees = new Map(), settings = {} } = {}) {
  const lines = parseLines(order.items).map(lineFigures);
  const sum = (f) => lines.reduce((a, l) => a + f(l), 0);

  const gross = sum((l) => l.gross);
  const sellerDisc = sum((l) => l.sellerDisc);
  const tyDisc = sum((l) => l.tyDisc);
  const revenue = sum((l) => l.revenue);
  const paid = sum((l) => l.paid);
  const netRevenue = sum((l) => l.revenue / (1 + l.vatRate / 100));
  const vat = revenue - netRevenue;

  const estCommission = sum((l) => l.revenue * l.commissionRate / 100);
  const commissionReal = finance && has(finance.commissionAmount);
  const commission = commissionReal ? num(finance.commissionAmount) : estCommission;

  const serviceFee = has(settings.serviceFee) ? num(settings.serviceFee) : 0;

  const cargoReal = finance && has(finance.cargoAmount);
  const cargo = cargoReal ? num(finance.cargoAmount) : (has(settings.cargoEstimate) ? num(settings.cargoEstimate) : null);

  let cost = 0; let costMissing = lines.length === 0; let supplierFee = 0;
  const lineRows = lines.map((l) => {
    const f = fees.get(l.barcode) || (l.sku ? fees.get(l.sku) : undefined);
    const unitFee = f && f.unit > 0 ? f.unit : 0;
    supplierFee += unitFee * l.qty;
    const c = costs.get(l.barcode) || (l.sku ? costs.get(l.sku) : undefined);
    if (!c || !(c.unit > 0)) { costMissing = true; return { ...l, unitCost: null, costSource: null, unitFee }; }
    cost += c.unit * l.qty;
    return { ...l, unitCost: c.unit, costSource: c.source, unitFee };
  });

  const excluded = EXCLUDED.has(order.status);
  const complete = !costMissing && cargo !== null;
  const profit = complete ? netRevenue - commission - serviceFee - supplierFee - cargo - cost : null;

  return {
    excluded,
    lines: lineRows.map((l) => ({ ...l, gross: round2(l.gross), sellerDisc: round2(l.sellerDisc), tyDisc: round2(l.tyDisc), revenue: round2(l.revenue), paid: round2(l.paid) })),
    gross: round2(gross), sellerDiscount: round2(sellerDisc), tyDiscount: round2(tyDisc),
    discounted: round2(revenue), customerPaid: round2(paid),
    vat: round2(vat), netRevenue: round2(netRevenue),
    commission: round2(commission), commissionSource: commissionReal ? 'trendyol' : 'estimate',
    commissionRate: lines.length ? round2(lines.reduce((a, l) => a + l.commissionRate * l.revenue, 0) / (revenue || 1)) : 0,
    serviceFee: round2(serviceFee), serviceFeeSource: 'estimate',
    supplierFee: round2(supplierFee),
    cargo: cargo === null ? null : round2(cargo), cargoSource: cargoReal ? 'trendyol' : (cargo === null ? null : 'estimate'),
    cost: costMissing ? null : round2(cost), costMissing,
    profit: profit === null ? null : round2(profit),
    profitPct: profit !== null && netRevenue > 0 ? round2(profit / netRevenue * 100) : null,
    exact: !!(commissionReal && cargoReal && !costMissing),
    mismatch: Math.abs(paid - num(order.totalAmount)) > 0.05 && num(order.totalAmount) > 0,
  };
}

/** Totals over rows from computeOrderProfit (cancelled / returned orders are left out). */
function summarize(results) {
  const live = results.filter((r) => !r.excluded);
  const add = (f) => round2(live.reduce((a, r) => a + (f(r) || 0), 0));
  const withProfit = live.filter((r) => r.profit !== null);
  return {
    orders: live.length, excluded: results.length - live.length,
    gross: add((r) => r.gross), discounted: add((r) => r.discounted), customerPaid: add((r) => r.customerPaid),
    commission: add((r) => r.commission), serviceFee: add((r) => r.serviceFee), supplierFee: add((r) => r.supplierFee), cargo: add((r) => r.cargo),
    cost: add((r) => r.cost), vat: add((r) => r.vat),
    profit: add((r) => r.profit),
    profitOrders: withProfit.length,
    unknownProfit: live.length - withProfit.length,
    estimated: live.filter((r) => !r.exact).length,
  };
}

module.exports = { computeOrderProfit, summarize, lineFigures, parseLines, EXCLUDED };
