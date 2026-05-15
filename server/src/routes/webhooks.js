const express = require('express');
const prisma = require('../config/database');

const router = express.Router();

// POST /api/webhooks/trendyol
// Public endpoint — Trendyol calls this directly (no JWT auth)
router.post('/trendyol', async (req, res) => {
  try {
    const body = req.body;
    const sellerId = String(body.supplierId || body.sellerId || '');
    const eventType = body.shipmentPackageStatus || body.type || body.eventType || 'UNKNOWN';

    // Find matching connection by sellerId
    let connection = null;
    if (sellerId) {
      connection = await prisma.marketplaceConnection.findFirst({
        where: { sellerId, marketplaceType: 'trendyol', status: 'active' },
        select: { id: true, storeId: true, config: true }
      });
    }

    // Verify x-api-key if this connection has one configured
    if (connection?.config) {
      const cfg = JSON.parse(connection.config);
      if (cfg.webhookApiKey) {
        const sentKey = req.headers['x-api-key'];
        if (sentKey !== cfg.webhookApiKey) {
          console.warn(`[webhook] Invalid API key for sellerId=${sellerId}`);
          return res.status(200).json({ received: true }); // 200 to prevent Trendyol retries
        }
      }
    }

    await prisma.webhookEvent.create({
      data: {
        storeId: connection?.storeId || null,
        connectionId: connection?.id || null,
        sellerId: sellerId || null,
        eventType,
        payload: JSON.stringify(body),
        processed: false,
      }
    });

    if (connection) {
      processEvent(eventType, body, connection).catch(() => {});
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] trendyol error:', err.message);
    res.status(200).json({ received: true });
  }
});

async function processEvent(eventType, body, connection) {
  const orderNumber = body.orderNumber || body.id;
  if (!orderNumber) return;

  const existing = await prisma.order.findUnique({ where: { orderNumber: String(orderNumber) } });

  if (!existing) {
    await prisma.order.create({
      data: {
        storeId: connection.storeId,
        connectionId: connection.id,
        orderNumber: String(orderNumber),
        marketplaceOrderId: String(orderNumber),
        status: mapOrderStatus(eventType),
        totalAmount: body.packageGrossAmount || 0,
        customerName: body.shipmentAddress?.firstName
          ? `${body.shipmentAddress.firstName} ${body.shipmentAddress.lastName || ''}`.trim()
          : null,
        customerPhone: body.shipmentAddress?.phone || null,
        shippingAddress: body.shipmentAddress ? JSON.stringify(body.shipmentAddress) : null,
        items: body.lines ? JSON.stringify(body.lines) : null,
        cargoCompany: body.cargoProviderName || null,
        trackingNumber: body.cargoTrackingNumber || null,
        orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
      }
    });
  } else {
    await prisma.order.update({
      where: { orderNumber: String(orderNumber) },
      data: {
        status: mapOrderStatus(eventType),
        cargoCompany: body.cargoProviderName || existing.cargoCompany,
        trackingNumber: body.cargoTrackingNumber || existing.trackingNumber,
        updatedAt: new Date(),
      }
    });
  }

  await prisma.webhookEvent.updateMany({
    where: { connectionId: connection.id, processed: false },
    data: { processed: true }
  });
}

function mapOrderStatus(status) {
  const map = {
    CREATED: 'new',
    PICKING: 'processing',
    INVOICED: 'processing',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    UNDELIVERED: 'returned',
    RETURNED: 'returned',
    UNSUPPLIED: 'cancelled',
    AWAITING: 'processing',
    UNPACKED: 'processing',
    AT_COLLECTION_POINT: 'shipped',
    VERIFIED: 'delivered',
  };
  return map[status] || 'new';
}

module.exports = router;
