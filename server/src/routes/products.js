const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { checkProductLimit } = require('../utils/quotaHelper');
const { getReadinessContext } = require('../services/readiness');
const { loadPricingContext } = require('../services/pricingEngine');
const productListCache = require('../services/productListCache');
const { ownedParam, userStoreIds } = require('../middleware/ownership');

const router = express.Router();

router.use(auth);
router.param('id', ownedParam('product'));

// Any successful change (edit, bulk action, delete…) makes the cached readiness / product lists stale
router.use((req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400) userStoreIds(req.user.id).then((ids) => ids.forEach((id) => productListCache.invalidate(id))).catch(() => {});
    });
  }
  next();
});

// Get user's store helper
async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

// ─── Shared filter builder (list, ids, summary, facets) ───────────────────────────
const SORTABLE = new Set(['createdAt', 'updatedAt', 'title', 'price', 'xmlPrice', 'stock', 'sku', 'brand', 'category']);
const LOW_STOCK_MAX = 5;

function categoryClauses(list) {
  return list.flatMap((c) => [
    { category: c },
    { category: { contains: `|${c}|` } },
    { category: { startsWith: `${c}|` } },
    { category: { endsWith: `|${c}` } },
  ]);
}

function buildWhere(storeId, q = {}) {
  const where = { storeId };
  const and = [];
  const {
    search, status, brand, category, categories, xmlSourceId, globalXmlOnly,
    stockFilter, noImage, noBarcode, connectionId, marketplaceStatus, notSentConnectionId,
  } = q;

  if (search) {
    and.push({ OR: [
      { title: { contains: String(search), mode: 'insensitive' } },
      { sku: { contains: String(search), mode: 'insensitive' } },
      { barcode: { contains: String(search), mode: 'insensitive' } },
    ] });
  }
  if (categories) {
    const list = String(categories).split(',').map((c) => c.trim()).filter(Boolean);
    if (list.length) and.push({ OR: categoryClauses(list) });
  } else if (category) {
    and.push({ OR: categoryClauses([String(category)]) });
  }
  if (status) where.status = String(status);
  if (brand) where.brand = String(brand);
  if (xmlSourceId) where.xmlSourceId = String(xmlSourceId);
  if (globalXmlOnly === 'true') where.xmlSource = { globalProviderId: { not: null } };

  if (stockFilter === 'out') where.stock = { lte: 0 };
  else if (stockFilter === 'low') where.stock = { gte: 1, lte: LOW_STOCK_MAX };
  else if (stockFilter === 'in') where.stock = { gt: LOW_STOCK_MAX };

  if (noImage === 'true') and.push({ OR: [{ images: null }, { images: '' }, { images: '[]' }] });
  if (noBarcode === 'true') and.push({ OR: [{ barcode: null }, { barcode: '' }] });

  if (notSentConnectionId) {
    // Products that have NO MarketplaceProduct record for this connection
    where.marketplaceProducts = { none: { connectionId: String(notSentConnectionId) } };
  } else if (connectionId || marketplaceStatus) {
    where.marketplaceProducts = { some: {} };
    if (connectionId) where.marketplaceProducts.some.connectionId = String(connectionId);
    if (marketplaceStatus) where.marketplaceProducts.some.status = String(marketplaceStatus);
  }
  if (and.length) where.AND = and;
  return where;
}

// Everything the list needs, without the heavy raw feed copy
const LIST_SELECT = {
  id: true, storeId: true, xmlSourceId: true, sku: true, barcode: true, title: true, description: true,
  price: true, xmlPrice: true, cost: true, listPrice: true, stock: true, brand: true, category: true, images: true,
  weight: true, desi: true, vatRate: true, currencyType: true, status: true, createdAt: true, updatedAt: true,
};

