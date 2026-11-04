// Registration helper for the e2e scripts: the API no longer has to return the JWT in the response body
// (RETURN_TOKEN_IN_BODY=0), so fall back to the session cookie it sets. Resolves like fetch(); only .json() is needed.
async function registerFetch(url, opts) {
  const r = await fetch(url, { ...opts, headers: { ...(opts && opts.headers), 'X-Requested-With': 'XMLHttpRequest' } });
  const j = await r.json();
  if (j && !j.token) {
    const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).find((c) => c.startsWith('mp_session='));
    if (cookie) j.token = cookie.split(';')[0].slice('mp_session='.length);
  }
  return { status: r.status, json: async () => j };
}
module.exports = { registerFetch };
