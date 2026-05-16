const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const whatsappService = require('../services/whatsappService');

const router = express.Router();

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  }
  next();
};

// ─── Helper: get or create balance ───────────────────────────────────
async function getOrCreateBalance(userId) {
  let balance = await prisma.creditBalance.findUnique({ where: { userId } });
  if (!balance) {
    balance = await prisma.creditBalance.create({ data: { userId, balance: 0 } });
  }
  return balance;
}

// ─── Helper: get system setting ──────────────────────────────────────
async function getSetting(key, defaultValue = '0') {
  const setting = await prisma.systemSettings.findUnique({ where: { key } });
  return setting ? setting.value : defaultValue;
}

// ─── USER ENDPOINTS ──────────────────────────────────────────────────

// GET /api/credits/balance - Kullanıcının bakiyesini getir
router.get('/balance', auth, async (req, res, next) => {
  try {
    const balance = await getOrCreateBalance(req.user.id);
    res.json({ balance: balance.balance, id: balance.id });
  } catch (error) {
    next(error);
  }
});

// GET /api/credits/transactions - Kullanıcının işlem geçmişi
router.get('/transactions', auth, async (req, res, next) => {
  try {
    const balance = await getOrCreateBalance(req.user.id);
    const transactions = await prisma.creditTransaction.findMany({
      where: { balanceId: balance.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

// GET /api/credits/prices - İşlem fiyatlarını getir (public for logged-in users)
router.get('/prices', auth, async (req, res, next) => {
  try {
    const xmlConvertCost = await getSetting('credit_xml_convert', '1');
    const xmlImportDefaultCost = await getSetting('credit_xml_import_default', '5');
    const buyboxCheckCost = await getSetting('credit_buybox_check', '1');
    const buyboxAdjustCost = await getSetting('credit_buybox_adjust', '0.1');
    const autoReplyCost = await getSetting('credit_auto_reply', '1');
    const categoryAiCost = await getSetting('credit_category_ai', '0.5');

    res.json({
      xmlConvertCost: parseFloat(xmlConvertCost),
      xmlImportDefaultCost: parseFloat(xmlImportDefaultCost),
      buyboxCheckCost: parseFloat(buyboxCheckCost),
      buyboxAdjustCost: parseFloat(buyboxAdjustCost),
      autoReplyCost: parseFloat(autoReplyCost),
      categoryAiCost: parseFloat(categoryAiCost)
    });
  } catch (error) {
    next(error);
  }
});

// ─── ADMIN ENDPOINTS ─────────────────────────────────────────────────

// GET /api/credits/admin/settings - Admin: Tüm kredi ayarlarını getir
router.get('/admin/settings', auth, requireAdmin, async (req, res, next) => {
  try {
    const settings = await prisma.systemSettings.findMany();
    const map = {};
    for (const s of settings) { map[s.key] = s.value; }
    res.json(map);
  } catch (error) {
    next(error);
  }
});

// PUT /api/credits/admin/settings - Admin: Kredi ayarlarını güncelle
router.put('/admin/settings', auth, requireAdmin, async (req, res, next) => {
  try {
    const { settings } = req.body; // { key: value, ... }
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Ayarlar objesi gerekli' });
    }

    for (const [key, value] of Object.entries(settings)) {
      await prisma.systemSettings.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      });
    }

    res.json({ message: 'Ayarlar güncellendi' });
  } catch (error) {
    next(error);
  }
});

// GET /api/credits/admin/users - Admin: Tüm kullanıcıların bakiyelerini listele
router.get('/admin/users', auth, requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true }
    });

    const balances = await prisma.creditBalance.findMany();
    const balanceMap = {};
    for (const b of balances) { balanceMap[b.userId] = b.balance; }

    const result = users.map(u => ({
      ...u,
      creditBalance: balanceMap[u.id] || 0
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/credits/admin/topup - Admin: Kullanıcıya kredi yükle
router.post('/admin/topup', auth, requireAdmin, async (req, res, next) => {
  try {
    const { userId, amount, description } = req.body;
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Geçerli kullanıcı ve tutar gerekli' });
    }

    const balance = await getOrCreateBalance(userId);

    await prisma.creditBalance.update({
      where: { id: balance.id },
      data: { balance: balance.balance + parseFloat(amount) }
    });

    await prisma.creditTransaction.create({
      data: {
        balanceId: balance.id,
        amount: parseFloat(amount),
        type: 'topup',
        description: description || `Admin tarafından ${amount} kredi yüklendi`
      }
    });

    const newBalance = balance.balance + parseFloat(amount);
    notificationService.createForUser(userId, {
      title: 'Kredi Yüklendi',
      message: `${parseFloat(amount)} kredi hesabınıza yüklendi. Güncel bakiye: ${newBalance} kredi.`,
      type: 'success',
      link: '/credits',
      data: { notifType: 'credit_topup', amount: parseFloat(amount), newBalance }
    }).catch(() => {});

    const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    whatsappService.notifyCreditTopup(targetUser || { email: userId }, parseFloat(amount)).catch(() => {});

    res.json({ message: `${amount} kredi başarıyla yüklendi`, newBalance });
  } catch (error) {
    next(error);
  }
});

// POST /api/credits/admin/adjust - Admin: Manuel bakiye düzeltmesi
router.post('/admin/adjust', auth, requireAdmin, async (req, res, next) => {
  try {
    const { userId, amount, description } = req.body;
    if (!userId || amount === undefined) {
      return res.status(400).json({ error: 'Kullanıcı ve tutar gerekli' });
    }

    const balance = await getOrCreateBalance(userId);
    const newBalance = balance.balance + parseFloat(amount);

    if (newBalance < 0) {
      return res.status(400).json({ error: 'Bakiye negatife düşemez' });
    }

    await prisma.creditBalance.update({
      where: { id: balance.id },
      data: { balance: newBalance }
    });

    await prisma.creditTransaction.create({
      data: {
        balanceId: balance.id,
        amount: parseFloat(amount),
        type: 'admin_adjust',
        description: description || `Admin bakiye düzeltmesi: ${amount}`
      }
    });

    res.json({ message: 'Bakiye güncellendi', newBalance });
  } catch (error) {
    next(error);
  }
});

// ─── CREDIT DEDUCTION HELPER (used by other routes) ──────────────────
// Exported for use in xmlConverter and globalXml routes
async function deductCredits(userId, amount, type, description, referenceId = null) {
  const balance = await getOrCreateBalance(userId);

  if (balance.balance < amount) {
    const err = new Error(`Yetersiz kredi. Gerekli: ${amount}, Mevcut: ${balance.balance}`);
    err.statusCode = 402;
    throw err;
  }

  await prisma.creditBalance.update({
    where: { id: balance.id },
    data: { balance: balance.balance - amount }
  });

  await prisma.creditTransaction.create({
    data: {
      balanceId: balance.id,
      amount: -amount,
      type,
      description,
      referenceId
    }
  });

  const newBalance = balance.balance - amount;

  // Low balance warning: first time crossing below 10
  if (newBalance < 10 && balance.balance >= 10) {
    notificationService.createForUser(userId, {
      title: 'Kredi Bakiyeniz Azaldı',
      message: `Bakiyeniz ${newBalance.toFixed(1)} krediye düştü. İşlemlerinizin kesintisiz sürmesi için kredi yükleyin.`,
      type: 'warning',
      link: '/credits',
      data: { notifType: 'credit_low', newBalance }
    }).catch(() => {});
  }

  return newBalance;
}

// GET /api/credits/admin/paytr-logs
router.get('/admin/paytr-logs', auth, requireAdmin, async (req, res, next) => {
  try {
    const logs = await prisma.paytrLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.deductCredits = deductCredits;
module.exports.getSetting = getSetting;
module.exports.getOrCreateBalance = getOrCreateBalance;
