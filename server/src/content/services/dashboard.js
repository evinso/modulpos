const db = require('../db');
const V = require('../lib/validate');
const { env } = require('../env');
const { daysAgo } = require('../lib/time');
const articles = require('./articles');
const limits = require('./limits');
const providers = require('./providers');
const notifications = require('./notifications');
const bots = require('./bots');
const projects = require('./projects');

/**
 * The dashboard. REAL numbers only: a figure whose source is built in a later phase (news found today, keywords, organic traffic ...) is reported as
 * { available: false, phase: N } and the screen says so; it is never shown as 0 (which would look like "measured, nothing found").
 */
const later = (key, label, phase) => ({ key, label, value: null, available: false, phase });

async function build({ projectId = null, days = 30, tz = env().defaultTimezone, now = new Date() } = {}) {
  const pid = projectId ? V.uuid(projectId, 'Proje') : null;
  if (pid) await projects.getProject(pid);
  const d = Math.min(90, Math.max(7, days | 0 || 30));
  const [c, st, usage, notes, botList, projectList] = await Promise.all([
    articles.counts(pid, { tz, days: d }), limits.status({ projectId: pid, tz, now }), providers.usageReport({ days: d, tz, now, limit: 1 }), notifications.list({ unreadOnly: true, limit: 5 }), bots.list(), projects.listProjects(),
  ]);
  const w = pid ? 'WHERE project_id = $1' : ''; const p = pid ? [pid] : [];
  const ai = (await db.query(`SELECT count(*)::int n FROM articles ${w ? `${w} AND` : 'WHERE'} created_by = 'ai'`, p)).rows[0].n;
  const updates = (await db.query(`SELECT (v.created_at AT TIME ZONE $${p.length + 2})::date AS day, count(*)::int n FROM article_versions v JOIN articles a ON a.id = v.article_id
    WHERE v.version > 1 AND v.created_at >= now() - ($${p.length + 1} || ' days')::interval ${pid ? 'AND a.project_id = $1' : ''} GROUP BY 1 ORDER BY 1`, [...p, String(d), tz])).rows;
  const day = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x));
  const today = limits.TYPES.map((t) => st.items.find((i) => i.workType === t)).filter(Boolean).map((i) => ({ workType: i.workType, label: i.label, limit: i.limit, done: i.done, remaining: i.remaining, project: i.project }));
  return {
    generatedAt: now.toISOString(), day: st.day, timezone: tz, projectId: pid, days: d,
    projects: projectList.map((x) => ({ id: x.id, name: x.name, mode: x.mode, domain: x.domain, mainNiche: x.mainNiche })),
    metrics: [
      later('news_found', 'Günlük bulunan haber', 2), later('news_matching', 'Nişe uygun haber', 2), later('keywords', 'Keşfedilen anahtar kelime', 2), later('seo_analyzed', 'SEO analizi tamamlanan konu', 2),
      { key: 'generated', label: 'Üretilen makale (AI)', value: ai, available: true },
      { key: 'awaiting', label: 'Onay bekleyen', value: c.status.needs_review, available: true },
      { key: 'archived', label: 'Arşivdeki makale', value: c.status.archived, available: true },
      { key: 'published', label: 'Yayımlanan', value: c.status.published, available: true },
      { key: 'needs_update', label: 'Güncelleme bekleyen', value: c.status.needs_update, available: true },
      { key: 'adsense_risky', label: 'AdSense riskli içerik', value: c.adsenseRisky, available: true },
      { key: 'active_bots', label: 'Çalışan bot', value: botList.items.filter((b) => b.implemented && b.enabled && !botList.paused).length, available: true, note: botList.paused ? 'Botlar duraklatıldı' : `${botList.items.length} botun ${botList.items.filter((b) => b.implemented).length}’i hazır` },
      { key: 'failed', label: 'Başarısız makale/görev', value: c.status.failed, available: true },
      { key: 'cost_today', label: 'Günlük API maliyeti (USD)', value: usage.today.costUsd, available: true, unknownCalls: usage.today.unknownCalls },
      { key: 'cost_month', label: 'Aylık API maliyeti (USD)', value: usage.month.costUsd, available: true, unknownCalls: usage.month.unknownCalls },
    ],
    articles: { total: c.total, status: c.status },
    charts: {
      dailyProduction: fill(c.daily.map((x) => ({ day: day(x.day), value: x.count })), d, tz, now),
      categoryShare: c.categories,
      articleUpdates: fill(updates.map((x) => ({ day: day(x.day), value: x.n })), d, tz, now),
      apiCosts: fill(sumByDay(usage.daily), d, tz, now),
      seoOpportunities: { available: false, phase: 2 }, searchVolume: { available: false, phase: 2 }, organicTraffic: { available: false, phase: 6 },
    },
    limitsToday: today, notifications: { unread: notes.unread, latest: notes.items }, botsPaused: botList.paused,
    empty: c.total === 0,
  };
}

function sumByDay(rows) { const m = new Map(); for (const r of rows) m.set(r.day, (m.get(r.day) || 0) + r.costUsd); return [...m].map(([day, value]) => ({ day, value })); }

/** One entry per day for the last `d` days (0 where nothing happened: that IS a real 0 for these series). */
function fill(rows, d, tz, now) {
  const m = new Map(rows.map((r) => [r.day, r.value]));
  return Array.from({ length: d }, (_, i) => { const k = daysAgo(d - 1 - i, now, tz); return { day: k, value: m.get(k) || 0 }; });
}

module.exports = { build };
