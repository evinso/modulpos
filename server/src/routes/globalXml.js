const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { deductCredits, getSetting } = require('./credits');
const notificationService = require('../services/notificationService');

const router = express.Router();

// Middleware to check if user is superadmin
const requireAdmin = async (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  }
  next();
};

// GET /api/global-xml - List all active global XML providers (for users to see)
router.get('/', auth, async (req, res, next) => {
  try {
    const providers = await prisma.globalXmlProvider.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(providers);
  } catch (error) {
    next(error);
  }
});

// GET /api/global-xml/all - List all global XML providers including inactive (for admins)
router.get('/all', auth, requireAdmin, async (req, res, next) => {
  try {
    const providers = await prisma.globalXmlProvider.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(providers);
  } catch (error) {
    next(error);
  }
});

// Helper to get a working Trendyol connection for admin operations
const getTrendyolConnection = async () => {
  const connection = await prisma.marketplaceConnection.findFirst({
    where: { marketplaceType: 'trendyol' },
    orderBy: { updatedAt: 'desc' }
  });
  if (!connection) throw new Error('Sistemde aktif bir Trendyol bağlantısı bulunamadı. Lütfen önce bir mağaza üzerinden Trendyol bağlantısı kurun.');
  return connection;
};

// GET /api/global-xml/trendyol-categories - Admin fetches trendyol categories
router.get('/trendyol-categories', auth, requireAdmin, async (req, res, next) => {
  try {
    const connection = await getTrendyolConnection();
    const TrendyolService = require('../services/trendyol/trendyolService');
    const service = new TrendyolService(connection);
    const categories = await service.getCategories();
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

// GET /api/global-xml/trendyol-categories/:catId/attributes - Admin fetches trendyol attributes
router.get('/trendyol-categories/:catId/attributes', auth, requireAdmin, async (req, res, next) => {
  try {
    const connection = await getTrendyolConnection();
    const TrendyolService = require('../services/trendyol/trendyolService');
    const service = new TrendyolService(connection);
    const attributes = await service.getCategoryAttributes(parseInt(req.params.catId));
    res.json(attributes);
  } catch (error) {
    next(error);
  }
});

// POST /api/global-xml - Admin creates a new Global XML provider
router.post('/', auth, requireAdmin, async (req, res, next) => {
  try {
    const { name, url, format, mappingConfig, categoryMappingConfig, description, logo, isActive, priceMarkup, priceMarkupPct, priceMarkupPctByPlan, barcodePrefix, creditCost, cargoCompanies, orderFee, purchaseVatRate } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: 'İsim ve URL zorunludur' });
    }

    const provider = await prisma.globalXmlProvider.create({
      data: {
        name,
        url,
        format: format || 'xml',
        mappingConfig: mappingConfig ? JSON.stringify(mappingConfig) : null,
        categoryMappingConfig: categoryMappingConfig ? JSON.stringify(categoryMappingConfig) : null,
        description,
        logo,
        priceMarkup: priceMarkup ? parseFloat(priceMarkup) : 0,
        priceMarkupPct: priceMarkupPct ? parseFloat(priceMarkupPct) : 0,
        priceMarkupPctByPlan: priceMarkupPctByPlan ? JSON.stringify(priceMarkupPctByPlan) : null,
        barcodePrefix: barcodePrefix || null,
        creditCost: creditCost ? parseFloat(creditCost) : 0,
        orderFee: orderFee ? parseFloat(orderFee) : 0,
        purchaseVatRate: purchaseVatRate ? parseInt(purchaseVatRate) : 0,
        cargoCompanies: Array.isArray(cargoCompanies) && cargoCompanies.length > 0 ? JSON.stringify(cargoCompanies) : null,
        isActive: isActive !== undefined ? isActive : true
      }
    });

    res.status(201).json(provider);
  } catch (error) {
    next(error);
  }
});

