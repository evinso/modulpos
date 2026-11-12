const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { ownedParam } = require('../middleware/ownership');
const { getSetting, deductCredits, refundCredits } = require('./credits');
const { getReadinessContext } = require('../services/readiness');
const productListCache = require('../services/productListCache');
const { getMatcher } = require('../services/categoryMatcher');
const { matchProducts, DEFAULT_MODEL } = require('../services/categoryAiPicker');
const { classifyAiError } = require('../services/aiErrors');
const AD = require('../services/attributeDefaults');
const PC = require('../services/productCategories');
const PA = require('../services/productAttributes');
const { pickAttributes, optionsFor, DEFAULT_MODEL: ATTR_AI_MODEL } = require('../services/attributeAiPicker');
const { suggestForCategories } = require('../services/xmlCategorySuggestions');

/**
 * Product-level Trendyol categories: a category chosen for ONE product (wins over the category mapping).
 * Free: rule-based suggestions and manual choice. Paid: the AI picks among the rule-based candidates.
 */
const router = express.Router();
router.use(auth);
router.param('id', ownedParam('marketplaceConnection'));

const MAX_IDS = 10000;
const MAX_ASSIGN = 500;
const MAX_AI = 100;
const MAX_ATTR_AI = 40;
const SOURCES = new Set(['manual', 'rule', 'ai']);

async function getConnection(id) {
  return prisma.marketplaceConnection.findUnique({ where: { id } });
}

/**
 * Gives the products of freshly assigned categories the connection's default answers for required attributes (when any are set), then
 * reads what is still open from each product's own title and description. Best effort: a Trendyol hiccup must never fail the assignment itself.
 */
async function fillAfterSave(connection, categoryIds, productIds) {
  try {
    const d = AD.parseDefaults(connection.config);
    if (d.rules.length || d.fallback.enabled) await AD.fillCategories(connection, categoryIds, { budgetMs: 8000 });
  } catch (e) { console.error('[ProductCategories] varsayılan özellikler uygulanamadı:', e.message); }
  try {
    if (productIds && productIds.length) await PA.fillFromText(connection, { productIds });
  } catch (e) { console.error('[ProductCategories] başlık/açıklamadan özellik seçilemedi:', e.message); }
  productListCache.invalidate(connection.storeId);
}

function productWhere(connection, xmlSourceId) {
  const where = { storeId: connection.storeId };
  if (xmlSourceId === 'none') where.xmlSourceId = null;
  else if (xmlSourceId) where.xmlSourceId = xmlSourceId;
  return where;
}

/** Products of one source with how each is categorised right now ('override' | 'mapping' | null). */
async function loadRows(connection, xmlSourceId) {
  const [products, ctx] = await Promise.all([
    prisma.product.findMany({ where: productWhere(connection, xmlSourceId), select: { id: true, title: true, category: true, xmlSourceId: true, stock: true }, orderBy: { title: 'asc' } }),
    getReadinessContext(connection),
  ]);
  return products.map((p) => {
    const m = ctx.resolveMapping(p.category, p.xmlSourceId, p.id);
    return {
      ...p,
      current: m ? { categoryId: String(m.marketplaceCategoryId), name: m.marketplaceCategoryName || String(m.marketplaceCategoryId), productLevel: !!m.productLevel, source: m.source || null } : null,
    };
  });
}

function applyFilters(rows, { status, category, q }) {
  let out = rows;
  if (status === 'missing') out = out.filter((r) => !r.current);
  else if (status === 'assigned') out = out.filter((r) => r.current && r.current.productLevel);
  else if (status === 'mapped') out = out.filter((r) => r.current && !r.current.productLevel);
  if (category) out = out.filter((r) => (r.category || '') === category);
  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    out = out.filter((r) => (r.title || '').toLowerCase().includes(needle));
  }
  return out;
}

// GET overview: counts and the XML categories with how many products still have no category
router.get('/connections/:id/product-categories/overview', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const rows = await loadRows(connection, req.query.xmlSourceId);
    const cats = new Map();
    let assigned = 0, mapped = 0, missing = 0;
    for (const r of rows) {
      const key = r.category || '';
      if (!cats.has(key)) cats.set(key, { category: key, total: 0, missing: 0 });
      const c = cats.get(key);
      c.total++;
      if (!r.current) { missing++; c.missing++; }
      else if (r.current.productLevel) assigned++;
      else mapped++;
    }
    const cost = parseFloat(await getSetting('credit_product_category_ai', '0.05')) || 0;
    res.json({
      total: rows.length, assigned, mapped, missing,
      categories: [...cats.values()].sort((a, b) => b.total - a.total),
      aiCostPerProduct: cost,
    });
  } catch (error) { next(error); }
});

