const prisma = require('../config/database');

/**
 * What the marketplace's answers mean for a listing.
 *
 * "Aynı barkodlu bir ürününüz bulunduğundan yeni ürün oluşturulamaz" is NOT a rejection of the product: the marketplace
 * says the seller already has a product with this barcode. It shows up when a product that is already listed is sent
 * again (or after the local copy of the product was recreated). The listing exists, so it is treated as listed.
 */
// Turkish-tolerant: case, dotted/dotless i and diacritics do not matter
const fold = (s) => String(s).toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
const ALREADY_LISTED = /ayni\s+barkodlu\s+bir\s+urununuz\s+bulundugundan\s+yeni\s+urun\s+olusturulamaz/;

function isAlreadyListedMessage(msg) {
  return !!msg && ALREADY_LISTED.test(fold(msg));
}

/**
 * New listing state for one item of a marketplace batch result.
 *   SUCCESS of an onboarding (create) batch      -> active
 *   FAILED with "same barcode already exists"    -> active (it is already there)
 *   FAILED for any other reason                  -> rejected + the marketplace's reasons
 *   anything else                                -> unchanged
 */
function classifyBatchItem({ itemStatus, isOnboarding, failureReasons, current }) {
  if (itemStatus === 'SUCCESS' && isOnboarding) return { status: 'active', error: null };
  if (itemStatus === 'FAILED') {
    const reasons = Array.isArray(failureReasons) ? failureReasons : [];
    if (reasons.some(isAlreadyListedMessage)) return { status: 'active', error: null };
    return { status: 'rejected', error: reasons.join(', ') || 'Trendyol tarafından reddedildi' };
  }
  return { status: current.status, error: current.error };
}

/**
 * Listings an earlier sync marked "rejected" only because of the "same barcode already exists" answer
 * are listed after all: set them active and clear the message. Returns how many were fixed.
 */
async function healAlreadyListed(connectionId) {
  const rows = await prisma.marketplaceProduct.findMany({
    where: { connectionId, status: 'rejected', errorMessage: { not: null } },
    select: { id: true, errorMessage: true },
  });
  const ids = rows.filter((r) => isAlreadyListedMessage(r.errorMessage)).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 1000) {
    await prisma.marketplaceProduct.updateMany({
      where: { id: { in: ids.slice(i, i + 1000) } },
      data: { status: 'active', errorMessage: null, lastSyncedAt: new Date() },
    });
  }
  return ids.length;
}

module.exports = { isAlreadyListedMessage, classifyBatchItem, healAlreadyListed };
