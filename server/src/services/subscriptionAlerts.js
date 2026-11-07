// Daily-ish check (cron): tells admin + user when a subscription is about to end (3 days) or just ended, once per end date.
// It only notifies; deactivating expired accounts stays where it was (at login).
const prisma = require('../config/database');
const whatsappService = require('./whatsappService');
const notificationService = require('./notificationService');

const DAY = 86400000;
const WARN_DAYS = 3;       // "about to end" window
const GRACE_DAYS = 7;      // an end date older than this is history, not news

/**
 * Pure decision: rows = latest subscription per user ({ userId, endDate }), markers = Map(userId -> "<iso>|<kind>") of what was already announced.
 * Returns [{ userId, kind: 'expiring'|'expired', endDate, days, marker }].
 */
function planSubscriptionAlerts(rows, markers, now = Date.now()) {
  const out = [];
  for (const r of rows) {
    if (!r.endDate) continue;
    const end = new Date(r.endDate).getTime();
    let kind = null;
    if (end > now && end - now <= WARN_DAYS * DAY) kind = 'expiring';
    else if (end <= now && now - end <= GRACE_DAYS * DAY) kind = 'expired';
    if (!kind) continue;
    const marker = `${new Date(end).toISOString()}|${kind}`;
    if (markers.get(r.userId) === marker) continue;
    out.push({ userId: r.userId, kind, endDate: new Date(end), days: Math.max(0, Math.ceil((end - now) / DAY)), marker });
  }
  return out;
}

async function runSubscriptionAlerts(now = Date.now()) {
  const from = new Date(now - GRACE_DAYS * DAY), to = new Date(now + WARN_DAYS * DAY);
  const subs = await prisma.subscription.findMany({
    where: { endDate: { gte: from, lte: to }, user: { isActive: true, role: { notIn: ['admin', 'superadmin'] } } },
    orderBy: { createdAt: 'desc' },
    select: { userId: true, endDate: true, createdAt: true },
  });
  const latest = new Map();
  for (const s of subs) if (!latest.has(s.userId)) latest.set(s.userId, s);
  // a newer subscription outside the window means the user already renewed
  const ids = [...latest.keys()];
  if (!ids.length) return 0;
  const newest = await prisma.subscription.findMany({ where: { userId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { userId: true, endDate: true, createdAt: true } });
  const current = new Map();
  for (const s of newest) if (!current.has(s.userId)) current.set(s.userId, s);
  const rows = ids.filter((id) => current.get(id).createdAt.getTime() === latest.get(id).createdAt.getTime()).map((id) => latest.get(id));

  const markerRows = await prisma.systemSettings.findMany({ where: { key: { in: ids.map((id) => `wa_sub_alert:${id}`) } } });
  const markers = new Map(markerRows.map((m) => [m.key.slice('wa_sub_alert:'.length), m.value]));
  const plan = planSubscriptionAlerts(rows, markers, now);
  for (const p of plan) {
    const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { id: true, name: true, email: true, phone: true } });
    if (!user) continue;
    // mark first: a failing send must not repeat every run
    await prisma.systemSettings.upsert({ where: { key: `wa_sub_alert:${p.userId}` }, create: { key: `wa_sub_alert:${p.userId}`, value: p.marker }, update: { value: p.marker } });
    const text = p.kind === 'expiring' ? `Aboneliğiniz ${p.days <= 0 ? 'bugün' : `${p.days} gün sonra`} bitiyor.` : 'Abonelik süreniz doldu.';
    notificationService.createForUser(p.userId, { title: p.kind === 'expiring' ? 'Abonelik bitmek üzere' : 'Abonelik süresi doldu', message: text, type: 'warning', link: '/credits', noWhatsapp: true }).catch(() => {});
    if (p.kind === 'expiring') await whatsappService.notifySubscriptionExpiring(user, p.endDate, p.days).catch(() => {});
    else await whatsappService.notifySubscriptionExpired(user).catch(() => {});
  }
  return plan.length;
}

module.exports = { planSubscriptionAlerts, runSubscriptionAlerts };
