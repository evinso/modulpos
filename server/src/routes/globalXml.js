const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');

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

// POST /api/global-xml - Admin creates a new Global XML provider
router.post('/', auth, requireAdmin, async (req, res, next) => {
  try {
    const { name, url, format, mappingConfig, description, logo, isActive, priceMarkup, priceMarkupPct, barcodePrefix } = req.body;
    
    if (!name || !url) {
      return res.status(400).json({ error: 'İsim ve URL zorunludur' });
    }

    const provider = await prisma.globalXmlProvider.create({
      data: {
        name,
        url,
        format: format || 'xml',
        mappingConfig: mappingConfig ? JSON.stringify(mappingConfig) : null,
        description,
        logo,
        priceMarkup: priceMarkup ? parseFloat(priceMarkup) : 0,
        priceMarkupPct: priceMarkupPct ? parseFloat(priceMarkupPct) : 0,
        barcodePrefix: barcodePrefix || null,
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
    const { name, url, format, mappingConfig, description, logo, isActive, priceMarkup, priceMarkupPct, barcodePrefix } = req.body;
    
    const provider = await prisma.globalXmlProvider.update({
      where: { id: req.params.id },
      data: {
        name,
        url,
        format,
        mappingConfig: mappingConfig ? JSON.stringify(mappingConfig) : null,
        description,
        logo,
        priceMarkup: priceMarkup ? parseFloat(priceMarkup) : 0,
        priceMarkupPct: priceMarkupPct ? parseFloat(priceMarkupPct) : 0,
        barcodePrefix: barcodePrefix || null,
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
