const express = require('express');
const prisma = require('../config/database');

const router = express.Router();

// POST /api/webhooks/trendyol
// Public endpoint — Trendyol calls this directly (no JWT auth)
router.post('/trendyol', async (req, res) => {
  try {
    const body = req.body;

    // Trendyol sends supplierId (=sellerId) in the payload
    const sellerId = String(body.supplierId || body.sellerId || '');
    const eventType = body.type || body.eventType || 'UNKNOWN';

    // Find matching connection by sellerId
    let connection = null;
    if (sellerId) {
      connection = await prisma.marketplaceConnection.findFirst({
        where: { sellerId, marketplaceType: 'trendyol', status: 'active' },
        select: { id: true, storeId: true }
      });
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

    // Immediately try to process known event types
    if (connection) {
      await processEvent(eventType, body, connection).catch(err => {
        prisma.webhookEvent.updateMany({
          where: { connectionId: connection.id, eventType, processed: false },
          data: { error: String(err.message).slice(0, 500) }
        }).catch(() => {});
      });
    }

    // Always respond 200 quickly so Trendyol doesn't retry
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] trendyol error:', err.message);
    res.status(200).json({ received: true }); // still 200 to prevent retries
  }
});

async function processEvent(eventType, body, connection) {
  if (eventType === 'ORDER_CREATED' || eventType === 'ORDER_STATUS_CHANGED') {
    const orderData = body.data || body;
    const orderNumber = orderData.orderNumber || orderData.id;
    if (!orderNumber) return;

    const existing = await prisma.order.findUnique({ where: { orderNumber: String(orderNumber) } });
    if (!existing) {
      await prisma.order.create({
        data: {
          storeId: connection.storeId,
          connectionId: connection.id,
          orderNumber: String(orderNumber),
          marketplaceOrderId: String(orderNumber),
          status: mapOrderStatus(orderData.status),
          totalAmount: orderData.totalPrice || orderData.totalAmount || 0,
          customerName: orderData.shipmentAddress?.fullName || null,
          customerPhone: orderData.shipmentAddress?.phoneNumber || null,
          shippingAddress: orderData.shipmentAddress ? JSON.stringify(orderData.shipmentAddress) : null,
          items: orderData.lines ? JSON.stringify(orderData.lines) : null,
          orderDate: orderData.orderDate ? new Date(orderData.orderDate) : new Date(),
        }
      });
    } else if (orderData.status) {
      await prisma.order.update({
        where: { orderNumber: String(orderNumber) },
        data: { status: mapOrderStatus(orderData.status), updatedAt: new Date() }
      });
    }

    // Mark processed
    await prisma.webhookEvent.updateMany({
      where: { connectionId: connection.id, eventType, processed: false },
      data: { processed: true }
    });
  }
}

function mapOrderStatus(trendyolStatus) {
  const map = {
    'Created': 'new',
    'Picking': 'processing',
    'Invoiced': 'processing',
    'Shipped': 'shipped',
    'Delivered': 'delivered',
    'Cancelled': 'cancelled',
    'UnDelivered': 'returned',
    'Returned': 'returned',
  };
  return map[trendyolStatus] || 'new';
}

module.exports = router;
