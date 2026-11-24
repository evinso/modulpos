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
 * FREE MODE (setting `seo.partialWithApproval`, on by default): while no search-volume source is connected the DEMAND part can never exist. An idea whose ONLY missing part is
 * demand (the other four are real: news trend, a real SERP analysis of its most specific candidate phrase, relevance, source) gets a PARTIAL score (the weighted average of
 * the four, labelled as such; the total stays empty) and becomes eligible only when a person has put it on the shortlist AND the partial score reaches the minimum.
 * Real volume data (a connected API or an imported file) turns the same idea into a normal full score again.
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
    demand: { score: hasVolume ? demandScore(p.metrics.searchVolume) : null, volume: hasVolume ? p.metrics.searchVolume : null, note: 'Aylık arama hacmi (Apify verisi ya da yüklediğiniz dosya)' },
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

/** Creates topics for the project's relevant events that have none yet, with local keyword candidates for them. A fixed number of statements, however many topics. */
async function createTopics(projectId, { days = 7, limit = 60, generateKeywords = true, now = new Date() } = {}) {
  // worth researching: clearly on topic (relevance >= 50) or reported by 2+ sources; the strongest first, at most `limit` per pass (every topic's keywords count against the day's keyword limit)
  const rows = (await db.query(`SELECT c.id, c.title, c.category_id, c.matched_terms, k.name_en AS category_name FROM news_clusters c LEFT JOIN categories k ON k.id = c.category_id
    WHERE c.project_id = $1 AND c.status = 'relevant' AND c.last_seen_at > $3::timestamptz - ($2 || ' days')::interval
    AND (c.relevance >= 50 OR c.source_count >= 2 OR c.manual_override) AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.cluster_id = c.id)
    ORDER BY c.source_count DESC, c.relevance DESC, c.reliability DESC, c.last_seen_at DESC LIMIT $4`, [projectId, String(days), now, limit])).rows;
  if (!rows.length) return { created: 0, keywordsAdded: 0 };
  const topics = (await db.query(`INSERT INTO topics (project_id, cluster_id, category_id, title, origin) SELECT $1, x.cluster_id, x.category_id, x.title, 'news'
    FROM jsonb_to_recordset($2::jsonb) AS x(cluster_id uuid, category_id uuid, title text) ON CONFLICT (cluster_id) DO NOTHING RETURNING id, cluster_id, category_id, title`,
  [projectId, JSON.stringify(rows.map((r) => ({ cluster_id: r.id, category_id: r.category_id, title: r.title })))])).rows;
  let keywordsAdded = 0;
  if (generateKeywords && topics.length) {
    const known = (await db.query("SELECT related_keywords FROM categories WHERE project_id = $1 AND status <> 'archived'", [projectId])).rows.flatMap((r) => r.related_keywords);
    const country = ((await settings.get('seo', projectId)).value.countries || ['US'])[0] || 'US';
    const byCluster = new Map(rows.map((r) => [r.id, r])); const seen = new Set(); const kw = [];
    for (const t of topics) {
      const c = byCluster.get(t.cluster_id);
      for (const k of keywords.candidatesFor(t.title, { categoryName: c.category_name || '', known, matched: c.matched_terms || [] })) if (!seen.has(k)) { seen.add(k); kw.push({ keyword: k, topic_id: t.id, category_id: t.category_id }); }
    }
    if (kw.length) {
      const r = await db.query(`INSERT INTO keywords (project_id, keyword, country, language, origin, topic_id, category_id) SELECT $1, x.keyword, $2, 'en', 'news', x.topic_id, x.category_id FROM jsonb_to_recordset($3::jsonb) AS x(keyword text, topic_id uuid, category_id uuid)
        ON CONFLICT (project_id, keyword, country, language) DO UPDATE SET topic_id = COALESCE(keywords.topic_id, EXCLUDED.topic_id), category_id = COALESCE(keywords.category_id, EXCLUDED.category_id) RETURNING (xmax = 0) AS inserted`, [projectId, country, JSON.stringify(kw)]);
      keywordsAdded = r.rows.filter((x) => x.inserted).length;
    }
  }
  return { created: topics.length, keywordsAdded };
}

