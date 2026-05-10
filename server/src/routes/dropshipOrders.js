const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { deductCredits, getOrCreateBalance } = require('./credits');
const notificationService = require('../services/notificationService');

const router = express.Router();

/**
 * GET /dropship-orders
 * List current user's dropship orders
 */
router.get('/', auth, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const store = await prisma.store.findFirst({ where: { userId: req.user.id } });
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const where = { storeId: store.id };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.dropshipOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.dropshipOrder.count({ where })
    ]);

    res.json({ orders, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /dropship-orders/place
 * Place a dropship order: find product, deduct xmlPrice from credits, create order
 */
router.post('/place', auth, async (req, res, next) => {
  try {
    const { productId, campaignCode, quantity, customerName, customerPhone, shippingAddress, notes } = req.body;

    if (!productId) return res.status(400).json({ error: 'Ürün seçimi zorunludur' });
    if (!campaignCode || !campaignCode.trim()) return res.status(400).json({ error: 'Kampanya / kargo kodu zorunludur' });

    const store = await prisma.store.findFirst({ where: { userId: req.user.id } });
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const product = await prisma.product.findFirst({
      where: { id: productId, storeId: store.id },
      include: {
        xmlSource: {
          select: { name: true, globalProvider: { select: { orderFee: true } } }
        }
      }
    });
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    const qty = Math.max(1, parseInt(quantity) || 1);
    const unitCost = product.xmlPrice > 0 ? product.xmlPrice : product.price;
    const orderFee = parseFloat(product.xmlSource?.globalProvider?.orderFee) || 0;
    const totalCost = parseFloat((unitCost * qty + orderFee).toFixed(2));

    if (totalCost <= 0) return res.status(400).json({ error: 'Ürün XML fiyatı geçersiz veya sıfır' });

    // Check balance first (before deducting)
    const balance = await getOrCreateBalance(req.user.id);
    if (balance.balance < totalCost) {
      return res.status(402).json({
        error: `Yetersiz kredi. Gerekli: ₺${totalCost}, Mevcut: ₺${balance.balance.toFixed(2)}`
      });
    }

    const feeNote = orderFee > 0 ? ` + ₺${orderFee.toFixed(2)} sipariş ücreti` : '';
    // Deduct credits
    await deductCredits(
      req.user.id,
      totalCost,
      'dropship_order',
      `Tedarikçi Siparişi: ${product.title.substring(0, 60)} (${campaignCode.trim()})${feeNote}`,
      productId
    );

    // Create dropship order
    const order = await prisma.dropshipOrder.create({
      data: {
        userId: req.user.id,
        storeId: store.id,
        productId,
        campaignCode: campaignCode.trim(),
        productName: product.title,
        productCode: product.sku || product.barcode || null,
        supplierName: product.xmlSource?.name || null,
        quantity: qty,
        unitPrice: unitCost,
        creditAmount: totalCost,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        shippingAddress: shippingAddress || null,
        notes: notes || null,
        status: 'ordered',
        orderedAt: new Date()
      }
    });

    notificationService.create({ storeId: store.id, title: 'Dropship Sipariş Oluşturuldu', message: `${product.title.substring(0, 60)} — ₺${totalCost.toFixed(2)} kredi düşüldü.`, type: 'success', link: '/dropship-orders' });
    res.status(201).json({ order, deducted: totalCost });
  } catch (error) {
    if (error.statusCode === 402) return res.status(402).json({ error: error.message });
    next(error);
  }
});

/**
 * PUT /dropship-orders/:id
 * Update dropship order (status, tracking info, notes, campaign code)
 */
router.put('/:id', auth, async (req, res, next) => {
  try {
    const store = await prisma.store.findFirst({ where: { userId: req.user.id } });
    const existing = await prisma.dropshipOrder.findFirst({
      where: { id: req.params.id, storeId: store?.id }
    });
    if (!existing) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    const {
      status, supplierOrderId, trackingNumber, cargoCompany,
      notes, campaignCode, orderRef
    } = req.body;

    const updateData = {};
    if (campaignCode !== undefined) updateData.campaignCode = campaignCode;
    if (orderRef !== undefined) updateData.orderRef = orderRef;
    if (supplierOrderId !== undefined) updateData.supplierOrderId = supplierOrderId;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
    if (cargoCompany !== undefined) updateData.cargoCompany = cargoCompany;
    if (notes !== undefined) updateData.notes = notes;

    if (status && status !== existing.status) {
      updateData.status = status;
      if (status === 'ordered' && !existing.orderedAt) updateData.orderedAt = new Date();
      if (status === 'shipped' && !existing.shippedAt) updateData.shippedAt = new Date();
      if (status === 'delivered' && !existing.deliveredAt) updateData.deliveredAt = new Date();
    }

    const updated = await prisma.dropshipOrder.update({
      where: { id: req.params.id },
      data: updateData
    });

    if (status && status !== existing.status) {
      const statusLabels = { ordered: 'Sipariş Verildi', shipped: 'Kargoya Verildi', delivered: 'Teslim Edildi', cancelled: 'İptal Edildi' };
      notificationService.create({ storeId: store.id, title: 'Sipariş Durumu Güncellendi', message: `${existing.productName?.substring(0, 50)} → ${statusLabels[status] || status}`, type: status === 'cancelled' ? 'error' : 'info', link: '/dropship-orders' });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /dropship-orders/:id
 */
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const store = await prisma.store.findFirst({ where: { userId: req.user.id } });
    const existing = await prisma.dropshipOrder.findFirst({
      where: { id: req.params.id, storeId: store?.id }
    });
    if (!existing) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    await prisma.dropshipOrder.delete({ where: { id: req.params.id } });
    res.json({ message: 'Sipariş silindi' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
