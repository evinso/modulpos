const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const TrendyolService = require('../services/trendyol/trendyolService');

const router = express.Router();
router.use(auth);

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

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
    const { marketplaceType, sellerId, apiKey, apiSecret, supplierName, defaultBrandId, defaultBrandName } = req.body;
    if (!marketplaceType || !apiKey || !apiSecret) return res.status(400).json({ error: 'Pazaryeri türü, API Key ve Secret zorunludur' });

    const config = {};
    if (defaultBrandId) config.defaultBrandId = parseInt(defaultBrandId);
    if (defaultBrandName) config.defaultBrandName = defaultBrandName;

    const connection = await prisma.marketplaceConnection.create({
      data: { storeId: store.id, marketplaceType, sellerId, apiKey, apiSecret, supplierName, config: Object.keys(config).length > 0 ? JSON.stringify(config) : null }
    });
    res.status(201).json(connection);
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
    res.json({ success: false, message: 'Bu pazaryeri henüz desteklenmiyor' });
  } catch (error) { next(error); }
});

// Get categories (Trendyol)
router.get('/connections/:id/categories', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    if (connection.marketplaceType === 'trendyol') {
      const service = new TrendyolService(connection);
      const categories = await service.getCategories();
      return res.json(categories);
    }
    res.json([]);
  } catch (error) { 
    if (error.response && error.response.status === 403) {
      return res.status(403).json({ error: 'Trendyol API erişimi reddedildi (403 Forbidden). Lütfen Satıcı ID, API Key ve API Secret bilgilerinizin doğru olduğundan emin olun.' });
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

// Delete connection
router.delete('/connections/:id', async (req, res, next) => {
  try {
    await prisma.marketplaceConnection.delete({ where: { id: req.params.id } });
    res.json({ message: 'Bağlantı silindi' });
  } catch (error) { next(error); }
});

// Get category attributes (for Trendyol)
router.get('/connections/:id/categories/:catId/attributes', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    if (connection.marketplaceType === 'trendyol') {
      const service = new TrendyolService(connection);
      const attributes = await service.getCategoryAttributes(parseInt(req.params.catId));
      return res.json(attributes);
    }
    res.json({ categoryAttributes: [] });
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

// Category mappings - list
router.get('/connections/:id/category-mappings', async (req, res, next) => {
  try {
    const mappings = await prisma.categoryMapping.findMany({
      where: { connectionId: req.params.id },
      orderBy: { createdAt: 'desc' }
    });
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
    const products = await prisma.product.findMany({
      where: { storeId: store.id, category: { not: null } },
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
    const { productIds } = req.body;
    if (!productIds?.length) return res.status(400).json({ error: 'Ürün seçilmedi' });

    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    // Fetch products
    const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length === 0) return res.status(400).json({ error: 'Ürün bulunamadı' });

    // Fetch category mappings
    const catMappings = await prisma.categoryMapping.findMany({ where: { connectionId: connection.id } });
    const catMap = {};
    for (const m of catMappings) { catMap[m.localCategory] = m; }

    // Initialize Trendyol service for brand lookups
    const service = new TrendyolService(connection);

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

    // Format products for Trendyol
    const formatted = [];
    const errors = [];
    for (const p of products) {
      const mapping = p.category ? catMap[p.category] : null;
      if (!mapping) {
        errors.push(`${p.sku}: Kategori eşleştirmesi yok (${p.category || 'Kategori boş'})`);
        continue;
      }
      if (!p.barcode) {
        errors.push(`${p.sku}: Barkod eksik`);
        continue;
      }

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

      // Resolve brand ID: ürünün brand alanından Trendyol marka ID çözümle
      let brandId = null;
      
      // 1. Ürünün brand alanından çözümle (XML'den gelen marka adı)
      if (p.brand) {
        brandId = await resolveBrandId(p.brand);
      }
      
      // 2. Marka bulunamazsa connection'ın default brand ID'sini kullan
      if (!brandId && connection.config) {
        try {
          const config = JSON.parse(connection.config);
          if (config.defaultBrandId) brandId = config.defaultBrandId;
        } catch (e) {}
      }
      
      // 3. Hala bulunamazsa hata listesine ekle
      if (!brandId) {
        errors.push(`${p.sku}: Marka bulunamadı (${p.brand || 'Marka boş'}). Trendyol'da geçerli bir marka eşleştirmesi yapın.`);
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
      const mapping = p.category ? catMap[p.category] : null;
      if (!mapping || !p.barcode) continue;

      await prisma.marketplaceProduct.upsert({
        where: {
          productId_connectionId: { productId: p.id, connectionId: connection.id }
        },
        update: {
          marketplacePrice: p.price,
          marketplaceStock: p.stock,
          status: 'pending',
          lastSyncedAt: new Date()
        },
        create: {
          productId: p.id,
          connectionId: connection.id,
          marketplacePrice: p.price,
          marketplaceStock: p.stock,
          status: 'pending'
        }
      });
    }

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
    
    if (error.response?.data) {
      return res.status(400).json({ 
        error: 'Trendyol API hatası', 
        details: error.response.data,
        status: error.response.status,
        message: typeof error.response.data === 'string' 
          ? error.response.data 
          : error.response.data?.errors?.[0]?.message || error.response.data?.message || JSON.stringify(error.response.data)
      });
    }
    next(error);
  }
});

module.exports = router;