/**
 * Scores many topics of one project with a FIXED number of queries (the database is far away: a query per topic would take minutes for a few hundred topics).
 * @returns [{ eligible, total }] in the order of `topics`
 */
/** the lane judges a young event on three of the five parts (trend, niche fit, source trust): a milder bar than the full 70, because 55% of the weight (volume, competition) is exactly what news does not have yet */
const FRESH_MIN = 60;
async function scoreMany(projectId, topics, { weights, now, minRelevance, partialWithApproval = false, freshHours = 0 }) {
  if (!topics.length) return [];
  const clusterIds = topics.map((t) => t.cluster_id).filter(Boolean); const topicIds = topics.map((t) => t.id);
  const cl = new Map((await db.query(`SELECT c.id, c.source_count, c.relevance, c.reliability, c.status, c.last_seen_at,
      (SELECT count(*)::int FROM news_items i WHERE i.cluster_id = c.id AND coalesce(i.published_at, i.fetched_at) > $2::timestamptz - interval '12 hours') AS recent12 FROM news_clusters c WHERE c.id = ANY($1)`, [clusterIds, now])).rows.map((r) => [r.id, r]));
  const kwRows = (await db.query(`SELECT k.topic_id, k.id, k.keyword, m.found, m.search_volume, m.trend_pct, (SELECT competition FROM serp_analyses s WHERE s.keyword_id = k.id ORDER BY s.fetched_at DESC LIMIT 1) AS serp_competition
    FROM keywords k LEFT JOIN LATERAL (SELECT * FROM keyword_metrics x WHERE x.keyword_id = k.id ORDER BY x.fetched_at DESC LIMIT 1) m ON true WHERE k.topic_id = ANY($1)
    ORDER BY k.topic_id, (m.found IS TRUE) DESC, m.search_volume DESC NULLS LAST, k.created_at`, [topicIds])).rows;
  const approval = new Map((await db.query('SELECT topic_id, status FROM content_opportunities WHERE topic_id = ANY($1)', [topicIds])).rows.map((r) => [r.topic_id, r.status]));
  const byTopic = new Map(); for (const k of kwRows) { if (!byTopic.has(k.topic_id)) byTopic.set(k.topic_id, []); if (byTopic.get(k.topic_id).length < 12) byTopic.get(k.topic_id).push(k); }
  const niche = (await db.query('SELECT min_opportunity_score FROM niche_profiles WHERE project_id = $1', [projectId])).rows[0];
  const catMin = new Map((await db.query('SELECT id, min_opportunity_score FROM categories WHERE project_id = $1', [projectId])).rows.map((r) => [r.id, r.min_opportunity_score]));
  const own = new Map((await db.query("SELECT focus_keyword, h1 FROM articles WHERE project_id = $1 AND status NOT IN ('archived', 'failed') AND focus_keyword <> ''", [projectId])).rows.map((r) => [r.focus_keyword, r.h1]));
  const out = []; const rows = [];
  for (const t of topics) {
    const c = t.cluster_id ? cl.get(t.cluster_id) : null;
    const cluster = c ? { sourceCount: c.source_count, recent12: c.recent12, lastSeenAt: c.last_seen_at, relevance: c.relevance, reliability: c.reliability, status: c.status }
      : { sourceCount: 1, recent12: 0, lastSeenAt: now, relevance: 100, reliability: 50, status: 'relevant' };       // a topic a person typed in
    const kws = byTopic.get(t.id) || [];
    const best = kws.find((k) => k.found) || null;
    // without any real volume the idea is judged on its best CANDIDATE phrase (one that already has a SERP analysis, else the most specific one) - only in free mode, and only with a person's approval (below)
    // FRESH-NEWS LANE (setting `seo.freshHours`, 0 = off): a young event reported by 2+ sources (or a very reliable one) is judged on the time wave itself (trend, niche fit, source trust): news has no search
    // history yet, so waiting for a volume number or a SERP analysis would let it go stale. No approval step; the same minimum score and the same mandatory checks apply.
    const ageH = c ? (now.getTime() - new Date(c.last_seen_at).getTime()) / 3600000 : Infinity;
    const laneBase = freshHours > 0 && !!c && ageH <= freshHours && (cluster.sourceCount >= 2 || cluster.reliability >= 85);
    const candidate = !best && (partialWithApproval || laneBase) && kws.length ? (kws.find((k) => k.serp_competition !== null && k.serp_competition !== undefined) || [...kws].sort((a, b) => b.keyword.split(' ').length - a.keyword.split(' ').length)[0]) : null;
    const target = best || candidate;
    const metrics = best ? { found: true, searchVolume: best.search_volume, trendPct: best.trend_pct === null ? null : Number(best.trend_pct) } : (kws[0] && kws[0].found === false ? { found: false } : null);
    const comps = components({ cluster, metrics, serp: target ? { competition: target.serp_competition } : null, now });
    const { total, provisional, missing } = combine(comps, weights);
    const own1 = catMin.get(t.category_id); const minScore = own1 !== null && own1 !== undefined ? own1 : (niche ? niche.min_opportunity_score : 70);
    const lane = laneBase && !!target && missing.every((m) => m === 'demand' || m === 'competition');
    const partial = !lane && !best && !!candidate && missing.length === 1 && missing[0] === 'demand';       // every part but the search volume is real
    let reason = '';
    if (t.status === 'rejected') reason = 'Reddedildi';
    else if (cluster.status === 'excluded') reason = 'Kapsam dışı konu';
    else if (cluster.status !== 'relevant' || cluster.relevance < minRelevance) reason = 'Nişe uygun değil';
    else if (!kws.length) reason = 'Henüz anahtar kelime yok';
    else if (!target) reason = kws.every((k) => k.found === null) ? 'Anahtar kelime verisi henüz çekilmedi' : 'Hiçbir anahtar kelime için veri bulunamadı';
    else if (lane) { if (provisional < Math.min(minScore, FRESH_MIN)) reason = `Taze haber puanı ${provisional}, en az ${Math.min(minScore, FRESH_MIN)} gerekli`; }
    else if (candidate && missing.includes('competition')) reason = 'SERP analizi yapılmadı: “SERP” düğmesiyle bu fikrin organik rekabetini ölçün';
    else if (partial) {
      if (approval.get(t.id) !== 'shortlisted') reason = 'Aranma hacmi verisi yok: kısmi puanla üretime almak için fikri “Kısa liste”ye alın (onay sizin)';
      else if (provisional < minScore) reason = `Kısmi puan ${provisional}, en az ${minScore} gerekli`;
    }
    else if (missing.length) reason = `Eksik veri: ${missing.map((m) => MISSING[m] || m).join(', ')}`;
    else if (total < minScore) reason = `Fırsat puanı ${total}, en az ${minScore} gerekli`;
    if (!reason && target && own.has(target.keyword)) reason = `Aynı odak anahtar kelimeyle makale var: “${own.get(target.keyword).slice(0, 60)}” (kanibalizasyon)`;
    const eligible = reason === '';
    out.push({ eligible, total, partial });
    rows.push({ topic_id: t.id, category_id: t.category_id, keyword_id: target ? target.id : null, title: t.title, trend: comps.trend.score, competition: comps.competition.score, demand: comps.demand.score, relevance: comps.relevance.score, source: comps.source.score, total, provisional, eligible, reason,
      explain: { components: comps, missing, minScore, keyword: target ? target.keyword : null, keywordsTried: kws.length, partial: partial || lane, lane, note: lane ? `TAZE HABER HATTI: olay ${Math.round(ageH)} saat önce son görüldü, ${cluster.sourceCount} kaynak; haberde zaman önemli olduğu için aranma hacmi / rekabet verisi beklenmedi. Puan yalnızca eldeki bileşenlerden (trend, nişe uygunluk, kaynak güveni${comps.competition.score === null ? '' : ', rekabet'}) hesaplandı; aynı en düşük puan ve aynı zorunlu kontroller geçerli.` : partial ? 'KISMİ PUAN: aranma hacmi verisi olmadığı için yalnızca dört bileşenin (trend, rekabet fırsatı, nişe uygunluk, kaynak güveni) ağırlıklı ortalaması; toplam puan verilmedi. Üretime yalnızca sizin onayınızla (Kısa liste) girer.' : total === null ? 'Tüm bileşenler gerçek veriye dayanmadığı için toplam puan verilmedi; “geçici” puan yalnızca eldeki bileşenlerin ağırlıklı ortalamasıdır.' : '' } });
  }
  for (let i = 0; i < rows.length; i += 150) {
    await db.query(`INSERT INTO content_opportunities (project_id, topic_id, keyword_id, category_id, title, trend_score, competition_score, demand_score, relevance_score, source_score, total_score, provisional_score, eligible, ineligible_reason, weights, explain, computed_at, updated_at)
      SELECT $1, x.topic_id, x.keyword_id, x.category_id, x.title, x.trend, x.competition, x.demand, x.relevance, x.source, x.total, x.provisional, x.eligible, x.reason, $3::jsonb, x.explain, $2, $2 FROM jsonb_to_recordset($4::jsonb)
        AS x(topic_id uuid, keyword_id uuid, category_id uuid, title text, trend int, competition int, demand int, relevance int, source int, total int, provisional int, eligible boolean, reason text, explain jsonb)
      ON CONFLICT (topic_id) DO UPDATE SET keyword_id = EXCLUDED.keyword_id, category_id = EXCLUDED.category_id, title = EXCLUDED.title, trend_score = EXCLUDED.trend_score, competition_score = EXCLUDED.competition_score, demand_score = EXCLUDED.demand_score,
        relevance_score = EXCLUDED.relevance_score, source_score = EXCLUDED.source_score, total_score = EXCLUDED.total_score, provisional_score = EXCLUDED.provisional_score, eligible = EXCLUDED.eligible, ineligible_reason = EXCLUDED.ineligible_reason,
        weights = EXCLUDED.weights, explain = EXCLUDED.explain, computed_at = EXCLUDED.computed_at, updated_at = EXCLUDED.updated_at`, [projectId, now, JSON.stringify(weights), JSON.stringify(rows.slice(i, i + 150))]);
  }
  return out;
}

