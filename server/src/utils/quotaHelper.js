const prisma = require('../config/database');

/**
 * Returns the effective quota for a user.
 * Uses the user's maxProducts / maxXmlSources fields (set by admin or auto-updated on subscription).
 */
async function getUserQuota(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { maxProducts: true, maxXmlSources: true }
  });
  return {
    maxProducts: user?.maxProducts ?? 5000,
    maxXmlSources: user?.maxXmlSources ?? 3
  };
}

/**
 * Checks XML source limit. Throws 402 if over limit.
 */
async function checkXmlSourceLimit(userId, storeId) {
  const { maxXmlSources } = await getUserQuota(userId);
  const current = await prisma.xmlSource.count({ where: { storeId } });
  if (current >= maxXmlSources) {
    const err = new Error(`XML kaynağı limitine ulaştınız. Planınız en fazla ${maxXmlSources} kaynak destekler.`);
    err.statusCode = 402;
    throw err;
  }
}

/**
 * Checks product limit. Throws 402 if over limit.
 */
async function checkProductLimit(userId, storeId, addCount = 1) {
  const { maxProducts } = await getUserQuota(userId);
  const current = await prisma.product.count({ where: { storeId } });
  if (current + addCount > maxProducts) {
    const err = new Error(`Ürün limitine ulaştınız. Planınız en fazla ${maxProducts} ürün destekler. Mevcut: ${current}`);
    err.statusCode = 402;
    throw err;
  }
}

/**
 * Updates user quota based on a plan's limits.
 * Called when a subscription is activated.
 */
async function applyPlanQuota(userId, maxProducts, maxXmlSources) {
  await prisma.user.update({
    where: { id: userId },
    data: { maxProducts, maxXmlSources }
  });
}

module.exports = { getUserQuota, checkXmlSourceLimit, checkProductLimit, applyPlanQuota };
