const crypto = require('node:crypto');
const db = require('../db');
const V = require('../lib/validate');
const { HttpError, bad } = require('../lib/http');
const { fetchText, checkUrl, FetchError } = require('../lib/safeFetch');
const { parseFeed, parseGdelt, googleNewsUrl, gdeltUrl } = require('../lib/feed');
const { signature, sameEvent, canonicalUrl, urlHash, phrases } = require('../lib/text');
const { classify, loadContext } = require('./relevance');
const settings = require('./settings');
const limits = require('./limits');
const runs = require('./runs');
const notifications = require('./notifications');

/**
 * World news: sources -> fetch -> headlines -> niche filter -> events (clusters).
 *  - what is kept per headline: title, link, source, date, a short summary (400 characters), language, country, phrases; never the full text
 *  - the same link is stored once; headlines about the same event from different sources form one cluster (the number of sources is the trend signal)
 *  - a headline outside the niche (or on an excluded topic) is stored for the record but is never a candidate for an article
 *  - the day's "news_items" limit is respected (partial runs are fine), sources that fail or rate-limit back off by themselves
 */
const BOT = 'news_discovery';
const NOTE = 'Yalnızca başlık, bağlantı ve kısa özet saklanır; haberin tam metni alınmaz.';
const SOURCE_TYPES = ['official', 'publisher', 'aggregator', 'user'];
const KINDS = ['rss', 'google_news', 'gdelt'];
const MAX_SOURCES = 100;
const GAP_MS = { gdelt: 6000 };                // GDELT asks for one request every 5 seconds

const rss = (name, url, type, reliability) => ({ kind: 'rss', name, url, query: '', source_type: type, reliability, enabled: true });
const gnews = (name, query) => ({ kind: 'google_news', name, url: googleNewsUrl(query), query, source_type: 'aggregator', reliability: 55, enabled: true });
/** Sources every new default project starts with: official announcements, security bulletins, update logs, tech outlets with public feeds, Google News searches per category. */
const DEFAULT_SOURCES = [
  rss('CISA Advisories', 'https://www.cisa.gov/cybersecurity-advisories/all.xml', 'official', 95),
  rss('OpenAI News', 'https://openai.com/news/rss.xml', 'official', 90),
  rss('Google Blog', 'https://blog.google/rss/', 'official', 90),
  rss('Google Chrome Releases', 'https://chromereleases.googleblog.com/feeds/posts/default', 'official', 90),
  rss('Apple Newsroom', 'https://www.apple.com/newsroom/rss-feed.rss', 'official', 90),
  rss('Microsoft Windows Blog', 'https://blogs.windows.com/feed/', 'official', 85),
  rss('Mozilla Blog', 'https://blog.mozilla.org/en/feed/', 'official', 85),
  rss('Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index', 'publisher', 80),
  rss('TechCrunch', 'https://techcrunch.com/feed/', 'publisher', 75),
  rss('Wired', 'https://www.wired.com/feed/rss', 'publisher', 75),
  rss('BleepingComputer', 'https://www.bleepingcomputer.com/feed/', 'publisher', 75),
  rss('The Hacker News', 'https://feeds.feedburner.com/TheHackersNews', 'publisher', 65),
  rss('Engadget', 'https://www.engadget.com/rss.xml', 'publisher', 70),
  rss('CNET News', 'https://www.cnet.com/rss/news/', 'publisher', 70),
  rss('ZDNET News', 'https://www.zdnet.com/news/rss.xml', 'publisher', 70),
  rss('9to5Mac', 'https://9to5mac.com/feed/', 'publisher', 70),
  rss('Android Central', 'https://www.androidcentral.com/feed', 'publisher', 65),
  gnews('Google News: AI tools', '(ChatGPT OR Gemini OR Claude OR Copilot OR "AI tool" OR "AI app" OR OpenAI) when:1d'),
  gnews('Google News: app & software updates', '("app update" OR "software update" OR "iOS update" OR "Android update" OR "Windows update" OR "rolling out") when:1d'),
  gnews('Google News: security & privacy', '("data breach" OR phishing OR "zero-day" OR "security update" OR ransomware OR scam) when:1d'),
  gnews('Google News: subscriptions & pricing', '("price increase" OR "price hike" OR subscription OR "free plan") (Netflix OR Spotify OR ChatGPT OR YouTube OR Microsoft OR Google OR Apple) when:1d'),
  { kind: 'gdelt', name: 'GDELT: AI and breaches', url: gdeltUrl('("artificial intelligence" OR chatgpt OR "data breach")'), query: '("artificial intelligence" OR chatgpt OR "data breach")', source_type: 'aggregator', reliability: 50, enabled: false },
];

