/**
 * Loss alert for products with a hand-typed sale price.
 *
 * A price typed in by hand does not follow the purchase price. When the XML raises the purchase price of such a product, a
 * price that used to earn money can start to lose money — and nothing would tell the owner. Right after an XML sync this
 * looks at the products whose purchase price went UP and, per product and marketplace, compares the profit at the old and
 * at the new purchase price. Only a product that CROSSES into loss is reported (once, at the moment it happens);
 * one that was losing before is not repeated on every sync. The product list shows the same state on the row at any time
 * (`pricing.loss`), so a missed notification never hides a loss.
 */
const prisma = require('../config/database');
const notificationService = require('./notificationService');
const { loadPricingContext, sellsAtLoss } = require('./pricingEngine');

const MAX_LISTED = 50;

/**
 * Pure decision for ONE marketplace.
 * @param ctx        PricingContext of that marketplace
 * @param overrides  [{ productId, price }]  hand-typed prices
 * @param products   Map productId -> stored product (state AFTER the sync)
 * @param moves      Map productId -> { oldXmlPrice, oldPrice }  (state BEFORE the sync, only for purchase price rises)
 * @returns          [{ id, title, sku, purchaseOld, purchaseNew, price, profit }]
 */
function detectNewLosses(ctx, overrides, products, moves) {
  const out = [];
  for (const o of overrides) {
    const after = products.get(o.productId);
    const move = moves.get(o.productId);
    if (!after || !move) continue;
    const before = { ...after, xmlPrice: move.oldXmlPrice, price: move.oldPrice };
    const pvAfter = ctx.previewAt(after, o.price);
    if (!sellsAtLoss(pvAfter)) continue;
    const pvBefore = ctx.previewAt(before, o.price);
    if (sellsAtLoss(pvBefore)) continue;                    // already lost money before this sync: not news
    out.push({
      id: after.id, title: after.title, sku: after.sku,
      purchaseOld: pvBefore.purchase, purchaseNew: pvAfter.purchase, price: o.price,
      profit: pvAfter.breakdown ? pvAfter.breakdown.profit : null,
    });
  }
  return out;
}

/**
 * @param storeId  store of the XML source
 * @param source   the XML source that was synced ({ id, name })
 * @param moves    [{ id, oldXmlPrice, oldPrice }] products whose purchase price went up in this sync
 * @returns number of products reported
 */
async function checkManualPriceLosses({ storeId, source, moves }) {
  if (!moves || moves.length === 0) return 0;
  const moveBy = new Map(moves.map((m) => [m.id, m]));

  const all = await prisma.productPriceOverride.findMany({
    where: { product: { storeId, xmlSourceId: source.id } },
    select: { productId: true, connectionId: true, price: true },
  });
  const hand = all.filter((o) => moveBy.has(o.productId));
  if (hand.length === 0) return 0;

  const productIds = [...new Set(hand.map((o) => o.productId))];
  const products = new Map();
  for (let i = 0; i < productIds.length; i += 1000) {
    const rows = await prisma.product.findMany({
      where: { id: { in: productIds.slice(i, i + 1000) } },
      select: { id: true, title: true, sku: true, xmlSourceId: true, category: true, brand: true, xmlPrice: true, price: true, vatRate: true },
    });
    for (const r of rows) products.set(r.id, r);
  }

  const byConnection = new Map();
  for (const o of hand) {
    if (!byConnection.has(o.connectionId)) byConnection.set(o.connectionId, []);
    byConnection.get(o.connectionId).push(o);
  }

  const found = [];
  for (const [connectionId, overrides] of byConnection) {
    const conn = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId }, select: { id: true, supplierName: true, marketplaceType: true } });
    if (!conn) continue;
    const ctx = await loadPricingContext(storeId, connectionId);
    const name = conn.supplierName || conn.marketplaceType;
    for (const f of detectNewLosses(ctx, overrides, products, moveBy)) found.push({ ...f, marketplace: name });
  }
  if (found.length === 0) return 0;

  // The ones that lose the most first
  found.sort((a, b) => (a.profit ?? 0) - (b.profit ?? 0));
  await notificationService.create({
    storeId,
    title: 'Elle fiyatlı ürünlerde zarar',
    message: `"${source.name}" güncellemesinde alış fiyatı artan ${found.length} elle fiyatlı ürün zarara düştü. Satış fiyatlarını güncelleyin veya şablon fiyatına döndürün.`,
    type: 'warning',
    link: '/products',
    data: { notifType: 'manual_price_loss', sourceName: source.name, total: found.length, items: found.slice(0, MAX_LISTED) },
  });
  return found.length;
}

module.exports = { checkManualPriceLosses, detectNewLosses };
