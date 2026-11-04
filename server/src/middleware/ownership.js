const prisma = require('../config/database');

/** Store ids owned by the given user. */
async function userStoreIds(userId) {
  const stores = await prisma.store.findMany({ where: { userId }, select: { id: true } });
  return stores.map((s) => s.id);
}

/**
 * router.param handler: 404s unless the record `id` of `model` belongs to one of
 * the caller's stores. Requires req.user (auth must already have run).
 *   router.param('id', ownedParam('xmlSource'));
 * `skip(req)` may return true for sub-paths whose :id means something else.
 */
function ownedParam(model, { skip } = {}) {
  return async (req, res, next, id) => {
    try {
      if (skip && skip(req)) return next();
      if (!req.user) return res.status(401).json({ error: 'Yetkilendirme gerekli' });
      const storeIds = await userStoreIds(req.user.id);
      const row = await prisma[model].findFirst({
        where: { id, storeId: { in: storeIds } },
        select: { id: true },
      });
      if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı' });
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { userStoreIds, ownedParam };
