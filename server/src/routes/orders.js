const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const TrendyolService = require('../services/trendyol/trendyolService');
const notificationService = require('../services/notificationService');
const whatsappService = require('../services/whatsappService');

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
    let totalSynced = 0;
    for (const conn of connections) {
      if (conn.marketplaceType === 'trendyol') {
        const service = new TrendyolService(conn);
        const data = await service.getOrders({ size: 50 });
        const packages = data.content || [];
        for (const pkg of packages) {
          const existing = await prisma.order.findFirst({ where: { marketplaceOrderId: String(pkg.orderNumber), storeId: store.id } });
          if (!existing) {
            const customerName = pkg.customerFirstName
              ? `${pkg.customerFirstName} ${pkg.customerLastName || ''}`.trim()
              : `${pkg.shipmentAddress?.firstName || ''} ${pkg.shipmentAddress?.lastName || ''}`.trim();
            const totalAmount = pkg.packageTotalPrice || 0;
            const status = mapTrendyolStatus(pkg.shipmentPackageStatus || pkg.status);

            await prisma.order.create({
              data: {
                storeId: store.id, connectionId: conn.id, marketplaceOrderId: String(pkg.orderNumber),
                orderNumber: `TY-${pkg.orderNumber}`, status,
                totalAmount, customerName,
                shippingAddress: JSON.stringify(pkg.shipmentAddress), items: JSON.stringify(pkg.lines),
                cargoCompany: pkg.cargoProviderName,
                trackingNumber: pkg.cargoTrackingNumber ? String(pkg.cargoTrackingNumber) : null,
                orderDate: new Date(pkg.orderDate)
              }
            });

            await notificationService.create({
              storeId: store.id,
              title: 'Yeni Sipariş',
              message: `${pkg.orderNumber} nolu sipariş alındı. Tutar: ${totalAmount.toFixed(2)}₺`,
              type: 'info',
              link: '/orders',
              data: {
                notifType: 'new_order',
                orderNumber: `TY-${pkg.orderNumber}`,
                totalAmount,
                customerName,
                status,
                items: (pkg.lines || []).slice(0, 20).map(l => ({
                  name: l.productName || l.productColor || '',
                  quantity: l.quantity,
                  price: l.lineUnitPrice || l.lineGrossAmount || 0
                }))
              }
            });

            whatsappService.notifyNewOrder(store.name, `TY-${pkg.orderNumber}`, totalAmount, customerName).catch(() => {});
            totalSynced++;
          }
        }
      }
    }
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

function mapTrendyolStatus(status) {
  const map = {
    'Created': 'new',
    'Picking': 'processing',
    'Invoiced': 'processing',
    'Shipped': 'shipped',
    'Delivered': 'delivered',
    'Cancelled': 'cancelled',
    'Returned': 'returned',
    'UnDelivered': 'returned',
    'Repack': 'processing',
  };
  return map[status] || 'new';
}

module.exports = router;