// PUT /api/global-xml/:id - Admin updates a Global XML provider
router.put('/:id', auth, requireAdmin, async (req, res, next) => {
  try {
    const { name, url, format, mappingConfig, categoryMappingConfig, description, logo, isActive, priceMarkup, priceMarkupPct, priceMarkupPctByPlan, barcodePrefix, creditCost, cargoCompanies, orderFee, purchaseVatRate } = req.body;

    const provider = await prisma.globalXmlProvider.update({
      where: { id: req.params.id },
      data: {
        name,
        url,
        format,
        mappingConfig: mappingConfig ? JSON.stringify(mappingConfig) : null,
        categoryMappingConfig: categoryMappingConfig ? JSON.stringify(categoryMappingConfig) : null,
        description,
        logo,
        priceMarkup: priceMarkup ? parseFloat(priceMarkup) : 0,
        priceMarkupPct: priceMarkupPct ? parseFloat(priceMarkupPct) : 0,
        priceMarkupPctByPlan: priceMarkupPctByPlan ? JSON.stringify(priceMarkupPctByPlan) : null,
        barcodePrefix: barcodePrefix || null,
        creditCost: creditCost ? parseFloat(creditCost) : 0,
        orderFee: orderFee ? parseFloat(orderFee) : 0,
        purchaseVatRate: purchaseVatRate !== undefined ? parseInt(purchaseVatRate) : 0,
        cargoCompanies: Array.isArray(cargoCompanies) && cargoCompanies.length > 0 ? JSON.stringify(cargoCompanies) : null,
        isActive
      }
    });

    // Propagate updated category mappings to all users who imported this provider
    if (categoryMappingConfig) {
      try {
        const targetMarketplace = categoryMappingConfig._marketplace || 'trendyol';
        const entries = Object.entries(categoryMappingConfig).filter(([k]) => !k.startsWith('_'));
        if (entries.length > 0) {
          const xmlSources = await prisma.xmlSource.findMany({
            where: { globalProviderId: req.params.id },
            select: { storeId: true }
          });
          const storeIds = [...new Set(xmlSources.map(s => s.storeId))];
          const connections = await prisma.marketplaceConnection.findMany({
            where: { storeId: { in: storeIds }, marketplaceType: targetMarketplace },
            select: { id: true }
          });
          for (const conn of connections) {
            for (const [localCategory, mapping] of entries) {
              const catId = mapping.marketplaceCategoryId || mapping.trendyolCategoryId || mapping.id;
              if (!catId) continue;
              const existing = await prisma.categoryMapping.findFirst({
                where: { connectionId: conn.id, localCategory: localCategory.trim() }
              });
              if (existing) {
                await prisma.categoryMapping.update({
                  where: { id: existing.id },
                  data: {
                    marketplaceCategoryId: String(catId),
                    marketplaceCategoryName: mapping.marketplaceCategoryName || null,
                    attributes: mapping.attributes || null
                  }
                });
              } else {
                await prisma.categoryMapping.create({
                  data: {
                    connectionId: conn.id,
                    localCategory: localCategory.trim(),
                    marketplaceCategoryId: String(catId),
                    marketplaceCategoryName: mapping.marketplaceCategoryName || null,
                    attributes: mapping.attributes || null
                  }
                });
              }
            }
          }
        }
      } catch (e) {
        // Non-fatal: propagation failure doesn't block the save
      }
    }

    // Propagate updated price/barcode/vat fields to all users who imported this provider
    // (skip sources where admin has excluded them from global markup updates)
    try {
      await prisma.xmlSource.updateMany({
        where: { globalProviderId: req.params.id, excludeGlobalMarkup: false },
        data: {
          globalPriceMarkup: priceMarkup ? parseFloat(priceMarkup) : 0,
          globalPriceMarkupPct: priceMarkupPct ? parseFloat(priceMarkupPct) : 0,
          globalPriceMarkupPctByPlan: priceMarkupPctByPlan ? JSON.stringify(priceMarkupPctByPlan) : null,
          globalBarcodePrefix: barcodePrefix || null,
          purchaseVatRate: purchaseVatRate !== undefined ? parseInt(purchaseVatRate) : 0,
        }
      });
    } catch (e) {
      // Non-fatal
    }

    res.json(provider);
  } catch (error) {
    next(error);
  }
});

// GET /api/global-xml/:id/subscribers - List all xml-sources imported from this provider
router.get('/:id/subscribers', auth, requireAdmin, async (req, res, next) => {
  try {
    const sources = await prisma.xmlSource.findMany({
      where: { globalProviderId: req.params.id },
      select: {
        id: true,
        name: true,
        excludeGlobalMarkup: true,
        globalPriceMarkup: true,
        globalPriceMarkupPct: true,
        globalPriceMarkupPctByPlan: true,
        store: {
          select: {
            id: true,
            name: true,
            user: { select: { id: true, name: true, email: true } }
          }
        }
      },
      orderBy: { store: { name: 'asc' } }
    });
    res.json(sources);
  } catch (error) {
    next(error);
  }
});

