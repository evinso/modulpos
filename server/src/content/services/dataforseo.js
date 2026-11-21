/**
 * DataForSEO API v3 client (https://docs.dataforseo.com). Written from the endpoint documentation; it has NOT been run against a real account
 * (no credentials were available), only against fixtures shaped like the documented answers. Things this client takes care of:
 *  - HTTP Basic auth; one task per live request; the account is billed per request, the REAL price comes back in the answer (`cost`) and is what we record
 *  - the HTTP status is almost always 200: success is `status_code` 20000 on the answer AND on the task; every task is checked on its own
 *  - "no search results" (40102) is an empty answer, not a failure; everything else becomes a readable Turkish error with a stable `code`
 *  - no automatic retry of a paid call (a retry after a timeout could be billed twice); the caller decides
 */
const BASE = 'https://api.dataforseo.com';
const LOCATIONS = { US: 2840, GB: 2826, CA: 2124, AU: 2036 };      // Google location codes, checked against DataForSEO's locations list
const EP = {
  overview: '/v3/dataforseo_labs/google/keyword_overview/live',
  suggestions: '/v3/dataforseo_labs/google/keyword_suggestions/live',
  related: '/v3/dataforseo_labs/google/related_keywords/live',
  serp: '/v3/serp/google/organic/live/advanced',
  user: '/v3/appendix/user_data',
};
/** What one call usually costs in USD (from the examples in the documentation). ONLY used to refuse a call early when a budget is nearly spent; the cost that is recorded is the one the API reports. */
const ESTIMATE_USD = { overview: 0.0201, suggestions: 0.0101, related: 0.0103, serp: 0.003 };
const MAX_OVERVIEW_KEYWORDS = 700;

class DataForSeoError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'DataForSeoError'; this.code = code; Object.assign(this, extra); }
}

const MESSAGES = {
  40100: ['auth', 'DataForSEO kimlik doğrulaması başarısız (login ya da API şifresi hatalı)'], 40104: ['auth', 'DataForSEO hesabı doğrulanmamış; DataForSEO panelinden hesabı doğrulayın'],
  40200: ['funds', 'DataForSEO bakiyesi yetersiz'], 40210: ['funds', 'DataForSEO bakiyesi yetersiz'], 40203: ['budget', 'DataForSEO hesabının maliyet sınırı aşıldı'],
  40202: ['rate_limit', 'DataForSEO dakikalık istek sınırı aşıldı; biraz sonra tekrar deneyin'], 40209: ['rate_limit', 'DataForSEO aynı anda çok fazla sorgu aldı; biraz sonra tekrar deneyin'],
  40501: ['bad_request', 'DataForSEO isteği geçersiz bulundu'], 40502: ['bad_request', 'DataForSEO isteği boş bulundu'], 40503: ['bad_request', 'DataForSEO isteği geçersiz bulundu'], 40506: ['bad_request', 'DataForSEO bilinmeyen alan bildirdi'],
  50000: ['server', 'DataForSEO sunucu hatası'], 50301: ['server', 'DataForSEO bağlı olduğu bir servise ulaşamadı'], 50401: ['server', 'DataForSEO zaman aşımı'],
};
function fail(statusCode, statusMessage) {
  const m = MESSAGES[statusCode];
  return new DataForSeoError(m ? m[0] : 'api', `${m ? m[1] : 'DataForSEO hata döndürdü'} (kod ${statusCode}${statusMessage ? `: ${String(statusMessage).slice(0, 120)}` : ''})`, { apiCode: statusCode, retryable: m ? ['rate_limit', 'server'].includes(m[0]) : false });
}

/** only web addresses ever reach a link in the panel (a provider answer is data, not trusted markup) */
const webUrl = (u) => (/^https?:\/\/[^\s]+$/i.test(String(u || '')) ? String(u).slice(0, 1000) : '');
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const COMP = { LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8 };

