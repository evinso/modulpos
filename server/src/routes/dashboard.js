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
    const orders = await prisma.order.findMany({
      where: { storeId: store.id, status: { not: 'cancelled' } },
      select: { totalAmount: true }
    });
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);

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

module.exports = router;
