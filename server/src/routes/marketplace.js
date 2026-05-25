const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const TrendyolService = require('../services/trendyol/trendyolService');
const HepsiburadaService = require('../services/hepsiburada/hepsiburadaService');
const PazaramaService = require('../services/pazarama/pazaramaService');
const notificationService = require('../services/notificationService');
const { matchPriceRangeRule, calcPriceRangePrice } = require('../utils/pricingHelper');
const { deductCredits, getSetting } = require('./credits');

const router = express.Router();
router.use(auth);

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

const MP_STATUS_KEYS = ['trendyol', 'hepsiburada', 'amazon', 'n11', 'ciceksepeti', 'pttavm', 'pazarama'];
const MP_STATUS_DEFAULTS = { trendyol: 'active', hepsiburada: 'active', amazon: 'development', n11: 'development', ciceksepeti: 'development', pttavm: 'development', pazarama: 'development' };

// GET marketplace status labels (used by sidebar)
router.get('/statuses', async (_req, res, next) => {
  try {
    const keys = MP_STATUS_KEYS.map(k => `mp_status_${k}`);
    const rows = await prisma.systemSettings.findMany({ where: { key: { in: keys } } });
    const result = { ...MP_STATUS_DEFAULTS };
    for (const row of rows) {
      const mp = row.key.replace('mp_status_', '');
      result[mp] = row.value;
    }
    res.json(result);
  } catch (error) { next(error); }
});

// Admin: update marketplace status labels
router.put('/statuses', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Yetkisiz' });
    const updates = req.body; // { trendyol: 'active', hepsiburada: 'maintenance', ... }
    const valid = ['active', 'maintenance', 'development'];
    for (const [mp, status] of Object.entries(updates)) {
      if (!MP_STATUS_KEYS.includes(mp) || !valid.includes(status)) continue;
      await prisma.systemSettings.upsert({
        where: { key: `mp_status_${mp}` },
        update: { value: status },
        create: { key: `mp_status_${mp}`, value: status },
      });
    }
    res.json({ success: true });
  } catch (error) { next(error); }
});

// List connections
router.get('/connections', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const connections = await prisma.marketplaceConnection.findMany({
      where: { storeId: store.id },
      include: { _count: { select: { marketplaceProducts: true, orders: true } } }
    });
    res.json(connections);
  } catch (error) { next(error); }
});

// Create connection
router.post('/connections', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { marketplaceType, sellerId, apiKey, apiSecret, supplierName, defaultBrandId, defaultBrandName, brandStrategy } = req.body;
    if (!marketplaceType || !apiKey || !apiSecret) return res.status(400).json({ error: 'Pazaryeri türü, API Key ve Secret zorunludur' });

    const config = {};
    if (defaultBrandId) config.defaultBrandId = parseInt(defaultBrandId);
    if (defaultBrandName) config.defaultBrandName = defaultBrandName;
    config.brandStrategy = brandStrategy === 'override' ? 'override' : 'xml';

    const connection = await prisma.marketplaceConnection.create({
      data: { storeId: store.id, marketplaceType, sellerId, apiKey, apiSecret, supplierName, config: Object.keys(config).length > 0 ? JSON.stringify(config) : null }
    });

    notificationService.create({
      storeId: store.id,
      title: 'Pazaryeri Bağlandı',
      message: `${marketplaceType.charAt(0).toUpperCase() + marketplaceType.slice(1)} bağlantısı oluşturuldu.`,
      type: 'success',
      link: '/marketplace'
    });

    res.status(201).json(connection);
  } catch (error) { next(error); }
});

// Update connection settings (supplierName, brandStrategy, defaultBrand)
router.put('/connections/:id', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const { supplierName, defaultBrandId, defaultBrandName, brandStrategy } = req.body;
    const config = connection.config ? JSON.parse(connection.config) : {};

    if (defaultBrandId) config.defaultBrandId = parseInt(defaultBrandId);
    if (defaultBrandName) config.defaultBrandName = defaultBrandName;
    config.brandStrategy = brandStrategy === 'override' ? 'override' : 'xml';

    const updated = await prisma.marketplaceConnection.update({
      where: { id: req.params.id },
      data: {
        supplierName: supplierName !== undefined ? supplierName : connection.supplierName,
        config: JSON.stringify(config)
      }
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// Test connection
router.post('/connections/:id/test', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    if (connection.marketplaceType === 'trendyol') {
      const service = new TrendyolService(connection);
      const result = await service.testConnection();
      if (result.success) {
        await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { status: 'active', errorMessage: null } });
      }
      return res.json(result);
    }

    if (connection.marketplaceType === 'hepsiburada') {
      const service = new HepsiburadaService(connection);
      const result = await service.testConnection();
      if (result.success) {
        await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { status: 'active', errorMessage: null } });
      }
      return res.json(result);
    }

    if (connection.marketplaceType === 'pazarama') {
      const service = new PazaramaService(connection);
      const result = await service.testConnection();
      if (result.success) {
        await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { status: 'active', errorMessage: null } });
      }
      return res.json(result);
    }

    res.json({ success: false, message: 'Bu pazaryeri henüz desteklenmiyor' });
  } catch (error) { next(error); }
});

// Get categories (Trendyol or HepsiBurada)
router.get('/connections/:id/categories', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    if (connection.marketplaceType === 'trendyol') {
      const service = new TrendyolService(connection);
      const categories = await service.getCategories();
      return res.json(categories);
    }
    if (connection.marketplaceType === 'hepsiburada') {
      const service = new HepsiburadaService(connection);
      const {
        page = 0, size = 1000,
        leaf, status, available, type,
      } = req.query;
      const data = await service.getCategories({
        leaf: leaf !== undefined ? leaf === 'true' : true,
        status: status || 'ACTIVE',
        available: available !== undefined ? available === 'true' : true,
        type: type || undefined,
        page: parseInt(page) || 0,
        size: Math.min(parseInt(size) || 1000, 1000),
      });
      const cats = data?.data || data?.categories || (Array.isArray(data) ? data : []);
      return res.json({ categories: cats, total: data?.totalCount || cats.length });
    }
    if (connection.marketplaceType === 'pazarama') {
      const service = new PazaramaService(connection);
      const data = await service.getCategoryTree();
      return res.json(data);
    }
    res.json([]);
  } catch (error) {
    if (error.response && error.response.status === 403) {
      return res.status(403).json({ error: 'API erişimi reddedildi (403). Lütfen kimlik bilgilerinizi kontrol edin.' });
    }
    next(error);
  }
});


// Search brands (for connection creation - uses provided credentials)
router.get('/brands/search', async (req, res, next) => {
  try {
    const { name, sellerId, apiKey, apiSecret } = req.query;
    if (!name || !apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Marka adı, API Key ve Secret gerekli' });
    }
    
    const tempService = new TrendyolService({
      sellerId: sellerId || '',
      apiKey,
      apiSecret,
      baseUrl: process.env.TRENDYOL_BASE_URL
    });
    
    const result = await tempService.searchBrand(name);
    res.json(result || []);
  } catch (error) {
    console.error('[Brand Search Error]', error.response?.data || error.message);
    res.json([]);
  }
});

// HepsiBurada: sync price & stock for selected products
// HepsiBurada: batch price+stock update via XML inventory-uploads
router.post('/connections/:id/hepsiburada-sync', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') {
      return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    }

    const { products } = req.body; // [{ sku, hbSku?, price, stock, dispatchTime?, cargoCompany? }]
    if (!products?.length) return res.status(400).json({ error: 'Ürün listesi boş' });

    const service = new HepsiburadaService(connection);
    const listings = products.map(p => ({
      merchantSku: p.sku,
      hbSku: p.hbSku || '',
      price: Number(p.price) || 0,
      stock: parseInt(p.stock) || 0,
      dispatchTime: p.dispatchTime || 1,
      cargoCompany: p.cargoCompany || 'Yurtiçi Kargo',
    }));

    try {
      const result = await service.uploadInventory(listings);
      res.json({ sent: listings.length, failed: 0, result });
    } catch (err) {
      res.status(502).json({ error: `HepsiBurada API hatası: ${err.message}` });
    }
  } catch (error) { next(error); }
});

// HepsiBurada: activate listing
router.post('/connections/:id/hepsiburada-activate/:sku', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const service = new HepsiburadaService(connection);
    const data = await service.activateListing(req.params.sku);
    res.json(data || { success: true });
  } catch (error) { next(error); }
});

// HepsiBurada: deactivate listing
router.post('/connections/:id/hepsiburada-deactivate/:sku', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const service = new HepsiburadaService(connection);
    const data = await service.deactivateListing(req.params.sku);
    res.json(data || { success: true });
  } catch (error) { next(error); }
});

// HepsiBurada: delete listing
router.delete('/connections/:id/hepsiburada-listing/:sku/merchantsku/:merchantSku', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const service = new HepsiburadaService(connection);
    const data = await service.deleteListing(req.params.sku, req.params.merchantSku);
    res.json(data || { success: true });
  } catch (error) { next(error); }
});

// HepsiBurada: get listings with optional filters
router.get('/connections/:id/hepsiburada-listings', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') {
      return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    }
    const { limit = 2000, offset = 0, hbSkuList, merchantSkuList, salable, notsalable, updateStartDate, updateEndDate } = req.query;
    const params = { limit: parseInt(limit), offset: parseInt(offset) };
    if (hbSkuList) params.hbSkuList = hbSkuList;
    if (merchantSkuList) params.merchantSkuList = merchantSkuList;
    if (salable === 'true') params['salable-listings'] = true;
    if (notsalable === 'true') params['notsalable-listings'] = true;
    if (updateStartDate) params.updateStartDate = updateStartDate;
    if (updateEndDate) params.updateEndDate = updateEndDate;
    const service = new HepsiburadaService(connection);
    const data = await service.getListings(params);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: commission rates for SKU list (up to 50)
router.get('/connections/:id/hepsiburada-commissions', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const skuList = req.query.skuList ? req.query.skuList.split(',').filter(Boolean) : [];
    const service = new HepsiburadaService(connection);
    const data = await service.getCommissions(skuList);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: inventory upload status
router.get('/connections/:id/hepsiburada-inventory-upload-status/:uploadId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const service = new HepsiburadaService(connection);
    res.json(await service.getInventoryUploadStatus(req.params.uploadId));
  } catch (error) { next(error); }
});

// HepsiBurada: stock-only batch upload
router.post('/connections/:id/hepsiburada-stock-upload', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items gerekli' });
    const service = new HepsiburadaService(connection);
    res.json(await service.uploadStock(items));
  } catch (error) { next(error); }
});

router.get('/connections/:id/hepsiburada-stock-upload-status/:uploadId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    res.json(await new HepsiburadaService(connection).getStockUploadStatus(req.params.uploadId));
  } catch (error) { next(error); }
});

// HepsiBurada: price-only batch upload
router.post('/connections/:id/hepsiburada-price-upload', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items gerekli' });
    res.json(await new HepsiburadaService(connection).uploadPrice(items));
  } catch (error) { next(error); }
});

router.get('/connections/:id/hepsiburada-price-upload-status/:uploadId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    res.json(await new HepsiburadaService(connection).getPriceUploadStatus(req.params.uploadId));
  } catch (error) { next(error); }
});

// HepsiBurada: shipping/delivery batch upload
router.post('/connections/:id/hepsiburada-shipping-upload', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items gerekli' });
    res.json(await new HepsiburadaService(connection).uploadShippingInfo(items));
  } catch (error) { next(error); }
});

router.get('/connections/:id/hepsiburada-shipping-upload-status/:uploadId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    res.json(await new HepsiburadaService(connection).getShippingUploadStatus(req.params.uploadId));
  } catch (error) { next(error); }
});

