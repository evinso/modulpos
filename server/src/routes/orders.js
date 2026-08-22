const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { syncOrdersForStore } = require('../services/orderSyncService');

const router = express.Router();
router.use(auth);

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

router.get('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { page = 1, limit = 20, status } = req.query;
    const where = { storeId: store.id };
    if (status) where.status = status;
    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { orderDate: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit), include: { connection: { select: { marketplaceType: true } } } }),
      prisma.order.count({ where })
    ]);
    res.json({ orders, pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { connection: true } });
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    res.json(order);
  } catch (error) { next(error); }
});

// Sync orders from marketplace
router.post('/sync', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const connections = await prisma.marketplaceConnection.findMany({ where: { storeId: store.id, status: 'active' } });
    const totalSynced = await syncOrdersForStore(store, connections);
    res.json({ message: `${totalSynced} yeni sipariş senkronize edildi` });
  } catch (error) { next(error); }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const order = await prisma.order.update({ where: { id: req.params.id }, data: { status } });
    res.json(order);
  } catch (error) { next(error); }
});

module.exports = router;
