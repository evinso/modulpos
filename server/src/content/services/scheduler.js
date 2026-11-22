const os = require('os');
const db = require('../db');
const V = require('../lib/validate');
const sched = require('../lib/schedule');
const { isValidTimezone } = require('../lib/time');
const { HttpError, bad } = require('../lib/http');
const settings = require('./settings');
const queue = require('./queue');
const runs = require('./runs');
const notifications = require('./notifications');
const providers = require('./providers');
const news = require('./news');
const niche = require('./nicheDiscovery');
const keywords = require('./keywords');
const serp = require('./serp');
const opportunities = require('./opportunities');
const writer = require('./writer');
const publishing = require('./publishing');
const sites = require('./sites');

/**
 * The scheduler and the background worker (phase 4). No n8n, no external cron: one in-process loop pair that only needs the content database.
 *   tick():    for every enabled bot whose time has come (and whose working hours are open) queue ONE job per active project (`jobs`, one active job per bot+project)
 *   workOnce(): take the next due job, run its handler, then complete it / retry it with a pause / fail it for good
 * What this means on the free hosting: the loops only run while the API is awake (the keep-alive wakes it); after a sleep the bot runs ONCE (not once per missed interval).
 * Money safety: bots that spend money (article writer, SERP, keyword data) are OFF until the owner switches them on; every one of them still reserves the daily limit and
 * obeys the provider budgets, and a full limit/budget ends the job as "skipped/partial" (nothing is deleted, the next tick looks again). Drafts are never published from here.
 */
const DEFAULTS = {
  news_discovery:      { enabled: true,  intervalMinutes: 120,  windowStart: null,    windowEnd: null,    weekdaysOnly: false, options: {}, spends: false, label: 'Haber tarama' },
  content_opportunity: { enabled: true,  intervalMinutes: 120,  windowStart: null,    windowEnd: null,    weekdaysOnly: false, options: {}, spends: false, label: 'Fırsat puanlama' },
  niche_discovery:     { enabled: true,  intervalMinutes: 1440, windowStart: null,    windowEnd: null,    weekdaysOnly: false, options: {}, spends: false, label: 'Niş keşfi' },
  keyword_research:    { enabled: false, intervalMinutes: 240,  windowStart: null,    windowEnd: null,    weekdaysOnly: false, options: {}, spends: true,  label: 'Anahtar kelime verisi' },
  seo_competition:     { enabled: false, intervalMinutes: 240,  windowStart: null,    windowEnd: null,    weekdaysOnly: false, options: { perRun: 5 }, spends: true, label: 'SERP rekabet analizi' },
  article_writer:      { enabled: false, intervalMinutes: 180,  windowStart: '09:00', windowEnd: '23:00', weekdaysOnly: false, options: { perRun: 1 }, spends: true, label: 'Makale yazımı' },
  content_publishing:  { enabled: false, intervalMinutes: 60,   windowStart: '09:00', windowEnd: '21:00', weekdaysOnly: false, options: { perRun: 2 }, spends: false, label: 'WordPress yayını' },
};
const SCHEDULABLE = Object.keys(DEFAULTS);
const FAIL_LIMIT = 5;                                                  // consecutive failed scheduled jobs before a bot is switched off
const GATES = { news_discovery: 'news', keyword_research: 'seo', seo_competition: 'seo', content_opportunity: 'seo', niche_discovery: 'seo' };   // the per-project "bot active" switches of the settings page

const rowToSchedule = (bot, r) => {
  const d = DEFAULTS[bot];
  if (!r) return { botKey: bot, ...d, timezone: 'Europe/Istanbul', nextRunAt: null, lastScheduledAt: null, failStreak: 0, disabledReason: null, saved: false };
  return { botKey: bot, enabled: r.enabled, intervalMinutes: r.interval_minutes ?? d.intervalMinutes, windowStart: r.window_start, windowEnd: r.window_end, weekdaysOnly: r.weekdays_only, timezone: r.timezone,
    options: { ...d.options, ...(r.options || {}) }, spends: d.spends, label: d.label, nextRunAt: r.next_run_at, lastScheduledAt: r.last_scheduled_at, failStreak: r.fail_streak, disabledReason: r.disabled_reason, saved: true };
};

