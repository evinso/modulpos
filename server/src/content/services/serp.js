const db = require('../db');
const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const { fold } = require('../lib/text');
const settings = require('./settings');
const limits = require('./limits');
const providers = require('./providers');
const runs = require('./runs');
const dfs = require('./dataforseo');
const serper = require('./serper');

/**
 * Organic competition analysis of a query from Google's real top results (up to 10 results, from Serper.dev or DataForSEO: `seo.serpProvider`).
 * The score (0-100, higher = harder for a NEW site) is OUR estimate built from visible facts of the result page. It is NOT Google's difficulty metric and
 * not DataForSEO's keyword difficulty (that one is shown separately, as the provider's own number). Every factor, its value and its weight are stored and shown.
 */
const DISCLAIMER = 'Bu puan, Google ilk-10 sonuçlarına (Serper.dev ya da DataForSEO) dayanan tahmini bir rekabet göstergesidir; Google’ın resmî zorluk metriği değildir.';
const BOT = 'seo_competition';

const root = (d) => String(d || '').toLowerCase().replace(/^www\./, '');
const BIG = new Set(['wikipedia.org', 'youtube.com', 'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'bbc.com', 'bbc.co.uk', 'cnn.com', 'forbes.com', 'businessinsider.com', 'wsj.com', 'bloomberg.com', 'reuters.com', 'apnews.com', 'usatoday.com',
  'theverge.com', 'techcrunch.com', 'wired.com', 'engadget.com', 'cnet.com', 'zdnet.com', 'pcmag.com', 'techradar.com', 'tomsguide.com', 'tomshardware.com', 'arstechnica.com', 'medium.com', 'linkedin.com', 'facebook.com', 'x.com', 'twitter.com', 'amazon.com',
  'github.com', '9to5mac.com', '9to5google.com', 'androidauthority.com', 'androidcentral.com', 'macrumors.com', 'howtogeek.com', 'lifewire.com', 'digitaltrends.com', 'mashable.com', 'gizmodo.com', 'venturebeat.com', 'theregister.com', 'bleepingcomputer.com',
  'thehackernews.com', 'krebsonsecurity.com', 'consumerreports.org', 'pcworld.com', 'macworld.com', 'tomsguide.com', 'makeuseof.com', 'xda-developers.com', 'windowscentral.com']);
const FORUM = ['reddit.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com', 'superuser.com', 'answers.microsoft.com', 'discussions.apple.com', 'community.', 'forums.', 'forum.'];
const VENDOR = new Set(['apple.com', 'google.com', 'microsoft.com', 'openai.com', 'anthropic.com', 'meta.com', 'adobe.com', 'mozilla.org', 'samsung.com', 'intel.com', 'nvidia.com', 'amd.com', 'cisa.gov', 'zoom.us', 'slack.com', 'spotify.com', 'netflix.com', 'dropbox.com', 'whatsapp.com', 'signal.org', 'proton.me']);
const OFFICIAL_SUB = /^(support|help|docs|developer|developers|learn|answers|status|security|trust|blog|newsroom|about)\./;

const isForum = (d) => FORUM.some((f) => (f.endsWith('.') ? d.startsWith(f) : d === f || d.endsWith(`.${f}`)));
const isBig = (d) => BIG.has(d) || [...BIG].some((b) => d.endsWith(`.${b}`));
const isOfficial = (d, kwTokens) => {
  if (/\.(gov|edu|mil)$/.test(d) || /\.gov\.[a-z]{2}$/.test(d) || VENDOR.has(d) || [...VENDOR].some((v) => d.endsWith(`.${v}`)) || OFFICIAL_SUB.test(d)) return true;
  const label = d.split('.').slice(-2, -1)[0];                      // "openai" of openai.com: the site named in the query is that product's own site
  return !!label && label.length >= 4 && kwTokens.has(label);
};

