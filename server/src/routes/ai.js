const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { auth } = require('../middleware/auth');
const { getSetting, deductCredits } = require('./credits');
const staticCategories = require('../data/trendyolCategories');

const router = express.Router();
router.use(auth);

function flattenLeaves(categories, parentPath = '') {
  const leaves = [];
  for (const cat of categories) {
    const path = parentPath ? `${parentPath} > ${cat.name}` : cat.name;
    if (!cat.subCategories || cat.subCategories.length === 0) {
      leaves.push({ id: cat.id, name: cat.name, path });
    } else {
      leaves.push(...flattenLeaves(cat.subCategories, path));
    }
  }
  return leaves;
}

let cachedData = null;
function getCategoryData() {
  if (!cachedData) {
    const root = staticCategories.categories || staticCategories;
    const topLevel = Array.isArray(root) ? root : [root];
    const allLeaves = flattenLeaves(topLevel);
    const leafById = new Map(allLeaves.map(l => [l.id, l]));
    const byTopLevel = {};
    for (const cat of topLevel) {
      byTopLevel[cat.id] = { id: cat.id, name: cat.name, leaves: flattenLeaves([cat]) };
    }
    cachedData = { topLevel, allLeaves, leafById, byTopLevel };
  }
  return cachedData;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON bulunamadı');
  return JSON.parse(text.slice(start, end + 1));
}

// Step 1: Map XML categories to one of 16 top-level Trendyol categories
async function mapToTopLevel(client, xmlCategories, topLevel) {
  const catList = topLevel.map(c => `${c.id}|${c.name}`).join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: `Sen bir e-ticaret kategori eşleştirme asistanısın. Cevabını SADECE geçerli JSON olarak ver, başka hiçbir şey yazma.`,
    messages: [{
      role: 'user',
      content: `XML kategorilerini aşağıdaki Trendyol ANA kategorilerinden biriyle eşleştir.

XML Kategorileri:
${xmlCategories.map(c => `- ${c}`).join('\n')}

Trendyol Ana Kategorileri (format: id|ad):
${catList}

Kurallar:
- Her XML kategorisi için en uygun ana kategori ID'sini seç (listedeki ID'lerden biri olmalı)
- Hiç uymuyorsa null döndür
- Sadece JSON döndür, açıklama yazma

JSON formatı:
{
  "mappings": {
    "XML Kategori Adı": 1234,
    "Uymayan Kategori": null
  }
}`
    }],
  });

  const text = message.content[0]?.text?.trim() || '';
  if (!text) throw new Error('Step-1 boş yanıt');
  console.log('[AI] Step-1 stop_reason:', message.stop_reason, '| length:', text.length);
  const parsed = extractJson(text);
  const mappings = parsed.mappings || {};
  const matched = Object.values(mappings).filter(Boolean).length;
  console.log(`[AI] Step-1: ${matched}/${Object.keys(mappings).length} ana kategori eşleşti`);
  return mappings;
}

// Step 2: Match XML categories to a specific leaf within a top-level subtree
async function matchInSubtree(client, xmlBatch, leaves) {
  const categoryList = leaves.map(l => `${l.id}|${l.path}`).join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    system: `Sen bir e-ticaret kategori eşleştirme asistanısın. Cevabını SADECE geçerli JSON olarak ver, başka hiçbir şey yazma.`,
    messages: [{
      role: 'user',
      content: `Aşağıdaki XML kategorilerini Trendyol kategorileriyle eşleştir.

XML Kategorileri:
${xmlBatch.map(c => `- ${c}`).join('\n')}

Mevcut Trendyol kategorileri (format: id|tam yol):
${categoryList}

Kurallar:
- Her XML kategorisi için listeden en uygun Trendyol yaprağını seç
- İyi eşleşme yoksa null döndür
- Sadece JSON döndür, açıklama yazma

JSON formatı:
{
  "matches": {
    "XML Kategori Adı": { "id": 1234, "path": "Üst > Alt > Yaprak" },
    "Eşleşmeyen": null
  }
}`
    }],
  });

  const text = message.content[0]?.text?.trim() || '';
  if (!text) throw new Error('Step-2 boş yanıt');
  console.log('[AI] Step-2 stop_reason:', message.stop_reason, '| length:', text.length);

  if (message.stop_reason === 'max_tokens') {
    throw new Error('Yanıt çok uzun, daha az kategori gönderin');
  }

  const parsed = extractJson(text);
  const nonNull = Object.values(parsed.matches || {}).filter(Boolean).length;
  console.log(`[AI] Step-2 batch: ${nonNull}/${Object.keys(parsed.matches || {}).length} eşleşti`);
  return parsed;
}

