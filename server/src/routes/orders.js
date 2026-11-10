const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { syncOrdersForStore } = require('../services/orderSyncService');
const { ownedParam, userStoreIds } = require('../middleware/ownership');
const { publicConnection } = require('../utils/sanitize');
const { computeOrderProfit, summarize, parseLines } = require('../services/orderProfit');
const orderCosts = require('../services/orderCosts');
const { syncStoreFinance } = require('../services/orderFinanceSync');

const router = express.Router();
router.use(auth);
router.param('id', ownedParam('order'));

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

router.get('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { page = 1, limit = 20, status } = req.query;
    const where = { storeId: store.id };
    if (status) where.status = status;
    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { orderDate: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit), include: { connection: { select: { marketplaceType: true } } } }),
      prisma.order.count({ where })
    ]);
    res.json({ orders, pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// ── Profit panel (Trendyol sales: price, discount, what the customer paid, commission, fees, shipping, our cost, profit) ──

const DEFAULT_SERVICE_FEE = 13.19;   // Trendyol's "Platform Hizmet Bedeli" per shipment, as invoiced to this store (KDV dahil)
const settingsKey = (storeId) => `order_profit:${storeId}`;

async function loadProfitSettings(storeId) {
  const row = await prisma.systemSettings.findUnique({ where: { key: settingsKey(storeId) } });
  const saved = row ? orderCosts.parseJson(row.value, {}) : {};
  // average shipping of the orders whose real shipping is known: the estimate for the others
  const agg = await prisma.orderFinance.aggregate({ where: { order: { storeId }, cargoAmount: { not: null } }, _avg: { cargoAmount: true }, _count: { cargoAmount: true } });
  const cargoAverage = agg._count.cargoAmount > 0 ? Math.round(agg._avg.cargoAmount * 100) / 100 : null;
  const serviceFee = Number.isFinite(Number(saved.serviceFee)) && saved.serviceFee !== null ? Number(saved.serviceFee) : DEFAULT_SERVICE_FEE;
  const cargoSaved = saved.cargoEstimate !== null && saved.cargoEstimate !== undefined && Number.isFinite(Number(saved.cargoEstimate)) ? Number(saved.cargoEstimate) : null;
  return { serviceFee, cargoEstimate: cargoSaved !== null ? cargoSaved : cargoAverage, cargoEstimateSaved: cargoSaved, cargoAverage, serviceFeeDefault: DEFAULT_SERVICE_FEE };
}

function dayStart(s) { const d = new Date(`${s}T00:00:00+03:00`); return Number.isNaN(d.getTime()) ? null : d; }

router.get('/profit', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const { status = 'all', q = '', from = '', to = '' } = req.query;

    const where = { storeId: store.id, connection: { is: { marketplaceType: 'trendyol' } } };
    if (status !== 'all') where.status = status;
    if (q) where.OR = [{ orderNumber: { contains: String(q), mode: 'insensitive' } }, { marketplaceOrderId: { contains: String(q), mode: 'insensitive' } }, { customerName: { contains: String(q), mode: 'insensitive' } }];
    const fromD = from ? dayStart(from) : null; const toD = to ? dayStart(to) : null;
    if (fromD || toD) where.orderDate = { ...(fromD ? { gte: fromD } : {}), ...(toD ? { lt: new Date(toD.getTime() + 86400000) } : {}) };

    const orders = await prisma.order.findMany({ where, orderBy: { orderDate: 'desc' }, take: 3000, include: { finance: true } });
    const settings = await loadProfitSettings(store.id);
    const manual = await orderCosts.loadManual(prisma, store.id);

    // product costs / supplier fees for the orders that have no saved snapshot yet (and save the cost snapshot: later XML price
    // changes must not rewrite history). A fee snapshot is only made when the order arrives; orders without one use the source's current fee.
    const feeBySource = await orderCosts.loadFeeBySource(prisma, store.id);
    const need = orders.filter((o) => !o.lineCosts || !o.lineFees);
    const products = need.length ? await orderCosts.loadProducts(prisma, store.id, need.flatMap((o) => parseLines(o.items).flatMap(orderCosts.lineKeys))) : new Map();
    const snapshots = new Map();
    for (const o of need) {
      if (o.lineCosts) continue;
      const snap = orderCosts.snapshotFor(parseLines(o.items), products);
      if (snap) snapshots.set(o.id, snap);
    }
    // saved in the background, one by one (the page does not wait for it)
    (async () => { for (const [id, snap] of [...snapshots].slice(0, 300)) { try { await prisma.order.update({ where: { id }, data: { lineCosts: JSON.stringify(snap) } }); } catch { /* next time */ } } })();

    const results = orders.map((o) => {
      const lines = parseLines(o.items);
      // only a snapshot that was really saved when the order arrived counts as "cost at the time"; one made just now is the product's current cost
      const snap = o.lineCosts ? orderCosts.parseJson(o.lineCosts, null) : null;
      const costs = orderCosts.costMapFor(lines, { manual, snapshot: snap, products });
      const feeSnap = o.lineFees ? orderCosts.parseJson(o.lineFees, {}) : null;
      const fees = orderCosts.feeMapFor(lines, { snapshot: feeSnap, products, feeBySource });
      const r = computeOrderProfit(o, { finance: o.finance, costs, fees, settings });
      return { id: o.id, orderNumber: o.orderNumber, marketplaceOrderId: o.marketplaceOrderId, orderDate: o.orderDate, status: o.status, ...r };
    });

    res.json({
      rows: results.slice((page - 1) * limit, page * limit),
      summary: summarize(results),
      settings,
      pagination: { total: results.length, page, limit, totalPages: Math.max(1, Math.ceil(results.length / limit)) },
    });
  } catch (error) { next(error); }
});

