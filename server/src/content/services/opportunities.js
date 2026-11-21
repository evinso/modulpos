const db = require('../db');
const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const { dayKey } = require('../lib/time');
const { env } = require('../env');
const settings = require('./settings');
const limits = require('./limits');
const runs = require('./runs');
const keywords = require('./keywords');
const trends = require('./trends');
const projects = require('./projects');

/**
 * Content opportunities: one scored idea per topic (a topic is usually one relevant news event).
 *   score (0-100) = trend x 30% + organic-competition opportunity x 25% + search demand x 20% + niche relevance x 15% + source reliability x 10%   (weights: settings "scoring")
 *  - trend        news velocity (real counts) or the keyword's own search trend, whichever is stronger: a brand-new story has no search history yet
 *  - competition  100 - our organic competition estimate from the real Google top 10 (not Google's metric)
 *  - demand       real monthly search volume on a log scale (10 -> 21, 100 -> 40, 1,000 -> 60, 10,000 -> 80, 100,000 -> 100)
 *  - relevance / source  from the niche filter and the sources that reported it
 * The TOTAL exists only when all five parts rest on real data. Without keyword data or a SERP analysis there is only a "provisional" score and the idea is NOT eligible:
 * nothing is guessed. An idea outside the niche, on an excluded topic, below the minimum score, rejected, or competing with an own article is never eligible,
 * and selectForGeneration() hands out FEWER ideas rather than filling the daily quota with weak ones.
 */
const BOT = 'content_opportunity';
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const demandScore = (volume) => (volume === null || volume === undefined ? null : clamp(20 * Math.log10(volume + 1)));
const keywordTrendScore = (pct) => (pct === null || pct === undefined ? null : clamp(pct / 2));

/** @param p { cluster: {...trend inputs, relevance, reliability, sourceCount}, metrics, serp, weights, now } */
function components(p) {
  const nt = trends.trendScore({ sourceCount: p.cluster.sourceCount, recent12: p.cluster.recent12, lastSeenAt: p.cluster.lastSeenAt }, p.now);
  const kt = keywordTrendScore(p.metrics && p.metrics.found ? p.metrics.trendPct : null);
  const hasVolume = p.metrics && p.metrics.found && p.metrics.searchVolume !== null;
  return {
    trend: { score: Math.max(nt.score, kt ?? 0), news: nt.score, keyword: kt, note: kt !== null && kt > nt.score ? 'Arama trendi haber trendinden güçlü' : 'Haber trendi (yeni konuların geçmiş arama hacmi düşük olabilir)' },
    competition: { score: p.serp && p.serp.competition !== null && p.serp.competition !== undefined ? clamp(100 - p.serp.competition) : null, estimate: p.serp ? p.serp.competition : null, note: 'Organik rekabet tahmini (Google’ın resmî metriği değil)' },
    demand: { score: hasVolume ? demandScore(p.metrics.searchVolume) : null, volume: hasVolume ? p.metrics.searchVolume : null, note: 'DataForSEO aylık arama hacmi' },
    relevance: { score: clamp(p.cluster.relevance), note: 'Nişe uygunluk filtresi' },
    source: { score: clamp(p.cluster.reliability + (p.cluster.sourceCount >= 3 ? 5 : 0)), note: 'En güvenilir kaynak (+5: 3 ve üzeri kaynak)' },
  };
}

/** @returns { total, provisional, missing: [names] } total only when every part exists */
function combine(c, w) {
  const keys = ['trend', 'competition', 'demand', 'relevance', 'source'];
  const missing = keys.filter((k) => c[k].score === null);
  const avail = keys.filter((k) => c[k].score !== null);
  const wsum = avail.reduce((a, k) => a + w[k], 0);
  const provisional = wsum > 0 ? Math.round(avail.reduce((a, k) => a + c[k].score * w[k], 0) / wsum) : null;
  const total = missing.length ? null : Math.round(keys.reduce((a, k) => a + c[k].score * w[k], 0) / 100);
  return { total, provisional, missing };
}
const MISSING = { demand: 'anahtar kelime verisi yok', competition: 'SERP analizi yapılmadı', trend: 'trend verisi yok' };

