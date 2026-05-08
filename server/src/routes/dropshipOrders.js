const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');

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
 * POST /dropship-orders
 * Create a new dropship order
 */
router.post('/', auth, async (req, res, next) => {
  try {
    const {
      orderRef, productName, productCode, supplierName,
      quantity, unitPrice, customerName, customerPhone,
      shippingAddress, notes
    } = req.body;

    if (!productName) return res.status(400).json({ error: 'Ürün adı zorunludur' });

    const store = await prisma.store.findFirst({ where: { userId: req.user.id } });
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const order = await prisma.dropshipOrder.create({
      data: {
        userId: req.user.id,
        storeId: store.id,
        orderRef: orderRef || null,
        productName,
        productCode: productCode || null,
        supplierName: supplierName || null,
        quantity: parseInt(quantity) || 1,
        unitPrice: parseFloat(unitPrice) || 0,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        shippingAddress: shippingAddress || null,
        notes: notes || null,
        status: 'pending'
      }
    });

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /dropship-orders/:id
 * Update dropship order (status, tracking info, notes)
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
      notes, productName, productCode, supplierName, quantity,
      unitPrice, customerName, customerPhone, shippingAddress, orderRef
    } = req.body;

    const updateData = {};
    if (productName !== undefined) updateData.productName = productName;
    if (productCode !== undefined) updateData.productCode = productCode;
    if (supplierName !== undefined) updateData.supplierName = supplierName;
    if (quantity !== undefined) updateData.quantity = parseInt(quantity);
    if (unitPrice !== undefined) updateData.unitPrice = parseFloat(unitPrice);
    if (customerName !== undefined) updateData.customerName = customerName;
    if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
    if (shippingAddress !== undefined) updateData.shippingAddress = shippingAddress;
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
