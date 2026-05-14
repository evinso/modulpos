const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const whatsappService = require('../services/whatsappService');

const router = express.Router();

// Register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name, phone } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, şifre ve isim zorunludur' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'Bu e-posta adresi zaten kullanılıyor' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const trialSetting = await prisma.systemSettings.findUnique({ where: { key: 'trial_days' } });
    const trialDays = trialSetting ? parseInt(trialSetting.value) || 3 : 3;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        phone,
        stores: {
          create: {
            name: `${name}'in Mağazası`,
          }
        },
        subscriptions: {
          create: {
            plan: 'trial',
            status: 'trial',
            endDate: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
          }
        }
      },
      include: {
        stores: true,
        subscriptions: true
      }
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const { passwordHash: _, ...userWithoutPassword } = user;

    whatsappService.notifyNewUser(user).catch(() => {});

    res.status(201).json({
      message: `Kayıt başarılı! ${trialDays} günlük deneme süreniz başladı.`,
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email ve şifre zorunludur' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        stores: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Geçersiz e-posta veya şifre' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Geçersiz e-posta veya şifre' });
    }

    // Abonelik süresi kontrolü ve otomatik devre dışı bırakma
    let isExpired = false;
    if (user.subscriptions && user.subscriptions.length > 0) {
      const sub = user.subscriptions[0];
      if (sub.endDate && new Date(sub.endDate) < new Date()) {
        isExpired = true;
      }
    } else {
      // Hiç aboneliği yoksa süresi bitmiş say
      isExpired = true;
    }

    // Sadece normal müşterileri (owner, operator vb.) devre dışı bırak (adminler hariç)
    if (isExpired && user.role !== 'admin' && user.role !== 'superadmin') {
      if (user.isActive) {
        await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
        user.isActive = false;
      }
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Abonelik süreniz dolduğu için hesabınız devre dışı bırakılmıştır. Lütfen yönetici ile iletişime geçin.' });
    }

    // Create session record
    const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.socket?.remoteAddress || 'unknown').trim();
    const userAgent = req.headers['user-agent'] || 'unknown';
    const session = await prisma.userSession.create({
      data: { userId: user.id, ip, userAgent }
    }).catch(() => null);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, sessionId: session?.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const { passwordHash: _, ...userWithoutPassword } = user;

    // Log the login with IP
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        details: JSON.stringify({ email: user.email, ip }),
        level: 'INFO'
      }
    }).catch(() => {});

    res.json({
      message: 'Giriş başarılı',
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        stores: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const { passwordHash: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    next(error);
  }
});

// Update profile
router.put('/profile', auth, async (req, res, next) => {
  try {
    const { name, phone } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name, phone }
    });

    const { passwordHash: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    next(error);
  }
});

// Update password
router.put('/password', auth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) return res.status(400).json({ error: 'Mevcut şifreniz hatalı' });

    if (newPassword.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash }
    });

    res.json({ message: 'Şifreniz başarıyla güncellendi' });
  } catch (error) {
    next(error);
  }
});

// Update store settings
router.put('/store', auth, async (req, res, next) => {
  try {
    const { name, taxId, address, phone, invoiceType, companyTitle, taxOffice, city, district, postalCode } = req.body;

    const store = await prisma.store.findFirst({
      where: { userId: req.user.id }
    });

    if (!store) {
      return res.status(404).json({ error: 'Mağaza bulunamadı' });
    }

    const updatedStore = await prisma.store.update({
      where: { id: store.id },
      data: { name, taxId, address, phone, invoiceType, companyTitle, taxOffice, city, district, postalCode }
    });

    res.json(updatedStore);
  } catch (error) {
    next(error);
  }
});

// Get user's invoices
router.get('/invoices', auth, async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json(invoices);
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/sessions — current user's session history
router.get('/sessions', auth, async (req, res, next) => {
  try {
    const sessions = await prisma.userSession.findMany({
      where: { userId: req.user.id },
      orderBy: { loginAt: 'desc' },
      take: 20
    });

    // Count AuditLog actions per session window
    const enriched = await Promise.all(sessions.map(async (s) => {
      const endTime = s.isActive ? new Date() : s.lastSeenAt;
      const actionCount = await prisma.auditLog.count({
        where: { userId: s.userId, createdAt: { gte: s.loginAt, lte: endTime } }
      });
      return { ...s, actionCount, isCurrentSession: s.id === req.user.sessionId };
    }));

    res.json(enriched);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/auth/sessions/:id — terminate a session
router.delete('/sessions/:id', auth, async (req, res, next) => {
  try {
    const session = await prisma.userSession.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!session) return res.status(404).json({ error: 'Oturum bulunamadı' });

    await prisma.userSession.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
