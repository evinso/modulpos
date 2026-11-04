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
};

function parseImages(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (Array.isArray(arr) ? arr : []).map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
  } catch { return []; }
}

class ReadinessContext {
  constructor({ catMap, globalCatMap, priceCtx, ruleSet, dupBarcodes, mpByProduct }) {
    this.catMap = catMap;
    this.globalCatMap = globalCatMap;
    this.priceCtx = priceCtx;
    this.ruleSet = ruleSet;
    this.dupBarcodes = dupBarcodes;
    this.mpByProduct = mpByProduct;
  }

  /**
   * Category mapping lookup. Tries, in order:
   *  1. exact key (and the global-provider fallback)
   *  2. case/space-insensitive key
   *  3. product category is a path ("Kadın|Kolye|") -> each of its parts
   *  4. mapping key is a path ("Kadın|Bayan Bileklik|") and the product category is its last level ("Bayan Bileklik")
   */
  resolveMapping(category, xmlSourceId) {
    if (!category) return null;
    const { catMap, globalCatMap } = this;
    if (catMap[category]) return catMap[category];
    if (xmlSourceId && globalCatMap[xmlSourceId]?.[category]) return globalCatMap[xmlSourceId][category];

    if (!this._norm) {
      this._norm = new Map();   // normalised key -> mapping
      this._leaf = new Map();   // last level of path-style keys -> mapping
      for (const [key, m] of Object.entries(catMap)) {
        const nk = key.trim().toLowerCase();
        if (!this._norm.has(nk)) this._norm.set(nk, m);
        if (key.includes('|')) {
          const leaf = key.split('|').map((x) => x.trim()).filter(Boolean).pop();
          if (leaf && !this._leaf.has(leaf.toLowerCase())) this._leaf.set(leaf.toLowerCase(), m);
        }
      }
    }
    const norm = category.trim().toLowerCase();
    if (this._norm.has(norm)) return this._norm.get(norm);

    if (category.includes('|')) {
      for (const part of category.split('|').map((x) => x.trim()).filter(Boolean)) {
        if (catMap[part]) return catMap[part];
        if (xmlSourceId && globalCatMap[xmlSourceId]?.[part]) return globalCatMap[xmlSourceId][part];
        const hit = this._norm.get(part.toLowerCase());
        if (hit) return hit;
      }
    }
    return this._leaf.get(norm) || null;
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
    else if (this.dupBarcodes.has(bc)) add(ISSUE.DUP_BARCODE, 'Aynı barkod başka bir üründe de var');

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

  const catMap = {};
  for (const m of catMappings) catMap[m.localCategory] = m;

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

  return new ReadinessContext({
    catMap,
    globalCatMap,
    priceCtx,
    ruleSet,
    dupBarcodes: new Set(dupRows.map((r) => r.barcode)),
    mpByProduct: new Map(mps.map((m) => [m.productId, m])),
  });
}

module.exports = { buildReadinessContext, ReadinessContext, ISSUE, LIMITS, parseImages };