async function minScoreOf(projectId, categoryId) {
  const n = (await db.query('SELECT min_opportunity_score FROM niche_profiles WHERE project_id = $1', [projectId])).rows[0];
  const c = categoryId ? (await db.query('SELECT min_opportunity_score FROM categories WHERE id = $1', [categoryId])).rows[0] : null;
  return c && c.min_opportunity_score !== null ? c.min_opportunity_score : (n ? n.min_opportunity_score : 70);
}

/** Creates topics for the project's relevant events that have none yet (and local keyword candidates for them). */
async function createTopics(projectId, { days = 7, limit = 60, generateKeywords = true, now = new Date() } = {}) {
  // worth researching: clearly on topic (relevance >= 50) or reported by 2+ sources; the strongest first, at most `limit` per pass (every topic's keywords count against the day's keyword limit)
  const rows = (await db.query(`SELECT c.id, c.title, c.category_id FROM news_clusters c WHERE c.project_id = $1 AND c.status = 'relevant' AND c.last_seen_at > $3::timestamptz - ($2 || ' days')::interval
    AND (c.relevance >= 50 OR c.source_count >= 2 OR c.manual_override) AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.cluster_id = c.id)
    ORDER BY c.source_count DESC, c.relevance DESC, c.reliability DESC, c.last_seen_at DESC LIMIT $4`, [projectId, String(days), now, limit])).rows;
  let created = 0; let kw = 0;
  for (const c of rows) {
    const t = (await db.query("INSERT INTO topics (project_id, cluster_id, category_id, title, origin) VALUES ($1,$2,$3,$4,'news') ON CONFLICT (cluster_id) DO NOTHING RETURNING id", [projectId, c.id, c.category_id, c.title])).rows[0];
    if (!t) continue; created++;
    if (generateKeywords) kw += (await keywords.generateForTopic(t.id)).added;
  }
  return { created, keywordsAdded: kw };
}

