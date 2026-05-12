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
      message: `${formatted.length} ürün Trendyol'a gönderildi. ${errors.length > 0 ? errors.length + ' hata var.' : ''}`,
      type: errors.length > 0 ? 'warning' : 'success',
      link: '/marketplace'
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
    const { xmlSourceId } = req.body;

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
      if (!mapping || !p.barcode) { skipped++; continue; }

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
      message: `${formatted.length} ürün ${batches} parti halinde Trendyol'a gönderildi. ${skipped} ürün atlandı.`,
      type: 'success',
      link: '/marketplace'
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

// BuyBox check — query Trendyol buybox info, rotate through products by oldest-checked-first
router.post('/connections/:id/buybox-check', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    // batchSize: how many products to check this run (0 = all). Default 50.
    const batchSize = Math.max(0, parseInt(req.body?.batchSize ?? 50));

    // Get all marketplace products with a barcode
    const mpProducts = await prisma.marketplaceProduct.findMany({
      where: { connectionId: connection.id },
      include: { product: { select: { id: true, title: true, barcode: true, sku: true, price: true } } }
    });

    const allEligible = mpProducts.filter(mp => mp.product?.barcode);
    if (allEligible.length === 0) return res.status(400).json({ error: 'Barkodlu ürün bulunamadı' });

    // Fetch existing records to know when each barcode was last checked
    const existingRecords = await prisma.buyboxRecord.findMany({
      where: { connectionId: connection.id },
      select: { barcode: true, checkedAt: true }
    });
    const lastCheckedMap = new Map(existingRecords.map(r => [r.barcode, r.checkedAt]));

    // Sort: never-checked first, then oldest checkedAt first (rotation)
    allEligible.sort((a, b) => {
      const aTime = lastCheckedMap.get(a.product.barcode)?.getTime() ?? 0;
      const bTime = lastCheckedMap.get(b.product.barcode)?.getTime() ?? 0;
      return aTime - bTime;
    });

    const eligible = batchSize > 0 ? allEligible.slice(0, batchSize) : allEligible;

    // Credit cost: 1 credit per 10 barcodes (1 Trendyol API request)
    const creditCostPerBatch = parseFloat(await getSetting('credit_buybox_check', '1'));
    const batchCount = Math.ceil(eligible.length / 10);
    const totalCost = batchCount * creditCostPerBatch;

    if (totalCost > 0) {
      await deductCredits(
        req.user.id,
        totalCost,
        'buybox_check',
        `BuyBox kontrolü: ${eligible.length} barkod, ${batchCount} istek`,
        connection.id
      );
    }

    const service = new TrendyolService(connection);
    const results = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));

    const barcodeToMp = new Map();
    for (const mp of eligible) barcodeToMp.set(mp.product.barcode, mp);

    const barcodes = eligible.map(mp => mp.product.barcode);
    const now = new Date();

    for (let i = 0; i < barcodes.length; i += 10) {
      const batch = barcodes.slice(i, i + 10);
      try {
        const data = await service.getBuyboxInfo(batch);
        const buyboxInfoList = data?.buyboxInfo || [];

        for (const info of buyboxInfoList) {
          const mp = barcodeToMp.get(info.barcode);
          if (!mp) continue;

          await prisma.buyboxRecord.upsert({
            where: { connectionId_barcode: { connectionId: connection.id, barcode: info.barcode } },
            update: {
              productId: mp.product.id,
              buyboxOrder: info.buyboxOrder ?? null,
              buyboxPrice: info.buyboxPrice ?? null,
              hasMultipleSeller: info.hasMultipleSeller ?? false,
              checkedAt: now,
            },
            create: {
              connectionId: connection.id,
              productId: mp.product.id,
              barcode: info.barcode,
              buyboxOrder: info.buyboxOrder ?? null,
              buyboxPrice: info.buyboxPrice ?? null,
              hasMultipleSeller: info.hasMultipleSeller ?? false,
              checkedAt: now,
            }
          });

          results.push({
            barcode: info.barcode,
            productId: mp.product.id,
            title: mp.product.title,
            sku: mp.product.sku,
            ourPrice: mp.marketplacePrice,
            buyboxOrder: info.buyboxOrder,
            buyboxPrice: info.buyboxPrice,
            hasMultipleSeller: info.hasMultipleSeller,
            isWinning: info.buyboxOrder === 1,
            checkedAt: now,
          });
        }

        // Barcodes not returned by API — update checkedAt so they rotate out properly
        for (const barcode of batch) {
          if (!buyboxInfoList.find(b => b.barcode === barcode)) {
            const mp = barcodeToMp.get(barcode);
            if (!mp) continue;
            await prisma.buyboxRecord.upsert({
              where: { connectionId_barcode: { connectionId: connection.id, barcode } },
              update: { productId: mp.product.id, buyboxOrder: null, buyboxPrice: null, hasMultipleSeller: false, checkedAt: now },
              create: { connectionId: connection.id, productId: mp.product.id, barcode, buyboxOrder: null, buyboxPrice: null, hasMultipleSeller: false, checkedAt: now }
            });
            results.push({ barcode, productId: mp.product.id, title: mp.product.title, sku: mp.product.sku, ourPrice: mp.marketplacePrice, buyboxOrder: null, buyboxPrice: null, hasMultipleSeller: false, isWinning: false, checkedAt: now });
          }
        }
      } catch (batchErr) {
        console.error(`[BuyBox] Batch ${i}-${i+10} failed:`, batchErr.message);
      }

      if (i + 10 < barcodes.length) await delay(100);
    }

    const losing = results.filter(r => r.buyboxOrder !== null && r.buyboxOrder > 1);
    const winning = results.filter(r => r.buyboxOrder === 1);

    if (losing.length > 0) {
      await notificationService.create({
        storeId: connection.storeId,
        title: 'BuyBox Uyarısı',
        message: `${losing.length} üründe BuyBox kazanılamıyor. En düşük rakip fiyat: ${Math.min(...losing.map(r => r.buyboxPrice || Infinity)).toFixed(2)}₺`,
        type: 'warning',
        link: '/buybox'
      });
    }

    res.json({
      checked: results.length,
      totalEligible: allEligible.length,
      winning: winning.length,
      losing: losing.length,
      creditUsed: totalCost,
      results,
    });
  } catch (error) {
    if (error.statusCode === 402) return res.status(402).json({ error: error.message });
    next(error);
  }
});

// GET all current buybox records for a connection (one row per barcode, latest values)
router.get('/connections/:id/buybox-history', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return res.status(404).json({ error: 'Bağlantı bulunamadı' });

    const records = await prisma.buyboxRecord.findMany({
      where: { connectionId: connection.id },
      include: { product: { select: { title: true, sku: true } } },
      orderBy: [{ buyboxOrder: 'asc' }, { checkedAt: 'desc' }]
    });

    res.json(records);
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
      
      const items = marketplaceProducts.map(mp => ({
        barcode: mp.product.barcode || mp.product.sku, // Trendyol uses barcode for price/stock update
        quantity: mp.product.stock,
        salePrice: mp.product.price,
        listPrice: mp.product.listPrice > mp.product.price ? mp.product.listPrice : mp.product.price
      }));
      
      const result = await service.updatePriceAndInventory(items);
      
      // Update local marketplace product records with the new price/stock and batchRequestId
      for (const mp of marketplaceProducts) {
        await prisma.marketplaceProduct.update({
          where: { id: mp.id },
          data: {
            marketplacePrice: mp.product.price,
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
        link: '/marketplace'
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

module.exports = router;