// Reads the real commission and shipping from Trendyol for orders that are not settled in our records yet
router.post('/profit/refresh', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const r = await syncStoreFinance(store.id);
    const parts = [];
    if (r.pending === 0) parts.push('Kesinleşmesi beklenen sipariş yok');
    else parts.push(`${r.pending} siparişten ${r.matchedCommission} komisyon, ${r.matchedCargo} kargo bilgisi Trendyol'dan alındı`);
    if (r.errors.length) parts.push(`${r.errors.length} sorgu başarısız oldu`);
    res.json({ message: parts.join('. '), ...r, preview: undefined });
  } catch (error) { next(error); }
});

router.put('/profit/settings', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const read = (v) => (v === null || v === '' || v === undefined ? null : Number(v));
    const serviceFee = read(req.body.serviceFee); const cargoEstimate = read(req.body.cargoEstimate);
    for (const v of [serviceFee, cargoEstimate]) if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100000)) return res.status(400).json({ error: 'Tutarlar 0 veya daha büyük bir sayı olmalı' });
    const value = JSON.stringify({ serviceFee, cargoEstimate });
    await prisma.systemSettings.upsert({ where: { key: settingsKey(store.id) }, create: { key: settingsKey(store.id), value }, update: { value } });
    res.json({ ok: true, settings: await loadProfitSettings(store.id) });
  } catch (error) { next(error); }
});

// Purchase cost of one barcode, typed in by hand (null / empty removes it)
router.put('/profit/cost', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const barcode = typeof req.body.barcode === 'string' ? req.body.barcode.trim() : '';
    if (!barcode || barcode.length > 200) return res.status(400).json({ error: 'Barkod gerekli' });
    const raw = req.body.unitCost;
    const unitCost = raw === null || raw === '' || raw === undefined ? null : Number(raw);
    if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost <= 0 || unitCost > 10000000)) return res.status(400).json({ error: 'Maliyet 0\'dan büyük bir tutar olmalı' });
    await orderCosts.saveManual(prisma, store.id, barcode, unitCost);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { connection: true } });
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    res.json({ ...order, connection: publicConnection(order.connection) });
  } catch (error) { next(error); }
});

// Sync orders from marketplace
router.post('/sync', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const connections = await prisma.marketplaceConnection.findMany({ where: { storeId: store.id, status: 'active' } });
    const totalSynced = await syncOrdersForStore(store, connections);
    res.json({ message: `${totalSynced} yeni sipariş senkronize edildi` });
  } catch (error) { next(error); }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const order = await prisma.order.update({ where: { id: req.params.id }, data: { status } });
    res.json(order);
  } catch (error) { next(error); }
});

module.exports = router;
