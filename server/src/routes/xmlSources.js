const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { parseXml, analyzeXml } = require('../services/xml/xmlParser');
const notificationService = require('../services/notificationService');
const { checkXmlSourceLimit, getUserQuota } = require('../utils/quotaHelper');
const { ownedParam, userStoreIds } = require('../middleware/ownership');
const { startXmlSync, isRunning } = require('../services/xml/syncService');
const productListCache = require('../services/productListCache');

const router = express.Router();
router.use(auth);
router.param('id', ownedParam('xmlSource'));


async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

// List XML sources
router.get('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const xmlSources = await prisma.xmlSource.findMany({
      where: { storeId: store.id },
      include: { _count: { select: { products: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(xmlSources);
  } catch (error) { next(error); }
});

// Analyze XML structure (before adding - discover fields)
router.post('/analyze', async (req, res, next) => {
  try {
    let { url, categoryField } = req.body;
    if (!url) return res.status(400).json({ error: 'URL zorunludur' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    const analysis = await analyzeXml(url, { categoryField });
    res.json(analysis);
  } catch (error) {
    console.error('[Analyze Error] url:', req.body?.url, '| error:', error.message);
    let msg = `XML analiz hatası: ${error.message}`;
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      msg = 'XML kaynağına bağlanılamadı: Sunucu çok yavaş yanıt veriyor veya dosya çok büyük. Lütfen URL\'yi kontrol edip tekrar deneyin. (Zaman aşımı: 120 saniye)';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      msg = 'XML kaynağına erişilemiyor: Sunucu bulunamadı veya bağlantı reddedildi. URL\'yi kontrol edin.';
    } else if (error.response?.status === 403) {
      msg = 'XML kaynağına erişim engellendi (403). Sunucu dışarıdan erişimi engelliyor olabilir.';
    } else if (error.response?.status === 404) {
      msg = 'XML dosyası bulunamadı (404). URL\'nin doğru olduğundan emin olun.';
    } else if (error.response?.status >= 500) {
      msg = `XML sunucusu hata döndü (${error.response.status}). Sunucu tarafında bir problem var, daha sonra tekrar deneyin.`;
    }
    res.status(400).json({ error: msg });
  }
});

// Preview with mapping (for existing sources)
router.post('/:id/preview', async (req, res, next) => {
  try {
    const xmlSource = await prisma.xmlSource.findUnique({ where: { id: req.params.id } });
    if (!xmlSource) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });

    // Geçici mapping ile önizleme
    const tempMapping = req.body.mappingConfig || xmlSource.mappingConfig;
    const products = await parseXml(xmlSource.url, typeof tempMapping === 'string' ? tempMapping : JSON.stringify(tempMapping), { preview: true, limit: 10 });

    res.json({
      totalProducts: products.length,
      preview: products.slice(0, 10)
    });
  } catch (error) {
    res.status(400).json({ error: `Önizleme hatası: ${error.message}` });
  }
});

// Re-analyze existing source
router.post('/:id/analyze', async (req, res, next) => {
  try {
    const xmlSource = await prisma.xmlSource.findUnique({ where: { id: req.params.id } });
    if (!xmlSource) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });

    let categoryField = null;
    if (xmlSource.mappingConfig) {
      try { categoryField = JSON.parse(xmlSource.mappingConfig)?.category || null; } catch {}
    }
    const analysis = await analyzeXml(xmlSource.url, { categoryField });
    res.json(analysis);
  } catch (error) {
    res.status(400).json({ error: `XML analiz hatası: ${error.message}` });
  }
});

/** Supplier service fee per product (₺): undefined = not given, false = invalid, otherwise a number >= 0. */
function parseServiceFee(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : false;
}

// Add XML source (with mapping)
router.post('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { name, url, format, syncIntervalMin, mappingConfig, barcodePrefix, defaultCategoryId, defaultBrandId, priceMarkup, priceMarkupPct, defaultVatRate, purchaseVatRate, orderServiceFee } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'İsim ve URL zorunludur' });
    const fee = parseServiceFee(orderServiceFee);
    if (fee === false) return res.status(400).json({ error: 'Hizmet bedeli 0 veya daha büyük bir tutar olmalı' });

    await checkXmlSourceLimit(req.user.id, store.id);

    const xmlSource = await prisma.xmlSource.create({
      data: {
        storeId: store.id,
        name,
        url,
        format: format || 'xml',
        syncIntervalMin: syncIntervalMin || 60,
        mappingConfig: mappingConfig ? (typeof mappingConfig === 'string' ? mappingConfig : JSON.stringify(mappingConfig)) : null,
        barcodePrefix: barcodePrefix || null,
        defaultCategoryId: defaultCategoryId || null,
        defaultBrandId: defaultBrandId || null,
        priceMarkup: priceMarkup || 0,
        priceMarkupPct: priceMarkupPct || 0,
        defaultVatRate: defaultVatRate !== undefined ? parseInt(defaultVatRate) : 10,
        purchaseVatRate: purchaseVatRate !== undefined ? parseInt(purchaseVatRate) : 0,
        orderServiceFee: fee === undefined ? 0 : fee,
      }
    });

    await notificationService.create({
      storeId: store.id,
      title: 'Yeni XML Kaynağı',
      waEvent: 'new_xml_source',
      message: `"${name}" isimli XML kaynağı başarıyla eklendi.`,
      type: 'success',
      link: '/xml-sources'
    });

    res.status(201).json(xmlSource);
  } catch (error) { next(error); }
});

