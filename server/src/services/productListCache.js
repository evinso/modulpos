/**
 * Short-lived cache for the evaluated product list (see routes/marketplaceList.js).
 * Anything that can change a product's readiness or price must call invalidate(storeId),
 * so the page never shows stale results right after e.g. a category was mapped.
 */
const cache = new Map();    // key -> { at, rows }
const versions = new Map(); // storeId -> number

function invalidate(storeId) {
  if (storeId) versions.set(storeId, (versions.get(storeId) || 0) + 1);
  else cache.clear();
}

const version = (storeId) => versions.get(storeId) || 0;

module.exports = { cache, invalidate, version };
