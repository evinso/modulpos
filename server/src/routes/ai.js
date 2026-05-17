const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { auth } = require('../middleware/auth');
const { getSetting, deductCredits } = require('./credits');
const staticCategories = require('../data/trendyolCategories');
const TrendyolService = require('../services/trendyol/trendyolService');
const prisma = require('../config/database');

const router = express.Router();
router.use(auth);

// ── Category tree helpers ─────────────────────────────────────────────────────

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

// ── Step 1: Map XML categories to one of 16 top-level Trendyol categories ────

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
- Her XML kategorisi için listedeki ANA kategorilerden birini SEÇ
- Kesinlikle null döndürme — her zaman en yakın ana kategoriyi seç
- Sadece JSON döndür, açıklama yazma

JSON formatı:
{
  "mappings": {
    "XML Kategori Adı": 1234,
    "Başka Kategori": 5678
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

// ── Step 2: Find exact leaf within a subtree ──────────────────────────────────

async function matchInSubtree(client, xmlBatch, leaves) {
  const categoryList = leaves.map(l => `${l.id}|${l.path}`).join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    system: `Sen bir e-ticaret kategori eşleştirme asistanısın. Cevabını SADECE geçerli JSON olarak ver, başka hiçbir şey yazma.`,
    messages: [{
      role: 'user',
      content: `Aşağıdaki XML kategorilerini Trendyol yaprak kategorileriyle eşleştir.

XML Kategorileri:
${xmlBatch.map(c => `- ${c}`).join('\n')}

Trendyol kategorileri (format: id|tam yol):
${categoryList}

Kurallar:
- Her XML kategorisi için listeden mutlaka bir yaprak seç
- Kesinlikle null döndürme — tam eşleşme olmasa da en yakın yaprağı seç
- Sadece JSON döndür, açıklama yazma

JSON formatı:
{
  "matches": {
    "XML Kategori Adı": { "id": 1234, "path": "Üst > Alt > Yaprak" },
    "Başka Kategori": { "id": 5678, "path": "Üst > Alt > Yaprak2" }
  }
}`
    }],
  });

  const text = message.content[0]?.text?.trim() || '';
  if (!text) throw new Error('Step-2 boş yanıt');
  console.log('[AI] Step-2 stop_reason:', message.stop_reason, '| length:', text.length);

  if (message.stop_reason === 'max_tokens') throw new Error('Yanıt çok uzun');

  const parsed = extractJson(text);
  const nonNull = Object.values(parsed.matches || {}).filter(Boolean).length;
  console.log(`[AI] Step-2 batch: ${nonNull}/${Object.keys(parsed.matches || {}).length} eşleşti`);
  return parsed;
}

// ── Step 3: Fetch Trendyol required attributes for matched categories ─────────

async function fetchRequiredAttributes(service, categoryId) {
  try {
    const data = await service.getCategoryAttributes(categoryId);
    const attrs = data?.categoryAttributes || [];
    return attrs
      .filter(a => a.required)
      .map(a => ({
        id: a.attribute.id,
        name: a.attribute.name,
        allowCustom: !!a.allowCustom,
        values: (a.attributeValues || []).slice(0, 40).map(v => ({ id: v.id, name: v.name }))
      }));
  } catch (err) {
    console.error(`[AI] Attribute fetch hatası catId=${categoryId}:`, err.message);
    return [];
  }
}

// ── Step 4: AI fills required attributes for all matched categories ───────────
// Uses numeric indices as JSON keys to avoid category name mangling

async function fillAttributes(client, items) {
  const toFill = items.filter(it => it.requiredAttributes.length > 0);
  if (toFill.length === 0) return {};

  // Build prompt lines
  const lines = toFill.map((it, idx) => {
    const attrLines = it.requiredAttributes.map(a => {
      const vals = a.values.length
        ? ' | seçenekler: ' + a.values.map(v => `${v.id}=${v.name}`).join(', ')
        : '';
      return `    ${a.id}=${a.name} (allowCustom:${a.allowCustom})${vals}`;
    }).join('\n');
    return `[${idx}] XML:"${it.xmlCategory}" → Trendyol:"${it.trendyolPath}"\n  Özellikler:\n${attrLines}`;
  }).join('\n\n');

  // Build expected JSON example
  const exampleIdx = '0';
  const exampleAttr = toFill[0]?.requiredAttributes[0];
  const exampleAttrId = exampleAttr?.id ?? 338;
  const exampleValId = exampleAttr?.values[0]?.id ?? 1;
  const exampleValName = exampleAttr?.values[0]?.name ?? 'Değer';

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    system: `Sen bir e-ticaret kategori eşleştirme asistanısın. Cevabını SADECE geçerli JSON olarak ver, başka hiçbir şey yazma.`,
    messages: [{
      role: 'user',
      content: `Her kategorinin zorunlu Trendyol özelliklerini doldur.

${lines}

Kurallar:
- Kategori adı ve Trendyol yolundan anlamlı değer belirleniyorsa seç (örn. "Erkek" → Cinsiyet=Erkek)
- allowCustom=false → sadece verilen seçenek ID'lerinden birini kullan
- allowCustom=true → istediğin metni yazabilirsin
- Renk, Beden, Model gibi ürüne özgü özellikler için null döndür

JSON formatı (anahtar = köşeli parantez içindeki sayı, alt anahtar = özellik ID'si):
{
  "${exampleIdx}": {
    "${exampleAttrId}": { "valueId": "${exampleValId}", "valueName": "${exampleValName}" },
    "digerAttrId": null
  }
}`
    }],
  });

  const text = message.content[0]?.text?.trim() || '';
  if (!text) return {};
  console.log('[AI] Step-4 stop_reason:', message.stop_reason, '| length:', text.length);
  try {
    const parsed = extractJson(text);
    // Convert index-based result back to xmlCategory-keyed map
    const result = {};
    for (const [idxStr, attrData] of Object.entries(parsed)) {
      const item = toFill[parseInt(idxStr, 10)];
      if (item && attrData && typeof attrData === 'object') {
        result[item.xmlCategory] = attrData;
      }
    }
    console.log(`[AI] Step-4: ${Object.keys(result).length}/${toFill.length} kategoride özellik dolduruldu`);
    return result;
  } catch (err) {
    console.error('[AI] Step-4 JSON parse hatası:', err.message, '| text:', text.substring(0, 200));
    return {};
  }
}