// HepsiBurada: additional info batch upload (productName, maximumPurchasableQuantity)
router.post('/connections/:id/hepsiburada-additional-upload', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items gerekli' });
    res.json(await new HepsiburadaService(connection).uploadAdditionalInfo(items));
  } catch (error) { next(error); }
});

router.get('/connections/:id/hepsiburada-additional-upload-status/:uploadId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    res.json(await new HepsiburadaService(connection).getAdditionalInfoUploadStatus(req.params.uploadId));
  } catch (error) { next(error); }
});

// HepsiBurada: bulk unlock price-locked listings
router.post('/connections/:id/hepsiburada-bulk-unlock', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { hbSkuList } = req.body;
    if (!Array.isArray(hbSkuList) || !hbSkuList.length) return res.status(400).json({ error: 'hbSkuList gerekli' });
    res.json(await new HepsiburadaService(connection).bulkUnlock(hbSkuList));
  } catch (error) { next(error); }
});

// HepsiBurada BuyBox: fetch rankings — gets listings then queries /buybox-orders in batches of 10
router.post('/connections/:id/hepsiburada-buybox-check', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') {
      return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    }

    const { limit = 500 } = req.body;
    const service = new HepsiburadaService(connection);

    // Step 1: get our listings (price, stock, state)
    const raw = await service.getListings({ limit, offset: 0 });
    const listings = raw?.listings || raw?.data?.listings || (Array.isArray(raw) ? raw : []);

    // Step 2: query buybox rankings in batches of 10
    const hbSkus = listings.map(l => l.hbSku || l.listingId).filter(Boolean);
    const buyboxMap = {};
    const batchSize = 10;
    for (let i = 0; i < hbSkus.length; i += batchSize) {
      const batch = hbSkus.slice(i, i + batchSize);
      try {
        const bbRaw = await service.getBuyboxRankings(batch);
        const variants = bbRaw?.Variants || bbRaw?.variants || (Array.isArray(bbRaw) ? bbRaw : []);
        for (const v of variants) {
          const sku = v.Sku || v.sku;
          const orders = v.BuyboxOrders || v.buyboxOrders || [];
          // Find our merchant's rank
          const ourEntry = orders.find(o => o.MerchantName === connection.supplierName) || orders[0];
          const rank1 = orders[0];
          buyboxMap[sku] = {
            buyboxOrder: ourEntry ? (orders.indexOf(ourEntry) + 1) : null,
            buyboxPrice: rank1 ? (rank1.Price ?? rank1.price) : null,
            buyboxMerchant: rank1 ? (rank1.MerchantName ?? rank1.merchantName) : null,
          };
        }
      } catch { /* skip failed batches */ }
    }

    const results = listings.map(l => {
      const hbSku = l.hbSku || l.listingId;
      const bb = buyboxMap[hbSku] || {};
      return {
        sku: l.merchantSku || l.sku,
        hbSku,
        productName: l.productName || l.name || '',
        barcode: l.barcode || '',
        ourPrice: l.price ?? l.salesPrice ?? null,
        buyboxOrder: bb.buyboxOrder ?? l.buyboxOrder ?? l.buyBoxOrder ?? null,
        buyboxPrice: bb.buyboxPrice ?? l.buyboxPrice ?? l.buyBoxPrice ?? null,
        buyboxMerchant: bb.buyboxMerchant ?? null,
        hasMultipleSeller: l.hasMultipleSeller ?? false,
        stock: l.availableCount ?? l.stock ?? null,
        state: l.state || 'UNKNOWN',
        isLocked: l.isLocked ?? l.IsLocked ?? false,
        isFrozen: l.isFrozen ?? l.IsFrozen ?? false,
      };
    });

    res.json({
      total: results.length,
      winning: results.filter(r => r.buyboxOrder === 1).length,
      losing: results.filter(r => r.buyboxOrder != null && r.buyboxOrder > 1).length,
      unknown: results.filter(r => r.buyboxOrder == null).length,
      listings: results,
    });
  } catch (error) { next(error); }
});

// HepsiBurada BuyBox: price adjustment
router.post('/connections/:id/hepsiburada-buybox-adjust', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') {
      return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    }

    const { items, mode } = req.body;
    // items: [{ sku, buyboxPrice, ourPrice }]
    if (!items?.length) return res.status(400).json({ error: 'Ürün listesi boş' });

    const service = new HepsiburadaService(connection);
    const results = [];

    for (const item of items) {
      try {
        let newPrice;
        if (mode === 'match') newPrice = item.buyboxPrice;
        else if (mode === 'undercut') newPrice = Math.max(0, item.buyboxPrice - (req.body.amount || 1));
        else newPrice = item.buyboxPrice;

        newPrice = Math.round(newPrice * 100) / 100;
        await service.updateListing(item.sku, newPrice, null);
        results.push({ sku: item.sku, success: true, newPrice });
      } catch (err) {
        results.push({ sku: item.sku, success: false, error: err.message });
      }
    }

    res.json({
      updated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) { next(error); }
});

// Delete connection
router.delete('/connections/:id', async (req, res, next) => {
  try {
    await prisma.marketplaceConnection.delete({ where: { id: req.params.id } });
    res.json({ message: 'Bağlantı silindi' });
  } catch (error) { next(error); }
});

// Trendyol: fetch products directly from Trendyol API by status
router.get('/connections/:id/trendyol-products', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await prisma.marketplaceConnection.findFirst({ where: { id: req.params.id, storeId: store.id } });
    if (!conn || conn.marketplaceType !== 'trendyol') return res.status(404).json({ error: 'Trendyol bağlantısı bulunamadı' });

    const { status = 'active', page = 0, size = 50 } = req.query;
    const service = new TrendyolService(conn);

    const filterMap = {
      active:   { approved: true, onSale: true },
      pending:  { approved: false, archived: false },
      rejected: { rejected: true },
      passive:  { archived: true },
    };
    const filters = filterMap[status] || { approved: true, onSale: true };
    const data = await service.getFilteredProducts(filters, parseInt(page), parseInt(size));
    res.json(data);
  } catch (err) { next(err); }
});

// HepsiBurada: create new product listings via MPOP catalog API
router.post('/connections/:id/hepsiburada-create', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') {
      return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    }

    const { productIds, minStock = 0 } = req.body;
    if (!productIds?.length) return res.status(400).json({ error: 'Ürün listesi boş' });

    const store = await prisma.store.findFirst({ where: { userId: req.user.id } });
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    // Load products + category mappings
    const [dbProducts, mappings] = await Promise.all([
      prisma.product.findMany({ where: { id: { in: productIds }, storeId: store.id } }),
      prisma.categoryMapping.findMany({ where: { connectionId: req.params.id } }),
    ]);

    const mappingLookup = {};
    for (const m of mappings) mappingLookup[m.localCategory?.toLowerCase().trim()] = m;

    const service = new HepsiburadaService(connection);
    const toCreate = [];
    const skipped = [];

    for (const p of dbProducts) {
      const catKey = p.category?.toLowerCase().trim();
      const mapping = catKey ? mappingLookup[catKey] : null;

      if (!mapping) { skipped.push({ id: p.id, reason: 'Kategori eşlemesi yok' }); continue; }
      if (!p.barcode && !p.sku) { skipped.push({ id: p.id, reason: 'Barkod/SKU eksik' }); continue; }
      if (!p.brand) { skipped.push({ id: p.id, reason: 'Marka eksik' }); continue; }

      let images = [];
      try {
        const parsed = p.images ? JSON.parse(p.images) : [];
        images = Array.isArray(parsed) ? parsed : [parsed];
      } catch { images = p.images ? [p.images] : []; }

      // Category-specific attributes from mapping (attributeId -> value)
      const mappingAttrs = mapping.attributes ? JSON.parse(mapping.attributes) : [];
      const categoryAttrMap = {};
      if (Array.isArray(mappingAttrs)) {
        for (const a of mappingAttrs) {
          if (a.attributeId) categoryAttrMap[a.attributeId] = a.valueName || a.value || '';
        }
      }

      // Image fields Image1..Image5
      const imageFields = {};
      images.slice(0, 5).forEach((url, i) => { imageFields[`Image${i + 1}`] = url; });

      // Price in Turkish decimal format (comma separator)
      const priceVal = Number(p.price || 0);
      const priceStr = priceVal.toFixed(2).replace('.', ',');
      const stockVal = Math.max(parseInt(p.stock || 0) - minStock, 0);

      // merchantSku: HepsiBurada requires uppercase, no spaces
      const rawSku = p.sku || p.barcode || '';
      const merchantSku = rawSku.toUpperCase().replace(/\s+/g, '_');

      toCreate.push({
        categoryId: parseInt(mapping.marketplaceCategoryId),
        merchant: connection.sellerId,
        attributes: {
          merchantSku,
          VaryantGroupID: merchantSku,
          Barcode: p.barcode || p.sku || '',
          UrunAdi: p.title || p.name || '',
          UrunAciklamasi: p.description || '',
          Marka: p.brand,
          GarantiSuresi: 24,
          kg: '1',
          tax_vat_rate: '18',
          price: priceStr,
          stock: String(stockVal),
          ...imageFields,
          ...categoryAttrMap,
        },
      });
    }

    if (toCreate.length === 0) {
      return res.json({ sent: 0, skipped, message: 'Gönderilecek ürün yok' });
    }

    let result;
    try {
      result = await service.createProducts(toCreate);
    } catch (err) {
      return res.status(502).json({ error: `HepsiBurada API hatası: ${err.message}` });
    }

    const trackingId = result?.trackingId || result?.data?.trackingId || result?.id || null;
    res.json({
      sent: toCreate.length,
      skipped,
      trackingId,
      result,
    });
  } catch (error) { next(error); }
});

// HepsiBurada: check import status by trackingId
router.get('/connections/:id/hepsiburada-import-status/:trackingId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') {
      return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    }
    const service = new HepsiburadaService(connection);
    const data = await service.getImportStatus(req.params.trackingId);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: tracking history (past trackingIds)
router.get('/connections/:id/hepsiburada-tracking-history', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { page = 0, size = 20 } = req.query;
    const service = new HepsiburadaService(connection);
    const data = await service.getTrackingHistory(parseInt(page), parseInt(size));
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: list store products by status
router.get('/connections/:id/hepsiburada-products', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { status, page = 0, size = 100 } = req.query;
    const service = new HepsiburadaService(connection);
    const data = await service.getProductsByStatus(status, parseInt(page), parseInt(size));
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: batch approve PRE_MATCHED products
router.post('/connections/:id/hepsiburada-approve-prematch', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { merchantSkuList } = req.body;
    if (!Array.isArray(merchantSkuList) || merchantSkuList.length === 0) return res.status(400).json({ error: 'merchantSkuList gerekli' });
    const service = new HepsiburadaService(connection);
    const data = await service.approvePrematch(merchantSkuList);
    res.json(data || { success: true });
  } catch (error) { next(error); }
});

// HepsiBurada: batch reject PRE_MATCHED products
router.post('/connections/:id/hepsiburada-reject-prematch', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { merchantSkuList } = req.body;
    if (!Array.isArray(merchantSkuList) || merchantSkuList.length === 0) return res.status(400).json({ error: 'merchantSkuList gerekli' });
    const service = new HepsiburadaService(connection);
    const data = await service.rejectPrematch(merchantSkuList);
    res.json(data || { success: true });
  } catch (error) { next(error); }
});

