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

/**
 * Pure calculation of a template price from a purchase price.
 * Returns null when the inputs cannot produce a valid price.
 */
function computeTemplatePrice(purchasePrice, value, c) {
  const P = num(purchasePrice);
  if (!(P > 0)) return null;

  const cost = P + num(c.shippingCost) + num(c.packagingCost) + num(c.extraCost);
  const pct = num(c.commissionPct) + num(c.extraPct);
  const v = num(value);
  const mode = c.profitMode || 'percent_of_purchase';

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

  let price = base * (1 + num(c.vatRate) / 100);

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
  const price = computeTemplatePrice(purchasePrice, value, c);
  if (price === null) return null;
  const P = num(purchasePrice);
  const fixedCosts = num(c.shippingCost) + num(c.packagingCost) + num(c.extraCost);
  const cost = P + fixedCosts;
  const pct = num(c.commissionPct) + num(c.extraPct);
  const vat = num(c.vatRate);
  const grossBeforeClamp = price / (1 + vat / 100);
  return {
    price,
    purchase: round2(P),
    fixedCosts: round2(fixedCosts),
    cost: round2(cost),
    commissionAmount: round2(grossBeforeClamp * pct / 100),
    profit: round2(grossBeforeClamp - cost - grossBeforeClamp * pct / 100),
    vatAmount: round2(price - grossBeforeClamp),
  };
}

module.exports = { PricingContext, loadPricingContext, computeTemplatePrice, explainTemplatePrice, matchesConds: matches, parseConds };