async function loadSchedules() {
  const rows = new Map((await db.query('SELECT * FROM schedule_settings')).rows.map((r) => [r.bot_key, r]));
  return new Map(SCHEDULABLE.map((b) => [b, rowToSchedule(b, rows.get(b))]));
}
async function getSchedule(bot) { return (await loadSchedules()).get(bot); }

/** writes the effective schedule of a bot with some fields changed (the row is created on the first change) */
async function saveSchedule(bot, patch) {
  const cur = await getSchedule(bot); const n = { ...cur, ...patch };
  await db.query(`INSERT INTO schedule_settings (bot_key, enabled, interval_minutes, window_start, window_end, weekdays_only, timezone, options, next_run_at, last_scheduled_at, fail_streak, disabled_reason, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
    ON CONFLICT (bot_key) DO UPDATE SET enabled = $2, interval_minutes = $3, window_start = $4, window_end = $5, weekdays_only = $6, timezone = $7, options = $8, next_run_at = $9, last_scheduled_at = $10, fail_streak = $11, disabled_reason = $12, updated_at = now()`,
  [bot, n.enabled, n.intervalMinutes, n.windowStart, n.windowEnd, n.weekdaysOnly, n.timezone, JSON.stringify(n.options || {}), n.nextRunAt, n.lastScheduledAt, n.failStreak, n.disabledReason]);
  return getSchedule(bot);
}

/** the panel's edit of one bot's schedule: validated, applied from the next tick (the old "next run" is forgotten) */
async function updateSchedule(bot, body) {
  if (!DEFAULTS[bot]) throw bad('Bu bot zamanlanamaz');
  const patch = {};
  if (body.enabled !== undefined) { patch.enabled = V.bool(body.enabled, 'Aktif', true); if (patch.enabled) { patch.failStreak = 0; patch.disabledReason = null; } }
  if (body.intervalMinutes !== undefined) patch.intervalMinutes = V.int(body.intervalMinutes, 'Çalışma sıklığı (dakika)', { min: 5, max: 10080 });
  const hm = (v, l) => { if (v === null || v === '') return null; const s = V.str(v, l, { max: 5 }); if (sched.toMinutes(s) === null) throw bad(`${l} SS:DD biçiminde olmalı (ör. 09:00)`); return s; };
  if (body.windowStart !== undefined) patch.windowStart = hm(body.windowStart, 'Çalışma saati başlangıcı');
  if (body.windowEnd !== undefined) patch.windowEnd = hm(body.windowEnd, 'Çalışma saati bitişi');
  if (body.weekdaysOnly !== undefined) patch.weekdaysOnly = V.bool(body.weekdaysOnly, 'Yalnızca hafta içi', false);
  if (body.timezone !== undefined) { const tz = V.str(body.timezone, 'Saat dilimi', { required: true, max: 60 }); if (!isValidTimezone(tz)) throw bad('Saat dilimi geçersiz (ör. Europe/Istanbul)'); patch.timezone = tz; }
  if (body.options !== undefined) {
    if (!body.options || typeof body.options !== 'object') throw bad('Ek ayarlar bir nesne olmalı');
    const cur = await getSchedule(bot); patch.options = { ...cur.options };
    if (body.options.perRun !== undefined) { if (!('perRun' in DEFAULTS[bot].options)) throw bad('Bu bot için “her çalışmada işlem sayısı” yok'); patch.options.perRun = V.int(body.options.perRun, 'Her çalışmada işlem sayısı', { min: 1, max: 5 }); }
  }
  const cur = await getSchedule(bot); const m = { ...cur, ...patch };
  if (!!m.windowStart !== !!m.windowEnd) throw bad('Çalışma saatleri için başlangıç ve bitişin ikisi de yazılmalı (ya da ikisi de boş)');
  return saveSchedule(bot, { ...patch, nextRunAt: null });
}

