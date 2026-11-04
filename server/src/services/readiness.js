const prisma = require('../config/database');
const { loadPricingContext } = require('./pricingEngine');
const { loadContentRules } = require('./contentRules');

/**
 * "Is this product safe to send to the marketplace?"
 *
 * One implementation used by the product list (to show why a product is blocked)
 * AND by the send routes (to refuse sending it), so the two can never disagree.
 */

const LIMITS = {
  TITLE_MAX: 100,          // Trendyol rejects longer titles
  DESCRIPTION_MAX: 30000,
  BARCODE_MIN: 3,
  BARCODE_MAX: 40,
  VAT_RATES: [0, 1, 10, 20],
};

const ISSUE = {
  NO_CATEGORY: 'no_category_mapping',
  BAD_BARCODE: 'bad_barcode',
  DUP_BARCODE: 'duplicate_barcode',
  NO_PRICE_RULE: 'no_price_rule',
  BAD_PRICE: 'invalid_price',
  BELOW_COST: 'price_below_cost',
  NO_TITLE: 'title_empty',
  LONG_TITLE: 'title_too_long',
  NO_DESC: 'no_description',
  LONG_DESC: 'description_too_long',
  NO_IMAGE: 'no_image',
  BAD_VAT: 'bad_vat',
  BAD_STOCK: 'bad_stock',
  BLOCKED_WORD: 'blocked_words',
  REJECTED: 'rejected_by_marketplace',
  MISSING_ATTR: 'missing_attributes',
  NO_BRAND: 'no_brand',
};

function parseImages(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (Array.isArray(arr) ? arr : []).map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
  } catch { return []; }
}

// Required attributes per Trendyol category, cached because the category tree rarely changes.
const ATTR_TTL_MS = 6 * 60 * 60 * 1000;
const attrCache = new Map(); // `${connectionId}:${categoryId}` -> { at, required: [{id,name}] | null }

