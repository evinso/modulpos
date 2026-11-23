const db = require('../db');
const settings = require('./settings');
const runs = require('./runs');
const scheduler = require('./scheduler');
const queue = require('./queue');
const { bad } = require('../lib/http');
const { env } = require('../env');
const { startOfDay } = require('../lib/time');

/**
 * The 16 bots of the platform. This registry is the truth about what exists: `implemented` is true only for a bot whose code runs (all 16 do now).
 * A bot that had no code would be listed as "Henüz çalışmıyor" with no last-run numbers (never invented ones). The global pause switch stops all of them.
 */
const BOTS = [
  { key: 'news_discovery', label: 'News Discovery Bot', about: 'Haber kaynaklarını ve dünya gündemini tarar, niş filtresinden geçirir.' },
  { key: 'trend_analysis', label: 'Trend Analysis Bot', about: 'Konuların yükselişini ve aranma eğilimini ölçer.' },
  { key: 'niche_discovery', label: 'Niche Discovery Bot', about: 'Yeni niş ve alt kategori fırsatlarını önerir (seçmez, yalnızca önerir).' },
  { key: 'keyword_research', label: 'Keyword Research Bot', about: 'Apify üzerinden gerçek Google aranma hacmi, CPC ve zorluk verisi toplar (ücretsiz aylık kredi; yoksa dosyadan aktarma).' },
  { key: 'seo_competition', label: 'SEO Competition Bot', about: 'Google organik sonuçlarını ve rekabeti analiz eder.' },
  { key: 'content_opportunity', label: 'Content Opportunity Bot', about: 'İçerik fırsatlarını puanlar ve sıralar.' },
  { key: 'article_writer', label: 'AI Article Writer', about: 'Seçilen fırsattan kaynaklı, İngilizce makale yazar.' },
  { key: 'fact_checking', label: 'Fact Checking Bot', about: 'İddiaları kaynaklarla doğrular.' },
  { key: 'adsense_compliance', label: 'AdSense Compliance Bot', about: 'Makalelerin AdSense politika riskini denetler (yazarken) ve haftada bir WordPress sitelerinin AdSense hazırlığını denetler.' },
  { key: 'article_fixer', label: 'Article Fixer Bot', about: 'Yayına hazır olmayan yapay zekâ makalelerinin eksiklerini giderir (kontrolleri yeniden çalıştırır, görsel/kategori ekler, metni kaynaklara göre düzeltir) ve temiz geçerse onay kapısına sunar.' },
  { key: 'content_publishing', label: 'Content Publishing Bot', about: 'Hazır makaleleri WordPress sitelerine gönderir.' },
  { key: 'content_refresh', label: 'Content Refresh Bot', about: 'Yayımlanmış makaleleri anlamlı değişiklik varsa günceller.' },
  { key: 'content_health', label: 'Content Health Bot', about: 'Eski makalelerin sağlığını düzenli kontrol eder.' },
  { key: 'internal_linking', label: 'Internal Linking Bot', about: 'İç bağlantı fırsatlarını bulur.' },
  { key: 'seo_performance', label: 'SEO Performance Bot', about: 'Search Console verisiyle performansı izler.' },
  { key: 'reporting', label: 'Reporting Bot', about: 'Her sabah önceki günün, pazartesileri önceki haftanın raporunu üretir ve bildirir.' },
];
/** keys of bots whose code exists and runs. Six of them are scheduled by services/scheduler.js (the others run as part of the writer or on demand). */
const IMPLEMENTED = new Set(['news_discovery', 'trend_analysis', 'niche_discovery', 'keyword_research', 'seo_competition', 'content_opportunity', 'article_writer', 'article_fixer', 'fact_checking', 'adsense_compliance', 'content_publishing', 'content_health', 'content_refresh', 'seo_performance', 'internal_linking', 'reporting']);
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
      const statusText = !impl ? 'Henüz çalışmıyor' : st.paused ? 'Duraklatıldı'
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
