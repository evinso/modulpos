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

/** The most specific reason the marketplace gives for a rejected product (the field it uses varies). null when it gives none. */
function rejectReasonOf(tp) {
  const parts = [];
  const add = (v) => { if (v === null || v === undefined) return; const t = String(v).trim(); if (t && !parts.includes(t)) parts.push(t); };
  if (!tp) return null;
  add(tp.rejectReason);
  const details = tp.rejectReasonDetails || tp.rejectReasons;
  if (Array.isArray(details)) for (const d of details) add(typeof d === 'string' ? d : (d && (d.reason || d.reasonDescription || d.description || d.message)));
  return parts.join('; ') || null;
}

/**
 * What the marketplace says about a barcode we show as removed (passive).
 *   sells it                                   -> { state: 'active' }
 *   waiting for review (revised and resubmitted) -> { state: 'pending' }
 *   still flagged                              -> { state: 'rejected', reason }
 *   not found in either list                   -> null
 * `onSaleItems` = approved & on sale matches, `unapprovedItems` = not approved yet matches (both for this barcode).
 */
function classifyRemoved(code, onSaleItems, unapprovedItems) {
  const same = (tp) => !!tp && (tp.barcode === code || tp.stockCode === code);
  if ((onSaleItems || []).some(same)) return { state: 'active' };
  const tp = (unapprovedItems || []).find(same);
  if (!tp) return null;
  const reason = rejectReasonOf(tp);
  if (tp.rejected === true || reason) return { state: 'rejected', reason };
  return { state: 'pending' };
}

/**
 * Looks the removed listings up again, e.g. after the seller revised them in the marketplace panel.
 * `lookup(code)` asks the marketplace (see classifyRemoved); `apply(row, result)` records what it said.
 * At most `max` per run, and the first failed lookup stops the run (the marketplace may be unavailable),
 * leaving everything as it was. Returns how many became active / pending / got an updated reason.
 */
async function reviveRemoved(rows, lookup, apply, max = 30) {
  const done = { active: 0, pending: 0, reason: 0 };
  for (const mp of rows.slice(0, max)) {
    const code = mp.product && (mp.product.barcode || mp.product.sku);
    if (!code) continue;
    let result;
    try { result = await lookup(code); } catch { break; }
    if (!result) continue;
    await apply(mp, result);
    if (result.state === 'active') done.active++;
    else if (result.state === 'pending') done.pending++;
    else done.reason++;
  }
  return done;
}

module.exports = { isAlreadyListedMessage, classifyBatchItem, healAlreadyListed, rejectReasonOf, classifyRemoved, reviveRemoved };
