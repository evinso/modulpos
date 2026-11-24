/**
 * A fake of the parts of Apify's REST API the platform uses, in the documented shapes: the account, its monthly limits, the actor's record and a SYNCHRONOUS actor run that returns the
 * dataset items. The items follow the output field names of the default actor's public page (search_volume, monthly_searches, cpc, competition, keyword_difficulty, search_intent ...).
 * `volumes`: { keyword: { volume, cpc, comp, kd, intent, monthly: [{ year, month, search_volume }] } }; a keyword that is not in the table is simply NOT in the answer (what the real
 * actor does for a keyword without data is not known: the platform must not take absence for "nobody searches for this").
 */
function fakeApify(data = {}) {
  const calls = []; const state = { freeLimit: false, fail: null, actorGone: false, noItems: false, style: 'gaelasao', cutAt: null, username: 'owner', usage: { usedUsd: 1.2, limitUsd: 5 } };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const item = (k, v) => (v.none ? { keyword: k, search_volume: null, monthly_searches: [], data_status: 'no_data' } : state.style === 'plainrows'
    ? { keyword: k, found: true, searchVolume: v.volume, cpcUsd: v.cpc ?? 1.1, competition: v.comp ?? 0.3, competitionLevel: 'LOW', keywordDifficulty: v.kd ?? 30, searchIntent: v.intent || 'informational', monthlySearches: (v.monthly || []).map((m) => ({ year: m.year, month: m.month, searchVolume: m.search_volume })) }
    : { keyword: k, search_volume: v.volume, cpc: v.cpc ?? 1.1, competition: v.comp ?? 0.3, competition_level: 'LOW', keyword_difficulty: v.kd ?? 30, search_intent: v.intent || 'informational', monthly_searches: v.monthly || [], data_status: 'ok' });
  const fetchImpl = async (url, o = {}) => {
    const u = new URL(url); const path = u.pathname; const body = o.body ? JSON.parse(o.body) : null; calls.push({ method: o.method || 'GET', path, body, auth: o.headers && o.headers.Authorization });
    if (state.fail === 'timeout') { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }
    if (state.fail === 'network') throw new TypeError('fetch failed');
    if (typeof state.fail === 'number') return json(state.fail, { error: { type: 'x', message: state.failMessage || 'failed' } });
    if (!/^Bearer \S+$/.test((o.headers || {}).Authorization || '')) return json(401, { error: { type: 'token-not-provided', message: 'no token' } });
    if (path === '/v2/users/me') return json(200, { data: { username: state.username, plan: { id: 'FREE' } } });
    if (path === '/v2/users/me/limits') return json(200, { data: { current: { monthlyUsageUsd: state.usage.usedUsd }, limits: { maxMonthlyUsageUsd: state.usage.limitUsd } } });
    const act = /^\/v2\/acts\/([^/]+)$/.exec(path);
    if (act) return state.actorGone ? json(404, { error: { type: 'record-not-found', message: 'Actor was not found' } }) : json(200, { data: { name: decodeURIComponent(act[1]).split('~')[1], username: decodeURIComponent(act[1]).split('~')[0] } });
    if (/^\/v2\/acts\/[^/]+\/runs$/.test(path)) return json(200, { data: { items: [{ id: 'run-last', status: 'SUCCEEDED', startedAt: '2026-11-24T00:00:00.000Z' }] } });          // the last run of the actor (its log is read when nothing came back)
    if (path === '/v2/actor-runs/run-last/log') return { ok: true, status: 200, text: async () => (state.freeLimit ? "INFO  Apify free plan: today's 5 free runs are used. They reset at 00:00 UTC, in about 4 hours. Nothing was looked up or charged." : 'INFO  [Status message] done') };
    if (/^\/v2\/acts\/[^/]+\/run-sync-get-dataset-items$/.test(path)) {
      if (state.freeLimit) return json(200, []);                                                      // the free plan's daily limit: the run "succeeds" with an empty dataset
      if (state.actorGone) return json(404, { error: { type: 'record-not-found', message: 'Actor was not found' } });
      const asked = body.keywords || [];
      if (state.cutAt !== null && asked.length > state.cutAt) return json(200, asked.slice(0, state.cutAt).filter((k) => data.volumes && data.volumes[k]).map((k) => item(k, data.volumes[k])));      // a plan limit: only the first keywords are looked up
      return json(200, state.noItems ? [] : asked.filter((k) => data.volumes && data.volumes[k]).map((k) => item(k, data.volumes[k])));
    }
    throw new Error(`unexpected ${path}`);
  };
  return { fetchImpl, calls, state, asked: () => calls.filter((c) => c.method === 'POST') };
}

module.exports = { fakeApify };
