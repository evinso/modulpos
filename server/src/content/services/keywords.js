const db = require('../db');
const V = require('../lib/validate');
const { HttpError, bad } = require('../lib/http');
const { toCsv } = require('../lib/csv');
const { fold } = require('../lib/text');
const { parseKeywordFile } = require('../lib/keywordFile');
const settings = require('./settings');
const limits = require('./limits');
const providers = require('./providers');
const runs = require('./runs');
const dfs = require('./dataforseo');

/**
 * Keywords and their REAL search data (DataForSEO).
 *  - nothing here is invented: a keyword the provider has no data for is stored as "found = false" and shown as "Veri bulunamadı", never as 0
 *  - cost control: one batched request for up to 700 keywords, results cached for `seo.cacheDays` (a cached keyword is neither requested nor counted against the
 *    daily limit), the daily `seo_keywords` limit and the provider/platform budgets are checked BEFORE the paid call
 *  - the money is recorded from the API's own `cost` field
 */
const BOT = 'keyword_research';
const ENDPOINT_OVERVIEW = dfs.EP.overview;
const MAX_PER_CALL = dfs.MAX_OVERVIEW_KEYWORDS;
const ORIGINS = ['manual', 'news', 'related', 'suggestion', 'question'];

/** a search phrase as the provider wants it: lower case, single spaces, 1-10 words, at most 80 characters, letters/digits and a few joiners */
function normalize(raw) {
  const s = String(raw || '').toLowerCase().replace(/[“”"]/g, '').replace(/[^\p{L}\p{N}\s'’+.&-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 80 || s.split(' ').length > 10) return null;
  return s;
}

async function credentials() {
  const secret = await providers.secretFor('dataforseo');
  const p = await providers.get('dataforseo');
  if (!secret || !p.extra.login) throw new HttpError(409, 'DataForSEO henüz ayarlanmadı: API Kullanımı sayfasından login ve API şifresini girip bağlantıyı test edin');
  return { login: p.extra.login, password: secret };
}

async function add(projectId, list, { origin = 'manual', country = 'US', language = 'en', topicId = null, categoryId = null } = {}) {
  V.oneOf(origin, 'Kaynak', ORIGINS);
  if (!Array.isArray(list)) throw bad('Anahtar kelimeler bir liste olmalı');
  if (list.length > 500) throw bad('Tek seferde en fazla 500 anahtar kelime eklenebilir');
  const cc = V.str(country, 'Ülke', { max: 2 }).toUpperCase();
  if (!dfs.LOCATIONS[cc]) throw bad(`Desteklenen ülkeler: ${Object.keys(dfs.LOCATIONS).join(', ')}`);
  const clean = [...new Set(list.map(normalize).filter(Boolean))];
  const invalid = list.length - list.filter((x) => normalize(x)).length;
  let added = 0;
  if (clean.length) added = (await db.query(`INSERT INTO keywords (project_id, keyword, country, language, origin, topic_id, category_id) SELECT $1, k, $3, $4, $5, $6, $7 FROM unnest($2::text[]) AS k
    ON CONFLICT (project_id, keyword, country, language) DO NOTHING`, [projectId, clean, cc, language, origin, topicId, categoryId])).rowCount;
  return { added, existing: clean.length - added, invalid };
}

const metricShape = (r) => (r.m_id ? { provider: r.m_provider, fetchedAt: r.fetched_at, found: r.found, searchVolume: r.search_volume, cpc: r.cpc === null ? null : Number(r.cpc), paidCompetition: r.paid_competition === null ? null : Number(r.paid_competition),
  competitionLevel: r.competition_level, keywordDifficulty: r.keyword_difficulty, intent: r.intent, monthlySearches: r.monthly_searches, trendPct: r.trend_pct === null ? null : Number(r.trend_pct) } : null);

function shape(r, cacheDays, now) {
  const metrics = metricShape(r);
  const stale = metrics ? (now - new Date(metrics.fetchedAt)) / 86400000 > cacheDays : false;
  return { id: r.id, keyword: r.keyword, country: r.country, language: r.language, origin: r.origin, topicId: r.topic_id, categoryId: r.category_id, categoryName: r.category_name, createdAt: r.created_at,
    dataState: !metrics ? 'none' : metrics.found ? 'found' : 'not_found', stale, metrics,
    serp: r.serp_id ? { id: r.serp_id, competition: r.serp_competition, fetchedAt: r.serp_at } : null };
}

const SORTS = { keyword: 'lower(k.keyword)', volume: 'm.search_volume', cpc: 'm.cpc', trend: 'm.trend_pct', competition: 's.competition', created: 'k.created_at', fetched: 'm.fetched_at' };

async function list(projectId, q = {}, { now = new Date() } = {}) {
  const cacheDays = (await settings.get('seo', projectId)).value.cacheDays;
  const p = [projectId]; const w = ['k.project_id = $1'];
  const add2 = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (q.q) add2("k.keyword ILIKE ? ESCAPE '\\'", `%${String(q.q).slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (q.country) add2('k.country = ?', String(q.country).toUpperCase().slice(0, 2));
  if (q.categoryId) add2('k.category_id = ?', V.uuid(q.categoryId, 'Kategori'));
  if (q.origin) add2('k.origin = ?', V.oneOf(q.origin, 'Kaynak', ORIGINS));
  if (q.topicId) add2('k.topic_id = ?', V.uuid(q.topicId, 'Konu'));
  if (q.state === 'none') w.push('m.id IS NULL'); else if (q.state === 'found') w.push('m.found'); else if (q.state === 'not_found') w.push('m.id IS NOT NULL AND NOT m.found');
  if (q.minVolume !== undefined && q.minVolume !== '') add2('m.search_volume >= ?', V.int(q.minVolume, 'Minimum hacim', { min: 0 }));
  if (q.maxVolume !== undefined && q.maxVolume !== '') add2('m.search_volume <= ?', V.int(q.maxVolume, 'Maksimum hacim', { min: 0 }));
  if (q.minCpc !== undefined && q.minCpc !== '') add2('m.cpc >= ?', Number(q.minCpc) || 0);
  if (q.maxCompetition !== undefined && q.maxCompetition !== '') add2('s.competition <= ?', V.int(q.maxCompetition, 'Organik rekabet', { min: 0, max: 100 }));
  if (q.minTrend !== undefined && q.minTrend !== '') add2('m.trend_pct >= ?', Number(q.minTrend) || 0);
  if (q.intent) add2('m.intent = ?', String(q.intent).slice(0, 20));
  const size = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 50)); const page = Math.max(1, parseInt(q.page, 10) || 1);
  const sort = SORTS[q.sort] || SORTS.created; const dir = String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const from = `FROM keywords k LEFT JOIN categories c ON c.id = k.category_id
    LEFT JOIN LATERAL (SELECT * FROM keyword_metrics x WHERE x.keyword_id = k.id ORDER BY x.fetched_at DESC LIMIT 1) m ON true
    LEFT JOIN LATERAL (SELECT id, competition, fetched_at FROM serp_analyses y WHERE y.keyword_id = k.id ORDER BY y.fetched_at DESC LIMIT 1) s ON true WHERE ${w.join(' AND ')}`;
  const total = (await db.query(`SELECT count(*)::int n ${from}`, p)).rows[0].n;
  const rows = (await db.query(`SELECT k.*, c.name_en AS category_name, m.id AS m_id, m.provider AS m_provider, m.fetched_at, m.found, m.search_volume, m.cpc, m.paid_competition, m.competition_level, m.keyword_difficulty, m.intent, m.monthly_searches, m.trend_pct,
    s.id AS serp_id, s.competition AS serp_competition, s.fetched_at AS serp_at ${from} ORDER BY ${sort} ${dir} NULLS LAST, k.id LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, size, (page - 1) * size])).rows;
  return { total, page, pageSize: size, cacheDays, items: rows.map((r) => shape(r, cacheDays, now)) };
}

