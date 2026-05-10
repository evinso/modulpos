const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { deductCredits, getSetting } = require('./credits');

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
    const { name, url, format, mappingConfig, categoryMappingConfig, description, logo, isActive, priceMarkup, priceMarkupPct, barcodePrefix, creditCost } = req.body;
    
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
        barcodePrefix: barcodePrefix || null,
        creditCost: creditCost ? parseFloat(creditCost) : 0,
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
    const { name, url, format, mappingConfig, categoryMappingConfig, description, logo, isActive, priceMarkup, priceMarkupPct, barcodePrefix, creditCost } = req.body;
    
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
        barcodePrefix: barcodePrefix || null,
        creditCost: creditCost ? parseFloat(creditCost) : 0,
        isActive
      }
    });

    res.json(provider);
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
        // Gizli global markupları aktar
        globalPriceMarkup: provider.priceMarkup,
        globalPriceMarkupPct: provider.priceMarkupPct,
        globalBarcodePrefix: provider.barcodePrefix,
        globalProviderId: provider.id,
        status: 'active'
      }
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