// PATCH /api/global-xml/subscribers/:xmlSourceId - Toggle excludeGlobalMarkup for a subscriber
router.patch('/subscribers/:xmlSourceId', auth, requireAdmin, async (req, res, next) => {
  try {
    const { excludeGlobalMarkup } = req.body;
    const updated = await prisma.xmlSource.update({
      where: { id: req.params.xmlSourceId },
      data: { excludeGlobalMarkup: Boolean(excludeGlobalMarkup) }
    });
    res.json({ id: updated.id, excludeGlobalMarkup: updated.excludeGlobalMarkup });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/global-xml/:id - Admin deletes a Global XML provider
router.delete('/:id', auth, requireAdmin, async (req, res, next) => {
  try {
    await prisma.globalXmlProvider.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Global XML silindi' });
  } catch (error) {
    next(error);
  }
});

// GET /api/global-xml/:id/preview - Fetch first 20 products from provider XML
router.get('/:id/preview', auth, async (req, res, next) => {
  try {
    const provider = await prisma.globalXmlProvider.findUnique({
      where: { id: req.params.id }
    });

    if (!provider || !provider.isActive) {
      return res.status(404).json({ error: 'Aktif Global XML bulunamadı' });
    }

    const { parseXml } = require('../services/xml/xmlParser');
    const products = await parseXml(provider.url, provider.mappingConfig);

    const categories = [...new Set(
      products.map(p => p.category).filter(c => c && c.trim())
    )].sort();

    const preview = products.slice(0, 20).map(p => ({
      title: p.title || '—',
      image: Array.isArray(p.images) ? p.images[0] : (p.images || null),
      category: p.category || '—',
      price: p.price || 0
    }));

    // Cache product count
    await prisma.globalXmlProvider.update({
      where: { id: provider.id },
      data: { productCount: products.length }
    });

    res.json({ total: products.length, preview, categories });
  } catch (error) {
    next(error);
  }
});

// POST /api/global-xml/:id/import - User imports a global XML to their store
router.post('/:id/import', auth, async (req, res, next) => {
  try {
    const { barcodePrefix, priceMarkup, priceMarkupPct } = req.body;
    
    // Get user's store
    const store = await prisma.store.findFirst({
      where: { userId: req.user.id }
    });

    if (!store) {
      return res.status(404).json({ error: 'Mağaza bulunamadı' });
    }

    // Get the global XML
    const provider = await prisma.globalXmlProvider.findUnique({
      where: { id: req.params.id }
    });

    if (!provider || !provider.isActive) {
      return res.status(404).json({ error: 'Aktif Global XML bulunamadı' });
    }

    // Kredi kontrolü
    const defaultCost = await getSetting('credit_xml_import_default', '5');
    const creditCost = provider.creditCost > 0 ? provider.creditCost : parseFloat(defaultCost);
    
    if (creditCost > 0) {
      try {
        await deductCredits(
          req.user.id,
          creditCost,
          'xml_import',
          `"${provider.name}" XML kaynağı eklendi`,
          provider.id
        );
      } catch (creditErr) {
        return res.status(402).json({ error: creditErr.message });
      }
    }

    // Create a new XmlSource for the user based on the global one
    const newXmlSource = await prisma.xmlSource.create({
      data: {
        storeId: store.id,
        name: provider.name,
        url: provider.url,
        format: provider.format,
        mappingConfig: provider.mappingConfig,
        barcodePrefix: barcodePrefix || null,
        priceMarkup: priceMarkup ? parseFloat(priceMarkup) : 0,
        priceMarkupPct: priceMarkupPct ? parseFloat(priceMarkupPct) : 0,
        globalPriceMarkup: provider.priceMarkup,
        globalPriceMarkupPct: provider.priceMarkupPct,
        globalPriceMarkupPctByPlan: provider.priceMarkupPctByPlan || null,
        globalBarcodePrefix: provider.barcodePrefix,
        globalProviderId: provider.id,
        purchaseVatRate: provider.purchaseVatRate || 0,
        status: 'active'
      }
    });

    // Propagate provider category mappings to all of the user's marketplace connections
    if (provider.categoryMappingConfig) {
      try {
        const catConfig = JSON.parse(provider.categoryMappingConfig);
        const entries = Object.entries(catConfig);
        if (entries.length > 0) {
          const connections = await prisma.marketplaceConnection.findMany({
            where: { storeId: store.id },
            select: { id: true }
          });
          for (const conn of connections) {
            for (const [localCategory, mapping] of entries) {
              const catId = mapping.marketplaceCategoryId || mapping.trendyolCategoryId || mapping.id;
              if (!catId) continue;
              const existing = await prisma.categoryMapping.findFirst({
                where: { connectionId: conn.id, localCategory: localCategory.trim() }
              });
              if (!existing) {
                await prisma.categoryMapping.create({
                  data: {
                    connectionId: conn.id,
                    localCategory: localCategory.trim(),
                    marketplaceCategoryId: String(catId),
                    marketplaceCategoryName: mapping.marketplaceCategoryName || null,
                    attributes: mapping.attributes || null
                  }
                });
              }
            }
          }
        }
      } catch (e) {
        // Non-fatal: category mapping propagation failure doesn't block the import
      }
    }

    notificationService.create({
      storeId: store.id,
      title: 'XML Kaynağı Eklendi',
      message: `"${provider.name}" mağazanıza başarıyla eklendi.`,
      type: 'success',
      link: '/xml-sources'
    });

    res.status(201).json({
      message: 'XML kaynağı başarıyla mağazanıza kopyalandı',
      xmlSource: newXmlSource
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
