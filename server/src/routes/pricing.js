const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

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
    const rule = await prisma.pricingRule.create({
      data: { storeId: store.id, name, type, value, applyTo, applyValue, conditions: conditions ? JSON.stringify(conditions) : null, priority: priority || 0 }
    });
    res.status(201).json(rule);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
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
    await prisma.pricingRule.delete({ where: { id: req.params.id } });
    res.json({ message: 'Fiyatlandırma kuralı silindi' });
  } catch (error) { next(error); }
});

module.exports = router;
