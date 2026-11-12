const prisma = require('../config/database');

/**
 * Product-level Trendyol categories (table ProductCategoryOverride).
 * A category chosen for one product wins over the category mapping of its XML category, because the XML category
 * is often too broad to map as a whole. The result has the same shape as a CategoryMapping row, so everything
 * that sends products (readiness, send routes) keeps working with `mapping.marketplaceCategoryId` / `.attributes`.
 */

const hasValues = (json) => {
  if (!json) return false;
  try {
    const o = JSON.parse(json);
    return Object.values(o || {}).some((v) => v && (v.valueId || (v.valueName && String(v.valueName).trim())));
  } catch { return false; }
};

/**
 * The attribute JSON without the entries that belong to ONE product (read from its title/description or chosen by the AI, marked `from`):
 * what is left may be shared with the other products of the category. null when nothing is left.
 */
function shareableJson(json) {
  if (!json) return null;
  let o;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const kept = {};
  for (const [id, v] of Object.entries(o)) if (v && !v.from) kept[id] = v;
  return Object.keys(kept).length ? JSON.stringify(kept) : null;
}

/**
 * @param overrides   ProductCategoryOverride rows of ONE connection
 * @param catMappings CategoryMapping rows of the same connection
 * @returns Map productId -> mapping-like { marketplaceCategoryId, marketplaceCategoryName, attributes, productLevel:true, source }
 *
 * Required attribute values (e.g. "Renk") belong to the Trendyol category, not to a product. A product without its own
 * values reuses, in this order: another product of the same connection with the same category that has values,
 * then a category mapping of that same Trendyol category. Values that belong to one product only (`from`: read from its text or chosen by the AI)
 * are never taken over by another product.
 */
function buildOverrideMappings(overrides, catMappings = []) {
  const byCat = new Map();   // categoryId -> attributes JSON
  for (const m of catMappings) {
    const k = String(m.marketplaceCategoryId);
    if (hasValues(m.attributes) && !byCat.has(k)) byCat.set(k, m.attributes);
  }
  const own = new Map();
  for (const o of overrides) {
    const k = String(o.marketplaceCategoryId);
    const shared = shareableJson(o.attributes);
    if (hasValues(shared)) own.set(k, shared); // a value typed for a product group beats a mapping's
  }
  const out = new Map();
  for (const o of overrides) {
    const k = String(o.marketplaceCategoryId);
    out.set(o.productId, {
      id: o.id,
      localCategory: null,
      marketplaceCategoryId: k,
      marketplaceCategoryName: o.marketplaceCategoryName || null,
      attributes: hasValues(o.attributes) ? o.attributes : (own.get(k) || byCat.get(k) || null),
      productLevel: true,
      source: o.source,
    });
  }
  return out;
}

async function loadOverrideMappings(connectionId, catMappings) {
  const [overrides, mappings] = await Promise.all([
    prisma.productCategoryOverride.findMany({ where: { connectionId } }),
    catMappings ? Promise.resolve(catMappings) : prisma.categoryMapping.findMany({ where: { connectionId } }),
  ]);
  return buildOverrideMappings(overrides, mappings);
}

module.exports = { buildOverrideMappings, loadOverrideMappings, hasValues, shareableJson };