/** A Labs `keyword_info` + properties block as one flat record. Missing parts stay null (never 0). */
function keywordRecord(item) {
  const ki = item.keyword_info || {}; const kp = item.keyword_properties || {}; const si = item.search_intent_info || {}; const bl = item.avg_backlinks_info || {};
  const monthly = (Array.isArray(ki.monthly_searches) ? ki.monthly_searches : []).filter((m) => m && Number.isFinite(Number(m.year)) && Number.isFinite(Number(m.month)))
    .map((m) => ({ year: Number(m.year), month: Number(m.month), searchVolume: num(m.search_volume) })).sort((a, b) => a.year - b.year || a.month - b.month);
  const comp = typeof ki.competition === 'string' ? COMP[ki.competition.toUpperCase()] ?? null : num(ki.competition);
  const hasData = ki.search_volume !== undefined && ki.search_volume !== null || monthly.length > 0 || ki.cpc !== undefined && ki.cpc !== null;
  return { keyword: String(item.keyword || '').toLowerCase(), found: !!hasData, searchVolume: num(ki.search_volume), cpc: num(ki.cpc), paidCompetition: comp, competitionLevel: ki.competition_level || (typeof ki.competition === 'string' ? ki.competition : null),
    keywordDifficulty: num(kp.keyword_difficulty), intent: si.main_intent || null, monthly, avgReferringDomains: num(bl.referring_domains) };
}

/** Last 3 months against the 3 months before, in percent; null when the history is too short or the earlier period had no searches. */
function trendPct(monthly) {
  const m = (monthly || []).filter((x) => x.searchVolume !== null);
  if (m.length < 6) return null;
  const last = m.slice(-3).reduce((a, x) => a + x.searchVolume, 0); const prev = m.slice(-6, -3).reduce((a, x) => a + x.searchVolume, 0);
  if (prev <= 0) return null;
  return Math.round(((last - prev) / prev) * 1000) / 10;
}

const QUESTION = /^(what|how|why|when|where|who|whom|which|can|could|does|do|did|is|are|was|were|should|will|would)\b/i;
const isQuestion = (kw) => QUESTION.test(String(kw).trim());

