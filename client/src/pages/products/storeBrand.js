/**
 * The brand set in the Trendyol store's settings (page "Pazaryeri": "Kendi markam" or the fallback brand of "XML markası").
 * It lives in the connection's config JSON: defaultBrandId / defaultBrandName / brandStrategy.
 *   override ("Kendi markam"): EVERY product is sent with this brand, whatever the product says (server: resolveProductBrandId)
 *   xml: the product's own brand is looked up first, this one is the fallback
 * @returns { name, id, strategy: 'override' | 'xml' } or null when the connection is not Trendyol or has no brand set
 */
export function storeBrandOf(connection) {
  if (!connection || connection.marketplaceType !== 'trendyol' || !connection.config) return null;
  let c = connection.config;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { return null; } }
  const name = c && typeof c.defaultBrandName === 'string' ? c.defaultBrandName.trim() : '';
  if (!name) return null;
  return { name, id: c.defaultBrandId != null ? String(c.defaultBrandId) : '', strategy: c.brandStrategy === 'override' ? 'override' : 'xml' };
}