async function scoreTopic(t, { weights, now, minRelevance }) {
  const cl = t.cluster_id ? (await db.query(`SELECT c.*, (SELECT count(*)::int FROM news_items i WHERE i.cluster_id = c.id AND coalesce(i.published_at, i.fetched_at) > $2::timestamptz - interval '12 hours') AS recent12 FROM news_clusters c WHERE c.id = $1`, [t.cluster_id, now])).rows[0] : null;
  const cluster = cl ? { sourceCount: cl.source_count, recent12: cl.recent12, lastSeenAt: cl.last_seen_at, relevance: cl.relevance, reliability: cl.reliability, status: cl.status }
    : { sourceCount: 1, recent12: 0, lastSeenAt: now, relevance: 100, reliability: 50, status: 'relevant' };       // a topic a person typed in
  // the topic's best keyword: the one with real data and the highest volume
  const kws = (await db.query(`SELECT k.id, k.keyword, m.found, m.search_volume, m.trend_pct, m.avg_referring_domains,
      (SELECT competition FROM serp_analyses s WHERE s.keyword_id = k.id ORDER BY s.fetched_at DESC LIMIT 1) AS serp_competition
    FROM keywords k LEFT JOIN LATERAL (SELECT * FROM keyword_metrics x WHERE x.keyword_id = k.id ORDER BY x.fetched_at DESC LIMIT 1) m ON true WHERE k.topic_id = $1 ORDER BY (m.found IS TRUE) DESC, m.search_volume DESC NULLS LAST, k.created_at LIMIT 12`, [t.id])).rows;
  const best = kws.find((k) => k.found) || null;
  const metrics = best ? { found: true, searchVolume: best.search_volume, trendPct: best.trend_pct === null ? null : Number(best.trend_pct) } : (kws[0] && kws[0].found === false ? { found: false } : null);
  const serp = best ? { competition: best.serp_competition } : null;
  const c = components({ cluster, metrics, serp, now });
  const { total, provisional, missing } = combine(c, weights);
  const minScore = await minScoreOf(t.project_id, t.category_id);

  let reason = '';
  if (t.status === 'rejected') reason = 'Reddedildi';
  else if (cluster.status === 'excluded') reason = 'Kapsam dışı konu';
  else if (cluster.status !== 'relevant' || cluster.relevance < minRelevance) reason = 'Nişe uygun değil';
  else if (!kws.length) reason = 'Henüz anahtar kelime yok';
  else if (!best) reason = kws.every((k) => k.found === null) ? 'Anahtar kelime verisi henüz çekilmedi' : 'Hiçbir anahtar kelime için veri bulunamadı';
  else if (missing.length) reason = `Eksik veri: ${missing.map((m) => MISSING[m] || m).join(', ')}`;
  else if (total < minScore) reason = `Fırsat puanı ${total}, en az ${minScore} gerekli`;
  if (!reason && best) {
    const dup = (await db.query("SELECT h1 FROM articles WHERE project_id = $1 AND focus_keyword = $2 AND status NOT IN ('archived', 'failed') LIMIT 1", [t.project_id, best.keyword])).rows[0];
    if (dup) reason = `Aynı odak anahtar kelimeyle makale var: “${dup.h1.slice(0, 60)}” (kanibalizasyon)`;
  }
  const eligible = reason === '';
  const explain = { components: c, missing, minScore, keyword: best ? best.keyword : null, keywordsTried: kws.length, note: total === null ? 'Tüm bileşenler gerçek veriye dayanmadığı için toplam puan verilmedi; “geçici” puan yalnızca eldeki bileşenlerin ağırlıklı ortalamasıdır.' : '' };
  await db.query(`INSERT INTO content_opportunities (project_id, topic_id, keyword_id, category_id, title, trend_score, competition_score, demand_score, relevance_score, source_score, total_score, provisional_score, eligible, ineligible_reason, weights, explain, computed_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
    ON CONFLICT (topic_id) DO UPDATE SET keyword_id = EXCLUDED.keyword_id, category_id = EXCLUDED.category_id, title = EXCLUDED.title, trend_score = EXCLUDED.trend_score, competition_score = EXCLUDED.competition_score, demand_score = EXCLUDED.demand_score,
      relevance_score = EXCLUDED.relevance_score, source_score = EXCLUDED.source_score, total_score = EXCLUDED.total_score, provisional_score = EXCLUDED.provisional_score, eligible = EXCLUDED.eligible, ineligible_reason = EXCLUDED.ineligible_reason,
      weights = EXCLUDED.weights, explain = EXCLUDED.explain, computed_at = EXCLUDED.computed_at, updated_at = EXCLUDED.updated_at`,
  [t.project_id, t.id, best ? best.id : null, t.category_id, t.title, c.trend.score, c.competition.score, c.demand.score, c.relevance.score, c.source.score, total, provisional, eligible, reason, JSON.stringify(weights), JSON.stringify(explain), now]);
  return { eligible, total };
}

/** Topics from new events, then (re)scores every open topic of the project from what is known NOW. Safe to repeat. */
async function refresh(projectId, { now = new Date(), userId = null, trigger = 'manual', generateKeywords = true } = {}) {
  const run = await runs.start(BOT, { projectId, trigger, userId });
  try {
    const cfg = (await settings.get('news', projectId)).value;
    const weights = (await settings.get('scoring', projectId)).value;
    const made = await createTopics(projectId, { generateKeywords, now });
    const open = (await db.query("SELECT * FROM topics WHERE project_id = $1 AND status IN ('new', 'rejected') ORDER BY created_at DESC LIMIT 1000", [projectId])).rows;
    let eligible = 0; let scored = 0;
    for (const t of open) { const r = await scoreTopic(t, { weights, now, minRelevance: cfg.minRelevance }); if (r.eligible) eligible++; if (r.total !== null) scored++; }
    const stats = { topicsCreated: made.created, keywordsAdded: made.keywordsAdded, topics: open.length, scored, eligible };
    await runs.finish(run.id, { status: 'ok', stats });
    return stats;
  } catch (err) { await runs.finish(run.id, { status: 'error', error: err.message }); throw err; }
}

