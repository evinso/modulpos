const cron = require('node-cron');
const prisma = require('../config/database');
const { parseXml } = require('./xml/xmlParser');
const notificationService = require('./notificationService');
const TrendyolService = require('./trendyol/trendyolService');
const { loadPricingContext } = require('./pricingEngine');
const { processAutoAnswerForCron } = require('../routes/questions');
const { syncAllOrders } = require('./orderSyncService');
const whatsappService = require('./whatsappService');
const { startXmlSync, failStaleSyncs, isRunning } = require('./xml/syncService');

class CronService {
  start() {
    failStaleSyncs().catch((e) => console.error('[Sync] stale cleanup:', e.message));

    // Run every 5 minutes to pull new orders from all marketplaces
    cron.schedule('*/5 * * * *', async () => {
      const count = await syncAllOrders();
      if (count > 0) console.log(`[CRON/Orders] ${count} yeni sipariş çekildi`);
    });

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
      const activeSources = await prisma.xmlSource.findMany({ where: { status: 'active' }, include: { store: true } });

      for (const source of activeSources) {
        if (isRunning(source.id)) continue;

        // Use the latest *attempt* (not only the last success) so a failing feed is
        // retried at its normal interval instead of being hammered every 10 minutes.
        const lastAttempt = await prisma.syncLog.findFirst({
          where: { xmlSourceId: source.id, type: 'xml_sync' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true },
        });
        const lastTs = Math.max(
          source.lastSyncedAt ? new Date(source.lastSyncedAt).getTime() : 0,
          lastAttempt ? new Date(lastAttempt.startedAt).getTime() : 0,
        );
        const diffMinutes = Math.floor((Date.now() - lastTs) / 60000);

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
    try {
      const job = await startXmlSync(xmlSource.id, { trigger: 'cron' });
      const result = await job.promise;
      if (result && !result.error) {
        console.log(`[CRON] Finished XML Sync for ${xmlSource.name}. Triggering auto-send to Trendyol...`);
        await this.autoSendToMarketplaces(xmlSource.storeId, xmlSource.id);
      }
    } catch (error) {
      if (error.code !== 'SYNC_RUNNING') console.error(`[CRON] XML Sync failed for ${xmlSource.name}:`, error.message);
    }
  }

  async autoSendToMarketplaces(storeId, xmlSourceId) {
    try {
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
          const priceCtx = await loadPricingContext(storeId, conn.id);
          const items = [];
          const dbUpdates = [];

          for (const mp of existingMPs) {
            const p = mp.product;
            if (!p || !p.barcode) continue;

            const priced = priceCtx.priceFor(p);
            if (!priced) continue;
            const salePrice = priced.price;

            // Only push what actually changed on Trendyol
            const sameStock = (mp.marketplaceStock ?? null) === (p.stock ?? null);
            const samePrice = mp.marketplacePrice !== null && mp.marketplacePrice !== undefined && Math.abs(mp.marketplacePrice - salePrice) < 0.005;
            if (sameStock && samePrice) continue;

            const listPrice = p.listPrice > salePrice ? p.listPrice : salePrice;
            items.push({ barcode: p.barcode, quantity: p.stock, salePrice, listPrice });
            dbUpdates.push({ id: mp.id, data: { marketplacePrice: salePrice, marketplaceStock: p.stock, lastSyncedAt: new Date() } });
          }

          if (items.length > 0) {
            await service.updatePriceAndInventory(items);
            // Record the new state only after Trendyol accepted the update
            for (let i = 0; i < dbUpdates.length; i += 50) {
              const part = dbUpdates.slice(i, i + 50);
              await prisma.$transaction(part.map((u) => prisma.marketplaceProduct.update({ where: { id: u.id }, data: u.data })));
            }
            console.log(`[CRON] Updated ${items.length} products on Trendyol (connection ${conn.id})`);
            await notificationService.create({
              storeId,
              title: 'Otomatik Trendyol Güncelleme',
              message: `${items.length} ürünün fiyat ve stoğu Trendyol'da otomatik güncellendi.`,
              type: 'success',
              link: '/products',
              noWhatsapp: true,
            });
            const storeObj = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true, user: { select: { phone: true } } } }).catch(() => null);
            whatsappService.notifyTrendyolUpdate(storeObj?.name || storeId, items.length, storeObj?.user?.phone || null).catch(() => {});
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
