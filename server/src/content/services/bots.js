const db = require('../db');
const settings = require('./settings');
const runs = require('./runs');
const scheduler = require('./scheduler');
const queue = require('./queue');
const { bad } = require('../lib/http');
const { env } = require('../env');
const { startOfDay } = require('../lib/time');

/**
 * The 15 bots of the platform. This registry is the truth about what exists: `implemented` is true only for a bot whose code runs.
 * Phase 1 has no running bot (the engine, the queue and the scheduler arrive in phases 2 to 4); the page shows the plan honestly instead of
 * fake "last run" numbers. The one working control is the global pause switch, which the limits service already obeys.
 */
const BOTS = [
  { key: 'news_discovery', label: 'News Discovery Bot', phase: 2, about: 'Haber kaynaklarını ve dünya gündemini tarar, niş filtresinden geçirir.' },
  { key: 'trend_analysis', label: 'Trend Analysis Bot', phase: 2, about: 'Konuların yükselişini ve aranma eğilimini ölçer.' },
  { key: 'niche_discovery', label: 'Niche Discovery Bot', phase: 2, about: 'Yeni niş ve alt kategori fırsatlarını önerir (seçmez, yalnızca önerir).' },
  { key: 'keyword_research', label: 'Keyword Research Bot', phase: 2, about: 'DataForSEO ile gerçek aranma hacmi ve zorluk verisi toplar.' },
  { key: 'seo_competition', label: 'SEO Competition Bot', phase: 2, about: 'Google organik sonuçlarını ve rekabeti analiz eder.' },
  { key: 'content_opportunity', label: 'Content Opportunity Bot', phase: 2, about: 'İçerik fırsatlarını puanlar ve sıralar.' },
  { key: 'article_writer', label: 'AI Article Writer', phase: 3, about: 'Seçilen fırsattan kaynaklı, İngilizce makale yazar.' },
  { key: 'fact_checking', label: 'Fact Checking Bot', phase: 3, about: 'İddiaları kaynaklarla doğrular.' },
  { key: 'adsense_compliance', label: 'AdSense Compliance Bot', phase: 3, about: 'AdSense politika riskini denetler.' },
  { key: 'content_publishing', label: 'Content Publishing Bot', phase: 5, about: 'Hazır makaleleri WordPress sitelerine gönderir.' },
  { key: 'content_refresh', label: 'Content Refresh Bot', phase: 6, about: 'Yayımlanmış makaleleri anlamlı değişiklik varsa günceller.' },
  { key: 'content_health', label: 'Content Health Bot', phase: 6, about: 'Eski makalelerin sağlığını düzenli kontrol eder.' },
  { key: 'internal_linking', label: 'Internal Linking Bot', phase: 6, about: 'İç bağlantı fırsatlarını bulur.' },
  { key: 'seo_performance', label: 'SEO Performance Bot', phase: 6, about: 'Search Console verisiyle performansı izler.' },
  { key: 'reporting', label: 'Reporting Bot', phase: 7, about: 'Günlük/haftalık raporlar üretir.' },
];
/** keys of bots whose code exists and runs. Six of them are scheduled by services/scheduler.js (the others run as part of the writer or on demand). */
const IMPLEMENTED = new Set(['news_discovery', 'trend_analysis', 'niche_discovery', 'keyword_research', 'seo_competition', 'content_opportunity', 'article_writer', 'fact_checking', 'adsense_compliance', 'content_publishing']);
const MANUAL_NOTE = { trend_analysis: 'Haber verisinden anlık hesaplanır (ayrı çalıştırma gerekmez)', fact_checking: 'Makale yazılırken ve “Tüm kontroller” ile çalışır', adsense_compliance: 'Makale yazılırken ve “Tüm kontroller” ile çalışır' };

async function state() { return (await settings.get('bots')).value; }

async function list() {
  const st = await state();
  const last = await runs.lastByBot();
  const schedules = await scheduler.loadSchedules();
  const waiting = new Map((await db.query("SELECT bot_key, count(*) FILTER (WHERE status = 'queued')::int AS queued, count(*) FILTER (WHERE status = 'running')::int AS running FROM jobs WHERE status IN ('queued', 'running') GROUP BY bot_key")).rows.map((r) => [r.bot_key, r]));
  const cost = new Map((await db.query(`SELECT bot_key, COALESCE(sum((stats->>'costUsd')::numeric), 0) AS usd, count(*) FILTER (WHERE stats ? 'unknownCost' AND (stats->>'unknownCost')::int > 0)::int AS unknown
    FROM automation_runs WHERE started_at >= $1 GROUP BY bot_key`, [startOfDay(new Date(), env().defaultTimezone)])).rows.map((r) => [r.bot_key, r]));
  return {
    paused: st.paused, pausedAt: st.pausedAt, pausedBy: st.pausedBy, scheduler: scheduler.status(),
    items: BOTS.map((b) => {
      const l = last.get(b.key); const impl = IMPLEMENTED.has(b.key); const sc = schedules.get(b.key); const w = waiting.get(b.key); const c = cost.get(b.key);
      const every = (m) => (m % 1440 === 0 ? `${m / 1440} günde bir` : m % 60 === 0 ? `${m / 60} saatte bir` : `${m} dakikada bir`);
      const statusText = !impl ? `Aşama ${b.phase}’te gelecek` : st.paused ? 'Duraklatıldı'
        : sc ? (sc.enabled ? `Otomatik: ${every(sc.intervalMinutes)}${sc.windowStart ? ` (${sc.windowStart}–${sc.windowEnd})` : ''}` : (sc.disabledReason ? 'Otomatik kapatıldı (hatalar)' : 'Otomatik kapalı; elle çalıştırılır'))
          : (MANUAL_NOTE[b.key] || 'Başka bir botun parçası; onunla birlikte çalışır');
      return { ...b, implemented: impl, scheduled: !!sc, manualOnly: impl && !sc, enabled: sc ? sc.enabled : true, status: !impl ? 'planned' : st.paused ? 'paused' : (sc && sc.enabled ? 'scheduled' : 'idle'), statusText,
        schedule: sc ? { enabled: sc.enabled, intervalMinutes: sc.intervalMinutes, windowStart: sc.windowStart, windowEnd: sc.windowEnd, weekdaysOnly: sc.weekdaysOnly, timezone: sc.timezone, options: sc.options, spends: sc.spends, failStreak: sc.failStreak, disabledReason: sc.disabledReason } : null,
        lastRunAt: l ? l.finishedAt : null, lastRunStatus: l ? l.status : null, nextRunAt: sc && sc.enabled && !st.paused ? sc.nextRunAt : null, processed: l ? l.runs : (impl ? 0 : null), errors: l ? l.errors : (impl ? 0 : null),
        queued: w ? w.queued : 0, running: w ? w.running : 0, costTodayUsd: c ? Number(c.usd) : (impl ? 0 : null), costUnknownRuns: c ? c.unknown : 0 };
    }),
  };
}

/** Pause / resume all automatic work (a person's own manual work is not stopped, see limits.reserve). */
async function setPaused(paused, { userId = null, email = null } = {}) {
  if (typeof paused !== 'boolean') throw bad('Açık/kapalı (true/false) olmalı');
  await settings.set('bots', { paused, pausedAt: paused ? new Date().toISOString() : null, pausedBy: paused ? email : null }, { userId });
  return list();
}

module.exports = { BOTS, list, setPaused, IMPLEMENTED };
