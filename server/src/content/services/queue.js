const db = require('../db');
const V = require('../lib/validate');
const { HttpError } = require('../lib/http');

/**
 * The persistent job queue (table `jobs`). What it guarantees:
 *  - a job survives a restart: it is a row, not memory
 *  - the same piece of work is never queued twice while it is waiting or running (`dedupe_key`: one active job per key, enforced by a unique index)
 *  - a job is handed to exactly ONE worker (`FOR UPDATE SKIP LOCKED`), which holds a lease (`locked_until`); a worker that died loses it
 *  - a failed job is retried with growing pauses (1, 5, 20 minutes) up to `max_attempts`, unless the error says no retry can help (rejected key, empty balance)
 *  - a job whose worker died is queued again ONLY when running it twice is harmless (`idempotent`); otherwise it is failed with a clear note, never silently repeated
 * Pending jobs are never deleted by a budget or limit that is full: the work stays queued/skipped and says why.
 */
const LEASE_MINUTES = 20;
const BACKOFF_MINUTES = [1, 5, 20];
const STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled', 'skipped'];

const shape = (r) => ({ id: Number(r.id), botKey: r.bot_key, projectId: r.project_id, payload: r.payload, status: r.status, trigger: r.trigger, dedupeKey: r.dedupe_key, attempts: r.attempts, maxAttempts: r.max_attempts,
  runAfter: r.run_after, lockedBy: r.locked_by, lockedUntil: r.locked_until, lastError: r.last_error, result: r.result, userId: r.user_id, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at });

/** Queues a job. @returns { job, duplicate } - `duplicate` is true when an active job with the same dedupe key already exists (that one is returned). */
async function enqueue({ botKey, projectId = null, payload = {}, trigger = 'manual', dedupeKey = null, runAfter = new Date(), maxAttempts = 3, userId = null }) {
  const r = (await db.query(`INSERT INTO jobs (bot_key, project_id, payload, trigger, dedupe_key, run_after, max_attempts, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING RETURNING *`, [botKey, projectId, JSON.stringify(payload), trigger, dedupeKey, runAfter, maxAttempts, userId])).rows[0];
  if (r) return { job: shape(r), duplicate: false };
  const ex = (await db.query("SELECT * FROM jobs WHERE dedupe_key = $1 AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1", [dedupeKey])).rows[0];
  return { job: ex ? shape(ex) : null, duplicate: true };
}