// GET one page of products with their current category and (when they have none of their own) 3 free suggestions
router.get('/connections/:id/product-categories/products', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const rows = applyFilters(await loadRows(connection, req.query.xmlSourceId), req.query);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const matcher = getMatcher();
    const slice = rows.slice((page - 1) * limit, page * limit).map((r) => ({
      id: r.id, title: r.title, category: r.category, stock: r.stock, current: r.current,
      suggestions: r.current && r.current.productLevel ? [] : matcher.suggest(r.title, { context: r.category, top: 3 }).map(({ id, name, path, score, coverage }) => ({ id, name, path, score, coverage })),
    }));
    res.json({ total: rows.length, page, limit, products: slice });
  } catch (error) { next(error); }
});

// GET free suggestions for every XML CATEGORY of one source (the "Kategori eşleştirme" tab): judged by the titles of the category's products
router.get('/connections/:id/product-categories/category-suggestions', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const xmlSourceId = typeof req.query.xmlSourceId === 'string' ? req.query.xmlSourceId : '';
    if (!xmlSourceId || xmlSourceId === 'none') return res.status(400).json({ error: 'Önce bir XML kaynağı seçin' });
    const source = await prisma.xmlSource.findFirst({ where: { id: xmlSourceId, storeId: connection.storeId }, select: { id: true } });
    if (!source) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });
    const products = await prisma.product.findMany({
      where: { storeId: connection.storeId, xmlSourceId: source.id, category: { not: null } },
      select: { title: true, category: true },
    });
    res.json({ categories: suggestForCategories(products, getMatcher()) });
  } catch (error) { next(error); }
});

// GET ids of every product matching the filters (for "select all filtered")
router.get('/connections/:id/product-categories/ids', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const rows = applyFilters(await loadRows(connection, req.query.xmlSourceId), req.query);
    res.json({ total: rows.length, ids: rows.slice(0, MAX_IDS).map((r) => r.id), truncated: rows.length > MAX_IDS });
  } catch (error) { next(error); }
});

// GET manual picker: leaf categories matching the typed words
router.get('/connections/:id/product-categories/search', (req, res) => {
  res.json(getMatcher().search(req.query.q || '', 30));
});

// PUT assign categories: { assignments: [{ productId, categoryId, source? }] }
router.put('/connections/:id/product-categories', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const list = Array.isArray(req.body.assignments) ? req.body.assignments : [];
    if (list.length === 0) return res.status(400).json({ error: 'assignments dizisi gerekli' });
    if (list.length > MAX_ASSIGN) return res.status(400).json({ error: `En fazla ${MAX_ASSIGN} ürün atanabilir` });

    const matcher = getMatcher();
    const bad = list.find((a) => !a || !a.productId || !matcher.get(a.categoryId));
    if (bad) return res.status(400).json({ error: 'Geçersiz ürün ya da Trendyol kategorisi' });

    const owned = await prisma.product.findMany({ where: { id: { in: list.map((a) => a.productId) }, storeId: connection.storeId }, select: { id: true } });
    const ownedIds = new Set(owned.map((p) => p.id));
    const valid = list.filter((a) => ownedIds.has(a.productId));
    await prisma.$transaction(valid.map((a) => {
      const leaf = matcher.get(a.categoryId);
      const data = { marketplaceCategoryId: String(leaf.id), marketplaceCategoryName: leaf.path, source: SOURCES.has(a.source) ? a.source : 'manual' };
      return prisma.productCategoryOverride.upsert({
        where: { connectionId_productId: { connectionId: connection.id, productId: a.productId } },
        update: data,
        create: { connectionId: connection.id, productId: a.productId, ...data },
      });
    }));
    productListCache.invalidate(connection.storeId);
    await fillAfterSave(connection, valid.map((a) => String(matcher.get(a.categoryId).id)), valid.map((a) => a.productId));
    res.json({ saved: valid.length, skipped: list.length - valid.length });
  } catch (error) { next(error); }
});

