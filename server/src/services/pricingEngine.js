const prisma = require('../config/database');

/**
 * Single source of truth for sale-price calculation.
 *
 * Rule kinds (PricingRule.applyTo):
 *   price_template  – new detailed template (this file documents its conditions below)
 *   price_range     – legacy "fiyat aralığı" rule, evaluated as a template
 *   marketplace_xml – legacy "bağlantı bazlı" rule: % or fixed on top of the product price
 *
 * price_template conditions (all optional unless noted):
 *   connectionId, xmlSourceId | xmlSourceIds[], categories[], brands[]   scope (empty = everything)
 *   minPurchasePrice, maxPurchasePrice                                    purchase price range
 *   shippingCost, packagingCost, extraCost                                fixed costs (TL)
 *   commissionPct, extraPct                                               % of sale price (marketplace commission, ads, ...)
 *   vatRate                                                               sale VAT % added on top (null/absent = the product's own VAT rate)
 *   profitMode: percent_of_purchase (default) | percent_of_cost | margin_on_price | fixed   (amount = rule.value)
 *   roundingMode: none (default) | ending | int ; roundingEnding: e.g. 0.9 / 0.99
 *   minPrice, maxPrice                                                    clamp
 *   shippingTiers: [{ upTo, cost }]   shipping that depends on the SALE price (marketplace "barem"): the first row whose
 *                                     upTo the price fits in; the last row has upTo = null ("and above"). Replaces shippingCost.
 *   profitTiers:   [{ upTo, value }]  profit that depends on the PURCHASE price; same shape, overrides rule.value.
 */

const KINDS = ['price_template', 'price_range', 'marketplace_xml'];

const num = (v, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const optNum = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null));
const round2 = (x) => Math.round(x * 100) / 100;

function parseConds(rule) {
  if (!rule.conditions) return {};
  try { return typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions; } catch { return {}; }
}

function categorySegments(category) {
  if (!category) return [];
  return String(category).split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function scopeSize(c) {
  return (c.connectionId ? 1 : 0) + ((c.xmlSourceId || (c.xmlSourceIds || []).length) ? 1 : 0)
    + ((c.categories || []).length ? 1 : 0) + ((c.brands || []).length ? 1 : 0);
}

const MAX_TIERS = 3;

/**
 * Validates tier rows coming from the UI. Returns { tiers, error }.
 * Rows: upTo ascending and > 0, only the last row may (and must) have upTo = null, value >= 0, at most MAX_TIERS rows.
 * An empty / missing list is valid (feature off).
 */
function validateTiers(raw, valueKey) {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return { tiers: [], error: null };
  if (!Array.isArray(raw)) return { tiers: [], error: 'Kademe listesi geçersiz' };
  if (raw.length > MAX_TIERS) return { tiers: [], error: `En fazla ${MAX_TIERS} kademe girilebilir` };
  const tiers = [];
  let prev = 0;
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || {};
    const v = optNum(row[valueKey]);
    if (v === null || v < 0) return { tiers: [], error: `${i + 1}. kademede tutar eksik ya da geçersiz` };
    const last = i === raw.length - 1;
    const up = optNum(row.upTo);
    if (last) {
      if (up !== null) return { tiers: [], error: 'Son kademe "üstü" olmalı (üst sınır boş bırakılmalı)' };
      tiers.push({ upTo: null, [valueKey]: v });
    } else {
      if (up === null || up <= prev) return { tiers: [], error: `${i + 1}. kademenin üst sınırı bir öncekinden büyük olmalı` };
      tiers.push({ upTo: up, [valueKey]: v });
      prev = up;
    }
  }
  if (tiers.length === 1) return { tiers: [], error: 'Kademe için en az 2 satır girin ya da tabloyu boş bırakın' };
  return { tiers, error: null };
}

/** Lenient version used while pricing: anything invalid simply switches the feature off. */
function activeTiers(raw, valueKey) {
  const { tiers, error } = validateTiers(raw, valueKey);
  return error ? [] : tiers;
}

