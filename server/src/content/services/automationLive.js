const db = require('../db');
const V = require('../lib/validate');
const settings = require('./settings');
const limits = require('./limits');
const scheduler = require('./scheduler');
const projects = require('./projects');
const sched = require('../lib/schedule');

/**
 * The live picture for the "Otomasyon Modu" page: which bots are working right now and on what, which wait in the queue, which are off or stopped and WHY,
 * what finished lately, and the size of the pipeline. It only READS (the queue `jobs`, the run log `automation_runs`, the schedules, the day's limits): nothing here
 * can start, stop or change anything, and it states nothing it cannot see (no run = "çalışma kaydı yok", not an invented time).
 * The panel asks for it every few seconds, so it is a handful of queries run side by side (every query costs a network round trip to the database).
 */
const DOING = {
  news_discovery: 'Haber kaynakları taranıyor', content_opportunity: 'Fırsatlar puanlanıyor', niche_discovery: 'Niş önerileri hesaplanıyor',
  keyword_research: 'Anahtar kelime verileri alınıyor (Apify)', seo_competition: 'Rakip sayfalar inceleniyor (Serper)', article_writer: 'Makale yazılıyor',
  content_publishing: 'WordPress’e gönderim sırası işleniyor', content_health: 'Eski makalelerin bağlantıları ve yeni gelişmeler kontrol ediliyor', content_refresh: 'Güncelleme taslağı hazırlanıyor',
  internal_linking: 'İç bağlantı fırsatları aranıyor', seo_performance: 'Search Console verisi alınıyor', adsense_compliance: 'Sitenin AdSense hazırlığı denetleniyor', reporting: 'Rapor hazırlanıyor',
};
const WRITER_STEP = { sources: 'Kaynaklar okunuyor', writing: 'Makale yazılıyor', image: 'Kapak görseli çiziliyor', checking: 'Zorunlu kontroller yapılıyor (doğruluk, AdSense, kalite)' };
const STATE_ORDER = ['running', 'queued', 'retry', 'waiting', 'paused', 'stopped', 'off'];

function doingText(bot, job, run) {
  if (bot === 'article_writer' && run && run.stats) { const step = WRITER_STEP[run.stats.step] || DOING.article_writer; return run.stats.idea ? `${step}: “${String(run.stats.idea).slice(0, 90)}”` : step; }
  if (bot === 'content_publishing' && job && job.payload && job.payload.publicationId) return 'Bir makale WordPress’e gönderiliyor';
  if (bot === 'content_publishing' && job && job.payload && job.payload.batch) return 'Toplu gönderim hazırlanıyor';
  if (bot === 'content_refresh' && job && job.payload && job.payload.articleId) return 'Seçilen makale için güncelleme taslağı hazırlanıyor';
  if (bot === 'adsense_compliance' && job && job.payload && (job.payload.url || job.payload.siteId)) return 'İstenen adres AdSense açısından denetleniyor';
  return DOING[bot] || 'Çalışıyor';
}

const jobMessage = (j) => (j.result && j.result.message) || j.last_error || '';
const jobOutcome = (j) => (j.status === 'failed' ? 'error' : j.status === 'skipped' ? 'skipped' : j.status === 'cancelled' ? 'cancelled' : (j.result && j.result.status === 'partial' ? 'partial' : 'ok'));
const runOutcome = (r) => (r.status === 'error' ? 'error' : r.status === 'partial' ? 'partial' : 'ok');
const sec = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));

