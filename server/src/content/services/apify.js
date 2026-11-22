const { LOCATIONS, COMP, num, emptyRecord } = require('../lib/keywordData');

/**
 * Google keyword data (search volume, CPC, competition, difficulty, intent, 12 months of history) through an Apify "Actor" (https://apify.com): a pay-per-keyword tool run in
 * Apify's cloud. Why this one: Apify's FREE plan has no card and gives a monthly credit (5 USD according to Apify's pricing page), the actors charge per keyword that has data
 * (a few USD per 1,000), and there is no prepaid deposit. What to know honestly:
 *  - the actor is somebody else's program (the default one resells DataForSEO's data), so it can change or disappear: the actor name is a setting, the connection test checks that
 *    it still exists, and the file import stays as the way that never depends on anybody
 *  - written from Apify's public API documentation and the actor pages' own descriptions; it has NOT been run with a real token
 *  - the money is NOT known to us (the price depends on the actor and on the owner's Apify plan): the cost of a call is recorded as UNKNOWN ("Bilinmiyor"), and the safety is a monthly
 *    cap on the NUMBER of keywords asked (default well under what the free credit buys)
 *  - an answer that does not mention a keyword is "no answer", never "no data": a free plan limit or a failed item must not be stored as "this keyword has no searches"
 */
const BASE = 'https://api.apify.com/v2';
const DEFAULT_ACTOR = 'gaelasao/keyword-research-api';
const MAX_BATCH = 1000;

class ApifyError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'ApifyError'; this.code = code; Object.assign(this, extra); }
}

const actorPath = (actor) => encodeURIComponent(String(actor || DEFAULT_ACTOR).trim().replace('/', '~'));
const styleOf = (actor) => (/plainrows/i.test(String(actor)) ? 'plainrows' : 'gaelasao');

/** the actor's input: the two actors this was written for name their fields differently */
function inputFor(actor, { keywords, country = 'US', language = 'en' }) {
  if (styleOf(actor) === 'plainrows') return { keywords, mode: 'volume', country: country.toUpperCase(), languageCode: language, historyMonths: 12 };
  return { keywords, mode: 'metrics', location: country.toUpperCase(), language, includeTrend: true };
}

const pick = (o, ...names) => { for (const n of names) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n]; return null; };
const text = (v) => (Array.isArray(v) ? String(v[0] || '') : String(v || '')).toLowerCase();

/** one dataset item of either actor as the flat record (a part the item does not have stays null) */
function recordOf(item) {
  const monthly = (Array.isArray(pick(item, 'monthly_searches', 'monthlySearches')) ? pick(item, 'monthly_searches', 'monthlySearches') : [])
    .map((m) => ({ year: num(m && m.year), month: num(m && m.month), searchVolume: num(pick(m || {}, 'search_volume', 'searchVolume', 'volume')) })).filter((m) => m.year !== null && m.month !== null).sort((a, b) => a.year - b.year || a.month - b.month);
  const rawComp = pick(item, 'competition'); const level = pick(item, 'competition_level', 'competitionLevel');
  const paid = typeof rawComp === 'string' && COMP[rawComp.toUpperCase()] !== undefined ? COMP[rawComp.toUpperCase()] : num(rawComp);
  const volume = num(pick(item, 'search_volume', 'searchVolume')); const cpc = num(pick(item, 'cpc', 'cpcUsd'));
  const explicit = item.found === false || /no[_ ]?data|not[_ ]?found|missing/i.test(String(item.data_status || ''));
  const rec = { ...emptyRecord(item.keyword), searchVolume: volume, cpc, paidCompetition: paid, competitionLevel: level ? String(level).toLowerCase() : null, keywordDifficulty: num(pick(item, 'keyword_difficulty', 'keywordDifficulty')),
    intent: text(pick(item, 'search_intent', 'searchIntent')) || null, monthly, avgReferringDomains: null };
  rec.found = !explicit && (volume !== null || monthly.length > 0 || cpc !== null);
  return rec;
}

