/**
 * A fake of Serper.dev behind an injectable fetch, shaped like the vendor's public examples: /search answers organic results (+ people also ask, related searches), /autocomplete
 * answers suggestions. `data` maps a query to the list of domains of its organic results ('*' = any query); `suggest` maps a seed to its autocomplete suggestions ('*' = any).
 */
function fakeSerper(data = {}, suggest = {}) {
  const calls = []; const state = { status: 200, body: null, throwTimeout: false };
  const fetchImpl = async (url, o) => {
    const body = JSON.parse(o.body); calls.push({ url, body, key: o.headers['X-API-KEY'], method: o.method });
    if (state.throwTimeout) { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }
    if (state.status !== 200) return { ok: false, status: state.status, json: async () => state.body || {} };
    if (/\/autocomplete$/.test(url)) { const list = suggest[body.q] || suggest['*'] || []; return { ok: true, status: 200, json: async () => ({ searchParameters: { q: body.q, type: 'autocomplete' }, suggestions: list.map((value) => ({ value })) }) }; }
    const d = data[body.q] || data['*'] || [];
    return { ok: true, status: 200, json: async () => ({ searchParameters: { q: body.q }, organic: d.map((dom, i) => ({ title: `${dom} page`, link: `https://www.${dom}/p${i}`, snippet: 'snippet', position: i + 1, date: i % 2 ? '3 days ago' : 'Mar 10, 2022' })),
      peopleAlsoAsk: [{ question: 'Is it worth it?', snippet: 's', title: 't', link: 'https://x.test/a' }], relatedSearches: [{ query: 'chatgpt plus cost' }], answerBox: { title: 'x' } }) };
  };
  return { fetchImpl, calls, state };
}

module.exports = { fakeSerper };