// HepsiBurada: all products of merchant (searchable by barcode/merchantSku/hbSku)
router.get('/connections/:id/hepsiburada-all-products', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { barcode, merchantSku, hbSku, page = 0, size = 100 } = req.query;
    const service = new HepsiburadaService(connection);
    const data = await service.getAllMerchantProducts({ barcode, merchantSku, hbSku, page: parseInt(page), size: parseInt(size) });
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: fast listing (simplified product creation for catalog-matched products)
router.post('/connections/:id/hepsiburada-fastlisting', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const products = req.body;
    if (!Array.isArray(products) || products.length === 0) return res.status(400).json({ error: 'Ürün listesi gerekli' });
    const service = new HepsiburadaService(connection);
    const data = await service.fastListing(products);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: delete products by merchantSku list
router.post('/connections/:id/hepsiburada-delete-products', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { merchantSkuList } = req.body;
    if (!Array.isArray(merchantSkuList) || merchantSkuList.length === 0) return res.status(400).json({ error: 'merchantSkuList gerekli' });
    const service = new HepsiburadaService(connection);
    const data = await service.deleteProducts(merchantSkuList);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: check delete process status
router.get('/connections/:id/hepsiburada-delete-process/:trackingId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const service = new HepsiburadaService(connection);
    const data = await service.getDeleteProcess(req.params.trackingId);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: check product status by merchantSku list
router.post('/connections/:id/hepsiburada-check-status', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { merchantSkuList } = req.body;
    if (!Array.isArray(merchantSkuList) || merchantSkuList.length === 0) return res.status(400).json({ error: 'merchantSkuList gerekli' });
    const service = new HepsiburadaService(connection);
    const data = await service.checkProductStatus(merchantSkuList);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: Upload product content update (Ticket API)
router.post('/connections/:id/hepsiburada-update-products', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Güncellenecek ürün listesi (items) gerekli' });
    if (!items.every(i => i.hbSku)) return res.status(400).json({ error: 'Her ürün için hbSku zorunludur' });
    const service = new HepsiburadaService(connection);
    const data = await service.uploadProductUpdate(items);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: Get ticket status by trackingId
router.get('/connections/:id/hepsiburada-ticket-status/:trackingId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { page = 0, size = 1000 } = req.query;
    const service = new HepsiburadaService(connection);
    const data = await service.getTicketStatus(req.params.trackingId, parseInt(page), parseInt(size));
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: Get product update history by hbSku
router.get('/connections/:id/hepsiburada-update-history/:hbSku', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const service = new HepsiburadaService(connection);
    const data = await service.getProductUpdateHistory(req.params.hbSku);
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: List customer questions
router.get('/connections/:id/hepsiburada-questions', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { status, sortBy = 0, page = 0, size = 20 } = req.query;
    const service = new HepsiburadaService(connection);
    const data = await service.getQuestions(
      status !== undefined && status !== '' ? parseInt(status) : undefined,
      parseInt(sortBy), parseInt(page), parseInt(size)
    );
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: Question counts by status
router.get('/connections/:id/hepsiburada-questions/count', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const service = new HepsiburadaService(connection);
    const data = await service.getQuestionCount();
    res.json(data);
  } catch (error) { next(error); }
});

// HepsiBurada: Answer a question
router.post('/connections/:id/hepsiburada-questions/:number/answer', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { answerText } = req.body;
    if (!answerText?.trim()) return res.status(400).json({ error: 'Yanıt boş olamaz' });
    const service = new HepsiburadaService(connection);
    const data = await service.answerQuestion(req.params.number, answerText.trim());
    res.json(data || { success: true });
  } catch (error) { next(error); }
});

// HepsiBurada: Reject/report a question
router.post('/connections/:id/hepsiburada-questions/:number/reject', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    const { rejectReason } = req.body;
    if (!rejectReason?.trim()) return res.status(400).json({ error: 'Sorun sebebi boş olamaz' });
    const service = new HepsiburadaService(connection);
    const data = await service.rejectQuestion(req.params.number, rejectReason.trim());
    res.json(data || { success: true });
  } catch (error) { next(error); }
});

// Get category attributes (Trendyol or HepsiBurada)
router.get('/connections/:id/categories/:catId/attributes', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    if (connection.marketplaceType === 'trendyol') {
      const service = new TrendyolService(connection);
      const attributes = await service.getCategoryAttributes(parseInt(req.params.catId));
      return res.json(attributes);
    }
    if (connection.marketplaceType === 'hepsiburada') {
      const service = new HepsiburadaService(connection);
      const data = await service.getCategoryAttributes(req.params.catId);
      return res.json(data);
    }
    res.json({ categoryAttributes: [] });
  } catch (error) { next(error); }
});

// HepsiBurada: get enum attribute values (version=5, page/size, optional modifiedAtSince)
router.get('/connections/:id/hepsiburada-attribute-values/:catId/:attrId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'hepsiburada') {
      return res.status(400).json({ error: 'HepsiBurada bağlantısı bulunamadı' });
    }
    const service = new HepsiburadaService(connection);
    const page = parseInt(req.query.page) || 0;
    const size = Math.min(parseInt(req.query.size) || 1000, 1000);
    const modifiedAtSince = req.query.modifiedAtSince || undefined;
    const data = await service.getAttributeValues(req.params.catId, req.params.attrId, page, size, modifiedAtSince);
    res.json(data);
  } catch (error) { next(error); }
});

// Search brands (Trendyol)
router.get('/connections/:id/brands/search', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    if (connection.marketplaceType === 'trendyol') {
      const service = new TrendyolService(connection);
      const brands = await service.searchBrand(req.query.name || '');
      return res.json(brands);
    }
    res.json([]);
  } catch (error) { next(error); }
});

// Category mappings - list (includes global provider mappings merged in)
router.get('/connections/:id/category-mappings', async (req, res, next) => {
  try {
    const [mappings, connection] = await Promise.all([
      prisma.categoryMapping.findMany({
        where: { connectionId: req.params.id },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.marketplaceConnection.findUnique({
        where: { id: req.params.id },
        select: { storeId: true }
      })
    ]);

    // Merge in global provider category mappings for XML sources in this store
    if (connection) {
      const xmlSources = await prisma.xmlSource.findMany({
        where: { storeId: connection.storeId, globalProviderId: { not: null } },
        select: { globalProviderId: true }
      });

      const providerIds = [...new Set(xmlSources.map(s => s.globalProviderId).filter(Boolean))];
      if (providerIds.length > 0) {
        const providers = await prisma.globalXmlProvider.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, categoryMappingConfig: true }
        });

        const existingCategories = new Set(mappings.map(m => m.localCategory));

        for (const provider of providers) {
          if (!provider.categoryMappingConfig) continue;
          let config;
          try { config = JSON.parse(provider.categoryMappingConfig); } catch { continue; }
          for (const [rawCategory, mapping] of Object.entries(config)) {
            const localCategory = rawCategory.trim();
            if (!mapping || !mapping.marketplaceCategoryId) continue;
            if (existingCategories.has(localCategory)) continue;
            mappings.push({
              id: `global_${provider.id}_${localCategory}`,
              connectionId: req.params.id,
              localCategory,
              marketplaceCategoryId: String(mapping.marketplaceCategoryId),
              marketplaceCategoryName: mapping.marketplaceCategoryName || null,
              attributes: mapping.attributes || null,
              isGlobal: true,
              createdAt: new Date(),
              updatedAt: new Date()
            });
            existingCategories.add(localCategory);
          }
        }
      }
    }

    res.json(mappings);
  } catch (error) { next(error); }
});

// Category mappings - create/update
router.post('/connections/:id/category-mappings', async (req, res, next) => {
  try {
    const { localCategory, marketplaceCategoryId, marketplaceCategoryName, attributes } = req.body;
    if (!localCategory || !marketplaceCategoryId) {
      return res.status(400).json({ error: 'Yerel kategori ve pazaryeri kategorisi zorunludur' });
    }

    // Upsert: aynı localCategory varsa güncelle
    const existing = await prisma.categoryMapping.findFirst({
      where: { connectionId: req.params.id, localCategory }
    });

    let mapping;
    if (existing) {
      mapping = await prisma.categoryMapping.update({
        where: { id: existing.id },
        data: {
          marketplaceCategoryId: String(marketplaceCategoryId),
          marketplaceCategoryName,
          attributes: attributes ? JSON.stringify(attributes) : null
        }
      });
    } else {
      mapping = await prisma.categoryMapping.create({
        data: {
          connectionId: req.params.id,
          localCategory,
          marketplaceCategoryId: String(marketplaceCategoryId),
          marketplaceCategoryName,
          attributes: attributes ? JSON.stringify(attributes) : null
        }
      });
    }
    res.json(mapping);
  } catch (error) { next(error); }
});

// Category mappings - delete
router.delete('/category-mappings/:id', async (req, res, next) => {
  try {
    await prisma.categoryMapping.delete({ where: { id: req.params.id } });
    res.json({ message: 'Eşleştirme silindi' });
  } catch (error) { next(error); }
});

// Get local categories (distinct categories from products)
router.get('/local-categories', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { xmlSourceId } = req.query;
    const where = { storeId: store.id, category: { not: null } };
    if (xmlSourceId) {
      where.xmlSourceId = xmlSourceId;
    } else {
      where.OR = [
        { xmlSourceId: null },
        { xmlSource: { globalProviderId: null } }
      ];
    }
    
    const products = await prisma.product.findMany({
      where,
      select: { category: true },
      distinct: ['category']
    });
    const categories = products.map(p => p.category).filter(Boolean).sort();
    res.json(categories);
  } catch (error) { next(error); }
});

