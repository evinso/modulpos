const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { auth } = require('../middleware/auth');
const { getSetting } = require('./credits');
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

let cachedLeaves = null;
function getLeaves() {
  if (!cachedLeaves) {
    const root = staticCategories.categories || staticCategories;
    cachedLeaves = flattenLeaves(Array.isArray(root) ? root : [root]);
  }
  return cachedLeaves;
}

// Her XML kategorisi için anahtar kelime eşleşmesine göre en alakalı Trendyol adaylarını bul
function findCandidates(xmlCategories, leaves) {
  // Tüm XML kategorilerinden benzersiz kelimeleri çıkar
  const allWords = new Set();
  for (const cat of xmlCategories) {
    cat.toLowerCase()
      .split(/[\s>\/,&\-_\(\)]+/)
      .filter(w => w.length > 2)
      .forEach(w => allWords.add(w));
  }

  if (allWords.size === 0) return leaves.slice(0, 200);

  // Her Trendyol yaprağını puanla
  const scored = [];
  for (const leaf of leaves) {
    const lpath = leaf.path.toLowerCase();
    let score = 0;
    for (const word of allWords) {
      if (lpath.includes(word)) score++;
    }
    if (score > 0) scored.push({ leaf, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // En fazla 250 aday — yeterliyse bunları kullan, yoksa genel listeden tamamla
  const candidates = scored.slice(0, 250).map(x => x.leaf);
  if (candidates.length < 30) {
    // Hiç eşleşme yoksa ilk 200 kategoriyi fallback olarak kullan
    const existing = new Set(candidates.map(c => c.id));
    for (const leaf of leaves) {
      if (!existing.has(leaf.id)) candidates.push(leaf);
      if (candidates.length >= 200) break;
    }
  }
  return candidates;
}

// Claude'dan JSON yanıtını güvenilir şekilde çıkar
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON bulunamadı');
  return JSON.parse(text.slice(start, end + 1));
}

// Tek bir batch (≤30 kategori) için Claude'u çağır
async function matchBatch(client, xmlBatch, candidates) {
  const categoryList = candidates.map(l => `${l.id}|${l.path}`).join('\n');

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
  if (!text) throw new Error('Boş yanıt');

  console.log('[AI] stop_reason:', message.stop_reason, '| response length:', text.length);

  if (message.stop_reason === 'max_tokens') {
    console.error('[AI] Yanıt max_tokens limitinde kesildi. Batch boyutu düşürülmeli.');
    throw new Error('Yanıt çok uzun, daha az kategori gönderin');
  }

  return extractJson(text);
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

    const leaves = getLeaves();
    const candidates = findCandidates(xmlCategories, leaves);
    const leafById = new Map(leaves.map(l => [l.id, l]));

    console.log(`[AI] XML kategoriler: ${xmlCategories.length}, Trendyol adaylar: ${candidates.length}`);

    const client = new Anthropic({ apiKey });

    // 30'ar kategoriden oluşan batch'ler halinde işle
    const BATCH_SIZE = 30;
    const allMatches = {};

    for (let i = 0; i < xmlCategories.length; i += BATCH_SIZE) {
      const batch = xmlCategories.slice(i, i + BATCH_SIZE);
      try {
        const result = await matchBatch(client, batch, candidates);
        Object.assign(allMatches, result.matches || {});
      } catch (err) {
        console.error(`[AI] Batch ${i}-${i + BATCH_SIZE} hatası:`, err.message);
        // Bu batch için null döndür, diğerlerine devam et
        for (const cat of batch) allMatches[cat] = null;
      }
    }

    // ID'leri doğrula ve tam leaf verisini ekle
    const enriched = {};
    for (const [cat, match] of Object.entries(allMatches)) {
      if (!match) { enriched[cat] = null; continue; }
      const leaf = leafById.get(match.id);
      enriched[cat] = leaf ? { id: leaf.id, name: leaf.name, path: leaf.path } : null;
    }

    res.json({ matches: enriched });
  } catch (error) {
    console.error('[AI Category Match Error]', error.message);
    next(error);
  }
});

module.exports = router;
