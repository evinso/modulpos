const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { checkProductLimit } = require('../utils/quotaHelper');
const { matchPriceRangeRule, calcPriceRangePrice } = require('../utils/pricingHelper');

const router = express.Router();

router.use(auth);

// Get user's store helper
async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

// List products with filtering and pagination
router.get('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const {
      page = 1,
      limit = 20,
      search,
      status,
      brand,
      category,
      categories,
      xmlSourceId,
      connectionId,
      marketplaceStatus,
      globalXmlOnly,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const where = { storeId: store.id };

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } }
      ];
    }
    if (status) where.status = status;
    if (brand) where.brand = brand;
    if (categories) {
      const catList = categories.split(',').map(c => c.trim()).filter(Boolean);
      // Match exact OR pipe-separated format (e.g. localCategory "Elbise" matches p.category "Kadın|Elbise|Günlük")
      where.OR = catList.flatMap(c => [
        { category: c },
        { category: { contains: `|${c}|` } },
        { category: { startsWith: `${c}|` } },
        { category: { endsWith: `|${c}` } },
      ]);
    } else if (category) {
      where.category = category;
    }
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;
    if (globalXmlOnly === 'true') where.xmlSource = { globalProviderId: { not: null } };
    if (connectionId || marketplaceStatus) {
      where.marketplaceProducts = { some: {} };
      if (connectionId) where.marketplaceProducts.some.connectionId = connectionId;
      if (marketplaceStatus) where.marketplaceProducts.some.status = marketplaceStatus;
    }

    const [rawProducts, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          variants: true,
          marketplaceProducts: {
            include: { connection: { select: { marketplaceType: true } } }
          },
          xmlSource: { select: { name: true, globalProviderId: true } }
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.product.count({ where })
    ]);

    // Attach globalProvider.orderFee without a schema relation
    const globalProviderIds = [...new Set(rawProducts.map(p => p.xmlSource?.globalProviderId).filter(Boolean))];
    let providerFeeMap = {};
    if (globalProviderIds.length > 0) {
      const providers = await prisma.globalXmlProvider.findMany({
        where: { id: { in: globalProviderIds } },
        select: { id: true, orderFee: true }
      });
      providerFeeMap = Object.fromEntries(providers.map(p => [p.id, p.orderFee]));
    }

    const products = rawProducts.map(p => ({
      ...p,
      xmlSource: p.xmlSource ? {
        ...p.xmlSource,
        globalProvider: p.xmlSource.globalProviderId
          ? { orderFee: providerFeeMap[p.xmlSource.globalProviderId] ?? 0 }
          : null
      } : null
    }));

    res.json({
      products,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get all product IDs (for bulk select all)
router.get('/ids', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const { search, status, brand, category, xmlSourceId } = req.query;
    const where = { storeId: store.id };

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } }
      ];
    }
    if (status) where.status = status;
    if (brand) where.brand = brand;
    if (category) where.category = category;
    if (xmlSourceId) where.xmlSourceId = xmlSourceId;

    const products = await prisma.product.findMany({
      where,
      select: { id: true }
    });

    res.json({ ids: products.map(p => p.id), total: products.length });
  } catch (error) {
    next(error);
  }
});

// Get single product
router.get('/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        variants: true,
        marketplaceProducts: {
          include: { connection: true }
        },
        xmlSource: true
      }
    });

    if (!product) {
      return res.status(404).json({ error: 'Ürün bulunamadı' });
    }

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// Create product
router.post('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const {
      sku, barcode, title, description, price, cost, listPrice,
      stock, brand, category, images, attributes, weight, desi, vatRate
    } = req.body;

    if (!sku || !title) {
      return res.status(400).json({ error: 'SKU ve başlık zorunludur' });
    }

    await checkProductLimit(req.user.id, store.id, 1);

    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        sku,
        barcode,
        title,
        description,
        price: price || 0,
        cost: cost || 0,
        listPrice: listPrice || 0,
        stock: stock || 0,
        brand,
        category,
        images: images ? JSON.stringify(images) : null,
        attributes: attributes ? JSON.stringify(attributes) : null,
        weight,
        desi,
        vatRate: vatRate || 18
      },
      include: { variants: true }
    });

    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

