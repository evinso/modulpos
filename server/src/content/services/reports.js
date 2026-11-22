const db = require('../db');
const V = require('../lib/validate');
const { env } = require('../env');
const { HttpError, bad } = require('../lib/http');
const { dayKey, daysAgo, startOfLocalDay } = require('../lib/time');
const projects = require('./projects');
const notifications = require('./notifications');

/**
 * Daily and weekly reports (phase 7). A report is the numbers of whole LOCAL days (the project's time zone) measured when the report is made and then stored as it was: it is
 * never recomputed, so an old report keeps saying what was true then.
 *  - daily  = yesterday; weekly = the 7 days before today (the weekly one is made on Mondays by the bot, by hand any day)
 *  - every number is counted from rows with a time stamp inside the period; a number that cannot be measured is { available: false } or null, never 0
 *  - costs: only what the providers reported; calls without a price are COUNTED ("maliyeti bilinmiyor"), never added as 0; usage with no project is shown apart
 *  - Search Console numbers are the last 7 days Google had FINAL data for (they lag 3 days), and are left out when no site is connected
 */
const KINDS = ['daily', 'weekly'];
const MICROS = 1e6;
const KEEP_DAYS = { daily: 100, weekly: 400 };
const mon = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const usd = (v) => `$${Number(v).toFixed(2)}`;
const n = (v) => new Intl.NumberFormat('tr-TR').format(v);

function period(kind, now, tz) {
  const days = kind === 'weekly' ? 7 : 1;
  const dayFrom = daysAgo(days, now, tz); const dayTo = daysAgo(1, now, tz);
  return { dayFrom, dayTo, start: startOfLocalDay(dayFrom, tz), end: startOfLocalDay(dayKey(now, tz), tz) };
}