async function exportCsv(projectId, q = {}) {
  const { items } = await list(projectId, { ...q, pageSize: 200, page: 1 });
  const body = toCsv(items, [
    { label: 'Anahtar kelime', key: 'keyword' }, { label: 'Ülke', key: 'country' }, { label: 'Veri durumu', get: (r) => ({ none: 'Henüz sorgulanmadı', found: 'Var', not_found: 'Veri bulunamadı' }[r.dataState]) },
    { label: 'Aylık arama hacmi', get: (r) => r.metrics && r.metrics.searchVolume }, { label: 'CPC (USD)', get: (r) => r.metrics && r.metrics.cpc }, { label: 'Ücretli rekabet (0-1)', get: (r) => r.metrics && r.metrics.paidCompetition },
    { label: 'Anahtar kelime zorluğu (DataForSEO)', get: (r) => r.metrics && r.metrics.keywordDifficulty }, { label: 'Arama niyeti', get: (r) => r.metrics && r.metrics.intent }, { label: 'Trend (%)', get: (r) => r.metrics && r.metrics.trendPct },
    { label: 'Organik rekabet tahmini (0-100)', get: (r) => r.serp && r.serp.competition }, { label: 'Son kontrol', get: (r) => r.metrics && new Date(r.metrics.fetchedAt).toISOString() }, { label: 'Kaynak', key: 'origin' },
  ]);
  return { filename: `keywords-${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv; charset=utf-8', body };
}

async function remove(projectId, ids) {
  const list2 = (ids || []).map((x) => V.uuid(x, 'Anahtar kelime'));
  if (!list2.length || list2.length > 500) throw bad('1 ile 500 arasında anahtar kelime seçin');
  return (await db.query('DELETE FROM keywords WHERE project_id = $1 AND id = ANY($2)', [projectId, list2])).rowCount;
}

// ── metrics ──────────────────────────────────────────────────────────────────────────────────────────────────
async function needing(projectId, { ids, cacheDays, now }) {
  const p = [projectId, new Date(now.getTime() - cacheDays * 86400000)]; let sel = '';
  if (ids && ids.length) { p.push(ids.map((x) => V.uuid(x, 'Anahtar kelime'))); sel = 'AND k.id = ANY($3)'; }
  return (await db.query(`SELECT k.id, k.keyword, k.country, k.language FROM keywords k
    WHERE k.project_id = $1 ${sel} AND NOT EXISTS (SELECT 1 FROM keyword_metrics m WHERE m.keyword_id = k.id AND m.fetched_at >= $2) ORDER BY k.created_at, k.id`, p)).rows;
}

/** A dry run for the confirmation dialog: how many are cached, how many would be asked, what the limits and the budget allow, a rough price. */
async function plan(projectId, { ids, now = new Date() } = {}) {
  const cfg = (await settings.get('seo', projectId)).value;
  const need = await needing(projectId, { ids, cacheDays: cfg.cacheDays, now });
  const total = ids && ids.length ? ids.length : (await db.query('SELECT count(*)::int n FROM keywords WHERE project_id = $1', [projectId])).rows[0].n;
  const st = (await limits.status({ projectId, now })).items.find((i) => i.workType === 'seo_keywords');
  const allowed = Math.min(need.length, st.project ? st.project.remaining : st.remaining, st.remaining);
  const requests = Math.ceil(allowed / MAX_PER_CALL);
  const p = await providers.get('dataforseo');
  return { total, cached: total - need.length, toAsk: need.length, allowedToday: allowed, requests, estimatedCostUsd: Math.round(requests * dfs.ESTIMATE_USD.overview * 10000) / 10000, estimateNote: 'Tahmindir; gerçek tutar DataForSEO’nun cevabındaki maliyettir.',
    limit: { limit: st.limit, done: st.done, remaining: st.remaining }, configured: p.configured && !!p.extra.login, cacheDays: cfg.cacheDays };
}

async function saveMetrics(keywordId, rec, { endpoint, cost, provider = 'dataforseo' }) {
  const trend = rec.found ? dfs.trendPct(rec.monthly) : null;
  await db.query(`INSERT INTO keyword_metrics (keyword_id, endpoint, found, search_volume, cpc, paid_competition, competition_level, keyword_difficulty, intent, monthly_searches, trend_pct, avg_referring_domains, cost_micros, provider)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [keywordId, endpoint, rec.found, rec.searchVolume, rec.cpc, rec.paidCompetition, rec.competitionLevel, rec.keywordDifficulty, rec.intent, JSON.stringify(rec.monthly), trend, rec.avgReferringDomains, cost === null || cost === undefined ? null : Math.round(cost * 1e6), provider]);
}

