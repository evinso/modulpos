const { env } = require('./env');
const cookies = require('./lib/cookies');
const auth = require('./services/auth');
const { HttpError } = require('./lib/http');
const { UUID } = require('./lib/validate');

/** No browser or proxy keeps anything of this API (sessions, drafts, costs). */
const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;
const originAllowed = (origin) => env().adminOrigins.includes(origin) || (!env().isProd && DEV_ORIGIN.test(origin));
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF guard for the cookie session: a state-changing request must carry the custom header (a page of another site cannot add it without a CORS
 * preflight, which only our admin origins pass) and, when the browser sends an Origin, it must be one of ours.
 */
function csrf(req, _res, next) {
  if (!UNSAFE.has(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'modulpos-content') return next(new HttpError(403, 'İstek doğrulanamadı (başlık eksik)'));
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) return next(new HttpError(403, 'İstek bu adresten kabul edilmiyor'));
  next();
}

async function requireAuth(req, _res, next) {
  try {
    const me = await auth.authenticate(cookies.readSession(req));
    if (!me) return next(new HttpError(401, 'Oturum açmanız gerekiyor'));
    req.cu = me;
    next();
  } catch (err) { next(err); }
}

const need = (perm) => (req, _res, next) => (auth.can(req.cu.user.role, perm) ? next() : next(new HttpError(403, 'Bu işlem için yetkiniz yok')));

/** :id style parameters are UUIDs; anything else is "not found" (and never reaches the database). */
const uuidParams = (router, names) => names.forEach((n) => router.param(n, (_req, _res, next, v) => (UUID.test(v) ? next() : next(new HttpError(404, 'Kayıt bulunamadı')))));

module.exports = { noStore, csrf, requireAuth, need, uuidParams, originAllowed };