/** Topics from new events, then (re)scores every open topic of the project from what is known NOW. Safe to repeat. */
async function refresh(projectId, { now = new Date(), userId = null, trigger = 'manual', generateKeywords = true } = {}) {
  const run = await runs.start(BOT, { projectId, trigger, userId });
  try {
    const cfg = (await settings.get('news', projectId)).value;
    const weights = (await settings.get('scoring', projectId)).value;
    const seoCfg = (await settings.get('seo', projectId)).value; const partialWithApproval = seoCfg.partialWithApproval; const freshHours = seoCfg.freshHours || 0;
    const made = await createTopics(projectId, { generateKeywords, now });
    const open = (await db.query("SELECT * FROM topics WHERE project_id = $1 AND status IN ('new', 'rejected') ORDER BY created_at DESC LIMIT 2000", [projectId])).rows;
    const res = await scoreMany(projectId, open, { weights, now, minRelevance: cfg.minRelevance, partialWithApproval, freshHours });
    const stats = { topicsCreated: made.created, keywordsAdded: made.keywordsAdded, topics: open.length, scored: res.filter((r) => r.total !== null).length, partial: res.filter((r) => r.partial).length, eligible: res.filter((r) => r.eligible).length };
    await runs.finish(run.id, { status: 'ok', stats });
    return stats;
  } catch (err) { await runs.finish(run.id, { status: 'error', error: err.message }); throw err; }
}