/**
 * Search volumes from a FILE the owner exported elsewhere (Google Ads Keyword Planner, Keywords Everywhere, a spreadsheet ...): the free way to real demand data.
 *  - only EXACT volumes are imported (ranges like "1K - 10K" and rounded "10K" are skipped and counted, see lib/keywordFile.js); nothing is estimated
 *  - the keywords are added when the project does not have them yet; the rows are stored as the newest metrics (provider "csv"), so they replace older data of the same keyword
 *  - no paid call, so no provider budget and no daily `seo_keywords` limit is touched; the whole import is a fixed number of statements however long the file is
 * @returns { rows, imported, added, updated, skipped, examples, columns, trendRows }
 */
async function importMetrics(projectId, text, { country = 'US', language = 'en', userId = null, now = new Date() } = {}) {
  const cc = V.str(country, 'Ülke', { max: 2 }).toUpperCase();
  if (!dfs.LOCATIONS[cc]) throw bad(`Desteklenen ülkeler: ${Object.keys(dfs.LOCATIONS).join(', ')}`);
  if (typeof text !== 'string' || !text.trim()) throw bad('Dosya boş');
  if (text.length > 2_000_000) throw bad('Dosya çok büyük (en fazla yaklaşık 2 MB)');
  let parsed;
  try { parsed = parseKeywordFile(text, { maxRows: 2000 }); } catch (err) { if (err.code) throw bad(err.message); throw err; }
  const byKw = new Map();                                                         // the same phrase twice in a file: the later row wins
  let invalid = 0;
  for (const r of parsed.rows) { const k = normalize(r.keyword); if (!k) { invalid++; continue; } byKw.set(k, r); }
  const phrases = [...byKw.keys()];
  const out = { rows: parsed.rows.length + parsed.skipped.range + parsed.skipped.rounded + parsed.skipped.empty + parsed.skipped.bad, imported: 0, added: 0, updated: 0, trendRows: 0,
    skipped: { ...parsed.skipped, invalid }, examples: parsed.examples, columns: parsed.columns, delimiter: parsed.delimiter };
  if (!phrases.length) return { ...out, message: 'İçe aktarılacak, kesin hacmi olan satır bulunamadı' };
  const run = await runs.start(BOT, { projectId, trigger: 'manual', userId });
  try {
    const before = new Set((await db.query('SELECT keyword FROM keywords WHERE project_id = $1 AND country = $2 AND language = $3 AND keyword = ANY($4)', [projectId, cc, language, phrases])).rows.map((r) => r.keyword));
    await db.query(`INSERT INTO keywords (project_id, keyword, country, language, origin) SELECT $1, k, $2, $3, 'manual' FROM unnest($4::text[]) AS k ON CONFLICT (project_id, keyword, country, language) DO NOTHING`, [projectId, cc, language, phrases]);
    const ids = new Map((await db.query('SELECT id, keyword FROM keywords WHERE project_id = $1 AND country = $2 AND language = $3 AND keyword = ANY($4)', [projectId, cc, language, phrases])).rows.map((r) => [r.keyword, r.id]));
    const rows = phrases.map((k) => { const r = byKw.get(k); const trend = dfs.trendPct(r.monthly); if (trend !== null) out.trendRows++;
      return { keyword_id: ids.get(k), found: true, search_volume: r.volume, cpc: r.cpc, paid_competition: r.competition, competition_level: r.competitionLevel, keyword_difficulty: r.difficulty, monthly: r.monthly, trend_pct: trend }; });
    await db.query(`INSERT INTO keyword_metrics (keyword_id, provider, endpoint, found, search_volume, cpc, paid_competition, competition_level, keyword_difficulty, monthly_searches, trend_pct, fetched_at)
      SELECT x.keyword_id, 'csv', 'csv-import', x.found, x.search_volume, x.cpc, x.paid_competition, x.competition_level, x.keyword_difficulty, x.monthly, x.trend_pct, $2
      FROM jsonb_to_recordset($1::jsonb) AS x(keyword_id uuid, found boolean, search_volume int, cpc numeric, paid_competition numeric, competition_level text, keyword_difficulty int, monthly jsonb, trend_pct numeric)`, [JSON.stringify(rows), now]);
    out.imported = phrases.length; out.updated = [...before].length; out.added = phrases.length - out.updated;
    await runs.finish(run.id, { status: 'ok', stats: { source: 'csv', imported: out.imported, added: out.added, updated: out.updated, skipped: out.skipped } });
  } catch (err) { await runs.finish(run.id, { status: 'error', stats: { source: 'csv' }, error: err.message }); throw err; }
  const sk = out.skipped; const skippedTotal = sk.range + sk.rounded + sk.empty + sk.bad + sk.noKeyword + sk.invalid;
  return { ...out, message: `${out.imported} anahtar kelimenin hacmi içe aktarıldı (${out.added} yeni kelime, ${out.updated} mevcut kelime güncellendi)${skippedTotal ? `; ${skippedTotal} satır atlandı` : ''}` };
}

