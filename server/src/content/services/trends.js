const db = require('../db');
const { daysAgo, dayKey } = require('../lib/time');
const { env } = require('../env');

/**
 * Trend signals from REAL news data (no search data needed): how many different sources report an event, how many reports in the last 12 hours, how fresh it is.
 *   score = 40 x min(1, (sources - 1) / 4) + 35 x min(1, reports in 12 h / 5) + 25 x freshness      (freshness: 1 within 6 h, 0 after 48 h)
 * A single fresh report of an official announcement scores about 30; the same story in 5+ outlets within hours scores 80+.
 */
function trendScore({ sourceCount, recent12, lastSeenAt }, now = new Date()) {
  const hours = Math.max(0, (now - new Date(lastSeenAt)) / 3600000);
  const freshness = hours <= 6 ? 1 : hours >= 48 ? 0 : 1 - (hours - 6) / 42;
  const factors = [
    { key: 'sources', label: 'Haberi veren farklı kaynak', value: Math.round(40 * Math.min(1, (sourceCount - 1) / 4)), max: 40, note: `${sourceCount} kaynak` },
    { key: 'velocity', label: 'Son 12 saatteki haber sayısı', value: Math.round(35 * Math.min(1, recent12 / 5)), max: 35, note: `${recent12} haber` },
    { key: 'fresh', label: 'Tazelik', value: Math.round(25 * freshness), max: 25, note: hours < 1 ? 'az önce' : `${Math.round(hours)} saat önce` },
  ];
  const score = Math.min(100, factors.reduce((a, f) => a + f.value, 0));
  return { score, label: score >= 60 ? 'Yükseliyor' : score >= 30 ? 'İlgi var' : 'Zayıf', factors };
}

/** What the "Trend Analizi" page shows. */
async function overview(projectId, { hours = 48, now = new Date(), tz = env().defaultTimezone, limit = 30 } = {}) {
  const h = Math.min(168, Math.max(6, hours | 0 || 48));
  const rows = (await db.query(`SELECT c.*, k.name_en AS category_name,
      (SELECT count(*)::int FROM news_items i WHERE i.cluster_id = c.id AND coalesce(i.published_at, i.fetched_at) > $3::timestamptz - interval '12 hours') AS recent12
    FROM news_clusters c LEFT JOIN categories k ON k.id = c.category_id
    WHERE c.project_id = $1 AND c.status = 'relevant' AND c.last_seen_at > $3::timestamptz - ($2 || ' hours')::interval`, [projectId, String(h), now])).rows;
  const clusters = rows.map((c) => ({ id: c.id, title: c.title, categoryName: c.category_name, sourceCount: c.source_count, itemCount: c.item_count, recent12: c.recent12, reliability: c.reliability, lastSeenAt: c.last_seen_at, firstSeenAt: c.first_seen_at,
    ...trendScore({ sourceCount: c.source_count, recent12: c.recent12, lastSeenAt: c.last_seen_at }, now) })).sort((a, b) => b.score - a.score || b.sourceCount - a.sourceCount).slice(0, limit);
  const dayRows = (await db.query(`SELECT (coalesce(published_at, fetched_at) AT TIME ZONE $2)::date AS day, count(*)::int items, count(*) FILTER (WHERE status = 'relevant')::int relevant, count(DISTINCT cluster_id) FILTER (WHERE status = 'relevant')::int events
    FROM news_items WHERE project_id = $1 AND coalesce(published_at, fetched_at) > $3::timestamptz - interval '15 days' GROUP BY 1 ORDER BY 1`, [projectId, tz, now])).rows;
  const m = new Map(dayRows.map((r) => [String(r.day), r]));
  const daily = Array.from({ length: 14 }, (_, i) => { const d = daysAgo(13 - i, now, tz); const r = m.get(d); return { day: d, items: r ? r.items : 0, relevant: r ? r.relevant : 0, events: r ? r.events : 0 }; });
  const kw = (await db.query(`SELECT k.id, k.keyword, k.country, m.search_volume, m.trend_pct, m.fetched_at FROM keywords k
    JOIN LATERAL (SELECT * FROM keyword_metrics x WHERE x.keyword_id = k.id AND x.found ORDER BY x.fetched_at DESC LIMIT 1) m ON true
    WHERE k.project_id = $1 AND m.trend_pct IS NOT NULL ORDER BY m.trend_pct DESC LIMIT 15`, [projectId])).rows;
  const byCat = (await db.query(`SELECT coalesce(k.name_en, '—') AS name, count(*)::int n FROM news_clusters c LEFT JOIN categories k ON k.id = c.category_id
    WHERE c.project_id = $1 AND c.status = 'relevant' AND c.last_seen_at > $2::timestamptz - ($3 || ' hours')::interval GROUP BY 1 ORDER BY 2 DESC`, [projectId, now, String(h)])).rows;
  return { hours: h, today: dayKey(now, tz), clusters, daily, keywordTrends: kw.map((r) => ({ id: r.id, keyword: r.keyword, country: r.country, searchVolume: r.search_volume, trendPct: Number(r.trend_pct), fetchedAt: r.fetched_at })),
    byCategory: byCat, note: 'Haber trendi gerçek haber sayılarından hesaplanır. Anahtar kelime trendi yalnızca aylık arama geçmişi alındıysa (Apify verisi ya da dosya) görünür.' };
}

module.exports = { trendScore, overview };
