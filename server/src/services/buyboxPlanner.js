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

module.exports = { planBuyboxAdjust };
