/**
 * Serper.dev client (https://serper.dev): Google search results as JSON. Used as the FREE-to-start source of the organic competition estimate (2,500 free queries,
 * no card, according to serper.dev) when DataForSEO is not available. Written from the vendor's public example answers; it has NOT been run against a real key.
 *  - one POST per query, key in the X-API-KEY header; the account is billed in CREDITS (1 per ordinary query), not dollars: the price of a credit depends on the
 *    pack the owner bought (or the free credits), so the cost of a call is recorded as UNKNOWN ("Bilinmiyor") and the credits go into `units`
 *  - no automatic retry of a call that may have been billed (the caller decides)
 *  - the answer is turned into the same shape the DataForSEO client returns, so `serp.scoreSerp` does not care where the results came from
 * What Serper does NOT give: keyword difficulty, referring domains, search volume. The organic estimate therefore has no "authority" factor (the factor is left out,
 * never filled with a made-up value) and nothing here says anything about how often a phrase is searched.
 */
const BASE = 'https://google.serper.dev';
const EP = { search: '/search' };
const COUNTRY = { US: 'us', GB: 'gb', CA: 'ca', AU: 'au' };
/** Only used to refuse a call early when a money budget is nearly spent. Not a price list: free credits cost nothing, a bought pack costs about a tenth of a cent a query (vendor's public pages, not verified). */
const ESTIMATE_USD = 0.001;

class SerperError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'SerperError'; this.code = code; Object.assign(this, extra); }
}

const webUrl = (u) => (/^https?:\/\/[^\s]+$/i.test(String(u || '')) ? String(u).slice(0, 1000) : '');
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const UNIT_MS = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 };

/**
 * Serper gives a result's date as the page shows it: "Mar 10, 2022" or "4 months ago". Returns an ISO time or null when the text is anything else.
 * Relative dates are only as exact as their unit (a month = 30 days); the freshness factor only looks at "within 30 days", so that is enough.
 */
function parseResultDate(text, now = new Date()) {
  const s = String(text || '').trim();
  const rel = /^(\d{1,3})\s+(minute|hour|day|week|month|year)s?\s+ago$/i.exec(s);
  if (rel) return new Date(now.getTime() - Number(rel[1]) * UNIT_MS[rel[2].toLowerCase()]).toISOString();
  if (/^[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}$/.test(s)) { const t = Date.parse(`${s.replace('.', '')} 00:00:00 UTC`); return Number.isNaN(t) ? null : new Date(t).toISOString(); }
  return null;
}

const hostOf = (link) => { try { return new URL(link).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

const FEATURES = [['answerBox', 'featured_snippet'], ['knowledgeGraph', 'knowledge_graph'], ['peopleAlsoAsk', 'people_also_ask'], ['topStories', 'top_stories'], ['videos', 'video'], ['images', 'images'], ['places', 'local_pack'], ['shopping', 'shopping'], ['relatedSearches', 'related_searches']];

/** Serper's answer as { organic, questions, related, features, resultsCount, cost, units, empty } (same shape as the DataForSEO client's `serpOrganic`). */
function normalize(json, { now = new Date() } = {}) {
  const j = json && typeof json === 'object' ? json : {};
  const organic = (Array.isArray(j.organic) ? j.organic : []).filter((o) => o && o.link).slice(0, 10).map((o, i) => ({
    rank: num(o.position) ?? i + 1, domain: hostOf(o.link), title: String(o.title || ''), url: webUrl(o.link), description: String(o.snippet || '').slice(0, 300), timestamp: parseResultDate(o.date, now) }));
  const questions = (Array.isArray(j.peopleAlsoAsk) ? j.peopleAlsoAsk : []).map((q) => String(q && q.question || '')).filter(Boolean);
  const related = (Array.isArray(j.relatedSearches) ? j.relatedSearches : []).map((q) => String(q && q.query || '')).filter(Boolean);
  const features = FEATURES.filter(([k]) => j[k] && (!Array.isArray(j[k]) || j[k].length)).map(([, name]) => name).filter((n) => n !== 'related_searches');
  const credits = num(j.credits);
  return { organic, questions, related, forums: [], features, resultsCount: null, cost: null, units: credits !== null && credits > 0 ? credits : 1, empty: organic.length === 0 };
}

function createClient({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  if (!apiKey) throw new SerperError('auth', 'Serper API anahtarı gerekli');

  async function call(path, body) {
    let res;
    try {
      res = await fetchImpl(`${BASE}${path}`, { method: 'POST', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new SerperError(err && err.name === 'TimeoutError' ? 'timeout' : 'network', err && err.name === 'TimeoutError' ? `Serper ${Math.round(timeoutMs / 1000)} saniyede cevap vermedi` : 'Serper’a ulaşılamadı (ağ hatası)', { retryable: false, maybeBilled: true });
    }
    const json = await res.json().catch(() => null);
    const said = json && typeof json === 'object' && json.message ? String(json.message).slice(0, 120) : '';
    if (res.status === 401 || res.status === 403) throw new SerperError('auth', `Serper API anahtarı reddedildi (HTTP ${res.status})`, { status: res.status });
    if (res.status === 429) throw new SerperError('rate_limit', 'Serper istek sınırı aşıldı; biraz sonra tekrar deneyin', { status: 429, retryable: true });
    if (res.status === 400 && /credit/i.test(said)) throw new SerperError('funds', 'Serper kredisi bitti: serper.dev panelinden kredi alın', { status: 400 });
    if (!res.ok) throw new SerperError('http', `Serper HTTP ${res.status} döndürdü${said ? ` (${said})` : ''}`, { status: res.status, retryable: res.status >= 500 });
    if (!json || typeof json !== 'object') throw new SerperError('bad_answer', 'Serper okunamayan bir cevap verdi');
    return json;
  }

  return {
    /** The Google organic top results of one query (up to 10), with "people also ask" and related searches. */
    async serpOrganic({ keyword, country = 'US', language = 'en', now = new Date() }) {
      const json = await call(EP.search, { q: keyword, gl: COUNTRY[country] || COUNTRY.US, hl: language, num: 10 });
      return normalize(json, { now });
    },
  };
}

module.exports = { createClient, SerperError, EP, ESTIMATE_USD, COUNTRY, parseResultDate, normalize };