// POST free bulk step: give every listed product the best rule-based suggestion: { productIds } (max 500)
router.post('/connections/:id/product-categories/apply-suggestions', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const ids = Array.isArray(req.body.productIds) ? [...new Set(req.body.productIds)] : [];
    if (ids.length === 0) return res.status(400).json({ error: 'productIds dizisi gerekli' });
    if (ids.length > MAX_ASSIGN) return res.status(400).json({ error: `En fazla ${MAX_ASSIGN} ürün işlenebilir` });
    const products = await prisma.product.findMany({ where: { id: { in: ids }, storeId: connection.storeId }, select: { id: true, title: true, category: true } });
    const matcher = getMatcher();
    const picked = [];
    for (const p of products) {
      const best = matcher.suggest(p.title, { context: p.category, top: 1 })[0];
      if (best) picked.push({ productId: p.id, leaf: best });
    }
    if (picked.length) {
      await prisma.$transaction(picked.map(({ productId, leaf }) => {
        const data = { marketplaceCategoryId: String(leaf.id), marketplaceCategoryName: leaf.path, source: 'rule' };
        return prisma.productCategoryOverride.upsert({
          where: { connectionId_productId: { connectionId: connection.id, productId } },
          update: data,
          create: { connectionId: connection.id, productId, ...data },
        });
      }));
      productListCache.invalidate(connection.storeId);
      await fillAfterSave(connection, picked.map(({ leaf }) => String(leaf.id)), picked.map(({ productId }) => productId));
    }
    res.json({ applied: picked.length, skipped: products.length - picked.length });
  } catch (error) { next(error); }
});

// DELETE give products back to the category mapping: { productIds }
router.delete('/connections/:id/product-categories', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const ids = Array.isArray(req.body.productIds) ? req.body.productIds : [];
    if (ids.length === 0) return res.status(400).json({ error: 'productIds dizisi gerekli' });
    const r = await prisma.productCategoryOverride.deleteMany({ where: { connectionId: connection.id, productId: { in: ids.slice(0, MAX_IDS) }, product: { storeId: connection.storeId } } });
    productListCache.invalidate(connection.storeId);
    res.json({ removed: r.count });
  } catch (error) { next(error); }
});

// POST reset the categories of ONE XML source: { xmlSourceId, includeMappings? }
//   always: every category chosen for a single product of that source (their attribute values go with them)
//   includeMappings: true also deletes the XML-category mappings of that source
// Nothing on the marketplace is touched; products simply fall back to the XML-category mapping (or to "no category").
router.post('/connections/:id/product-categories/reset', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const { xmlSourceId, includeMappings } = req.body || {};
    if (!xmlSourceId || typeof xmlSourceId !== 'string') return res.status(400).json({ error: 'xmlSourceId gerekli' });
    const productFilter = { storeId: connection.storeId };
    if (xmlSourceId === 'none') productFilter.xmlSourceId = null;
    else {
      const source = await prisma.xmlSource.findFirst({ where: { id: xmlSourceId, storeId: connection.storeId }, select: { id: true } });
      if (!source) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });
      productFilter.xmlSourceId = xmlSourceId;
    }
    const removed = await prisma.productCategoryOverride.deleteMany({ where: { connectionId: connection.id, product: productFilter } });
    let removedMappings = 0;
    if (includeMappings === true && xmlSourceId !== 'none') {
      removedMappings = (await prisma.categoryMapping.deleteMany({ where: { connectionId: connection.id, xmlSourceId } })).count;
    }
    productListCache.invalidate(connection.storeId);
    res.json({ removedProducts: removed.count, removedMappings });
  } catch (error) { next(error); }
});

