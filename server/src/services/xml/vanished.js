/**
 * Products that have disappeared from their XML feed.
 *
 * Their stock is set to 0 so they cannot be sold; the automatic marketplace update (cron) then shows them as out of stock
 * on the marketplace. Nothing else about the product changes, and they come back by themselves: a product that is in the
 * feed again gets its stock written by the normal sync and the next automatic update pushes it.
 *
 * Because the effect of a wrong decision is a shop that stops selling, a feed that looks broken is never acted on:
 *   - empty feed                       -> nothing is zeroed
 *   - rows of the feed that failed     -> nothing is zeroed (we cannot tell what is really missing)
 *   - a large part of the live catalog -> nothing is zeroed (wrong URL, changed SKU mapping, cut-off download)
 * In those cases the sync says so in its notification.
 */

// SKU made up from the title when the feed has neither an id nor a barcode: a renamed product looks like a vanished one
const DERIVED_SKU = /^xml-[0-9a-f]{12}$/;

const HELD_ABOVE_COUNT = 25;   // up to this many vanished products are always processed
const HELD_ABOVE_SHARE = 0.3;  // more than this share of the live catalog (and more than the count above) is held back

/**
 * @param existingRows rows stored for the source ({ id, sku, stock })
 * @param seen         Set of SKUs found in the feed
 * @param feedSize     number of products the feed contained
 * @param feedErrors   number of feed rows that could not be processed
 * @returns { zero: rows to set to 0, held: number held back, reason: null | 'empty' | 'errors' | 'too_many' }
 */
function planVanished(existingRows, seen, feedSize, feedErrors = 0) {
  let present = 0;
  const inStock = [];
  for (const r of existingRows) {
    if (seen.has(r.sku)) { present++; continue; }
    if (DERIVED_SKU.test(r.sku)) continue;
    if ((Number(r.stock) || 0) > 0) inStock.push(r);
  }
  if (inStock.length === 0) return { zero: [], held: 0, reason: null };
  if (!feedSize) return { zero: [], held: inStock.length, reason: 'empty' };
  if (feedErrors > 0) return { zero: [], held: inStock.length, reason: 'errors' };

  const live = present + inStock.length;
  if (inStock.length > HELD_ABOVE_COUNT && inStock.length > live * HELD_ABOVE_SHARE) {
    return { zero: [], held: inStock.length, reason: 'too_many' };
  }
  return { zero: inStock, held: 0, reason: null };
}

/** One sentence for the sync notification. */
function describeVanished(removed, held, reason) {
  const out = [];
  if (removed > 0) out.push(`${removed} ürün XML'den kalktığı için stoğu sıfırlandı.`);
  if (held > 0) {
    const why = reason === 'empty' ? 'XML boş geldi'
      : reason === 'errors' ? 'XML satırlarında okuma hatası var'
        : 'sayı çok fazla, XML yanlış veya yarım olabilir';
    out.push(`${held} ürün XML'de görünmüyor ama stokları sıfırlanmadı (${why}). XML kaynağını kontrol edin.`);
  }
  return out.join(' ');
}

module.exports = { planVanished, describeVanished, HELD_ABOVE_COUNT, HELD_ABOVE_SHARE };