/** Re-scores ONE idea from what is known now (after its best keyword got a SERP analysis, for example). */
async function rescore(id, { now = new Date() } = {}) {
  const o = (await db.query('SELECT topic_id FROM content_opportunities WHERE id = $1', [id])).rows[0];
  if (!o) throw new HttpError(404, 'Fırsat bulunamadı');
  const t = (await db.query('SELECT * FROM topics WHERE id = $1', [o.topic_id])).rows[0];
  await scoreMany(t.project_id, [t], { weights: (await settings.get('scoring', t.project_id)).value, now, minRelevance: (await settings.get('news', t.project_id)).value.minRelevance, partialWithApproval: (await settings.get('seo', t.project_id)).value.partialWithApproval, freshHours: (await settings.get('seo', t.project_id)).value.freshHours || 0 });
  return get(id);
}

const shape = (r) => ({ id: r.id, projectId: r.project_id, topicId: r.topic_id, keywordId: r.keyword_id, keyword: r.keyword, categoryId: r.category_id, categoryName: r.category_name, title: r.title,
  trend: r.trend_score, competition: r.competition_score, demand: r.demand_score, relevance: r.relevance_score, source: r.source_score, total: r.total_score, provisional: r.provisional_score,
  eligible: r.eligible, ineligibleReason: r.ineligible_reason, partial: !!(r.explain && r.explain.partial), articleId: r.article_id, status: r.status, weights: r.weights, explain: r.explain, computedAt: r.computed_at, clusterId: r.cluster_id, sourceCount: r.source_count });