// ── the handlers: what each bot does for ONE project ──────────────────────────────────────────────────────────────
/** `idempotent`: running the job twice is harmless (a crashed job may be queued again); `run(job, ctx)` -> { status: 'ok' | 'partial' | 'skipped', stats, message } or throws */
const HANDLERS = {
  news_discovery: { idempotent: true, async run(job, ctx) {
    await runs.guardOne('news_discovery', job.projectId);                                 // a scan started by hand is still running: try again later (the job is retried)
    const run = await news.runDiscovery(job.projectId, { trigger: job.trigger === 'manual' ? 'manual' : 'schedule', userId: job.userId, fetchImpl: ctx.newsFetch, now: ctx.now, gapMs: ctx.gapMs, force: false });
    if (run.status === 'error') throw new Error(run.error || 'Haber taraması başarısız');
    return { status: run.status === 'partial' ? 'partial' : 'ok', stats: run.stats, message: `${run.stats.newItems} yeni haber, ${run.stats.relevant} nişe uygun` };
  } },
  content_opportunity: { idempotent: true, async run(job, ctx) {
    const s = await opportunities.refresh(job.projectId, { trigger: job.trigger === 'manual' ? 'manual' : 'schedule', userId: job.userId, now: ctx.now });
    return { status: 'ok', stats: s, message: `${s.topicsCreated} yeni konu, ${s.eligible} uygun fikir` };
  } },
  niche_discovery: { idempotent: true, async run(job, ctx) {
    const s = await niche.discover(job.projectId, { now: ctx.now, userId: job.userId, trigger: job.trigger === 'manual' ? 'manual' : 'schedule' });
    return { status: 'ok', stats: s, message: `${s.created} yeni niş önerisi` };
  } },
  keyword_research: { idempotent: true, async run(job, ctx) {
    const p = await providers.get('dataforseo');
    if (!(p.configured && p.extra.login)) return { status: 'skipped', message: 'DataForSEO bağlı değil (aranma hacmi için dosyadan içe aktarma kullanılır)' };
    const out = await keywords.fetchMetrics(job.projectId, { manual: job.trigger === 'manual', trigger: job.trigger === 'manual' ? 'manual' : 'schedule', userId: job.userId, fetchImpl: ctx.fetchImpl, now: ctx.now });
    return { status: out.stopped ? 'partial' : 'ok', stats: out, message: out.message };
  } },
  seo_competition: { idempotent: true, async run(job, ctx) {
    const perRun = (await getSchedule('seo_competition')).options.perRun || 5; const manual = job.trigger === 'manual';
    const rows = (await db.query(`SELECT o.id, o.keyword_id FROM content_opportunities o WHERE o.project_id = $1 AND o.keyword_id IS NOT NULL AND o.status IN ('new', 'shortlisted') AND o.explain->'missing' @> '"competition"'::jsonb
      ORDER BY COALESCE(o.provisional_score, 0) DESC, o.updated_at DESC LIMIT $2`, [job.projectId, perRun])).rows;
    if (!rows.length) return { status: 'skipped', message: 'SERP analizi bekleyen fikir yok' };
    const stats = { analyzed: 0, cached: 0, failed: 0, stopped: null }; let streak = 0;
    for (const r of rows) {
      try {
        const out = await serp.analyze(r.keyword_id, { manual, trigger: manual ? 'manual' : 'schedule', userId: job.userId, fetchImpl: ctx.fetchImpl, now: ctx.now });
        if (out.stopped) { stats.stopped = out.stopped; break; }
        out.cached ? stats.cached++ : stats.analyzed++; streak = 0;
        await opportunities.rescore(r.id, { now: ctx.now });
      } catch (err) {
        if (err.status === 409) { stats.stopped = err.message; break; }                            // the SERP source is not set up: nothing more can be done now
        if (err.fatal || err.code === 'auth') { const e = new Error(err.message); e.fatal = true; throw e; }
        stats.failed++; if (++streak >= 2) { stats.stopped = err.message; break; }
      }
    }
    return { status: stats.stopped || stats.failed ? 'partial' : 'ok', stats, message: stats.stopped || `${stats.analyzed} SERP analizi yapıldı` };
  } },
  article_writer: { idempotent: false, async run(job, ctx) {
    const perRun = (await getSchedule('article_writer')).options.perRun || 1; const manual = job.trigger === 'manual';
    const sel = await opportunities.selectForGeneration(job.projectId, { count: perRun, now: ctx.now });
    if (!sel.picks.length) return { status: 'skipped', message: sel.note || 'Bugün yazılacak uygun fikir yok' };
    const stats = { written: 0, partial: 0, failed: 0, stopped: null, articles: [] };
    for (const pick of sel.picks) {
      try {
        const out = await writer.start(pick.id, { manual, userId: job.userId, fetchImpl: ctx.fetchImpl, fetcher: ctx.fetcher, now: ctx.now, background: false });
        const run = await runs.get(out.run.id);
        if (run.status === 'error') { stats.failed++; stats.stopped = run.error; if (/reddedildi|kredi|bakiye|bütçe/i.test(String(run.error))) break; } else { stats.written++; if (run.status === 'partial') stats.partial++; if (run.stats.articleId) stats.articles.push(run.stats.articleId); }
      } catch (err) { stats.stopped = err.message; break; }                                           // limit full, no vendor ready, bots paused ...: stop, the next tick looks again
    }
    if (!stats.written && stats.failed) { const e = new Error(stats.stopped || 'Makale yazılamadı'); e.fatal = /reddedildi|kredisi|bakiye|bütçe/i.test(String(stats.stopped)); throw e; }          // every attempt failed: the job fails (and counts towards switching the bot off)
    return { status: stats.stopped || stats.failed || stats.partial ? 'partial' : 'ok', stats, message: stats.written ? `${stats.written} makale taslağı yazıldı${stats.stopped ? ` (${stats.stopped})` : ''}` : (stats.stopped || 'Makale yazılamadı') };
  } },
};