// Update product
router.put('/:id', async (req, res, next) => {
  try {
    const {
      title, description, price, cost, listPrice, stock,
      brand, category, images, attributes, weight, desi, vatRate, status
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (price !== undefined) data.price = price;
    if (cost !== undefined) data.cost = cost;
    if (listPrice !== undefined) data.listPrice = listPrice;
    if (stock !== undefined) data.stock = stock;
    if (brand !== undefined) data.brand = brand;
    if (category !== undefined) data.category = category;
    if (images !== undefined) data.images = JSON.stringify(images);
    if (attributes !== undefined) data.attributes = JSON.stringify(attributes);
    if (weight !== undefined) data.weight = weight;
    if (desi !== undefined) data.desi = desi;
    if (vatRate !== undefined) data.vatRate = vatRate;
    if (status !== undefined) data.status = status;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: { variants: true, marketplaceProducts: true }
    });

    res.json(product);
  } catch (error) {
    next(error);
  }
});

// Delete product
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ message: 'Ürün silindi' });
  } catch (error) {
    next(error);
  }
});

// Bulk actions
router.post('/bulk-action', async (req, res, next) => {
  try {
    const { action, productIds, value } = req.body;

    if (!action || !productIds?.length) {
      return res.status(400).json({ error: 'İşlem ve ürün seçimi zorunludur' });
    }

    let result;
    switch (action) {
      case 'activate':
        result = await prisma.product.updateMany({
          where: { id: { in: productIds } },
          data: { status: 'active' }
        });
        break;
      case 'deactivate':
        result = await prisma.product.updateMany({
          where: { id: { in: productIds } },
          data: { status: 'passive' }
        });
        break;
      case 'delete':
        result = await prisma.product.deleteMany({
          where: { id: { in: productIds } }
        });
        break;
      case 'price_increase_percent': {
        const pct = parseFloat(value);
        if (isNaN(pct)) return res.status(400).json({ error: 'Geçerli bir yüzde değeri girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.round(p.price * (1 + pct / 100) * 100) / 100 } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'price_decrease_percent': {
        const pct = parseFloat(value);
        if (isNaN(pct)) return res.status(400).json({ error: 'Geçerli bir yüzde değeri girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.max(0, Math.round(p.price * (1 - pct / 100) * 100) / 100) } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'price_increase_fixed': {
        const amount = parseFloat(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir tutar girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.round((p.price + amount) * 100) / 100 } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'price_decrease_fixed': {
        const amount = parseFloat(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir tutar girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, price: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { price: Math.max(0, Math.round((p.price - amount) * 100) / 100) } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'set_stock': {
        const stock = parseInt(value);
        if (isNaN(stock)) return res.status(400).json({ error: 'Geçerli bir stok değeri girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds } },
          data: { stock }
        });
        break;
      }
      case 'stock_increase': {
        const amount = parseInt(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir değer girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { stock: p.stock + amount } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'stock_decrease': {
        const amount = parseInt(value);
        if (isNaN(amount)) return res.status(400).json({ error: 'Geçerli bir değer girin' });
        const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true } });
        const updates = products.map(p => prisma.product.update({ where: { id: p.id }, data: { stock: Math.max(0, p.stock - amount) } }));
        await prisma.$transaction(updates);
        result = { count: products.length };
        break;
      }
      case 'set_category': {
        if (!value) return res.status(400).json({ error: 'Kategori adı girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds } },
          data: { category: value }
        });
        break;
      }
      case 'set_brand': {
        if (!value) return res.status(400).json({ error: 'Marka adı girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds } },
          data: { brand: value }
        });
        break;
      }
      case 'set_vat_rate': {
        const rate = parseInt(value);
        if (isNaN(rate)) return res.status(400).json({ error: 'Geçerli bir KDV oranı girin' });
        result = await prisma.product.updateMany({
          where: { id: { in: productIds } },
          data: { vatRate: rate }
        });
        break;
      }
      case 'sync_marketplaces': {
        // Bulunan ürünleri ve marketplace ürünlerini çek
        const marketplaceProducts = await prisma.marketplaceProduct.findMany({
          where: { productId: { in: productIds } },
          include: { product: true, connection: true }
        });
        if (marketplaceProducts.length === 0) {
          return res.status(400).json({ error: 'Seçilen ürünlerin hiçbiri bir pazaryerine gönderilmemiş' });
        }
        
        // Bağlantılara göre grupla
        const grouped = {};
        for (const mp of marketplaceProducts) {
          if (!grouped[mp.connectionId]) grouped[mp.connectionId] = { connection: mp.connection, mps: [] };
          grouped[mp.connectionId].mps.push(mp);
        }
        
        let syncedCount = 0;
        let errorMessages = [];
        
        for (const connId in grouped) {
          const { connection, mps } = grouped[connId];
          if (connection.marketplaceType === 'trendyol') {
            try {
              const TrendyolService = require('../services/trendyol/trendyolService');
              const service = new TrendyolService(connection);
              
              // Fetch pricing rules for this connection
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
                  if (conds.connectionId === connection.id && conds.xmlSourceId) {
                    pricingLookup[conds.xmlSourceId] = r;
                  }
                  if (conds.minPurchasePrice != null || conds.maxPurchasePrice != null) {
                    priceRangeRules.push(r);
                  }
                } catch(e) {}
              }

              const items = mps.map(mp => {
                // Determine final price based on rules
                let finalPrice = mp.product.price;
                const rule = pricingLookup[mp.product.xmlSourceId];

                if (rule) {
                  if (rule.type === 'percentage') {
                    finalPrice = finalPrice * (1 + rule.value / 100);
                  } else if (rule.type === 'fixed') {
                    finalPrice = finalPrice + rule.value;
                  }
                  finalPrice = Math.round(Math.max(0, finalPrice) * 100) / 100;
                } else {
                  const xmlPrice = mp.product.xmlPrice || mp.product.price;
                  const match = matchPriceRangeRule(xmlPrice, priceRangeRules, connection.id, mp.product.xmlSourceId);
                  if (match) finalPrice = calcPriceRangePrice(xmlPrice, match.rule, match.conds);
                }

                return {
                  barcode: mp.product.barcode || mp.product.sku,
                  quantity: mp.product.stock,
                  salePrice: finalPrice,
                  listPrice: mp.product.listPrice > finalPrice ? mp.product.listPrice : finalPrice
                };
              });
              
              const syncRes = await service.updatePriceAndInventory(items);
              
              // Veritabanını güncelle
              for (const item of items) {
                // items array has final salePrice and barcode
                const mp = mps.find(m => (m.product.barcode || m.product.sku) === item.barcode);
                if (!mp) continue;
                
                await prisma.marketplaceProduct.update({
                  where: { id: mp.id },
                  data: {
                    marketplacePrice: item.salePrice,
                    marketplaceStock: item.quantity,
                    batchRequestId: syncRes?.batchRequestId || mp.batchRequestId,
                    lastSyncedAt: new Date()
                  }
                });
                syncedCount++;
              }
            } catch (e) {
              errorMessages.push(`${connection.supplierName || connection.marketplaceType}: ${e.response?.data?.message || e.message}`);
            }
          }
        }
        
        if (syncedCount === 0 && errorMessages.length > 0) {
          return res.status(500).json({ error: 'Güncelleme hataları: ' + errorMessages.join(', ') });
        }
        
        const warningStr = errorMessages.length > 0 ? ` (Bazı hatalar: ${errorMessages.join(', ')})` : '';
        return res.json({ message: `${syncedCount} ürün pazaryerlerinde güncellendi${warningStr}`, count: syncedCount });
      }
      default:
        return res.status(400).json({ error: 'Geçersiz işlem' });
    }

    res.json({ message: `${result.count} ürün güncellendi`, count: result.count });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
