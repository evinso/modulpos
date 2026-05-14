const axios = require('axios');
const prisma = require('../config/database');

// Cache settings in memory for 5 minutes to avoid DB hit on every notification
let cachedSettings = null;
let cacheExpiry = 0;

async function getSettings() {
  if (cachedSettings && Date.now() < cacheExpiry) return cachedSettings;
  const rows = await prisma.systemSettings.findMany({
    where: { key: { in: ['whatsapp_enabled', 'whatsapp_token', 'whatsapp_phone', 'whatsapp_events'] } }
  });
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  cachedSettings = map;
  cacheExpiry = Date.now() + 5 * 60 * 1000;
  return map;
}

function invalidateCache() {
  cachedSettings = null;
  cacheExpiry = 0;
}

async function sendWhatsApp(message) {
  try {
    const s = await getSettings();
    if (s.whatsapp_enabled !== 'true' || !s.whatsapp_token || !s.whatsapp_phone) return;

    await axios.post('https://api.fonnte.com/send', {
      target: s.whatsapp_phone,
      message,
      countryCode: '90'
    }, {
      headers: { Authorization: s.whatsapp_token },
      timeout: 8000
    });
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.response?.data || err.message);
  }
}

async function isEventEnabled(eventKey) {
  const s = await getSettings();
  if (s.whatsapp_enabled !== 'true') return false;
  if (!s.whatsapp_events) return true; // if no filter set, all events enabled
  try {
    const events = JSON.parse(s.whatsapp_events);
    return events.includes(eventKey);
  } catch {
    return true;
  }
}

async function notifyNewUser(user) {
  if (!await isEventEnabled('new_user')) return;
  await sendWhatsApp(
    `🆕 *Yeni Üye Kaydı*\n\n👤 ${user.name}\n📧 ${user.email}\n📅 ${new Date().toLocaleString('tr-TR')}`
  );
}

async function notifySubscriptionUpdated(user, plan, endDate) {
  if (!await isEventEnabled('subscription')) return;
  await sendWhatsApp(
    `💳 *Abonelik Güncellendi*\n\n👤 ${user.name || user.email}\n📦 Plan: ${plan}\n📅 Bitiş: ${new Date(endDate).toLocaleDateString('tr-TR')}`
  );
}

async function notifyCreditTopup(user, amount) {
  if (!await isEventEnabled('credit_topup')) return;
  await sendWhatsApp(
    `💰 *Kredi Yüklendi*\n\n👤 ${user.name || user.email}\n💵 Miktar: ${amount} kredi\n📅 ${new Date().toLocaleString('tr-TR')}`
  );
}

module.exports = { sendWhatsApp, notifyNewUser, notifySubscriptionUpdated, notifyCreditTopup, invalidateCache };
