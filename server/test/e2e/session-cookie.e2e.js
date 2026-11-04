// Emulates a browser (cookie jar + Origin header) against a running deployment. See test/e2e/README.md.
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const ORIGIN = process.env.WEB_ORIGIN || 'https://modulpos.com';

(async () => {
  let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
  let jar = '';                                            // the browser's cookie jar for the API host
  const setCookies = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []);
  const absorb = (r) => { for (const c of setCookies(r)) { const [pair] = c.split(';'); const [k, v] = [pair.split('=')[0], pair.slice(pair.indexOf('=') + 1)]; jar = c.includes('Max-Age=0') || !v ? '' : `${k}=${v}`; } };
  const xhr = async (m, u, { body, csrf = true, cookie = true, headers = {} } = {}) => {
    const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(csrf ? { 'X-Requested-With': 'XMLHttpRequest' } : {}), ...(cookie && jar ? { Cookie: jar } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    absorb(r); let d; try { d = await r.clone().json(); } catch { /* not json */ } return { r, d };
  };
  const email = `tmp-cookie-${Date.now()}@example.invalid`;
  let userId;
  try {
    const reg = await xhr('POST', '/auth/register', { body: { email, password: 'Passw0rd!test', name: 'Cookie' } });
    userId = reg.d.user.id;
    const setc = setCookies(reg.r).find((c) => c.startsWith('mp_session=')) || '';
    ok('register sets an httpOnly, Secure, SameSite=Lax session cookie', /HttpOnly/i.test(setc) && /Secure/i.test(setc) && /SameSite=Lax/i.test(setc), setc.replace(/mp_session=[^;]+/, 'mp_session=<jwt>'));
    ok('cookie is host-only (no Domain attribute)', !/Domain=/i.test(setc));
    ok('CORS: exact origin + credentials allowed', reg.r.headers.get('access-control-allow-origin') === ORIGIN && reg.r.headers.get('access-control-allow-credentials') === 'true');

    const me = await xhr('GET', '/auth/me'); ok('GET /auth/me works with the cookie alone (no Authorization header)', me.r.status === 200 && me.d.email === email);
    const noCsrf = await xhr('POST', '/content-rules/test', { body: { title: 'x' }, csrf: false });
    ok('state-changing request WITHOUT the X-Requested-With header is refused (CSRF)', noCsrf.r.status === 403, String(noCsrf.r.status));
    const withCsrf = await xhr('POST', '/content-rules/test', { body: { title: 'x' } });
    ok('same request WITH the header succeeds', withCsrf.r.status === 200, String(withCsrf.r.status));
    const getNoHeader = await xhr('GET', '/auth/me', { csrf: false }); ok('safe GET does not need the header', getNoHeader.r.status === 200);

    // legacy bearer keeps working (scripts, tests, old tabs)
    const bearer = await fetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + reg.d.token } });
    ok('bearer token still accepted (until RETURN_TOKEN_IN_BODY=0 and clients migrated)', bearer.status === 200 || reg.d.token === undefined, reg.d.token ? String(bearer.status) : 'token not in body');

    // preflight
    const pre = await fetch(API + '/xml-sources', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-requested-with' } });
    ok('preflight for the custom header is allowed for our origin and cached', pre.status === 200 && pre.headers.get('access-control-allow-credentials') === 'true' && Number(pre.headers.get('access-control-max-age')) >= 3600, 'max-age=' + pre.headers.get('access-control-max-age'));
    const evil = await fetch(API + '/xml-sources', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-requested-with' } });
    ok('preflight from another site is refused', !evil.headers.get('access-control-allow-origin'), 'status ' + evil.status);

    // SSE
    const ctl = new AbortController();
    const sse = await fetch(API + '/notifications/stream', { headers: { Origin: ORIGIN, Cookie: jar }, signal: ctl.signal });
    ok('notification stream authenticates with the cookie', sse.status === 200 && /text\/event-stream/.test(sse.headers.get('content-type') || ''), String(sse.status)); ctl.abort();
    const tokenQuery = await fetch(API + '/notifications/stream?token=' + encodeURIComponent(reg.d.token || 'x'));
    ok('token in the URL is no longer accepted', tokenQuery.status === 401, String(tokenQuery.status));

    // login again, then logout kills the session immediately
    jar = '';
    const login = await xhr('POST', '/auth/login', { body: { email, password: 'Passw0rd!test', deviceId: 'e2e-device' } });
    ok('login sets a new cookie', login.r.status === 200 && jar.startsWith('mp_session='));
    const oldCookie = jar;
    const out = await xhr('POST', '/auth/logout'); ok('logout clears the cookie', out.r.status === 200 && jar === '');
    const afterLogout = await fetch(API + '/auth/me', { headers: { Origin: ORIGIN, Cookie: oldCookie } });
    ok('the old cookie is dead right after logout (not after the 30 s cache)', afterLogout.status === 401, String(afterLogout.status));
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    if (process.env.E2E_DB_URL && userId) {
      const { Client } = require('pg'); const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
      await c.query('delete from app."User" where id=$1', [userId]); console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n); await c.end();
    } else console.log('NOTE: set E2E_DB_URL to delete the temporary user', email);
    console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
