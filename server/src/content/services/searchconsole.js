const crypto = require('node:crypto');
const db = require('../db');
const V = require('../lib/validate');
const cryptoBox = require('../lib/crypto');
const { HttpError } = require('../lib/http');
const providers = require('./providers');

/**
 * Google Search Console. Authorised the OAuth 2.0 server-to-server way: a Google SERVICE ACCOUNT (its JSON key is stored encrypted like every secret) signs a short-lived
 * JWT, Google answers with an access token (read-only scope), and the account's e-mail is added to the Search Console property as a user. No browser sign-in, no refresh
 * tokens to lose. Nothing here is estimated: a number is what Google reported, a missing number is missing ("veri yok").
 *  - only FINAL data is read, and the newest days are never asked for (Search Console is 2-3 days behind): the window ends 3 days ago
 *  - 90 days of per-page daily numbers, the queries of the newest 28 days and of the 28 days before, countries and devices of the newest 28 days
 *  - drops are SIGNALS for a person, never an automatic reason to rewrite an article: the opportunities say what could not be judged (seasonality, demand)
 * Written from Google's documentation; never run against the real Google (tests use a fake of both endpoints).
 */
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/webmasters/v3';
const LAG_DAYS = 3;

class GscError extends Error { constructor(code, message, extra = {}) { super(message); this.name = 'GscError'; this.code = code; Object.assign(this, extra); } }

const b64 = (b) => Buffer.from(b).toString('base64url');

function createClient({ keyJson, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  let key; try { key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson; } catch { throw new GscError('key', 'Servis hesabı anahtarı geçerli bir JSON değil'); }
  if (!key || !key.client_email || !key.private_key) throw new GscError('key', 'Servis hesabı anahtarında client_email ve private_key olmalı');
  let token = null; let expires = 0;

  async function accessToken() {
    if (token && expires - now().getTime() > 60000) return token;
    const iat = Math.floor(now().getTime() / 1000);
    const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' })); const claim = b64(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
    let sig; try { sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key).toString('base64url'); } catch { throw new GscError('key', 'Servis hesabının özel anahtarı okunamadı (anahtar bozuk olabilir)'); }
    let res; try { res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }).toString(), signal: AbortSignal.timeout(20000) }); }
    catch { throw new GscError('network', 'Google’a ulaşılamadı (ağ hatası)', { retryable: true }); }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.access_token) throw new GscError('auth', `Google servis hesabını reddetti${j && j.error_description ? `: ${String(j.error_description).slice(0, 120)}` : ` (HTTP ${res.status})`}. Anahtarın silinmediğinden ve Search Console API’nin açık olduğundan emin olun`);
    token = j.access_token; expires = now().getTime() + (Number(j.expires_in) || 3600) * 1000; return token;
  }

  async function call(method, path, body) {
    const t = await accessToken(); let res;
    try { res = await fetchImpl(`${API}${path}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) }); }
    catch { throw new GscError('network', 'Search Console’a ulaşılamadı (ağ hatası)', { retryable: true }); }
    const j = await res.json().catch(() => null);
    if (res.status === 403 || res.status === 401) throw new GscError('rights', 'Search Console bu servis hesabına izin vermedi: Search Console → Ayarlar → Kullanıcılar ve izinler’den hesabın e-postasını bu siteye ekleyin (ve Search Console API açık olmalı)');
    if (res.status === 404) throw new GscError('no_site', 'Search Console bu siteyi bulamadı: “Search Console sitesi” alanını (sc-domain:alanadi.com ya da https://alanadi.com/) kontrol edin');
    if (res.status === 429 || res.status >= 500) throw new GscError('server', `Search Console şu an yanıt vermiyor (${res.status}); biraz sonra tekrar deneyin`, { retryable: true });
    if (!res.ok) throw new GscError('api', `Search Console isteği reddetti (${res.status})${j && j.error && j.error.message ? `: ${String(j.error.message).slice(0, 160)}` : ''}`);
    return j || {};
  }

  return {
    email: key.client_email,
    async listSites() { const j = await call('GET', '/sites'); return (Array.isArray(j.siteEntry) ? j.siteEntry : []).map((s) => ({ siteUrl: s.siteUrl, level: s.permissionLevel })); },
    /** one analytics query, paged until `limit` rows */
    async query(property, { startDate, endDate, dimensions, limit = 25000 }) {
      const rows = [];
      for (let startRow = 0; rows.length < limit; startRow += 25000) {
        const j = await call('POST', `/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { startDate, endDate, dimensions, rowLimit: Math.min(25000, limit - rows.length), startRow, dataState: 'final' });
        const part = Array.isArray(j.rows) ? j.rows : []; rows.push(...part); if (part.length < 25000) break;
      }
      return rows;
    },
  };
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const pos = (v) => Math.max(0, Math.round((Number(v) || 0) * 1000) / 1000);

