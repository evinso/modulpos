const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

// Dashboard metrics
router.get('/metrics', async (req, res, next) => {
  try {
    const store = await prisma.store.findFirst({
      where: { userId: req.user.id }
    });

    if (!store) {
      return res.status(404).json({ error: 'Mağaza bulunamadı' });
    }

    const [
      totalProducts,
      activeProducts,
      totalOrders,
      pendingOrders,
      totalConnections,
      totalXmlSources,
      recentOrders,
      syncLogs
    ] = await Promise.all([
      prisma.product.count({ where: { storeId: store.id } }),
      prisma.product.count({ where: { storeId: store.id, status: 'active' } }),
      prisma.order.count({ where: { storeId: store.id } }),
      prisma.order.count({ where: { storeId: store.id, status: 'new' } }),
      prisma.marketplaceConnection.count({ where: { storeId: store.id, status: 'active' } }),
      prisma.xmlSource.count({ where: { storeId: store.id, status: 'active' } }),
      prisma.order.findMany({
        where: { storeId: store.id },
        orderBy: { orderDate: 'desc' },
        take: 10
      }),
      prisma.syncLog.findMany({
        where: { storeId: store.id },
        orderBy: { startedAt: 'desc' },
        take: 10
      })
    ]);

    // Calculate total revenue
    const revenueAgg = await prisma.order.aggregate({
      where: { storeId: store.id, status: { not: 'cancelled' } },
      _sum: { totalAmount: true }
    });
    const totalRevenue = revenueAgg._sum.totalAmount || 0;

    // Today's orders
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = await prisma.order.count({
      where: {
        storeId: store.id,
        orderDate: { gte: today }
      }
    });

    // Low stock products
    const lowStockProducts = await prisma.product.count({
      where: {
        storeId: store.id,
        stock: { lte: 5 },
        status: 'active'
      }
    });

    res.json({
      metrics: {
        totalProducts,
        activeProducts,
        totalOrders,
        pendingOrders,
        todayOrders,
        totalRevenue,
        totalConnections,
        totalXmlSources,
        lowStockProducts
      },
      recentOrders,
      syncLogs
    });
  } catch (error) {
    next(error);
  }
});

// Get comprehensive system and sync logs for the user
router.get('/logs', auth, async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const [syncLogs, auditLogs] = await Promise.all([
      prisma.syncLog.findMany({
        where: { storeId: store.id },
        orderBy: { startedAt: 'desc' },
        take: 50
      }),
      prisma.auditLog.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    ]);

    // Format logs into a unified list
    const unifiedLogs = [
      ...syncLogs.map(log => ({
        id: log.id,
        type: log.type === 'xml_sync' ? 'XML Senkronizasyonu' : log.type,
        status: log.status, // started, completed, failed
        message: log.status === 'failed' 
          ? 'Senkronizasyon başarısız oldu' 
          : `${log.itemCount || 0} ürün işlendi, ${log.errorCount || 0} hata.`,
        level: log.status === 'failed' ? 'ERROR' : (log.errorCount > 0 ? 'WARNING' : 'INFO'),
        createdAt: log.startedAt,
        source: 'SYNC'
      })),
      ...auditLogs.map(log => {
        let title = log.action;
        let msg = log.details;
        
        try {
          const parsed = JSON.parse(log.details);
          if (parsed.error) msg = parsed.error;
        } catch(e) {}

        if (log.action === 'XML_SYNC_ERROR') title = 'XML Çekme Hatası';
        if (log.action === 'TRENDYOL_SEND_ERROR') title = 'Trendyol Ürün Gönderim Hatası';
        if (log.action === 'TRENDYOL_SYNC_ERROR') title = 'Trendyol Fiyat/Stok Senkronizasyon Hatası';
        if (log.action === 'CRON_XML_SYNC_ERROR') title = 'Otomatik XML Senkronizasyon Hatası';
        if (log.action === 'LOGIN') {
          title = 'Sisteme Giriş';
          msg = 'Başarılı giriş yapıldı.';
        }

        return {
          id: log.id,
          type: title,
          status: log.level === 'ERROR' ? 'failed' : 'completed',
          message: msg,
          level: log.level,
          createdAt: log.createdAt,
          source: 'AUDIT'
        };
      })
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);

    res.json(unifiedLogs);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