// List products with filtering, sorting and pagination.
//   priceFor=<connectionId> adds, per product, the sale price / profit rule / readiness issues for that marketplace
router.get('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const sortBy = SORTABLE.has(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    const where = buildWhere(store.id, req.query);

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          ...LIST_SELECT,
          marketplaceProducts: { select: { id: true, connectionId: true, status: true, errorMessage: true, marketplacePrice: true, marketplaceStock: true, lastSyncedAt: true, connection: { select: { marketplaceType: true, supplierName: true } } } },
          xmlSource: { select: { name: true, globalProviderId: true } },
        },
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    let ctx = null;
    if (req.query.priceFor) {
      const connection = await prisma.marketplaceConnection.findFirst({ where: { id: String(req.query.priceFor), storeId: store.id } });
      if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
      ctx = await getReadinessContext(connection);
    }

    const products = rows.map((p) => {
      const out = { ...p, hasDescription: !!(p.description && p.description.trim()) };
      delete out.description; // the list does not need the long text
      if (ctx) {
        const ev = ctx.evaluate(p);
        out.pricing = {
          salePrice: ev.salePrice,
          rule: ev.priceRule ? ev.priceRule.name : null,
          profit: null,
          ready: ev.ready,
          issues: ev.issues,
          mapName: ev.mapping ? (ev.mapping.marketplaceCategoryName || String(ev.mapping.marketplaceCategoryId)) : null,
        };
        const ex = ctx.priceCtx.explainFor(p);
        if (ex && ex.breakdown) out.pricing.profit = ex.breakdown.profit;
      }
      return out;
    });

    res.json({
      products,
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

// Overview numbers for the cards on top of the products screen (whole store, optionally one XML source)
router.get('/summary', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const base = { storeId: store.id, ...(req.query.xmlSourceId ? { xmlSourceId: String(req.query.xmlSourceId) } : {}) };
    const [total, active, passive, outOfStock, lowStock, noImage, noBarcode] = await Promise.all([
      prisma.product.count({ where: base }),
      prisma.product.count({ where: { ...base, status: 'active' } }),
      prisma.product.count({ where: { ...base, status: { not: 'active' } } }),
      prisma.product.count({ where: { ...base, stock: { lte: 0 } } }),
      prisma.product.count({ where: { ...base, stock: { gte: 1, lte: LOW_STOCK_MAX } } }),
      prisma.product.count({ where: { ...base, OR: [{ images: null }, { images: '' }, { images: '[]' }] } }),
      prisma.product.count({ where: { ...base, OR: [{ barcode: null }, { barcode: '' }] } }),
    ]);
    res.json({ total, active, passive, outOfStock, lowStock, noImage, noBarcode, lowStockMax: LOW_STOCK_MAX });
  } catch (error) { next(error); }
});

// Distinct categories / brands (with counts) for the filter drop-downs
router.get('/facets', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const base = { storeId: store.id, ...(req.query.xmlSourceId ? { xmlSourceId: String(req.query.xmlSourceId) } : {}) };
    const group = (field) => prisma.product.groupBy({
      by: [field], where: { ...base, [field]: { not: null } }, _count: { _all: true }, orderBy: { _count: { [field]: 'desc' } }, take: 300,
    });
    const [cats, brands] = await Promise.all([group('category'), group('brand')]);
    const pack = (rows, field) => rows.filter((r) => r[field] && String(r[field]).trim()).map((r) => ({ name: r[field], count: r._count._all }));
    res.json({ categories: pack(cats, 'category'), brands: pack(brands, 'brand') });
  } catch (error) { next(error); }
});

// Marketplace status counts for one connection (used by the status tabs)
router.get('/stats', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const { xmlSourceId, connectionId } = req.query;
    if (connectionId) {
      const ownConn = await prisma.marketplaceConnection.findFirst({ where: { id: connectionId, storeId: store.id }, select: { id: true } });
      if (!ownConn) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    }

    const where = { storeId: store.id };
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    const total = await prisma.product.count({ where });

    const mpStatus = { active: 0, pending: 0, rejected: 0, passive: 0, not_sent: 0 };
    if (connectionId) {
      const mpRows = await prisma.marketplaceProduct.groupBy({
        by: ['status'],
        where: { connectionId, product: { storeId: store.id, ...(xmlSourceId ? { xmlSourceId } : {}) } },
        _count: { status: true },
      });
      for (const r of mpRows) mpStatus[r.status] = (mpStatus[r.status] || 0) + r._count.status;
      const sent = mpRows.reduce((s, r) => s + r._count.status, 0);
      mpStatus.not_sent = Math.max(0, total - sent);
    }
    res.json({ total, mpStatus });
  } catch (error) {
    next(error);
  }
});

