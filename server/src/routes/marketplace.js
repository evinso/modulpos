const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const TrendyolService = require('../services/trendyol/trendyolService');
const notificationService = require('../services/notificationService');
const { matchPriceRangeRule, calcPriceRangePrice } = require('../utils/pricingHelper');
const { deductCredits, getSetting } = require('./credits');

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
    const { xmlSourceId, minStock = 0 } = req.body;

    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    // Fetch all products for this store
    const productWhere = { storeId: connection.storeId };
    if (xmlSourceId) productWhere.xmlSourceId = xmlSourceId;
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
      if (!mapping || !p.barcode || (minStock > 0 && (p.stock ?? 0) < minStock)) { skipped++; continue; }

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
      let errorMessages = [];

      // --- 1. Check via getBatchRequestResult (PRIMARY) ---
      const productsWithBatch = allPendingProducts.filter(p => p.batchRequestId != null);
      if (productsWithBatch.length > 0) {
        const batchIds = [...new Set(productsWithBatch.map(p => p.batchRequestId))];
        
        for (const batchId of batchIds) {
          try {
            const batchResult = await service.getBatchRequestResult(batchId);
            if (batchResult && batchResult.items && Array.isArray(batchResult.items)) {
              for (const item of batchResult.items) {
                // Determine barcode from various Trendyol batch request structures
                let barcode = item.requestItem?.barcode || 
                              item.requestItem?.product?.barcode || 
                              item.requestItem?.updateRequest?.barcode;
                              
                if (!barcode && item.requestItem?.productMainId) {
                  barcode = item.requestItem.productMainId;
                }

                if (!barcode) continue;

                // Find matching pending product
                const matchingMp = productsWithBatch.find(p => 
                  p.batchRequestId === batchId && 
                  (p.product.barcode === barcode || p.product.sku === barcode)
                );

                if (matchingMp) {
                  let newStatus = matchingMp.status;
                  let newError = matchingMp.errorMessage;
                  
                  if (item.status === 'SUCCESS') {
                    newStatus = 'active';
                    newError = null;
                  } else if (item.status === 'FAILED') {
                    newStatus = 'rejected';
                    newError = (item.failureReasons || []).join(', ') || 'Trendyol tarafından reddedildi';
                  }
                  
                  if (newStatus !== matchingMp.status) {
                    await prisma.marketplaceProduct.update({
                      where: { id: matchingMp.id },
                      data: { status: newStatus, errorMessage: newError }
                    });
                    updatedCount++;
                    // Remove from allPendingProducts so we don't check it again in fallback
                    const idx = allPendingProducts.findIndex(p => p.id === matchingMp.id);
                    if (idx !== -1) allPendingProducts.splice(idx, 1);
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[Trendyol Batch Check Error] ${batchId}`, err.response?.data || err.message);
            errorMessages.push(`Toplu işlem (${batchId}) sorgulanamadı: ${err.message}`);
          }
        }
      }

      // --- 2. Fallback: Check remaining via getProducts (for products without batchId) ---
      // We only process up to 50 items here to prevent timeouts
      const stillPending = allPendingProducts.filter(p => p.status === 'pending').slice(0, 50);
      
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
            // Check Approved (Active) Products
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
                  barcodeMap.delete(tp.barcode);
                  barcodeMap.delete(tp.stockCode);
                }
              }
            }
            
            // Check Unapproved (Pending/Rejected) Products
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
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[Trendyol Fallback Sync Error]`, err.message);
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

      const warnMsg = errorMessages.length > 0 ? ` (${errorMessages.length} hata oluştu)` : '';
      const discoverMsg = discovered > 0 ? ` ${discovered} yeni ürün Trendyol'da bulundu.` : '';
      return res.json({
        message: `${updatedCount} ürünün durumu güncellendi.${discoverMsg}${warnMsg}`,
        updated: updatedCount,
        discovered
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

// GET /connections/:id/webhooks — list webhooks registered on Trendyol for this connection
router.get('/connections/:id/webhooks', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const connection = await prisma.marketplaceConnection.findFirst({ where: { id: req.params.id, storeId: store.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    const service = new TrendyolService(connection);
    try {
      const data = await service.listWebhooks();
      res.json(Array.isArray(data) ? data : []);
    } catch (trendyolErr) {
      const detail = trendyolErr.response?.data?.message
        || trendyolErr.response?.data?.errors?.[0]?.message
        || trendyolErr.message;
      console.error('[Webhook List Error]', trendyolErr.response?.status, detail, trendyolErr.response?.data);
      res.json({ _error: detail, _status: trendyolErr.response?.status || 0 });
    }
  } catch (error) { next(error); }
});

// POST /connections/:id/webhooks — register our webhook URL on Trendyol
router.post('/connections/:id/webhooks', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const connection = await prisma.marketplaceConnection.findFirst({ where: { id: req.params.id, storeId: store.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const { subscribedStatuses } = req.body;
    const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'https://api.modulpos.com';
    const webhookUrl = `${baseUrl}/api/webhooks/trendyol`;

    const { randomUUID } = require('crypto');
    const webhookApiKey = randomUUID().replace(/-/g, '');

    const service = new TrendyolService(connection);
    let result;
    try {
      result = await service.createWebhook(webhookUrl, subscribedStatuses || [], webhookApiKey);
    } catch (trendyolErr) {
      const detail = trendyolErr.response?.data?.message
        || trendyolErr.response?.data?.errors?.[0]?.message
        || (typeof trendyolErr.response?.data === 'string' ? trendyolErr.response.data : null)
        || trendyolErr.message;
      console.error('[Webhook Create Error]', trendyolErr.response?.status, detail, trendyolErr.response?.data);
      return res.status(400).json({ error: `Trendyol webhook oluşturulamadı: ${detail}` });
    }

    const existingConfig = connection.config ? JSON.parse(connection.config) : {};
    await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: { config: JSON.stringify({ ...existingConfig, webhookApiKey }) }
    });

    res.json({ id: result.id, webhookUrl, webhookApiKey });
  } catch (error) { next(error); }
});

// DELETE /connections/:id/webhooks/:webhookId — remove a webhook from Trendyol
router.delete('/connections/:id/webhooks/:webhookId', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const connection = await prisma.marketplaceConnection.findFirst({ where: { id: req.params.id, storeId: store.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });
    const service = new TrendyolService(connection);
    await service.deleteWebhook(req.params.webhookId);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// GET /marketplace/webhook-events — paginated webhook event history for this store
router.get('/webhook-events', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const { page = 1, limit = 50, eventType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { storeId: store.id };
    if (eventType) where.eventType = eventType;

    const [total, events] = await Promise.all([
      prisma.webhookEvent.count({ where }),
      prisma.webhookEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      })
    ]);

    res.json({ events, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) { next(error); }
});

// GET /marketplace/webhook-url — returns the webhook URL for this store's Trendyol connection
router.get('/webhook-url', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || 'https://api.modulpos.com';
    const webhookUrl = `${baseUrl}/api/webhooks/trendyol`;

    res.json({ webhookUrl });
  } catch (error) { next(error); }
});

module.exports = router;
