const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { explainTemplatePrice, matchesConds } = require('../services/pricingEngine');

const router = express.Router();
router.use(auth);

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

// A rule may only reference the caller's own connection / XML source.
async function assertConditionsOwned(storeId, conditions) {
  const c = conditions || {};
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
    const out = explainTemplatePrice(purchasePrice, value, conditions || {});
    if (!out) return res.status(400).json({ error: 'Bu değerlerle geçerli bir fiyat hesaplanamıyor (komisyon + kâr çok yüksek olabilir)' });
    res.json(out);
  } catch (error) { next(error); }
});

// How many of my products would this rule's scope + purchase-price range cover?
router.post('/coverage', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conds = req.body.conditions || {};
    await assertConditionsOwned(store.id, conds);
    const products = await prisma.product.findMany({
      where: { storeId: store.id },
      select: { xmlSourceId: true, category: true, brand: true, xmlPrice: true, price: true },
    });
    const rule = { applyTo: 'price_template' };
    const covered = products.filter((p) => matchesConds(rule, conds, p, conds.connectionId || null)).length;
    res.json({ total: products.length, covered });
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
    res.json({ message: 'Fiyatlandırma kuralı silindi' });
  } catch (error) { next(error); }
});

module.exports = router;