// Get all product IDs matching the current filters (for "select all pages")
router.get('/ids', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const products = await prisma.product.findMany({ where: buildWhere(store.id, req.query), select: { id: true } });
    res.json({ ids: products.map((p) => p.id), total: products.length });
  } catch (error) {
    next(error);
  }
});

const parseJson = (v, fallback = null) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

// Everything about ONE product for the detail panel: fields, images, price breakdown and readiness per marketplace,
// marketplace status, the feed copy and the change history.
router.get('/:id/detail', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        xmlSource: { select: { id: true, name: true, globalProviderId: true, defaultVatRate: true, purchaseVatRate: true, lastSyncedAt: true } },
        marketplaceProducts: { select: { id: true, connectionId: true, status: true, errorMessage: true, marketplaceProductId: true, marketplacePrice: true, marketplaceStock: true, lastSyncedAt: true } },
      },
    });
    const [connections, logs] = await Promise.all([
      prisma.marketplaceConnection.findMany({ where: { storeId: store.id }, take: 6 }),
      prisma.productLog.findMany({ where: { productId: product.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);

    const hiddenFeed = !!product.xmlSource?.globalProviderId; // pooled supplier feeds never expose their original data
    const marketplaces = [];
    for (const conn of connections) {
      const ctx = await getReadinessContext(conn);
      const ev = ctx.evaluate(product);
      const ex = ctx.priceCtx.explainFor(product);
      const mp = product.marketplaceProducts.find((m) => m.connectionId === conn.id) || null;
      marketplaces.push({
        connectionId: conn.id,
        type: conn.marketplaceType,
        name: conn.supplierName || conn.marketplaceType,
        ready: ev.ready,
        issues: ev.issues,
        categoryMapping: ev.mapping ? (ev.mapping.marketplaceCategoryName || String(ev.mapping.marketplaceCategoryId)) : null,
        pricing: ex ? { salePrice: ex.price, rule: ex.ruleName, kind: ex.kind, vatRate: ex.vatRate, breakdown: ex.breakdown } : null,
        listing: mp,
      });
    }

    const { rawXmlData, ...rest } = product;
    res.json({
      product: {
        ...rest,
        images: (() => { const v = parseJson(product.images, []); return Array.isArray(v) ? v : []; })(),
      },
      feed: hiddenFeed ? null : parseJson(rawXmlData, null),
      feedHidden: hiddenFeed,
      marketplaces,
      logs,
    });
  } catch (error) {
    next(error);
  }
});

// Get single product
router.get('/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        variants: true,
        marketplaceProducts: {
          include: { connection: { select: { id: true, marketplaceType: true, supplierName: true, sellerId: true, storeId: true, status: true } } }
        },
        xmlSource: true
      }
    });

    if (!product) {
      return res.status(404).json({ error: 'Ürün bulunamadı' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// Create product
router.post('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const {
      sku, barcode, title, description, price, cost, listPrice,
      stock, brand, category, images, attributes, weight, desi, vatRate
    } = req.body;

    if (!sku || !title) {
      return res.status(400).json({ error: 'SKU ve başlık zorunludur' });
    }

    await checkProductLimit(req.user.id, store.id, 1);

    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        sku,
        barcode,
        title,
        description,
        price: price || 0,
        cost: cost || 0,
        listPrice: listPrice || 0,
        stock: stock || 0,
        brand,
        category,
        images: images ? JSON.stringify(images) : null,
        attributes: attributes ? JSON.stringify(attributes) : null,
        weight,
        desi,
        vatRate: vatRate || 18
      },
      include: { variants: true }
    });

    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

