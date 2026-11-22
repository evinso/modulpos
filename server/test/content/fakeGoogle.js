const crypto = require('node:crypto');

/**
 * A fake of the two Google endpoints Search Console needs (the OAuth token endpoint and the Search Console API) behind an injectable fetch. It VERIFIES the signed JWT of the
 * service account with the matching public key, so a wrong signature is refused like Google would.
 */
function makeKey(email = 'svc-account@project-1.iam.gserviceaccount.com') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { json: { type: 'service_account', project_id: 'project-1', private_key_id: 'abcd1234efgh5678', private_key: privateKey, client_email: email, token_uri: 'https://oauth2.googleapis.com/token' }, publicKey };
}

function fakeGoogle({ publicKey, email, sites = [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteRestrictedUser' }], rows = () => [], tokenStatus = 200 } = {}) {
  const calls = []; const st = { apiStatus: null, tokens: 0, lastClaim: null, sites };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, o = {}) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      calls.push({ kind: 'token' }); st.tokens++;
      const form = new URLSearchParams(o.body); const [h, c, s] = String(form.get('assertion')).split('.');
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'));
      st.lastClaim = JSON.parse(Buffer.from(c, 'base64url').toString()); st.lastHeader = JSON.parse(Buffer.from(h, 'base64url').toString());
      if (tokenStatus !== 200) return json(tokenStatus, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
      if (!ok || st.lastClaim.iss !== email) return json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json(400, { error: 'unsupported_grant_type' });
      return json(200, { access_token: `tok-${st.tokens}`, expires_in: 3600, token_type: 'Bearer' });
    }
    if (!u.startsWith('https://www.googleapis.com/webmasters/v3/')) throw new Error(`unexpected url ${u}`);
    if ((o.headers || {}).Authorization !== `Bearer tok-${st.tokens}`) return json(401, { error: { message: 'Invalid Credentials' } });
    if (st.apiStatus) return json(st.apiStatus, { error: { message: 'denied' } });
    if (u.endsWith('/sites')) { calls.push({ kind: 'sites' }); return json(200, { siteEntry: st.sites }); }
    const m = /\/sites\/([^/]+)\/searchAnalytics\/query$/.exec(u);
    if (m) { const body = JSON.parse(o.body); const property = decodeURIComponent(m[1]); calls.push({ kind: 'query', property, body }); if (!st.sites.some((s) => s.siteUrl === property)) return json(404, { error: { message: 'Site not found' } }); return json(200, { rows: rows(body) }); }
    throw new Error(`unexpected path ${u}`);
  };
  return { fetchImpl, calls, st, queries: () => calls.filter((c) => c.kind === 'query') };
}

module.exports = { makeKey, fakeGoogle };