async function clientFor(opts = {}) {
  const secret = await providers.secretFor('searchconsole');
  if (!secret) throw new HttpError(409, 'Search Console henüz ayarlanmadı: API Kullanımı sayfasında servis hesabı anahtarını (JSON) kaydedip bağlantıyı test edin');
  try { return createClient({ keyJson: secret, ...opts }); } catch (err) { throw new HttpError(409, err.message); }
}

async function chunked(rows, fn, n = 1500) { for (let i = 0; i < rows.length; i += n) await fn(rows.slice(i, i + n)); }

/**
 * Reads the site's numbers from Google and replaces what was stored. @returns { through, days, pages, queries }
 * @param o { fetchImpl, now }
 */
async function sync(siteId, { fetchImpl, now = new Date() } = {}) {
  const site = (await db.query('SELECT id, project_id, name, gsc_property FROM wp_sites WHERE id = $1', [V.uuid(siteId, 'Site')])).rows[0];
  if (!site) throw new HttpError(404, 'Site bulunamadı');
  if (!site.gsc_property) throw new HttpError(409, 'Bu site için Search Console sitesi yazılmamış (Web Sitelerim → Ayarlar)');
  const client = await clientFor({ fetchImpl, now: () => now });
  const end = addDays(now, -LAG_DAYS); const start90 = addDays(end, -89); const cur0 = addDays(end, -27); const prev1 = addDays(cur0, -1); const prev0 = addDays(prev1, -27);
  try {
    const daily = await client.query(site.gsc_property, { startDate: iso(start90), endDate: iso(end), dimensions: ['date', 'page'] });
    const qCur = await client.query(site.gsc_property, { startDate: iso(cur0), endDate: iso(end), dimensions: ['query', 'page'], limit: 5000 });
    const qPrev = await client.query(site.gsc_property, { startDate: iso(prev0), endDate: iso(prev1), dimensions: ['query', 'page'], limit: 5000 });
    const countries = await client.query(site.gsc_property, { startDate: iso(cur0), endDate: iso(end), dimensions: ['country'], limit: 30 });
    const devices = await client.query(site.gsc_property, { startDate: iso(cur0), endDate: iso(end), dimensions: ['device'], limit: 10 });
    await db.query('DELETE FROM gsc_daily WHERE site_id = $1 AND day >= $2', [site.id, iso(start90)]);
    await chunked(daily, (part) => db.query(`INSERT INTO gsc_daily (site_id, day, page, clicks, impressions, position) SELECT $1, x.day, x.page, x.clicks, x.impressions, x.position FROM jsonb_to_recordset($2::jsonb) AS x(day date, page text, clicks int, impressions int, position numeric)
      ON CONFLICT (site_id, day, page) DO UPDATE SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, position = EXCLUDED.position`, [site.id, JSON.stringify(part.map((r) => ({ day: r.keys[0], page: String(r.keys[1]).slice(0, 1000), clicks: int(r.clicks), impressions: int(r.impressions), position: pos(r.position) })))]));
    await db.query('DELETE FROM gsc_queries WHERE site_id = $1', [site.id]);
    for (const [period, rows] of [['cur', qCur], ['prev', qPrev]]) {
      await chunked(rows, (part) => db.query(`INSERT INTO gsc_queries (site_id, period, page, query, clicks, impressions, position) SELECT $1, $2, x.page, x.query, x.clicks, x.impressions, x.position FROM jsonb_to_recordset($3::jsonb) AS x(page text, query text, clicks int, impressions int, position numeric)
        ON CONFLICT DO NOTHING`, [site.id, period, JSON.stringify(part.map((r) => ({ query: String(r.keys[0]).slice(0, 300), page: String(r.keys[1]).slice(0, 1000), clicks: int(r.clicks), impressions: int(r.impressions), position: pos(r.position) })))]));
    }
    await db.query('DELETE FROM gsc_breakdowns WHERE site_id = $1', [site.id]);
    for (const [kind, rows] of [['country', countries], ['device', devices]]) {
      await chunked(rows, (part) => db.query(`INSERT INTO gsc_breakdowns (site_id, kind, key, clicks, impressions, position) SELECT $1, $2, x.key, x.clicks, x.impressions, x.position FROM jsonb_to_recordset($3::jsonb) AS x(key text, clicks int, impressions int, position numeric) ON CONFLICT DO NOTHING`,
        [site.id, kind, JSON.stringify(part.map((r) => ({ key: String(r.keys[0]).slice(0, 40), clicks: int(r.clicks), impressions: int(r.impressions), position: pos(r.position) })))]));
    }
    await db.query('UPDATE wp_sites SET gsc_synced_at = $2, gsc_error = NULL WHERE id = $1', [site.id, now]);
    return { through: iso(end), days: 90, rows: daily.length, queries: qCur.length + qPrev.length, countries: countries.length, devices: devices.length };
  } catch (err) {
    await db.query('UPDATE wp_sites SET gsc_error = $2 WHERE id = $1', [site.id, String(err.message).slice(0, 300)]);
    if (err instanceof GscError) throw Object.assign(new HttpError(err.code === 'network' || err.code === 'server' ? 502 : 409, err.message), { retryable: err.retryable });
    throw err;
  }
}