const shape = (r) => ({
  id: r.id, projectId: r.project_id, name: r.name, kind: r.kind, url: r.url, query: r.query, sourceType: r.source_type, reliability: r.reliability, country: r.country, language: r.language, enabled: r.enabled, termsNote: r.terms_note,
  lastFetchedAt: r.last_fetched_at, lastStatus: r.last_status, lastError: r.last_error, lastItemCount: r.last_item_count, failCount: r.fail_count, nextFetchAfter: r.next_fetch_after, createdAt: r.created_at,
});

// ── sources ────────────────────────────────────────────────────────────────────────────────────────────────
async function listSources(projectId) {
  const r = await db.query('SELECT s.*, (SELECT count(*)::int FROM news_items i WHERE i.source_id = s.id) AS item_count FROM news_sources s WHERE project_id = $1 ORDER BY enabled DESC, source_type, name', [projectId]);
  return r.rows.map((x) => ({ ...shape(x), itemCount: x.item_count }));
}

function sourceFields(b, { partial = false } = {}) {
  const f = {}; const has = (k) => !partial || b[k] !== undefined;
  if (has('name')) f.name = V.str(b.name, 'Kaynak adı', { required: true, max: 120 });
  if (has('kind')) f.kind = V.oneOf(b.kind || 'rss', 'Kaynak türü', KINDS);
  if (has('sourceType')) f.source_type = V.oneOf(b.sourceType, 'Kaynak sınıfı', SOURCE_TYPES, { fallback: 'user' });
  if (has('reliability')) f.reliability = V.int(b.reliability === undefined || b.reliability === '' ? 60 : b.reliability, 'Güvenilirlik', { min: 0, max: 100 });
  if (has('country')) f.country = V.str(b.country || 'US', 'Ülke', { max: 2 }).toUpperCase();
  if (has('language')) f.language = V.str(b.language || 'en', 'Dil', { max: 5 }).toLowerCase();
  if (b.enabled !== undefined) f.enabled = V.bool(b.enabled, 'Aktif');
  if (has('termsNote')) f.terms_note = V.str(b.termsNote === undefined ? NOTE : b.termsNote, 'Kullanım şartı notu', { max: 300 });
  if (b.url !== undefined) f.url = V.str(b.url, 'Adres', { max: 1000 });
  if (b.query !== undefined) f.query = V.str(b.query, 'Arama sorgusu', { max: 300 });
  if (f.country && !/^[A-Z]{2}$/.test(f.country)) throw bad('Ülke iki harfli kod olmalı (ör. US)');
  return f;
}

/** The address that is really fetched for a source of this kind (validated: only public http(s) addresses). */
function resolveUrl(kind, f) {
  if (kind === 'rss') {
    if (!f.url) throw bad('RSS/Atom adresi zorunlu');
    try { checkUrl(f.url); } catch (e) { throw bad(e.message); }
    return f.url;
  }
  if (!f.query) throw bad('Arama sorgusu zorunlu');
  return kind === 'google_news' ? googleNewsUrl(f.query, { country: f.country || 'US', language: f.language || 'en' }) : gdeltUrl(f.query);
}