// POST paid AI step: { productIds } (max 100 per call; the page sends parts). Only products with a result are charged.
router.post('/connections/:id/product-categories/ai-match', async (req, res, next) => {
  let charged = 0;
  const userId = req.user.id;
  try {
    const connection = await getConnection(req.params.id);
    const ids = Array.isArray(req.body.productIds) ? [...new Set(req.body.productIds)] : [];
    if (ids.length === 0) return res.status(400).json({ error: 'productIds dizisi gerekli' });
    if (ids.length > MAX_AI) return res.status(400).json({ error: `Bir seferde en fazla ${MAX_AI} ürün gönderilebilir` });

    const apiKey = await getSetting('anthropic_api_key', process.env.ANTHROPIC_API_KEY || '');
    if (!apiKey) return res.status(500).json({ error: 'Anthropic API Key ayarlanmamış. Superadmin → Genel Ayarlar sayfasından ekleyin.' });

    const products = await prisma.product.findMany({ where: { id: { in: ids }, storeId: connection.storeId }, select: { id: true, title: true, category: true } });
    if (products.length === 0) return res.status(404).json({ error: 'Ürün bulunamadı' });

    const cost = parseFloat(await getSetting('credit_product_category_ai', '0.05')) || 0;
    const total = parseFloat((cost * products.length).toFixed(4));
    if (total > 0) {
      try { await deductCredits(userId, total, 'product_category_ai', `AI Ürün Kategorisi: ${products.length} ürün × ${cost} kredi`); charged = total; }
      catch (creditErr) { return res.status(402).json({ error: creditErr.message }); }
    }
    const refund = async (count, why) => {
      const amount = parseFloat((cost * count).toFixed(4));
      if (!(amount > 0) || amount > charged + 1e-9) return;
      try { await refundCredits(userId, amount, `AI Ürün Kategorisi iadesi: ${why}`); charged = parseFloat((charged - amount).toFixed(4)); }
      catch (e) { console.error('[AI] Kredi iadesi yapılamadı:', e.message); }
    };

    const model = (await getSetting('ai_product_category_model', DEFAULT_MODEL)) || DEFAULT_MODEL;
    const client = new Anthropic({ apiKey });
    const { results, noCandidates, error: aiError } = await matchProducts({ client, products, matcher: getMatcher(), model });

    const admin = req.user.role === 'admin' || req.user.role === 'superadmin';
    const failure = aiError ? classifyAiError(aiError, { admin }) : null;
    const found = results.filter((r) => r.categoryId);
    if (found.length === 0 && failure) {
      await refund(products.length, 'AI servisi yanıt vermedi');
      return res.status(502).json({ error: failure.message, aiUnavailable: true, refunded: true });
    }

    const matcher = getMatcher();
    if (found.length) {
      await prisma.$transaction(found.map((r) => {
        const leaf = matcher.get(r.categoryId);
        const data = { marketplaceCategoryId: String(leaf.id), marketplaceCategoryName: leaf.path, source: 'ai' };
        return prisma.productCategoryOverride.upsert({
          where: { connectionId_productId: { connectionId: connection.id, productId: r.productId } },
          update: data,
          create: { connectionId: connection.id, productId: r.productId, ...data },
        });
      }));
      productListCache.invalidate(connection.storeId);
      await fillAfterSave(connection, found.map((r) => String(r.categoryId)), found.map((r) => r.productId));
    }
    const unmatched = products.length - found.length;
    await refund(unmatched, `${unmatched} ürün için sonuç yok`);
    res.json({
      matched: found.length, unmatched, noCandidates,
      charged: parseFloat((cost * found.length).toFixed(4)),
      partialError: failure ? failure.message : null,
      results: results.map((r) => ({ productId: r.productId, categoryId: r.categoryId, path: r.path })),
    });
  } catch (error) {
    console.error('[AI Product Category Error]', error.message);
    if (charged > 0 && !res.headersSent) {
      try { await refundCredits(userId, charged, 'AI Ürün Kategorisi iadesi: beklenmeyen hata'); } catch (e) { console.error('[AI] Kredi iadesi yapılamadı:', e.message); }
    }
    next(error);
  }
});