function createClient({ token, actor = DEFAULT_ACTOR, fetchImpl = globalThis.fetch, timeoutMs = 280000 }) {
  if (!token) throw new ApifyError('auth', 'Apify API belirteci gerekli');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function call(url, { method = 'GET', body, timeout = 20000 } = {}) {
    let res;
    try { res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
    catch (err) { throw new ApifyError(err && err.name === 'TimeoutError' ? 'timeout' : 'network', err && err.name === 'TimeoutError' ? `Apify ${Math.round(timeout / 1000)} saniyede cevap vermedi` : 'Apify’a ulaşılamadı (ağ hatası)', { retryable: true, maybeBilled: method === 'POST' }); }
    const json = await res.json().catch(() => null);
    const said = (json && json.error && (json.error.message || json.error.type) ? String(json.error.message || json.error.type).slice(0, 160) : '').split(token).join('[gizli]');          // what the service says is shown: never with our token in it
    if (res.status === 401) throw new ApifyError('auth', 'Apify belirteci reddedildi (401): belirteci Apify → Settings → API & Integrations’tan yeniden kopyalayın', { status: 401 });
    if (res.status === 402 || res.status === 403 && /credit|usage|limit|payment|subscription/i.test(said)) throw new ApifyError('funds', `Apify kredisi/kullanım hakkı bitmiş görünüyor${said ? ` (${said})` : ''}: ücretsiz planda kredi ay başında yenilenir`, { status: res.status });
    if (res.status === 404) throw new ApifyError('not_found', `Apify’da “${actor}” aktörü bulunamadı: aktör kaldırılmış ya da adı değişmiş olabilir (API Kullanımı → Apify → Aktör)`, { status: 404 });
    if (res.status === 408) throw new ApifyError('timeout', 'Apify çalışması süre sınırında bitmedi; daha az anahtar kelimeyle deneyin', { status: 408, retryable: true, maybeBilled: true });
    if (res.status === 429) throw new ApifyError('rate_limit', 'Apify istek sınırı aşıldı; biraz sonra tekrar deneyin', { status: 429, retryable: true });
    if (res.status === 400) throw new ApifyError('bad_request', `Apify aktörün girdisini kabul etmedi${said ? ` (${said})` : ''}`, { status: 400 });
    if (!res.ok) throw new ApifyError('http', `Apify HTTP ${res.status} döndürdü${said ? ` (${said})` : ''}`, { status: res.status, retryable: res.status >= 500, maybeBilled: method === 'POST' });
    return json;
  }

  return {
    /** Free: who is this token, and what does this month's usage look like (the fields that are missing are simply left out) */
    async account() {
      const me = await call(`${BASE}/users/me`); const d = (me && me.data) || {};
      let usage = null; try { const l = await call(`${BASE}/users/me/limits`); const c = (l && l.data && l.data.current) || {}; const m = (l && l.data && l.data.limits) || {}; usage = { usedUsd: num(c.monthlyUsageUsd), limitUsd: num(m.maxMonthlyUsageUsd) }; } catch { /* the usage is a bonus */ }
      return { username: d.username || null, plan: d.plan && (d.plan.id || d.plan.name) ? String(d.plan.id || d.plan.name) : null, usage };
    },
    /** Free: does the actor exist (and is it usable)? */
    async actorInfo() { const r = await call(`${BASE}/acts/${actorPath(actor)}`); const d = (r && r.data) || {}; return { name: d.name || null, username: d.username || null, title: d.title || null }; },
    /**
     * Metrics for up to `MAX_BATCH` keywords in ONE run (the call waits for the run to end). Keywords the actor says nothing about are returned in `missing` (NOT as "no data").
     * @returns { records, missing: [keyword], units }
     */
    async keywordOverview({ keywords, country = 'US', language = 'en' }) {
      if (!keywords.length) return { records: [], missing: [], units: 0 };
      if (keywords.length > MAX_BATCH) throw new ApifyError('bad_request', `Tek çalıştırmada en fazla ${MAX_BATCH} anahtar kelime sorgulanabilir`);
      if (!LOCATIONS[country]) throw new ApifyError('bad_request', 'Bu ülke desteklenmiyor');
      const items = await call(`${BASE}/acts/${actorPath(actor)}/run-sync-get-dataset-items?timeout=240`, { method: 'POST', body: inputFor(actor, { keywords, country, language }), timeout: timeoutMs });
      if (!Array.isArray(items)) throw new ApifyError('bad_answer', 'Apify aktörü okunamayan bir cevap verdi', { maybeBilled: true });
      const records = items.filter((i) => i && typeof i === 'object' && i.keyword).map(recordOf);
      const seen = new Set(records.map((r) => r.keyword));
      return { records, missing: keywords.filter((k) => !seen.has(String(k).toLowerCase())), units: keywords.length };
    },
  };
}

module.exports = { createClient, ApifyError, DEFAULT_ACTOR, MAX_BATCH, inputFor, recordOf, styleOf };