/** Profit value for this purchase price (tier table if set, otherwise the rule's value). */
function pickProfitValue(P, value, c) {
  const tiers = activeTiers(c.profitTiers, 'value');
  if (!tiers.length) return { value: num(value), tier: null };
  const i = tiers.findIndex((t) => t.upTo === null || P <= t.upTo);
  return { value: tiers[i].value, tier: i + 1 };
}

/**
 * Pure calculation of a template price from a purchase price.
 * Returns null when the inputs cannot produce a valid price.
 */
function computeTemplatePrice(purchasePrice, value, c) {
  const r = resolveTemplate(purchasePrice, value, c);
  return r ? r.price : null;
}

/**
 * Same as computeTemplatePrice but also tells which shipping / profit tier was used.
 * Shipping that depends on the sale price is solved by trying each row: a row is valid when the price it produces
 * falls inside that row's range. (If rows get cheaper at higher prices and no row is consistent, the price is set just
 * above the boundary, which can only make the profit larger than planned, never smaller.)
 */
function resolveTemplate(purchasePrice, value, c) {
  const P = num(purchasePrice);
  if (!(P > 0)) return null;
  const profit = pickProfitValue(P, value, c);
  const tiers = activeTiers(c.shippingTiers, 'cost');
  if (!tiers.length) {
    const price = priceWith(P, profit.value, c);
    return price === null ? null : { price, shippingCost: num(c.shippingCost), shippingTier: null, profitValue: profit.value, profitTier: profit.tier };
  }
  let best = null;
  let lo = 0;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    let price = priceWith(P, profit.value, { ...c, shippingCost: t.cost });
    if (price === null) return null;
    const inside = (t.upTo === null || price <= t.upTo + 1e-9);
    if (inside) {
      if (price <= lo + 1e-9 && i > 0) price = round2(lo + 0.01); // cheaper row than the previous one: stay just above the boundary
      if (!best || price < best.price) best = { price, shippingCost: t.cost, shippingTier: i + 1, profitValue: profit.value, profitTier: profit.tier };
    }
    if (t.upTo !== null) lo = t.upTo;
  }
  return best;
}

function priceWith(P, value, c) {

  const cost = P + num(c.shippingCost) + num(c.packagingCost) + num(c.extraCost);
  const pct = num(c.commissionPct) + num(c.extraPct);
  const v = num(value);
  const mode = c.profitMode || 'percent_of_purchase';

  // commissionBasis 'gross' (used by the price-template screen): the marketplace commission is charged on the
  // VAT-inclusive sale price, like Trendyol does. Without it (older rules) it is charged on the VAT-exclusive price.
  if (c.commissionBasis === 'gross') {
    const v = num(c.vatRate) / 100;
    const share = 1 / (1 + v);                 // part of the gross price that is revenue (VAT is passed on to the state)
    const pc = pct / 100;
    let gross;
    if (mode === 'margin_on_price') {
      const denom = share * (1 - num(value) / 100) - pc;
      if (denom <= 0.02) return null;
      gross = cost / denom;
    } else {
      let profit;
      if (mode === 'percent_of_cost') profit = cost * (num(value) / 100);
      else if (mode === 'fixed') profit = num(value);
      else profit = P * (num(value) / 100);
      const denom = share - pc;
      if (denom <= 0.02) return null;
      gross = (cost + profit) / denom;
    }
    return finishPrice(gross, c);
  }

  let base;
  if (mode === 'margin_on_price') {
    const denom = 1 - (pct + v) / 100;
    if (denom <= 0.05) return null; // commission + margin would eat >= 95% of the price
    base = cost / denom;
  } else {
    let profit;
    if (mode === 'percent_of_cost') profit = cost * (v / 100);
    else if (mode === 'fixed') profit = v;
    else profit = P * (v / 100); // percent_of_purchase (legacy behaviour)
    const denom = 1 - pct / 100;
    if (denom <= 0.05) return null;
    base = (cost + profit) / denom;
  }

  return finishPrice(base * (1 + num(c.vatRate) / 100), c);
}