// GET categories chosen for products, grouped, with the required attributes still missing (counted per product: values read from a product's
// own text belong to that product alone)
router.get('/connections/:id/product-categories/groups', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const ctx = await getReadinessContext(connection);
    const d = AD.parseDefaults(connection.config);
    const triedDefaults = d.rules.length > 0 || d.fallback.enabled;
    const groups = new Map();
    for (const [productId, m] of ctx.productMappings) {
      const key = String(m.marketplaceCategoryId);
      if (!groups.has(key)) groups.set(key, { categoryId: key, name: m.marketplaceCategoryName || key, count: 0, shared: {}, lacking: new Map(), lackingProducts: 0 });
      const g = groups.get(key);
      g.count++;
      const required = ctx.requiredAttrs.get(key) || [];
      const attrs = PA.parseJson(m.attributes);
      let lacks = false;
      for (const r of required) { if (!AD.hasVal(attrs[r.id])) { g.lacking.set(r.id, (g.lacking.get(r.id) || 0) + 1); lacks = true; } }
      if (lacks) g.lackingProducts++;
      for (const [k, v] of Object.entries(PA.parseJson(PC.shareableJson(m.attributes)))) if (!g.shared[k]) g.shared[k] = v;   // what the form starts with: values that may be shared by the whole category
    }
    const { map: defsMap } = await AD.loadRequiredDefs(connection, [...groups.keys()], { max: 60 }); // cached; gives the value lists for examples
    const out = [...groups.values()].map((g) => {
      const required = ctx.requiredAttrs.get(g.categoryId) || [];
      const defs = defsMap.get(g.categoryId) || [];
      const missing = required.filter((r) => g.lacking.has(r.id));
      return {
        categoryId: g.categoryId, name: g.name, count: g.count, required, lackingProducts: g.lackingProducts,
        missing: missing.map((m) => { const df = defs.find((x) => x.id === m.id) || {}; return { ...m, products: g.lacking.get(m.id), triedDefaults, allowCustom: !!df.allowCustom, examples: (df.values || []).slice(0, 6).map((v) => v.name) }; }),
        attributes: g.shared,
      };
    }).sort((a, b) => (b.missing.length > 0) - (a.missing.length > 0) || b.count - a.count);
    res.json(out);
  } catch (error) { next(error); }
});

// PUT required attribute values for the products of one chosen category: { categoryId, attributes: { attrId: { name, valueId, valueName } } }
// Applied to every product of the category EXCEPT where that product already has a value of its own for the attribute (read from its title
// or description, or chosen by the AI): those stay.
router.put('/connections/:id/product-categories/attributes', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const { categoryId, attributes } = req.body || {};
    if (!categoryId || !attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return res.status(400).json({ error: 'categoryId ve attributes gerekli' });
    const clean = {};
    for (const [id, v] of Object.entries(attributes)) {
      if (!/^\d+$/.test(id) || !v || typeof v !== 'object') return res.status(400).json({ error: 'Geçersiz özellik' });
      clean[id] = { name: String(v.name || '').slice(0, 120), valueId: v.valueId ? String(v.valueId) : '', valueName: String(v.valueName || '').slice(0, 200), ...(v.auto === true ? { auto: true } : {}) };
    }
    const rows = await prisma.productCategoryOverride.findMany({ where: { connectionId: connection.id, marketplaceCategoryId: String(categoryId) }, select: { id: true, attributes: true } });
    // rows without their own entries all get the same text: one update for them
    const plain = [];
    const special = [];
    for (const r of rows) {
      const own = Object.fromEntries(Object.entries(PA.parseJson(r.attributes)).filter(([, v]) => v && v.from));
      if (Object.keys(own).length === 0) plain.push(r.id); else special.push({ id: r.id, json: JSON.stringify({ ...clean, ...own }) });
    }
    let updated = 0;
    if (plain.length) updated += (await prisma.productCategoryOverride.updateMany({ where: { id: { in: plain } }, data: { attributes: JSON.stringify(clean) } })).count;
    for (const part of PA.chunk(special, 100)) {
      await prisma.$transaction(part.map((u) => prisma.productCategoryOverride.update({ where: { id: u.id }, data: { attributes: u.json } })));
      updated += part.length;
    }
    productListCache.invalidate(connection.storeId);
    res.json({ updated });
  } catch (error) { next(error); }
});

// POST free step: fill the open required attributes of the products from their own title and description.
// { xmlSourceId?: only this source ('none' = added by hand), productIds?: only these, includeRuleValues?: also replace default answers }
router.post('/connections/:id/product-categories/attributes-from-text', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const { xmlSourceId, productIds, includeRuleValues } = req.body || {};
    const opts = { includeRuleValues: includeRuleValues === true };
    if (xmlSourceId !== undefined && xmlSourceId !== null && xmlSourceId !== '') {
      if (typeof xmlSourceId !== 'string') return res.status(400).json({ error: 'xmlSourceId geçersiz' });
      if (xmlSourceId !== 'none') {
        const source = await prisma.xmlSource.findFirst({ where: { id: xmlSourceId, storeId: connection.storeId }, select: { id: true } });
        if (!source) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });
      }
      opts.xmlSourceId = xmlSourceId;
    }
    if (productIds !== undefined) {
      if (!Array.isArray(productIds) || productIds.length > MAX_IDS) return res.status(400).json({ error: 'productIds geçersiz' });
      opts.productIds = productIds;
    }
    const result = await PA.fillFromText(connection, opts);
    productListCache.invalidate(connection.storeId);
    res.json(result);
  } catch (error) { next(error); }
});

