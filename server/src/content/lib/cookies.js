const { env } = require('../env');

/** The session lives in an httpOnly cookie (page scripts cannot read it), only sent to /api/content. */
const COOKIE = 'cp_session';

function attrs(maxAge) {
  return `Path=/api/content; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env().isProd ? '; Secure' : ''}`;
}
const setSession = (res, token, maxAgeSeconds) => res.append('Set-Cookie', `${COOKIE}=${token}; ${attrs(maxAgeSeconds)}`);
const clearSession = (res) => res.append('Set-Cookie', `${COOKIE}=; ${attrs(0)}`);

function readSession(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === COOKIE) { try { return decodeURIComponent(part.slice(i + 1).trim()) || null; } catch { return null; } }
  }
  return null;
}

module.exports = { COOKIE, setSession, clearSession, readSession };