function createClient({ login, password, fetchImpl = globalThis.fetch, timeoutMs = 45000 }) {
  if (!login || !password) throw new DataForSeoError('auth', 'DataForSEO login ve API şifresi gerekli');
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`;

  async function call(path, body, { method = 'POST' } = {}) {
    let res;
    try {
      res = await fetchImpl(`${BASE}${path}`, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify([body]) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new DataForSeoError(err && err.name === 'TimeoutError' ? 'timeout' : 'network', err && err.name === 'TimeoutError' ? `DataForSEO ${Math.round(timeoutMs / 1000)} saniyede cevap vermedi` : 'DataForSEO’ya ulaşılamadı (ağ hatası)', { retryable: false, maybeBilled: true });
    }
    if (res.status === 401) throw new DataForSeoError('auth', 'DataForSEO kimlik doğrulaması başarısız (login ya da API şifresi hatalı)', { status: 401 });
    if (res.status === 402) throw new DataForSeoError('funds', 'DataForSEO bakiyesi yetersiz', { status: 402 });
    if (!res.ok) throw new DataForSeoError('http', `DataForSEO HTTP ${res.status} döndürdü`, { status: res.status, retryable: res.status >= 500 });
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== 'object') throw new DataForSeoError('bad_answer', 'DataForSEO okunamayan bir cevap verdi');
    if (json.status_code && json.status_code !== 20000) throw fail(json.status_code, json.status_message);
    const task = Array.isArray(json.tasks) ? json.tasks[0] : null;
    if (!task) throw new DataForSeoError('bad_answer', 'DataForSEO cevabında görev yok');
    const cost = num(task.cost) ?? num(json.cost);
    if (task.status_code === 40102) return { empty: true, result: null, cost };                     // "no search results"
    if (task.status_code !== 20000) throw fail(task.status_code, task.status_message);
    return { empty: false, result: Array.isArray(task.result) ? task.result[0] || null : null, cost, path: task.path };
  }

  return {
    /** Metrics for up to 700 keywords in ONE request: volume, CPC, paid competition, monthly history, keyword difficulty, intent. Keywords without data are simply absent. */
    async keywordOverview({ keywords, country = 'US', language = 'en', includeSerpInfo = false }) {
      if (!keywords.length) return { records: [], cost: 0 };
      if (keywords.length > MAX_OVERVIEW_KEYWORDS) throw new DataForSeoError('bad_request', `Tek istekte en fazla ${MAX_OVERVIEW_KEYWORDS} anahtar kelime sorgulanabilir`);
      const r = await call(EP.overview, { keywords, location_code: LOCATIONS[country] || LOCATIONS.US, language_code: language, include_serp_info: includeSerpInfo });
      const items = r.result && Array.isArray(r.result.items) ? r.result.items : [];
      return { records: items.filter((i) => i && i.keyword).map(keywordRecord), cost: r.cost };
    },
    /** Long-tail and question suggestions for one seed keyword (each record already carries its metrics). */
    async keywordSuggestions({ keyword, country = 'US', language = 'en', limit = 50 }) {
      const r = await call(EP.suggestions, { keyword, location_code: LOCATIONS[country] || LOCATIONS.US, language_code: language, limit: Math.min(1000, Math.max(1, limit)), order_by: ['keyword_info.search_volume,desc'] });
      const items = r.result && Array.isArray(r.result.items) ? r.result.items : [];
      return { records: items.filter((i) => i && i.keyword).map(keywordRecord), cost: r.cost, total: r.result ? num(r.result.total_count) : null };
    },
    /** Keywords related to a seed (depth 1 = at most 8, 2 = 72). The items nest the data under keyword_data. */
    async relatedKeywords({ keyword, country = 'US', language = 'en', limit = 50, depth = 1 }) {
      const r = await call(EP.related, { keyword, location_code: LOCATIONS[country] || LOCATIONS.US, language_code: language, depth: Math.min(2, Math.max(0, depth)), limit: Math.min(1000, Math.max(1, limit)) });
      const items = r.result && Array.isArray(r.result.items) ? r.result.items : [];
      return { records: items.map((i) => i && i.keyword_data).filter((d) => d && d.keyword).map(keywordRecord), cost: r.cost };
    },
    /** The Google organic top results of one query ("people also ask", related searches and the SERP features seen come with it). */
    async serpOrganic({ keyword, country = 'US', language = 'en', device = 'desktop', depth = 10 }) {
      const r = await call(EP.serp, { keyword, location_code: LOCATIONS[country] || LOCATIONS.US, language_code: language, device, depth });
      const res = r.result || {}; const items = Array.isArray(res.items) ? res.items : [];
      const organic = items.filter((i) => i && i.type === 'organic').map((i) => ({ rank: num(i.rank_group) ?? num(i.rank_absolute), domain: String(i.domain || '').toLowerCase(), title: String(i.title || ''), url: webUrl(i.url), description: String(i.description || '').slice(0, 300), timestamp: i.timestamp || null }));
      const questions = items.filter((i) => i && i.type === 'people_also_ask').flatMap((i) => (i.items || []).map((q) => String(q.title || '')).filter(Boolean));
      const related = items.filter((i) => i && i.type === 'related_searches').flatMap((i) => (i.items || []).map((q) => (typeof q === 'string' ? q : String(q && q.title || ''))).filter(Boolean));
      const forums = items.filter((i) => i && i.type === 'discussions_and_forums').flatMap((i) => (i.items || []).map((q) => ({ domain: String(q.domain || '').toLowerCase(), title: String(q.title || '') })));
      return { organic, questions, related, forums, features: Array.isArray(res.item_types) ? res.item_types.filter((t) => t && t !== 'organic') : [], resultsCount: num(res.se_results_count), cost: r.cost, empty: r.empty };
    },
    /** Account data (free): the balance in USD. */
    async userData() {
      const r = await call(EP.user, null, { method: 'GET' });
      const money = (r.result && r.result.money) || {};
      return { balance: num(money.balance), login: r.result && r.result.login };
    },
  };
}

module.exports = { createClient, DataForSeoError, LOCATIONS, EP, ESTIMATE_USD, MAX_OVERVIEW_KEYWORDS, keywordRecord, trendPct, isQuestion };