/** Re-scores ONE idea from what is known now (after its best keyword got a SERP analysis, for example). */
async function rescore(id, { now = new Date() } = {}) {
  const o = (await db.query('SELECT topic_id FROM content_opportunities WHERE id = $1', [id])).rows[0];
  if (!o) throw new HttpError(404, 'Fırsat bulunamadı');
  const t = (await db.query('SELECT * FROM topics WHERE id = $1', [o.topic_id])).rows[0];
  await scoreTopic(t, { weights: (await settings.get('scoring', t.project_id)).value, now, minRelevance: (await settings.get('news', t.project_id)).value.minRelevance });
  return get(id);
}

const shape = (r) => ({ id: r.id, projectId: r.project_id, topicId: r.topic_id, keywordId: r.keyword_id, keyword: r.keyword, categoryId: r.category_id, categoryName: r.category_name, title: r.title,
  trend: r.trend_score, competition: r.competition_score, demand: r.demand_score, relevance: r.relevance_score, source: r.source_score, total: r.total_score, provisional: r.provisional_score,
  eligible: r.eligible, ineligibleReason: r.ineligible_reason, status: r.status, weights: r.weights, explain: r.explain, computedAt: r.computed_at, clusterId: r.cluster_id, sourceCount: r.source_count });

async function list(projectId, q = {}) {
  const p = [projectId]; const w = ['o.project_id = $1'];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (q.status) add('o.status = ?', V.oneOf(q.status, 'Durum', ['new', 'shortlisted', 'rejected', 'queued', 'written']));
  if (q.eligible === '1') w.push('o.eligible');
  if (q.eligible === '0') w.push('NOT o.eligible');
  if (q.categoryId) add('o.category_id = ?', V.uuid(q.categoryId, 'Kategori'));
  if (q.minScore !== undefined && q.minScore !== '') add('o.total_score >= ?', V.int(q.minScore, 'Minimum puan', { min: 0, max: 100 }));
  if (q.q) add("o.title ILIKE ? ESCAPE '\\'", `%${String(q.q).slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  const size = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 30)); const page = Math.max(1, parseInt(q.page, 10) || 1);
  const where = w.join(' AND ');
  const total = (await db.query(`SELECT count(*)::int n FROM content_opportunities o WHERE ${where}`, p)).rows[0].n;
  const rows = (await db.query(`SELECT o.*, c.name_en AS category_name, k.keyword, t.cluster_id, nc.source_count FROM content_opportunities o LEFT JOIN categories c ON c.id = o.category_id LEFT JOIN keywords k ON k.id = o.keyword_id
    LEFT JOIN topics t ON t.id = o.topic_id LEFT JOIN news_clusters nc ON nc.id = t.cluster_id WHERE ${where}
    ORDER BY o.eligible DESC, o.total_score DESC NULLS LAST, o.provisional_score DESC NULLS LAST, o.updated_at DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, size, (page - 1) * size])).rows;
  return { total, page, pageSize: size, items: rows.map(shape) };
}

async function get(id) {
  const r = (await db.query(`SELECT o.*, c.name_en AS category_name, k.keyword, t.cluster_id, nc.source_count FROM content_opportunities o LEFT JOIN categories c ON c.id = o.category_id LEFT JOIN keywords k ON k.id = o.keyword_id
    LEFT JOIN topics t ON t.id = o.topic_id LEFT JOIN news_clusters nc ON nc.id = t.cluster_id WHERE o.id = $1`, [id])).rows[0];
  if (!r) throw new HttpError(404, 'Fırsat bulunamadı');
  return shape(r);
}

/** A person's call: shortlist it, reject it (never eligible again until reopened), or reopen it. */
async function setStatus(id, status) {
  const st = V.oneOf(status, 'Durum', ['new', 'shortlisted', 'rejected']);
  const o = (await db.query('SELECT o.topic_id, o.status FROM content_opportunities o WHERE o.id = $1', [id])).rows[0];
  if (!o) throw new HttpError(404, 'Fırsat bulunamadı');
  if (['queued', 'written'].includes(o.status)) throw new HttpError(409, 'Bu fırsat için makale süreci başladı; durumu değiştirilemez');
  await db.query('UPDATE content_opportunities SET status = $2, updated_at = now() WHERE id = $1', [id, st]);
  await db.query("UPDATE topics SET status = $2 WHERE id = $1", [o.topic_id, st === 'rejected' ? 'rejected' : 'new']);
  if (st === 'rejected') await db.query("UPDATE content_opportunities SET eligible = false, ineligible_reason = 'Reddedildi' WHERE id = $1", [id]);
  return get(id);
}

