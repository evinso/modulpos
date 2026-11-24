const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const productListCache = require('../services/productListCache');
const { isHandScope } = require('../services/pricingEngine');
const HP = require('../services/handProducts');

/**
 * The workspace of the products ADDED BY HAND (`/api/hand-products`): the list with what is missing, the choice of many, ONE change for all of them (with a preview of what would change and what cannot)
 * and a pasted price / stock list. Only hand-added products of the caller's own store are ever read or written (the filter is in every query). The logic is in services/handProducts.js.
 */
const router = express.Router();
router.use(auth);

const getStore = (userId) => prisma.store.findFirst({ where: { userId } });
const fail = (res, e) => res.status(e.status || 400).json({ error: e.message });
const CHUNK = 100;

/** a connection of THIS store (or null) */
const ownConnection = (storeId, id) => (id ? prisma.marketplaceConnection.findFirst({ where: { id: String(id), storeId }, select: { id: true, marketplaceType: true } }) : null);

const row = (p, connectionId) => {
  const ov = connectionId ? (p.categoryOverrides || [])[0] : null;
  return { id: p.id, sku: p.sku, barcode: p.barcode || '', title: p.title, price: p.price, stock: p.stock, brand: p.brand || '', vatRate: p.vatRate, status: p.status, categoryText: p.category || '',
    imageCount: HP.imageCount(p), firstImage: HP.firstImage(p), descriptionLength: (p.description || '').length, sent: (p._count ? p._count.marketplaceProducts : 0) > 0,
    trendyolCategory: ov ? { id: ov.marketplaceCategoryId, name: ov.marketplaceCategoryName || ov.marketplaceCategoryId, source: ov.source } : null, createdAt: p.createdAt, updatedAt: p.updatedAt };
};

/** what is missing across ALL hand-added products (not only this page) and whether the template for them exists */
async function summary(storeId, connectionId) {
  const n = (filter) => prisma.product.count({ where: HP.whereFor(storeId, { filter, connectionId }) });
  const [total, noPrice, noStock, noBrand, noBarcode, noImage, sent, noCategory, rules] = await Promise.all([
    n('all'), n('no_price'), n('no_stock'), n('no_brand'), n('no_barcode'), n('no_image'), n('sent'), connectionId ? n('no_category') : Promise.resolve(null),
    prisma.pricingRule.findMany({ where: { storeId, applyTo: 'price_template' }, select: { id: true, name: true, isActive: true, conditions: true } }),
  ]);
  const hand = rules.filter((r) => { try { return isHandScope(JSON.parse(r.conditions || '{}')); } catch { return false; } });
  const on = hand.find((r) => r.isActive) || null;
  return { total, noPrice, noStock, noBrand, noBarcode, noImage, sent, noCategory, template: { exists: hand.length > 0, active: !!on, id: (on || hand[0] || {}).id || null, name: (on || hand[0] || {}).name || null } };
}

// The list (one page) and what is missing. ?q= &filter= &sort= &dir= &page= &limit= &connectionId= (the Trendyol connection whose product-level categories are shown / filtered)
router.get('/', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await ownConnection(store.id, req.query.connectionId); const connectionId = conn ? conn.id : null;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50)); const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const where = HP.whereFor(store.id, { q: req.query.q, filter: req.query.filter, connectionId });
    const [total, rows, sum] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, orderBy: HP.orderFor(req.query.sort, req.query.dir), skip: (page - 1) * limit, take: limit,
        select: { id: true, sku: true, barcode: true, title: true, description: true, price: true, stock: true, brand: true, vatRate: true, status: true, category: true, images: true, createdAt: true, updatedAt: true,
          _count: { select: { marketplaceProducts: true } }, ...(connectionId ? { categoryOverrides: { where: { connectionId }, select: { marketplaceCategoryId: true, marketplaceCategoryName: true, source: true } } } : {}) } }),
      summary(store.id, connectionId),
    ]);
    res.json({ items: rows.map((p) => row(p, connectionId)), total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), summary: sum, connectionId });
  } catch (e) { next(e); }
});

// The ids of everything the filter matches (for "select all N"), at most MAX_BULK.
router.get('/ids', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await ownConnection(store.id, req.query.connectionId);
    const rows = await prisma.product.findMany({ where: HP.whereFor(store.id, { q: req.query.q, filter: req.query.filter, connectionId: conn ? conn.id : null }), select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: HP.MAX_BULK + 1 });
    res.json({ ids: rows.slice(0, HP.MAX_BULK).map((r) => r.id), truncated: rows.length > HP.MAX_BULK });
  } catch (e) { next(e); }
});