// ── Main route ────────────────────────────────────────────────────────────────

// POST /api/ai/category-match
router.post('/category-match', async (req, res, next) => {
  try {
    const { xmlCategories, connectionId } = req.body;
    if (!Array.isArray(xmlCategories) || xmlCategories.length === 0) {
      return res.status(400).json({ error: 'xmlCategories dizisi gerekli' });
    }
    if (xmlCategories.length > 200) {
      return res.status(400).json({ error: 'En fazla 200 kategori gönderilebilir' });
    }

    const apiKey = await getSetting('anthropic_api_key', process.env.ANTHROPIC_API_KEY || '');
    if (!apiKey) return res.status(500).json({ error: 'Anthropic API Key ayarlanmamış. Superadmin → Genel Ayarlar sayfasından ekleyin.' });

    // Kredi kontrolü
    const costPerCat = parseFloat(await getSetting('credit_category_ai', '0.5'));
    const totalCost = parseFloat((costPerCat * xmlCategories.length).toFixed(2));
    if (totalCost > 0) {
      try {
        await deductCredits(req.user.id, totalCost, 'category_ai',
          `AI Kategori Eşleştirme: ${xmlCategories.length} kategori × ${costPerCat} kredi`);
      } catch (creditErr) {
        return res.status(402).json({ error: creditErr.message });
      }
    }

    const { topLevel, leafById, byTopLevel } = getCategoryData();
    const client = new Anthropic({ apiKey });
    console.log(`[AI] XML kategoriler: ${xmlCategories.length}, top-level: ${topLevel.length}`);

    // ── Step 1: Map all XML categories → top-level Trendyol category ──────────
    const STEP1_BATCH = 60;
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

    // Group XML categories by top-level match
    const groupedByTopLevel = {};
    const nullTopLevel = [];

    for (const xmlCat of xmlCategories) {
      const topId = Number(topLevelMappings[xmlCat]);
      if (!topId || !byTopLevel[topId]) {
        nullTopLevel.push(xmlCat);
      } else {
        if (!groupedByTopLevel[topId]) groupedByTopLevel[topId] = [];
        groupedByTopLevel[topId].push(xmlCat);
      }
    }

    console.log(`[AI] Gruplar: ${Object.keys(groupedByTopLevel).length} ana kategori, ${nullTopLevel.length} eşleşmedi`);

    // ── Step 2: Find exact leaf within each subtree ───────────────────────────
    const STEP2_BATCH = 30;
    const allMatches = {};

    // Unmatched top-level: retry with all leaves combined from a broad fallback
    if (nullTopLevel.length > 0) {
      // Use all leaves but pick top-200 by relevance (keyword scoring)
      const allLeaves = [...leafById.values()];
      const words = new Set(
        nullTopLevel.flatMap(c => c.toLowerCase().split(/[\s>\/,&\-_\(\)]+/).filter(w => w.length > 2))
      );
      const scored = allLeaves
        .map(l => ({ l, s: [...words].filter(w => l.path.toLowerCase().includes(w)).length }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 250)
        .map(x => x.l);
      const fallback = scored.length >= 20 ? scored : allLeaves.slice(0, 200);

      for (let i = 0; i < nullTopLevel.length; i += STEP2_BATCH) {
        const batch = nullTopLevel.slice(i, i + STEP2_BATCH);
        try {
          const result = await matchInSubtree(client, batch, fallback);
          Object.assign(allMatches, result.matches || {});
        } catch (err) {
          console.error('[AI] Step-2 fallback hatası:', err.message);
          for (const cat of batch) allMatches[cat] = null;
        }
      }
    }

    for (const [topId, xmlCats] of Object.entries(groupedByTopLevel)) {
      const subtreeLeaves = byTopLevel[Number(topId)]?.leaves || [];
      const topName = byTopLevel[Number(topId)]?.name;
      console.log(`[AI] Step-2: "${topName}" → ${xmlCats.length} XML kat, ${subtreeLeaves.length} yaprak`);

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

    // Validate IDs against leafById; if still null, pick first leaf from the matched subtree
    const enriched = {};
    for (const [cat, match] of Object.entries(allMatches)) {
      if (!match) {
        // Last resort: use first leaf from the top-level group this cat was in
        const topId = Number(topLevelMappings[cat]);
        const fallbackLeaf = byTopLevel[topId]?.leaves?.[0];
        enriched[cat] = fallbackLeaf
          ? { id: fallbackLeaf.id, name: fallbackLeaf.name, path: fallbackLeaf.path }
          : null;
        continue;
      }
      const leaf = leafById.get(Number(match.id)) || leafById.get(match.id);
      if (leaf) {
        enriched[cat] = { id: leaf.id, name: leaf.name, path: leaf.path };
      } else {
        // Claude hallucinated an ID — fall back to first leaf of the subtree
        const topId = Number(topLevelMappings[cat]);
        const fallbackLeaf = byTopLevel[topId]?.leaves?.[0];
        enriched[cat] = fallbackLeaf
          ? { id: fallbackLeaf.id, name: fallbackLeaf.name, path: fallbackLeaf.path }
          : null;
      }
    }

    const matchedCount = Object.values(enriched).filter(Boolean).length;
    console.log(`[AI] Step-2 Final: ${matchedCount}/${Object.keys(enriched).length} eşleşti`);

    // ── Step 3 + 4: Fetch attributes & AI-fill them ──────────────────────────
    if (connectionId) {
      const connection = await prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });

      if (connection && connection.marketplaceType === 'trendyol') {
        const service = new TrendyolService(connection);

        // Deduplicate category IDs to avoid repeated API calls
        const catIdToXmlCats = {};
        for (const [xmlCat, match] of Object.entries(enriched)) {
          if (!match) continue;
          const cid = match.id;
          if (!catIdToXmlCats[cid]) catIdToXmlCats[cid] = [];
          catIdToXmlCats[cid].push(xmlCat);
        }

        // Fetch attributes for each unique Trendyol category (in parallel, max 5 concurrent)
        const catIds = Object.keys(catIdToXmlCats).map(Number);
        const attrByCatId = {};

        for (let i = 0; i < catIds.length; i += 5) {
          const chunk = catIds.slice(i, i + 5);
          const results = await Promise.all(chunk.map(cid => fetchRequiredAttributes(service, cid)));
          chunk.forEach((cid, idx) => { attrByCatId[cid] = results[idx]; });
        }

        // Build items for AI attribute filling
        const fillItems = [];
        for (const [xmlCat, match] of Object.entries(enriched)) {
          if (!match) continue;
          const reqAttrs = attrByCatId[match.id] || [];
          if (reqAttrs.length > 0) {
            fillItems.push({ xmlCategory: xmlCat, trendyolPath: match.path, requiredAttributes: reqAttrs });
          }
        }

        // Fill attributes in batches of 20 categories
        const ATTR_BATCH = 20;
        const filledAttributes = {};
        for (let i = 0; i < fillItems.length; i += ATTR_BATCH) {
          const batch = fillItems.slice(i, i + ATTR_BATCH);
          try {
            const result = await fillAttributes(client, batch);
            Object.assign(filledAttributes, result);
          } catch (err) {
            console.error('[AI] Step-4 batch hatası:', err.message);
          }
        }

        // Merge attributes into enriched result
        for (const [xmlCat, match] of Object.entries(enriched)) {
          if (!match) continue;
          const attrData = filledAttributes[xmlCat] || {};
          // Convert AI attr result to the format expected by category-mappings API
          const attributes = {};
          const reqAttrs = attrByCatId[match.id] || [];
          for (const attr of reqAttrs) {
            // Claude returns attr IDs as strings or numbers — try both
            const filled = attrData[String(attr.id)] ?? attrData[attr.id];
            if (!filled || typeof filled !== 'object') continue;
            attributes[attr.id] = {
              name: attr.name,
              valueId: String(filled.valueId ?? ''),
              valueName: filled.valueName ?? ''
            };
          }
          enriched[xmlCat] = { ...match, attributes };
        }

        const attrCount = Object.values(enriched).filter(m => m && Object.keys(m.attributes || {}).length > 0).length;
        console.log(`[AI] Step-4: ${attrCount} kategoride özellik dolduruldu`);
      }
    }

    res.json({ matches: enriched });
  } catch (error) {
    console.error('[AI Category Match Error]', error.message);
    next(error);
  }
});

module.exports = router;
