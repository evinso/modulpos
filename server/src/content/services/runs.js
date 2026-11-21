const db = require('../db');
const { HttpError } = require('../lib/http');

/**
 * Every run of a bot is written to automation_runs (what, when, who, counts, error). Runs started by a person now, by the scheduler in phase 4.
 * A run that was "running" when the process stopped is closed as an error at the next start, so nothing stays "running" forever.
 */
const shape = (r) => ({ id: Number(r.id), botKey: r.bot_key, projectId: r.project_id, trigger: r.trigger, status: r.status, stats: r.stats, error: r.error, startedAt: r.started_at, finishedAt: r.finished_at,
  seconds: r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000) : null });

async function start(botKey, { projectId = null, trigger = 'manual', userId = null } = {}) {
  const r = (await db.query('INSERT INTO automation_runs (bot_key, project_id, trigger, user_id) VALUES ($1,$2,$3,$4) RETURNING *', [botKey, projectId, trigger, userId])).rows[0];
  return shape(r);
}

async function finish(id, { status = 'ok', stats = {}, error = null } = {}) {
  const r = (await db.query('UPDATE automation_runs SET status = $2, stats = $3, error = $4, finished_at = now() WHERE id = $1 RETURNING *', [id, status, JSON.stringify(stats), error ? String(error).slice(0, 500) : null])).rows[0];
  return shape(r);
}

/** One run of the same bot per project at a time (a second click while it works is a 409, not a second run). */
async function running(botKey, projectId) {
  const r = (await db.query("SELECT * FROM automation_runs WHERE bot_key = $1 AND project_id IS NOT DISTINCT FROM $2 AND status = 'running' AND started_at > now() - interval '30 minutes' ORDER BY id DESC LIMIT 1", [botKey, projectId])).rows[0];
  return r ? shape(r) : null;
}

async function guardOne(botKey, projectId) {
  const r = await running(botKey, projectId);
  if (r) throw new HttpError(409, 'Bu işlem şu anda zaten çalışıyor; bitmesini bekleyin', { runId: r.id });
}

async function get(id) {
  const r = (await db.query('SELECT * FROM automation_runs WHERE id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'Çalıştırma kaydı bulunamadı');
  return shape(r);
}

async function list({ botKey = null, projectId = null, limit = 20 } = {}) {
  const w = []; const p = [];
  if (botKey) { p.push(botKey); w.push(`bot_key = $${p.length}`); }
  if (projectId) { p.push(projectId); w.push(`project_id = $${p.length}`); }
  p.push(Math.min(100, Math.max(1, limit | 0 || 20)));
  return (await db.query(`SELECT * FROM automation_runs ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY id DESC LIMIT $${p.length}`, p)).rows.map(shape);
}

/** last finished run per bot (for the bot table) */
async function lastByBot() {
  const r = (await db.query("SELECT DISTINCT ON (bot_key) * FROM automation_runs WHERE status <> 'running' ORDER BY bot_key, id DESC")).rows;
  const c = (await db.query("SELECT bot_key, count(*)::int n, count(*) FILTER (WHERE status = 'error')::int errors FROM automation_runs GROUP BY bot_key")).rows;
  const counts = new Map(c.map((x) => [x.bot_key, x]));
  return new Map(r.map((x) => [x.bot_key, { ...shape(x), runs: counts.get(x.bot_key).n, errors: counts.get(x.bot_key).errors }]));
}

async function closeStale() {
  return (await db.query("UPDATE automation_runs SET status = 'error', error = 'Süreç yeniden başladığı için yarıda kaldı', finished_at = now() WHERE status = 'running' AND started_at < now() - interval '15 minutes'")).rowCount;
}

/** Runs `fn(stats)` as a tracked run; `fn` returns the status ('ok' | 'partial') or throws (-> 'error'). The finished run is returned. */
async function track(botKey, opts, fn) {
  const run = await start(botKey, opts);
  const stats = {};
  try {
    const status = await fn(stats, run) || 'ok';
    return await finish(run.id, { status, stats });
  } catch (err) {
    return finish(run.id, { status: 'error', stats, error: err && err.message });
  }
}

module.exports = { start, finish, running, guardOne, get, list, lastByBot, closeStale, track };