/** the measured sections for one project and period (no writing) */
async function measure(projectId, { start, end, kind }, { now = new Date(), tz = env().defaultTimezone } = {}) {
  const q = async (sql, extra = []) => (await db.query(sql, [projectId, start, end, ...extra])).rows;
  const one = async (sql, extra) => (await q(sql, extra))[0];
  const a = await one("SELECT count(*)::int created, count(*) FILTER (WHERE created_by = 'ai')::int ai FROM articles WHERE project_id = $1 AND created_at >= $2 AND created_at < $3");
  const snap = Object.fromEntries((await db.query("SELECT status, count(*)::int n FROM articles WHERE project_id = $1 AND status <> 'archived' GROUP BY status", [projectId])).rows.map((r) => [r.status, r.n]));
  const risk = await db.query("SELECT count(*) FILTER (WHERE adsense_risk = 'review')::int review, count(*) FILTER (WHERE adsense_risk = 'blocked')::int blocked FROM articles WHERE project_id = $1 AND status <> 'archived'", [projectId]);
  const pubs = Object.fromEntries((await q('SELECT status, count(*)::int n FROM publications WHERE project_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY status')).map((r) => [r.status, r.n]));
  const wentPublic = (await one("SELECT count(*)::int n FROM publications WHERE project_id = $1 AND published_at >= $2 AND published_at < $3")).n;
  const failedSends = (await one("SELECT count(*)::int n FROM publications WHERE project_id = $1 AND status = 'failed' AND updated_at >= $2 AND updated_at < $3")).n;
  const props = await q('SELECT kind, status, count(*)::int n FROM refresh_proposals WHERE project_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY kind, status');
  const applied = (await one("SELECT count(*)::int n FROM refresh_proposals WHERE project_id = $1 AND status = 'applied' AND updated_at >= $2 AND updated_at < $3")).n;
  const openProps = (await db.query("SELECT count(*)::int n FROM refresh_proposals WHERE project_id = $1 AND status = 'proposed'", [projectId])).rows[0].n;
  const links = (await one("SELECT count(*)::int n FROM internal_links WHERE project_id = $1 AND status = 'applied' AND updated_at >= $2 AND updated_at < $3")).n;
  const jobs = await q("SELECT bot_key, status, count(*)::int n FROM jobs WHERE project_id = $1 AND finished_at >= $2 AND finished_at < $3 GROUP BY bot_key, status");
  const failedJobs = await q("SELECT bot_key, last_error, finished_at FROM jobs WHERE project_id = $1 AND status = 'failed' AND finished_at >= $2 AND finished_at < $3 ORDER BY finished_at DESC LIMIT 5");
  const news = await one("SELECT count(*)::int items, count(*) FILTER (WHERE status = 'relevant')::int relevant FROM news_items WHERE project_id = $1 AND fetched_at >= $2 AND fetched_at < $3");
  const kw = (await one('SELECT count(*)::int n FROM keywords WHERE project_id = $1 AND created_at >= $2 AND created_at < $3')).n;
  const serp = (await one('SELECT count(*)::int n FROM serp_analyses WHERE project_id = $1 AND fetched_at >= $2 AND fetched_at < $3')).n;
  const opp = (await one('SELECT count(*)::int n FROM content_opportunities WHERE project_id = $1 AND created_at >= $2 AND created_at < $3')).n;
  const usage = await db.query(`SELECT provider, COALESCE(sum(cost_micros), 0)::bigint micros, COALESCE(sum(requests), 0)::int requests, count(*) FILTER (WHERE cost_micros IS NULL AND result = 'ok')::int unknown,
      count(*) FILTER (WHERE result = 'error')::int errors, count(*) FILTER (WHERE result = 'blocked_budget')::int blocked, project_id IS NOT NULL AS attributed
    FROM api_usage WHERE created_at >= $2 AND created_at < $3 AND (project_id = $1 OR project_id IS NULL) GROUP BY provider, attributed ORDER BY provider`, [projectId, start, end]);
  const costOf = (rows) => ({ costUsd: rows.reduce((s, r) => s + Number(r.micros), 0) / MICROS, unknownCalls: rows.reduce((s, r) => s + r.unknown, 0), requests: rows.reduce((s, r) => s + r.requests, 0), blockedByBudget: rows.reduce((s, r) => s + r.blocked, 0),
    providers: rows.map((r) => ({ provider: r.provider, costUsd: Number(r.micros) / MICROS, requests: r.requests, unknownCalls: r.unknown, errors: r.errors })) });
  const notable = await q("SELECT type, severity, title, created_at FROM notifications WHERE created_at >= $2 AND created_at < $3 AND severity IN ('warning', 'critical') AND type NOT IN ('report_ready') AND ($1::uuid IS NOT NULL) ORDER BY created_at DESC LIMIT 10");

  const searchconsole = require('./searchconsole');
  const sites = (await db.query("SELECT id, name, api_url, gsc_property, gsc_synced_at FROM wp_sites WHERE project_id = $1 AND status = 'active' ORDER BY created_at", [projectId])).rows;
  const seo = [];
  for (const s of sites) {
    if (!s.gsc_property || !s.gsc_synced_at) { seo.push({ site: s.name, available: false, note: s.gsc_property ? 'Search Console verisi henüz çekilmedi' : 'Search Console bağlı değil' }); continue; }
    const p = await searchconsole.performance(s.id, { days: 7, now }).catch(() => null);
    seo.push(p && p.current ? { site: s.name, available: true, through: p.through, clicks: p.current.clicks, impressions: p.current.impressions, clicksChangePct: p.change.clicksPct, impressionsChangePct: p.change.impressionsPct, position: p.current.position } : { site: s.name, available: false, note: 'Henüz veri yok' });
  }
  const adsense = (await db.query("SELECT DISTINCT ON (url) url, verdict, summary, started_at FROM adsense_audits WHERE project_id = $1 AND status = 'done' ORDER BY url, started_at DESC", [projectId])).rows
    .map((r) => ({ url: r.url, verdict: r.verdict, requiredMissing: r.summary ? r.summary.requiredMissing.length : null, warnings: r.summary ? r.summary.warning : null, at: r.started_at }));

  const jobTotals = { done: 0, skipped: 0, failed: 0 }; for (const r of jobs) if (jobTotals[r.status] !== undefined) jobTotals[r.status] += r.n;
  const usageRows = usage.rows;
  return {
    articles: { created: a.created, aiDrafts: a.ai, now: { ready: snap.ready || 0, awaitingReview: (snap.needs_review || 0) + (snap.fact_checking || 0), published: snap.published || 0, scheduled: snap.scheduled || 0, needsUpdate: snap.needs_update || 0 }, adsenseRisky: { review: risk.rows[0].review, blocked: risk.rows[0].blocked } },
    publishing: { sends: pubs, wentPublic, failedSends },
    updates: { proposals: props.map((r) => ({ kind: r.kind, status: r.status, n: r.n })), applied, openNow: openProps, internalLinksApplied: links },
    jobs: { ...jobTotals, byBot: jobs.map((r) => ({ bot: r.bot_key, status: r.status, n: r.n })), failures: failedJobs.map((r) => ({ bot: r.bot_key, error: String(r.last_error || '').slice(0, 160), at: r.finished_at })) },
    research: { newsItems: news.items, newsRelevant: news.relevant, keywordsAdded: kw, serpAnalyses: serp, opportunitiesFound: opp },
    cost: { project: costOf(usageRows.filter((r) => r.attributed)), unattributed: costOf(usageRows.filter((r) => !r.attributed)), note: 'Projeye bağlanamayan çağrılar (ör. bağlantı testleri) ayrı gösterilir; fiyatı olmayan çağrıların maliyeti “bilinmiyor”dur ve toplama katılmaz.' },
    seo: { sites: seo, note: 'Search Console 2-3 gün geriden gelir: son 7 günün KESİNLEŞMİŞ verisidir.' },
    adsense: { sites: adsense, note: 'Site denetimi bir kontrol listesidir, onay değildir.' },
    notable: notable.map((r) => ({ type: r.type, severity: r.severity, title: r.title, at: r.created_at })),
    kind, timezone: tz,
  };
}

