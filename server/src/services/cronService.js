const cron = require('node-cron');
const prisma = require('../config/database');
const { parseXml } = require('./xml/xmlParser');
const notificationService = require('./notificationService');
const TrendyolService = require('./trendyol/trendyolService');

class CronService {
  start() {
    // Run every 10 minutes to check if any XML needs syncing
    cron.schedule('*/10 * * * *', async () => {
      console.log('[CRON] Checking for XML sources that need synchronization...');
      await this.syncXmlSources();
    });
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

      const products = await parseXml(xmlSource.url, xmlSource.mappingConfig);
      let created = 0, updated = 0, errors = 0;

      for (const p of products) {
        try {
          const sku = p.sku || p.barcode || `xml-${Date.now()}-${Math.random()}`;
          let rawXmlPrice = p.price || 0;
          
          if (xmlSource.globalPriceMarkupPct) {
            rawXmlPrice += rawXmlPrice * (xmlSource.globalPriceMarkupPct / 100);
          }
          if (xmlSource.globalPriceMarkup) {
            rawXmlPrice += xmlSource.globalPriceMarkup;
          }

          const xmlPrice = rawXmlPrice;

          const rawXmlData = JSON.stringify({
            sku: p.sku, barcode: p.barcode, title: p.title, description: p.description,
            price: p.price, listPrice: p.listPrice, cost: p.cost, stock: p.stock,
            brand: p.brand, category: p.category, images: p.images
          });

          let finalPrice = xmlPrice;

          const baseBarcode = xmlSource.globalBarcodePrefix 
            ? `${xmlSource.globalBarcodePrefix}${p.barcode || sku}` 
            : (p.barcode || sku);

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
      // Find active trendyol connections for this store
      const connections = await prisma.marketplaceConnection.findMany({
        where: { storeId, marketplaceType: 'trendyol', isActive: true }
      });

      for (const conn of connections) {
        const service = new TrendyolService(conn);
        
        // Find all products for this XML source that have a category mapping
        const products = await prisma.product.findMany({
          where: { storeId, xmlSourceId },
          include: { categoryMappings: true }
        });

        const pricingRules = await prisma.pricingRule.findMany({
          where: { storeId }
        });
        const pricingLookup = {};
        for (const rule of pricingRules) {
          pricingLookup[rule.xmlSourceId] = rule;
        }

        const validProductsToSync = [];
        const catMap = {};
        
        for (const p of products) {
          if (!p.category) continue;
          
          let mapping = p.categoryMappings.find(m => m.categoryId === p.category && m.marketplaceType === 'trendyol');
          
          if (!mapping) continue;
          catMap[p.category] = mapping;
          
          const rule = pricingLookup[xmlSourceId];
          if (!rule) continue;

          let finalPrice = p.price;
          if (rule.type === 'percentage') {
            finalPrice = finalPrice * (1 + rule.value / 100);
          } else if (rule.type === 'fixed') {
            finalPrice = finalPrice + rule.value;
          }
          p.price = Math.round(Math.max(0, finalPrice) * 100) / 100;

          validProductsToSync.push(p);
        }

        if (validProductsToSync.length > 0) {
          // Send price and stock updates for existing marketplace products
          const existingMarketplaceProducts = await prisma.marketplaceProduct.findMany({
            where: { connectionId: conn.id, productId: { in: validProductsToSync.map(p => p.id) } }
          });

          if (existingMarketplaceProducts.length > 0) {
            const items = existingMarketplaceProducts.map(mp => {
              const productData = validProductsToSync.find(p => p.id === mp.productId);
              return {
                barcode: productData.barcode,
                price: productData.price,
                stock: productData.stock
              };
            });

            await service.updatePriceAndStock(items);
            console.log(`[CRON] Sent ${items.length} price/stock updates to Trendyol for connection ${conn.id}`);
          }
        }
      }
    } catch (error) {
      console.error(`[CRON] Trendyol Auto-Send failed for store ${storeId}:`, error.message);
    }
  }
}

module.exports = new CronService();
