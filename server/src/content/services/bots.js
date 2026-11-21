const db = require('../db');
const settings = require('./settings');
const { bad } = require('../lib/http');

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
const IMPLEMENTED = new Set();                                              // keys of bots whose code exists and runs (none in phase 1)

async function state() { return (await settings.get('bots')).value; }

async function list() {
  const rows = new Map((await db.query('SELECT * FROM schedule_settings')).rows.map((r) => [r.bot_key, r]));
  const st = await state();
  return {
    paused: st.paused, pausedAt: st.pausedAt, pausedBy: st.pausedBy,
    items: BOTS.map((b) => {
      const r = rows.get(b.key);
      return { ...b, implemented: IMPLEMENTED.has(b.key), enabled: r ? r.enabled : true, status: IMPLEMENTED.has(b.key) ? (st.paused ? 'paused' : 'idle') : 'planned', statusText: IMPLEMENTED.has(b.key) ? (st.paused ? 'Duraklatıldı' : 'Hazır') : `Aşama ${b.phase}’te gelecek`,
        lastRunAt: null, nextRunAt: null, processed: null, errors: null };
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
