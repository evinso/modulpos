const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const productListCache = require('../services/productListCache');
const { explainTemplatePrice, summarizeCoverage, validateTiers } = require('../services/pricingEngine');

const router = express.Router();
router.use(auth);

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

// A rule may only reference the caller's own connection / XML source.
function assertTiers(c) {
  for (const [key, valueKey, label] of [['shippingTiers', 'cost', 'Kargo kademeleri'], ['profitTiers', 'value', 'Kâr kademeleri']]) {
    const { error } = validateTiers(c[key], valueKey);
    if (error) { const e = new Error(`${label}: ${error}`); e.status = 400; throw e; }
  }
}

async function assertConditionsOwned(storeId, conditions) {
  const c = conditions || {};
  assertTiers(c);
  if (c.connectionId) {
    const ok = await prisma.marketplaceConnection.findFirst({ where: { id: c.connectionId, storeId }, select: { id: true } });
    if (!ok) { const e = new Error('Geçersiz pazaryeri bağlantısı'); e.status = 400; throw e; }
  }
  if (c.xmlSourceId) {
    const ok = await prisma.xmlSource.findFirst({ where: { id: c.xmlSourceId, storeId }, select: { id: true } });
    if (!ok) { const e = new Error('Geçersiz XML kaynağı'); e.status = 400; throw e; }
  }
}

// Calculator preview (same engine that prices real products)
router.post('/calculate', async (req, res, next) => {
  try {
    const { purchasePrice, value, conditions } = req.body;
    assertTiers(conditions || {});
    const out = explainTemplatePrice(purchasePrice, value, conditions || {});
    if (!out) return res.status(400).json({ error: 'Bu değerlerle geçerli bir fiyat hesaplanamıyor (komisyon + kâr çok yüksek olabilir)' });
    res.json(out);
  } catch (error) { next(error); }
});

// Over my real products: how many does this template apply to, and what would I earn in total / per product?
router.post('/coverage', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conds = req.body.conditions || {};
    await assertConditionsOwned(store.id, conds);
    const products = await prisma.product.findMany({
      where: { storeId: store.id },
      select: { id: true, title: true, xmlSourceId: true, category: true, brand: true, xmlPrice: true, price: true, vatRate: true },
    });
    res.json({ total: products.length, ...summarizeCoverage(products, req.body.value, conds) });
  } catch (error) { next(error); }
});

// One line per template for the list: how many products it applies to and what it earns in total.
router.get('/summaries', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const [rules, products] = await Promise.all([
      prisma.pricingRule.findMany({ where: { storeId: store.id, applyTo: 'price_template' } }),
      prisma.product.findMany({ where: { storeId: store.id }, select: { xmlSourceId: true, category: true, brand: true, xmlPrice: true, price: true, vatRate: true } }),
    ]);
    const out = {};
    for (const r of rules) {
      let conds = {}; try { conds = r.conditions ? JSON.parse(r.conditions) : {}; } catch { /* ignore */ }
      const s = summarizeCoverage(products, r.value, conds);
      out[r.id] = { covered: s.covered, priced: s.priced, losing: s.losing, totalProfit: s.totalProfit, marginOnPricePct: s.marginOnPricePct };
    }
    res.json({ total: products.length, rules: out });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const rules = await prisma.pricingRule.findMany({ where: { storeId: store.id }, orderBy: { priority: 'asc' } });
    res.json(rules);
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { name, type, value, applyTo, applyValue, conditions, priority } = req.body;
    await assertConditionsOwned(store.id, conditions);
    const rule = await prisma.pricingRule.create({
      data: { storeId: store.id, name, type, value, applyTo, applyValue, conditions: conditions ? JSON.stringify(conditions) : null, priority: priority || 0 }
    });
    productListCache.invalidate(store.id);
    res.status(201).json(rule);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const owned = await prisma.pricingRule.findFirst({ where: { id: req.params.id, storeId: store.id }, select: { id: true } });
    if (!owned) return res.status(404).json({ error: 'Kural bulunamadı' });
    if (req.body.conditions !== undefined) await assertConditionsOwned(store.id, req.body.conditions);
    const { name, type, value, applyTo, applyValue, conditions, priority, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (value !== undefined) data.value = value;
    if (applyTo !== undefined) data.applyTo = applyTo;
    if (applyValue !== undefined) data.applyValue = applyValue;
    if (conditions !== undefined) data.conditions = JSON.stringify(conditions);
    if (priority !== undefined) data.priority = priority;
    if (isActive !== undefined) data.isActive = isActive;
    const rule = await prisma.pricingRule.update({ where: { id: req.params.id }, data });
    productListCache.invalidate(store.id);
    res.json(rule);
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const owned = await prisma.pricingRule.findFirst({ where: { id: req.params.id, storeId: store.id }, select: { id: true } });
    if (!owned) return res.status(404).json({ error: 'Kural bulunamadı' });
    await prisma.pricingRule.delete({ where: { id: req.params.id } });
    productListCache.invalidate(store.id);
    res.json({ message: 'Fiyatlandırma kuralı silindi' });
  } catch (error) { next(error); }
});

module.exports = router;