/**
 * Asks DataForSEO for the keywords that have no fresh data. Returns what happened; never throws for "limit full" / "budget full" (those are answers).
 * @param opts { ids?, userId, manual, fetchImpl, now, trigger }
 */
async function fetchMetrics(projectId, { ids, userId = null, manual = true, fetchImpl, now = new Date(), trigger = 'manual' } = {}) {
  const creds = await credentials();
  const cfg = (await settings.get('seo', projectId)).value;
  const need = await needing(projectId, { ids, cacheDays: cfg.cacheDays, now });
  const total = ids && ids.length ? ids.length : (await db.query('SELECT count(*)::int n FROM keywords WHERE project_id = $1', [projectId])).rows[0].n;
  const out = { requested: need.length, cached: total - need.length, fetched: 0, found: 0, notFound: 0, requests: 0, costUsd: 0, unknownCost: 0, limited: 0, stopped: null };
  if (!need.length) return { ...out, message: 'Tüm anahtar kelimelerin güncel verisi var (önbellekten)' };
  const client = dfs.createClient({ ...creds, fetchImpl });
  const run = await runs.start(BOT, { projectId, trigger, userId });
  let status = 'ok';
  try {
    const groups = new Map();
    for (const k of need) { const key2 = `${k.country}|${k.language}`; if (!groups.has(key2)) groups.set(key2, []); groups.get(key2).push(k); }
    outer: for (const [key2, all] of groups) {
      const [country, language] = key2.split('|');
      for (let i = 0; i < all.length; i += MAX_PER_CALL) {
        const batch = all.slice(i, i + MAX_PER_CALL);
        const guard = await providers.guard('dataforseo', dfs.ESTIMATE_USD.overview, { projectId, now, operation: 'keyword_overview' });
        if (!guard.ok) { out.stopped = guard.message; status = 'partial'; break outer; }
        const grant = await limits.reserveUpTo({ workType: 'seo_keywords', projectId, amount: batch.length, manual, now });
        if (!grant.ok) { out.stopped = grant.message; out.limited += batch.length; status = 'partial'; break outer; }
        const asked = batch.slice(0, grant.granted); out.limited += batch.length - asked.length;
        if (grant.granted < batch.length) { out.stopped = `Günlük anahtar kelime limiti nedeniyle ${grant.granted}/${batch.length} sorgulandı`; status = 'partial'; }
        let res;
        try { res = await client.keywordOverview({ keywords: asked.map((k) => k.keyword), country, language }); }
        catch (err) {
          await providers.recordUsage({ provider: 'dataforseo', endpoint: ENDPOINT_OVERVIEW, operation: 'keyword_overview', requests: 1, units: asked.length, costUsd: null, result: 'error', projectId, meta: { code: err.code } });
          if (!err.maybeBilled) await limits.release({ workType: 'seo_keywords', projectId, amount: asked.length, day: grant.day });
          out.stopped = err.message; status = out.fetched ? 'partial' : 'error'; break outer;
        }
        out.requests++;
        const byKw = new Map(res.records.map((r) => [r.keyword, r]));
        for (const k of asked) {
          const rec = byKw.get(k.keyword) || { found: false, searchVolume: null, cpc: null, paidCompetition: null, competitionLevel: null, keywordDifficulty: null, intent: null, monthly: [], avgReferringDomains: null };
          await saveMetrics(k.id, rec, { endpoint: ENDPOINT_OVERVIEW, cost: res.cost === null ? null : res.cost / asked.length });
          out.fetched++; if (rec.found) out.found++; else out.notFound++;
        }
        if (res.cost === null || res.cost === undefined) out.unknownCost++; else out.costUsd = Math.round((out.costUsd + res.cost) * 1e6) / 1e6;
        await providers.recordUsage({ provider: 'dataforseo', endpoint: ENDPOINT_OVERVIEW, operation: 'keyword_overview', requests: 1, units: asked.length, costUsd: res.cost, projectId, meta: { country, found: byKw.size } });
      }
    }
    await runs.finish(run.id, { status, stats: out, error: status === 'error' ? out.stopped : null });
  } catch (err) {
    await runs.finish(run.id, { status: 'error', stats: out, error: err.message });
    throw err;
  }
  return { ...out, message: out.stopped || `${out.fetched} anahtar kelime sorgulandı (${out.found} veri bulundu, ${out.notFound} için veri bulunamadı)` };
}