/** The next due job, now locked to `workerId` for LEASE_MINUTES (a person's own click goes before scheduled work), or null. */
async function claim(workerId, { now = new Date() } = {}) {
  const r = (await db.query(`UPDATE jobs SET status = 'running', locked_by = $1, locked_until = $2::timestamptz + ($3 || ' minutes')::interval, attempts = attempts + 1, started_at = COALESCE(started_at, $2::timestamptz)
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= $2 ORDER BY (trigger = 'manual') DESC, run_after, id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [workerId, now, String(LEASE_MINUTES)])).rows[0];
  return r ? shape(r) : null;
}

async function complete(id, { status = 'done', result = {} } = {}, { now = new Date() } = {}) {
  await db.query("UPDATE jobs SET status = $2, result = $3, finished_at = $4, locked_by = NULL, locked_until = NULL WHERE id = $1 AND status = 'running'", [id, status === 'skipped' ? 'skipped' : 'done', JSON.stringify(result), now]);
}

/**
 * A job threw. @param err { message, fatal?: no retry can help, retryable?: false = do not retry }
 * @returns { retry: boolean, runAfter?: Date } - false means the job is finally failed
 */
async function fail(job, err, { now = new Date() } = {}) {
  const msg = String((err && err.message) || err || 'bilinmeyen hata').slice(0, 500);
  const again = !(err && (err.fatal || err.retryable === false)) && job.attempts < job.maxAttempts;
  if (again) {
    const runAfter = new Date(now.getTime() + BACKOFF_MINUTES[Math.min(job.attempts - 1, BACKOFF_MINUTES.length - 1)] * 60000);
    await db.query("UPDATE jobs SET status = 'queued', run_after = $2, last_error = $3, locked_by = NULL, locked_until = NULL WHERE id = $1 AND status = 'running'", [job.id, runAfter, msg]);
    return { retry: true, runAfter };
  }
  await db.query("UPDATE jobs SET status = 'failed', last_error = $2, finished_at = $3, locked_by = NULL, locked_until = NULL WHERE id = $1 AND status = 'running'", [job.id, msg, now]);
  return { retry: false };
}

/**
 * Jobs whose worker died (lease over). `idempotent(botKey)` says whether running such a job again is harmless: those go back to the queue (if attempts are left),
 * the others are failed with a note. @returns { requeued, failed }
 */
async function recoverStale({ now = new Date(), idempotent = () => false } = {}) {
  const out = { requeued: 0, failed: 0 };
  const rows = (await db.query("SELECT * FROM jobs WHERE status = 'running' AND locked_until < $1 ORDER BY id", [now])).rows;
  for (const r of rows) {
    const can = idempotent(r.bot_key) && r.attempts < r.max_attempts;
    const res = await db.query(`UPDATE jobs SET status = $2, last_error = $3, locked_by = NULL, locked_until = NULL, finished_at = $4 WHERE id = $1 AND status = 'running' AND locked_until < $5`,
      [r.id, can ? 'queued' : 'failed', can ? 'Çalışan süreç durdu; iş yeniden kuyruğa alındı' : 'Çalışan süreç durdu; iş yarım kaldı. Ücretli olabileceği için kendiliğinden tekrar denenmedi', can ? null : now, now]);
    if (res.rowCount) { if (can) out.requeued++; else out.failed++; }
  }
  return out;
}

async function list({ status = null, botKey = null, projectId = null, limit = 50 } = {}) {
  const p = []; const w = [];
  if (status) { p.push(V.oneOf(status, 'Durum', STATUSES)); w.push(`status = $${p.length}`); }
  if (botKey) { p.push(String(botKey).slice(0, 60)); w.push(`bot_key = $${p.length}`); }
  if (projectId) { p.push(V.uuid(projectId, 'Proje')); w.push(`project_id = $${p.length}`); }
  p.push(Math.min(200, Math.max(1, limit | 0 || 50)));
  const rows = (await db.query(`SELECT * FROM jobs ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY id DESC LIMIT $${p.length}`, p)).rows;
  return rows.map(shape);
}

async function get(id) {
  const r = (await db.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'Görev bulunamadı');
  return shape(r);
}

/** only a job that has not started can be cancelled */
async function cancel(id, { now = new Date() } = {}) {
  const r = await db.query("UPDATE jobs SET status = 'cancelled', finished_at = $2 WHERE id = $1 AND status = 'queued' RETURNING id", [id, now]);
  if (!r.rowCount) { const j = await get(id); throw new HttpError(409, j.status === 'running' ? 'Çalışan görev iptal edilemez; bitmesini bekleyin' : `Görev zaten “${j.status}” durumunda`); }
  return get(id);
}

/** a failed / cancelled / skipped job is queued again from the start (the person's decision) */
async function retry(id, { now = new Date(), userId = null } = {}) {
  const j = await get(id);
  if (!['failed', 'cancelled', 'skipped'].includes(j.status)) throw new HttpError(409, `“${j.status}” durumundaki görev yeniden denenemez`);
  const out = await enqueue({ botKey: j.botKey, projectId: j.projectId, payload: j.payload, trigger: 'retry', dedupeKey: j.dedupeKey, runAfter: now, maxAttempts: j.maxAttempts, userId });
  if (out.duplicate) throw new HttpError(409, 'Aynı iş zaten kuyrukta ya da çalışıyor');
  return out.job;
}

async function counts() {
  const r = (await db.query("SELECT status, count(*)::int n FROM jobs WHERE created_at > now() - interval '7 days' OR status IN ('queued', 'running') GROUP BY status")).rows;
  return Object.fromEntries(STATUSES.map((s) => [s, (r.find((x) => x.status === s) || { n: 0 }).n]));
}

/** old finished jobs are removed after `days` (the run records in automation_runs stay) */
async function purge(days = 30) { return (await db.query("DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled', 'skipped') AND finished_at < now() - ($1 || ' days')::interval", [String(days)])).rowCount; }

module.exports = { LEASE_MINUTES, BACKOFF_MINUTES, STATUSES, enqueue, claim, complete, fail, recoverStale, list, get, cancel, retry, counts, purge };