// Send products to Trendyol
router.post('/connections/:id/send-products', async (req, res, next) => {
  try {
    const { productIds, minStock = 0 } = req.body;
    if (!productIds?.length) return res.status(400).json({ error: 'Ürün seçilmedi' });

    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    // Fetch products
    let products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (minStock > 0) products = products.filter(p => (p.stock ?? 0) >= minStock);
    if (products.length === 0) return res.status(400).json({ error: 'Ürün bulunamadı' });

    // Fetch category mappings
    const catMappings = await prisma.categoryMapping.findMany({ where: { connectionId: connection.id } });
    const catMap = {};
    for (const m of catMappings) { catMap[m.localCategory] = m; }

    // Fetch pricing rules for this connection
    const pricingRules = await prisma.pricingRule.findMany({
      where: { storeId: connection.storeId, applyTo: { in: ['marketplace_xml', 'price_range'] }, isActive: true },
      orderBy: { priority: 'asc' }
    });

    // Fetch Global XML Provider category mappings as fallback
    const globalCatMap = {};
    const distinctXmlSourceIds = [...new Set(products.map(p => p.xmlSourceId).filter(Boolean))];
    if (distinctXmlSourceIds.length > 0) {
      const xmlSources = await prisma.xmlSource.findMany({
        where: { id: { in: distinctXmlSourceIds }, globalProviderId: { not: null } },
        select: { id: true, globalProviderId: true }
      });
      const providerIds = [...new Set(xmlSources.map(s => s.globalProviderId).filter(Boolean))];
      if (providerIds.length > 0) {
        const providers = await prisma.globalXmlProvider.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, categoryMappingConfig: true }
        });
        const providerCatMap = Object.fromEntries(providers.map(p => [p.id, p.categoryMappingConfig]));
        for (const src of xmlSources) {
          const config = providerCatMap[src.globalProviderId];
          if (config) {
            try { globalCatMap[src.id] = JSON.parse(config); } catch(e) {}
          }
        }
      }
    }

    const pricingLookup = {};
    const priceRangeRules = [];
    for (const r of pricingRules) {
      if (!r.conditions) continue;
      try {
        const conds = JSON.parse(r.conditions);
        // Only standard (marketplace_xml) rules go into pricingLookup
        if (r.applyTo !== 'price_range' && conds.connectionId === connection.id && conds.xmlSourceId) {
          pricingLookup[conds.xmlSourceId] = r;
        }
        if (r.applyTo === 'price_range' && (conds.minPurchasePrice != null || conds.maxPurchasePrice != null)) {
          priceRangeRules.push(r);
        }
      } catch(e) {}
    }

    // Initialize Trendyol service for brand lookups
    const service = new TrendyolService(connection);

    // Brand strategy from connection config
    const connConfig = connection.config ? JSON.parse(connection.config) : {};
    const brandStrategy = connConfig.brandStrategy || 'xml';
    const defaultBrandId = connConfig.defaultBrandId || null;

    // Brand cache: brandName -> brandId (to avoid duplicate API calls)
    const brandCache = {};

    // Resolve brand ID from brand name via Trendyol API
    async function resolveBrandId(brandName) {
      if (!brandName || brandName.trim() === '') return null;
      const key = brandName.trim().toLowerCase();
      if (brandCache[key] !== undefined) return brandCache[key];

      try {
        const result = await service.searchBrand(brandName.trim());
        if (result && Array.isArray(result) && result.length > 0) {
          brandCache[key] = result[0].id;
          return result[0].id;
        }
        brandCache[key] = null;
        return null;
      } catch (err) {
        console.warn(`[Trendyol] Marka araması başarısız: "${brandName}" -`, err.message);
        brandCache[key] = null;
        return null;
      }
    }

    async function resolveProductBrandId(p) {
      if (brandStrategy === 'override') return defaultBrandId;
      // xml strategy: XML brand first, fallback to defaultBrandId
      let id = null;
      if (p.brand) id = await resolveBrandId(p.brand);
      if (!id) id = defaultBrandId;
      return id;
    }

    // Resolve category mapping, handling pipe-separated category strings (e.g. "Kadın|Kolye|")
    const resolveCatMapping = (category, catMap, xmlSourceId, globalCatMap) => {
      if (!category) return null;
      if (catMap[category]) return catMap[category];
      if (xmlSourceId && globalCatMap[xmlSourceId]?.[category]) return globalCatMap[xmlSourceId][category];
      if (category.includes('|')) {
        const parts = category.split('|').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          if (catMap[part]) return catMap[part];
          if (xmlSourceId && globalCatMap[xmlSourceId]?.[part]) return globalCatMap[xmlSourceId][part];
        }
      }
      return null;
    };

    // Format products for Trendyol
    const formatted = [];
    const errors = [];
    for (const p of products) {
      let mapping = resolveCatMapping(p.category, catMap, p.xmlSourceId, globalCatMap);
      
      if (!mapping) {
        errors.push(`${p.sku}: Kategori eşleştirmesi yok (${p.category || 'Kategori boş'})`);
        continue;
      }
      if (!p.barcode) {
        errors.push(`${p.sku}: Barkod eksik`);
        continue;
      }
      if (/[{}]/.test(p.barcode) || p.barcode.trim().length < 3) {
        errors.push(`${p.sku}: Barkod geçersiz (${p.barcode})`);
        continue;
      }

      // Find and apply Pricing Rule
      const rule = pricingLookup[p.xmlSourceId];
      const xmlPrice = p.xmlPrice || p.price;
      const rangeMatch = !rule ? matchPriceRangeRule(xmlPrice, priceRangeRules, connection.id, p.xmlSourceId) : null;

      if (!rule && !rangeMatch) {
        errors.push(`${p.sku}: Fiyatlandırma kuralı eksik (Fiyatlandırma sayfasından kural tanımlayın)`);
        continue;
      }

      let finalPrice = p.price;
      if (rule) {
        if (rule.type === 'percentage') {
          finalPrice = finalPrice * (1 + rule.value / 100);
        } else if (rule.type === 'fixed') {
          finalPrice = finalPrice + rule.value;
        }
      } else {
        finalPrice = calcPriceRangePrice(xmlPrice, rangeMatch.rule, rangeMatch.conds);
      }
      p.price = Math.round(Math.max(0, finalPrice) * 100) / 100;

      // Parse mapped attributes
      const attributes = [];
      if (mapping.attributes) {
        try {
          const parsedAttrs = JSON.parse(mapping.attributes);
          for (const [attrId, attrObj] of Object.entries(parsedAttrs)) {
            if (!attrObj.valueId && !attrObj.valueName) continue;
            
            if (attrObj.valueId) {
              attributes.push({
                attributeId: parseInt(attrId),
                attributeValueId: parseInt(attrObj.valueId)
              });
            } else if (attrObj.valueName) {
              let finalValue = attrObj.valueName;
              // Desteklenen dinamik alanlar örn: {brand}, {color}, {size}
              if (finalValue.includes('{') && finalValue.includes('}')) {
                const fieldName = finalValue.replace(/[{}]/g, '');
                
                // Önce ürünün ana alanlarında ara
                if (p[fieldName] !== undefined && p[fieldName] !== null) {
                  finalValue = String(p[fieldName]);
                } else if (p.attributes) {
                  // Ürünün JSON özelliklerinde ara
                  try {
                    const pAttrs = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : p.attributes;
                    if (pAttrs[fieldName]) finalValue = String(pAttrs[fieldName]);
                    // Case insensitive search
                    else {
                      const foundKey = Object.keys(pAttrs).find(k => k.toLowerCase() === fieldName.toLowerCase());
                      if (foundKey) finalValue = String(pAttrs[foundKey]);
                    }
                  } catch (e) {}
                }
              }
              
              attributes.push({
                attributeId: parseInt(attrId),
                customAttributeValue: finalValue
              });
            }
          }
        } catch (e) {}
      }

      const brandId = await resolveProductBrandId(p);
      if (!brandId) {
        errors.push(`${p.sku}: Marka bulunamadı (${p.brand || 'Marka boş'}). Bağlantı ayarlarından varsayılan marka seçin.`);
        continue;
      }

      const item = TrendyolService.formatProduct(p, mapping.marketplaceCategoryId, brandId, attributes);
      formatted.push(item);
    }

    if (formatted.length === 0) {
      return res.status(400).json({ error: 'Gönderilebilir ürün yok', details: errors });
    }

    // Debug: Log payload being sent
    console.log('[Trendyol Send] Seller ID:', connection.sellerId);
    console.log('[Trendyol Send] Base URL:', connection.baseUrl || process.env.TRENDYOL_BASE_URL);
    console.log('[Trendyol Send] Products count:', formatted.length);
    console.log('[Trendyol Send] First product sample:', JSON.stringify(formatted[0], null, 2));
    
    const result = await service.createProducts(formatted);

    // Create MarketplaceProduct records
    for (const p of products) {
      const mapping = resolveCatMapping(p.category, catMap, p.xmlSourceId, globalCatMap);
      if (!mapping || !p.barcode) continue;

      await prisma.marketplaceProduct.upsert({
        where: {
          productId_connectionId: { productId: p.id, connectionId: connection.id }
        },
        update: {
          marketplacePrice: p.price,
          marketplaceStock: p.stock,
          status: 'pending',
          lastSyncedAt: new Date(),
          batchRequestId: result?.batchRequestId || null
        },
        create: {
          productId: p.id,
          connectionId: connection.id,
          marketplacePrice: p.price,
          marketplaceStock: p.stock,
          status: 'pending',
          batchRequestId: result?.batchRequestId || null
        }
      });
    }

    await notificationService.create({
      storeId: connection.storeId,
      title: 'Ürün Gönderimi',
      message: `${formatted.length} ürün Trendyol'a gönderildi.${errors.length > 0 ? ` ${errors.length} hata var.` : ''}`,
      type: errors.length > 0 ? 'warning' : 'success',
      link: '/trendyol-send',
      data: {
        notifType: 'trendyol_send',
        products: products.filter(p => p.barcode).slice(0, 50).map(p => ({
          title: p.title, barcode: p.barcode, sku: p.sku, price: p.price, stock: p.stock
        })),
        errorCount: errors.length,
        errors: errors.slice(0, 10)
      }
    });

    res.json({
      message: `${formatted.length} ürün Trendyol'a gönderildi`,
      sent: formatted.length,
      errors: errors.length,
      errorDetails: errors,
      batchId: result?.batchRequestId || null
    });
  } catch (error) {
    console.error('[Trendyol Send Error]', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      url: error.config?.url
    });
    
    const errorMsg = typeof error.response?.data === 'string' 
      ? error.response.data 
      : error.response?.data?.errors?.[0]?.message || error.response?.data?.message || error.message;

    // Log the error to Audit Logs
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TRENDYOL_SEND_ERROR',
        details: JSON.stringify({ error: errorMsg, status: error.response?.status }),
        level: 'ERROR'
      }
    }).catch(err => console.error("Audit log error:", err));
    
    if (error.response?.data) {
      return res.status(400).json({ 
        error: 'Trendyol API hatası', 
        details: error.response.data,
        status: error.response.status,
        message: errorMsg
      });
    }
    next(error);
  }
});

