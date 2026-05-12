const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const TrendyolService = require('../services/trendyol/trendyolService');

const router = express.Router();
router.use(auth);

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

async function getAiApiKey() {
  const s = await prisma.systemSettings.findUnique({ where: { key: 'anthropic_api_key' } });
  return s?.value || null;
}

// Match question text against a rule's keywords (OR logic, case-insensitive)
function matchesRule(questionText, keywordsJson) {
  try {
    const keywords = JSON.parse(keywordsJson);
    const lower = questionText.toLowerCase();
    return keywords.some(k => k && lower.includes(k.toLowerCase()));
  } catch { return false; }
}

// Core auto-answer processor for a single question
async function processAutoAnswer(question, rules, service, apiKey) {
  const matchedRule = rules.find(r => matchesRule(question.questionText, r.keywords));

  if (matchedRule) {
    try {
      await service.answerQuestion(question.marketplaceQuestionId, matchedRule.replyTemplate);
      await prisma.customerQuestion.update({
        where: { id: question.id },
        data: { answerText: matchedRule.replyTemplate, status: 'answered', answeredAt: new Date(), autoAnswered: true }
      });
      await prisma.autoReplyRule.update({
        where: { id: matchedRule.id },
        data: { matchCount: { increment: 1 } }
      });
      return 'rule';
    } catch (err) {
      console.error(`[AutoReply] Kural yanıtı gönderilemedi (${question.id}):`, err.message);
    }
  }

  // No rule matched — try AI if key configured
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const prompt = `Bir Türkçe e-ticaret mağazasının müşteri hizmetleri asistanısın. Müşteri aşağıdaki soruyu sordu${question.productTitle ? ` ("${question.productTitle}" ürünü hakkında)` : ''}. 50-400 karakter arasında, nazik, net ve Türkçe bir yanıt yaz. Sadece yanıt metnini yaz, başka hiçbir şey ekleme.\n\nSoru: ${question.questionText}`;
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      });
      const aiText = msg.content?.[0]?.text?.trim();
      if (aiText && aiText.length >= 10) {
        await service.answerQuestion(question.marketplaceQuestionId, aiText);
        await prisma.customerQuestion.update({
          where: { id: question.id },
          data: { answerText: aiText, status: 'answered', answeredAt: new Date(), autoAnswered: true }
        });
        return 'ai';
      }
    } catch (err) {
      console.error(`[AutoReply] AI yanıtı gönderilemedi (${question.id}):`, err.message);
    }
  }

  return 'pending';
}

// ─── QUESTION LIST ────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { status, page = 1, limit = 20 } = req.query;
    const where = { storeId: store.id };
    if (status) where.status = status;
    const [questions, total] = await Promise.all([
      prisma.customerQuestion.findMany({ where, orderBy: { askedAt: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit), include: { connection: { select: { supplierName: true, sellerId: true } } } }),
      prisma.customerQuestion.count({ where })
    ]);
    res.json({ questions, pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

// ─── SYNC FROM TRENDYOL ───────────────────────────────────────────────────────
router.post('/sync', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });

    const connections = await prisma.marketplaceConnection.findMany({
      where: { storeId: store.id, marketplaceType: 'trendyol', status: 'active' }
    });

    const rules = await prisma.autoReplyRule.findMany({
      where: { storeId: store.id, isActive: true },
      orderBy: { priority: 'desc' }
    });

    const apiKey = await getAiApiKey();
    let synced = 0, autoAnswered = 0;

    for (const conn of connections) {
      const service = new TrendyolService(conn);
      try {
        const data = await service.getQuestions({ status: 'WAITING_FOR_ANSWER', size: 50 });
        const items = data?.content || [];

        for (const q of items) {
          const existing = await prisma.customerQuestion.findFirst({
            where: { marketplaceQuestionId: String(q.id), connectionId: conn.id }
          });
          if (existing) continue;

          const saved = await prisma.customerQuestion.create({
            data: {
              storeId: store.id,
              connectionId: conn.id,
              marketplaceQuestionId: String(q.id),
              productTitle: q.productName || q.productTitle || null,
              questionText: q.text || q.questionText || '',
              status: 'pending',
              askedAt: q.createdDate ? new Date(q.createdDate) : new Date(),
            }
          });
          synced++;

          const result = await processAutoAnswer(saved, rules, service, apiKey);
          if (result !== 'pending') autoAnswered++;
        }
      } catch (err) {
        console.error(`[Questions] Sync hatası (${conn.id}):`, err.message);
      }
    }

    res.json({ synced, autoAnswered, pending: synced - autoAnswered });
  } catch (error) { next(error); }
});

