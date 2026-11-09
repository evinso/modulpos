// Decides which BuyBox price changes are allowed. Pure: no database, no network (unit tested).
// Rules: only ever LOWER a price (if the BuyBox price is not below ours, price is not why we lose),
// never sell at a loss (judged by the pricing engine), and one entry per barcode.
const { sellsAtLoss } = require('./pricingEngine');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object[]} records     BuyboxRecord rows ({ barcode, productId, buyboxPrice })
 * @param {Map}      products    productId -> Product
 * @param {Map}      currentPrices productId -> price now on the marketplace (may be missing)
 * @param {object}   priceCtx    PricingContext of the connection
 * @returns {{ items: {barcode,productId,oldPrice,newPrice}[], skipped: {noProduct,notLower,loss} }}
 */
function planBuyboxAdjust({ records, products, currentPrices, priceCtx, mode, amount }) {
  const skipped = { noProduct: 0, notLower: 0, loss: 0 };
  const items = [];
  const seen = new Set();
  const off = Math.max(0, Number(amount) || 0);
  for (const r of records) {
    if (!r.barcode || seen.has(r.barcode)) continue;
    const p = r.productId ? products.get(r.productId) : null;
    if (!p || !(Number(r.buyboxPrice) > 0)) { skipped.noProduct++; continue; }
    let newPrice = Number(r.buyboxPrice);
    if (mode === 'undercut') newPrice = Math.max(0.01, newPrice - off);
    newPrice = round2(newPrice);

    let oldPrice = currentPrices.get(r.productId);
    if (!(oldPrice > 0)) { const priced = priceCtx.priceFor(p); oldPrice = priced ? priced.price : null; }
    if (oldPrice > 0 && newPrice >= oldPrice - 0.005) { skipped.notLower++; continue; }

    if (sellsAtLoss(priceCtx.previewAt(p, newPrice))) { skipped.loss++; continue; }
    seen.add(r.barcode);
    items.push({ barcode: r.barcode, productId: r.productId, oldPrice: oldPrice > 0 ? oldPrice : null, newPrice });
  }
  return { items, skipped };
}

/**
 * Which products one BuyBox check looks at.
 *  * offset given: a fixed order by barcode, the slice [offset, offset + size) (size 10..500). Walking offset 0, size, 2*size ...
 *    visits every product exactly once, whatever has or has not been checked before.
 *  * no offset (rotation): least recently checked first (never checked = first), `batchSize` of them; 0 = all.
 * `lastChecked` is barcode -> Date. Returns a new array, the input is not reordered.
 */
function pickCheckWindow(items, { offset = null, batchSize = 0, lastChecked = new Map() } = {}) {
  if (Number.isInteger(offset) && offset >= 0) {
    const size = Math.min(Math.max(batchSize, 10), 500);
    return [...items].sort((a, b) => (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0)).slice(offset, offset + size);
  }
  const ts = (b) => (lastChecked.get(b) ? lastChecked.get(b).getTime() : 0);
  const sorted = [...items].sort((a, b) => ts(a.barcode) - ts(b.barcode));
  return batchSize > 0 ? sorted.slice(0, batchSize) : sorted;
}

module.exports = { planBuyboxAdjust, pickCheckWindow };