// Bulk send all ready products to Trendyol (batches of 100, 100ms delay between batches)
router.post('/connections/:id/send-all-ready', async (req, res, next) => {
  try {
    const { xmlSourceId, minStock = 0, localCategories } = req.body;

    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    // Fetch all products for this store
    const productWhere = { storeId: connection.storeId };
    if (xmlSourceId) productWhere.xmlSourceId = xmlSourceId;
    if (Array.isArray(localCategories) && localCategories.length > 0) {
      productWhere.OR = localCategories.flatMap(c => [
        { category: c },
        { category: { contains: `|${c}|` } },
        { category: { startsWith: `${c}|` } },
        { category: { endsWith: `|${c}` } },
      ]);
    }
    const products = await prisma.product.findMany({ where: productWhere });

    if (products.length === 0) return res.status(400).json({ error: 'Ürün bulunamadı' });

    // Category mappings
    const catMappings = await prisma.categoryMapping.findMany({ where: { connectionId: connection.id } });
    const catMap = {};
    for (const m of catMappings) catMap[m.localCategory] = m;

    // Pricing rules
    const pricingRules = await prisma.pricingRule.findMany({
      where: { storeId: connection.storeId, applyTo: { in: ['marketplace_xml', 'price_range'] }, isActive: true },
      orderBy: { priority: 'asc' }
    });

    // Global XML Provider category mappings as fallback
    const globalCatMap = {};
    const distinctXmlSourceIds = [...new Set(products.map(p => p.xmlSourceId).filter(Boolean))];
    if (distinctXmlSourceIds.length > 0) {
      const xmlSources = await prisma.xmlSource.findMany({
        where: { id: { in: distinctXmlSourceIds }, globalProviderId: { not: null } },
        select: { id: true, globalProviderId: true }
      });
      const providerIds = [...new Set(xmlSources.map(s => s.globalProviderId).filter(Boolean))];
      if (providerIds.length > 0) {
        const providers = await prisma.globalXmlProvider.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, categoryMappingConfig: true }
        });
        const providerCatMap = Object.fromEntries(providers.map(p => [p.id, p.categoryMappingConfig]));
        for (const src of xmlSources) {
          const config = providerCatMap[src.globalProviderId];
          if (config) {
            try { globalCatMap[src.id] = JSON.parse(config); } catch(e) {}
          }
        }
      }
    }

    const pricingLookup = {};
    const priceRangeRules = [];
    for (const r of pricingRules) {
      if (!r.conditions) continue;
      try {
        const conds = JSON.parse(r.conditions);
        if (r.applyTo !== 'price_range' && conds.connectionId === connection.id && conds.xmlSourceId) {
          pricingLookup[conds.xmlSourceId] = r;
        }
        if (r.applyTo === 'price_range' && (conds.minPurchasePrice != null || conds.maxPurchasePrice != null)) {
          priceRangeRules.push(r);
        }
      } catch(e) {}
    }

    const service = new TrendyolService(connection);
    const connConfigAll = connection.config ? JSON.parse(connection.config) : {};
    const brandStrategyAll = connConfigAll.brandStrategy || 'xml';
    const defaultBrandIdAll = connConfigAll.defaultBrandId || null;
    const brandCache = {};

    async function resolveBrandId(brandName) {
      if (!brandName || brandName.trim() === '') return null;
      const key = brandName.trim().toLowerCase();
      if (brandCache[key] !== undefined) return brandCache[key];
      try {
        const result = await service.searchBrand(brandName.trim());
        if (result && Array.isArray(result) && result.length > 0) {
          brandCache[key] = result[0].id;
          return result[0].id;
        }
        brandCache[key] = null;
        return null;
      } catch (err) {
        brandCache[key] = null;
        return null;
      }
    }

    async function resolveProductBrandIdAll(p) {
      if (brandStrategyAll === 'override') return defaultBrandIdAll;
      let id = null;
      if (p.brand) id = await resolveBrandId(p.brand);
      if (!id) id = defaultBrandIdAll;
      return id;
    }

    const resolveCatMapping = (category, catMap, xmlSrcId, globalCatMap) => {
      if (!category) return null;
      if (catMap[category]) return catMap[category];
      if (xmlSrcId && globalCatMap[xmlSrcId]?.[category]) return globalCatMap[xmlSrcId][category];
      if (category.includes('|')) {
        const parts = category.split('|').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          if (catMap[part]) return catMap[part];
          if (xmlSrcId && globalCatMap[xmlSrcId]?.[part]) return globalCatMap[xmlSrcId][part];
        }
      }
      return null;
    };

    // Build formatted items and upsert payloads; skip ineligible products silently
    const formatted = [];
    const toUpsert = [];
    let skipped = 0;

    for (const p of products) {
      const mapping = resolveCatMapping(p.category, catMap, p.xmlSourceId, globalCatMap);
      if (!mapping || !p.barcode || /[{}]/.test(p.barcode) || p.barcode.trim().length < 3 || (minStock > 0 && (p.stock ?? 0) < minStock)) { skipped++; continue; }

      const rule = pricingLookup[p.xmlSourceId];
      const xmlPrice = p.xmlPrice || p.price;
      const rangeMatch = !rule ? matchPriceRangeRule(xmlPrice, priceRangeRules, connection.id, p.xmlSourceId) : null;
      if (!rule && !rangeMatch) { skipped++; continue; }

      let finalPrice = p.price;
      if (rule) {
        if (rule.type === 'percentage') finalPrice = finalPrice * (1 + rule.value / 100);
        else if (rule.type === 'fixed') finalPrice = finalPrice + rule.value;
      } else {
        finalPrice = calcPriceRangePrice(xmlPrice, rangeMatch.rule, rangeMatch.conds);
      }
      finalPrice = Math.round(Math.max(0, finalPrice) * 100) / 100;

      const attributes = [];
      if (mapping.attributes) {
        try {
          const parsedAttrs = JSON.parse(mapping.attributes);
          for (const [attrId, attrObj] of Object.entries(parsedAttrs)) {
            if (!attrObj.valueId && !attrObj.valueName) continue;
            if (attrObj.valueId) {
              attributes.push({ attributeId: parseInt(attrId), attributeValueId: parseInt(attrObj.valueId) });
            } else if (attrObj.valueName) {
              let finalValue = attrObj.valueName;
              if (finalValue.includes('{') && finalValue.includes('}')) {
                const fieldName = finalValue.replace(/[{}]/g, '');
                if (p[fieldName] !== undefined && p[fieldName] !== null) {
                  finalValue = String(p[fieldName]);
                } else if (p.attributes) {
                  try {
                    const pAttrs = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : p.attributes;
                    if (pAttrs[fieldName]) finalValue = String(pAttrs[fieldName]);
                    else {
                      const foundKey = Object.keys(pAttrs).find(k => k.toLowerCase() === fieldName.toLowerCase());
                      if (foundKey) finalValue = String(pAttrs[foundKey]);
                    }
                  } catch (e) {}
                }
              }
              attributes.push({ attributeId: parseInt(attrId), customAttributeValue: finalValue });
            }
          }
        } catch (e) {}
      }

      const brandId = await resolveProductBrandIdAll(p);
      if (!brandId) { skipped++; continue; }

      const item = TrendyolService.formatProduct({ ...p, price: finalPrice }, mapping.marketplaceCategoryId, brandId, attributes);
      formatted.push(item);
      toUpsert.push({ productId: p.id, price: finalPrice, stock: p.stock });
    }

    if (formatted.length === 0) {
      return res.status(400).json({ error: 'Gönderilebilir ürün yok', skipped });
    }

    // Send in batches of 100 with 100ms delay between batches
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const batchRequestIds = [];
    let batches = 0;

    for (let i = 0; i < formatted.length; i += 100) {
      const batch = formatted.slice(i, i + 100);
      const upsertBatch = toUpsert.slice(i, i + 100);

      const result = await service.createProducts(batch);
      batchRequestIds.push(result?.batchRequestId || null);
      batches++;

      for (const u of upsertBatch) {
        await prisma.marketplaceProduct.upsert({
          where: { productId_connectionId: { productId: u.productId, connectionId: connection.id } },
          update: { marketplacePrice: u.price, marketplaceStock: u.stock, status: 'pending', lastSyncedAt: new Date(), batchRequestId: result?.batchRequestId || null },
          create: { productId: u.productId, connectionId: connection.id, marketplacePrice: u.price, marketplaceStock: u.stock, status: 'pending', batchRequestId: result?.batchRequestId || null }
        });
      }

      if (i + 100 < formatted.length) await delay(100);
    }

    await notificationService.create({
      storeId: connection.storeId,
      title: 'Toplu Ürün Gönderimi',
      message: `${formatted.length} ürün ${batches} parti halinde Trendyol'a gönderildi. ${skipped > 0 ? `${skipped} ürün atlandı.` : ''}`,
      type: 'success',
      link: '/trendyol-send',
      data: {
        notifType: 'trendyol_send',
        products: products.filter(p => p.barcode).slice(0, 50).map(p => ({
          title: p.title, barcode: p.barcode, sku: p.sku, price: p.price, stock: p.stock
        })),
        errorCount: skipped,
        errors: []
      }
    });

    res.json({ sent: formatted.length, skipped, batches, batchRequestIds });
  } catch (error) {
    console.error('[Trendyol Send-All Error]', error.message);
    const errorMsg = typeof error.response?.data === 'string'
      ? error.response.data
      : error.response?.data?.errors?.[0]?.message || error.response?.data?.message || error.message;
    if (error.response?.data) {
      return res.status(400).json({ error: 'Trendyol API hatası', details: error.response.data, message: errorMsg });
    }
    next(error);
  }
});

// Adjust prices for losing buybox products and send to Trendyol
async function adjustBuyboxPrices(connection, barcodes, mode, amount, userId) {
  const where = { connectionId: connection.id };
  if (barcodes && barcodes.length > 0) {
    where.barcode = { in: barcodes };
  } else {
    where.buyboxOrder = { gt: 1 };
    where.buyboxPrice = { not: null };
  }

  const records = await prisma.buyboxRecord.findMany({ where });
  if (records.length === 0) return { updated: 0 };

  const productIds = [...new Set(records.map(r => r.productId).filter(Boolean))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, stock: true, listPrice: true }
  });
  const productMap = new Map(products.map(p => [p.id, p]));

  const items = records.map(r => {
    const p = productMap.get(r.productId);
    if (!p || !r.buyboxPrice) return null;
    let newPrice = r.buyboxPrice;
    if (mode === 'undercut') newPrice = Math.max(0.01, newPrice - parseFloat(amount || 0));
    newPrice = Math.round(newPrice * 100) / 100;
    return {
      barcode: r.barcode,
      quantity: p.stock ?? 0,
      salePrice: newPrice,
      listPrice: Math.max(p.listPrice || 0, newPrice),
      _productId: r.productId,
    };
  }).filter(Boolean);

  if (items.length === 0) return { updated: 0, creditUsed: 0 };

  // Credit deduction: configurable per-product cost
  const costPerProduct = parseFloat(await getSetting('credit_buybox_adjust', '0.1'));
  const totalCost = Math.round(items.length * costPerProduct * 100) / 100;
  if (totalCost > 0 && userId) {
    await deductCredits(userId, totalCost, 'buybox_adjust', `BuyBox fiyat güncelleme: ${items.length} ürün`, connection.id);
  }

  const service = new TrendyolService(connection);
  const result = await service.updatePriceAndInventory(items.map(({ _productId, ...i }) => i));

  for (const item of items) {
    if (!item._productId) continue;
    await prisma.marketplaceProduct.updateMany({
      where: { connectionId: connection.id, productId: item._productId },
      data: { marketplacePrice: item.salePrice, lastSyncedAt: new Date() }
    });
  }

  return { updated: items.length, batchId: result?.batchRequestId, creditUsed: totalCost };
}

// Update or create a single BuyboxRecord, cleaning up any duplicates for the same (connectionId, barcode)
async function upsertBuyboxRecord(connectionId, barcode, data) {
  const existing = await prisma.buyboxRecord.findMany({
    where: { connectionId, barcode },
    orderBy: { checkedAt: 'desc' },
    select: { id: true }
  });
  if (existing.length > 1) {
    await prisma.buyboxRecord.deleteMany({ where: { id: { in: existing.slice(1).map(r => r.id) } } });
  }
  if (existing.length >= 1) {
    await prisma.buyboxRecord.update({ where: { id: existing[0].id }, data });
  } else {
    await prisma.buyboxRecord.create({ data: { connectionId, barcode, ...data } });
  }
}