async function createSource(projectId, body) {
  const f = sourceFields(body);
  if ((await db.query('SELECT count(*)::int n FROM news_sources WHERE project_id = $1', [projectId])).rows[0].n >= MAX_SOURCES) throw new HttpError(409, `Bir projede en fazla ${MAX_SOURCES} kaynak olabilir`);
  const url = resolveUrl(f.kind, f);
  try {
    const r = (await db.query(`INSERT INTO news_sources (project_id, name, kind, url, query, source_type, reliability, country, language, enabled, terms_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [projectId, f.name, f.kind, url, f.kind === 'rss' ? '' : f.query, f.source_type, f.reliability, f.country, f.language, f.enabled !== false, f.terms_note])).rows[0];
    return shape(r);
  } catch (err) { if (err.code === '23505') throw new HttpError(409, 'Bu adres bu projede zaten kaynak olarak ekli'); throw err; }
}

async function getSource(id) {
  const r = (await db.query('SELECT * FROM news_sources WHERE id = $1', [id])).rows[0];
  if (!r) throw new HttpError(404, 'Kaynak bulunamadı');
  return r;
}

async function updateSource(id, body) {
  const cur = await getSource(id);
  const f = sourceFields(body, { partial: true });
  if (f.kind && f.kind !== cur.kind) throw bad('Kaynağın türü değiştirilemez; yeni kaynak ekleyin');
  if (f.url !== undefined || f.query !== undefined || f.country !== undefined || f.language !== undefined) f.url = resolveUrl(cur.kind, { url: f.url === undefined ? cur.url : f.url, query: f.query === undefined ? cur.query : f.query, country: f.country || cur.country, language: f.language || cur.language });
  delete f.kind;
  const cols = Object.keys(f);
  if (cols.length) {
    const reset = f.url && f.url !== cur.url ? ', etag = NULL, last_modified = NULL, fail_count = 0, next_fetch_after = NULL' : (f.enabled === true ? ', fail_count = 0, next_fetch_after = NULL' : '');
    try { await db.query(`UPDATE news_sources SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}${reset}, updated_at = now() WHERE id = $${cols.length + 1}`, [...Object.values(f), id]); }
    catch (err) { if (err.code === '23505') throw new HttpError(409, 'Bu adres bu projede zaten kaynak olarak ekli'); throw err; }
  }
  return shape(await getSource(id));
}

async function deleteSource(id) { const r = await db.query('DELETE FROM news_sources WHERE id = $1', [id]); if (!r.rowCount) throw new HttpError(404, 'Kaynak bulunamadı'); }

/** Adds the default sources ONCE per project (a marker remembers it, so sources the owner deleted do not come back). */
async function seedDefaultSources(projectId) {
  const done = (await db.query("SELECT 1 FROM automation_settings WHERE scope = 'project' AND project_id = $1 AND key = 'news_sources_seeded'", [projectId])).rows[0];
  if (done) return 0;
  let n = 0;
  for (const s of DEFAULT_SOURCES) {
    const r = await db.query(`INSERT INTO news_sources (project_id, name, kind, url, query, source_type, reliability, country, language, enabled, terms_note) VALUES ($1,$2,$3,$4,$5,$6,$7,'US','en',$8,$9) ON CONFLICT DO NOTHING`,
      [projectId, s.name, s.kind, s.url, s.query, s.source_type, s.reliability, s.enabled, NOTE]);
    n += r.rowCount;
  }
  await db.query("INSERT INTO automation_settings (scope, project_id, key, value) VALUES ('project', $1, 'news_sources_seeded', $2) ON CONFLICT DO NOTHING", [projectId, JSON.stringify({ count: n })]);
  return n;
}

// ── fetching ────────────────────────────────────────────────────────────────────────────────────────────────
const explain = (err) => {
  if (err instanceof FetchError) return err.message;
  return `Beklenmeyen hata: ${String(err && err.message).slice(0, 160)}`;
};

/** Reads one source. `fetchImpl(url, opts)` is injectable (tests); the default is the SSRF-safe fetcher. */
async function readSource(source, { fetchImpl = fetchText } = {}) {
  const res = await fetchImpl(source.url, { etag: source.etag || undefined, lastModified: source.last_modified || undefined });
  if (res.notModified) return { notModified: true, items: [], etag: res.etag || source.etag, lastModified: res.lastModified || source.last_modified };
  let parsed;
  try { parsed = source.kind === 'gdelt' ? parseGdelt(res.body) : parseFeed(res.body, res.url || source.url); }
  catch (e) { throw new FetchError('parse', source.kind === 'gdelt' ? 'GDELT geçerli bir JSON döndürmedi (hız sınırı olabilir)' : `Yayın okunamadı: ${e.message}`); }
  return { notModified: false, items: parsed.items, feedTitle: parsed.title, etag: res.etag, lastModified: res.lastModified };
}

/** Tries a source without saving anything: how many headlines and the first few. */
async function testSource(id, deps = {}) {
  const source = await getSource(id);
  const t0 = Date.now();
  try {
    const r = await readSource({ ...source, etag: null, last_modified: null }, deps);
    return { ok: true, itemCount: r.items.length, feedTitle: r.feedTitle || '', ms: Date.now() - t0, sample: r.items.slice(0, 5).map((i) => ({ title: i.title, url: i.url, publishedAt: i.publishedAt, source: i.sourceName })) };
  } catch (err) { return { ok: false, message: explain(err), ms: Date.now() - t0 }; }
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
const key = (s) => String(s || '').trim().toLowerCase();

// ── discovery ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One pass over the project's enabled sources. Returns the finished run (its `stats` say what happened).
 * @param opts { sourceIds, trigger: 'manual' | 'schedule', userId, fetchImpl, now, gapMs: override of the per-host pause (tests), force: ignore back-off }
 */
async function runDiscovery(projectId, opts = {}) {
  const run = opts.run || await runs.start(BOT, { projectId, trigger: opts.trigger || 'manual', userId: opts.userId });
  return execute(projectId, run, opts);
}

async function execute(projectId, run, { sourceIds, trigger = 'manual', fetchImpl = fetchText, now = new Date(), gapMs, force = false } = {}) {
  const stats = { sources: 0, ok: 0, notModified: 0, errors: 0, rateLimited: 0, skipped: 0, fetched: 0, tooOld: 0, duplicates: 0, newItems: 0, relevant: 0, irrelevant: 0, excluded: 0, newClusters: 0, joined: 0, limited: 0, messages: [] };
  try {
    const cfg = (await settings.get('news', projectId)).value;
    const ctx = await loadContext(projectId);
    let sources = (await db.query('SELECT * FROM news_sources WHERE project_id = $1 AND enabled ORDER BY reliability DESC, name', [projectId])).rows;   // official and reliable sources first: they get the day\'s limit before aggregators
    if (sourceIds && sourceIds.length) sources = sources.filter((s) => sourceIds.includes(s.id));
    stats.sources = sources.length;
    if (!sources.length) { stats.messages.push('Etkin haber kaynağı yok'); await runs.finish(run.id, { status: 'ok', stats }); return runs.get(run.id); }

    // the events of the last 3 days, to attach new headlines to
    const clusters = new Map();
    const open = (await db.query("SELECT id FROM news_clusters WHERE project_id = $1 AND last_seen_at > now() - interval '72 hours'", [projectId])).rows.map((r) => r.id);
    if (open.length) for (const m of (await db.query('SELECT cluster_id, source_name, title FROM news_items WHERE cluster_id = ANY($1)', [open])).rows) {
      if (!clusters.has(m.cluster_id)) clusters.set(m.cluster_id, { id: m.cluster_id, members: [] });
      clusters.get(m.cluster_id).members.push({ sig: signature(m.title), key: key(m.source_name) });
    }
    const touched = new Set(); const lastCall = new Map(); let limitReached = false;

    const eligible = sources.filter((s) => {
      if (!force && s.next_fetch_after && new Date(s.next_fetch_after) > now) { stats.skipped++; stats.messages.push(`${s.name}: ${s.last_status === 'rate_limited' ? 'istek sınırı' : 'hata'} sonrası bekletiliyor`); return false; }
      return true;
    });
    for (let i = 0; i < eligible.length && !limitReached; i += 4) {
      const batch = eligible.slice(i, i + 4);
      const fetched = await Promise.all(batch.map(async (s) => {
        const gap = gapMs !== undefined ? gapMs : (GAP_MS[s.kind] || 0);
        if (gap) { const wait = (lastCall.get(s.kind) || 0) + gap - Date.now(); if (wait > 0) await sleep(wait); lastCall.set(s.kind, Date.now()); }
        try { return { s, r: await readSource(s, { fetchImpl }) }; } catch (err) { return { s, err }; }
      }));
      for (const { s, r, err } of fetched) {
        if (limitReached) break;
        if (err) { s.__done = true; await markFailure(s, err, now, stats); continue; }
        if (r.notModified) { s.__done = true; stats.notModified++; stats.ok++; await db.query("UPDATE news_sources SET last_fetched_at = now(), last_status = 'not_modified', last_error = NULL, fail_count = 0, next_fetch_after = NULL, last_item_count = 0 WHERE id = $1", [s.id]); continue; }
        stats.ok++; stats.fetched += r.items.length; s.__done = true;
        const out = await processItems(projectId, s, r, { ctx, cfg, clusters, touched, stats, now, trigger });
        if (out.limitReached) limitReached = true;
        await db.query("UPDATE news_sources SET last_fetched_at = now(), last_status = 'ok', last_error = NULL, last_item_count = $2, etag = $3, last_modified = $4, fail_count = 0, next_fetch_after = NULL WHERE id = $1", [s.id, r.items.length, r.etag || null, r.lastModified || null]);
      }
    }
    if (limitReached) { const left = eligible.filter((s) => !s.__done).length; stats.unprocessed = left; stats.messages.push(`Günlük haber limiti doldu: ${left} kaynak bu turda işlenemedi (sonraki gün ya da limit artırılınca okunur)`); }
    if (touched.size) await refreshClusters(projectId, [...touched]);
    stats.purged = await purgeOld(projectId);
    if (stats.sources > 0 && stats.ok === 0 && stats.errors > 0) await notifications.create({ type: 'news_sources_failed', severity: 'warning', title: 'Haber kaynaklarının hiçbirine ulaşılamadı', body: stats.messages.slice(0, 5).join('\n'), data: { projectId } });
    const incomplete = stats.errors > 0 || stats.rateLimited > 0 || limitReached || stats.limited > 0;     // something was not processed (failed source, rate limit, daily limit)
    const status = incomplete ? (stats.ok > 0 ? 'partial' : 'error') : 'ok';
    await runs.finish(run.id, { status, stats, error: status === 'error' ? stats.messages[0] || 'Hiçbir kaynak okunamadı' : null });
  } catch (err) {
    await runs.finish(run.id, { status: 'error', stats, error: err.message });
  }
  return runs.get(run.id);
}

async function markFailure(s, err, now, stats) {
  const limited = err instanceof FetchError && err.code === 'rate_limited';
  const fails = s.fail_count + 1;
  const waitMs = limited ? (err.retryAfterSec ? err.retryAfterSec * 1000 : 30 * 60000) : Math.min(24 * 3600000, 10 * 60000 * 2 ** Math.min(fails - 1, 8));
  if (limited) stats.rateLimited++; else stats.errors++;
  stats.messages.push(`${s.name}: ${explain(err)}`);
  await db.query('UPDATE news_sources SET last_fetched_at = now(), last_status = $2, last_error = $3, fail_count = $4, next_fetch_after = $5 WHERE id = $1',
    [s.id, limited ? 'rate_limited' : 'error', explain(err).slice(0, 300), fails, new Date(now.getTime() + waitMs)]);
}

async function processItems(projectId, source, feed, { ctx, cfg, clusters, touched, stats, now, trigger }) {
  const cutoff = now.getTime() - cfg.maxAgeHours * 3600000;
  const seen = new Set(); const fresh = [];
  const enriched = feed.items.map((i) => ({ ...i, canonical: canonicalUrl(i.url), publishedMs: i.publishedAt ? Math.min(i.publishedAt.getTime(), now.getTime()) : now.getTime() }))
    .filter((i) => i.canonical && !seen.has(i.canonical) && seen.add(i.canonical));
  const hashes = enriched.map((i) => urlHash(i.url));
  const known = new Set(hashes.length ? (await db.query('SELECT url_hash FROM news_items WHERE project_id = $1 AND url_hash = ANY($2)', [projectId, hashes])).rows.map((r) => r.url_hash) : []);
  enriched.forEach((i, idx) => {
    if (known.has(hashes[idx])) { stats.duplicates++; return; }
    if (i.publishedMs < cutoff) { stats.tooOld++; return; }
    fresh.push({ ...i, hash: hashes[idx] });
  });
  fresh.sort((a, b) => b.publishedMs - a.publishedMs);
  let take = fresh.slice(0, cfg.maxItemsPerSource);
  if (!take.length) return { limitReached: false };
  const grant = await limits.reserveUpTo({ workType: 'news_items', projectId, amount: take.length, manual: trigger === 'manual', now });
  if (!grant.ok) { stats.limited += take.length; stats.messages.push(`${source.name}: ${grant.message}`); return { limitReached: true }; }
  if (grant.granted < take.length) { stats.limited += take.length - grant.granted; stats.messages.push(`${source.name}: günlük haber limiti nedeniyle ${grant.granted}/${take.length} haber işlendi`); take = take.slice(0, grant.granted); }
  take.reverse();                                                  // oldest first: a cluster starts with its earliest headline
  // everything is decided in memory first, then written with TWO statements per source (the database is far away: one round trip per headline would take minutes)
  const newClusters = []; const rows = [];
  for (const it of take) {
    const publisher = it.sourceName || source.name;
    const cls = classify({ title: it.title, summary: it.summary, reliability: source.reliability, sourceName: source.kind === 'rss' ? source.name : '' }, ctx, { minRelevance: cfg.minRelevance });
    const sig = signature(it.title); const sk = key(publisher);
    let clusterId = null;
    for (const cl of clusters.values()) { if (cl.members.some((m) => sameEvent(sig, m.sig, { sameSource: m.key === sk }))) { clusterId = cl.id; break; } }
    if (clusterId) stats.joined++;
    else { clusterId = crypto.randomUUID(); clusters.set(clusterId, { id: clusterId, members: [] }); newClusters.push({ id: clusterId, title: it.title, at: new Date(it.publishedMs).toISOString() }); stats.newClusters++; }
    clusters.get(clusterId).members.push({ sig, key: sk }); touched.add(clusterId);
    rows.push({ cluster_id: clusterId, category_id: cls.categoryId, url: it.url.slice(0, 1000), url_hash: it.hash, title: it.title, summary: it.summary || '', source_name: publisher.slice(0, 120), published_at: new Date(it.publishedMs).toISOString(),
      country: (it.country || source.country || '').slice(0, 2), language: (it.language || source.language || 'en').slice(0, 5), keywords: phrases(it.title).filter((x) => x.split(' ').length <= 3).slice(0, 8), relevance: cls.relevance, status: cls.status, reason: cls.reason.slice(0, 300),
      matched_terms: cls.matched.slice(0, 12), reliability: source.reliability });
    stats.newItems++; stats[cls.status]++;
  }
  await db.tx(async (c) => {
    if (newClusters.length) await c.query(`INSERT INTO news_clusters (id, project_id, title, first_seen_at, last_seen_at) SELECT x.id, $1, x.title, x.at, x.at FROM jsonb_to_recordset($2::jsonb) AS x(id uuid, title text, at timestamptz)`, [projectId, JSON.stringify(newClusters)]);
    await c.query(`INSERT INTO news_items (project_id, source_id, cluster_id, category_id, url, url_hash, title, summary, source_name, published_at, country, language, keywords, relevance, status, reason, matched_terms, reliability)
      SELECT $1, $2, x.cluster_id, x.category_id, x.url, x.url_hash, x.title, x.summary, x.source_name, x.published_at, x.country, x.language, ARRAY(SELECT jsonb_array_elements_text(x.keywords)), x.relevance, x.status, x.reason, ARRAY(SELECT jsonb_array_elements_text(x.matched_terms)), x.reliability
      FROM jsonb_to_recordset($3::jsonb) AS x(cluster_id uuid, category_id uuid, url text, url_hash text, title text, summary text, source_name text, published_at timestamptz, country text, language text, keywords jsonb, relevance int, status text, reason text, matched_terms jsonb, reliability int)`,
    [projectId, source.id, JSON.stringify(rows)]);
  });
  return { limitReached: false };
}

/** Recomputes what a cluster shows (counts, sources, dates, best headline, relevance, category) from its items. A person's decision (manual_override) is kept. */
async function refreshClusters(projectId, ids) {
  await db.query(`WITH agg AS (
      SELECT cluster_id, count(*)::int n, count(DISTINCT lower(source_name))::int s, min(coalesce(published_at, fetched_at)) first_at, max(coalesce(published_at, fetched_at)) last_at, max(reliability) rel, max(relevance) relv,
             bool_or(status = 'relevant') any_rel, bool_or(status = 'excluded') any_ex
        FROM news_items WHERE cluster_id = ANY($1) GROUP BY cluster_id),
    best AS (
      SELECT DISTINCT ON (cluster_id) cluster_id, title, category_id, reason, matched_terms
        FROM news_items WHERE cluster_id = ANY($1) ORDER BY cluster_id, (status = 'relevant') DESC, relevance DESC, reliability DESC, published_at ASC NULLS LAST)
    UPDATE news_clusters c SET item_count = agg.n, source_count = agg.s, first_seen_at = agg.first_at, last_seen_at = agg.last_at, reliability = agg.rel, title = best.title,
      relevance = CASE WHEN c.manual_override THEN c.relevance ELSE agg.relv END,
      status = CASE WHEN c.manual_override THEN c.status WHEN agg.any_rel THEN 'relevant' WHEN agg.any_ex THEN 'excluded' ELSE 'irrelevant' END,
      category_id = CASE WHEN c.manual_override THEN c.category_id ELSE best.category_id END,
      reason = CASE WHEN c.manual_override THEN c.reason ELSE best.reason END,
      matched_terms = CASE WHEN c.manual_override THEN c.matched_terms ELSE best.matched_terms END
    FROM agg JOIN best USING (cluster_id) WHERE c.id = agg.cluster_id AND c.project_id = $2`, [ids, projectId]);
}


/** Old headlines are not kept forever: irrelevant / excluded ones after 30 days, relevant ones after 180 days (unless an event became a topic). Empty events go with them. */
async function purgeOld(projectId) {
  const a = await db.query(`DELETE FROM news_items i WHERE i.project_id = $1 AND coalesce(i.published_at, i.fetched_at) < now() - (CASE WHEN i.status = 'relevant' THEN interval '180 days' ELSE interval '30 days' END)
    AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.cluster_id = i.cluster_id)`, [projectId]);
  if (a.rowCount) await db.query('DELETE FROM news_clusters c WHERE c.project_id = $1 AND NOT EXISTS (SELECT 1 FROM news_items i WHERE i.cluster_id = c.id) AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.cluster_id = c.id)', [projectId]);
  return a.rowCount;
}

/** Starts a pass in the background (the panel polls the run); a second start while one runs is refused. */
async function startDiscovery(projectId, opts = {}) {
  await runs.guardOne(BOT, projectId);
  const run = await runs.start(BOT, { projectId, trigger: opts.trigger || 'manual', userId: opts.userId });
  setImmediate(() => { execute(projectId, run, opts).catch((e) => console.error('[Content] news run crashed:', e.message)); });
  return run;
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────────────────
const itemShape = (r) => ({ id: r.id, clusterId: r.cluster_id, categoryId: r.category_id, categoryName: r.category_name, title: r.title, url: r.url, summary: r.summary, sourceName: r.source_name, publishedAt: r.published_at,
  fetchedAt: r.fetched_at, country: r.country, language: r.language, keywords: r.keywords, relevance: r.relevance, status: r.status, reason: r.reason, matchedTerms: r.matched_terms, reliability: r.reliability });

async function listItems(projectId, q = {}) {
  const p = [projectId]; const w = ['i.project_id = $1'];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (q.status) add('i.status = ?', V.oneOf(q.status, 'Durum', ['relevant', 'irrelevant', 'excluded']));
  if (q.categoryId) add('i.category_id = ?', V.uuid(q.categoryId, 'Kategori'));
  if (q.sourceId) add('i.source_id = ?', V.uuid(q.sourceId, 'Kaynak'));
  if (q.q) add("(i.title ILIKE ? ESCAPE '\\')", `%${String(q.q).slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (q.hours) add("coalesce(i.published_at, i.fetched_at) > now() - (?::int * interval '1 hour')", Math.min(720, Math.max(1, parseInt(q.hours, 10) || 24)));
  const size = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 30)); const page = Math.max(1, parseInt(q.page, 10) || 1);
  const where = w.join(' AND ');
  const total = (await db.query(`SELECT count(*)::int n FROM news_items i WHERE ${where}`, p)).rows[0].n;
  const rows = (await db.query(`SELECT i.*, c.name_en AS category_name FROM news_items i LEFT JOIN categories c ON c.id = i.category_id WHERE ${where} ORDER BY coalesce(i.published_at, i.fetched_at) DESC, i.id LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, size, (page - 1) * size])).rows;
  return { total, page, pageSize: size, items: rows.map(itemShape) };
}

const clusterShape = (r) => ({ id: r.id, title: r.title, categoryId: r.category_id, categoryName: r.category_name, relevance: r.relevance, status: r.status, reason: r.reason, matchedTerms: r.matched_terms, manualOverride: r.manual_override,
  itemCount: r.item_count, sourceCount: r.source_count, reliability: r.reliability, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, topicId: r.topic_id || null });

async function listClusters(projectId, q = {}) {
  const p = [projectId]; const w = ['c.project_id = $1'];
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
  if (q.status) add('c.status = ?', V.oneOf(q.status, 'Durum', ['relevant', 'irrelevant', 'excluded']));
  if (q.categoryId) add('c.category_id = ?', V.uuid(q.categoryId, 'Kategori'));
  if (q.multiSource === '1') w.push('c.source_count >= 2');
  if (q.hours) add("c.last_seen_at > now() - (?::int * interval '1 hour')", Math.min(720, Math.max(1, parseInt(q.hours, 10) || 48)));
  if (q.q) add("c.title ILIKE ? ESCAPE '\\'", `%${String(q.q).slice(0, 100).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  const size = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 30)); const page = Math.max(1, parseInt(q.page, 10) || 1);
  const where = w.join(' AND ');
  const total = (await db.query(`SELECT count(*)::int n FROM news_clusters c WHERE ${where}`, p)).rows[0].n;
  const rows = (await db.query(`SELECT c.*, k.name_en AS category_name, t.id AS topic_id FROM news_clusters c LEFT JOIN categories k ON k.id = c.category_id LEFT JOIN topics t ON t.cluster_id = c.id
    WHERE ${where} ORDER BY c.last_seen_at DESC, c.id LIMIT $${p.length + 1} OFFSET $${p.length + 2}`, [...p, size, (page - 1) * size])).rows;
  return { total, page, pageSize: size, items: rows.map(clusterShape) };
}

async function getCluster(id) {
  const c = (await db.query('SELECT c.*, k.name_en AS category_name, t.id AS topic_id FROM news_clusters c LEFT JOIN categories k ON k.id = c.category_id LEFT JOIN topics t ON t.cluster_id = c.id WHERE c.id = $1', [id])).rows[0];
  if (!c) throw new HttpError(404, 'Olay bulunamadı');
  const items = (await db.query('SELECT i.*, NULL::text AS category_name FROM news_items i WHERE cluster_id = $1 ORDER BY coalesce(published_at, fetched_at)', [id])).rows;
  return { ...clusterShape(c), projectId: c.project_id, items: items.map(itemShape) };
}

/** A person's call on an event: "this is on topic" / "this is not". The filter never overrides it afterwards. */
async function setClusterStatus(id, status, { categoryId } = {}) {
  const st = V.oneOf(status, 'Durum', ['relevant', 'irrelevant']);
  const cur = (await db.query('SELECT project_id FROM news_clusters WHERE id = $1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'Olay bulunamadı');
  let cat = null;
  if (categoryId) { cat = V.uuid(categoryId, 'Kategori'); const k = (await db.query('SELECT project_id FROM categories WHERE id = $1', [cat])).rows[0]; if (!k || k.project_id !== cur.project_id) throw bad('Kategori bu projeye ait değil'); }
  await db.query(`UPDATE news_clusters SET status = $2, manual_override = true, reason = $3, category_id = COALESCE($4, category_id), relevance = CASE WHEN $2 = 'relevant' THEN greatest(relevance, 70) ELSE relevance END WHERE id = $1`,
    [id, st, st === 'relevant' ? 'Elle “ilgili” olarak işaretlendi' : 'Elle “ilgisiz” olarak işaretlendi', cat]);
  return getCluster(id);
}

module.exports = { DEFAULT_SOURCES, NOTE, listSources, createSource, getSource, updateSource, deleteSource, seedDefaultSources, readSource, testSource, runDiscovery, startDiscovery, refreshClusters, purgeOld, listItems, listClusters, getCluster, setClusterStatus };
