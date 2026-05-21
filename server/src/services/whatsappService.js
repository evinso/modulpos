const prisma = require('../config/database');
const GreenApiService = require('./whatsapp/greenApiService');

// Cache settings 5 min to avoid DB hit on every notification
let cachedSettings = null;
let cacheExpiry = 0;

async function getSettings() {
  if (cachedSettings && Date.now() < cacheExpiry) return cachedSettings;
  const rows = await prisma.systemSettings.findMany({
    where: { key: { in: ['whatsapp_enabled', 'whatsapp_instance_id', 'whatsapp_api_token', 'whatsapp_phone', 'whatsapp_events'] } }
  });
  cachedSettings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  cacheExpiry = Date.now() + 5 * 60 * 1000;
  return cachedSettings;
}

function invalidateCache() {
  cachedSettings = null;
  cacheExpiry = 0;
}

async function sendWhatsApp(message) {
  try {
    const s = await getSettings();
    if (s.whatsapp_enabled !== 'true' || !s.whatsapp_instance_id || !s.whatsapp_api_token || !s.whatsapp_phone) return;
    const svc = new GreenApiService(s.whatsapp_instance_id, s.whatsapp_api_token);
    await svc.sendMessage(s.whatsapp_phone, message);
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.response?.data || err.message);
  }
}

async function isEventEnabled(eventKey) {
  const s = await getSettings();
  if (s.whatsapp_enabled !== 'true') return false;
  if (!s.whatsapp_events) return true;
  try {
    return JSON.parse(s.whatsapp_events).includes(eventKey);
  } catch { return true; }
}

async function notifyNewUser(user) {
  if (!await isEventEnabled('new_user')) return;
  await sendWhatsApp(`🆕 *Yeni Üye Kaydı*\n\n👤 ${user.name}\n📧 ${user.email}\n📅 ${new Date().toLocaleString('tr-TR')}`);
}

async function notifySubscriptionUpdated(user, plan, endDate) {
  if (!await isEventEnabled('subscription')) return;
  await sendWhatsApp(`💳 *Abonelik Güncellendi*\n\n👤 ${user.name || user.email}\n📦 Plan: ${plan}\n📅 Bitiş: ${new Date(endDate).toLocaleDateString('tr-TR')}`);
}

async function notifyCreditTopup(user, amount) {
  if (!await isEventEnabled('credit_topup')) return;
  await sendWhatsApp(`💰 *Kredi Yüklendi*\n\n👤 ${user.name || user.email}\n💵 Miktar: ${amount} kredi\n📅 ${new Date().toLocaleString('tr-TR')}`);
}

async function notifyNewSupportTicket(user, subject, priority) {
  if (!await isEventEnabled('new_support_ticket')) return;
  const priorityLabel = { low: 'Düşük', normal: 'Normal', high: 'Yüksek', urgent: 'Acil' }[priority] || priority;
  await sendWhatsApp(`🎫 *Yeni Destek Talebi*\n\n👤 ${user.name || user.email}\n📋 Konu: ${subject}\n⚡ Öncelik: ${priorityLabel}\n📅 ${new Date().toLocaleString('tr-TR')}`);
}

async function notifySubscriptionExpired(user) {
  if (!await isEventEnabled('subscription_expired')) return;
  await sendWhatsApp(`⏰ *Abonelik Süresi Doldu*\n\n👤 ${user.name || user.email}\n📧 ${user.email}\n📅 ${new Date().toLocaleString('tr-TR')}`);
}

async function notifyNewOrder(storeName, orderNumber, totalAmount, customerName) {
  if (!await isEventEnabled('new_order')) return;
  await sendWhatsApp(`🛒 *Yeni Sipariş*\n\n🏪 Mağaza: ${storeName}\n📦 Sipariş No: ${orderNumber}\n👤 Müşteri: ${customerName}\n💵 Tutar: ${parseFloat(totalAmount || 0).toFixed(2)}₺\n📅 ${new Date().toLocaleString('tr-TR')}`);
}

module.exports = { sendWhatsApp, notifyNewUser, notifySubscriptionUpdated, notifyCreditTopup, notifyNewSupportTicket, notifySubscriptionExpired, notifyNewOrder, invalidateCache };