/** Min/max clamp and price-ending rounding shared by both formulas. */
function finishPrice(rawPrice, c) {
  let price = rawPrice;
  const minP = optNum(c.minPrice), maxP = optNum(c.maxPrice);
  if (minP !== null && price < minP) price = minP;
  if (maxP !== null && price > maxP) price = maxP;

  const rm = c.roundingMode || 'none';
  if (rm === 'int') {
    price = Math.ceil(price - 1e-9);
  } else if (rm === 'ending') {
    const e = num(c.roundingEnding, 0.9);
    if (e > 0 && e < 1) {
      let cand = Math.floor(price) + e;
      if (cand < price - 1e-9) cand += 1;
      price = cand;
    }
  }
  return round2(Math.max(0, price));
}

/** Does this rule apply to the product on this connection? */
function matches(rule, c, product, connectionId) {
  if (c.connectionId && c.connectionId !== connectionId) return false;
  const srcIds = c.xmlSourceIds && c.xmlSourceIds.length ? c.xmlSourceIds : (c.xmlSourceId ? [c.xmlSourceId] : []);
  if (srcIds.length && !srcIds.includes(product.xmlSourceId)) return false;

  if (c.categories && c.categories.length) {
    const wanted = new Set(c.categories.map((x) => String(x).trim().toLowerCase()));
    if (!categorySegments(product.category).some((seg) => wanted.has(seg))) return false;
  }
  if (c.brands && c.brands.length) {
    const wanted = new Set(c.brands.map((x) => String(x).trim().toLowerCase()));
    if (!wanted.has(String(product.brand || '').trim().toLowerCase())) return false;
  }
  if (rule.applyTo !== 'marketplace_xml') {
    const purchase = num(product.xmlPrice) || num(product.price);
    const min = optNum(c.minPurchasePrice), max = optNum(c.maxPurchasePrice);
    if (min !== null && purchase < min) return false;
    if (max !== null && purchase > max) return false;
  }
  return true;
}

class PricingContext {
  constructor(rules, connectionId) {
    this.connectionId = connectionId;
    this.rules = rules
      .filter((r) => r.isActive && KINDS.includes(r.applyTo))
      .map((r) => ({ rule: r, conds: parseConds(r) }))
      .filter(({ rule, conds }) => {
        if (rule.applyTo === 'marketplace_xml') return !!(conds.connectionId && conds.xmlSourceId);
        return true;
      })
      .sort((a, b) =>
        (a.rule.priority - b.rule.priority) ||
        (scopeSize(b.conds) - scopeSize(a.conds)) ||
        (new Date(a.rule.createdAt) - new Date(b.rule.createdAt)));
  }

  /**
   * Like priceFor(), but also explains how the price came about (for the product detail screen):
   * { price, ruleId, ruleName, kind: 'template'|'legacy', vatRate, breakdown|null } or null.
   */
  explainFor(product) {
    for (const { rule, conds } of this.rules) {
      if (!matches(rule, conds, product, this.connectionId)) continue;

      if (rule.applyTo === 'marketplace_xml') {
        let fp = num(product.price);
        if (rule.type === 'percentage') fp = fp * (1 + num(rule.value) / 100);
        else if (rule.type === 'fixed') fp = fp + num(rule.value);
        return { price: round2(Math.max(0, fp)), ruleId: rule.id, ruleName: rule.name, kind: 'legacy', vatRate: null, breakdown: null };
      }
      const purchase = num(product.xmlPrice) || num(product.price);
      const hasOwnVat = conds.vatRate !== null && conds.vatRate !== undefined && conds.vatRate !== '';
      const effective = hasOwnVat ? conds : { ...conds, vatRate: product.vatRate };
      const breakdown = explainTemplatePrice(purchase, rule.value, effective);
      if (breakdown) {
        return { price: breakdown.price, ruleId: rule.id, ruleName: rule.name, kind: 'template', vatRate: num(effective.vatRate), breakdown };
      }
    }
    return null;
  }

