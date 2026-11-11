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
const SOURCES = new Set(['manual', 'rule', 'ai']);

async function getConnection(id) {
  return prisma.marketplaceConnection.findUnique({ where: { id } });
}

/**
 * Gives the products of freshly assigned categories the connection's default answers for required attributes
 * (when any are set). Best effort: a Trendyol hiccup must never fail the assignment itself.
 */
async function fillAfterSave(connection, categoryIds) {
  try {
    const d = AD.parseDefaults(connection.config);
    if (!d.rules.length && !d.fallback.enabled) return;
    await AD.fillCategories(connection, categoryIds, { budgetMs: 8000 });
    productListCache.invalidate(connection.storeId);
  } catch (e) { console.error('[ProductCategories] varsayılan özellikler uygulanamadı:', e.message); }
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
    await fillAfterSave(connection, valid.map((a) => String(matcher.get(a.categoryId).id)));
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
      await fillAfterSave(connection, picked.map(({ leaf }) => String(leaf.id)));
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
      await fillAfterSave(connection, found.map((r) => String(r.categoryId)));
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

// GET categories chosen for products, grouped, with the required attributes still missing
router.get('/connections/:id/product-categories/groups', async (req, res, next) => {
  try {
    const connection = await getConnection(req.params.id);
    const ctx = await getReadinessContext(connection);
    const d = AD.parseDefaults(connection.config);
    const triedDefaults = d.rules.length > 0 || d.fallback.enabled;
    const groups = new Map();
    for (const [productId, m] of ctx.productMappings) {
      const key = String(m.marketplaceCategoryId);
      if (!groups.has(key)) groups.set(key, { categoryId: key, name: m.marketplaceCategoryName || key, count: 0, attributes: m.attributes || null });
      groups.get(key).count++;
    }
    const { map: defsMap } = await AD.loadRequiredDefs(connection, [...groups.keys()], { max: 60 }); // cached; gives the value lists for examples
    const out = [...groups.values()].map((g) => {
      const required = ctx.requiredAttrs.get(g.categoryId) || [];
      const defs = defsMap.get(g.categoryId) || [];
      let attrs = {};
      try { attrs = g.attributes ? JSON.parse(g.attributes) : {}; } catch { attrs = {}; }
      const missing = required.filter((r) => { const v = attrs[r.id]; return !v || (!v.valueId && !(v.valueName && String(v.valueName).trim())); });
      return { categoryId: g.categoryId, name: g.name, count: g.count, required, missing: missing.map((m) => { const d = defs.find((x) => x.id === m.id) || {}; return { ...m, triedDefaults, allowCustom: !!d.allowCustom, examples: (d.values || []).slice(0, 6).map((v) => v.name) }; }), attributes: attrs };
    }).sort((a, b) => (b.missing.length > 0) - (a.missing.length > 0) || b.count - a.count);
    res.json(out);
  } catch (error) { next(error); }
});

// PUT required attribute values for ALL products of one chosen category: { categoryId, attributes: { attrId: { name, valueId, valueName } } }
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
    const r = await prisma.productCategoryOverride.updateMany({ where: { connectionId: connection.id, marketplaceCategoryId: String(categoryId) }, data: { attributes: JSON.stringify(clean) } });
    productListCache.invalidate(connection.storeId);
    res.json({ updated: r.count });
  } catch (error) { next(error); }
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
