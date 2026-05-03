const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');

/**
 * Middleware to check if user is admin
 */
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  }
  next();
};

/**
 * GET /api/admin/stats
 * Get global system stats
 */
router.get('/stats', auth, isAdmin, async (req, res) => {
  try {
    const [userCount, storeCount, productCount, orderCount, activeSubscriptions] = await Promise.all([
      prisma.user.count(),
      prisma.store.count(),
      prisma.product.count(),
      prisma.order.count(),
      prisma.subscription.count({ where: { status: 'active' } })
    ]);

    res.json({
      users: userCount,
      stores: storeCount,
      products: productCount,
      orders: orderCount,
      subscriptions: activeSubscriptions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/users
 * List all users with their stores
 */
router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        stores: {
          include: {
            _count: {
              select: { products: true, orders: true, xmlSources: true }
            }
          }
        },
        subscriptions: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/stores
 * List all stores
 */
router.get('/stores', auth, isAdmin, async (req, res) => {
  try {
    const stores = await prisma.store.findMany({
      include: {
        user: { select: { name: true, email: true } },
        _count: { select: { products: true, orders: true, xmlSources: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(stores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/users/:id/role
 * Change user role
 */
router.post('/users/:id/role', auth, isAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['owner', 'admin', 'operator'].includes(role)) {
      return res.status(400).json({ error: 'Geçersiz rol' });
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