// GET the products that still lack required attributes (ids for the AI step), and which attributes
router.get('/connections/:id/product-categories/attribute-gaps', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const xmlSourceId = typeof req.query.xmlSourceId === 'string' && req.query.xmlSourceId ? req.query.xmlSourceId : null;
    if (xmlSourceId && xmlSourceId !== 'none') {
      const source = await prisma.xmlSource.findFirst({ where: { id: xmlSourceId, storeId: connection.storeId }, select: { id: true } });
      if (!source) return res.status(404).json({ error: 'XML kaynağı bulunamadı' });
    }
    const { gaps, pending } = await PA.findGaps(connection, { xmlSourceId });
    const names = new Map();
    for (const g of gaps) for (const d of g.missing) names.set(d.name, (names.get(d.name) || 0) + 1);
    const cost = parseFloat(await getSetting('credit_product_attribute_ai', '0.1')) || 0;
    res.json({ products: gaps.length, ids: gaps.slice(0, MAX_IDS).map((g) => g.productId), attributes: PA.tally(names), pending, aiCostPerProduct: cost });
  } catch (error) { next(error); }
});

// POST paid AI step for the open required attributes: { productIds } (max 40 per call; the page sends parts). Only products that got a value are charged.
router.post('/connections/:id/product-categories/attributes-ai', async (req, res, next) => {
  let charged = 0;
  const userId = req.user.id;
  try {
    const connection = await getConnection(req.params.id);
    const ids = Array.isArray(req.body.productIds) ? [...new Set(req.body.productIds)] : [];
    if (ids.length === 0) return res.status(400).json({ error: 'productIds dizisi gerekli' });
    if (ids.length > MAX_ATTR_AI) return res.status(400).json({ error: `Bir seferde en fazla ${MAX_ATTR_AI} ürün gönderilebilir` });

    const apiKey = await getSetting('anthropic_api_key', process.env.ANTHROPIC_API_KEY || '');
    if (!apiKey) return res.status(500).json({ error: 'Anthropic API Key ayarlanmamış. Superadmin → Genel Ayarlar sayfasından ekleyin.' });

    const { gaps } = await PA.findGaps(connection, { productIds: ids });
    if (gaps.length === 0) return res.json({ asked: 0, filledProducts: 0, filledAttributes: 0, unfilled: 0, charged: 0, partialError: null });
    const texts = await PA.loadTexts(gaps.map((g) => g.productId));
    const products = gaps.filter((g) => texts.has(g.productId)).map((g) => ({ key: g.productId, title: texts.get(g.productId).title, description: texts.get(g.productId).description, defs: g.missing }));

    // the products the AI can be asked about are known before it is called, so the price is fixed up front
    const askable = products.filter((p) => p.defs.some((d) => optionsFor(d, p.title, p.description)));
    if (askable.length === 0) return res.json({ asked: 0, filledProducts: 0, filledAttributes: 0, unfilled: products.length, charged: 0, partialError: null });

    const cost = parseFloat(await getSetting('credit_product_attribute_ai', '0.1')) || 0;
    const total = parseFloat((cost * askable.length).toFixed(4));
    if (total > 0) {
      try { await deductCredits(userId, total, 'product_attribute_ai', `AI Ürün Özellikleri: ${askable.length} ürün × ${cost} kredi`); charged = total; }
      catch (creditErr) { return res.status(402).json({ error: creditErr.message }); }
    }
    const refund = async (count, why) => {
      const amount = parseFloat((cost * count).toFixed(4));
      if (!(amount > 0) || amount > charged + 1e-9) return;
      try { await refundCredits(userId, amount, `AI Ürün Özellikleri iadesi: ${why}`); charged = parseFloat((charged - amount).toFixed(4)); }
      catch (e) { console.error('[AI] Kredi iadesi yapılamadı:', e.message); }
    };

    const model = (await getSetting('ai_product_attribute_model', ATTR_AI_MODEL)) || ATTR_AI_MODEL;
    const client = new Anthropic({ apiKey });
    const { results, error: aiError } = await pickAttributes({ client, products: askable, model });

    const admin = req.user.role === 'admin' || req.user.role === 'superadmin';
    const failure = aiError ? classifyAiError(aiError, { admin }) : null;
    const updates = [];
    let filledAttributes = 0;
    for (const g of gaps) {
      const got = results.get(g.productId);
      if (!got) continue;
      const entries = {};
      for (const d of g.missing) {
        const v = got[String(d.id)];
        if (v) { entries[d.id] = { name: d.name, valueId: v.valueId, valueName: v.valueName, from: 'ai' }; filledAttributes++; }
      }
      if (Object.keys(entries).length) updates.push({ rowId: g.rowId, attrs: g.attrs, entries });
    }
    if (updates.length === 0 && failure) {
      await refund(askable.length, 'AI servisi yanıt vermedi');
      return res.status(502).json({ error: failure.message, aiUnavailable: true, refunded: true });
    }
    await PA.writeEntries(updates);
    if (updates.length) productListCache.invalidate(connection.storeId);
    const unfilled = askable.length - updates.length;
    await refund(unfilled, `${unfilled} ürün için değer bulunamadı`);
    res.json({
      asked: askable.length, filledProducts: updates.length, filledAttributes, unfilled,
      charged: parseFloat((cost * updates.length).toFixed(4)),
      partialError: failure ? failure.message : null,
    });
  } catch (error) {
    console.error('[AI Product Attribute Error]', error.message);
    if (charged > 0 && !res.headersSent) {
      try { await refundCredits(userId, charged, 'AI Ürün Özellikleri iadesi: beklenmeyen hata'); } catch (e) { console.error('[AI] Kredi iadesi yapılamadı:', e.message); }
    }
    next(error);
  }
});

