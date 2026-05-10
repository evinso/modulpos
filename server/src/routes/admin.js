const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

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

/**
 * GET /api/admin/pricing-plans
 */
router.get('/pricing-plans', auth, isAdmin, async (req, res) => {
  try {
    const plans = await prisma.landingPricingPlan.findMany({
      orderBy: { order: 'asc' }
    });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/pricing-plans
 */
router.post('/pricing-plans', auth, isAdmin, async (req, res) => {
  try {
    const { name, price, period, features, ctaText, isHighlighted, order, isActive } = req.body;
    const plan = await prisma.landingPricingPlan.create({
      data: {
        name,
        price,
        period,
        features: Array.isArray(features) ? JSON.stringify(features) : features,
        ctaText,
        isHighlighted,
        order: parseInt(order) || 0,
        isActive: isActive !== undefined ? isActive : true
      }
    });
    res.status(201).json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/pricing-plans/:id
 */
router.put('/pricing-plans/:id', auth, isAdmin, async (req, res) => {
  try {
    const { name, price, period, features, ctaText, isHighlighted, order, isActive } = req.body;
    const plan = await prisma.landingPricingPlan.update({
      where: { id: req.params.id },
      data: {
        name,
        price,
        period,
        features: Array.isArray(features) ? JSON.stringify(features) : features,
        ctaText,
        isHighlighted,
        order: parseInt(order) || 0,
        isActive
      }
    });
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/pricing-plans/:id
 */
router.delete('/pricing-plans/:id', auth, isAdmin, async (req, res) => {
  try {
    await prisma.landingPricingPlan.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Plan silindi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/footer-sections
 */
router.get('/footer-sections', auth, isAdmin, async (req, res) => {
  try {
    const sections = await prisma.landingFooterSection.findMany({
      orderBy: { order: 'asc' }
    });
    res.json(sections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/footer-sections
 */
router.post('/footer-sections', auth, isAdmin, async (req, res) => {
  try {
    const { title, links, order, isActive } = req.body;
    const section = await prisma.landingFooterSection.create({
      data: {
        title,
        links: Array.isArray(links) ? JSON.stringify(links) : links,
        order: parseInt(order) || 0,
        isActive: isActive !== undefined ? isActive : true
      }
    });
    res.status(201).json(section);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/footer-sections/:id
 */
router.put('/footer-sections/:id', auth, isAdmin, async (req, res) => {
  try {
    const { title, links, order, isActive } = req.body;
    const section = await prisma.landingFooterSection.update({
      where: { id: req.params.id },
      data: {
        title,
        links: Array.isArray(links) ? JSON.stringify(links) : links,
        order: parseInt(order) || 0,
        isActive
      }
    });
    res.json(section);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/footer-sections/:id
 */
router.delete('/footer-sections/:id', auth, isAdmin, async (req, res) => {
  try {
    await prisma.landingFooterSection.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Bölüm silindi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/footer-sections/seed-defaults
 * Creates default footer sections if none exist
 */
router.post('/footer-sections/seed-defaults', auth, isAdmin, async (req, res) => {
  try {
    const existing = await prisma.landingFooterSection.count();
    if (existing > 0) {
      return res.status(400).json({ error: 'Footer bölümleri zaten mevcut. Önce mevcut bölümleri silin.' });
    }

    const defaults = [
      {
        title: 'Ürün',
        order: 0,
        isActive: true,
        links: JSON.stringify([
          { label: 'Özellikler', url: '#features', isExternal: false },
          { label: 'Fiyatlandırma', url: '#pricing', isExternal: false },
          { label: 'Nasıl Çalışır?', url: '#how', isExternal: false },
          { label: 'Ücretsiz Başla', url: '/register', isExternal: false }
        ])
      },
      {
        title: 'Yasal Sözleşmeler',
        order: 1,
        isActive: true,
        links: JSON.stringify([
          { label: 'Mesafeli Satış Sözleşmesi', url: '/policy/mesafeli-satis-sozlesmesi', isExternal: false },
          { label: 'İptal ve İade Koşulları', url: '/policy/iptal-ve-iade-kosullari', isExternal: false },
          { label: 'Gizlilik ve Güvenlik Politikası', url: '/policy/gizlilik-ve-guvenlik-politikasi', isExternal: false },
          { label: 'Teslimat Koşulları', url: '/policy/teslimat-kosullari', isExternal: false },
          { label: 'Kullanım Şartları', url: '/policy/kullanim-sartlari', isExternal: false }
        ])
      },
      {
        title: 'Kurumsal',
        order: 2,
        isActive: true,
        links: JSON.stringify([
          { label: 'Hakkımızda', url: '/policy/hakkimizda', isExternal: false },
          { label: 'İletişim', url: '/policy/iletisim', isExternal: false },
          { label: 'Kariyer', url: '#', isExternal: false },
          { label: 'Destek Merkezi', url: '#', isExternal: false }
        ])
      }
    ];

    await prisma.landingFooterSection.createMany({ data: defaults });
    const sections = await prisma.landingFooterSection.findMany({ orderBy: { order: 'asc' } });
    res.json({ message: '3 varsayılan footer bölümü oluşturuldu.', sections });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/system-settings
 */
router.get('/system-settings', auth, isAdmin, async (req, res) => {
  try {
    const { keys } = req.query;
    const keyList = keys ? keys.split(',') : [];
    
    const settings = await prisma.systemSettings.findMany({
      where: keyList.length > 0 ? { key: { in: keyList } } : {}
    });
    
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    
    res.json(settingsObj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/system-settings
 */
router.post('/system-settings', auth, isAdmin, async (req, res) => {
  try {
    const settings = req.body; // { key: value, key2: value2 }
    
    for (const [key, value] of Object.entries(settings)) {
      await prisma.systemSettings.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      });
    }
    
    res.json({ message: 'Ayarlar güncellendi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/invoices
 * List all invoices
 */
router.get('/invoices', auth, isAdmin, async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/invoices/:userId
 * Create invoice for a user
 */
router.post('/invoices/:userId', auth, isAdmin, async (req, res) => {
  try {
    const { title, amount, period, notes, fileUrl } = req.body;
    if (!title || !amount) {
      return res.status(400).json({ error: 'Başlık ve tutar zorunludur' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const invoice = await prisma.invoice.create({
      data: {
        userId: req.params.userId,
        title,
        amount: parseFloat(amount),
        period: period || null,
        notes: notes || null,
        fileUrl: fileUrl || null
      }
    });
    res.status(201).json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/dropship-orders
 * List all dropship orders across all users — includes user, store, product+xmlSource
 */
router.get('/dropship-orders', auth, isAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};
    const orders = await prisma.dropshipOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true, email: true } },
        store: { select: { name: true } },
        product: {
          select: {
            title: true,
            sku: true,
            xmlSource: { select: { name: true } }
          }
        }
      }
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/dropship-orders/:id
 * Update any field of a dropship order (status, tracking, cargo, notes, campaignCode)
 */
router.put('/dropship-orders/:id', auth, isAdmin, async (req, res) => {
  try {
    const { status, trackingNumber, cargoCompany, supplierOrderId, notes, campaignCode } = req.body;
    const existing = await prisma.dropshipOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    const updateData = {};
    if (campaignCode !== undefined) updateData.campaignCode = campaignCode;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
    if (cargoCompany !== undefined) updateData.cargoCompany = cargoCompany;
    if (supplierOrderId !== undefined) updateData.supplierOrderId = supplierOrderId;
    if (notes !== undefined) updateData.notes = notes;

    if (status && status !== existing.status) {
      updateData.status = status;
      if (status === 'ordered' && !existing.orderedAt) updateData.orderedAt = new Date();
      if (status === 'shipped' && !existing.shippedAt) updateData.shippedAt = new Date();
      if (status === 'delivered' && !existing.deliveredAt) updateData.deliveredAt = new Date();
    }

    const updated = await prisma.dropshipOrder.update({ where: { id: req.params.id }, data: updateData });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/invoices/:id
 * Delete an invoice
 */
router.delete('/invoices/:id', auth, isAdmin, async (req, res) => {
  try {
    await prisma.invoice.delete({ where: { id: req.params.id } });
    res.json({ message: 'Fatura silindi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/support-tickets
 * List all support tickets
 */
router.get('/support-tickets', auth, isAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;

    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } }
      }
    });

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/support-tickets/:id
 * Get a single ticket with all messages
 */
router.get('/support-tickets/:id', auth, isAdmin, async (req, res) => {
  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } }
      }
    });
    if (!ticket) return res.status(404).json({ error: 'Bilet bulunamadı' });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/support-tickets/:id
 * Update status / priority
 */
router.put('/support-tickets/:id', auth, isAdmin, async (req, res) => {
  try {
    const { status, priority } = req.body;
    const updateData = { updatedAt: new Date() };
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: updateData
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/support-tickets/:id/reply
 * Admin reply to a ticket
 */
router.post('/support-tickets/:id/reply', auth, isAdmin, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mesaj zorunludur' });

    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) return res.status(404).json({ error: 'Bilet bulunamadı' });

    const [msg] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          isAdmin: true,
          senderName: req.user.name || 'Destek Ekibi',
          message: message.trim()
        }
      }),
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: 'in_progress', updatedAt: new Date() }
      })
    ]);

    notificationService.createForUser(ticket.userId, { title: 'Destek Talebinize Yanıt Geldi', message: `"${ticket.subject}" konulu talebiniz yanıtlandı.`, type: 'success', link: '/support' });
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