/** kind of a result: official | big | forum | independent */
function kindOf(domain, kwTokens) {
  const d = root(domain);
  if (isForum(d)) return 'forum';
  if (isOfficial(d, kwTokens)) return 'official';
  if (isBig(d)) return 'big';
  return 'independent';
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const refDomainsScore = (n) => (n < 10 ? 10 : n < 50 ? 30 : n < 200 ? 60 : n < 1000 ? 85 : 100);

/**
 * @param organic [{ rank, domain, title, url, timestamp }] (up to 10)   @param ctx { keyword, avgReferringDomains, now }
 * @returns { competition: 0..100 | null, label, factors: [{ key, label, value, weight, note }], results, reducers }
 */
function scoreSerp(organic, { keyword = '', avgReferringDomains = null, now = new Date() } = {}) {
  const kwTokens = new Set(fold(keyword).split(' '));
  const top = (organic || []).slice(0, 10).map((o) => ({ rank: o.rank, domain: root(o.domain), title: o.title, url: o.url, timestamp: o.timestamp || null, kind: kindOf(o.domain, kwTokens) }));
  if (!top.length) return { competition: null, label: 'Organik sonuç bulunamadı', factors: [], results: [], reducers: [] };
  const n = top.length; const cnt = (k) => top.filter((x) => x.kind === k).length;
  const factors = [];
  const big = cnt('big'); const off = cnt('official');
  factors.push({ key: 'big', label: 'Büyük yayıncı yoğunluğu', value: clamp((big / n) * 100 * 1.4), weight: 25, note: `${n} sonucun ${big}’i büyük yayıncı/platform` });
  factors.push({ key: 'official', label: 'Resmî kaynak yoğunluğu', value: clamp((off / n) * 100 * 1.6), weight: 20, note: `${n} sonucun ${off}’i resmî/üretici/kurum sitesi` });
  const t3 = top.slice(0, 3).filter((x) => x.kind === 'big' || x.kind === 'official').length;
  factors.push({ key: 'top3', label: 'İlk 3 sıranın gücü', value: clamp((t3 / Math.min(3, n)) * 100), weight: 20, note: `İlk ${Math.min(3, n)} sonucun ${t3}’i büyük/resmî` });
  const dated = top.filter((x) => x.timestamp && !Number.isNaN(Date.parse(x.timestamp)));
  if (dated.length >= 3) {
    const fresh = dated.filter((x) => now - Date.parse(x.timestamp) < 30 * 86400000).length;
    factors.push({ key: 'fresh', label: 'İçerik güncelliği', value: clamp((fresh / dated.length) * 100), weight: 10, note: `Tarihi bilinen ${dated.length} sonucun ${fresh}’i son 30 günde yayımlanmış/güncellenmiş` });
  }
  if (avgReferringDomains !== null && avgReferringDomains !== undefined) factors.push({ key: 'authority', label: 'Otorite (ortalama yönlendiren alan adı)', value: refDomainsScore(avgReferringDomains), weight: 25, note: `İlk sonuçların ortalama ${avgReferringDomains} yönlendiren alan adı var (eşikler bizim tahminimiz)` });
  const wsum = factors.reduce((a, f) => a + f.weight, 0);
  const base = factors.reduce((a, f) => a + f.value * f.weight, 0) / wsum;
  const reducers = [];
  const forums = cnt('forum'); if (forums) reducers.push({ key: 'forum', label: 'Forum/soru-cevap sonuçları', delta: -Math.min(12, forums * 4), note: `İlk ${n} içinde ${forums} forum sonucu: sorular tam karşılanmıyor olabilir` });
  const indep = top.slice(0, 5).filter((x) => x.kind === 'independent').length; if (indep) reducers.push({ key: 'independent', label: 'Küçük/bağımsız siteler ilk 5’te', delta: -Math.min(9, indep * 3), note: `İlk 5 içinde ${indep} bağımsız site: yeni bir site girebilir` });
  const competition = clamp(base + reducers.reduce((a, r) => a + r.delta, 0));
  const label = competition < 30 ? 'Düşük' : competition < 55 ? 'Orta' : competition < 75 ? 'Yüksek' : 'Çok yüksek';
  return { competition, label, factors, results: top, reducers, small: n < 5 };
}

/**
 * Where the top-10 results come from. Each source: how to open it (its key, or a readable refusal), the price estimate for the budget guard and `search()`, which returns
 * the same shape whatever the vendor ({ organic, questions, related, features, resultsCount, cost (USD or null), units }).
 */
const SOURCES = {
  serper: {
    label: 'Serper.dev', endpoint: serper.EP.search, estimateUsd: serper.ESTIMATE_USD,
    async open(fetchImpl) {
      const secret = await providers.secretFor('serper');
      if (!secret) throw new HttpError(409, 'Serper henüz ayarlanmadı: API Kullanımı sayfasından Serper API anahtarını kaydedip bağlantıyı test edin (serper.dev’de ücretsiz hesap, 2.500 sorgu)');
      const c = serper.createClient({ apiKey: secret, fetchImpl });
      return (q) => c.serpOrganic({ keyword: q.keyword, country: q.country, language: q.language, now: q.now });
    },
  },
  dataforseo: {
    label: 'DataForSEO', endpoint: dfs.EP.serp, estimateUsd: dfs.ESTIMATE_USD.serp,
    async open(fetchImpl) {
      const secret = await providers.secretFor('dataforseo'); const p = await providers.get('dataforseo');
      if (!secret || !p.extra.login) throw new HttpError(409, 'DataForSEO henüz ayarlanmadı: API Kullanımı sayfasından login ve API şifresini girip bağlantıyı test edin');
      const c = dfs.createClient({ login: p.extra.login, password: secret, fetchImpl });
      return async (q) => ({ ...(await c.serpOrganic({ keyword: q.keyword, country: q.country, language: q.language, device: q.device })), units: 1 });
    },
  },
};

async function latest(keywordId) {
  const r = (await db.query('SELECT * FROM serp_analyses WHERE keyword_id = $1 ORDER BY fetched_at DESC LIMIT 1', [keywordId])).rows[0];
  return r ? shape(r) : null;
}
const shape = (r) => ({ id: r.id, keywordId: r.keyword_id, provider: r.provider, providerLabel: (SOURCES[r.provider] || { label: r.provider }).label, device: r.device, competition: r.competition, factors: r.factors.factors || [], reducers: r.factors.reducers || [], label: r.factors.label, results: r.results, questions: r.questions,
  related: r.related, features: r.features, resultsCount: r.results_count === null ? null : Number(r.results_count), costUsd: r.cost_micros === null ? null : Number(r.cost_micros) / 1e6, fetchedAt: r.fetched_at, disclaimer: DISCLAIMER });

/**
 * SERP analysis of one keyword. A result younger than `seo.cacheDays` is returned without a new (paid) request unless `force`.
 * @returns { analysis, cached, stopped? }
 */
async function analyze(keywordId, { force = false, userId = null, manual = true, fetchImpl, now = new Date(), trigger = 'manual' } = {}) {
  const kw = (await db.query('SELECT * FROM keywords WHERE id = $1', [V.uuid(keywordId, 'Anahtar kelime')])).rows[0];
  if (!kw) throw new HttpError(404, 'Anahtar kelime bulunamadı');
  const cfg = (await settings.get('seo', kw.project_id)).value;
  const prev = await latest(kw.id);
  if (prev && !force && (now - new Date(prev.fetchedAt)) / 86400000 <= cfg.cacheDays) return { analysis: prev, cached: true };
  const key = cfg.serpProvider; const src = SOURCES[key];
  const search = await src.open(fetchImpl);                                   // refuses with a readable message when the source has no key
  const guard = await providers.guard(key, src.estimateUsd, { projectId: kw.project_id, now, operation: 'serp_organic' });
  if (!guard.ok) return { analysis: prev, cached: false, stopped: guard.message };
  const grant = await limits.reserve({ workType: 'serp_queries', projectId: kw.project_id, amount: 1, manual, now });
  if (!grant.ok) return { analysis: prev, cached: false, stopped: grant.message };
  const run = await runs.start(BOT, { projectId: kw.project_id, trigger, userId });
  let res;
  try { res = await search({ keyword: kw.keyword, country: kw.country, language: kw.language, device: cfg.serpDevice, now }); }
  catch (err) {
    await providers.recordUsage({ provider: key, endpoint: src.endpoint, operation: 'serp_organic', requests: 1, units: 1, costUsd: null, result: 'error', projectId: kw.project_id, meta: { code: err.code } });
    if (!err.maybeBilled) await limits.release({ workType: 'serp_queries', projectId: kw.project_id, amount: 1, day: grant.day });
    await runs.finish(run.id, { status: 'error', stats: { keyword: kw.keyword, provider: key }, error: err.message });
    throw new HttpError(err.code === 'auth' ? 401 : 502, err.message, { code: err.code });
  }
  const metrics = (await db.query('SELECT avg_referring_domains FROM keyword_metrics WHERE keyword_id = $1 AND found ORDER BY fetched_at DESC LIMIT 1', [kw.id])).rows[0];
  const score = scoreSerp(res.organic, { keyword: kw.keyword, avgReferringDomains: metrics ? metrics.avg_referring_domains : null, now });
  const row = (await db.query(`INSERT INTO serp_analyses (project_id, keyword_id, device, competition, factors, results, questions, related, features, results_count, cost_micros, provider)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
  [kw.project_id, kw.id, key === 'dataforseo' ? cfg.serpDevice : 'desktop', score.competition, JSON.stringify({ factors: score.factors, reducers: score.reducers, label: score.label }), JSON.stringify(score.results), JSON.stringify([...new Set(res.questions)].slice(0, 12)),
    JSON.stringify([...new Set(res.related)].slice(0, 12)), JSON.stringify(res.features), res.resultsCount, res.cost === null || res.cost === undefined ? null : Math.round(res.cost * 1e6), key])).rows[0];
  await providers.recordUsage({ provider: key, endpoint: src.endpoint, operation: 'serp_organic', requests: 1, units: res.units || 1, costUsd: res.cost, projectId: kw.project_id, meta: { keyword: kw.keyword } });
  await runs.finish(run.id, { status: 'ok', stats: { keyword: kw.keyword, competition: score.competition, costUsd: res.cost, provider: key } });
  return { analysis: shape(row), cached: false };
}

async function list(projectId, { limit = 50 } = {}) {
  const rows = (await db.query(`SELECT DISTINCT ON (s.keyword_id) s.*, k.keyword, k.country FROM serp_analyses s JOIN keywords k ON k.id = s.keyword_id WHERE s.project_id = $1 ORDER BY s.keyword_id, s.fetched_at DESC`, [projectId])).rows;
  return rows.sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at)).slice(0, Math.min(200, limit)).map((r) => ({ ...shape(r), keyword: r.keyword, country: r.country }));
}

module.exports = { DISCLAIMER, SOURCES, scoreSerp, kindOf, analyze, latest, list };
