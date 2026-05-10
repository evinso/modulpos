const express = require('express');
const crypto = require('crypto');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { getOrCreateBalance } = require('./credits');
const notificationService = require('../services/notificationService');
const { applyPlanQuota } = require('../utils/quotaHelper');

const router = express.Router();

// Simple test endpoint — verifies the callback URL is reachable and returns OK
router.all('/paytr-ping', (_req, res) => {
  res.set('Content-Type', 'text/plain').send('OK');
});

/**
 * Helper to generate PayTR token
 */
router.post('/paytr-token', auth, async (req, res, next) => {
  try {
    const { amount } = req.body; // Amount in TL (e.g. 50 for 50 TL = 50 credits)
    
    if (!amount || amount < 10) {
      return res.status(400).json({ error: 'Minimum yükleme tutarı 10 TL/Kredi olmalıdır.' });
    }

    const { getSetting } = require('./credits');
    const MERCHANT_ID = await getSetting('paytr_merchant_id', process.env.PAYTR_MERCHANT_ID || 'XXXXXX');
    const MERCHANT_KEY = await getSetting('paytr_merchant_key', process.env.PAYTR_MERCHANT_KEY || 'XXXXXXXXXXXXXXXX');
    const MERCHANT_SALT = await getSetting('paytr_merchant_salt', process.env.PAYTR_MERCHANT_SALT || 'XXXXXXXXXXXXXXXX');

    if (MERCHANT_ID === 'XXXXXX') {
      return res.status(500).json({ error: 'PayTR entegrasyonu yapılandırılmamış (Sistem Yönetimi üzerinden API ayarlarını yapınız).' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

    const rawIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1')
      .split(',')[0].trim().replace(/^::ffff:/, '');
    const user_ip = rawIp === '::1' ? '127.0.0.1' : rawIp;

    // Alphanumeric only: MP + 32-char userId (no hyphens) + 13-digit timestamp
    const merchant_oid = `MP${req.user.id.replace(/-/g, '')}${Date.now()}`;
    
    const email = user.email;
    const payment_amount = Math.round(parseFloat(amount) * 100); // in kurus
    
    // Create token payload
    const user_basket = Buffer.from(JSON.stringify([
      ['ModulPOS Kredi Yükleme Hizmeti', amount.toString(), 1]
    ])).toString('base64');

    const no_installment = 0; // Taksit yapılsın mı? 0: evet, 1: hayır
    const max_installment = 0; // 0 = sınırsız taksit
    const currency = 'TL';
    const test_mode = process.env.NODE_ENV === 'production' ? 0 : 1;
    const merchant_ok_url = `${process.env.FRONTEND_URL || 'https://modulpos.com'}/credits?payment=success`;
    const merchant_fail_url = `${process.env.FRONTEND_URL || 'https://modulpos.com'}/credits?payment=fail`;
    
    const user_name = user.name || 'Müşteri';
    const user_address = 'Belirtilmedi';
    const user_phone = user.phone || '05000000000';
    const debug_on = process.env.NODE_ENV === 'production' ? 0 : 1;

    // Generate hash
    const hash_str = MERCHANT_ID + user_ip + merchant_oid + email + payment_amount + user_basket + no_installment + max_installment + currency + test_mode;
    const paytr_token = crypto.createHmac('sha256', MERCHANT_KEY).update(hash_str + MERCHANT_SALT).digest('base64');

    const form_data = {
      merchant_id: MERCHANT_ID,
      user_ip: user_ip,
      merchant_oid: merchant_oid,
      email: email,
      payment_amount: payment_amount,
      paytr_token: paytr_token,
      user_basket: user_basket,
      debug_on: debug_on,
      no_installment: no_installment,
      max_installment: max_installment,
      user_name: user_name,
      user_address: user_address,
      user_phone: user_phone,
      merchant_ok_url: merchant_ok_url,
      merchant_fail_url: merchant_fail_url,
      timeout_limit: 30,
      currency: currency,
      test_mode: test_mode
    };

    // Make request to PayTR API to get the iframe token
    const axios = require('axios');
    const FormData = require('form-data');
    
    const formData = new FormData();
    for(const key in form_data) {
        formData.append(key, form_data[key]);
    }

    const response = await axios.post('https://www.paytr.com/odeme/api/get-token', formData, {
      headers: formData.getHeaders()
    });

    if (response.data && response.data.status === 'success') {
      res.json({ token: response.data.token });
    } else {
      console.error('PayTR Token Error:', response.data);
      res.status(500).json({ error: 'Ödeme sistemi başlatılamadı. Hata: ' + response.data.reason });
    }

  } catch (error) {
    console.error('PayTR integration error:', error);
    next(error);
  }
});

/**
 * POST /payment/subscription-token
 * Create PayTR iframe token for subscription purchase.
 * merchant_oid format: SUB_userId_days_timestamp
 */
router.post('/subscription-token', auth, async (req, res, next) => {
  try {
    const { amount, planName, planId, days } = req.body;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      return res.status(400).json({ error: 'Geçersiz tutar.' });
    }

    const { getSetting } = require('./credits');
    const MERCHANT_ID = await getSetting('paytr_merchant_id', process.env.PAYTR_MERCHANT_ID || 'XXXXXX');
    const MERCHANT_KEY = await getSetting('paytr_merchant_key', process.env.PAYTR_MERCHANT_KEY || 'XXXXXXXXXXXXXXXX');
    const MERCHANT_SALT = await getSetting('paytr_merchant_salt', process.env.PAYTR_MERCHANT_SALT || 'XXXXXXXXXXXXXXXX');

    if (MERCHANT_ID === 'XXXXXX') {
      return res.status(500).json({ error: 'PayTR entegrasyonu yapılandırılmamış.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

    const rawIp2 = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1')
      .split(',')[0].trim().replace(/^::ffff:/, '');
    const user_ip = rawIp2 === '::1' ? '127.0.0.1' : rawIp2;
    const subDays = parseInt(days) || 30;
    // Alphanumeric only: SUB + 32-char userId (no hyphens) + 3-digit days + 13-digit timestamp
    const merchant_oid = `SUB${req.user.id.replace(/-/g, '')}${String(subDays).padStart(3, '0')}${Date.now()}`;

    // Store planId temporarily so callback can apply correct quota
    if (planId) {
      try {
        await prisma.systemSettings.upsert({
          where: { key: `pending_plan_${merchant_oid}` },
          update: { value: planId },
          create: { key: `pending_plan_${merchant_oid}`, value: planId }
        });
      } catch {}
    }

    const payment_amount = Math.round(numAmount * 100);
    const user_basket = Buffer.from(JSON.stringify([[planName || 'ModulPOS Abonelik Hizmeti', numAmount.toString(), 1]])).toString('base64');
    const no_installment = 0;
    const max_installment = 0;
    const currency = 'TL';
    const test_mode = process.env.NODE_ENV === 'production' ? 0 : 1;
    const merchant_ok_url = `${process.env.FRONTEND_URL || 'https://modulpos.com'}/credits?payment=sub_success`;
    const merchant_fail_url = `${process.env.FRONTEND_URL || 'https://modulpos.com'}/credits?payment=sub_fail`;

    const hash_str = MERCHANT_ID + user_ip + merchant_oid + user.email + payment_amount + user_basket + no_installment + max_installment + currency + test_mode;
    const paytr_token = crypto.createHmac('sha256', MERCHANT_KEY).update(hash_str + MERCHANT_SALT).digest('base64');

    const axios = require('axios');
    const FormData = require('form-data');
    const formData = new FormData();
    const form_data = {
      merchant_id: MERCHANT_ID, user_ip, merchant_oid, email: user.email, payment_amount,
      paytr_token, user_basket, debug_on: process.env.NODE_ENV === 'production' ? 0 : 1, no_installment, max_installment,
      user_name: user.name || 'Müşteri', user_address: 'Belirtilmedi',
      user_phone: user.phone || '05000000000', merchant_ok_url, merchant_fail_url,
      timeout_limit: 30, currency, test_mode
    };
    for (const key in form_data) formData.append(key, form_data[key]);

    const response = await axios.post('https://www.paytr.com/odeme/api/get-token', formData, { headers: formData.getHeaders() });
    if (response.data?.status === 'success') {
      res.json({ token: response.data.token });
    } else {
      res.status(500).json({ error: 'Ödeme sistemi başlatılamadı: ' + response.data?.reason });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * PayTR Callback / Webhook Endpoint
 * Must be public, no auth. PayTR sends POST here.
 */
router.post('/paytr-callback', express.urlencoded({ extended: true }), async (req, res) => {
  // Always respond OK first — PayTR retries indefinitely on non-OK responses
  res.send('OK');

  try {
    const { merchant_oid, status, total_amount, hash, failed_reason_code, failed_reason_msg, test_mode } = req.body;
    console.log('[PayTR] Callback alındı — merchant_oid:', merchant_oid, '| status:', status, '| amount:', total_amount, '| test_mode:', test_mode);

    const { getSetting } = require('./credits');
    let MERCHANT_KEY, MERCHANT_SALT;
    try {
      MERCHANT_KEY = await getSetting('paytr_merchant_key', process.env.PAYTR_MERCHANT_KEY || 'XXXXXXXXXXXXXXXX');
      MERCHANT_SALT = await getSetting('paytr_merchant_salt', process.env.PAYTR_MERCHANT_SALT || 'XXXXXXXXXXXXXXXX');
    } catch (dbErr) {
      console.error('[PayTR] getSetting DB hatası, env fallback kullanılıyor:', dbErr.message);
      MERCHANT_KEY = process.env.PAYTR_MERCHANT_KEY || 'XXXXXXXXXXXXXXXX';
      MERCHANT_SALT = process.env.PAYTR_MERCHANT_SALT || 'XXXXXXXXXXXXXXXX';
    }

    const hash_str = merchant_oid + MERCHANT_SALT + status + total_amount;
    const computed_hash = crypto.createHmac('sha256', MERCHANT_KEY).update(hash_str).digest('base64');

    if (hash !== computed_hash) {
      console.error('[PayTR] HASH HATASI — gelen:', hash, '| hesaplanan:', computed_hash, '| key uzunluk:', MERCHANT_KEY.length, '| salt uzunluk:', MERCHANT_SALT.length);
      try { await prisma.paytrLog.create({ data: { merchantOid: merchant_oid, status: 'hash_error', totalAmount: parseFloat(total_amount) / 100, rawBody: JSON.stringify(req.body) } }); } catch {}
      return;
    }

    // Parse merchant_oid
    const restoreUuid = s => s.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    let prefix, logUserId, parsedDays;
    if (merchant_oid.includes('_')) {
      const parts = merchant_oid.split('_');
      prefix = parts[0]; logUserId = parts[1] || null; parsedDays = parseInt(parts[2]) || 30;
    } else if (merchant_oid.startsWith('SUB')) {
      prefix = 'SUB'; logUserId = restoreUuid(merchant_oid.slice(3, 35)); parsedDays = parseInt(merchant_oid.slice(35, 38)) || 30;
    } else if (merchant_oid.startsWith('MP')) {
      prefix = 'MP'; logUserId = restoreUuid(merchant_oid.slice(2, 34)); parsedDays = 30;
    } else {
      prefix = ''; logUserId = null; parsedDays = 30;
    }

    const logType = prefix === 'SUB' ? 'subscription' : prefix === 'MP' ? 'topup' : null;
    const amountTL = parseFloat(total_amount) / 100;

    let logUserEmail = null;
    try {
      if (logUserId) {
        const u = await prisma.user.findUnique({ where: { id: logUserId }, select: { email: true } });
        logUserEmail = u?.email || null;
      }
    } catch {}

    if (status === 'success') {
      // Duplicate check — PayTR may send same callback multiple times
      let alreadyProcessed = false;
      try {
        const existing = await prisma.paytrLog.findFirst({ where: { merchantOid: merchant_oid, status: 'success' } });
        if (existing) { console.log('[PayTR] Duplikat callback yoksayıldı:', merchant_oid); alreadyProcessed = true; }
      } catch {}

      if (!alreadyProcessed && prefix === 'MP' && logUserId) {
        const balance = await getOrCreateBalance(logUserId);
        await prisma.creditBalance.update({ where: { id: balance.id }, data: { balance: balance.balance + amountTL } });
        await prisma.creditTransaction.create({ data: { balanceId: balance.id, amount: amountTL, type: 'topup', description: `PayTR Kredi Kartı ile Yükleme (${merchant_oid})` } });
        console.log('[PayTR] Kredi yüklendi — userId:', logUserId, '| tutar:', amountTL);
        notificationService.createForUser(logUserId, { title: 'Kredi Yüklendi', message: `₺${amountTL.toFixed(2)} kredi hesabınıza eklendi.`, type: 'success', link: '/credits' });
      } else if (!alreadyProcessed && prefix === 'SUB' && logUserId) {
        const user = await prisma.user.findUnique({ where: { id: logUserId }, include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } } });
        if (user) {
          let currentEndDate = new Date();
          if (user.subscriptions[0]?.endDate && new Date(user.subscriptions[0].endDate) > new Date()) currentEndDate = new Date(user.subscriptions[0].endDate);
          const newEndDate = new Date(currentEndDate.getTime() + parsedDays * 24 * 60 * 60 * 1000);
          await prisma.subscription.create({ data: { userId: logUserId, plan: 'premium', status: 'active', endDate: newEndDate, amount: amountTL } });
          if (!user.isActive) await prisma.user.update({ where: { id: logUserId }, data: { isActive: true } });

          // Apply plan quota if planId was stored at token creation
          try {
            const planSetting = await prisma.systemSettings.findUnique({ where: { key: `pending_plan_${merchant_oid}` } });
            if (planSetting?.value) {
              const plan = await prisma.landingPricingPlan.findUnique({ where: { id: planSetting.value }, select: { maxProducts: true, maxXmlSources: true } });
              if (plan) {
                await applyPlanQuota(logUserId, plan.maxProducts, plan.maxXmlSources);
                console.log('[PayTR] Plan kotası uygulandı — userId:', logUserId, '| maxProducts:', plan.maxProducts, '| maxXmlSources:', plan.maxXmlSources);
              }
              await prisma.systemSettings.delete({ where: { key: `pending_plan_${merchant_oid}` } }).catch(() => {});
            }
          } catch (qErr) { console.error('[PayTR] Plan kota hatası:', qErr.message); }

          console.log('[PayTR] Abonelik aktive edildi — userId:', logUserId, '| bitiş:', newEndDate);
          notificationService.createForUser(logUserId, { title: 'Abonelik Aktifleştirildi', message: `Aboneliğiniz ${newEndDate.toLocaleDateString('tr-TR')} tarihine kadar uzatıldı.`, type: 'success', link: '/credits' });
        }
      }
      try { await prisma.paytrLog.create({ data: { merchantOid: merchant_oid, status: 'success', totalAmount: amountTL, userId: logUserId, userEmail: logUserEmail, type: logType, rawBody: JSON.stringify(req.body) } }); } catch (e) { console.error('[PayTR] Log kaydedilemedi:', e.message); }
    } else {
      const failReason = [failed_reason_code, failed_reason_msg].filter(Boolean).join(' - ');
      console.log('[PayTR] Ödeme başarısız:', failReason);
      if (logUserId) notificationService.createForUser(logUserId, { title: 'Ödeme Başarısız', message: failReason || 'Ödeme işlemi tamamlanamadı.', type: 'error', link: '/credits' });
      try { await prisma.paytrLog.create({ data: { merchantOid: merchant_oid, status: 'failed', totalAmount: amountTL, userId: logUserId, userEmail: logUserEmail, type: logType, failReason: failReason || null, rawBody: JSON.stringify(req.body) } }); } catch {}
    }
  } catch (error) {
    console.error('[PayTR] Callback işleme hatası:', error);
  }
});

module.exports = router;