async function live(projectId, { now = new Date() } = {}) {
  const pid = V.uuid(projectId, 'Proje'); await projects.getProject(pid);
  const since = new Date(now.getTime() - 24 * 3600 * 1000); const stale = new Date(now.getTime() - 30 * 60 * 1000);
  const [active, finished, lastJobs, runsOn, runsDone, schedules, botState, counts, lim] = await Promise.all([
    db.query("SELECT * FROM jobs WHERE project_id = $1 AND status IN ('queued', 'running') ORDER BY id", [pid]),
    db.query("SELECT * FROM jobs WHERE project_id = $1 AND status IN ('done', 'failed', 'skipped', 'cancelled') AND finished_at > $2 ORDER BY finished_at DESC LIMIT 40", [pid, since]),
    db.query("SELECT DISTINCT ON (bot_key) * FROM jobs WHERE project_id = $1 AND status IN ('done', 'failed', 'skipped') ORDER BY bot_key, finished_at DESC", [pid]),
    db.query("SELECT * FROM automation_runs WHERE status = 'running' AND started_at > $2 AND (project_id = $1 OR project_id IS NULL) ORDER BY id", [pid, stale]),
    db.query("SELECT * FROM automation_runs WHERE project_id = $1 AND status <> 'running' AND finished_at > $2 ORDER BY id DESC LIMIT 40", [pid, since]),
    scheduler.loadSchedules(), settings.get('bots'),
    db.query("SELECT status, count(*)::int AS n FROM articles WHERE project_id = $1 AND status IN ('generating', 'fact_checking', 'needs_review', 'ready', 'scheduled', 'needs_update') GROUP BY status", [pid]),
    limits.status({ projectId: pid, now }),
  ]);
  const paused = !!botState.value.paused;
  const jobsRunning = active.rows.filter((j) => j.status === 'running'); const jobsQueued = active.rows.filter((j) => j.status === 'queued');
  const lastOf = new Map(lastJobs.rows.map((j) => [j.bot_key, j]));
  const n = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));

  const bots = scheduler.SCHEDULABLE.map((key) => {
    const s = schedules.get(key); const job = jobsRunning.find((j) => j.bot_key === key); const run = runsOn.rows.find((r) => r.bot_key === key); const queued = jobsQueued.filter((j) => j.bot_key === key);
    const inWindow = sched.inWindow(now, s);
    let state; let note = null;
    if (job || run) state = 'running';
    else if (queued.length) { state = new Date(queued[0].run_after) > now ? 'retry' : 'queued'; if (state === 'retry') note = queued[0].last_error ? `Son deneme başarısız: ${queued[0].last_error}` : null; }
    else if (paused) state = 'paused';
    else if (!s.enabled) { state = s.disabledReason ? 'stopped' : 'off'; note = s.disabledReason || null; }
    else { state = 'waiting'; if (!inWindow) note = `Çalışma saati dışında (${s.windowStart}–${s.windowEnd})`; }
    const startedAt = (job && job.started_at) || (run && run.started_at) || null; const last = lastOf.get(key);
    return {
      key, label: s.label, state, enabled: !!s.enabled, spends: !!s.spends, note,
      doing: state === 'running' ? doingText(key, job, run) : null, startedAt, runningForSeconds: startedAt ? sec(startedAt, now) : null, trigger: (job && job.trigger) || (run && run.trigger) || null,
      queued: queued.length, retryAt: state === 'retry' ? queued[0].run_after : null,
      nextRunAt: s.enabled && !paused ? s.nextRunAt : null,
      last: last ? { at: last.finished_at, outcome: jobOutcome(last), message: jobMessage(last), trigger: last.trigger } : null,
      failStreak: s.failStreak || 0,
    };
  }).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));

  // the feed: finished jobs, plus finished runs nobody queued (a click on "Şimdi tara" is a run without a job); a run that belongs to a job is not shown twice
  const events = finished.rows.map((j) => ({ at: j.finished_at, bot: j.bot_key, label: (schedules.get(j.bot_key) || {}).label || j.bot_key, outcome: jobOutcome(j), message: jobMessage(j), trigger: j.trigger, seconds: j.started_at ? sec(j.started_at, j.finished_at) : null }));
  const jobStarts = finished.rows.map((j) => ({ bot: j.bot_key, t: new Date(j.started_at || j.created_at).getTime() }));
  for (const r of runsDone.rows) {
    const t = new Date(r.started_at).getTime();
    if (jobStarts.some((j) => j.bot === r.bot_key && Math.abs(j.t - t) < 120000)) continue;
    if (!schedules.has(r.bot_key)) continue;                                     // checks that belong to the writer (fact check, AdSense review) are part of its own line
    events.push({ at: r.finished_at, bot: r.bot_key, label: schedules.get(r.bot_key).label, outcome: runOutcome(r), message: r.error || (r.stats && r.stats.idea ? `“${String(r.stats.idea).slice(0, 90)}”` : 'Elle başlatılan çalıştırma tamamlandı'), trigger: r.trigger, seconds: sec(r.started_at, r.finished_at) });
  }
  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  const item = (t) => lim.items.find((i) => i.workType === t);
  const used = (t) => { const i = item(t); return { done: i.project ? i.project.done : i.done, limit: i.project ? i.project.limit : i.limit }; };
  return {
    now: now.toISOString(), paused, scheduler: scheduler.status(),
    summary: { running: bots.filter((b) => b.state === 'running').length, queued: bots.reduce((a, b) => a + b.queued, 0), enabled: bots.filter((b) => b.enabled).length, total: bots.length },
    pipeline: { writing: (n.generating || 0) + (n.fact_checking || 0), needsReview: n.needs_review || 0, ready: n.ready || 0, scheduled: n.scheduled || 0, needsUpdate: n.needs_update || 0 },
    today: { articles: used('new_article'), published: used('publish') },
    bots, events: events.slice(0, 15),
  };
}

module.exports = { live, DOING };