/**
 * Related / long-tail / question keywords for a seed phrase. The answer already holds each keyword's metrics, so they are stored with data in the same step.
 * @param opts { mode: 'suggestions' | 'related', limit (<= 100), country, topicId, categoryId, userId, manual, fetchImpl, now }
 */
async function suggest(projectId, seed, { mode = 'suggestions', limit = 50, country = 'US', language = 'en', topicId = null, categoryId = null, userId = null, manual = true, fetchImpl, now = new Date() } = {}) {
  const kw = normalize(seed);
  if (!kw) throw bad('Başlangıç ifadesi 1-10 kelime ve en fazla 80 karakter olmalı');
  V.oneOf(mode, 'Tür', ['suggestions', 'related']);
  const cc = String(country).toUpperCase(); if (!dfs.LOCATIONS[cc]) throw bad(`Desteklenen ülkeler: ${Object.keys(dfs.LOCATIONS).join(', ')}`);
  const lim = Math.min(100, Math.max(1, V.int(limit, 'Sınır', { min: 1, max: 100 })));
  const creds = await credentials();
  const endpoint = mode === 'related' ? dfs.EP.related : dfs.EP.suggestions;
  const guard = await providers.guard('dataforseo', mode === 'related' ? dfs.ESTIMATE_USD.related : dfs.ESTIMATE_USD.suggestions, { projectId, now, operation: `keyword_${mode}` });
  if (!guard.ok) return { added: 0, existing: 0, stopped: guard.message, costUsd: 0 };
  const grant = await limits.reserveUpTo({ workType: 'seo_keywords', projectId, amount: lim, manual, now });
  if (!grant.ok) return { added: 0, existing: 0, stopped: grant.message, costUsd: 0 };
  const client = dfs.createClient({ ...creds, fetchImpl });
  const run = await runs.start(BOT, { projectId, trigger: 'manual', userId });
  let res;
  try { res = mode === 'related' ? await client.relatedKeywords({ keyword: kw, country: cc, language, limit: grant.granted }) : await client.keywordSuggestions({ keyword: kw, country: cc, language, limit: grant.granted }); }
  catch (err) {
    await providers.recordUsage({ provider: 'dataforseo', endpoint, operation: `keyword_${mode}`, requests: 1, costUsd: null, result: 'error', projectId, meta: { code: err.code } });
    if (!err.maybeBilled) await limits.release({ workType: 'seo_keywords', projectId, amount: grant.granted, day: grant.day });
    await runs.finish(run.id, { status: 'error', stats: { seed: kw }, error: err.message });
    throw new HttpError(err.code === 'auth' ? 401 : 502, err.message, { code: err.code });
  }
  let added = 0; let existing = 0; let withData = 0;
  for (const rec of res.records) {
    const k = normalize(rec.keyword); if (!k) continue;
    const origin = isQuestionKw(k) ? 'question' : mode === 'related' ? 'related' : 'suggestion';
    const ins = (await db.query('INSERT INTO keywords (project_id, keyword, country, language, origin, topic_id, category_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (project_id, keyword, country, language) DO NOTHING RETURNING id', [projectId, k, cc, language, origin, topicId, categoryId])).rows[0];
    const id = ins ? ins.id : (await db.query('SELECT id FROM keywords WHERE project_id = $1 AND keyword = $2 AND country = $3 AND language = $4', [projectId, k, cc, language])).rows[0].id;
    if (ins) added++; else existing++;
    await saveMetrics(id, rec, { endpoint, cost: null }); if (rec.found) withData++;
  }
  if (res.records.length < grant.granted) await limits.release({ workType: 'seo_keywords', projectId, amount: grant.granted - res.records.length, day: grant.day });
  await providers.recordUsage({ provider: 'dataforseo', endpoint, operation: `keyword_${mode}`, requests: 1, units: res.records.length, costUsd: res.cost, projectId, meta: { seed: kw, country: cc } });
  await runs.finish(run.id, { status: 'ok', stats: { seed: kw, mode, returned: res.records.length, added, existing, withData, costUsd: res.cost } });
  return { added, existing, returned: res.records.length, withData, costUsd: res.cost, stopped: null };
}

