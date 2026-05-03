const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { parseXml, analyzeXml } = require('../services/xml/xmlParser');

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
    res.status(400).json({ error: `XML analiz hatası: ${error.message}` });
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

// Apply pricing rules to calculate final price
function applyPricingRules(xmlPrice, product, rules) {
  let finalPrice = xmlPrice;
  for (const rule of rules) {
    if (!rule.isActive) continue;
    // Check if rule applies to this product
    if (rule.applyTo === 'category' && rule.applyValue && product.category !== rule.applyValue) continue;
    if (rule.applyTo === 'brand' && rule.applyValue && product.brand !== rule.applyValue) continue;
    if (rule.applyTo === 'xml_source' && rule.applyValue && product.xmlSourceId !== rule.applyValue) continue;

    if (rule.type === 'percentage') {
      finalPrice = finalPrice * (1 + rule.value / 100);
    } else if (rule.type === 'fixed') {
      finalPrice = finalPrice + rule.value;
    }
  }
  return Math.round(Math.max(0, finalPrice) * 100) / 100;
}

// Sync
router.post('/:id/sync', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const xmlSource = await prisma.xmlSource.findUnique({ where: { id: req.params.id } });
    if (!xmlSource) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });

    const syncLog = await prisma.syncLog.create({ data: { storeId: store.id, type: 'xml_sync', status: 'started' } });

    // Fetch active pricing rules for this store
    const pricingRules = await prisma.pricingRule.findMany({
      where: { storeId: store.id, isActive: true },
      orderBy: { priority: 'asc' }
    });

    const products = await parseXml(xmlSource.url, xmlSource.mappingConfig);
    let created = 0, updated = 0, errors = 0;

    for (const p of products) {
      try {
        const sku = p.sku || p.barcode || `xml-${Date.now()}-${Math.random()}`;
        const xmlPrice = p.price || 0;

        // Store raw XML data as-is (never modify this)
        const rawXmlData = JSON.stringify({
          sku: p.sku, barcode: p.barcode, title: p.title, description: p.description,
          price: p.price, listPrice: p.listPrice, cost: p.cost, stock: p.stock,
          brand: p.brand, category: p.category, images: p.images
        });

        // Apply XmlSource-level modifications
        let finalPrice = xmlPrice;
        if (xmlSource.priceMarkupPct) {
          finalPrice = finalPrice * (1 + xmlSource.priceMarkupPct / 100);
        }
        if (xmlSource.priceMarkup) {
          finalPrice = finalPrice + xmlSource.priceMarkup;
        }

        // Apply store-level pricing rules
        const productData = { ...p, xmlSourceId: xmlSource.id };
        finalPrice = applyPricingRules(finalPrice, productData, pricingRules);

        // Apply barcode prefix
        const finalBarcode = xmlSource.barcodePrefix
          ? `${xmlSource.barcodePrefix}${p.barcode || sku}`
          : p.barcode;

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

    res.json({ message: 'Senkronizasyon tamamlandı', results: { total: products.length, created, updated, errors } });
  } catch (error) { next(error); }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.xmlSource.delete({ where: { id: req.params.id } });
    res.json({ message: 'XML kaynağı silindi' });
  } catch (error) { next(error); }
});

module.exports = router;
