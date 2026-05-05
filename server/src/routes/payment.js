const express = require('express');
const crypto = require('crypto');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { getOrCreateBalance } = require('./credits');

const router = express.Router();

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

    const user_ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    
    // Create a unique order ID that includes userId so we can parse it in webhook
    const merchant_oid = `MP_${req.user.id}_${Date.now()}`;
    
    const email = user.email;
    const payment_amount = Math.round(parseFloat(amount) * 100); // in kurus
    
    // Create token payload
    const user_basket = JSON.stringify([
      ['ModulPOS Kredi Yükleme', amount.toString(), 1] // Item, Price, Quantity
    ]);

    const no_installment = 0; // Taksit yapılsın mı? 0: evet, 1: hayır
    const max_installment = 0; // 0 = sınırsız taksit
    const currency = 'TL';
    const test_mode = process.env.NODE_ENV === 'production' ? 0 : 1;
    const merchant_ok_url = `${process.env.FRONTEND_URL || 'https://modulpos.com'}/credits?payment=success`;
    const merchant_fail_url = `${process.env.FRONTEND_URL || 'https://modulpos.com'}/credits?payment=fail`;
    
    const user_name = user.name || 'Müşteri';
    const user_address = 'Belirtilmedi';
    const user_phone = user.phone || '05000000000';
    const debug_on = 1;

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
    const fetch = require('node-fetch'); // we can also use axios
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
 * PayTR Callback / Webhook Endpoint
 * Must be public, no auth. PayTR sends POST here.
 */
router.post('/paytr-callback', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const { merchant_oid, status, total_amount, hash, merchant_id, failed_reason_code, failed_reason_msg } = req.body;
    
    const { getSetting } = require('./credits');
    const MERCHANT_KEY = await getSetting('paytr_merchant_key', process.env.PAYTR_MERCHANT_KEY || 'XXXXXXXXXXXXXXXX');
    const MERCHANT_SALT = await getSetting('paytr_merchant_salt', process.env.PAYTR_MERCHANT_SALT || 'XXXXXXXXXXXXXXXX');

    // Validate hash
    const hash_str = merchant_oid + MERCHANT_SALT + status + total_amount;
    const computed_hash = crypto.createHmac('sha256', MERCHANT_KEY).update(hash_str).digest('base64');
    
    if (hash !== computed_hash) {
      return res.status(400).send('PAYTR notification failed: bad hash');
    }

    if (status === 'success') {
      // Find user from merchant_oid. In real app, we should save merchant_oid in DB.
      // Here we didn't save it, so we need a way to know the user. 
      // Actually, we can append userId to merchant_oid when generating it: MP_USERID_TIMESTAMP
      // Example: merchant_oid = "MP_user-uuid-123_173000000"
      
      const parts = merchant_oid.split('_');
      // If we didn't include userId, we can't easily find who paid. 
      // Let's assume we change our merchant_oid format above to: `MP_${req.user.id}_${Date.now()}`
      if (parts.length >= 3 && parts[0] === 'MP') {
        const userId = parts[1];
        const amountTL = parseFloat(total_amount) / 100; // total_amount is in kurus
        
        // Add credits
        const balance = await getOrCreateBalance(userId);
        
        await prisma.creditBalance.update({
          where: { id: balance.id },
          data: { balance: balance.balance + amountTL }
        });

        await prisma.creditTransaction.create({
          data: {
            balanceId: balance.id,
            amount: amountTL,
            type: 'topup',
            description: `PayTR Kredi Kartı ile Yükleme (${merchant_oid})`
          }
        });
      }
      
      res.send('OK');
    } else {
      console.log('Payment failed:', failed_reason_code, failed_reason_msg);
      res.send('OK');
    }
  } catch (error) {
    console.error('PayTR Callback Error:', error);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
