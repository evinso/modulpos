const prisma = require('../config/database');
const TrendyolService = require('./trendyol/trendyolService');
const notificationService = require('./notificationService');
const whatsappService = require('./whatsappService');

function mapTrendyolStatus(status) {
  const map = {
    Created: 'new', Picking: 'processing', Invoiced: 'processing',
    Shipped: 'shipped', Delivered: 'delivered', Cancelled: 'cancelled',
    Returned: 'returned', UnDelivered: 'returned', Repack: 'processing',
  };
  return map[status] || 'new';
}

async function syncOrdersForStore(store, connections) {
  let totalSynced = 0;

  for (const conn of connections) {
    if (conn.marketplaceType === 'trendyol') {
      try {
        const service = new TrendyolService(conn);
        const data = await service.getOrders({ size: 50 });
        const packages = data.content || [];

        for (const pkg of packages) {
          const existing = await prisma.order.findFirst({
            where: { marketplaceOrderId: String(pkg.orderNumber), storeId: store.id }
          });
          if (existing) continue;

          const customerName = pkg.customerFirstName
            ? `${pkg.customerFirstName} ${pkg.customerLastName || ''}`.trim()
            : `${pkg.shipmentAddress?.firstName || ''} ${pkg.shipmentAddress?.lastName || ''}`.trim();
          const totalAmount = pkg.packageTotalPrice || 0;
          const status = mapTrendyolStatus(pkg.shipmentPackageStatus || pkg.status);

          await prisma.order.create({
            data: {
              storeId: store.id,
              connectionId: conn.id,
              marketplaceOrderId: String(pkg.orderNumber),
              orderNumber: `TY-${pkg.orderNumber}`,
              status,
              totalAmount,
              customerName,
              shippingAddress: JSON.stringify(pkg.shipmentAddress),
              items: JSON.stringify(pkg.lines),
              cargoCompany: pkg.cargoProviderName,
              trackingNumber: pkg.cargoTrackingNumber ? String(pkg.cargoTrackingNumber) : null,
              orderDate: new Date(pkg.orderDate),
            },
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
                price: l.lineUnitPrice || l.lineGrossAmount || 0,
              })),
            },
          });

          whatsappService.notifyNewOrder(store.name, `TY-${pkg.orderNumber}`, totalAmount, customerName).catch(() => {});
          totalSynced++;
        }
      } catch (err) {
        console.error(`[OrderSync] Trendyol conn ${conn.id} hatası:`, err.message);
      }
    }
  }

  return totalSynced;
}

// Syncs all stores with active connections — called by cron
async function syncAllOrders() {
  const stores = await prisma.store.findMany({ select: { id: true, name: true } });
  let grand = 0;

  for (const store of stores) {
    const connections = await prisma.marketplaceConnection.findMany({
      where: { storeId: store.id, status: 'active' },
    });
    if (connections.length === 0) continue;

    const count = await syncOrdersForStore(store, connections);
    if (count > 0) {
      console.log(`[OrderSync] ${store.name}: ${count} yeni sipariş`);
      grand += count;
    }
  }

  return grand;
}

module.exports = { syncOrdersForStore, syncAllOrders };