/** the products a request means: { ids: [...] } or { filter: { q, filter, connectionId } }, hand-added and of this store only, in a stable order (the numbering rules count by position) */
async function selection(store, body) {
  let where;
  if (Array.isArray(body.ids)) {
    if (!body.ids.length) throw Object.assign(new Error('Ürün seçilmedi'), { status: 400 });
    if (body.ids.length > HP.MAX_BULK) throw Object.assign(new Error(`Bir seferde en çok ${HP.MAX_BULK} ürün değiştirilebilir`), { status: 413 });
    where = { ...HP.whereFor(store.id, {}), id: { in: body.ids.map(String) } };
  } else if (body.filter && typeof body.filter === 'object') {
    const conn = await ownConnection(store.id, body.filter.connectionId);
    where = HP.whereFor(store.id, { q: body.filter.q, filter: body.filter.filter, connectionId: conn ? conn.id : null });
    if (await prisma.product.count({ where }) > HP.MAX_BULK) throw Object.assign(new Error(`Filtre ${HP.MAX_BULK} üründen fazlasını kapsıyor: filtreyi daralttıktan sonra deneyin`), { status: 413 });
  } else throw Object.assign(new Error('Ürün seçilmedi'), { status: 400 });
  const rows = await prisma.product.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, sku: true, barcode: true, title: true, price: true, stock: true, brand: true, vatRate: true, status: true, category: true, _count: { select: { marketplaceProducts: true } } } });
  return rows.map((p) => ({ ...p, barcode: p.barcode || '', brand: p.brand || '', sent: p._count.marketplaceProducts > 0 }));
}

async function write(updates) {
  for (let i = 0; i < updates.length; i += CHUNK) await prisma.$transaction(updates.slice(i, i + CHUNK).map((u) => prisma.product.update({ where: { id: u.id }, data: u.data })));
}

// ONE change for many products. Body: { ids | filter, patch: { price: { mode: set|percent, value }, stock: { mode: set|add, value }, brand, vatRate, status, categoryText, title: { prefix, suffix, find, replace }, codes: { sku, barcode } }, dryRun }
// Answer: { matched, changed, rows (the first 30: before / after), problems, applied }. A preview (dryRun) writes nothing; the apply recomputes everything and writes only what the preview showed for the same selection.
router.post('/bulk', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const body = req.body || {};
    let products; let patch;
    try { products = await selection(store, body); patch = HP.readPatch(body.patch, { count: products.length }); } catch (e) { return fail(res, e); }
    let others = { skus: new Set(), barcodes: new Set() };
    if (patch.codes) {
      const inside = new Set(products.map((p) => p.id));
      const rest = await prisma.product.findMany({ where: { storeId: store.id }, select: { id: true, sku: true, barcode: true } });
      others = { skus: new Set(rest.filter((r) => !inside.has(r.id)).map((r) => r.sku)), barcodes: new Set(rest.filter((r) => !inside.has(r.id) && r.barcode).map((r) => r.barcode)) };
    }
    const plan = HP.planBulk(products, patch, others);
    const base = { matched: products.length, changed: plan.changed, rows: plan.rows.slice(0, 30), problems: plan.problems.slice(0, 50), problemCount: plan.problems.length };
    if (body.dryRun !== false) return res.json({ ...base, applied: 0, dryRun: true });
    await write(plan.updates);
    productListCache.invalidate(store.id);
    res.json({ ...base, applied: plan.changed, dryRun: false });
  } catch (e) { next(e); }
});

// A pasted price / stock list (Excel columns: stock code or barcode, net amount, stock). Body: { text, dryRun }. Answer: { items (the first 500 lines with their status), counts, applied }
router.post('/paste', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const text = String((req.body || {}).text || '');
    if (text.length > 800000) return res.status(413).json({ error: 'Liste çok büyük' });
    let rows; try { rows = HP.parseList(text); } catch (e) { return fail(res, e); }
    const products = await prisma.product.findMany({ where: HP.whereFor(store.id, {}), select: { id: true, sku: true, barcode: true, title: true, price: true, stock: true } });
    const plan = HP.planList(rows, products);
    const base = { items: plan.items.slice(0, 500), counts: plan.counts, truncated: plan.items.length > 500 };
    if ((req.body || {}).dryRun !== false) return res.json({ ...base, applied: 0, dryRun: true });
    await write(plan.updates);
    productListCache.invalidate(store.id);
    res.json({ ...base, applied: plan.updates.length, dryRun: false });
  } catch (e) { next(e); }
});

module.exports = router;
