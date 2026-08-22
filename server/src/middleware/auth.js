const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

// In-memory throttle: only update lastSeenAt once per 5 minutes per session
const sessionThrottle = new Map();

const auth = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Yetkilendirme tokeni bulunamadı' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

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
