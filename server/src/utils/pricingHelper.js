function matchPriceRangeRule(xmlPrice, rules) {
  for (const r of rules) {
    if (!r.isActive || !r.conditions) continue;
    let conds;
    try { conds = JSON.parse(r.conditions); } catch { continue; }
    const min = conds.minPurchasePrice ?? null;
    const max = conds.maxPurchasePrice ?? null;
    if (min === null && max === null) continue;
    if (min !== null && xmlPrice < min) continue;
    if (max !== null && xmlPrice > max) continue;
    return { rule: r, conds };
  }
  return null;
}

function calcPriceRangePrice(xmlPrice, rule, conds) {
  const shipping = parseFloat(conds.shippingCost) || 0;
  const commission = parseFloat(conds.commissionPct) || 0;
  const vat = parseFloat(conds.vatRate) || 0;
  const totalCost = xmlPrice + shipping;
  const profitTarget = xmlPrice * (rule.value / 100);
  const factor = commission > 0 ? 1 - commission / 100 : 1;
  return Math.round(Math.max(0, (totalCost + profitTarget) / factor * (1 + vat / 100)) * 100) / 100;
}

module.exports = { matchPriceRangeRule, calcPriceRangePrice };