async function list(projectId, q = {}) {
  const p = [projectId]; const w = ['o.project_id = $1'];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (q.status) add('o.status = ?', V.oneOf(q.status, 'Durum', ['new', 'shortlisted', 'rejected', 'queued', 'written']));
  if (q.eligible === '1') w.push('o.eligible');
  if (q.eligible === '0') w.push('NOT o.eligible');
  if (q.categoryId) add('o.category_id = ?', V.uuid(q.categoryId, 'Kategori'));
  if (q.minScore !== undefined && q.minScore !== '') add("COALESCE(o.total_score, CASE WHEN (o.explain->>'partial') = 'true' THEN o.provisional_score END) >= ?", V.int(q.minScore, 'Minimum puan', { min: 0, max: 100 }));
  if (q.q) add("o.title ILIKE ? ESCAPE '\\'", `%${String(q.q).slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  const size = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 30)); const page = Math.max(1, parseInt(q.page, 10) || 1);
  const where = w.join(' AND ');
  const total = (await db.query(`SELECT count(*)::int n FROM content_opportunities o WHERE ${where}`, p)).rows[0].n;
  const rows = (await db.query(`SELECT o.*, c.name_en AS category_name, k.keyword, t.cluster_id, nc.source_count FROM content_opportunities o LEFT JOIN categories c ON c.id = o.category_id LEFT JOIN keywords k ON k.id = o.keyword_id
    LEFT JOIN topics t ON t.id = o.topic_id LEFT JOIN news_clusters nc ON nc.id = t.cluster_id WHERE ${where}
    ORDER BY o.eligible DESC, COALESCE(o.total_score, o.provisional_score) DESC NULLS LAST, o.updated_at DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, size, (page - 1) * size])).rows;
  return { total, page, pageSize: size, items: rows.map(shape) };
}

async function get(id) {
  const r = (await db.query(`SELECT o.*, c.name_en AS category_name, k.keyword, t.cluster_id, nc.source_count FROM content_opportunities o LEFT JOIN categories c ON c.id = o.category_id LEFT JOIN keywords k ON k.id = o.keyword_id
    LEFT JOIN topics t ON t.id = o.topic_id LEFT JOIN news_clusters nc ON nc.id = t.cluster_id WHERE o.id = $1`, [id])).rows[0];
  if (!r) throw new HttpError(404, 'Fırsat bulunamadı');
  return shape(r);
}

