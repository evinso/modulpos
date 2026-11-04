const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

// In-memory throttle: only update lastSeenAt once per 5 minutes per session
const sessionThrottle = new Map();

// Short-lived cache of "is this user/session still allowed?" so revoked sessions
// and deactivated users are rejected within STATUS_TTL_MS without a DB hit per request.
const STATUS_TTL_MS = 30 * 1000;
const statusCache = new Map(); // `${userId}|${sessionId}` -> { ok, role, at }

async function isStillAllowed(decoded) {
  const key = `${decoded.id}|${decoded.sessionId || ''}`;
  const hit = statusCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < STATUS_TTL_MS) return hit;

  const [user, session] = await Promise.all([
    prisma.user.findUnique({ where: { id: decoded.id }, select: { isActive: true, role: true } }),
    decoded.sessionId
      ? prisma.userSession.findUnique({ where: { id: decoded.sessionId }, select: { isActive: true } })
      : Promise.resolve(null),
  ]);
  // A session row that no longer exists is tolerated (session creation is best-effort at login);
  // an explicitly deactivated one is not.
  const ok = !!user && user.isActive && !(decoded.sessionId && session && session.isActive === false);

  if (statusCache.size > 5000) statusCache.clear();
  const entry = { ok, role: user?.role, at: now };
  statusCache.set(key, entry);
  return entry;
}

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Yetkilendirme tokeni bulunamadı' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    const status = await isStillAllowed(decoded);
    if (!status.ok) {
      return res.status(401).json({ error: 'Oturumunuz sonlandırılmış veya hesabınız devre dışı' });
    }
    // Role comes from the database, not the token, so promotions/demotions apply immediately
    req.user = { ...decoded, role: status.role || decoded.role };

    // Update lastSeenAt throttled (fire-and-forget)
    if (decoded.sessionId) {
      const now = Date.now();
      const last = sessionThrottle.get(decoded.sessionId) || 0;
      if (now - last > 5 * 60 * 1000) {
        sessionThrottle.set(decoded.sessionId, now);
        prisma.userSession.update({
          where: { id: decoded.sessionId },
          data: { lastSeenAt: new Date() }
        }).catch(() => {});
      }
    }

    next();
  } catch (error) {
    res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz bulunmuyor' });
    }
    next();
  };
};

module.exports = { auth, requireRole };