/**
 * Which ideas to write next (a DRY RUN: nothing is reserved or written here; the generator of phase 3/4 reserves the daily limit when it starts).
 *  - only eligible ideas (full real data, score >= minimum, in the niche)
 *  - never more than the free daily room (project limit, category limit) and never padded: if only 1 idea is good enough, 1 is returned
 *  - between equally good ideas the category that is furthest BELOW its target share (last 30 days of articles) goes first; a good idea still beats a weak one from a hungry category
 */
async function selectForGeneration(projectId, { count, tz = env().defaultTimezone, now = new Date() } = {}) {
  const st = (await limits.status({ projectId, tz, now })).items.find((i) => i.workType === 'new_article');
  const room = Math.min(st.remaining, st.project ? st.project.remaining : st.remaining);
  const want = Math.max(0, Math.min(count === undefined ? room : count, room));
  const day = dayKey(now, tz);
  const cats = (await db.query(`SELECT c.id, c.name_en, c.target_share_pct, c.daily_max,
      COALESCE((SELECT used FROM daily_work_usage u WHERE u.day = $2 AND u.work_type = 'new_article' AND u.scope = 'category' AND u.category_id = c.id), 0) AS used_today,
      (SELECT count(*)::int FROM articles a WHERE a.category_id = c.id AND a.status <> 'archived' AND a.created_at > $3::timestamptz - interval '30 days') AS recent
    FROM categories c WHERE c.project_id = $1 AND c.status = 'active'`, [projectId, day, now])).rows;
  const cat = new Map(cats.map((c) => [c.id, { ...c, picked: 0 }]));
  const cand = (await db.query(`SELECT o.*, c.name_en AS category_name, k.keyword FROM content_opportunities o LEFT JOIN categories c ON c.id = o.category_id LEFT JOIN keywords k ON k.id = o.keyword_id
    WHERE o.project_id = $1 AND o.eligible AND o.status IN ('new', 'shortlisted') ORDER BY o.total_score DESC`, [projectId])).rows;
  const picks = []; const skipped = [];
  const recentTotal = () => [...cat.values()].reduce((a, c) => a + c.recent + c.picked, 0);
  const left = [...cand];
  while (picks.length < want && left.length) {
    const tot = recentTotal() || 1;
    const scored = left.map((o) => {
      const c = cat.get(o.category_id);
      const actual = c ? ((c.recent + c.picked) / tot) * 100 : 0; const deficit = c ? c.target_share_pct - actual : 0;
      return { o, c, deficit, priority: o.total_score + Math.max(-10, Math.min(10, deficit / 3)) };
    }).sort((a, b) => b.priority - a.priority);
    const next = scored.find((s) => !s.c || s.c.daily_max === null || s.c.used_today + s.c.picked < s.c.daily_max);
    if (!next) break;
    picks.push({ ...shape(next.o), why: `Puan ${next.o.total_score}${next.c ? `; “${next.c.name_en}” hedef payın ${next.deficit > 0 ? `${Math.round(next.deficit)} puan altında` : 'üstünde'}` : ''}` });
    if (next.c) next.c.picked++;
    left.splice(left.findIndex((x) => x.id === next.o.id), 1);
  }
  for (const o of left) { const c = cat.get(o.category_id); skipped.push({ ...shape(o), why: c && c.daily_max !== null && c.used_today + c.picked >= c.daily_max ? `“${c.name_en}” kategorisinin günlük sınırı doldu` : picks.length >= want ? 'Bugünkü yer bitti' : 'Seçilmedi' }); }
  return { requested: count === undefined ? null : count, room, picked: picks.length, picks, skipped,
    note: cand.length < (count === undefined ? room : count) ? `Yeterince nitelikli fikir yok (${cand.length}); kota doldurmak için zayıf konu eklenmez.` : '' };
}

module.exports = { BOT, components, combine, demandScore, keywordTrendScore, createTopics, refresh, rescore, list, get, setStatus, selectForGeneration };