/** A person's call: shortlist it, reject it (never eligible again until reopened), or reopen it. */
async function setStatus(id, status, { now = new Date() } = {}) {
  const st = V.oneOf(status, 'Durum', ['new', 'shortlisted', 'rejected']);
  const o = (await db.query('SELECT o.topic_id, o.status FROM content_opportunities o WHERE o.id = $1', [id])).rows[0];
  if (!o) throw new HttpError(404, 'Fırsat bulunamadı');
  if (['queued', 'written'].includes(o.status)) throw new HttpError(409, 'Bu fırsat için makale süreci başladı; durumu değiştirilemez');
  await db.query('UPDATE content_opportunities SET status = $2, updated_at = now() WHERE id = $1', [id, st]);
  await db.query("UPDATE topics SET status = $2 WHERE id = $1", [o.topic_id, st === 'rejected' ? 'rejected' : 'new']);
  if (st === 'rejected') { await db.query("UPDATE content_opportunities SET eligible = false, ineligible_reason = 'Reddedildi' WHERE id = $1", [id]); return get(id); }
  return rescore(id, { now });                                             // a shortlist call can make a PARTIAL-score idea eligible (and taking it off the list makes it ineligible again)
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
    WHERE o.project_id = $1 AND o.eligible AND o.status IN ('new', 'shortlisted') ORDER BY COALESCE(o.total_score, o.provisional_score) DESC`, [projectId])).rows;
  const picks = []; const skipped = [];
  const recentTotal = () => [...cat.values()].reduce((a, c) => a + c.recent + c.picked, 0);
  const left = [...cand];
  while (picks.length < want && left.length) {
    const tot = recentTotal() || 1;
    const scored = left.map((o) => {
      const c = cat.get(o.category_id);
      const actual = c ? ((c.recent + c.picked) / tot) * 100 : 0; const deficit = c ? c.target_share_pct - actual : 0;
      return { o, c, deficit, priority: (o.total_score ?? o.provisional_score) + Math.max(-10, Math.min(10, deficit / 3)) };
    }).sort((a, b) => b.priority - a.priority);
    const next = scored.find((s) => !s.c || s.c.daily_max === null || s.c.used_today + s.c.picked < s.c.daily_max);
    if (!next) break;
    picks.push({ ...shape(next.o), why: `${next.o.total_score === null ? (next.o.explain && next.o.explain.lane ? `Taze haber hattı: puan ${next.o.provisional_score} (hacim/rekabet verisi beklenmedi)` : `Kısmi puan ${next.o.provisional_score} (hacim verisi yok, sizin onayınızla)`) : `Puan ${next.o.total_score}`}${next.c ? `; “${next.c.name_en}” hedef payın ${next.deficit > 0 ? `${Math.round(next.deficit)} puan altında` : 'üstünde'}` : ''}` });
    if (next.c) next.c.picked++;
    left.splice(left.findIndex((x) => x.id === next.o.id), 1);
  }
  const fullCats = new Map();                                    // category name -> how many ready ideas wait because that category's own daily limit is used up
  for (const o of left) {
    const c = cat.get(o.category_id); const full = !!(c && c.daily_max !== null && c.used_today + c.picked >= c.daily_max);
    if (full) fullCats.set(c.name_en, { count: (fullCats.get(c.name_en) || { count: 0 }).count + 1, limit: c.daily_max });
    skipped.push({ ...shape(o), why: full ? `“${c.name_en}” kategorisinin günlük sınırı doldu` : picks.length >= want ? 'Bugünkü yer bitti' : 'Seçilmedi' });
  }
  const held = [...fullCats].map(([category, v]) => ({ category, count: v.count, limit: v.limit }));
  // WHY nothing (or less than the places) was chosen, in words: the day's places used up, or ready ideas that sit in categories whose own daily limit is used up
  const heldTotal = held.reduce((n, h) => n + h.count, 0); const wanted = count === undefined ? room : count;
  let note = '';
  if (room === 0) note = `Bugünkü yeni makale yeri doldu (${st.project ? st.project.done : st.done} / ${st.project ? Math.min(st.limit, st.project.limit) : st.limit}).`;
  else if (picks.length < want && heldTotal) note = `${want - picks.length} yer boş ama yazılamadı: kalan ${heldTotal} hazır fikir, kendi günlük kategori sınırı dolan kategorilerde (${held.map((h) => `“${h.category}” ${h.count} fikir, sınır ${h.limit}`).join('; ')}). Sınırı “Otomasyon ve Ayarlar → Günlük limitler → Kategori limitleri”nden artırabilir ya da boş bırakabilirsiniz.${cand.length < wanted ? ` Ayrıca yeterince nitelikli fikir yok (${cand.length}); kota doldurmak için zayıf konu eklenmez.` : ''}`;
  else if (cand.length < wanted) note = `Yeterince nitelikli fikir yok (${cand.length}); kota doldurmak için zayıf konu eklenmez.`;
  return { requested: count === undefined ? null : count, room, picked: picks.length, picks, skipped, held, note };
}

module.exports = { BOT, components, combine, demandScore, keywordTrendScore, createTopics, refresh, rescore, list, get, setStatus, selectForGeneration };