// Update product
router.put('/:id', async (req, res, next) => {
  try {
    const {
      title, description, price, cost, listPrice, stock,
      brand, category, images, attributes, weight, desi, vatRate, status
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (price !== undefined) data.price = price;
    if (cost !== undefined) data.cost = cost;
    if (listPrice !== undefined) data.listPrice = listPrice;
    if (stock !== undefined) data.stock = stock;
    if (brand !== undefined) data.brand = brand;
    if (category !== undefined) data.category = category;
    if (images !== undefined) data.images = JSON.stringify(images);
    if (attributes !== undefined) data.attributes = JSON.stringify(attributes);
    if (weight !== undefined) data.weight = weight;
    if (desi !== undefined) data.desi = desi;
    if (vatRate !== undefined) data.vatRate = vatRate;
    if (status !== undefined) data.status = status;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: { variants: true, marketplaceProducts: true }
    });

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// Delete product
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ message: 'Ürün silindi' });
  } catch (error) {
    next(error);
  }
});

// Bulk actions
router.post('/bulk-action', async (req, res, next) => {
  try {
    const { action, productIds, value } = req.body;

    if (!action || !productIds?.length) {
      return res.status(400).json({ error: 'İşlem ve ürün seçimi zorunludur' });
    }

    const storeIds = await userStoreIds(req.user.id);
    let result;
    switch (action) {
      case 'activate':
        result = await prisma.product.updateMany({
          where: { id: { in: productIds }, storeId: { in: storeIds } },
          data: { status: 'active' }
        });
        break;
      case 'deactivate':
        result = await prisma.product.updateMany({
          where: { id: { in: productIds }, storeId: { in: storeIds } },
          data: { status: 'passive' }
        });
        break;
      case 'delete':
        result = await prisma.product.deleteMany({
          where: { id: { in: productIds }, storeId: { in: storeIds } }
        });
        break;
      case 'price_increase_percent': {
        const pct = parseFloat(value);
        if (isNaN(pct)) return res.status(400).json({ error: 'Geçerli bir yüzde değeri girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId: { in: storeIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.round(p.price * (1 + pct / 100) * 100) / 100 } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'price_decrease_percent': {
        const pct = parseFloat(value);
        if (isNaN(pct)) return res.status(400).json({ error: 'Geçerli bir yüzde değeri girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId: { in: storeIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.max(0, Math.round(p.price * (1 - pct / 100) * 100) / 100) } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'price_increase_fixed': {
        const amount = parseFloat(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir tutar girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId: { in: storeIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.round((p.price + amount) * 100) / 100 } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'price_decrease_fixed': {
        const amount = parseFloat(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir tutar girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId: { in: storeIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.max(0, Math.round((p.price - amount) * 100) / 100) } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'set_stock': {
        const stock = parseInt(value);
        if (isNaN(stock)) return res.status(400).json({ error: 'Geçerli bir stok değeri girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds }, storeId: { in: storeIds } },
          data: { stock }
        });
        break;
      }
      case 'stock_increase': {
        const amount = parseInt(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir değer girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId: { in: storeIds } }, select: { id: true, stock: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { stock: p.stock + amount } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'stock_decrease': {
        const amount = parseInt(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir değer girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId: { in: storeIds } }, select: { id: true, stock: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { stock: Math.max(0, p.stock - amount) } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'set_category': {
        if (!value) return res.status(400).json({ error: 'Kategori adı girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds }, storeId: { in: storeIds } },
          data: { category: value }
        });
        break;
      }
      case 'set_brand': {
        if (!value) return res.status(400).json({ error: 'Marka adı girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds }, storeId: { in: storeIds } },
          data: { brand: value }
        });
        break;
      }
      case 'set_vat_rate': {
        const rate = parseInt(value);
        if (isNaN(rate)) return res.status(400).json({ error: 'Geçerli bir KDV oranı girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds }, storeId: { in: storeIds } },
          data: { vatRate: rate }
        });
        break;
      }
      case 'sync_marketplaces': {
        // Bulunan ürünleri ve marketplace ürünlerini çek
        const marketplaceProducts = await prisma.marketplaceProduct.findMany({
          where: { productId: { in: productIds }, product: { storeId: { in: storeIds } } },
          include: { product: true, connection: true }
        });
        if (marketplaceProducts.length === 0) {
          return res.status(400).json({ error: 'Seçilen ürünlerin hiçbiri bir pazaryerine gönderilmemiş' });
        }
        
        // Bağlantılara göre grupla (null connectionId olan kayıtları atla)
        const grouped = {};
        for (const mp of marketplaceProducts) {
          if (!mp.connectionId || !mp.connection) continue;
          if (!grouped[mp.connectionId]) grouped[mp.connectionId] = { connection: mp.connection, mps: [] };
          grouped[mp.connectionId].mps.push(mp);
        }
        
        let syncedCount = 0;
        let errorMessages = [];
        
        for (const connId in grouped) {
          const { connection, mps } = grouped[connId];
          if (connection.marketplaceType === 'trendyol') {
            try {
              const TrendyolService = require('../services/trendyol/trendyolService');
              const service = new TrendyolService(connection);
              
              // One pricing engine for everything (templates + legacy rules). A product the engine cannot price is
              // NOT sent: sending its raw purchase price as the sale price would sell it at cost.
              const priceCtx = await loadPricingContext(connection.storeId, connection.id);
              const items = [];
              let unpriced = 0;
              for (const mp of mps) {
                const priced = priceCtx.priceFor(mp.product);
                if (!priced) { unpriced++; continue; }
                items.push({
                  barcode: mp.product.barcode || mp.product.sku,
                  quantity: mp.product.stock,
                  salePrice: priced.price,
                  listPrice: mp.product.listPrice > priced.price ? mp.product.listPrice : priced.price,
                });
              }
              if (unpriced > 0) errorMessages.push(`${connection.supplierName || connection.marketplaceType}: ${unpriced} ürüne uyan fiyat şablonu yok, gönderilmedi`);

              // Trendyol max 1000 items per request
              const BATCH_SIZE = 1000;
              for (let i = 0; i < items.length; i += BATCH_SIZE) {
                const batch = items.slice(i, i + BATCH_SIZE);
                const syncRes = await service.updatePriceAndInventory(batch);

                for (const item of batch) {
                  const mp = mps.find(m => (m.product.barcode || m.product.sku) === item.barcode);
                  if (!mp) continue;
                  await prisma.marketplaceProduct.update({
                    where: { id: mp.id },
                    data: {
                      marketplacePrice: item.salePrice,
                      marketplaceStock: item.quantity,
                      batchRequestId: syncRes?.batchRequestId || mp.batchRequestId,
                      lastSyncedAt: new Date()
                    }
                  });
                  syncedCount++;
                }
              }
            } catch (e) {
              errorMessages.push(`${connection.supplierName || connection.marketplaceType}: ${e.response?.data?.message || e.message}`);
            }
          }
        }
        
        if (syncedCount === 0 && errorMessages.length > 0) {
          return res.status(500).json({ error: 'Güncelleme hataları: ' + errorMessages.join(', ') });
        }
        
        const warningStr = errorMessages.length > 0 ? ` (Bazı hatalar: ${errorMessages.join(', ')})` : '';
        return res.json({ message: `${syncedCount} ürün pazaryerlerinde güncellendi${warningStr}`, count: syncedCount });
      }
      default:
        return res.status(400).json({ error: 'Geçersiz işlem' });
    }

    res.json({ message: `${result.count} ürün güncellendi`, count: result.count });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id/logs — product update history
router.get('/:id/logs', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const product = await prisma.product.findFirst({ where: { id: req.params.id, storeId: store.id } });
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    const logs = await prisma.productLog.findMany({
      where: { productId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