function render(project, kind, dayFrom, dayTo, d) {
  const head = `${kind === 'weekly' ? '🗓 Haftalık rapor' : '📅 Günlük rapor'} — ${kind === 'weekly' ? `${mon(dayFrom)} – ${mon(dayTo)}` : mon(dayTo)} (${project.name})`;
  const L = [head];
  const a = d.articles; L.push(`Makaleler: ${a.created} yeni taslak (${a.aiDrafts} yapay zekâ), ${d.publishing.wentPublic} tanesi sitede yayına çıktı. Şu an: ${a.now.awaitingReview} onay/kontrol bekliyor, ${a.now.ready} hazır, ${a.now.published} yayında, ${a.now.needsUpdate} güncelleme bekliyor.`);
  const pr = d.updates.proposals.reduce((s, r) => s + r.n, 0); L.push(`Güncellemeler: ${pr} taslak hazırlandı, ${d.updates.applied} uygulandı, ${d.updates.openNow} onay bekliyor; ${d.updates.internalLinksApplied} iç bağlantı eklendi.`);
  L.push(`Görevler: ${d.jobs.done} tamam, ${d.jobs.skipped} atlandı, ${d.jobs.failed} başarısız${d.jobs.failures[0] ? ` (örn. ${d.jobs.failures[0].bot}: ${d.jobs.failures[0].error})` : ''}.${d.publishing.failedSends ? ` ${d.publishing.failedSends} WordPress gönderimi başarısız.` : ''}`);
  const r = d.research; L.push(`Araştırma: ${n(r.newsItems)} haber (${n(r.newsRelevant)} nişe uygun), ${r.keywordsAdded} yeni anahtar kelime, ${r.serpAnalyses} SERP analizi, ${r.opportunitiesFound} yeni fırsat.`);
  const c = d.cost.project; const u = d.cost.unattributed;
  L.push(`Maliyet: ${usd(c.costUsd)}${c.unknownCalls ? ` (+${c.unknownCalls} çağrının maliyeti bilinmiyor)` : ''}${c.providers.filter((p) => p.costUsd > 0).length ? ` — ${c.providers.filter((p) => p.costUsd > 0).map((p) => `${p.provider} ${usd(p.costUsd)}`).join(', ')}` : ''}${u.requests ? `; projeye bağlanamayan ${usd(u.costUsd)}${u.unknownCalls ? ` (+${u.unknownCalls} bilinmiyor)` : ''}` : ''}${c.blockedByBudget + u.blockedByBudget ? `; bütçe ${c.blockedByBudget + u.blockedByBudget} çağrıyı durdurdu` : ''}.`);
  for (const s of d.seo.sites) L.push(s.available ? `SEO (${s.site}, ${mon(s.through)} gününe kadar son 7 gün): ${n(s.clicks)} tıklama${s.clicksChangePct === null ? '' : ` (${s.clicksChangePct > 0 ? '+' : ''}${s.clicksChangePct}%)`}, ${n(s.impressions)} gösterim.` : `SEO (${s.site}): veri yok — ${s.note}.`);
  for (const s of d.adsense.sites.slice(0, 3)) L.push(`AdSense site denetimi: ${s.url.replace(/^https?:\/\//, '')} — ${({ unreachable: 'okunamadı', not_ready: 'eksikler var', almost: 'uyarılar var', checks_clean: 'otomatik kontroller temiz' })[s.verdict] || '—'}${s.requiredMissing ? ` (${s.requiredMissing} zorunlu eksik)` : ''}.`);
  if (a.adsenseRisky.review || a.adsenseRisky.blocked) L.push(`AdSense makale riski: ${a.adsenseRisky.blocked} yayınlanamaz, ${a.adsenseRisky.review} inceleme gerekli.`);
  if (d.notable.length) { L.push('Dikkat:'); for (const x of d.notable.slice(0, 5)) L.push(`• ${x.severity === 'critical' ? '🔴' : '⚠️'} ${x.title}`); }
  return L.join('\n');
}

