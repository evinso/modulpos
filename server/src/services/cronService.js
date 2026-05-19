const cron = require('node-cron');
const prisma = require('../config/database');
const { parseXml } = require('./xml/xmlParser');
const notificationService = require('./notificationService');
const TrendyolService = require('./trendyol/trendyolService');
const { matchPriceRangeRule, calcPriceRangePrice } = require('../utils/pricingHelper');
const { processAutoAnswerForCron } = require('../routes/questions');

function resolveUserPlan(rawPlan) {
  const p = (rawPlan || '').toLowerCase();
  if (p === 'kurumsal' || p === 'enterprise') return 'Kurumsal';
  if (p === 'profesyonel' || p === 'premium' || p === 'pro' || p === 'growth') return 'Profesyonel';
  return 'Başlangıç';
}

function getPerPlanMarkup(byPlanJson, userPlan) {
  if (!byPlanJson) return null;
  try {
    const map = JSON.parse(byPlanJson);
    const val = map[userPlan];
    return (val !== undefined && val !== '' && val !== null) ? parseFloat(val) : null;
  } catch { return null; }
}

class CronService {
  start() {
    // Run every 10 minutes to check if any XML needs syncing
    cron.schedule('*/10 * * * *', async () => {
      console.log('[CRON] Checking for XML sources that need synchronization...');
      await this.syncXmlSources();
    });

    // Run every 30 minutes to sync & auto-answer Trendyol questions
    cron.schedule('*/30 * * * *', async () => {
      console.log('[CRON] Syncing Trendyol customer questions...');
      await this.syncQuestions();
    });
  }

  async syncQuestions() {
    try {
      const stores = await prisma.store.findMany({ select: { id: true } });
      for (const store of stores) {
        const { synced, autoAnswered } = await processAutoAnswerForCron(store.id);
        if (synced > 0) {
          console.log(`[CRON/Questions] Store ${store.id}: ${synced} yeni soru, ${autoAnswered} otomatik yanıtlandı`);
        }
      }
    } catch (err) {
      console.error('[CRON/Questions] Sync hatası:', err.message);
    }
  }

  async syncXmlSources() {
    try {
      const activeSources = await prisma.xmlSource.findMany({
        where: { status: 'active' },
        include: { store: true }
      });

      for (const source of activeSources) {
        const now = new Date();
        const lastSync = source.lastSyncedAt ? new Date(source.lastSyncedAt) : new Date(0);
        const diffMinutes = Math.floor((now - lastSync) / (1000 * 60));

        // Wait, the user said "60 dakikada bir" (every 60 mins)
        // If the diff is greater than or equal to syncIntervalMin (which is 60 by default), sync!
        if (diffMinutes >= (source.syncIntervalMin || 60)) {
          console.log(`[CRON] Syncing XML Source: ${source.name} (Store: ${source.storeId})`);
          await this.processXmlSync(source);
        }
      }
    } catch (error) {
      console.error('[CRON Error] Failed to sync XML sources:', error);
    }
  }

