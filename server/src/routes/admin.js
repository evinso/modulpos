const express = require('express');
const router = express.Router();
const os = require('os');
const { exec } = require('child_process');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const whatsappService = require('../services/whatsappService');

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

    whatsappService.notifySubscriptionUpdated(user, subscription.plan, newEndDate).catch(() => {});

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
 * PUT /api/admin/users/:id/assign-plan
 * Assign a pricing plan to a user: creates subscription + applies plan quotas in one call
 */
router.put('/users/:id/assign-plan', auth, isAdmin, async (req, res) => {
  try {
    const { planId, endDate, maxProducts, maxXmlSources } = req.body;

    // Resolve plan limits (from LandingPricingPlan or manual override)
    let resolvedMaxProducts = maxProducts != null ? parseInt(maxProducts) : null;
    let resolvedMaxXmlSources = maxXmlSources != null ? parseInt(maxXmlSources) : null;
    let planName = null;

    if (planId) {
      const plan = await prisma.landingPricingPlan.findUnique({ where: { id: planId }, select: { name: true, maxProducts: true, maxXmlSources: true } });
      if (plan) {
        planName = plan.name;
        if (resolvedMaxProducts == null) resolvedMaxProducts = plan.maxProducts;
        if (resolvedMaxXmlSources == null) resolvedMaxXmlSources = plan.maxXmlSources;
      }
    }

    const newEndDate = endDate ? new Date(endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create subscription record
    await prisma.subscription.create({
      data: {
        userId: req.params.id,
        plan: planName || 'custom',
        status: 'active',
        endDate: newEndDate
      }
    });

    // Update user quotas + activate if end date is in the future
    const updateData = { isActive: newEndDate > new Date() };
    if (resolvedMaxProducts != null) updateData.maxProducts = resolvedMaxProducts;
    if (resolvedMaxXmlSources != null) updateData.maxXmlSources = resolvedMaxXmlSources;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } }
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ASSIGN_PLAN',
        details: JSON.stringify({ targetUserId: req.params.id, planId, planName, maxProducts: resolvedMaxProducts, maxXmlSources: resolvedMaxXmlSources, endDate: newEndDate }),
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
    const plans = await prisma.landingPricingPlan.findMany({ orderBy: { order: 'asc' } });
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
    const { name, price, yearlyPrice, period, features, ctaText, isHighlighted, order, isActive, maxProducts, maxXmlSources } = req.body;
    const plan = await prisma.landingPricingPlan.create({
      data: {
        name,
        price,
        yearlyPrice: yearlyPrice || null,
        period,
        features: Array.isArray(features) ? JSON.stringify(features) : features,
        ctaText,
        isHighlighted,
        order: parseInt(order) || 0,
        isActive: isActive !== undefined ? isActive : true,
        maxProducts: parseInt(maxProducts) || 1000,
        maxXmlSources: parseInt(maxXmlSources) || 1
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
    const { name, price, yearlyPrice, period, features, ctaText, isHighlighted, order, isActive, maxProducts, maxXmlSources } = req.body;
    const plan = await prisma.landingPricingPlan.update({
      where: { id: req.params.id },
      data: {
        name,
        price,
        yearlyPrice: yearlyPrice || null,
        period,
        features: Array.isArray(features) ? JSON.stringify(features) : features,
        ctaText,
        isHighlighted,
        order: parseInt(order) || 0,
        isActive,
        maxProducts: parseInt(maxProducts) || 1000,
        maxXmlSources: parseInt(maxXmlSources) || 1
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
 * POST /api/admin/pricing-plans/seed-defaults
 */
router.post('/pricing-plans/seed-defaults', auth, isAdmin, async (req, res) => {
  try {
    const existing = await prisma.landingPricingPlan.count();
    if (existing > 0) return res.status(400).json({ error: 'Planlar zaten mevcut. Önce mevcut planları silin.' });

    const defaults = [
      {
        name: 'Başlangıç', price: '—', period: '/ ay', order: 0, isHighlighted: false, isActive: true, ctaText: 'Hemen Başla',
        maxProducts: 1000, maxXmlSources: 1,
        features: JSON.stringify(['1.000 Ürün Limiti', '1 XML Kaynağı', 'Trendyol Entegrasyonu', 'Temel Destek'])
      },
      {
        name: 'Profesyonel', price: '—', period: '/ ay', order: 1, isHighlighted: true, isActive: true, ctaText: 'Hemen Başla',
        maxProducts: 10000, maxXmlSources: 5,
        features: JSON.stringify(['10.000 Ürün Limiti', '5 XML Kaynağı', 'Trendyol Entegrasyonu', 'Diğer Pazaryerleri (Yakında)', 'Dropship Desteği', 'Öncelikli Destek'])
      },
      {
        name: 'Kurumsal', price: '—', period: '/ ay', order: 2, isHighlighted: false, isActive: true, ctaText: 'Hemen Başla',
        maxProducts: 999999, maxXmlSources: 999,
        features: JSON.stringify(['Sınırsız Ürün', 'Sınırsız XML Kaynağı', 'Trendyol Entegrasyonu', 'Diğer Pazaryerleri (Yakında)', 'Dropship Desteği', '7/24 Öncelikli Destek', 'Özel Entegrasyon'])
      }
    ];

    await prisma.landingPricingPlan.createMany({ data: defaults });

    res.json({ message: '3 varsayılan plan oluşturuldu. Fiyatları admin panelinden güncelleyin.' });
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

const POLICY_SLUGS = [
  'mesafeli-satis-sozlesmesi',
  'iptal-ve-iade-kosullari',
  'gizlilik-ve-guvenlik-politikasi',
  'teslimat-kosullari',
  'kullanim-sartlari',
  'hakkimizda',
  'iletisim'
];

/**
 * GET /api/admin/policy-pages
 * Returns all policy pages (from DB; empty content if not yet saved)
 */
router.get('/policy-pages', auth, isAdmin, async (req, res) => {
  try {
    const keys = POLICY_SLUGS.flatMap(s => [`policy_${s}_title`, `policy_${s}_content`]);
    const settings = await prisma.systemSettings.findMany({ where: { key: { in: keys } } });
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });

    const pages = POLICY_SLUGS.map(slug => ({
      slug,
      title: map[`policy_${slug}_title`] || '',
      content: map[`policy_${slug}_content`] || ''
    }));
    res.json(pages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/policy-pages/:slug
 */
router.put('/policy-pages/:slug', auth, isAdmin, async (req, res) => {
  try {
    const { slug } = req.params;
    if (!POLICY_SLUGS.includes(slug)) return res.status(400).json({ error: 'Geçersiz slug' });
    const { title, content } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Başlık zorunludur' });
    if (!content?.trim()) return res.status(400).json({ error: 'İçerik zorunludur' });

    await Promise.all([
      prisma.systemSettings.upsert({
        where: { key: `policy_${slug}_title` },
        update: { value: title.trim() },
        create: { key: `policy_${slug}_title`, value: title.trim() }
      }),
      prisma.systemSettings.upsert({
        where: { key: `policy_${slug}_content` },
        update: { value: content.trim() },
        create: { key: `policy_${slug}_content`, value: content.trim() }
      })
    ]);
    res.json({ slug, title: title.trim() });
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
    
    // Invalidate WhatsApp settings cache if WhatsApp keys were changed
    const whatsappKeys = ['whatsapp_enabled', 'whatsapp_instance_id', 'whatsapp_api_token', 'whatsapp_phone', 'whatsapp_events'];
    if (Object.keys(settings).some(k => whatsappKeys.includes(k))) {
      whatsappService.invalidateCache();
    }

    res.json({ message: 'Ayarlar güncellendi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/whatsapp-test
 */
router.post('/whatsapp-test', auth, isAdmin, async (_req, res) => {
  try {
    await whatsappService.sendWhatsApp('✅ *ModulPOS Test Mesajı*\n\nWhatsApp bildirimleri başarıyla çalışıyor!');
    res.json({ message: 'Test mesajı gönderildi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/server-stats
 */
router.get('/server-stats', auth, isAdmin, async (_req, res) => {
  try {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // Disk usage via df
    const diskInfo = await new Promise((resolve) => {
      exec("df -k / | tail -1 | awk '{print $2,$3,$4}'", (err, stdout) => {
        if (err) return resolve(null);
        const [total, used, free] = stdout.trim().split(' ').map(Number);
        resolve({ total: total * 1024, used: used * 1024, free: free * 1024 });
      });
    });

    // DB stats
    const [dbSizeRes, tableSizes, connectionsRes] = await Promise.all([
      prisma.$queryRaw`SELECT pg_database_size(current_database()) as bytes`,
      prisma.$queryRaw`
        SELECT tablename,
          pg_total_relation_size(schemaname||'.'||tablename) as bytes,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables WHERE schemaname = 'public'
        ORDER BY bytes DESC LIMIT 12`,
      prisma.$queryRaw`SELECT count(*)::int as count FROM pg_stat_activity WHERE datname = current_database()`,
    ]);

    // App stats
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [userCount, activeUserCount, storeCount, productCount, mpProductCount, orderCount, auditToday, xmlCount] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.store.count(),
      prisma.product.count(),
      prisma.marketplaceProduct.count(),
      prisma.order.count(),
      prisma.auditLog.count({ where: { createdAt: { gte: today } } }),
      prisma.xmlSource.count(),
    ]);

    res.json({
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        loadAvg: os.loadavg(),
        cpuCount: cpus.length,
        cpuModel: cpus[0]?.model?.trim(),
        totalMem,
        freeMem,
        usedMem: totalMem - freeMem,
        disk: diskInfo,
      },
      process: {
        nodeVersion: process.version,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
      },
      database: {
        sizeBytes: Number(dbSizeRes[0]?.bytes || 0),
        tables: tableSizes.map(t => ({ name: t.tablename, size: t.size, bytes: Number(t.bytes) })),
        connections: connectionsRes[0]?.count || 0,
      },
      app: {
        users: userCount,
        activeUsers: activeUserCount,
        stores: storeCount,
        products: productCount,
        mpProducts: mpProductCount,
        orders: orderCount,
        xmlSources: xmlCount,
        auditToday,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/whatsapp-broadcast-recipients
 * Returns count of users with phone numbers
 */
router.get('/whatsapp-broadcast-recipients', auth, isAdmin, async (_req, res) => {
  try {
    const count = await prisma.user.count({ where: { phone: { not: null }, isActive: true } });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/whatsapp-broadcast
 * Send a WhatsApp message to all users with phone numbers
 */
router.post('/whatsapp-broadcast', auth, isAdmin, async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });

  const users = await prisma.user.findMany({
    where: { phone: { not: null }, isActive: true },
    select: { phone: true },
  });

  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await whatsappService.sendWhatsAppTo(user.phone, message);
      sent++;
    } catch {
      failed++;
    }
  }

  res.json({ total: users.length, sent, failed });
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

// GET /api/admin/users/:id/detail — full user profile for admin detail panel
router.get('/users/:id/detail', auth, isAdmin, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        stores: {
          include: {
            _count: {
              select: {
                products: true, orders: true, xmlSources: true,
                marketplaceConnections: true, customerQuestions: true,
              }
            },
            marketplaceConnections: { select: { id: true, marketplaceType: true, status: true, supplierName: true, sellerId: true } }
          }
        },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      }
    });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const storeIds = user.stores.map(s => s.id);

    const [creditBalance, recentTransactions, recentNotifications, auditLogs, recentSessions] = await Promise.all([
      prisma.creditBalance.findUnique({ where: { userId: user.id } }),
      prisma.creditTransaction.findMany({
        where: { balance: { userId: user.id } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, amount: true, description: true, createdAt: true }
      }),
      storeIds.length > 0
        ? prisma.notification.findMany({
            where: { storeId: { in: storeIds } },
            orderBy: { createdAt: 'desc' },
            take: 8,
            select: { id: true, title: true, message: true, type: true, isRead: true, createdAt: true }
          })
        : [],
      prisma.auditLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: { id: true, action: true, details: true, level: true, createdAt: true }
      }),
      prisma.userSession.findMany({
        where: { userId: user.id },
        orderBy: { loginAt: 'desc' },
        take: 10,
        select: { id: true, ip: true, userAgent: true, loginAt: true, lastSeenAt: true, isActive: true }
      }).catch(() => [])
    ]);

    const { passwordHash, ...safeUser } = user;
    res.json({ ...safeUser, creditBalance: creditBalance?.balance ?? 0, recentTransactions, recentNotifications, auditLogs, recentSessions });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// POST /api/admin/notify — send in-app notification to a user or all users
router.post('/notify', auth, isAdmin, async (req, res) => {
  try {
    const { userId, all, title, message, type = 'info', link } = req.body;
    if (!title?.trim() || !message?.trim()) return res.status(400).json({ error: 'Başlık ve mesaj zorunludur' });

    let stores = [];
    if (all) {
      stores = await prisma.store.findMany({ select: { id: true } });
    } else if (userId) {
      stores = await prisma.store.findMany({ where: { userId }, select: { id: true } });
      if (stores.length === 0) return res.status(404).json({ error: 'Kullanıcıya ait mağaza bulunamadı' });
    } else {
      return res.status(400).json({ error: 'userId veya all:true gereklidir' });
    }

    const notificationService = require('../services/notificationService');
    await Promise.all(stores.map(s => notificationService.create({ storeId: s.id, title, message, type, link: link || null })));

    res.json({ sent: stores.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

/**
 * POST /api/admin/rebuild-marketplace-products
 * One-time script: reconcile MarketplaceProduct DB state with Trendyol's actual product state.
 * Use this when products were sent twice and all statuses reset to 'pending'.
 */
router.post('/rebuild-marketplace-products', auth, isAdmin, async (_req, res) => {
  const TrendyolService = require('../services/trendyol/trendyolService');

  try {
    const connections = await prisma.marketplaceConnection.findMany({
      where: { marketplaceType: 'trendyol', status: 'active' },
      include: { store: { select: { id: true, name: true } } }
    });

    if (connections.length === 0) {
      return res.json({ message: 'Aktif Trendyol bağlantısı bulunamadı', updated: 0, notFound: 0 });
    }

    let totalUpdated = 0;
    let totalNotFound = 0;
    const details = [];

    for (const conn of connections) {
      const service = new TrendyolService(conn);

      // Fetch all pending MarketplaceProduct records for this connection
      const pendingMPs = await prisma.marketplaceProduct.findMany({
        where: { connectionId: conn.id, status: 'pending' },
        include: { product: { select: { id: true, barcode: true, title: true } } }
      });

      if (pendingMPs.length === 0) {
        details.push({ connectionId: conn.id, storeName: conn.store.name, updated: 0, notFound: 0 });
        continue;
      }

      // Collect all barcodes to look up
      const barcodes = pendingMPs.map(mp => mp.product.barcode).filter(Boolean);
      const barcodeToMP = {};
      for (const mp of pendingMPs) {
        if (mp.product.barcode) barcodeToMP[mp.product.barcode] = mp;
      }

      // Fetch from Trendyol in batches of 100 barcodes
      const BATCH = 100;
      const trendyolProductMap = {}; // barcode -> trendyol product

      for (let i = 0; i < barcodes.length; i += BATCH) {
        const batch = barcodes.slice(i, i + BATCH);
        try {
          const data = await service.getProducts(0, BATCH, undefined, batch);
          const items = (data.content || []);
          for (const item of items) {
            if (item.barcode) trendyolProductMap[item.barcode] = item;
          }
        } catch (e) {
          // partial failure — continue with other batches
        }
      }

      let updated = 0;
      let notFound = 0;

      for (const mp of pendingMPs) {
        const barcode = mp.product.barcode;
        const tyProduct = barcode ? trendyolProductMap[barcode] : null;

        if (!tyProduct) {
          notFound++;
          continue;
        }

        // Map Trendyol product status to our status
        let newStatus = 'pending';
        if (tyProduct.approved === true && tyProduct.onSale === true) {
          newStatus = 'active';
        } else if (tyProduct.approved === true && tyProduct.onSale === false) {
          newStatus = 'active'; // approved but not on sale — treat as active
        } else if (tyProduct.approved === false && tyProduct.rejected === true) {
          newStatus = 'rejected';
        } else if (tyProduct.approved === false) {
          newStatus = 'pending'; // still under review
        }

        await prisma.marketplaceProduct.update({
          where: { id: mp.id },
          data: {
            status: newStatus,
            trendyolProductId: tyProduct.id ? String(tyProduct.id) : mp.trendyolProductId,
            lastSyncAt: new Date()
          }
        });
        updated++;
      }

      totalUpdated += updated;
      totalNotFound += notFound;
      details.push({ connectionId: conn.id, storeName: conn.store.name, updated, notFound });
    }

    res.json({
      message: `${totalUpdated} ürün güncellendi, ${totalNotFound} ürün Trendyol'da bulunamadı`,
      totalUpdated,
      totalNotFound,
      details
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/export-data
 * One-time: export all critical data as JSON for migration.
 */
router.get('/export-data', auth, isAdmin, async (_req, res) => {
  try {
    const [users, stores, connections, xmlSources, pricingRules, settings, subscriptions] = await Promise.all([
      prisma.user.findMany({ include: { stores: false } }),
      prisma.store.findMany(),
      prisma.marketplaceConnection.findMany(),
      prisma.xmlSource.findMany(),
      prisma.pricingRule.findMany(),
      prisma.setting.findMany(),
      prisma.subscription.findMany(),
    ]);
    res.json({ users, stores, connections, xmlSources, pricingRules, settings, subscriptions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/import-data
 * One-time: import migrated JSON data into this server's DB.
 */
router.post('/import-data', auth, isAdmin, async (req, res) => {
  const { users, stores, connections, xmlSources, pricingRules, settings, subscriptions } = req.body;
  const results = {};
  try {
    if (users?.length) {
      for (const u of users) {
        await prisma.user.upsert({ where: { id: u.id }, create: u, update: u }).catch(() => {});
      }
      results.users = users.length;
    }
    if (stores?.length) {
      for (const s of stores) {
        await prisma.store.upsert({ where: { id: s.id }, create: s, update: s }).catch(() => {});
      }
      results.stores = stores.length;
    }
    if (connections?.length) {
      for (const c of connections) {
        await prisma.marketplaceConnection.upsert({ where: { id: c.id }, create: c, update: c }).catch(() => {});
      }
      results.connections = connections.length;
    }
    if (xmlSources?.length) {
      for (const x of xmlSources) {
        await prisma.xmlSource.upsert({ where: { id: x.id }, create: x, update: x }).catch(() => {});
      }
      results.xmlSources = xmlSources.length;
    }
    if (pricingRules?.length) {
      for (const p of pricingRules) {
        await prisma.pricingRule.upsert({ where: { id: p.id }, create: p, update: p }).catch(() => {});
      }
      results.pricingRules = pricingRules.length;
    }
    if (settings?.length) {
      for (const s of settings) {
        await prisma.setting.upsert({ where: { id: s.id }, create: s, update: s }).catch(() => {});
      }
      results.settings = settings.length;
    }
    if (subscriptions?.length) {
      for (const s of subscriptions) {
        await prisma.subscription.upsert({ where: { id: s.id }, create: s, update: s }).catch(() => {});
      }
      results.subscriptions = subscriptions.length;
    }
    res.json({ message: 'Import tamamlandı', results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