// GET the default answers for required attributes (what is saved, or the suggestion when nothing is saved yet)
router.get('/connections/:id/product-categories/attribute-defaults', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const d = AD.parseDefaults(connection.config);
    if (d.saved) return res.json({ saved: true, rules: d.rules, fallback: d.fallback });
    res.json({ saved: false, rules: AD.SUGGESTED.rules, fallback: AD.SUGGESTED.fallback });
  } catch (error) { next(error); }
});

// PUT default answers: { rules: [{ name, value }], fallback: { enabled, value } } -> saved on the connection and applied to every chosen category
router.put('/connections/:id/product-categories/attribute-defaults', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const body = req.body || {};
    const rawRules = Array.isArray(body.rules) ? body.rules : null;
    if (!rawRules) return res.status(400).json({ error: 'rules dizisi gerekli' });
    if (rawRules.length > 40) return res.status(400).json({ error: 'En fazla 40 kural tanımlanabilir' });
    const rules = [];
    for (const r of rawRules) {
      const name = String(r?.name || '').trim();
      const value = String(r?.value || '').trim();
      if (!name && !value) continue;                       // empty row
      if (!name || !value) return res.status(400).json({ error: 'Her kuralda hem özellik adı hem değer olmalı' });
      if (name.length > 200 || value.length > 120) return res.status(400).json({ error: 'Özellik adı ya da değer çok uzun' });
      rules.push({ name, value });
    }
    const fbValue = String(body.fallback?.value || '').trim();
    const fbEnabled = body.fallback?.enabled === true;
    if (fbEnabled && !fbValue) return res.status(400).json({ error: 'Diğer özellikler için bir değer yazın ya da seçeneği kapatın' });
    if (fbValue.length > 120) return res.status(400).json({ error: 'Değer çok uzun' });

    let config = {};
    try { config = connection.config ? JSON.parse(connection.config) : {}; } catch { config = {}; }
    config.attributeDefaults = { rules, fallback: { enabled: fbEnabled, value: fbValue } };
    const configText = JSON.stringify(config);
    await prisma.marketplaceConnection.update({ where: { id: connection.id }, data: { config: configText } });

    const cats = await prisma.productCategoryOverride.groupBy({ by: ['marketplaceCategoryId'], where: { connectionId: connection.id } });
    const result = await AD.fillCategories({ ...connection, config: configText }, cats.map((c) => c.marketplaceCategoryId), { budgetMs: 40000 });
    productListCache.invalidate(connection.storeId);
    res.json({ saved: true, rules, fallback: { enabled: fbEnabled, value: fbValue }, ...result });
  } catch (error) { next(error); }
});

module.exports = router;
