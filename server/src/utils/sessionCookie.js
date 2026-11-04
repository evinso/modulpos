/**
 * The login session lives in an httpOnly cookie instead of browser storage: page scripts (including an injected one)
 * cannot read it. The browser attaches it automatically; state-changing requests additionally need the
 * X-Requested-With header (see middleware/auth.js), which other sites cannot send cross-origin.
 */
const COOKIE_NAME = 'mp_session';
const isProd = () => process.env.NODE_ENV === 'production';

function maxAgeSeconds() {
  const m = String(process.env.JWT_EXPIRES_IN || '7d').match(/^(\d+)\s*([smhd])?$/i);
  if (!m) return 7 * 24 * 3600;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 }[unit]);
}

function attributes(maxAge) {
  // Host-only cookie on the API host; SameSite=Lax: modulpos.com -> api.modulpos.com is same-site, other sites cannot ride along
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd() ? '; Secure' : ''}`;
}

function setSessionCookie(res, token) {
  res.append('Set-Cookie', `${COOKIE_NAME}=${token}; ${attributes(maxAgeSeconds())}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; ${attributes(0)}`);
}

function readSessionCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(i + 1).trim()) || null;
  }
  return null;
}

/** Login responses no longer need to hand the token to page JavaScript. Set RETURN_TOKEN_IN_BODY=0 once every client uses the cookie. */
const returnTokenInBody = () => process.env.RETURN_TOKEN_IN_BODY !== '0';

module.exports = { COOKIE_NAME, setSessionCookie, clearSessionCookie, readSessionCookie, returnTokenInBody };
