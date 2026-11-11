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
 * @param overrides   ProductCategoryOverride rows of ONE connection
 * @param catMappings CategoryMapping rows of the same connection
 * @returns Map productId -> mapping-like { marketplaceCategoryId, marketplaceCategoryName, attributes, productLevel:true, source }
 *
 * Required attribute values (e.g. "Renk") belong to the Trendyol category, not to a product. A product without its own
 * values reuses, in this order: another product of the same connection with the same category that has values,
 * then a category mapping of that same Trendyol category.
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
    if (hasValues(o.attributes)) own.set(k, o.attributes); // a value typed for a product group beats a mapping's
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

module.exports = { buildOverrideMappings, loadOverrideMappings, hasValues };