const isQuestionKw = (k) => dfs.isQuestion(k);

const SUFFIX = new Set(['pro', 'max', 'plus', 'mini', 'ultra', 'air', 'lite', 'fold', 'flip', 'premium', 'family', 'advanced', 'enterprise', 'business', 'team', 'edition', 'go']);
/** words that describe WHAT happened (a breach, a price rise), not WHICH product: they are attached to a product / company name, never used alone */
const DESCRIPTIVE = new Set(['data breach', 'breach', 'breached', 'security breach', 'zero-day', 'zero day', 'exploit', 'exploited', 'ransomware', 'phishing', 'malware', 'spyware', 'stalkerware', 'infostealer', 'vulnerability', 'vulnerabilities', 'security update', 'security patch',
  'security flaw', 'security advisory', 'cyberattack', 'cyberattacks', 'cybersecurity', 'hackers', 'hacker', 'hacked', 'hijack', 'hijacked', 'data leak', 'stolen data', 'price increase', 'price hike', 'raises price', 'raises prices', 'subscription', 'subscriptions', 'free plan', 'paid plan',
  'pricing plan', 'membership', 'ad-supported', 'ads tier', 'terms of service', 'terms of use', 'online scam', 'text scam', 'phishing scam', 'scam texts', 'scam calls', 'deepfake', 'identity theft', 'data privacy', 'privacy settings', 'known exploited', 'kev catalog', 'botnet',
  'account takeover', 'end of support', 'no longer supported', 'sunsetting', 'retiring', 'release notes', 'patch notes', 'changelog', 'redesign', 'discontinued', 'beta', 'stable channel', 'generative ai', 'ai tool', 'ai tools', 'ai app', 'ai feature', 'ai agent', 'ai agents', 'ai assistant',
  'large language model', 'llm', 'chatbot', 'chatbots', 'voice assistant', 'tutorial', 'troubleshoot', 'troubleshooting', 'step by step', 'how to', 'rolling out', 'rolls out', 'now available', 'what is', 'turn on', 'turn off', 'per month', 'a month', 'worth it', 'cheat sheet']);