  /** Returns { price, ruleId, ruleName } or null when no rule matches / can price the product. */
  priceFor(product) {
    for (const { rule, conds } of this.rules) {
      if (!matches(rule, conds, product, this.connectionId)) continue;

      if (rule.applyTo === 'marketplace_xml') {
        let fp = num(product.price);
        if (rule.type === 'percentage') fp = fp * (1 + num(rule.value) / 100);
        else if (rule.type === 'fixed') fp = fp + num(rule.value);
        return { price: round2(Math.max(0, fp)), ruleId: rule.id, ruleName: rule.name };
      }

      const purchase = num(product.xmlPrice) || num(product.price);
      // Sale VAT: use the rule's own vatRate when set, otherwise the product's VAT (chosen when the XML source was added)
      const hasOwnVat = conds.vatRate !== null && conds.vatRate !== undefined && conds.vatRate !== '';
      const effective = hasOwnVat ? conds : { ...conds, vatRate: product.vatRate };
      const price = computeTemplatePrice(purchase, rule.value, effective);
      if (price !== null) return { price, ruleId: rule.id, ruleName: rule.name };
    }
    return null;
  }
}

async function loadPricingContext(storeId, connectionId) {
  const rules = await prisma.pricingRule.findMany({
    where: { storeId, isActive: true, applyTo: { in: KINDS } },
    orderBy: { priority: 'asc' },
  });
  return new PricingContext(rules, connectionId);
}

/** Step-by-step breakdown of a template price, for the calculator preview in the UI. */
function explainTemplatePrice(purchasePrice, value, c) {
  const r = resolveTemplate(purchasePrice, value, c);
  if (r === null) return null;
  const price = r.price;
  const P = num(purchasePrice);
  const fixedCosts = r.shippingCost + num(c.packagingCost) + num(c.extraCost);
  const cost = P + fixedCosts;
  const pct = num(c.commissionPct) + num(c.extraPct);
  const vat = num(c.vatRate);
  const exVat = price / (1 + vat / 100);
  const commission = c.commissionBasis === 'gross' ? price * pct / 100 : exVat * pct / 100;
  return {
    price,
    purchase: round2(P),
    fixedCosts: round2(fixedCosts),
    cost: round2(cost),
    commissionAmount: round2(commission),
    profit: round2(exVat - cost - commission),
    profitPct: P > 0 ? round2((exVat - cost - commission) / P * 100) : 0,
    vatAmount: round2(price - exVat),
    marginOnPricePct: price > 0 ? round2((exVat - cost - commission) / price * 100) : 0, // net profit as % of the sale price
    shippingCost: round2(r.shippingCost),
    shippingTier: r.shippingTier,            // 1-based row of the shipping table that was used (null = single amount)
    profitTier: r.profitTier,                // 1-based row of the profit table that was used (null = single value)
    profitValue: r.profitValue,
  };
}

/** A readable edge for a band boundary: 47.3 -> 50, 183 -> 200 (<100: nearest 10, <500: nearest 50, else nearest 100). */
function niceEdge(x) {
  const step = x < 100 ? 10 : x < 500 ? 50 : 100;
  return Math.max(step, Math.round(x / step) * step);
}

/**
 * Splits the purchase prices into up to `maxBands` bands of roughly equal product counts, with round boundaries.
 * Returns ascending upper edges (the last band is open-ended), [] when there is nothing to split.
 */
function autoBandEdges(prices, maxBands = 5) {
  const xs = prices.filter((x) => x > 0).sort((p, q) => p - q);
  if (xs.length < 2) return [];
  const edges = [];
  for (let i = 1; i < maxBands; i++) {
    const e = niceEdge(xs[Math.min(xs.length - 1, Math.floor((xs.length * i) / maxBands))]);
    if ((edges.length === 0 || e > edges[edges.length - 1]) && e < xs[xs.length - 1]) edges.push(e);
  }
  return edges;
}

