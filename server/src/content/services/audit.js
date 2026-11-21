const db = require('../db');

/**
 * Every important change is written to audit_logs (who, what, before, after, from where). Secrets are removed first.
 * Writing the log must never break the action it describes: a failure is only reported on the console.
 */
const SECRET_KEY = /(password|passwd|secret|token|api_?key|authorization|cookie|hash)/i;

function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) out[k] = v === null || v === undefined || v === '' ? v : '[gizli]';
    else if (k === 'content_html' || k === 'contentHtml') out[k] = typeof v === 'string' ? `[${v.length} karakter]` : v;
    else out[k] = redact(v, depth + 1);
  }
  return out;
}

/** @param ctx { user?: { id, email }, ip? } */
async function audit(ctx, { action, entity = '', entityId = '', before = null, after = null }) {
  try {
    await db.query('INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, before, after, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      ctx && ctx.user ? ctx.user.id : null, ctx && ctx.user ? ctx.user.email : null, action, entity, String(entityId || ''),
      before === null ? null : JSON.stringify(redact(before)), after === null ? null : JSON.stringify(redact(after)), (ctx && ctx.ip) || null,
    ]);
  } catch (err) { console.error('[Content] audit log could not be written:', err.message); }
}

async function systemLog(level, source, message, data = {}) {
  try { await db.query('INSERT INTO system_logs (level, source, message, data) VALUES ($1,$2,$3,$4)', [level, source, String(message).slice(0, 2000), JSON.stringify(redact(data))]); }
  catch (err) { console.error('[Content] system log could not be written:', err.message); }
}

async function listAudit({ limit = 50, offset = 0, entity = null, userId = null, action = null } = {}) {
  const where = []; const params = [];
  if (entity) { params.push(entity); where.push(`entity = $${params.length}`); }
  if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
  if (action) { params.push(`%${action}%`); where.push(`action ILIKE $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await db.query(`SELECT count(*)::int n FROM audit_logs ${w}`, params)).rows[0].n;
  const rows = (await db.query(`SELECT id, user_email, action, entity, entity_id, before, after, ip, created_at FROM audit_logs ${w} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, Math.min(200, Math.max(1, limit)), Math.max(0, offset)])).rows;
  return { total, items: rows };
}

async function listSystem({ limit = 50, offset = 0, level = null } = {}) {
  const params = []; let w = '';
  if (level) { params.push(level); w = `WHERE level = $1`; }
  const total = (await db.query(`SELECT count(*)::int n FROM system_logs ${w}`, params)).rows[0].n;
  const rows = (await db.query(`SELECT id, level, source, message, data, created_at FROM system_logs ${w} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, Math.min(200, Math.max(1, limit)), Math.max(0, offset)])).rows;
  return { total, items: rows };
}

module.exports = { audit, systemLog, listAudit, listSystem, redact };
