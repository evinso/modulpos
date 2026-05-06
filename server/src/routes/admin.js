const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');

/**
 * Middleware to check if user is admin
 */
const isAdmin = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
    }
    // Update req.user with latest data
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Yetki kontrolü sırasında hata oluştu' });
  }
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
        subscriptions: {
          orderBy: { createdAt: 'desc' }
        }
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

/**
 * POST /api/admin/users/:id/toggle-status
 * Toggle user active/passive status
 */
router.post('/users/:id/toggle-status', auth, isAdmin, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive }
    });
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user
 */
router.delete('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    await prisma.user.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Kullanıcı başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
/**
 * GET /api/admin/stores
 * List all stores with counts
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
 * POST /api/admin/users/:id/subscription
 * Extend or update user subscription
 */
router.post('/users/:id/subscription', auth, isAdmin, async (req, res) => {
  try {
    const { days, plan, endDate } = req.body;
    const user = await prisma.user.findUnique({ 
      where: { id: req.params.id },
      include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } }
    });

    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    let newEndDate;
    if (endDate) {
      // Direkt tarih girilmişse onu kullan
      newEndDate = new Date(endDate);
    } else {
      // Gün girilmişse mevcut tarihe veya bugüne ekle
      let currentEndDate = new Date();
      if (user.subscriptions.length > 0 && user.subscriptions[0].endDate > new Date()) {
        currentEndDate = new Date(user.subscriptions[0].endDate);
      }
      newEndDate = new Date(currentEndDate.getTime() + (days || 30) * 24 * 60 * 60 * 1000);
    }

    const subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: plan || (user.subscriptions[0]?.plan || 'basic'),
        status: 'active',
        endDate: newEndDate
      }
    });

    // Eğer tarih ilerideyse, kullanıcıyı aktif et
    if (newEndDate > new Date() && !user.isActive) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isActive: true }
      });
    }

    res.json(subscription);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/users/:id/quotas
 * Update user quotas (maxProducts, maxXmlSources)
 */
router.put('/users/:id/quotas', auth, isAdmin, async (req, res) => {
  try {
    const { maxProducts, maxXmlSources } = req.body;
    
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        maxProducts: parseInt(maxProducts),
        maxXmlSources: parseInt(maxXmlSources)
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE_QUOTA',
        details: JSON.stringify({ targetUserId: req.params.id, maxProducts, maxXmlSources }),
        level: 'INFO'
      }
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/audit-logs
 * Get all system audit logs
 */
router.get('/audit-logs', auth, isAdmin, async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { name: true, email: true } }
      }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