// ─── MANUAL ANSWER ────────────────────────────────────────────────────────────
router.post('/:id/answer', async (req, res, next) => {
  try {
    const { answerText } = req.body;
    if (!answerText || answerText.length < 10) return res.status(400).json({ error: 'Yanıt en az 10 karakter olmalıdır' });

    const question = await prisma.customerQuestion.findUnique({
      where: { id: req.params.id },
      include: { connection: true }
    });
    if (!question) return res.status(404).json({ error: 'Soru bulunamadı' });

    if (question.connection && question.marketplaceQuestionId) {
      const service = new TrendyolService(question.connection);
      await service.answerQuestion(question.marketplaceQuestionId, answerText);
    }

    const updated = await prisma.customerQuestion.update({
      where: { id: req.params.id },
      data: { answerText, status: 'answered', answeredAt: new Date(), autoAnswered: false }
    });
    res.json(updated);
  } catch (error) { next(error); }
});

// ─── AUTO-REPLY RULES CRUD ────────────────────────────────────────────────────
router.get('/rules', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const rules = await prisma.autoReplyRule.findMany({ where: { storeId: store.id }, orderBy: { priority: 'desc' } });
    res.json(rules);
  } catch (error) { next(error); }
});

router.post('/rules', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { name, keywords, replyTemplate, priority = 0 } = req.body;
    if (!name || !keywords?.length || !replyTemplate) return res.status(400).json({ error: 'Ad, anahtar kelimeler ve yanıt şablonu zorunludur' });
    if (replyTemplate.length < 10 || replyTemplate.length > 2000) return res.status(400).json({ error: 'Yanıt şablonu 10-2000 karakter olmalıdır' });
    const rule = await prisma.autoReplyRule.create({
      data: { storeId: store.id, name, keywords: JSON.stringify(keywords), replyTemplate, priority: parseInt(priority) }
    });
    res.status(201).json(rule);
  } catch (error) { next(error); }
});

router.put('/rules/:id', async (req, res, next) => {
  try {
    const { name, keywords, replyTemplate, isActive, priority } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (keywords !== undefined) data.keywords = JSON.stringify(keywords);
    if (replyTemplate !== undefined) {
      if (replyTemplate.length < 10 || replyTemplate.length > 2000) return res.status(400).json({ error: 'Yanıt şablonu 10-2000 karakter olmalıdır' });
      data.replyTemplate = replyTemplate;
    }
    if (isActive !== undefined) data.isActive = isActive;
    if (priority !== undefined) data.priority = parseInt(priority);
    const rule = await prisma.autoReplyRule.update({ where: { id: req.params.id }, data });
    res.json(rule);
  } catch (error) { next(error); }
});

router.delete('/rules/:id', async (req, res, next) => {
  try {
    await prisma.autoReplyRule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) { next(error); }
});

// ─── AI SETTINGS ──────────────────────────────────────────────────────────────
router.get('/ai-settings', async (req, res, next) => {
  try {
    const key = await getAiApiKey();
    res.json({ configured: !!key, keyPreview: key ? `sk-...${key.slice(-6)}` : null });
  } catch (error) { next(error); }
});

router.put('/ai-settings', async (req, res, next) => {
  try {
    const { apiKey } = req.body;
    if (apiKey) {
      await prisma.systemSettings.upsert({
        where: { key: 'anthropic_api_key' },
        update: { value: apiKey },
        create: { key: 'anthropic_api_key', value: apiKey }
      });
    } else {
      await prisma.systemSettings.deleteMany({ where: { key: 'anthropic_api_key' } });
    }
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
module.exports.processAutoAnswerForCron = async (storeId) => {
  const connections = await prisma.marketplaceConnection.findMany({
    where: { storeId, marketplaceType: 'trendyol', status: 'active' }
  });
  const rules = await prisma.autoReplyRule.findMany({
    where: { storeId, isActive: true },
    orderBy: { priority: 'desc' }
  });
  const apiKey = await getAiApiKey();
  let synced = 0, autoAnswered = 0;

  for (const conn of connections) {
    const service = new TrendyolService(conn);
    try {
      const data = await service.getQuestions({ status: 'WAITING_FOR_ANSWER', size: 50 });
      const items = data?.content || [];
      for (const q of items) {
        const existing = await prisma.customerQuestion.findFirst({
          where: { marketplaceQuestionId: String(q.id), connectionId: conn.id }
        });
        if (existing) continue;
        const saved = await prisma.customerQuestion.create({
          data: {
            storeId,
            connectionId: conn.id,
            marketplaceQuestionId: String(q.id),
            productTitle: q.productName || q.productTitle || null,
            questionText: q.text || q.questionText || '',
            status: 'pending',
            askedAt: q.createdDate ? new Date(q.createdDate) : new Date(),
          }
        });
        synced++;
        const result = await processAutoAnswer(saved, rules, service, apiKey);
        if (result !== 'pending') autoAnswered++;
      }
    } catch (err) {
      console.error(`[Cron/Questions] Sync hatası (${conn.id}):`, err.message);
    }
  }
  return { synced, autoAnswered };
};