  async processXmlSync(xmlSource) {
    let syncLog = null;
    try {
      syncLog = await prisma.syncLog.create({
        data: { storeId: xmlSource.storeId, type: 'xml_sync', status: 'started' }
      });

      // Mağaza sahibinin aktif planını bul
      const storeOwner = await prisma.store.findUnique({ where: { id: xmlSource.storeId }, select: { userId: true } });
      const userSub = storeOwner ? await prisma.subscription.findFirst({
        where: { userId: storeOwner.userId, status: 'active' },
        orderBy: { endDate: 'desc' }
      }) : null;
      const userPlan = resolveUserPlan(userSub?.plan);

      const products = await parseXml(xmlSource.url, xmlSource.mappingConfig);
      let created = 0, updated = 0, errors = 0;

      for (const p of products) {
        try {
          const sku = p.sku || p.barcode || `xml-${Date.now()}-${Math.random()}`;
          let rawXmlPrice = p.price || 0;

          const planMarkupPct = getPerPlanMarkup(xmlSource.globalPriceMarkupPctByPlan, userPlan);
          if (planMarkupPct !== null) {
            rawXmlPrice += rawXmlPrice * (planMarkupPct / 100);
          } else if (xmlSource.globalPriceMarkupPct) {
            rawXmlPrice += rawXmlPrice * (xmlSource.globalPriceMarkupPct / 100);
          }
          if (xmlSource.globalPriceMarkup) {
            rawXmlPrice += xmlSource.globalPriceMarkup;
          }
          if (xmlSource.purchaseVatRate && xmlSource.purchaseVatRate > 0) {
            rawXmlPrice = rawXmlPrice * (1 + xmlSource.purchaseVatRate / 100);
          }

          const xmlPrice = Math.round(rawXmlPrice * 100) / 100;

          const rawXmlData = JSON.stringify({
            sku: p.sku, barcode: p.barcode, title: p.title, description: p.description,
            price: p.price, listPrice: p.listPrice, cost: p.cost, stock: p.stock,
            brand: p.brand, category: p.category, images: p.images
          });

          let finalPrice = xmlPrice;

          const rawBarcode = (p.barcode && !/^[{}[\]]+$/.test(p.barcode.trim())) ? p.barcode : null;
          const baseBarcode = xmlSource.globalBarcodePrefix
            ? `${xmlSource.globalBarcodePrefix}${rawBarcode || sku}`
            : (rawBarcode || sku);

          const finalBarcode = xmlSource.barcodePrefix
            ? `${xmlSource.barcodePrefix}${baseBarcode}`
            : baseBarcode;

          const existing = await prisma.product.findFirst({ 
            where: { storeId: xmlSource.storeId, xmlSourceId: xmlSource.id, sku } 
          });

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
                storeId: xmlSource.storeId,
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

      await prisma.syncLog.update({ 
        where: { id: syncLog.id }, 
        data: { status: 'completed', itemCount: created + updated, errorCount: errors, completedAt: new Date() } 
      });
      
      await prisma.xmlSource.update({ 
        where: { id: xmlSource.id }, 
        data: { lastSyncedAt: new Date(), totalProducts: products.length, status: 'active' } 
      });

      await notificationService.create({
        storeId: xmlSource.storeId,
        title: 'Otomatik XML Senkronizasyonu',
        message: `"${xmlSource.name}" başarıyla senkronize edildi. ${created} yeni, ${updated} güncellendi.`,
        type: errors > 0 ? 'warning' : 'success',
        link: '/products'
      });

      console.log(`[CRON] Finished XML Sync for ${xmlSource.name}. Triggering auto-send to Trendyol...`);
      await this.autoSendToMarketplaces(xmlSource.storeId, xmlSource.id);

    } catch (error) {
      console.error(`[CRON] XML Sync failed for ${xmlSource.name}:`, error.message);
      if (syncLog) {
        await prisma.syncLog.update({
          where: { id: syncLog.id },
          data: { status: 'failed', completedAt: new Date() }
        });
      }
      await prisma.auditLog.create({
        data: {
          action: 'CRON_XML_SYNC_ERROR',
          details: JSON.stringify({ xmlSourceId: xmlSource.id, error: error.message }),
          level: 'ERROR'
        }
      }).catch(() => {});
    }
  }

  async autoSendToMarketplaces(storeId, xmlSourceId) {
    try {
      // Build pricing rule structures for this store
      const allRules = await prisma.pricingRule.findMany({
        where: { storeId, isActive: true, applyTo: { in: ['marketplace_xml', 'price_range'] } }
      });

      const standardLookup = {}; // { connectionId: { xmlSourceId: rule } }
      const priceRangeRules = [];
      for (const r of allRules) {
        if (!r.conditions) continue;
        try {
          const conds = JSON.parse(r.conditions);
          if (r.applyTo === 'price_range' && (conds.minPurchasePrice != null || conds.maxPurchasePrice != null)) {
            priceRangeRules.push(r);
          } else if (r.applyTo !== 'price_range' && conds.connectionId && conds.xmlSourceId) {
            if (!standardLookup[conds.connectionId]) standardLookup[conds.connectionId] = {};
            standardLookup[conds.connectionId][conds.xmlSourceId] = r;
          }
        } catch(e) {}
      }

      // Find active Trendyol connections for this store
      const connections = await prisma.marketplaceConnection.findMany({
        where: { storeId, marketplaceType: 'trendyol', status: 'active' }
      });

      for (const conn of connections) {
        try {
          // Find marketplace products for this connection whose product came from this XML source
          const existingMPs = await prisma.marketplaceProduct.findMany({
            where: { connectionId: conn.id, product: { xmlSourceId } },
            include: { product: true }
          });

          if (existingMPs.length === 0) continue;

          const service = new TrendyolService(conn);
          const items = [];

          for (const mp of existingMPs) {
            const p = mp.product;
            if (!p || !p.barcode) continue;

            const xmlPrice = p.xmlPrice || p.price;

            // Determine sale price from pricing rules
            let salePrice = null;
            const stdRule = standardLookup[conn.id]?.[xmlSourceId];
            if (stdRule) {
              let fp = p.price;
              if (stdRule.type === 'percentage') fp = fp * (1 + stdRule.value / 100);
              if (stdRule.type === 'fixed') fp = fp + stdRule.value;
              salePrice = Math.round(Math.max(0, fp) * 100) / 100;
            }

            if (salePrice === null && xmlPrice > 0) {
              const rangeMatch = matchPriceRangeRule(xmlPrice, priceRangeRules, conn.id, xmlSourceId);
              if (rangeMatch) salePrice = calcPriceRangePrice(xmlPrice, rangeMatch.rule, rangeMatch.conds);
            }

            if (salePrice === null) continue;

            const listPrice = p.listPrice > salePrice ? p.listPrice : salePrice;
            items.push({ barcode: p.barcode, quantity: p.stock, salePrice, listPrice });

            await prisma.marketplaceProduct.update({
              where: { id: mp.id },
              data: { marketplacePrice: salePrice, marketplaceStock: p.stock, lastSyncedAt: new Date() }
            });
          }

          if (items.length > 0) {
            await service.updatePriceAndInventory(items);
            console.log(`[CRON] Updated ${items.length} products on Trendyol (connection ${conn.id})`);
            await notificationService.create({
              storeId,
              title: 'Otomatik Trendyol Güncelleme',
              message: `${items.length} ürünün fiyat ve stoğu Trendyol'da otomatik güncellendi.`,
              type: 'success',
              link: '/products'
            });
          }
        } catch (connErr) {
          console.error(`[CRON] Trendyol sync failed for connection ${conn.id}:`, connErr.message);
        }
      }
    } catch (error) {
      console.error(`[CRON] autoSendToMarketplaces failed for store ${storeId}:`, error.message);
    }
  }
}

module.exports = new CronService();