// Update XML source (including mapping)
router.put('/:id', async (req, res, next) => {
  try {
    const { name, url, format, syncIntervalMin, status, mappingConfig, barcodePrefix, defaultCategoryId, defaultBrandId, priceMarkup, priceMarkupPct, defaultVatRate, purchaseVatRate, orderServiceFee } = req.body;
    const data = {};
    const fee = parseServiceFee(orderServiceFee);
    if (fee === false) return res.status(400).json({ error: 'Hizmet bedeli 0 veya daha büyük bir tutar olmalı' });
    if (fee !== undefined) data.orderServiceFee = fee;
    if (name !== undefined) data.name = name;
    if (url !== undefined) data.url = url;
    if (format !== undefined) data.format = format;
    if (syncIntervalMin !== undefined) data.syncIntervalMin = syncIntervalMin;
    if (status !== undefined) data.status = status;
    if (mappingConfig !== undefined) {
      data.mappingConfig = typeof mappingConfig === 'string' ? mappingConfig : JSON.stringify(mappingConfig);
    }
    if (barcodePrefix !== undefined) data.barcodePrefix = barcodePrefix || null;
    if (defaultCategoryId !== undefined) data.defaultCategoryId = defaultCategoryId || null;
    if (defaultBrandId !== undefined) data.defaultBrandId = defaultBrandId || null;
    if (priceMarkup !== undefined) data.priceMarkup = priceMarkup || 0;
    if (priceMarkupPct !== undefined) data.priceMarkupPct = priceMarkupPct || 0;
    if (defaultVatRate !== undefined) data.defaultVatRate = parseInt(defaultVatRate);
    if (purchaseVatRate !== undefined) data.purchaseVatRate = parseInt(purchaseVatRate);
    const xmlSource = await prisma.xmlSource.update({ where: { id: req.params.id }, data });
    res.json(xmlSource);
  } catch (error) { next(error); }
});


// Sync — starts a background job and returns immediately (poll /:id/sync-status)
router.post('/:id/sync', async (req, res, next) => {
  try {
    const job = await startXmlSync(req.params.id, { trigger: 'manual', userId: req.user.id });
    res.status(202).json({ message: 'Senkronizasyon başlatıldı', running: true, syncLogId: job.syncLogId });
  } catch (error) {
    if (error.code === 'SYNC_RUNNING') {
      return res.status(409).json({ error: error.message, running: true, syncLogId: error.syncLogId });
    }
    next(error);
  }
});

// Latest sync state for a source (used by the UI to show progress)
router.get('/:id/sync-status', async (req, res, next) => {
  try {
    const last = await prisma.syncLog.findFirst({
      where: { xmlSourceId: req.params.id, type: 'xml_sync' },
      orderBy: { startedAt: 'desc' },
    });
    res.json({ running: isRunning(req.params.id), last });
  } catch (error) { next(error); }
});

// GET /api/xml-sources/:id/xml-preview — first 20 products + all categories from XML
router.get('/:id/xml-preview', async (req, res, next) => {
  try {
    const xmlSource = await prisma.xmlSource.findUnique({ where: { id: req.params.id } });
    if (!xmlSource) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });

    const products = await parseXml(xmlSource.url, xmlSource.mappingConfig, { preview: true });

    const categories = [...new Set(
      products.map(p => p.category).filter(c => c && c.trim())
    )].sort();

    const preview = products.slice(0, 20).map(p => ({
      title: p.title || '—',
      image: Array.isArray(p.images) ? p.images[0] : (p.images || null),
      category: p.category || '—',
      price: p.price || 0
    }));

    res.json({ total: products.length, preview, categories });
  } catch (error) {
    console.error('[XML Preview Error] sourceId:', req.params.id, '|', error.message);
    res.status(400).json({ error: `Önizleme hatası: ${error.message}` });
  }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const xmlSource = await prisma.xmlSource.findUnique({
      where: { id: req.params.id },
      select: { id: true, storeId: true, globalProviderId: true }
    });

    if (!xmlSource) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });

    // If from a global provider, remove its propagated category mappings
    if (xmlSource.globalProviderId) {
      const otherImports = await prisma.xmlSource.count({
        where: { storeId: xmlSource.storeId, globalProviderId: xmlSource.globalProviderId, id: { not: xmlSource.id } }
      });

      // Only remove if this is the last import of this provider in the store
      if (otherImports === 0) {
        const provider = await prisma.globalXmlProvider.findUnique({
          where: { id: xmlSource.globalProviderId },
          select: { categoryMappingConfig: true }
        });
        if (provider?.categoryMappingConfig) {
          try {
            const categories = Object.keys(JSON.parse(provider.categoryMappingConfig)).map(c => c.trim());
            if (categories.length > 0) {
              const connections = await prisma.marketplaceConnection.findMany({
                where: { storeId: xmlSource.storeId },
                select: { id: true }
              });
              const connectionIds = connections.map(c => c.id);
              if (connectionIds.length > 0) {
                await prisma.categoryMapping.deleteMany({
                  where: { connectionId: { in: connectionIds }, localCategory: { in: categories } }
                });
              }
            }
          } catch (e) {}
        }
      }
    }

    await prisma.product.deleteMany({ where: { xmlSourceId: req.params.id } });
    await prisma.xmlSource.delete({ where: { id: req.params.id } });

    productListCache.invalidate((await getUserStore(req.user.id))?.id);

    res.json({ message: 'XML kaynağı ve bağlı ürünler silindi' });
  } catch (error) { next(error); }
});

// GET /api/xml-sources/:id/logs — sync history for an XML source
router.get('/:id/logs', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const source = await prisma.xmlSource.findFirst({ where: { id: req.params.id, storeId: store.id } });
    if (!source) return res.status(404).json({ error: 'Kaynak bulunamadı' });
    const logs = await prisma.syncLog.findMany({
      where: { xmlSourceId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 50
    });
    res.json(logs);
  } catch (error) { next(error); }
});

module.exports = router;
