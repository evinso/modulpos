const express = require('express');
const crypto = require('crypto');
const prisma = require('../config/database');

const router = express.Router();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function basicAuthOk(header, user, pass) {
  if (!user || !pass) return false;
  return safeEqual(header || '', 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
}

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

    // Authentication is mandatory: either the x-api-key or the Basic Auth credentials
    // configured on the connection must match. Unauthenticated events are dropped.
    let authorized = false;
    if (connection?.config) {
      let cfg = {};
      try { cfg = JSON.parse(connection.config); } catch {}
      if (cfg.webhookApiKey && safeEqual(req.headers['x-api-key'], cfg.webhookApiKey)) authorized = true;
      if (!authorized && basicAuthOk(req.headers['authorization'], cfg.webhookUsername, cfg.webhookPassword)) authorized = true;
    }
    if (!authorized) {
      console.warn(`[webhook] Yetkisiz Trendyol webhook (sellerId=${sellerId || '-'})`);
      return res.status(200).json({ received: true }); // 200 so the sender does not retry
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

  const existing = await prisma.order.findFirst({ where: { marketplaceOrderId: String(orderNumber), storeId: connection.storeId } });

  if (!existing) {
    await prisma.order.create({
      data: {
        storeId: connection.storeId,
        connectionId: connection.id,
        orderNumber: `TY-${orderNumber}`,
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
      where: { id: existing.id },
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

// POST /api/webhooks/hepsiburada
// Single platform-wide endpoint — Hepsiburada sends all merchants' events here.
// Basic Auth credentials are stored in system settings (hb_webhook_username / hb_webhook_password).
router.post('/hepsiburada', async (req, res) => {
  try {
    const body = req.body;
    const merchantId = String(body.merchantId || body.MerchantId || '');

    // Validate platform-wide Basic Auth
    const [userSetting, passSetting] = await Promise.all([
      prisma.systemSettings.findUnique({ where: { key: 'hb_webhook_username' } }),
      prisma.systemSettings.findUnique({ where: { key: 'hb_webhook_password' } }),
    ]);
    const hbUser = userSetting?.value;
    const hbPass = passSetting?.value;
    if (!basicAuthOk(req.headers['authorization'], hbUser, hbPass)) {
      console.warn('[webhook/hepsiburada] Geçersiz veya yapılandırılmamış Basic Auth');
      return res.status(200).json({ received: true });
    }

    // Find matching connection by merchantId
    let connection = null;
    if (merchantId) {
      connection = await prisma.marketplaceConnection.findFirst({
        where: { sellerId: merchantId, marketplaceType: 'hepsiburada', status: 'active' },
        select: { id: true, storeId: true }
      });
    }

    const eventType = body.status || body.Status || body.eventType || 'UNKNOWN';

    await prisma.webhookEvent.create({
      data: {
        storeId: connection?.storeId || null,
        connectionId: connection?.id || null,
        sellerId: merchantId || null,
        eventType,
        payload: JSON.stringify(body),
        processed: false,
      }
    });

    if (connection) {
      processHepsiburadaEvent(eventType, body, connection).catch(() => {});
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] hepsiburada error:', err.message);
    res.status(200).json({ received: true });
  }
});

async function processHepsiburadaEvent(eventType, body, connection) {
  const orderNumber = String(body.orderNumber || body.OrderNumber || body.id || body.Id || '');
  if (!orderNumber) return;

  const customer = body.customer || body.Customer || {};
  const address = body.shippingAddress || body.ShippingAddress || {};
  const lines = body.orderLines || body.OrderLines || body.lines || [];

  const customerName = customer.firstName || customer.FirstName
    ? `${customer.firstName || customer.FirstName || ''} ${customer.lastName || customer.LastName || ''}`.trim()
    : null;

  const existing = await prisma.order.findFirst({ where: { marketplaceOrderId: orderNumber, storeId: connection.storeId } });

  if (!existing) {
    await prisma.order.create({
      data: {
        storeId: connection.storeId,
        connectionId: connection.id,
        orderNumber: `HB-${orderNumber}`,
        marketplaceOrderId: orderNumber,
        status: mapHepsiburadaStatus(eventType),
        totalAmount: body.totalPrice || body.TotalPrice || body.packageGrossAmount || 0,
        customerName,
        customerPhone: customer.phone || customer.Phone || address.phone || null,
        shippingAddress: Object.keys(address).length ? JSON.stringify(address) : null,
        items: lines.length ? JSON.stringify(lines) : null,
        cargoCompany: body.cargoCompany || body.CargoCompany || null,
        trackingNumber: body.cargoTrackingNumber || body.CargoTrackingNumber || null,
        orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
      }
    });
  } else {
    const newStatus = mapHepsiburadaStatus(eventType);
    const updateData = {
      cargoCompany: body.cargoCompany || body.CargoCompany || existing.cargoCompany,
      trackingNumber: body.cargoTrackingNumber || body.CargoTrackingNumber || existing.trackingNumber,
      updatedAt: new Date(),
    };
    if (newStatus !== null) updateData.status = newStatus;
    await prisma.order.update({ where: { id: existing.id }, data: updateData });
  }

  await prisma.webhookEvent.updateMany({
    where: { connectionId: connection.id, processed: false },
    data: { processed: true }
  });
}

function mapHepsiburadaStatus(status) {
  const map = {
    // Actual Hepsiburada webhook event types
    CreateOrder: 'new',
    CreatePackage: 'processing',
    Intransit: 'shipped',
    Unpack: 'processing',
    Deliver: 'delivered',
    Undeliver: 'returned',
    Cancel: 'cancelled',
    ClaimsPackages: 'returned',
    ClaimsAwaitingAction: 'returned',
    ClaimsAccept: 'returned',
    ClaimsReject: 'processing',
    ChangeShippingAddress: null, // adres değişikliği — statü değiştirme
    // Legacy / fallback variants
    Created: 'new',
    WaitingforSupplierApproval: 'new',
    Approved: 'processing',
    Picking: 'processing',
    Shipped: 'shipped',
    Delivered: 'delivered',
    Cancelled: 'cancelled',
    UnDelivered: 'returned',
    Returned: 'returned',
  };
  return map[status] ?? 'new';
}

module.exports = router;
