const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { parseXml, analyzeXml } = require('../services/xml/xmlParser');
const notificationService = require('../services/notificationService');

const router = express.Router();
router.use(auth);

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
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL zorunludur' });

    const analysis = await analyzeXml(url);
    res.json(analysis);
  } catch (error) {
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
    const products = await parseXml(xmlSource.url, typeof tempMapping === 'string' ? tempMapping : JSON.stringify(tempMapping));

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

    const analysis = await analyzeXml(xmlSource.url);
    res.json(analysis);
  } catch (error) {
    res.status(400).json({ error: `XML analiz hatası: ${error.message}` });
  }
});

// Add XML source (with mapping)
router.post('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { name, url, format, syncIntervalMin, mappingConfig, barcodePrefix, defaultCategoryId, defaultBrandId, priceMarkup, priceMarkupPct, defaultVatRate } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'İsim ve URL zorunludur' });
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
      }
    });

    await notificationService.create({
      storeId: store.id,
      title: 'Yeni XML Kaynağı',
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
    const { name, url, format, syncIntervalMin, status, mappingConfig, barcodePrefix, defaultCategoryId, defaultBrandId, priceMarkup, priceMarkupPct, defaultVatRate } = req.body;
    const data = {};
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
    const xmlSource = await prisma.xmlSource.update({ where: { id: req.params.id }, data });
    res.json(xmlSource);
  } catch (error) { next(error); }
});


// Sync
router.post('/:id/sync', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const xmlSource = await prisma.xmlSource.findUnique({ where: { id: req.params.id } });
    if (!xmlSource) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });

    const syncLog = await prisma.syncLog.create({ data: { storeId: store.id, type: 'xml_sync', status: 'started' } });

    const products = await parseXml(xmlSource.url, xmlSource.mappingConfig);
    let created = 0, updated = 0, errors = 0;

    for (const p of products) {
      try {
        const sku = p.sku || p.barcode || `xml-${Date.now()}-${Math.random()}`;
        let rawXmlPrice = p.price || 0;
        
        // 1. Önce Admin'in Global XML üzerinden belirlediği GİZLİ markupları uygula
        // Kullanıcı bu fiyatı "orijinal alış fiyatı" (xmlPrice) olarak görecek
        if (xmlSource.globalPriceMarkupPct) {
          rawXmlPrice += rawXmlPrice * (xmlSource.globalPriceMarkupPct / 100);
        }
        if (xmlSource.globalPriceMarkup) {
          rawXmlPrice += xmlSource.globalPriceMarkup;
        }

        const xmlPrice = rawXmlPrice;

        // Store raw XML data as-is (never modify this)
        const rawXmlData = JSON.stringify({
          sku: p.sku, barcode: p.barcode, title: p.title, description: p.description,
          price: p.price, listPrice: p.listPrice, cost: p.cost, stock: p.stock,
          brand: p.brand, category: p.category, images: p.images
        });

        // The base product price is just the XML price.
        let finalPrice = xmlPrice;

        // Apply global barcode prefix first
        const baseBarcode = xmlSource.globalBarcodePrefix 
          ? `${xmlSource.globalBarcodePrefix}${p.barcode || sku}` 
          : (p.barcode || sku);

        // Apply user's barcode prefix
        const finalBarcode = xmlSource.barcodePrefix
          ? `${xmlSource.barcodePrefix}${baseBarcode}`
          : baseBarcode;

        const existing = await prisma.product.findFirst({ where: { storeId: store.id, xmlSourceId: xmlSource.id, sku } });
        if (existing) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              title: p.title || existing.title,
              description: p.description || existing.description,
              xmlPrice: xmlPrice,
              price: finalPrice,
              cost: p.cost || existing.cost,
              listPrice: p.listPrice || existing.listPrice,
              stock: p.stock ?? existing.stock,
              brand: p.brand || existing.brand,
              category: p.category || existing.category,
              barcode: finalBarcode || existing.barcode,
              images: p.images?.length ? JSON.stringify(p.images) : existing.images,
              rawXmlData: rawXmlData,
            }
          });
          updated++;
        } else {
          await prisma.product.create({
            data: {
              storeId: store.id,
              xmlSourceId: xmlSource.id,
              sku,
              barcode: finalBarcode,
              title: p.title || 'İsimsiz',
              description: p.description,
              xmlPrice: xmlPrice,
              price: finalPrice,
              vatRate: xmlSource.defaultVatRate || 10,
              cost: p.cost || 0,
              listPrice: p.listPrice || 0,
              stock: p.stock || 0,
              brand: p.brand,
              category: p.category,
              images: p.images?.length ? JSON.stringify(p.images) : null,
              rawXmlData: rawXmlData,
            }
          });
          created++;
        }
      } catch { errors++; }
    }

    await prisma.syncLog.update({ where: { id: syncLog.id }, data: { status: 'completed', itemCount: created + updated, errorCount: errors, completedAt: new Date() } });
    await prisma.xmlSource.update({ where: { id: xmlSource.id }, data: { lastSyncedAt: new Date(), totalProducts: products.length, status: 'active' } });

    await notificationService.create({
      storeId: store.id,
      title: 'Senkronizasyon Tamamlandı',
      message: `"${xmlSource.name}" senkronizasyonu tamamlandı: ${created} yeni, ${updated} güncellenen ürün.`,
      type: errors > 0 ? 'warning' : 'success',
      link: '/products'
    });

    res.json({ message: 'Senkronizasyon tamamlandı', results: { total: products.length, created, updated, errors } });
  } catch (error) { 
    console.error('[XML Sync Error]', error.message);
    
    // Log the error to Audit Logs
    prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'XML_SYNC_ERROR',
        details: JSON.stringify({ error: error.message }),
        level: 'ERROR'
      }
    }).catch(err => console.error("Audit log error:", err));

    next(error); 
  }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    // Önce bu XML kaynağına bağlı ürünleri silelim
    await prisma.product.deleteMany({
      where: { xmlSourceId: req.params.id }
    });
    
    // Sonra kaynağın kendisini silelim
    await prisma.xmlSource.delete({ where: { id: req.params.id } });
    
    res.json({ message: 'XML kaynağı ve bağlı ürünler silindi' });
  } catch (error) { next(error); }
});

module.exports = router;