// POST /api/ai/category-match
router.post('/category-match', async (req, res, next) => {
  try {
    const { xmlCategories } = req.body;
    if (!Array.isArray(xmlCategories) || xmlCategories.length === 0) {
      return res.status(400).json({ error: 'xmlCategories dizisi gerekli' });
    }
    if (xmlCategories.length > 200) {
      return res.status(400).json({ error: 'En fazla 200 kategori gönderilebilir' });
    }

    const apiKey = await getSetting('anthropic_api_key', process.env.ANTHROPIC_API_KEY || '');
    if (!apiKey) return res.status(500).json({ error: 'Anthropic API Key ayarlanmamış. Superadmin → Genel Ayarlar sayfasından ekleyin.' });

    const costPerCat = parseFloat(await getSetting('credit_category_ai', '0.5'));
    const totalCost = parseFloat((costPerCat * xmlCategories.length).toFixed(2));
    if (totalCost > 0) {
      try {
        await deductCredits(
          req.user.id,
          totalCost,
          'category_ai',
          `AI Kategori Eşleştirme: ${xmlCategories.length} kategori × ${costPerCat} kredi`
        );
      } catch (creditErr) {
        return res.status(402).json({ error: creditErr.message });
      }
    }

    const { topLevel, leafById, byTopLevel } = getCategoryData();
    console.log(`[AI] XML kategoriler: ${xmlCategories.length}, top-level: ${topLevel.length}`);

    const client = new Anthropic({ apiKey });

    // Step 1: Map all XML categories to a top-level Trendyol category
    const STEP1_BATCH = 60; // 60 cats per step-1 call (output is small)
    const topLevelMappings = {};

    for (let i = 0; i < xmlCategories.length; i += STEP1_BATCH) {
      const batch = xmlCategories.slice(i, i + STEP1_BATCH);
      try {
        const result = await mapToTopLevel(client, batch, topLevel);
        Object.assign(topLevelMappings, result);
      } catch (err) {
        console.error('[AI] Step-1 batch hatası:', err.message);
        for (const cat of batch) topLevelMappings[cat] = null;
      }
    }

    // Group XML categories by their top-level match
    const groupedByTopLevel = {};
    const unmatchedTop = [];

    for (const xmlCat of xmlCategories) {
      const topId = Number(topLevelMappings[xmlCat]);
      if (!topId || !byTopLevel[topId]) {
        unmatchedTop.push(xmlCat);
      } else {
        if (!groupedByTopLevel[topId]) groupedByTopLevel[topId] = [];
        groupedByTopLevel[topId].push(xmlCat);
      }
    }

    console.log(`[AI] Gruplar: ${Object.keys(groupedByTopLevel).length} ana kategori, ${unmatchedTop.length} eşleşmedi`);

    // Step 2: For each group, find the specific leaf within that subtree
    const STEP2_BATCH = 30;
    const allMatches = {};

    for (const cat of unmatchedTop) allMatches[cat] = null;

    for (const [topId, xmlCats] of Object.entries(groupedByTopLevel)) {
      const subtreeLeaves = byTopLevel[Number(topId)]?.leaves || [];
      console.log(`[AI] Step-2: "${byTopLevel[Number(topId)]?.name}" → ${xmlCats.length} XML kat, ${subtreeLeaves.length} yaprak`);

      for (let i = 0; i < xmlCats.length; i += STEP2_BATCH) {
        const batch = xmlCats.slice(i, i + STEP2_BATCH);
        try {
          const result = await matchInSubtree(client, batch, subtreeLeaves);
          Object.assign(allMatches, result.matches || {});
        } catch (err) {
          console.error(`[AI] Step-2 batch hatası (topId=${topId}):`, err.message);
          for (const cat of batch) allMatches[cat] = null;
        }
      }
    }

    // Validate IDs against leafById
    const enriched = {};
    for (const [cat, match] of Object.entries(allMatches)) {
      if (!match) { enriched[cat] = null; continue; }
      const leaf = leafById.get(Number(match.id)) || leafById.get(match.id);
      enriched[cat] = leaf ? { id: leaf.id, name: leaf.name, path: leaf.path } : null;
    }

    const matchedCount = Object.values(enriched).filter(Boolean).length;
    console.log(`[AI] Final: ${matchedCount}/${Object.keys(enriched).length} eşleşti`);

    res.json({ matches: enriched });
  } catch (error) {
    console.error('[AI Category Match Error]', error.message);
    next(error);
  }
});

module.exports = router;