// BuyBox check — query Trendyol buybox info, rotate through products by oldest-checked-first
router.post('/connections/:id/buybox-check', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const batchSize = Math.max(0, parseInt(req.body?.batchSize ?? 50));
    const service = new TrendyolService(connection);

    // ── Build eligible items ──────────────────────────────────────────────
    // Each item: { barcode, productId: string|null, title: string|null, sku: string|null, ourPrice: number|null }
    let eligibleItems = [];

    const mpProducts = await prisma.marketplaceProduct.findMany({
      where: { connectionId: connection.id },
      include: { product: { select: { id: true, title: true, barcode: true, sku: true } } }
    });

    if (mpProducts.length > 0) {
      // Path A: local products exist
      const mpWithBarcode = mpProducts.filter(mp => mp.product?.barcode);
      const mpWithoutBarcode = mpProducts.filter(mp => mp.product && !mp.product.barcode);

      // Backfill: recover barcodes from previous BuyboxRecord for products whose barcode was cleared
      const backfillMap = new Map();
      if (mpWithoutBarcode.length > 0) {
        const productIds = mpWithoutBarcode.map(mp => mp.product.id);
        const oldRecs = await prisma.buyboxRecord.findMany({
          where: { connectionId: connection.id, productId: { in: productIds } },
          select: { productId: true, barcode: true },
          orderBy: { checkedAt: 'desc' },
        });
        for (const r of oldRecs) {
          if (r.productId && r.barcode && !backfillMap.has(r.productId)) backfillMap.set(r.productId, r.barcode);
        }
      }

      const allMp = [
        ...mpWithBarcode,
        ...mpWithoutBarcode.filter(mp => backfillMap.has(mp.product.id)),
      ];
      eligibleItems = allMp.map(mp => ({
        barcode: mp.product.barcode || backfillMap.get(mp.product.id),
        productId: mp.product.id,
        title: mp.product.title,
        sku: mp.product.sku,
        ourPrice: mp.marketplacePrice,
      }));
    }

    if (eligibleItems.length === 0) {
      // Path B: no local products — fetch barcodes directly from Trendyol
      let page = 0;
      let hasMore = true;
      while (hasMore && page < 20) {
        try {
          const res = await service.getProducts(page, 50);
          const items = res?.content || [];
          if (items.length === 0) { hasMore = false; break; }
          for (const tp of items) {
            const barcode = tp.barcode || tp.stockCode;
            if (barcode) {
              eligibleItems.push({
                barcode,
                productId: null,
                title: tp.title || tp.stockCode || barcode,
                sku: tp.stockCode || null,
                ourPrice: tp.salePrice || null,
              });
            }
          }
          const totalPages = res?.totalPages ?? 1;
          if (page >= totalPages - 1 || items.length < 50) hasMore = false;
          else page++;
        } catch (err) {
          console.error('[BuyBox] Trendyol direct fetch failed:', err.message);
          break;
        }
      }
    }

    if (eligibleItems.length === 0) {
      return res.status(400).json({ error: 'Kontrol edilecek ürün bulunamadı. Ürünlerinizi önce Trendyol\'a gönderin veya mağaza bağlantısını senkronize edin.' });
    }

    // ── Rotation sort ─────────────────────────────────────────────────────
    const existingRecords = await prisma.buyboxRecord.findMany({
      where: { connectionId: connection.id },
      select: { barcode: true, checkedAt: true }
    });
    const lastCheckedMap = new Map(existingRecords.map(r => [r.barcode, r.checkedAt]));

    eligibleItems.sort((a, b) =>
      (lastCheckedMap.get(a.barcode)?.getTime() ?? 0) - (lastCheckedMap.get(b.barcode)?.getTime() ?? 0)
    );

    const eligible = batchSize > 0 ? eligibleItems.slice(0, batchSize) : eligibleItems;

    // ── Credit deduction ──────────────────────────────────────────────────
    const creditCostPerBatch = parseFloat(await getSetting('credit_buybox_check', '1'));
    const batchCount = Math.ceil(eligible.length / 10);
    const totalCost = batchCount * creditCostPerBatch;

    if (totalCost > 0) {
      await deductCredits(req.user.id, totalCost, 'buybox_check',
        `BuyBox kontrolü: ${eligible.length} barkod, ${batchCount} istek`, connection.id);
    }

    // ── Buybox API loop ───────────────────────────────────────────────────
    const results = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const barcodeToItem = new Map(eligible.map(item => [item.barcode, item]));
    const barcodes = eligible.map(item => item.barcode);
    const now = new Date();
    const checkedBarcodes = new Set();
    const foundBarcodes = new Set();

    for (let i = 0; i < barcodes.length; i += 10) {
      const batch = barcodes.slice(i, i + 10);
      for (const b of batch) checkedBarcodes.add(b);
      try {
        const data = await service.getBuyboxInfo(batch);
        const buyboxInfoList = data?.buyboxInfo || [];

        for (const info of buyboxInfoList) {
          const item = barcodeToItem.get(info.barcode);
          if (!item) continue;

          foundBarcodes.add(info.barcode);

          await upsertBuyboxRecord(connection.id, info.barcode, {
            productId: item.productId,
            buyboxOrder: info.buyboxOrder ?? null,
            buyboxPrice: info.buyboxPrice ?? null,
            hasMultipleSeller: info.hasMultipleSeller ?? false,
            checkedAt: now,
          });

          results.push({
            barcode: info.barcode,
            productId: item.productId,
            title: item.title,
            sku: item.sku,
            ourPrice: item.ourPrice,
            buyboxOrder: info.buyboxOrder,
            buyboxPrice: info.buyboxPrice,
            hasMultipleSeller: info.hasMultipleSeller,
            isWinning: info.buyboxOrder === 1,
            checkedAt: now,
          });
        }
      } catch (batchErr) {
        console.error(`[BuyBox] Batch ${i}-${i + 10} failed:`, batchErr.message);
      }

      if (i + 10 < barcodes.length) await delay(100);
    }

    // ── Cleanup stale records ─────────────────────────────────────────────
    const notFoundBarcodes = [...checkedBarcodes].filter(b => !foundBarcodes.has(b));
    if (notFoundBarcodes.length > 0) {
      await prisma.buyboxRecord.deleteMany({ where: { connectionId: connection.id, barcode: { in: notFoundBarcodes } } });
    }

    const allEligibleBarcodes = eligibleItems.map(i => i.barcode).filter(Boolean);
    if (allEligibleBarcodes.length > 0) {
      await prisma.buyboxRecord.deleteMany({ where: { connectionId: connection.id, barcode: { notIn: allEligibleBarcodes } } });
    }

    // ── Notifications & auto-adjust ───────────────────────────────────────
    const losing = results.filter(r => r.buyboxOrder !== null && r.buyboxOrder > 1);
    const winning = results.filter(r => r.buyboxOrder === 1);

    if (losing.length > 0) {
      await notificationService.create({
        storeId: connection.storeId,
        title: 'BuyBox Uyarısı',
        message: `${losing.length} üründe BuyBox kazanılamıyor. ${winning.length} ürün kazanıyor.`,
        type: 'warning',
        link: '/buybox',
        data: {
          notifType: 'buybox_check',
          winning: winning.length,
          losing: losing.length,
          checked: results.length,
          results: results.slice(0, 100).map(r => ({
            barcode: r.barcode, title: r.title, ourPrice: r.ourPrice,
            buyboxPrice: r.buyboxPrice, buyboxOrder: r.buyboxOrder,
            hasMultipleSeller: r.hasMultipleSeller, isWinning: r.buyboxOrder === 1
          }))
        }
      });
    }

    let autoAdjusted = 0;
    try {
      const cfg = connection.config ? JSON.parse(connection.config) : {};
      if (cfg.buyboxAutoAdjust && losing.length > 0) {
        const ar = await adjustBuyboxPrices(connection, losing.map(r => r.barcode), cfg.buyboxAutoMode || 'equal', cfg.buyboxAutoAmount || 0, req.user.id);
        autoAdjusted = ar.updated;
      }
    } catch (e) {
      console.error('[BuyBox] Auto price adjust failed:', e.message);
    }

    res.json({
      checked: results.length,
      totalEligible: eligibleItems.length,
      winning: winning.length,
      losing: losing.length,
      creditUsed: totalCost,
      autoAdjusted,
      results,
    });
  } catch (error) {
    if (error.statusCode === 402) return res.status(402).json({ error: error.message });
    next(error);
  }
});

// POST /connections/:id/buybox-price-adjust — manually adjust prices for losing (or specific) products
router.post('/connections/:id/buybox-price-adjust', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const { barcodes, mode = 'equal', amount = 0 } = req.body;
    const result = await adjustBuyboxPrices(connection, barcodes, mode, parseFloat(amount), req.user.id);

    notificationService.create({
      storeId: connection.storeId,
      title: 'BuyBox Fiyat Güncellendi',
      message: `${result.updated} ürünün fiyatı BuyBox'a göre güncellendi.`,
      type: 'success',
      link: '/buybox',
      data: { notifType: 'buybox_price_adjust', updated: result.updated, mode, amount }
    }).catch(() => {});

    res.json({ message: `${result.updated} ürünün fiyatı güncellendi`, ...result });
  } catch (error) {
    next(error);
  }
});

// PUT /connections/:id/buybox-auto-settings — save auto-adjust config to connection
router.put('/connections/:id/buybox-auto-settings', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const { enabled, mode, amount } = req.body;
    const existing = connection.config ? JSON.parse(connection.config) : {};
    const updated = {
      ...existing,
      buyboxAutoAdjust: !!enabled,
      buyboxAutoMode: mode || 'equal',
      buyboxAutoAmount: parseFloat(amount) || 0,
    };

    await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: { config: JSON.stringify(updated) }
    });

    res.json({ message: 'Otomatik ayarlar kaydedildi', config: updated });
  } catch (error) {
    next(error);
  }
});

// GET all current buybox records for a connection (deduplicated, with current marketplace price)
router.get('/connections/:id/buybox-history', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const records = await prisma.buyboxRecord.findMany({
      where: { connectionId: connection.id },
      include: { product: { select: { title: true, sku: true } } },
      orderBy: { checkedAt: 'desc' }
    });

    // Deduplicate by barcode — keep the most recent record per barcode
    const seen = new Map();
    for (const r of records) {
      if (!seen.has(r.barcode)) seen.set(r.barcode, r);
    }
    const deduped = Array.from(seen.values());

    // Attach current marketplace price from MarketplaceProduct
    const productIds = [...new Set(deduped.map(r => r.productId).filter(Boolean))];
    const mpProducts = productIds.length > 0
      ? await prisma.marketplaceProduct.findMany({
          where: { connectionId: connection.id, productId: { in: productIds } },
          select: { productId: true, marketplacePrice: true }
        })
      : [];
    const priceMap = new Map(mpProducts.map(mp => [mp.productId, mp.marketplacePrice]));

    const result = deduped.map(r => ({
      ...r,
      title: r.product?.title ?? null,
      sku: r.product?.sku ?? null,
      ourPrice: r.productId ? (priceMap.get(r.productId) ?? null) : null,
    }));

    result.sort((a, b) => (a.buyboxOrder ?? 999) - (b.buyboxOrder ?? 999));

    res.json(result);
  } catch (error) { next(error); }
});

// DELETE /connections/:id/buybox-records — clear all buybox records for a connection
router.delete('/connections/:id/buybox-records', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const { count } = await prisma.buyboxRecord.deleteMany({ where: { connectionId: connection.id } });
    res.json({ message: `${count} kayıt silindi` });
  } catch (error) { next(error); }
});