// ── numbers and opportunities (read from what was stored) ────────────────────────────────────────────────────────────
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const ctrOf = (clicks, impr) => (impr > 0 ? Math.round((clicks / impr) * 10000) / 10000 : null);
/** what a result at this average position normally gets (rough, public rules of thumb): used only to say "lower than usual" */
const expectedCtr = (p) => (p <= 1.5 ? 0.30 : p <= 2.5 ? 0.15 : p <= 3.5 ? 0.10 : p <= 4.5 ? 0.07 : p <= 5.5 ? 0.05 : p <= 6.5 ? 0.035 : p <= 8.5 ? 0.02 : p <= 10.5 ? 0.012 : 0.005);

const normUrl = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`; } catch { return String(u || ''); } };

async function pageMap(siteId) {
  const rows = (await db.query("SELECT p.wp_url, p.article_id, a.h1 FROM publications p JOIN articles a ON a.id = p.article_id WHERE p.site_id = $1 AND p.wp_url IS NOT NULL", [siteId])).rows;
  return new Map(rows.map((r) => [normUrl(r.wp_url), { articleId: r.article_id, title: r.h1 }]));
}

/** The "SEO Performansı" numbers of a site for the last `days` (7 / 28 / 90) against the same length before, from stored Search Console data only. */
async function performance(siteId, { days = 28, now = new Date() } = {}) {
  const site = (await db.query('SELECT id, name, gsc_property, gsc_synced_at, gsc_error FROM wp_sites WHERE id = $1', [V.uuid(siteId, 'Site')])).rows[0];
  if (!site) throw new HttpError(404, 'Site bulunamadı');
  const d = V.oneOf(Number(days), 'Dönem', [7, 28, 90]);
  const out = { site: { id: site.id, name: site.name, property: site.gsc_property, syncedAt: site.gsc_synced_at, error: site.gsc_error }, days: d, connected: !!site.gsc_property && !!site.gsc_synced_at };
  if (!out.connected) return { ...out, note: site.gsc_property ? 'Bu site için Search Console verisi henüz çekilmedi.' : 'Search Console bağlı değil: performans verisi yok (uydurulmaz).' };
  const last = (await db.query('SELECT max(day)::text AS d FROM gsc_daily WHERE site_id = $1', [site.id])).rows[0].d;
  if (!last) return { ...out, note: 'Search Console bu site için henüz veri döndürmedi (yeni siteler birkaç gün veri üretmez).' };
  const end = new Date(`${last}T00:00:00Z`); const s1 = addDays(end, -(d - 1)); const p1 = addDays(s1, -1); const p0 = addDays(p1, -(d - 1));
  const agg = async (a, b) => (await db.query('SELECT coalesce(sum(clicks),0)::int c, coalesce(sum(impressions),0)::int i, CASE WHEN sum(impressions) > 0 THEN sum(position * impressions) / sum(impressions) END AS p FROM gsc_daily WHERE site_id = $1 AND day BETWEEN $2 AND $3', [site.id, iso(a), iso(b)])).rows[0];
  const cur = await agg(s1, end); const prev = await agg(p0, p1);
  const t = (r) => ({ clicks: r.c, impressions: r.i, ctr: ctrOf(r.c, r.i), position: r.p === null ? null : Math.round(Number(r.p) * 10) / 10 });
  const series = (await db.query('SELECT day::text AS day, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions FROM gsc_daily WHERE site_id = $1 AND day BETWEEN $2 AND $3 GROUP BY day ORDER BY day', [site.id, iso(s1), iso(end)])).rows;
  const pageRows = (await db.query(`SELECT page, sum(clicks) FILTER (WHERE day >= $2)::int AS c, sum(impressions) FILTER (WHERE day >= $2)::int AS i, sum(clicks) FILTER (WHERE day < $2)::int AS pc, sum(impressions) FILTER (WHERE day < $2)::int AS pi,
      sum(position * impressions) FILTER (WHERE day >= $2) / NULLIF(sum(impressions) FILTER (WHERE day >= $2), 0) AS p FROM gsc_daily WHERE site_id = $1 AND day BETWEEN $3 AND $4 GROUP BY page ORDER BY c DESC NULLS LAST LIMIT 100`, [site.id, iso(s1), iso(p0), iso(end)])).rows;
  const map = await pageMap(site.id);
  const pages = pageRows.map((r) => ({ page: r.page, article: map.get(normUrl(r.page)) || null, clicks: r.c || 0, impressions: r.i || 0, ctr: ctrOf(r.c || 0, r.i || 0), position: r.p === null ? null : Math.round(Number(r.p) * 10) / 10, prevClicks: r.pc || 0, prevImpressions: r.pi || 0, clicksChangePct: pct(r.c || 0, r.pc || 0) }));
  const queries = (await db.query("SELECT query, sum(clicks)::int c, sum(impressions)::int i, sum(position * impressions) / NULLIF(sum(impressions), 0) AS p FROM gsc_queries WHERE site_id = $1 AND period = 'cur' GROUP BY query ORDER BY c DESC, i DESC LIMIT 30", [site.id])).rows
    .map((r) => ({ query: r.query, clicks: r.c, impressions: r.i, position: r.p === null ? null : Math.round(Number(r.p) * 10) / 10 }));
  const br = (await db.query('SELECT kind, key, clicks, impressions FROM gsc_breakdowns WHERE site_id = $1 ORDER BY clicks DESC', [site.id])).rows;
  return { ...out, through: last, window: { from: iso(s1), to: last, previousFrom: iso(p0), previousTo: iso(p1) }, current: t(cur), previous: t(prev),
    change: { clicksPct: pct(cur.c, prev.c), impressionsPct: pct(cur.i, prev.i) }, series, pages, queries, countries: br.filter((x) => x.kind === 'country').slice(0, 10), devices: br.filter((x) => x.kind === 'device'),
    notes: [`Veriler ${last} gününe kadar (Search Console 2-3 gün geriden gelir; son günler hiç istenmez).`, 'Aynı uzunluktaki önceki dönemle karşılaştırılır; 90 günden eski veri tutulmadığı için mevsimsellik (geçen yılın aynı dönemi) DEĞERLENDİRİLEMEZ.'] };
}

/**
 * Things worth a person's attention, from the stored numbers. Each says what it is based on and what it could NOT take into account. None of them rewrites an article by itself.
 * kinds: low_ctr, click_drop (or demand_drop when the whole site dropped alike), new_keyword, changed_intent, link_need
 */
async function opportunities(siteId, { now = new Date() } = {}) {
  const perf = await performance(siteId, { days: 28, now });
  if (!perf.connected || !perf.pages) return { connected: perf.connected, note: perf.note, items: [] };
  const items = []; const siteDrop = perf.change.clicksPct;
  for (const p of perf.pages) {
    const label = p.article ? p.article.title : p.page;
    if (p.impressions >= 200 && p.position !== null && p.position <= 12 && p.ctr !== null && p.ctr < expectedCtr(p.position) * 0.6)
      items.push({ kind: 'low_ctr', severity: 'review', page: p.page, article: p.article, text: `“${label}”: ${p.impressions} gösterim, ortalama sıra ${p.position}, ama tıklama oranı %${(p.ctr * 100).toFixed(1)} (bu sırada genelde %${(expectedCtr(p.position) * 100).toFixed(0)} civarı beklenir). Başlık ve meta açıklamayı gözden geçirin.` });
    if (p.prevClicks >= 20 && p.clicksChangePct !== null && p.clicksChangePct <= -30) {
      const siteWide = siteDrop !== null && siteDrop <= -20;
      items.push({ kind: siteWide ? 'demand_drop' : 'click_drop', severity: siteWide ? 'info' : 'review', page: p.page, article: p.article, text: `“${label}”: tıklama %${Math.abs(p.clicksChangePct)} düştü (${p.prevClicks} → ${p.clicks}). ${siteWide ? `Sitenin tamamı da %${Math.abs(siteDrop)} düştü: büyük olasılıkla bu makaleye özgü değil (genel talep/mevsim ya da veri farkı).` : 'Tek başına güncelleme gerekçesi değildir; mevsimsellik değerlendirilemedi: önce konunun gündemine ve rakiplere bakın.'}` });
    }
  }
  const q = (await db.query(`SELECT q.page, q.query, q.impressions i, q.clicks c, q.position p FROM gsc_queries q WHERE q.site_id = $1 AND q.period = 'cur' AND q.impressions >= 50 AND q.position > 10 AND q.position <= 30 ORDER BY q.impressions DESC LIMIT 20`, [siteId])).rows;
  const map = await pageMap(siteId);
  for (const r of q) items.push({ kind: 'new_keyword', severity: 'idea', page: r.page, article: map.get(normUrl(r.page)) || null, query: r.query, text: `“${r.query}” aramasında ${r.i} gösterim, ortalama sıra ${Math.round(Number(r.p) * 10) / 10}: ilk sayfada değil. Makalede bu ifadeye yer verin ya da ayrı bir makale düşünün.` });
  const cur = (await db.query("SELECT page, query, impressions FROM gsc_queries WHERE site_id = $1 AND period = 'cur' ORDER BY impressions DESC", [siteId])).rows; const prev = (await db.query("SELECT page, query FROM gsc_queries WHERE site_id = $1 AND period = 'prev'", [siteId])).rows;
  for (const page of new Set(cur.map((r) => r.page))) {
    const a = cur.filter((r) => r.page === page).slice(0, 10).map((r) => r.query); const b = new Set(prev.filter((r) => r.page === page).map((r) => r.query));
    if (a.length >= 5 && b.size >= 5) { const kept = a.filter((x) => b.has(x)).length; if (kept / a.length < 0.4) items.push({ kind: 'changed_intent', severity: 'review', page, article: map.get(normUrl(page)) || null, text: `Bu sayfayı bulduran aramalar değişti: ilk ${a.length} aramanın yalnızca ${kept} tanesi önceki dönemde de vardı. İnsanlar sayfayı başka bir niyetle arıyor olabilir.` }); }
  }
  return { connected: true, through: perf.through, items, note: 'Bunlar işaretlerdir: hiçbiri makaleyi kendiliğinden değiştirmez. Mevsimsellik (geçen yılın aynı dönemi) elimizdeki 90 günlük veriyle değerlendirilemez.' };
}

/** per article (by its public address): the 28-day clicks against the 28 days before, for the health page */
async function articleSignals(projectId) {
  const out = new Map();
  for (const s of (await db.query("SELECT id FROM wp_sites WHERE project_id = $1 AND gsc_property IS NOT NULL AND gsc_synced_at IS NOT NULL", [projectId])).rows) {
    const perf = await performance(s.id, { days: 28 }).catch(() => null);
    if (!perf || !perf.pages) continue;
    for (const p of perf.pages) if (p.article) out.set(p.article.articleId, { clicks: p.clicks, prevClicks: p.prevClicks, changePct: p.clicksChangePct, impressions: p.impressions, ctr: p.ctr, position: p.position, drop: p.prevClicks >= 20 && p.clicksChangePct !== null && p.clicksChangePct <= -30 });
  }
  return out;
}

module.exports = { SCOPE, LAG_DAYS, GscError, createClient, clientFor, sync, performance, opportunities, articleSignals, expectedCtr, normUrl };