/** the WordPress bot: a per-article send job, a bulk plan job, or (no payload) the scheduled pass: read back scheduled posts, then auto-publish approved articles if the owner allowed it */
HANDLERS.content_publishing = { idempotent: true, async run(job, ctx) {
  const pl = job.payload || {};
  if (pl.publicationId) {
    try { const pub = await publishing.send(pl.publicationId, { request: ctx.wpRequest, fetchBinary: ctx.fetchBinary }); return { status: 'ok', stats: { publicationId: pub.id, status: pub.status }, message: `${pub.status}${pub.wpUrl ? ` · ${pub.wpUrl}` : ''}` }; }
    catch (err) { if (err.retryable !== false && job.attempts >= job.maxAttempts) await publishing.giveUp(pl.publicationId, err); throw err; }
  }
  if (pl.batch) {
    const out = await publishing.submitPlan(pl.batch.items, pl.batch.siteId, { userId: job.userId, manual: true, now: ctx.now });
    return { status: out.rejected.length ? 'partial' : 'ok', stats: out, message: `${out.created.length} gönderim kuyruğa alındı${out.rejected.length ? `, ${out.rejected.length} makale reddedildi (${out.rejected[0].reason})` : ''}` };
  }
  const sync = await publishing.syncDue({ projectId: job.projectId, now: ctx.now, request: ctx.wpRequest });
  const cfg = (await settings.get('publishing', job.projectId)).value;
  if (!cfg.autoPublish || !cfg.siteId) return { status: sync.checked ? 'ok' : 'skipped', stats: { sync }, message: sync.checked ? `${sync.published} zamanlanmış yazı yayımlandı olarak güncellendi (otomatik yayın kapalı)` : 'Otomatik yayın kapalı; bekleyen zamanlanmış yazı yok' };
  const site = await sites.load(cfg.siteId).catch(() => null);
  if (!site || site.status !== 'active' || site.project_id !== job.projectId) return { status: 'skipped', stats: { sync }, message: 'Otomatik yayın için seçili site yok ya da duraklatılmış' };
  const perRun = (await getSchedule('content_publishing')).options.perRun || 2;
  const ready = (await db.query("SELECT a.id, a.h1 FROM articles a WHERE a.project_id = $1 AND a.status = 'ready' AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.article_id = a.id AND p.site_id = $2) ORDER BY a.quality_score DESC NULLS LAST, a.created_at LIMIT $3", [job.projectId, site.id, perRun])).rows;
  if (!ready.length) return { status: 'ok', stats: { sync }, message: 'Gönderilecek onaylı (“Yayına hazır”) makale yok' };
  const stats = { sync, sent: 0, rejected: [] };
  for (const a of ready) {
    try { const pub = await publishing.prepare(a.id, site.id, { mode: cfg.mode === 'publish' ? 'publish' : 'draft', manual: false, now: ctx.now }); await publishing.enqueue(pub.id, { trigger: 'schedule', now: ctx.now }); stats.sent++; }
    catch (err) { stats.rejected.push({ articleId: a.id, reason: err.message }); if ((err.extra && err.extra.limit) || (err.status === 409 && /limit/i.test(err.message))) break; }
  }
  return { status: stats.rejected.length ? 'partial' : 'ok', stats, message: `${stats.sent} makale ${cfg.mode === 'publish' ? 'yayına' : 'taslak olarak'} gönderime alındı${stats.rejected.length ? `; ${stats.rejected[0].reason}` : ''}` };
} };