const NOT_A_NAME = new Set(['the', 'a', 'an', 'how', 'why', 'what', 'new', 'this', 'that', 'vendor', 'company', 'report', 'reports', 'researcher', 'researchers', 'experts', 'study', 'here', 'meet', 'get', 'now', 'just', 'best', 'top', 'inside', 'after', 'amid', 'former', 'big', 'small', 'free', 'open', 'every', 'more', 'most', 'all', 'one', 'two', 'hackers', 'hacker', 'major', 'everything', 'watch']);
const brandLike = (w) => (/^[A-Z]{3,}[a-z]*$/.test(w) || /[a-z][A-Z]/.test(w) || /[A-Za-z]\d|\d[A-Za-z]/.test(w)) && w.length >= 3;   // OpenAI, CISA, ChatGPT, iPhone, KB5132057, 26H2 (not plain "AI", not plain words)

/**
 * A few plausible search phrases for a news event. They are only CANDIDATES (DataForSEO decides if anyone searches for them) and are built conservatively, because every
 * candidate counts against the day's keyword limit. Names come from, in this order of trust: terms the niche filter matched (the categories' own curated lists),
 * brand-like words (ChatGPT, OpenAI, iPhone, KB5132057), and - only in a normally written headline - the proper name that opens it ("Staples Canada says ...").
 * Never guessed word sequences. A version number or a product suffix right after a name is kept ("windows 11", "airpods pro 3"). What happened (breach, price rise ...)
 * is attached to the first name; nothing is used without a name.
 * @param opts { categoryName, known: lower-case terms of the project's category keyword lists, matched: terms the niche filter matched }
 */