const shape = (r, withData = true) => ({ id: r.id, projectId: r.project_id, kind: r.kind, dayFrom: r.day_from, dayTo: r.day_to, timezone: r.timezone, trigger: r.trigger, createdAt: r.created_at, ...(withData ? { data: r.data, body: r.body } : {}) });

/**
 * Makes (or remakes) the report of the latest complete period and stores it. `announce` writes the "report ready" notification (the scheduled pass does; a remake by hand does not).
 * @returns the stored report
 */
async function generate(projectId, kind, { now = new Date(), userId = null, trigger = 'manual', announce = false, tz = env().defaultTimezone } = {}) {
  V.oneOf(kind, 'Rapor türü', KINDS);
  const p = await projects.getProject(V.uuid(projectId, 'Proje'));
  const per = period(kind, now, tz); const data = await measure(p.id, { ...per, kind }, { now, tz });
  const body = render(p, kind, per.dayFrom, per.dayTo, data);
  const row = (await db.query(`INSERT INTO reports (project_id, kind, period_start, period_end, day_from, day_to, timezone, data, body, trigger, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (project_id, kind, period_start) DO UPDATE SET data = $8, body = $9, trigger = $10, created_by = $11, created_at = now() RETURNING *, (xmax = 0) AS inserted`,
  [p.id, kind, per.start, per.end, per.dayFrom, per.dayTo, tz, JSON.stringify(data), body, trigger === 'schedule' ? 'schedule' : 'manual', userId])).rows[0];
  await db.query("DELETE FROM reports WHERE project_id = $1 AND kind = $2 AND period_start < $3", [p.id, kind, new Date(now.getTime() - KEEP_DAYS[kind] * 86400000)]);
  if (announce && row.inserted) await notifications.create({ type: 'report_ready', severity: 'info', title: `${kind === 'weekly' ? 'Haftalık' : 'Günlük'} rapor hazır: ${p.name}`, body: body.split('\n').slice(1, 5).join('\n'), data: { reportId: row.id, kind } });
  return shape(row);
}

/** the scheduled pass: yesterday's daily report if it is missing, and the weekly one on Mondays (local) if it is missing */
async function generateDue(projectId, { now = new Date(), tz = env().defaultTimezone, userId = null, trigger = 'schedule' } = {}) {
  const made = []; const skipped = [];
  const exists = async (kind) => (await db.query('SELECT 1 FROM reports WHERE project_id = $1 AND kind = $2 AND period_start = $3', [projectId, kind, period(kind, now, tz).start])).rows[0];
  for (const kind of KINDS) {
    const monday = new Date(`${dayKey(now, tz)}T12:00:00Z`).getUTCDay() === 1;
    if (kind === 'weekly' && !monday) { skipped.push('weekly: bugün pazartesi değil'); continue; }
    if (await exists(kind)) { skipped.push(`${kind}: zaten var`); continue; }
    made.push(await generate(projectId, kind, { now, tz, userId, trigger, announce: true }));
  }
  return { made, skipped };
}

async function list(projectId, { kind = null, limit = 30 } = {}) {
  const p = [V.uuid(projectId, 'Proje')]; let w = '';
  if (kind) { p.push(V.oneOf(kind, 'Rapor türü', KINDS)); w = ' AND kind = $2'; }
  return (await db.query(`SELECT * FROM reports WHERE project_id = $1${w} ORDER BY period_start DESC, kind LIMIT ${Math.min(100, Math.max(1, limit | 0 || 30))}`, p)).rows.map((r) => shape(r, false));
}
async function get(id) {
  const r = (await db.query('SELECT * FROM reports WHERE id = $1', [V.uuid(id, 'Rapor')])).rows[0];
  if (!r) throw new HttpError(404, 'Rapor bulunamadı');
  return shape(r);
}
async function latest(projectId, kind = null) {
  const r = (await db.query(`SELECT * FROM reports WHERE project_id = $1 ${kind ? 'AND kind = $2' : ''} ORDER BY period_start DESC, created_at DESC LIMIT 1`, kind ? [projectId, kind] : [projectId])).rows[0];
  return r ? shape(r) : null;
}

module.exports = { KINDS, period, measure, render, generate, generateDue, list, get, latest, bad };
