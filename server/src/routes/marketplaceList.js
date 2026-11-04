const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { ownedParam } = require('../middleware/ownership');
const { buildReadinessContext } = require('../services/readiness');

const router = express.Router();
router.use(auth);
router.param('id', ownedParam('marketplaceConnection'));

/**
 * GET /api/marketplace/connections/:id/product-list
 *
 * Server-side listing for the "send to marketplace" page. Filtering, readiness
 * (validator), sale price (pricing engine) and paging all happen here so the
 * browser only renders one page.
 *
 * query: page, limit(<=100), search, xmlSourceId, categories (comma list),
 *        readiness = all|ready|blocked, issue = <issue code>,
 *        mpStatus = all|not_sent|pending|active|rejected|passive
 */

// Short-lived cache of evaluated rows so paging/filtering by status does not re-evaluate the catalogue.
const CACHE_TTL_MS = 20 * 1000;
const { cache, version } = require('../services/productListCache');

function categoryClauses(list) {
  const clauses = [];
  for (const raw of list) {
    // "Kadın|Bayan Bileklik|" must also find products stored as just "Bayan Bileklik"
    const variants = new Set([raw]);
    const leaf = raw.split('|').map((x) => x.trim()).filter(Boolean).pop();
    if (leaf) variants.add(leaf);
    for (const c of variants) {
      clauses.push(
        { category: { equals: c, mode: 'insensitive' } },
        { category: { contains: `|${c}|`, mode: 'insensitive' } },
        { category: { startsWith: `${c}|`, mode: 'insensitive' } },
        { category: { endsWith: `|${c}`, mode: 'insensitive' } },
      );
    }
  }
  return clauses;
}

router.get('/connections/:id/product-list', async (req, res, next) => {
  try {
    const connection = await prisma.marketplaceConnection.findUnique({ where: { id: req.params.id } });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { search = '', xmlSourceId = '', categories = '', readiness = 'all', issue = '', mpStatus = 'all' } = req.query;
    const fresh = req.query.fresh === '1';

    const key = [connection.id, version(connection.storeId), search, xmlSourceId, categories].join('|');
    let entry = cache.get(key);
    if (fresh || !entry || Date.now() - entry.at > CACHE_TTL_MS) {
      const and = [{ storeId: connection.storeId }];
      if (search) and.push({ OR: [{ title: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }, { barcode: { contains: search, mode: 'insensitive' } }] });
      if (xmlSourceId) and.push({ xmlSourceId });
      const catList = String(categories).split(',').map((c) => c.trim()).filter(Boolean);
      if (catList.length) and.push({ OR: categoryClauses(catList) });

      // Evaluate in batches: memory is bounded by the batch size, not by the catalogue size
      const ctx = await buildReadinessContext(connection);
      const rows = [];
      const BATCH = 1500;
      let cursor = null;
      for (;;) {
        const batch = await prisma.product.findMany({
          where: { AND: and },
          select: {
            id: true, sku: true, barcode: true, title: true, description: true, images: true, category: true, brand: true,
            xmlSourceId: true, xmlPrice: true, price: true, stock: true, vatRate: true, updatedAt: true, createdAt: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;
        for (const p of batch) {
          const ev = ctx.evaluate(p);
          const mp = ctx.mpByProduct.get(p.id) || null;
          rows.push({ id: p.id, t: new Date(p.createdAt).getTime(), ready: ev.ready, issues: ev.issues, salePrice: ev.salePrice, priceRule: ev.priceRule, mpStatus: mp ? mp.status : null });
        }
        cursor = batch[batch.length - 1].id;
        if (batch.length < BATCH) break;
      }
      rows.sort((x, y) => (y.t - x.t) || (x.id < y.id ? -1 : 1)); // newest first
      entry = { at: Date.now(), rows };
      if (cache.size > 30) cache.clear();
      cache.set(key, entry);
    }

    const rows = entry.rows;

    // Stats over the search/source/category scope (before readiness & marketplace-status filters)
    const stats = { total: rows.length, ready: 0, blocked: 0, byIssue: {}, mp: { not_sent: 0, pending: 0, active: 0, rejected: 0, passive: 0 } };
    for (const r of rows) {
      if (r.ready) stats.ready++; else stats.blocked++;
      for (const i of r.issues) stats.byIssue[i.code] = (stats.byIssue[i.code] || 0) + 1;
      const k = r.mpStatus || 'not_sent';
      stats.mp[k] = (stats.mp[k] || 0) + 1;
    }

    let filtered = rows;
    if (readiness === 'ready') filtered = filtered.filter((r) => r.ready);
    else if (readiness === 'blocked') filtered = filtered.filter((r) => !r.ready);
    if (issue) filtered = filtered.filter((r) => r.issues.some((i) => i.code === issue));
    if (mpStatus === 'not_sent') filtered = filtered.filter((r) => !r.mpStatus);
    else if (mpStatus !== 'all') filtered = filtered.filter((r) => r.mpStatus === mpStatus);

    const total = filtered.length;
    const slice = filtered.slice((page - 1) * limit, page * limit);
    const byId = Object.fromEntries(slice.map((r) => [r.id, r]));

    const full = slice.length ? await prisma.product.findMany({
      where: { id: { in: slice.map((r) => r.id) } },
      select: {
        id: true, sku: true, barcode: true, title: true, images: true, category: true, brand: true, xmlSourceId: true,
        xmlPrice: true, price: true, stock: true, vatRate: true,
        marketplaceProducts: { where: { connectionId: connection.id }, select: { id: true, connectionId: true, status: true, errorMessage: true, marketplacePrice: true, marketplaceStock: true, lastSyncedAt: true } },
        xmlSource: { select: { name: true } },
      },
    }) : [];
    const order = new Map(slice.map((r, i) => [r.id, i]));
    full.sort((a, b) => order.get(a.id) - order.get(b.id));

    res.json({
      products: full.map((p) => ({
        ...p,
        salePrice: byId[p.id].salePrice,
        priceRule: byId[p.id].priceRule,
        ready: byId[p.id].ready,
        issues: byId[p.id].issues,
      })),
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
      stats,
    });
  } catch (error) { next(error); }
});

module.exports = router;
