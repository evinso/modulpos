const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { auth } = require('../middleware/auth');
const staticCategories = require('../data/trendyolCategories');

const router = express.Router();
router.use(auth);

// Flatten category tree to leaf nodes with full breadcrumb path
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

// POST /api/ai/category-match
// Body: { xmlCategories: string[] }
// Returns: { matches: { [xmlCategory]: { id, name, path } | null } }
router.post('/category-match', async (req, res, next) => {
  try {
    const { xmlCategories } = req.body;
    if (!Array.isArray(xmlCategories) || xmlCategories.length === 0) {
      return res.status(400).json({ error: 'xmlCategories dizisi gerekli' });
    }
    if (xmlCategories.length > 200) {
      return res.status(400).json({ error: 'En fazla 200 kategori gönderilebilir' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY ayarlanmamış' });

    const leaves = getLeaves();
    const categoryList = leaves.map(l => `${l.id}|${l.path}`).join('\n');

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: `Sen bir e-ticaret kategori eşleştirme asistanısın. XML feed'indeki kategori adlarını Trendyol pazaryeri kategorileriyle eşleştiriyorsun. Her XML kategorisi için en uygun Trendyol yaprak kategorisini seç. Cevabını sadece geçerli JSON olarak ver, başka hiçbir şey yazma.`,
      messages: [{
        role: 'user',
        content: `Aşağıdaki XML kategorilerini Trendyol kategorileriyle eşleştir.

XML Kategorileri:
${xmlCategories.map(c => `- ${c}`).join('\n')}

Mevcut Trendyol kategorileri (format: id|tam yol):
${categoryList}

Her XML kategorisi için en uygun Trendyol kategorisini bul. Eğer iyi bir eşleşme yoksa null döndür.

Cevabı bu JSON formatında ver:
{
  "matches": {
    "XML Kategori Adı": { "id": 1234, "path": "Üst Kategori > Alt Kategori > Yaprak" },
    "Eşleşmeyen Kategori": null
  }
}`
      }],
    });

    let result;
    try {
      const text = message.content[0].text.trim();
      const jsonStr = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      result = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: 'AI yanıtı işlenemedi' });
    }

    // Attach full leaf data (verify id exists in our tree)
    const leafById = new Map(leaves.map(l => [l.id, l]));
    const enriched = {};
    for (const [cat, match] of Object.entries(result.matches || {})) {
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