/**
 * "How much will I earn?" – runs the template over the products it would apply to and sums the net profit.
 * Uses each product's own purchase price and sale VAT, exactly like real pricing does.
 * products: [{ id, title, xmlSourceId, category, brand, xmlPrice, price, vatRate }]
 * Besides the totals it returns `bands` (results per purchase-price band, boundaries chosen automatically from
 * the products themselves) and `losingSamples` (the worst money-losing products).
 */
function summarizeCoverage(products, value, conds) {
  const hasOwnVat = conds.vatRate !== null && conds.vatRate !== undefined && conds.vatRate !== '';
  let covered = 0, priced = 0, totalProfit = 0, totalRevenue = 0, totalPurchase = 0, minProfit = Infinity, maxProfit = -Infinity, losing = 0;
  const rows = [];
  for (const p of products) {
    if (!matches({ applyTo: 'price_template' }, conds, p, conds.connectionId || null)) continue;
    covered++;
    const purchase = num(p.xmlPrice) || num(p.price);
    const e = explainTemplatePrice(purchase, value, hasOwnVat ? conds : { ...conds, vatRate: p.vatRate });
    if (!e) continue;
    priced++;
    totalProfit += e.profit; totalRevenue += e.price; totalPurchase += e.purchase;
    if (e.profit < minProfit) minProfit = e.profit;
    if (e.profit > maxProfit) maxProfit = e.profit;
    if (e.profit < 0) losing++;
    rows.push({ id: p.id, title: p.title, purchase: e.purchase, price: e.price, profit: e.profit, tier: e.shippingTier });
  }

  const edges = autoBandEdges(rows.map((r) => r.purchase));
  const bands = [];
  const bounds = [0, ...edges, Infinity];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    const inBand = rows.filter((r) => r.purchase > lo - (i === 0 ? 1 : 0) && r.purchase <= hi && (i === 0 || r.purchase > lo));
    if (!inBand.length) continue;
    const sum = (k) => inBand.reduce((t, r) => t + r[k], 0);
    const tiers = {};
    for (const r of inBand) if (r.tier) tiers[r.tier] = (tiers[r.tier] || 0) + 1;
    const mainTier = Object.keys(tiers).sort((x, y) => tiers[y] - tiers[x])[0];
    bands.push({
      from: lo, to: hi === Infinity ? null : hi, count: inBand.length,
      avgPurchase: round2(sum('purchase') / inBand.length), avgPrice: round2(sum('price') / inBand.length),
      avgProfit: round2(sum('profit') / inBand.length),
      marginOnPricePct: sum('price') > 0 ? round2(sum('profit') / sum('price') * 100) : 0,
      shippingTier: mainTier ? Number(mainTier) : null,
      mixedTiers: Object.keys(tiers).length > 1,
      losing: inBand.filter((r) => r.profit < 0).length,
    });
  }
  const losingSamples = rows.filter((r) => r.profit < 0).sort((x, y) => x.profit - y.profit).slice(0, 20)
    .map((r) => ({ id: r.id, title: r.title, purchase: round2(r.purchase), price: r.price, profit: r.profit }));

  return {
    covered, priced, unpriced: covered - priced, losing,
    totalProfit: round2(totalProfit),
    avgProfit: priced ? round2(totalProfit / priced) : 0,
    avgPrice: priced ? round2(totalRevenue / priced) : 0,
    avgPurchase: priced ? round2(totalPurchase / priced) : 0,
    minProfit: priced ? round2(minProfit) : 0,
    maxProfit: priced ? round2(maxProfit) : 0,
    marginOnPricePct: totalRevenue > 0 ? round2(totalProfit / totalRevenue * 100) : 0,
    bands, losingSamples,
  };
}

module.exports = { autoBandEdges, PricingContext, loadPricingContext, computeTemplatePrice, resolveTemplate, validateTiers, MAX_TIERS, explainTemplatePrice, summarizeCoverage, matchesConds: matches, parseConds };