// Sync price and stock to marketplace
router.post('/connections/:id/sync-price-stock', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: { id: req.params.id }
    });
    
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    
    const { productIds } = req.body;
    
    // Find marketplace products matching these local product IDs
    const marketplaceProducts = await prisma.marketplaceProduct.findMany({
      where: {
        connectionId: connection.id,
        ...(productIds && productIds.length > 0 ? { productId: { in: productIds } } : {})
      },
      include: { product: true }
    });
    
    if (marketplaceProducts.length === 0) {
      return res.status(400).json({ error: 'Güncellenecek ürün bulunamadı. Seçtiğiniz ürünler bu pazaryerine gönderilmiş olmalı.' });
    }
    
    if (connection.marketplaceType === 'trendyol') {
      const TrendyolService = require('../services/trendyol/trendyolService');
      const service = new TrendyolService(connection);

      // Fetch pricing rules to compute correct sale price
      const pricingRules = await prisma.pricingRule.findMany({
        where: { storeId: connection.storeId, applyTo: { in: ['marketplace_xml', 'price_range'] }, isActive: true },
        orderBy: { priority: 'asc' }
      });
      const pricingLookup = {};
      const priceRangeRules = [];
      for (const r of pricingRules) {
        if (!r.conditions) continue;
        try {
          const conds = JSON.parse(r.conditions);
          if (r.applyTo !== 'price_range' && conds.connectionId === connection.id && conds.xmlSourceId) {
            pricingLookup[conds.xmlSourceId] = r;
          }
          if (r.applyTo === 'price_range' && (conds.minPurchasePrice != null || conds.maxPurchasePrice != null)) {
            priceRangeRules.push(r);
          }
        } catch(e) {}
      }

      const items = marketplaceProducts.map(mp => {
        const p = mp.product;
        const xmlPrice = p.xmlPrice || p.price;
        let finalPrice = p.price;
        const rule = pricingLookup[p.xmlSourceId];
        if (rule) {
          if (rule.type === 'percentage') finalPrice = finalPrice * (1 + rule.value / 100);
          else if (rule.type === 'fixed') finalPrice = finalPrice + rule.value;
          finalPrice = Math.round(Math.max(0, finalPrice) * 100) / 100;
        } else {
          const match = matchPriceRangeRule(xmlPrice, priceRangeRules, connection.id, p.xmlSourceId);
          if (match) finalPrice = calcPriceRangePrice(xmlPrice, match.rule, match.conds);
        }
        return {
          barcode: p.barcode || p.sku,
          quantity: p.stock,
          salePrice: finalPrice,
          listPrice: Math.max(p.listPrice || 0, finalPrice)
        };
      });

      const result = await service.updatePriceAndInventory(items);

      // Update local marketplace product records with the new price/stock and batchRequestId
      for (const mp of marketplaceProducts) {
        const item = items.find(i => i.barcode === (mp.product.barcode || mp.product.sku));
        await prisma.marketplaceProduct.update({
          where: { id: mp.id },
          data: {
            marketplacePrice: item?.salePrice ?? mp.product.price,
            marketplaceStock: mp.product.stock,
            batchRequestId: result?.batchRequestId || mp.batchRequestId,
            lastSyncedAt: new Date()
          }
        });
      }

      notificationService.create({
        storeId: connection.storeId,
        title: 'Fiyat/Stok Güncellendi',
        message: `${items.length} ürünün fiyat ve stok bilgisi Trendyol'a gönderildi.`,
        type: 'success',
        link: '/trendyol-send',
        data: {
          notifType: 'trendyol_price_sync',
          items: marketplaceProducts.slice(0, 100).map((mp, i) => ({
            title: mp.product.title,
            barcode: mp.product.barcode || mp.product.sku,
            oldPrice: mp.marketplacePrice,
            newPrice: items[i]?.salePrice ?? mp.product.price,
            oldStock: mp.marketplaceStock,
            newStock: mp.product.stock
          }))
        }
      });

      res.json({
        message: `${items.length} ürünün fiyat ve stok bilgileri Trendyol'a gönderildi.`,
        batchId: result?.batchRequestId
      });
    } else {
      res.status(400).json({ error: 'Bu pazaryeri için henüz fiyat/stok güncellemesi desteklenmiyor' });
    }
  } catch (error) {
    console.error('[Marketplace Sync Error]', error.response?.data || error.message);
    
    // Log the error to Audit Logs
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'TRENDYOL_SYNC_ERROR',
        details: JSON.stringify({ error: error.response?.data || error.message, action: 'price_stock_sync' }),
        level: 'ERROR'
      }
    }).catch(err => console.error("Audit log error:", err));

    res.status(500).json({ error: 'Pazaryeri güncellenirken hata oluştu', details: error.response?.data });
  }
});

// Sync product statuses from marketplace (using batch request results and fallback)
router.post('/connections/:id/sync-status', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: { id: req.params.id }
    });
    
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    
    if (connection.marketplaceType === 'trendyol') {
      const TrendyolService = require('../services/trendyol/trendyolService');
      const service = new TrendyolService(connection);
      
      // Get all pending products
      const allPendingProducts = await prisma.marketplaceProduct.findMany({
        where: { connectionId: connection.id, status: 'pending' },
        include: { product: true }
      });

      let updatedCount = 0;
      let activated = 0;
      let rejected = 0;
      let batchChecked = 0;
      let fallbackChecked = 0;
      let errorMessages = [];

      // --- 1. Check via getBatchRequestResult (PRIMARY) ---
      const productsWithBatch = allPendingProducts.filter(p => p.batchRequestId != null);
      if (productsWithBatch.length > 0) {
        const batchIds = [...new Set(productsWithBatch.map(p => p.batchRequestId))];
        batchChecked = productsWithBatch.length;

        for (const batchId of batchIds) {
          try {
            const batchResult = await service.getBatchRequestResult(batchId);
            if (!batchResult) continue;

            // Trendyol uses IN_PROGRESS (not PROCESSING) — skip until COMPLETED
            if (batchResult.status === 'IN_PROGRESS') continue;

            const batchType = batchResult.batchRequestType || '';
            // Only ProductV2OnBoarding flips a product from pending → active/rejected.
            // All other types (ProductV2Update, ApprovedProductContentUpdate,
            // ProductInventoryUpdate, etc.) don't change the listing approval status.
            const isOnboarding = batchType === 'ProductV2OnBoarding';

            if (!Array.isArray(batchResult.items)) continue;

            for (const item of batchResult.items) {
              // Skip items still processing
              if (item.status === 'IN_PROGRESS') continue;

              // Extract barcode by batchRequestType:
              // ProductV2OnBoarding / ProductV2Update / ProductInventoryUpdate:
              //   requestItem.barcode | requestItem.stockCode | requestItem.productMainId
              // ApprovedProductContentUpdate:
              //   requestItem.contentId (no barcode — match by marketplaceProductId instead)
              const ri = item.requestItem || {};

              let matchingMp = null;

              if (batchType === 'ApprovedProductContentUpdate') {
                // Match via contentId stored as marketplaceProductId
                const contentId = ri.contentId != null ? String(ri.contentId) : null;
                if (contentId) {
                  matchingMp = productsWithBatch.find(p =>
                    p.batchRequestId === batchId &&
                    p.marketplaceProductId === contentId
                  );
                }
              } else {
                const barcode =
                  ri.barcode ||
                  ri.stockCode ||
                  ri.productMainId ||
                  ri.product?.barcode ||
                  ri.updateRequest?.barcode ||
                  (Array.isArray(ri.items) && ri.items[0]?.barcode) ||
                  null;

                if (barcode) {
                  matchingMp = productsWithBatch.find(p =>
                    p.batchRequestId === batchId &&
                    (p.product.barcode === barcode || p.product.sku === barcode)
                  );
                }
              }

              if (!matchingMp) continue;

              let newStatus = matchingMp.status;
              let newError = matchingMp.errorMessage;

              if (item.status === 'SUCCESS' && isOnboarding) {
                // Only onboarding SUCCESS means the product listing was approved
                newStatus = 'active';
                newError = null;
              } else if (item.status === 'FAILED') {
                // Any batch type can FAIL — record the rejection reason
                newStatus = 'rejected';
                newError = (item.failureReasons || []).join(', ') || 'Trendyol tarafından reddedildi';
              }
              // Non-onboarding SUCCESS = update accepted, listing status unchanged

              if (newStatus !== matchingMp.status) {
                await prisma.marketplaceProduct.update({
                  where: { id: matchingMp.id },
                  data: { status: newStatus, errorMessage: newError, lastSyncedAt: new Date() }
                });
                updatedCount++;
                if (newStatus === 'active') activated++;
                if (newStatus === 'rejected') rejected++;
                const idx = allPendingProducts.findIndex(p => p.id === matchingMp.id);
                if (idx !== -1) allPendingProducts.splice(idx, 1);
              }
            }
          } catch (err) {
            console.error(`[Trendyol Batch Check Error] ${batchId}`, err.response?.data || err.message);
            errorMessages.push(`Toplu işlem (${batchId.substring(0,8)}…) sorgulanamadı: ${err.message}`);
          }
        }
      }

      // --- 2. Fallback: Check remaining via getProducts (for products without batchId) ---
      const stillPending = allPendingProducts.filter(p => p.status === 'pending').slice(0, 50);
      fallbackChecked = stillPending.length;

      if (stillPending.length > 0) {
        const barcodesToSearch = [];
        const barcodeMap = new Map();

        for (const mp of stillPending) {
          const searchParam = mp.product.barcode || mp.product.sku;
          if (searchParam) {
            barcodesToSearch.push(searchParam);
            barcodeMap.set(searchParam, mp);
          }
        }

        if (barcodesToSearch.length > 0) {
          try {
            const activeRes = await service.getProducts(0, 50, true, barcodesToSearch);
            if (activeRes && activeRes.content && Array.isArray(activeRes.content)) {
              for (const tp of activeRes.content) {
                const matchedMp = barcodeMap.get(tp.barcode) || barcodeMap.get(tp.stockCode);
                if (matchedMp) {
                  await prisma.marketplaceProduct.update({
                    where: { id: matchedMp.id },
                    data: { status: 'active', errorMessage: null }
                  });
                  updatedCount++;
                  activated++;
                  barcodeMap.delete(tp.barcode);
                  barcodeMap.delete(tp.stockCode);
                }
              }
            }

            const remainingBarcodes = Array.from(barcodeMap.keys());
            if (remainingBarcodes.length > 0) {
              const inactiveRes = await service.getProducts(0, 50, false, remainingBarcodes);
              if (inactiveRes && inactiveRes.content && Array.isArray(inactiveRes.content)) {
                for (const tp of inactiveRes.content) {
                  const matchedMp = barcodeMap.get(tp.barcode) || barcodeMap.get(tp.stockCode);
                  if (matchedMp) {
                    const isRejected = tp.rejected || (tp.rejectReason && tp.rejectReason.length > 0);
                    if (isRejected) {
                      await prisma.marketplaceProduct.update({
                        where: { id: matchedMp.id },
                        data: {
                          status: 'rejected',
                          errorMessage: tp.rejectReason || 'Trendyol tarafından reddedildi'
                        }
                      });
                      updatedCount++;
                      rejected++;
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[Trendyol Fallback Sync Error]`, err.message);
            errorMessages.push(`Barkod eşleştirme sorgulanamadı: ${err.message}`);
          }
        }
      }
      
      // --- 3. Discover products already on Trendyol that don't have a MarketplaceProduct record ---
      // Fetch ALL Trendyol products paginated (no barcode filter — multi-barcode filter is unreliable)
      // and match against our local product barcodes.
      const allStoreProducts = await prisma.product.findMany({
        where: { storeId: connection.storeId, barcode: { not: null } },
        select: { id: true, barcode: true, sku: true, price: true, listPrice: true, stock: true }
      });

      const existingMpIds = new Set(
        (await prisma.marketplaceProduct.findMany({ where: { connectionId: connection.id }, select: { productId: true } }))
          .map(mp => mp.productId)
      );

      // Build barcode → local product map (only products without a record)
      const localBarcodeMap = new Map();
      for (const p of allStoreProducts) {
        if (!existingMpIds.has(p.id) && p.barcode) {
          localBarcodeMap.set(p.barcode, p);
          if (p.sku && p.sku !== p.barcode) localBarcodeMap.set(p.sku, p);
        }
      }

      let discovered = 0;

      if (localBarcodeMap.size > 0) {
        let page = 0;
        let hasMore = true;

        while (hasMore) {
          try {
            const res = await service.getProducts(page, 50, true, []);
            const items = res?.content || [];
            if (items.length === 0) { hasMore = false; break; }

            for (const tp of items) {
              const barcode = tp.barcode || tp.stockCode;
              const product = localBarcodeMap.get(barcode);
              if (!product) continue;
              try {
                await prisma.marketplaceProduct.create({
                  data: {
                    productId: product.id,
                    connectionId: connection.id,
                    marketplaceProductId: String(tp.id || tp.productCode || ''),
                    marketplacePrice: tp.salePrice || product.price,
                    marketplaceStock: tp.quantity ?? product.stock,
                    status: 'active',
                    lastSyncedAt: new Date()
                  }
                });
                localBarcodeMap.delete(barcode);
                discovered++;
                updatedCount++;
              } catch (dupErr) { /* already exists, ignore */ }
            }

            const totalPages = res?.totalPages ?? 1;
            if (page >= totalPages - 1 || items.length < 50) hasMore = false;
            else page++;
          } catch (err) {
            console.error('[Trendyol Discovery Error] page', page, err.message);
            hasMore = false;
          }
        }
      }

      if (discovered > 0) {
        console.log(`[Trendyol Sync] Discovered ${discovered} previously untracked products`);
      }

      // --- 4. Detect active products that were removed/archived/rejected on Trendyol ---
      // Fetch our currently-active MarketplaceProduct records, then paginate through
      // Trendyol's archived and rejected lists to find ones we still show as active.
      let passived = 0;
      try {
        const activeMps = await prisma.marketplaceProduct.findMany({
          where: { connectionId: connection.id, status: 'active' },
          include: { product: { select: { barcode: true, sku: true } } }
        });

        if (activeMps.length > 0) {
          // Build barcode → MarketplaceProduct map for our active products
          const activeBarcodeMap = new Map();
          for (const mp of activeMps) {
            if (mp.product.barcode) activeBarcodeMap.set(mp.product.barcode, mp);
            if (mp.product.sku && mp.product.sku !== mp.product.barcode)
              activeBarcodeMap.set(mp.product.sku, mp);
          }

          // Helper: paginate through a Trendyol filter and call handler per item
          const scanTrendyol = async (filters, handler) => {
            let page = 0;
            while (true) {
              try {
                const r = await service.getFilteredProducts(filters, page, 50);
                const items = r?.content || [];
                if (items.length === 0) break;
                for (const tp of items) handler(tp);
                const totalPages = r?.totalPages ?? 1;
                if (page >= totalPages - 1 || items.length < 50) break;
                page++;
              } catch (err) {
                console.error('[Trendyol Removal Scan Error]', filters, err.message);
                break;
              }
            }
          };

          // Collect barcodes that are archived or rejected on Trendyol
          const removedMap = new Map(); // barcode → { reason, trendyolStatus }
          await scanTrendyol({ archived: true }, tp => {
            const b = tp.barcode || tp.stockCode;
            if (b && activeBarcodeMap.has(b)) removedMap.set(b, { reason: 'Trendyol\'da arşivlendi', trendyolStatus: 'archived' });
          });
          await scanTrendyol({ rejected: true, approved: false }, tp => {
            const b = tp.barcode || tp.stockCode;
            if (b && activeBarcodeMap.has(b) && !removedMap.has(b))
              removedMap.set(b, { reason: tp.rejectReason || 'Trendyol tarafından reddedildi', trendyolStatus: 'rejected' });
          });

          // Update matched products to passive
          for (const [barcode, info] of removedMap) {
            const mp = activeBarcodeMap.get(barcode);
            if (!mp) continue;
            await prisma.marketplaceProduct.update({
              where: { id: mp.id },
              data: { status: 'passive', errorMessage: info.reason, lastSyncedAt: new Date() }
            });
            passived++;
            updatedCount++;
          }
        }
      } catch (err) {
        console.error('[Trendyol Removal Detection Error]', err.message);
        errorMessages.push(`Satıştan kaldırılan ürünler kontrol edilemedi: ${err.message}`);
      }

      const warnMsg = errorMessages.length > 0 ? ` (${errorMessages.length} hata oluştu)` : '';
      const discoverMsg = discovered > 0 ? ` ${discovered} yeni ürün Trendyol'da bulundu.` : '';
      return res.json({
        message: `${updatedCount} ürünün durumu güncellendi.${discoverMsg}${warnMsg}`,
        updated: updatedCount,
        activated,
        rejected,
        discovered,
        passived,
        batchChecked,
        fallbackChecked,
        errors: errorMessages
      });
    } else {
      res.status(400).json({ error: 'Bu pazaryeri için durum sorgulama desteklenmiyor' });
    }
  } catch (error) {
    console.error('[Marketplace Status Sync Error]', error);
    res.status(500).json({ error: 'Durumlar güncellenirken hata oluştu' });
  }
});

// GET /marketplace/trendyol-api-logs — list recent Trendyol API calls for the store's connections
router.get('/trendyol-api-logs', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const { connectionId, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Only allow logs for connections belonging to this store
    const storeConnIds = (await prisma.marketplaceConnection.findMany({
      where: { storeId: store.id },
      select: { id: true }
    })).map(c => c.id);

    const where = { connectionId: { in: storeConnIds } };
    if (connectionId && storeConnIds.includes(connectionId)) where.connectionId = connectionId;

    const [total, logs] = await Promise.all([
      prisma.trendyolApiLog.count({ where }),
      prisma.trendyolApiLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      })
    ]);

    res.json({ logs, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) { next(error); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PAZARAMA ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// GET /connections/:id/pazarama-products — list products on Pazarama
router.get('/connections/:id/pazarama-products', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'pazarama') return res.status(400).json({ error: 'Pazarama bağlantısı bulunamadı' });
    const { page = 1, size = 50, approved = 'true' } = req.query;
    const service = new PazaramaService(connection);
    const data = await service.getProducts({ page: parseInt(page), size: parseInt(size), approved: approved === 'true' });
    res.json(data);
  } catch (error) { next(error); }
});

// GET /connections/:id/pazarama-categories — category tree with attributes
router.get('/connections/:id/pazarama-categories', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'pazarama') return res.status(400).json({ error: 'Pazarama bağlantısı bulunamadı' });
    const service = new PazaramaService(connection);
    const data = await service.getCategoryTree();
    res.json(data);
  } catch (error) { next(error); }
});

// GET /connections/:id/pazarama-category-attributes/:categoryId
router.get('/connections/:id/pazarama-category-attributes/:categoryId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'pazarama') return res.status(400).json({ error: 'Pazarama bağlantısı bulunamadı' });
    const service = new PazaramaService(connection);
    const data = await service.getCategoryAttributes(req.params.categoryId);
    res.json(data);
  } catch (error) { next(error); }
});

