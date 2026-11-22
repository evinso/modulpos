const db = require('../db');
const V = require('../lib/validate');
const { HttpError } = require('../lib/http');

/**
 * Messages for the people running the platform (budget full, article ready, a failed task ...). Stored in the database; phase 7 forwards the important ones to Telegram.
 * create() never throws into the work that raised it. Old read messages are removed after 90 days.
 */
const SEVERITIES = ['info', 'warning', 'critical'];

/** the same message to Telegram when it is set up (phase 7): never waited for, never throwing; `flush()` lets a test wait for it */
const pending = new Set();
function toTelegram(n) {
  const p = Promise.resolve().then(() => require('./telegram').forward(n)).catch(() => {}).finally(() => pending.delete(p));
  pending.add(p);
}
const flush = () => Promise.all([...pending]);

const shape = (r) => ({ id: r.id, type: r.type, severity: r.severity, title: r.title, body: r.body, data: r.data, read: !!r.read_at, readAt: r.read_at, createdAt: r.created_at });

async function create({ type, severity = 'info', title, body = '', data = {} }) {
  try {
    const sev = SEVERITIES.includes(severity) ? severity : 'info';
    const r = (await db.query('INSERT INTO notifications (type, severity, title, body, data) VALUES ($1,$2,$3,$4,$5) RETURNING id', [String(type).slice(0, 60), sev, String(title).slice(0, 200), String(body).slice(0, 2000), JSON.stringify(data || {})])).rows[0];
    toTelegram({ type: String(type).slice(0, 60), severity: sev, title: String(title).slice(0, 200), body: String(body).slice(0, 2000) });
    return r.id;
  } catch (err) { console.error('[Content] notification could not be written:', err.message); return null; }
}

async function list({ unreadOnly = false, severity = null, limit = 50, offset = 0 } = {}) {
  const w = []; const p = [];
  if (unreadOnly) w.push('read_at IS NULL');
  if (severity) { p.push(V.oneOf(severity, 'Önem', SEVERITIES)); w.push(`severity = $${p.length}`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const total = (await db.query(`SELECT count(*)::int n FROM notifications ${where}`, p)).rows[0].n;
  const rows = (await db.query(`SELECT * FROM notifications ${where} ORDER BY created_at DESC, id LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, Math.min(200, Math.max(1, limit | 0 || 50)), Math.max(0, offset | 0)])).rows;
  return { total, unread: await unreadCount(), items: rows.map(shape) };
}

async function unreadCount() { return (await db.query('SELECT count(*)::int n FROM notifications WHERE read_at IS NULL')).rows[0].n; }

async function markRead(id) {
  const r = await db.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1', [V.uuid(id, 'Bildirim')]);
  if (!r.rowCount) throw new HttpError(404, 'Bildirim bulunamadı');
}

async function markAllRead() { return (await db.query('UPDATE notifications SET read_at = now() WHERE read_at IS NULL')).rowCount; }

async function purge(days = 90) { return (await db.query("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < now() - ($1 || ' days')::interval", [String(days)])).rowCount; }

module.exports = { SEVERITIES, flush, create, list, unreadCount, markRead, markAllRead, purge };