// ── the tick: which bots are due ────────────────────────────────────────────────────────────────────────────────────
/** @returns { paused, enqueued: [{ bot, projectId, jobId }], moved: [bot] } */
async function tick({ now = new Date() } = {}) {
  const out = { paused: false, enqueued: [], moved: [] };
  if ((await settings.get('bots')).value.paused) { out.paused = true; return out; }
  const schedules = await loadSchedules(); let projects = null;
  for (const bot of SCHEDULABLE) {
    const s = schedules.get(bot);
    if (!s.enabled || (s.nextRunAt && new Date(s.nextRunAt) > now)) continue;
    if (!sched.inWindow(now, s)) { await saveSchedule(bot, { nextRunAt: sched.nextOpen(now, s) }); out.moved.push(bot); continue; }
    projects = projects || (await db.query("SELECT id FROM content_projects WHERE status = 'active' ORDER BY created_at")).rows;
    for (const p of projects) {
      if (GATES[bot] && !(await settings.get(GATES[bot], p.id)).value.enabled) continue;
      const q = await queue.enqueue({ botKey: bot, projectId: p.id, trigger: 'schedule', dedupeKey: `${bot}:${p.id}`, runAfter: now, maxAttempts: s.spends ? 1 : 3 });      // paid work is never retried on its own
      if (!q.duplicate) out.enqueued.push({ bot, projectId: p.id, jobId: q.job.id });
    }
    await saveSchedule(bot, { lastScheduledAt: now, nextRunAt: sched.nextRun(now, s.intervalMinutes, s) });
  }
  return out;
}

/** A person's "run once now": queued at once (before scheduled work), never a duplicate of a job that is already waiting or running. */
async function runNow(bot, projectId, { userId = null, now = new Date() } = {}) {
  if (!DEFAULTS[bot]) throw bad('Bu bot elle çalıştırılamaz');
  const p = (await db.query('SELECT id, status FROM content_projects WHERE id = $1', [V.uuid(projectId, 'Proje')])).rows[0];
  if (!p) throw new HttpError(404, 'Proje bulunamadı');
  const q = await queue.enqueue({ botKey: bot, projectId: p.id, trigger: 'manual', dedupeKey: `${bot}:${p.id}`, runAfter: now, maxAttempts: DEFAULTS[bot].spends ? 1 : 2, userId });
  if (q.duplicate) throw new HttpError(409, 'Bu bot için bir görev zaten kuyrukta ya da çalışıyor', { jobId: q.job && q.job.id });
  return q.job;
}

// ── the worker ────────────────────────────────────────────────────────────────────────────────────────────────────────
const WORKER_ID = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
const idempotent = (bot) => !!(HANDLERS[bot] && HANDLERS[bot].idempotent);

