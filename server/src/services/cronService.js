const cron = require('node-cron');
const prisma = require('../config/database');
const { parseXml } = require('./xml/xmlParser');
const notificationService = require('./notificationService');
const { runSubscriptionAlerts } = require('./subscriptionAlerts');
const TrendyolService = require('./trendyol/trendyolService');
const { loadPricingContext } = require('./pricingEngine');
const { processAutoAnswerForCron } = require('../routes/questions');
const { syncAllOrders } = require('./orderSyncService');
const whatsappService = require('./whatsappService');
const { startXmlSync, failStaleSyncs, failAbandonedSyncs, isRunning } = require('./xml/syncService');
const { runRetention } = require('./retentionService');
const SS = require('./sendSettings');
const { pushInBatches } = require('./batchPush');

class CronService {
  constructor() { this.staleAlerted = new Map(); }

  start() {
    failStaleSyncs().catch((e) => console.error('[Sync] stale cleanup:', e.message));

    // Housekeeping: trim old logs once a day (and shortly after boot)
    cron.schedule('15 3 * * *', () => { runRetention().catch((e) => console.error('[Retention]', e.message)); });
    setTimeout(() => { runRetention().catch((e) => console.error('[Retention]', e.message)); }, 2 * 60 * 1000);

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

    // Subscription about to end / just ended (once per end date, see services/subscriptionAlerts.js)
    cron.schedule('0 */6 * * *', () => { runSubscriptionAlerts().catch((e) => console.error('[CRON/Subscriptions]', e.message)); });

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
          notificationService.create({
            storeId: store.id, title: 'Yeni Müşteri Soruları',
            message: `${synced} yeni soru alındı.${autoAnswered > 0 ? ` ${autoAnswered} tanesi otomatik yanıtlandı.` : ''}`,
            type: 'info', link: '/questions', waEvent: 'new_question',
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[CRON/Questions] Sync hatası:', err.message);
    }
  }

  async syncXmlSources() {
    try {
      await failAbandonedSyncs().catch((e) => console.error('[Sync] abandoned cleanup:', e.message));
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

        // Nobody is told when a feed silently stops syncing – raise a notification (at most once per 12h per source)
        const lastOk = source.lastSyncedAt ? new Date(source.lastSyncedAt).getTime() : 0;
        const staleAfter = Math.max(3 * (source.syncIntervalMin || 60), 180);
        if (lastOk && Math.floor((Date.now() - lastOk) / 60000) > staleAfter) {
          const prev = this.staleAlerted.get(source.id) || 0;
          if (Date.now() - prev > 12 * 60 * 60 * 1000) {
            this.staleAlerted.set(source.id, Date.now());
            notificationService.create({
              storeId: source.storeId,
              title: 'XML senkronizasyonu gecikti',
              waEvent: 'xml_stale',
              message: `"${source.name}" kaynağı ${Math.round((Date.now() - lastOk) / 3600000)} saattir başarıyla senkronize edilemedi. Kaynağı ve bağlantıyı kontrol edin.`,
              type: 'warning',
              link: '/xml-sources',
            }).catch(() => {});
          }
        }

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
            where: { connectionId: conn.id, status: 'active', product: { xmlSourceId } },
            include: { product: true }
          });

          if (existingMPs.length === 0) continue;

          const service = new TrendyolService(conn);
          const priceCtx = await loadPricingContext(storeId, conn.id);
          let connCfg = {}; try { connCfg = conn.config ? JSON.parse(conn.config) : {}; } catch { /* ignore */ }
          const sendCfg = SS.normalizeSendSettings(connCfg.sendSettings);
          const items = [];
          const dbUpdates = [];

          for (const mp of existingMPs) {
            const p = mp.product;
            if (!p || !p.barcode) continue;

            const priced = priceCtx.priceFor(p);
            if (!priced) continue;
            const salePrice = priced.price;

            // Only push what actually changed on Trendyol
            const qty = SS.sendStock(p.stock, sendCfg);
            const sameStock = (mp.marketplaceStock ?? null) === qty;
            const samePrice = mp.marketplacePrice !== null && mp.marketplacePrice !== undefined && Math.abs(mp.marketplacePrice - salePrice) < 0.005;
            if (sameStock && samePrice) continue;

            const listPrice = p.listPrice > salePrice ? p.listPrice : salePrice;
            items.push({ barcode: p.barcode, quantity: qty, salePrice, listPrice });
            dbUpdates.push({ id: mp.id, data: { marketplacePrice: salePrice, marketplaceStock: qty, lastSyncedAt: new Date() } });
          }

          if (items.length > 0) {
            // In batches of 500: one huge request can be refused as a whole. Each accepted batch is recorded at once,
            // so a failure part-way only postpones the rest to the next run.
            const r = await pushInBatches(
              items,
              (part) => service.updatePriceAndInventory(part),
              async (start, part) => {
                // Record the new state only after Trendyol accepted the update
                const updates = dbUpdates.slice(start, start + part.length);
                for (let i = 0; i < updates.length; i += 50) {
                  await prisma.$transaction(updates.slice(i, i + 50).map((u) => prisma.marketplaceProduct.update({ where: { id: u.id }, data: u.data })));
                }
              },
            );
            if (r.error) console.error(`[CRON] Trendyol price/stock push stopped after ${r.sent} of ${items.length} products (connection ${conn.id}):`, r.error.response?.data?.message || r.error.message);
            if (r.sent > 0) {
              console.log(`[CRON] Updated ${r.sent} products on Trendyol (connection ${conn.id})`);
              await notificationService.create({
                storeId,
                title: 'Otomatik Trendyol Güncelleme',
                message: `${r.sent} ürünün fiyat ve stoğu Trendyol'da otomatik güncellendi.${r.failed > 0 ? ` ${r.failed} ürün sonraki turda tekrar denenecek.` : ''}`,
                type: r.failed > 0 ? 'warning' : 'success',
                link: '/products',
                noWhatsapp: true,
              });
              const storeObj = await prisma.store.findUnique({ where: { id: storeId }, select: { name: true, user: { select: { phone: true } } } }).catch(() => null);
              whatsappService.notifyTrendyolUpdate(storeObj?.name || storeId, r.sent, storeObj?.user?.phone || null).catch(() => {});
            }
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
