const prisma = require('../config/database');
const WahaService = require('./whatsapp/wahaService');

let cachedSettings = null;
let cacheExpiry = 0;

const SETTINGS_KEYS = ['waha_enabled', 'waha_session', 'waha_admin_phone', 'waha_events'];

async function getSettings() {
  if (cachedSettings && Date.now() < cacheExpiry) return cachedSettings;
  const rows = await prisma.systemSettings.findMany({ where: { key: { in: SETTINGS_KEYS } } });
  cachedSettings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  cacheExpiry = Date.now() + 5 * 60 * 1000;
  return cachedSettings;
}

function invalidateCache() {
  cachedSettings = null;
  cacheExpiry = 0;
}

async function isEventEnabled(eventKey) {
  const s = await getSettings();
  if (s.waha_enabled !== 'true') return false;
  if (!s.waha_events) return true;
  try { return JSON.parse(s.waha_events).includes(eventKey); } catch { return true; }
}

// Send to a specific phone number
async function sendWhatsAppTo(phone, message) {
  const s = await getSettings();
  const waha = new WahaService(s.waha_session || 'default');
  await waha.sendMessage(phone, message);
}

// Send to admin phone only
async function sendWhatsApp(message) {
  try {
    const s = await getSettings();
    if (s.waha_enabled !== 'true' || !s.waha_admin_phone) return;
    const waha = new WahaService(s.waha_session || 'default');
    await waha.sendMessage(s.waha_admin_phone, message);
  } catch (err) {
    console.error('[WhatsApp] Admin send failed:', err.message);
  }
}

// Send to admin + user (if different)
async function sendToAdminAndUser(message, userPhone = null) {
  const s = await getSettings();
  if (s.waha_enabled !== 'true') return;
  const waha = new WahaService(s.waha_session || 'default');
  const targets = [];
  if (s.waha_admin_phone) targets.push(s.waha_admin_phone);
  if (userPhone && userPhone !== s.waha_admin_phone) targets.push(userPhone);
  await Promise.all(targets.map(phone =>
    waha.sendMessage(phone, message).catch(e => console.error(`[WhatsApp] Send to ${phone} failed:`, e.message))
  ));
}

async function notifyNewUser(user) {
  if (!await isEventEnabled('new_user')) return;
  await sendWhatsApp(`🆕 *Yeni Üye Kaydı*\n\n👤 ${user.name}\n📧 ${user.email}\n📅 ${new Date().toLocaleString('tr-TR')}`);
}

async function notifySubscriptionUpdated(user, plan, endDate) {
  if (!await isEventEnabled('subscription')) return;
  await sendToAdminAndUser(`💳 *Abonelik Güncellendi*\n\n👤 ${user.name || user.email}\n📦 Plan: ${plan}\n📅 Bitiş: ${new Date(endDate).toLocaleDateString('tr-TR')}`, user.phone);
}

async function notifyCreditTopup(user, amount) {
  if (!await isEventEnabled('credit_topup')) return;
  await sendToAdminAndUser(`💰 *Kredi Yüklendi*\n\n👤 ${user.name || user.email}\n💵 Miktar: ${amount} kredi\n📅 ${new Date().toLocaleString('tr-TR')}`, user.phone);
}

async function notifyNewSupportTicket(user, subject, priority) {
  if (!await isEventEnabled('new_support_ticket')) return;
  const priorityLabel = { low: 'Düşük', normal: 'Normal', high: 'Yüksek', urgent: 'Acil' }[priority] || priority;
  await sendToAdminAndUser(`🎫 *Yeni Destek Talebi*\n\n👤 ${user.name || user.email}\n📋 Konu: ${subject}\n⚡ Öncelik: ${priorityLabel}\n📅 ${new Date().toLocaleString('tr-TR')}`, user.phone);
}

async function notifySubscriptionExpired(user) {
  if (!await isEventEnabled('subscription_expired')) return;
  await sendToAdminAndUser(`⏰ *Abonelik Süresi Doldu*\n\n👤 ${user.name || user.email}\n📧 ${user.email}\n📅 ${new Date().toLocaleString('tr-TR')}`, user.phone);
}

async function notifyNewOrder(storeName, orderNumber, totalAmount, customerName, userPhone = null) {
  if (!await isEventEnabled('new_order')) return;
  await sendToAdminAndUser(
    `🛒 *Yeni Sipariş*\n\n🏪 Mağaza: ${storeName}\n📦 Sipariş No: ${orderNumber}\n👤 Müşteri: ${customerName}\n💵 Tutar: ${parseFloat(totalAmount || 0).toFixed(2)}₺\n📅 ${new Date().toLocaleString('tr-TR')}`,
    userPhone
  );
}

module.exports = { sendWhatsApp, sendWhatsAppTo, notifyNewUser, notifySubscriptionUpdated, notifyCreditTopup, notifyNewSupportTicket, notifySubscriptionExpired, notifyNewOrder, invalidateCache };