async function afterSuccess(job) {
  if (job.trigger === 'manual' || job.trigger === 'retry') return;
  const s = await getSchedule(job.botKey); if (s.failStreak) await saveSchedule(job.botKey, { failStreak: 0 });
}
async function afterFinalFailure(job, err) {
  if (job.payload && job.payload.publicationId) return;                 // a failed WordPress send has told the owner already (publishing.js), and one article never switches the bot off
  const label = (DEFAULTS[job.botKey] || {}).label || job.botKey;
  await notifications.create({ type: 'job_failed', severity: 'warning', title: `${label} görevi başarısız oldu`, body: `${String((err && err.message) || err).slice(0, 400)} (${job.attempts} deneme)`, data: { jobId: job.id, bot: job.botKey } });
  if (job.trigger !== 'schedule') return;                              // a person's own click failing does not switch a bot off
  const s = await getSchedule(job.botKey); const streak = s.failStreak + 1;
  if (streak >= FAIL_LIMIT) {
    await saveSchedule(job.botKey, { failStreak: streak, enabled: false, disabledReason: `Art arda ${streak} zamanlanmış görev başarısız oldu: ${String((err && err.message) || err).slice(0, 200)}` });
    await notifications.create({ type: 'bot_disabled', severity: 'critical', title: `${label} otomatik olarak kapatıldı`, body: `Art arda ${streak} görev başarısız oldu. Nedeni çözüp Bot Yönetimi’nden yeniden açın.`, data: { bot: job.botKey } });
  } else await saveSchedule(job.botKey, { failStreak: streak });
}

/** Runs ONE due job (if any). `ctx` carries the test seams (fetch for models/providers, page fetcher, news fetch). @returns the job that was handled, or null */
async function workOnce({ now = new Date(), ctx = {}, workerId = WORKER_ID } = {}) {
  await queue.recoverStale({ now, idempotent });
  const job = await queue.claim(workerId, { now });
  if (!job) return null;
  const h = HANDLERS[job.botKey];
  let result;
  try {
    if (!h) throw Object.assign(new Error(`Bilinmeyen bot: ${job.botKey}`), { fatal: true });
    if (job.projectId && !(await db.query("SELECT 1 FROM content_projects WHERE id = $1 AND status = 'active'", [job.projectId])).rows[0]) result = { status: 'skipped', message: 'Proje etkin değil' };
    else result = await h.run(job, { ...ctx, now: ctx.now || now });
  } catch (err) {
    const f = await queue.fail(job, err, { now });
    if (!f.retry) await afterFinalFailure(job, err);
    return { ...job, outcome: f.retry ? 'retry' : 'failed', error: err.message };
  }
  await queue.complete(job.id, { status: result.status === 'skipped' ? 'skipped' : 'done', result }, { now });
  await afterSuccess(job);
  return { ...job, outcome: result.status === 'skipped' ? 'skipped' : 'done', result };
}

// ── the loops ────────────────────────────────────────────────────────────────────────────────────────────────────────
const loop = { tick: null, work: null, busy: false, lastTickAt: null, lastWorkAt: null, lastError: null, started: false };
function start({ tickMs = 60000, workMs = 15000 } = {}) {
  if (loop.started) return false;
  loop.started = true;
  const guarded = (name, fn) => async () => {
    if (name === 'work' && loop.busy) return;
    try { if (name === 'work') loop.busy = true; await fn(); loop[`last${name === 'tick' ? 'Tick' : 'Work'}At`] = new Date(); loop.lastError = null; }
    catch (err) { loop.lastError = err.message; console.error(`[Content] scheduler ${name} failed:`, err.message); }
    finally { if (name === 'work') loop.busy = false; }
  };
  loop.tick = setInterval(guarded('tick', () => tick()), tickMs); loop.work = setInterval(guarded('work', async () => { for (let i = 0; i < 5; i++) { if (!(await workOnce())) break; } }), workMs);
  [loop.tick, loop.work].forEach((t) => t.unref && t.unref());
  return true;
}
function stop() { clearInterval(loop.tick); clearInterval(loop.work); loop.started = false; loop.busy = false; }
const status = () => ({ running: loop.started, lastTickAt: loop.lastTickAt, lastWorkAt: loop.lastWorkAt, lastError: loop.lastError, workerId: WORKER_ID });

module.exports = { DEFAULTS, SCHEDULABLE, FAIL_LIMIT, HANDLERS, loadSchedules, getSchedule, saveSchedule, updateSchedule, tick, runNow, workOnce, start, stop, status, idempotent };