// GET /connections/:id/pazarama-batch/:batchId — poll batch result
router.get('/connections/:id/pazarama-batch/:batchId', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'pazarama') return res.status(400).json({ error: 'Pazarama bağlantısı bulunamadı' });
    const service = new PazaramaService(connection);
    const data = await service.getBatchResult(req.params.batchId);
    res.json(data);
  } catch (error) { next(error); }
});

// POST /connections/:id/pazarama-send — send (create) products on Pazarama
router.post('/connections/:id/pazarama-send', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'pazarama') return res.status(400).json({ error: 'Pazarama bağlantısı bulunamadı' });

    const { productIds, minStock = 0, pricingRuleId } = req.body;
    if (!productIds?.length) return res.status(400).json({ error: 'Ürün seçilmedi' });

    // Load products with variants
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { variants: true },
    });

    // Load pricing rule
    let rule = null;
    if (pricingRuleId) {
      rule = await prisma.pricingRule.findUnique({ where: { id: pricingRuleId } });
    }

    const { matchPriceRangeRule, calcPriceRangePrice } = require('../utils/pricingHelper');

    const pazaramaProducts = [];
    for (const p of products) {
      if (p.stock !== null && p.stock < minStock) continue;

      const rawPrice = parseFloat(p.price || 0);
      let salePrice = rawPrice;
      if (rule) {
        const matched = matchPriceRangeRule(rule, rawPrice);
        if (matched) salePrice = calcPriceRangePrice(rawPrice, matched);
      }
      const listPrice = parseFloat((salePrice * 1.2).toFixed(2));

      pazaramaProducts.push({
        Name: p.name || p.title,
        DisplayName: p.name || p.title,
        Description: p.description || p.name || '',
        Code: p.barcode || p.sku || p.id,
        GroupCode: p.barcode || p.sku || p.id,
        StockCount: p.stock ?? 0,
        VatRate: 18,
        ListPrice: listPrice,
        SalePrice: salePrice,
        images: p.imageUrl ? [{ imageurl: p.imageUrl }] : [],
        attributes: [],
      });
    }

    if (!pazaramaProducts.length) return res.status(400).json({ error: 'Gönderilecek ürün bulunamadı (stok filtresi uygulandı)' });

    const service = new PazaramaService(connection);
    const result = await service.createProducts(pazaramaProducts);
    const batchId = result?.batchRequestId || result?.BatchRequestId || null;

    // Save marketplace products
    for (const pz of pazaramaProducts) {
      const prod = products.find(p => (p.barcode || p.sku || p.id) === pz.Code);
      if (!prod) continue;
      await prisma.marketplaceProduct.upsert({
        where: { productId_connectionId: { productId: prod.id, connectionId: connection.id } },
        create: {
          productId: prod.id,
          connectionId: connection.id,
          marketplacePrice: pz.SalePrice,
          marketplaceStock: pz.StockCount,
          batchRequestId: batchId,
          status: 'pending',
          lastSyncedAt: new Date(),
        },
        update: {
          marketplacePrice: pz.SalePrice,
          marketplaceStock: pz.StockCount,
          batchRequestId: batchId,
          status: 'pending',
          lastSyncedAt: new Date(),
        },
      });
    }

    await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date() } });

    res.json({ success: true, sent: pazaramaProducts.length, batchRequestId: batchId, result });
  } catch (error) { next(error); }
});

// POST /connections/:id/pazarama-sync — update price & stock for existing MP products
router.post('/connections/:id/pazarama-sync', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'pazarama') return res.status(400).json({ error: 'Pazarama bağlantısı bulunamadı' });

    const { productIds, pricingRuleId } = req.body;

    const where = { connectionId: connection.id };
    if (productIds?.length) where.productId = { in: productIds };

    const mps = await prisma.marketplaceProduct.findMany({
      where,
      include: { product: true },
    });

    if (!mps.length) return res.status(400).json({ error: 'Güncellenecek ürün bulunamadı' });

    let rule = null;
    if (pricingRuleId) rule = await prisma.pricingRule.findUnique({ where: { id: pricingRuleId } });

    const { matchPriceRangeRule, calcPriceRangePrice } = require('../utils/pricingHelper');

    const priceItems = [];
    const stockItems = [];

    for (const mp of mps) {
      const p = mp.product;
      const code = p.barcode || p.sku || p.id;
      const rawPrice = parseFloat(p.price || 0);
      let salePrice = rawPrice;
      if (rule) {
        const matched = matchPriceRangeRule(rule, rawPrice);
        if (matched) salePrice = calcPriceRangePrice(rawPrice, matched);
      }
      priceItems.push({ code, listPrice: parseFloat((salePrice * 1.2).toFixed(2)), salePrice });
      stockItems.push({ code, stockCount: p.stock ?? 0 });
    }

    const service = new PazaramaService(connection);
    const [priceRes, stockRes] = await Promise.all([
      service.updatePrice(priceItems),
      service.updateStock(stockItems),
    ]);

    for (const mp of mps) {
      const p = mp.product;
      const rawPrice = parseFloat(p.price || 0);
      let salePrice = rawPrice;
      if (rule) {
        const matched = matchPriceRangeRule(rule, rawPrice);
        if (matched) salePrice = calcPriceRangePrice(rawPrice, matched);
      }
      await prisma.marketplaceProduct.update({
        where: { id: mp.id },
        data: { marketplacePrice: salePrice, marketplaceStock: p.stock ?? 0, lastSyncedAt: new Date() },
      });
    }

    await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date() } });

    res.json({ success: true, updated: mps.length, priceResult: priceRes, stockResult: stockRes });
  } catch (error) { next(error); }
});

// GET /connections/:id/pazarama-orders — fetch orders
router.get('/connections/:id/pazarama-orders', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection || connection.marketplaceType !== 'pazarama') return res.status(400).json({ error: 'Pazarama bağlantısı bulunamadı' });
    const { startDate, endDate, page = 1, size = 50 } = req.query;
    const service = new PazaramaService(connection);
    const data = await service.getOrders({ startDate, endDate, page: parseInt(page), size: parseInt(size) });
    res.json(data);
  } catch (error) { next(error); }
});

module.exports = router;
