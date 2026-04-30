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
    const { status, page = 1, limit = 20 } = req.query;
    const where = { storeId: store.id };
    if (status) where.status = status;
    const [questions, total] = await Promise.all([
      prisma.customerQuestion.findMany({ where, orderBy: { askedAt: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit) }),
      prisma.customerQuestion.count({ where })
    ]);
    res.json({ questions, pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.post('/:id/answer', async (req, res, next) => {
  try {
    const { answerText } = req.body;
    if (!answerText) return res.status(400).json({ error: 'Yanıt metni zorunludur' });
    const question = await prisma.customerQuestion.update({
      where: { id: req.params.id },
      data: { answerText, status: 'answered', answeredAt: new Date() }
    });
    res.json(question);
  } catch (error) { next(error); }
});

module.exports = router;