async function loadRequiredAttributes(connection, categoryIds) {
  const out = new Map();
  if (connection.marketplaceType !== 'trendyol' || categoryIds.length === 0) return out;
  const TrendyolService = require('./trendyol/trendyolService');
  let service;
  try { service = new TrendyolService(connection); } catch { return out; }

  const todo = [];
  for (const id of categoryIds) {
    const hit = attrCache.get(`${connection.id}:${id}`);
    if (hit && Date.now() - hit.at < ATTR_TTL_MS) { if (hit.required) out.set(id, hit.required); }
    else todo.push(id);
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  for (let i = 0; i < todo.length; i += 5) {
    await Promise.all(todo.slice(i, i + 5).map(async (id) => {
      try {
        const data = await withTimeout(service.getCategoryAttributes(id), 8000);
        const list = data?.categoryAttributes || data?.attributes || [];
        const required = list
          .filter((a) => a && a.required === true)
          .map((a) => ({ id: String(a.attribute?.id ?? a.id), name: a.attribute?.name ?? a.name ?? String(a.id) }));
        attrCache.set(`${connection.id}:${id}`, { at: Date.now(), required });
        out.set(id, required);
      } catch {
        // Trendyol unreachable / slow: do not block products because of that; remember briefly so we do not retry on every request
        attrCache.set(`${connection.id}:${id}`, { at: Date.now() - ATTR_TTL_MS + 5 * 60 * 1000, required: null });
      }
    }));
  }
  return out;
}

/** Lookup structure over the mappings of one XML source. */
class MappingIndex {
  constructor(catMap) {
    this.exact = catMap;
    this.norm = new Map();  // normalised key -> mapping
    this.leaf = new Map();  // last level of path-style keys ("Kadın|Bayan Bileklik|" -> "bayan bileklik") -> mapping
    for (const [key, m] of Object.entries(catMap)) {
      const nk = key.trim().toLowerCase();
      if (!this.norm.has(nk)) this.norm.set(nk, m);
      if (key.includes('|')) {
        const leaf = key.split('|').map((x) => x.trim()).filter(Boolean).pop();
        if (leaf && !this.leaf.has(leaf.toLowerCase())) this.leaf.set(leaf.toLowerCase(), m);
      }
    }
  }

  find(category) {
    if (this.exact[category]) return this.exact[category];
    const norm = category.trim().toLowerCase();
    if (this.norm.has(norm)) return this.norm.get(norm);
    if (category.includes('|')) {
      for (const part of category.split('|').map((x) => x.trim()).filter(Boolean)) {
        if (this.exact[part]) return this.exact[part];
        const hit = this.norm.get(part.toLowerCase());
        if (hit) return hit;
      }
    }
    return this.leaf.get(norm) || null;
  }
}

class ReadinessContext {
  constructor({ indexes, globalCatMap, priceCtx, ruleSet, dupBarcodes, dupWinner, mpByProduct, requiredAttrs, brandCfg }) {
    this.indexes = indexes; // xmlSourceId ('' = legacy, shared) -> MappingIndex
    this.globalCatMap = globalCatMap;
    this.priceCtx = priceCtx;
    this.ruleSet = ruleSet;
    this.dupBarcodes = dupBarcodes;
    this.dupWinner = dupWinner;
    this.requiredAttrs = requiredAttrs;
    this.brandCfg = brandCfg;
    this.mpByProduct = mpByProduct;
  }

  /**
   * Category mapping lookup. A mapping belongs to the XML source it was made for; tries, in order:
   *  1. the product's own XML source (exact key, case-insensitive key, path parts, last level of a path key)
   *  2. the global-provider mapping of that source
   *  3. legacy mappings that were created before mappings were tied to a source
   */
  resolveMapping(category, xmlSourceId) {
    if (!category) return null;
    const own = xmlSourceId ? this.indexes.get(xmlSourceId) : null;
    if (own) { const hit = own.find(category); if (hit) return hit; }

    const g = xmlSourceId ? this.globalCatMap[xmlSourceId] : null;
    if (g) {
      if (g[category]) return g[category];
      if (category.includes('|')) {
        for (const part of category.split('|').map((x) => x.trim()).filter(Boolean)) if (g[part]) return g[part];
      }
    }
    const legacy = this.indexes.get('');
    return legacy ? legacy.find(category) : null;
  }

  /** Returns { ready, issues:[{code,message}], salePrice, priceRule, mapping } */
  evaluate(p) {
    const issues = [];
    const add = (code, message) => issues.push({ code, message });

    const mapping = this.resolveMapping(p.category, p.xmlSourceId);
    if (!mapping) add(ISSUE.NO_CATEGORY, `Kategori eşleştirmesi yok (${p.category || 'kategori boş'})`);

    const bc = (p.barcode || '').trim();
    if (!bc) add(ISSUE.BAD_BARCODE, 'Barkod eksik');
    else if (/[{}\s]/.test(bc) || bc.length < LIMITS.BARCODE_MIN) add(ISSUE.BAD_BARCODE, `Barkod geçersiz (${bc})`);
    else if (bc.length > LIMITS.BARCODE_MAX) add(ISSUE.BAD_BARCODE, `Barkod ${LIMITS.BARCODE_MAX} karakterden uzun`);
    else if (this.dupBarcodes.has(bc) && this.dupWinner.get(bc) !== p.id) {
      add(ISSUE.DUP_BARCODE, 'Aynı barkod başka bir üründe de var; stokta olan / daha ucuz olan ürün gönderilir, bu ürün atlanır');
    }

    const priced = this.priceCtx.priceFor(p);
    let salePrice = null;
    if (!priced) {
      add(ISSUE.NO_PRICE_RULE, 'Bu ürüne uyan fiyatlandırma kuralı yok');
    } else if (!(priced.price > 0)) {
      add(ISSUE.BAD_PRICE, 'Hesaplanan satış fiyatı geçersiz');
    } else {
      salePrice = priced.price;
      const purchase = p.xmlPrice || p.price || 0;
      if (purchase > 0 && salePrice < purchase) add(ISSUE.BELOW_COST, `Satış fiyatı (₺${salePrice}) alış fiyatının (₺${purchase}) altında`);
    }

    const title = (p.title || '').trim();
    if (title.length < 2) add(ISSUE.NO_TITLE, 'Başlık boş');
    else if (title.length > LIMITS.TITLE_MAX) add(ISSUE.LONG_TITLE, `Başlık ${LIMITS.TITLE_MAX} karakteri aşıyor (${title.length})`);

    const desc = (p.description || '').trim();
    if (!desc) add(ISSUE.NO_DESC, 'Açıklama boş');
    else if (desc.length > LIMITS.DESCRIPTION_MAX) add(ISSUE.LONG_DESC, `Açıklama ${LIMITS.DESCRIPTION_MAX} karakteri aşıyor`);

    const images = parseImages(p.images).filter((u) => /^https?:\/\//i.test(u));
    if (images.length === 0) add(ISSUE.NO_IMAGE, 'Geçerli ürün görseli yok');

    if (p.vatRate !== null && p.vatRate !== undefined && !LIMITS.VAT_RATES.includes(Number(p.vatRate))) {
      add(ISSUE.BAD_VAT, `KDV oranı geçersiz (%${p.vatRate}); izin verilenler: ${LIMITS.VAT_RATES.join(', ')}`);
    }
    if ((p.stock ?? 0) < 0) add(ISSUE.BAD_STOCK, 'Stok negatif');

    // Brand: the product's own brand, or the connection's default brand, must exist
    const { strategy, defaultBrandId } = this.brandCfg;
    const ownBrand = (p.brand || '').trim();
    if ((!ownBrand || strategy === 'override') && !defaultBrandId) {
      add(ISSUE.NO_BRAND, strategy === 'override' ? 'Marka stratejisi "varsayılan marka" ama varsayılan marka seçilmemiş' : 'Üründe marka yok ve bağlantıda varsayılan marka tanımlı değil');
    }

    // Required Trendyol attributes of the mapped category must have a value in the mapping
    if (mapping) {
      const required = this.requiredAttrs.get(String(mapping.marketplaceCategoryId));
      if (required && required.length) {
        if (mapping._attrs === undefined) {
          try { mapping._attrs = mapping.attributes ? JSON.parse(mapping.attributes) : {}; } catch { mapping._attrs = {}; }
        }
        const missing = required.filter((r) => {
          const v = mapping._attrs[r.id];
          return !v || (!v.valueId && !(v.valueName && String(v.valueName).trim()));
        });
        if (missing.length) add(ISSUE.MISSING_ATTR, `Kategori eşleştirmesinde zorunlu özellik eksik: ${missing.map((m) => m.name).join(', ')}`);
      }
    }

    const blocked = this.ruleSet.findBlocked({ title: p.title, description: p.description });
    if (blocked.length) add(ISSUE.BLOCKED_WORD, `Yasaklı kelime: ${blocked.join(', ')}`);

    // A product the marketplace already rejected is not re-sent until it has changed
    const mp = this.mpByProduct.get(p.id);
    if (mp && mp.status === 'rejected' && p.updatedAt && mp.updatedAt && new Date(p.updatedAt) <= new Date(mp.updatedAt)) {
      add(ISSUE.REJECTED, `Pazaryeri reddetti${mp.errorMessage ? `: ${String(mp.errorMessage).slice(0, 200)}` : ''} — ürünü düzeltmeden tekrar gönderilmez`);
    }

    return {
      ready: issues.length === 0,
      issues,
      salePrice,
      priceRule: priced ? { id: priced.ruleId, name: priced.ruleName } : null,
      mapping,
    };
  }
}

/**
 * Loads everything needed to evaluate products for one connection.
 * `xmlSourceIds` limits the global-provider category lookup to the sources involved.
 */
async function buildReadinessContext(connection, { xmlSourceIds = null } = {}) {
  const storeId = connection.storeId;

  const [catMappings, priceCtx, ruleSet, dupRows, mps] = await Promise.all([
    prisma.categoryMapping.findMany({ where: { connectionId: connection.id } }),
    loadPricingContext(storeId, connection.id),
    loadContentRules(storeId),
    prisma.product.groupBy({ by: ['barcode'], where: { storeId, barcode: { not: null } }, _count: { _all: true }, having: { barcode: { _count: { gt: 1 } } } }),
    prisma.marketplaceProduct.findMany({
      where: { connectionId: connection.id },
      select: { productId: true, status: true, errorMessage: true, updatedAt: true },
    }),
  ]);

  const maps = new Map();
  for (const m of catMappings) {
    const k = m.xmlSourceId || '';
    if (!maps.has(k)) maps.set(k, {});
    maps.get(k)[m.localCategory] = m;
  }
  const indexes = new Map([...maps].map(([k, v]) => [k, new MappingIndex(v)]));

  // Global provider category mappings as fallback
  const globalCatMap = {};
  const sources = await prisma.xmlSource.findMany({
    where: { storeId, globalProviderId: { not: null }, ...(xmlSourceIds ? { id: { in: xmlSourceIds } } : {}) },
    select: { id: true, globalProviderId: true },
  });
  if (sources.length) {
    const providers = await prisma.globalXmlProvider.findMany({
      where: { id: { in: [...new Set(sources.map((s) => s.globalProviderId))] } },
      select: { id: true, categoryMappingConfig: true },
    });
    const cfgByProvider = Object.fromEntries(providers.map((p) => [p.id, p.categoryMappingConfig]));
    for (const s of sources) {
      const cfg = cfgByProvider[s.globalProviderId];
      if (cfg) { try { globalCatMap[s.id] = JSON.parse(cfg); } catch { /* ignore bad config */ } }
    }
  }

  // Same barcode on several products: exactly one is allowed through – in stock first, then cheapest, then oldest.
  const dupBarcodes = new Set(dupRows.map((r) => r.barcode));
  const dupWinner = new Map();
  if (dupBarcodes.size) {
    const rows = await prisma.product.findMany({
      where: { storeId, barcode: { in: [...dupBarcodes] } },
      select: { id: true, barcode: true, xmlPrice: true, stock: true, createdAt: true },
    });
    const rank = (r) => [(r.stock ?? 0) > 0 ? 0 : 1, r.xmlPrice > 0 ? r.xmlPrice : Infinity, new Date(r.createdAt).getTime(), r.id];
    for (const r of rows) {
      const cur = dupWinner.get(r.barcode);
      if (!cur) { dupWinner.set(r.barcode, r); continue; }
      const a = rank(r), b = rank(cur);
      for (let i = 0; i < a.length; i++) { if (a[i] === b[i]) continue; if (a[i] < b[i]) dupWinner.set(r.barcode, r); break; }
    }
    for (const [k, v] of dupWinner) dupWinner.set(k, v.id);
  }

  let cfg = {};
  try { cfg = connection.config ? JSON.parse(connection.config) : {}; } catch { cfg = {}; }
  const brandCfg = { strategy: cfg.brandStrategy || 'xml', defaultBrandId: cfg.defaultBrandId || null };

  const mappedCategoryIds = [...new Set(catMappings.map((m) => String(m.marketplaceCategoryId)))].slice(0, 80);
  const requiredAttrs = await loadRequiredAttributes(connection, mappedCategoryIds);

  return new ReadinessContext({
    indexes,
    globalCatMap,
    priceCtx,
    ruleSet,
    dupBarcodes,
    dupWinner,
    mpByProduct: new Map(mps.map((m) => [m.productId, m])),
    requiredAttrs,
    brandCfg,
  });
}

module.exports = { buildReadinessContext, ReadinessContext, MappingIndex, ISSUE, LIMITS, parseImages };