function candidatesFor(title, { categoryName = '', matched = [] } = {}) {
  const clean = String(title || '').replace(/[“”"]/g, '');
  const raw = clean.split(/\s+/).filter(Boolean).map((w) => w.replace(/^[(\[]+|[)\],.:;!?’']+$/g, '')).filter(Boolean);
  const low = raw.map((w) => w.toLowerCase());
  const caps = raw.filter((w) => /^[A-Z]/.test(w)).length;
  const titleCase = raw.length >= 5 && caps / raw.length >= 0.7;                              // "OpenAI Begins Testing Dots With ChatGPT Plus Users": capital letters say nothing
  const found = new Map();                                                                     // name -> position in the headline
  const addName = (name, pos) => { const n = name.toLowerCase().trim(); if (n.length >= 3 && !found.has(n)) found.set(n, pos); };
  for (const m of matched) { const lm = m.toLowerCase(); if (!DESCRIPTIVE.has(lm)) { const i = low.findIndex((_, k) => low.slice(k, k + lm.split(' ').length).join(' ') === lm); addName(lm, i < 0 ? 99 : i); } }
  raw.forEach((w, i) => { if (brandLike(w)) addName(w, i); });
  if (!titleCase && raw.length >= 3 && /^[A-Z][a-z]{2,}$/.test(raw[0])) {                      // proper name at the start, followed by a lower-case word
    let end = 1; while (end < Math.min(3, raw.length - 1) && /^[A-Z][a-z]+$/.test(raw[end])) end++;
    if (/^[a-z]/.test(raw[end] || '') && !NOT_A_NAME.has(low[0])) addName(raw.slice(0, end).join(' '), 0);
  }
  // extend a name with a version number / product suffix that follows it, then drop names that are only parts of a longer one
  let names = [...found].sort((a, b) => a[1] - b[1]).map(([n, pos]) => {
    const parts = n.split(' '); let end = (pos >= 0 && pos < 99 ? pos : -1) + parts.length; let ext = n;
    for (let k = 0; k < 2 && pos < 99 && end < low.length; k++) { const nx = low[end]; if (/^\d+(\.\d+)?[a-z0-9]*$/.test(nx) || SUFFIX.has(nx)) { ext += ` ${nx}`; end++; } else break; }
    return ext;
  });
  names = [...new Set(names)].filter((n, i, all) => !all.some((o, j) => j !== i && o.length > n.length && o.includes(n))).slice(0, 3);
  const t = fold(title); const out = new Set(); const has = (re) => re.test(t);
  names.forEach((e, idx) => {
    out.add(e);
    if (idx > 0) return;
    if (has(/\b(updat|releas|roll|patch|version|launch|introduc)/)) out.add(`${e} update`);
    if (has(/\b(feature|adds|gets|lets|can now|now lets|support)/)) out.add(`${e} new features`);
    if (has(/\b(price|pricing|subscription|plan|cost|premium|upgrade)/) || /pricing/i.test(categoryName)) out.add(`${e} pricing`);
    if (has(/\b(outage|down|bug|issue|problem|broken|not working|error)/)) out.add(`${e} not working`);
    for (const m of matched) if (DESCRIPTIVE.has(m.toLowerCase()) && m.split(' ').length >= 2 && !WEAK_ONLY.has(m.toLowerCase())) out.add(`${e} ${m.toLowerCase()}`);
  });
  return [...out].map(normalize).filter(Boolean).slice(0, 5);
}
const WEAK_ONLY = new Set(['how to', 'rolling out', 'rolls out', 'now available', 'what is', 'turn on', 'turn off', 'per month', 'a month', 'worth it', 'cheat sheet', 'step by step', 'terms of use', 'terms of service', 'generative ai', 'ai tool', 'ai tools', 'ai app', 'ai feature', 'ai agent', 'ai agents', 'ai assistant']);

/** Candidates for a topic are added to the keyword list (origin "news") and linked to the topic; returns the keyword rows. */
async function generateForTopic(topicId) {
  const t = (await db.query('SELECT t.*, c.name_en AS category_name FROM topics t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = $1', [topicId])).rows[0];
  if (!t) throw new HttpError(404, 'Konu bulunamadı');
  const cfg = (await settings.get('seo', t.project_id)).value;
  const country = (cfg.countries && cfg.countries[0]) || 'US';
  const known = (await db.query("SELECT related_keywords FROM categories WHERE project_id = $1 AND status <> 'archived'", [t.project_id])).rows.flatMap((r) => r.related_keywords);
  const matched = t.cluster_id ? ((await db.query('SELECT matched_terms FROM news_clusters WHERE id = $1', [t.cluster_id])).rows[0] || { matched_terms: [] }).matched_terms : [];
  const cands = candidatesFor(t.title, { categoryName: t.category_name || '', known, matched });
  const r = await add(t.project_id, cands, { origin: 'news', country, topicId, categoryId: t.category_id });
  await db.query('UPDATE keywords SET topic_id = COALESCE(topic_id, $2) WHERE project_id = $1 AND keyword = ANY($3) AND country = $4', [t.project_id, topicId, cands, country]);
  return { ...r, candidates: cands };
}

module.exports = { BOT, normalize, add, list, exportCsv, remove, plan, fetchMetrics, importMetrics, suggest, candidatesFor, generateForTopic, MAX_PER_CALL };
