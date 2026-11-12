// Canned API responses with the same shapes the real server returns (verified by test/e2e/products-page.e2e.js)
const IMG = JSON.stringify(['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg']);
const mk = (i, over = {}) => ({
  id: 'p' + i, sku: 'SKU-' + i, barcode: '869000000000' + i, title: 'Test ürünü ' + i, price: 100 + i, xmlPrice: 100 + i, stock: [0, 3, 40][i % 3],
  brand: i % 2 ? 'ModaX' : null, category: 'Giyim|Kadın|Elbise', images: IMG, status: i === 4 ? 'passive' : 'active', vatRate: 20, hasDescription: true, xmlSourceId: 's1',
  xmlSource: { name: 'Tedarikçi A', globalProviderId: null },
  marketplaceProducts: i === 1 ? [{ id: 'm1', connectionId: 'c1', status: 'active', marketplacePrice: 240, connection: { marketplaceType: 'trendyol', supplierName: 'Mağazam' } }] : [],
  pricing: i === 2 ? { salePrice: null, rule: null, profit: null, ready: false, issues: [{ code: 'no_price_rule', message: 'x' }], mapName: null }
    : { salePrice: 250.9 + i, rule: i === 3 ? 'Elle girilen fiyat' : 'genel', manual: i === 3, loss: i === 3, templatePrice: i === 3 ? 300 : null, profit: i === 3 ? -8 : 50 + i, ready: i % 2 === 1, issues: i % 2 ? [] : [{ code: 'no_category_mapping', message: 'Kategori eşleştirmesi yok' }], mapName: 'Aksesuar > Elbise' },
  ...over,
});
const calls = [];
const sendBehaviour = { failAt150: false, allBelowStock: false };
const pc = { aiError: null, aiMatched: 2 };
const conv = { feeds: {}, previewFeed: null };   // XML converter page: what /xml-converter/feeds/status answers per address, and the feed row a new conversion returns
const profitTax = { on: false };   // orders profit: the earlier method (false) or the tax model (true)
// WhatsApp page: tests change `wa.status` / `wa.qr` (a value, or a function of the call number) to play different WAHA situations
const wa = { engine: 'waha', status: { stateInstance: 'notAuthorized' }, qr: { type: 'loading', message: '' }, qrCalls: 0 };
const detail = {
  product: { ...mk(1), description: 'Uzun bir açıklama metni '.repeat(20), images: ['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'], createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z', xmlSource: { id: 's1', name: 'Tedarikçi A', globalProviderId: null, purchaseVatRate: 20, lastSyncedAt: '2026-11-04T10:00:00Z' } },
  feed: { sku: 'SKU-1', barcode: '8690000000001', title: 'Test ürünü 1 (XML)', price: 90, stock: 3, brand: 'ModaX', category: 'Giyim|Kadın|Elbise', images: ['a', 'b'] },
  feedHidden: false,
  marketplaces: [{
    connectionId: 'c1', type: 'trendyol', name: 'Mağazam', ready: false, issues: [{ code: 'no_category_mapping', message: 'Kategori eşleştirmesi yok (Giyim)' }], categoryMapping: null,
    pricing: { salePrice: 251.9, rule: 'genel', kind: 'template', vatRate: 20, breakdown: { price: 251.9, purchase: 101, fixedCosts: 10, cost: 111, commissionAmount: 25.19, profit: 30.3, profitPct: 30, vatAmount: 41.98 } },
    listing: { status: 'active', marketplacePrice: 240, marketplaceStock: 3, lastSyncedAt: '2026-11-04T10:00:00Z', errorMessage: null },
  }],
  logs: [{ id: 'l1', type: 'synced', oldPrice: 90, newPrice: 101, oldStock: 5, newStock: 3, createdAt: '2026-11-03T10:00:00Z', notes: 'fiyat güncellendi' }, { id: 'l0', type: 'created', newPrice: 90, newStock: 5, createdAt: '2026-11-01T10:00:00Z' }],
};
const get = async (url, cfg = {}) => {
  calls.push({ m: 'GET', url, params: cfg.params });
  if (url === '/xml-sources') return { data: [{ id: 's1', name: 'Tedarikçi A', totalProducts: 8, status: 'active', url: 'https://example.invalid/a.xml', syncIntervalMin: 60, mappingConfig: '{"title":"t"}', _count: { products: 8 } }] };
  if (url === '/marketplace/connections/c1/category-mappings') return { data: [{ id: 'cm1', xmlSourceId: 's1', localCategory: 'Giyim' }, { id: 'cm2', xmlSourceId: 's1', localCategory: 'Aksesuar' }] };
  if (/^\/products\/[^/]+\/price-preview$/.test(url)) { const price = Number(cfg.params.price); return { data: { salePrice: price, templatePrice: 251.9, hasTemplate: true, ruleName: 'genel', purchase: 101, profit: Math.round((price * 0.5 - 120) * 100) / 100, profitPct: 30, marginOnPricePct: 12, commissionAmount: 20, fixedCosts: 10, vatAmount: 40, loss: price < 120 } }; }
  if (url === '/marketplace/connections') return { data: [{ id: 'c1', marketplaceType: 'trendyol', status: 'active', supplierName: 'Mağazam', config: JSON.stringify({ buyboxAutoAdjust: true, buyboxAutoMode: 'undercut', buyboxAutoAmount: 2 }) }] };
  if (url === '/products/summary' && cfg.params && cfg.params.xmlSourceId === 'none') return { data: { total: 0 } };
  if (url === '/products/summary') return { data: { total: 8, active: 7, passive: 1, outOfStock: 3, lowStock: 2, noImage: 1, noBarcode: 0, lowStockMax: 5 } };
  if (url === '/products/facets') return { data: { categories: [{ name: 'Giyim|Kadın|Elbise', count: 8 }], brands: [{ name: 'ModaX', count: 4 }] } };
  if (url === '/products/stats') return { data: { total: 8, manual: 1, mpStatus: { active: 1, pending: 0, rejected: 0, passive: 0, not_sent: 7 } } };
  if (url === '/products') { const rows = [0, 1, 2, 3, 4].map((i) => mk(i)); return { data: { products: rows, pagination: { total: 8, page: cfg.params?.page || 1, limit: cfg.params?.limit || 20, totalPages: 1 } } }; }
  if (url === '/products/ids') return { data: { ids: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], total: 8 } };
  if (/^\/products\/[^/]+\/detail$/.test(url)) return { data: detail };
  if (/^\/products\/[^/]+$/.test(url)) return { data: { ...mk(1), description: 'Tam açıklama' } };
  if (url === '/marketplace/connections/c1/send-settings') return { data: { settings: { minStock: 0, maxStock: null, requireImage: false, titlePrefix: '', titleSuffix: '', titleCase: 'none', maxImages: null, removeWords: ['Çeyrek', 'Reşat'] }, summary: ['2 kelime çıkarılır'] } };
  if (url === '/pricing') return { data: [
    { id: 'r1', name: 'Genel fiyat', value: 30, type: 'percentage', applyTo: 'price_template', isActive: true, priority: 0, conditions: JSON.stringify({ connectionId: null, xmlSourceIds: [], shippingCost: 60, packagingCost: 10, commissionPct: 23, commissionBasis: 'gross', profitMode: 'fixed', roundingMode: 'ending', roundingEnding: 0.9, profitTiers: [] }) },
    { id: 'r2', name: 'Eski taslak', value: 10, type: 'percentage', applyTo: 'price_template', isActive: false, priority: 0, conditions: JSON.stringify({ shippingTiers: [{ upTo: 199.99, cost: 48.33 }, { upTo: null, cost: 88.96 }], shippingTiersExVat: true, profitMode: 'margin_on_gross', commissionPct: 22.37, packagingCost: 16.39, commissionBasis: 'gross', minPurchasePrice: 10, maxPurchasePrice: 500 }) },
  ] };
  if (url === '/pricing/summaries') return { data: { total: 0, rules: {} } };
  if (url === '/marketplace/connections/c1/buybox-auto-log') return { data: [
    { id: 'l1', kind: 'auto', status: 'ok', createdAt: '2026-11-09T19:00:00Z', note: 'Otomatik fiyat: 2 ürünün fiyatı düşürüldü (BuyBox fiyatına eşit). 1 ürün zarara düşeceği için atlandı. 0,2 kredi kullanıldı.', updated: 2, skippedNotLower: 0, skippedLoss: 1, skippedOther: 0, items: [{ barcode: 'bx1', title: 'Gümüş Yüzük', oldPrice: 120, newPrice: 110.5 }, { barcode: 'bx2', title: 'Çelik Kolye', oldPrice: 99, newPrice: 95 }] },
    { id: 'l2', kind: 'settings', status: 'info', createdAt: '2026-11-09T18:00:00Z', note: 'Otomatik fiyat ayarı açıldı: BuyBox fiyatına eşit.', updated: 0, skippedNotLower: 0, skippedLoss: 0, skippedOther: 0, items: [] },
    { id: 'l3', kind: 'auto', status: 'error', createdAt: '2026-11-08T10:00:00Z', note: 'Otomatik fiyat: fiyatlar güncellenemedi. Yetersiz kredi.', updated: 0, skippedNotLower: 0, skippedLoss: 0, skippedOther: 0, items: [] },
  ] };
  if (url === '/marketplace/connections/c1/product-list') {
    const total = 250; const page = cfg.params?.page || 1;
    return { data: { products: Array.from({ length: 20 }, (_, i) => ({ ...mk((page - 1) * 20 + i + 10), ready: true, issues: [], salePrice: 150, mapName: 'Aksesuar', marketplaceProducts: [] })), pagination: { total, page, limit: 20, totalPages: 13 }, stats: { total, ready: 250, blocked: 0, byIssue: {}, mp: { not_sent: 250, pending: 0, active: 0, rejected: 0, passive: 0 } } } };
  }
  if (url === '/marketplace/connections/c1/product-list/ids') return { data: { ids: Array.from({ length: 250 }, (_, i) => 'id' + i), sendable: 250, matching: 250, truncated: false } };
  if (url === '/orders') return { data: { orders: [], pagination: { total: 0, page: 1, totalPages: 1 } } };
  if (url === '/orders/profit') {
    const L = (o) => ({ name: 'Gümüş Kolye', barcode: 'bc1', sku: 'bc1', qty: 1, gross: 200, sellerDisc: 0, tyDisc: 0, revenue: 200, paid: 200, vatRate: 20, commissionRate: 21, unitCost: 60, costSource: 'manual', ...o });
    const base = { gross: 200, sellerDiscount: 0, tyDiscount: 0, discounted: 200, customerPaid: 200, vat: 33.33, netRevenue: 166.67, commissionRate: 21, serviceFee: 13.19, serviceFeeSource: 'estimate', excluded: false, mismatch: false };
    const out = { data: {
      rows: [
        { id: 'o1', orderNumber: 'TY-1', marketplaceOrderId: '1', orderDate: '2026-10-01T10:00:00Z', status: 'delivered', ...base, lines: [L({ unitOther: 30 })], commission: 42, commissionSource: 'trendyol', cargo: 103.49, cargoSource: 'trendyol', cost: 60, costMissing: false, otherCost: 30, profit: -82.01, profitPct: -49.2, exact: true },
        { id: 'o2', orderNumber: 'TY-2', marketplaceOrderId: '2', orderDate: '2026-11-08T10:00:00Z', status: 'shipped', ...base, gross: 938.1, sellerDiscount: 56.34, discounted: 881.76, customerPaid: 881.76, lines: [L({ barcode: 'bc2', name: 'Bluetooth Kulaklık', gross: 938.1, revenue: 881.76, unitCost: null, costSource: null })], commission: 141.08, commissionSource: 'estimate', cargo: 95.99, cargoSource: 'estimate', cost: null, costMissing: true, profit: null, profitPct: null, exact: false },
        { id: 'o3', orderNumber: 'TY-3', marketplaceOrderId: '3', orderDate: '2026-11-07T10:00:00Z', status: 'shipped', ...base, lines: [L({})], commission: 42, commissionSource: 'estimate', cargo: 95.99, cargoSource: 'estimate', cost: 60, costMissing: false, profit: -40.01, profitPct: -24, exact: false },
      ],
      summary: { otherCost: 30, orders: 3, excluded: 0, gross: 1338.1, discounted: 1281.76, customerPaid: 1281.76, commission: 225.08, serviceFee: 39.57, cargo: 295.47, cost: 120, vat: 100, profit: -92.02, profitOrders: 2, unknownProfit: 1, estimated: 2 },
      settings: { serviceFee: 13.19, cargoEstimate: 95.99, cargoEstimateSaved: null, cargoAverage: 95.99, serviceFeeDefault: 13.19, inputVat: false, purchaseVatRate: 20, withholdingPct: 0 },
      pagination: { total: 3, page: 1, limit: 25, totalPages: 1 },
    } };
    if (profitTax.on) {
      const d = out.data;
      d.settings = { ...d.settings, inputVat: true, withholdingPct: 1 };
      const vd = { sale: 33.33, purchase: 10, cargo: 17.25, commission: 7, serviceFee: 2.2, other: 5, total: -3.12 };
      d.rows[0] = { ...d.rows[0], taxModel: true, inputVat: true, stopaj: 1.67, payableVat: -3.12, vatDetail: vd, profit: -80.56 + 40, profitPct: -24.2 };
      d.rows[1] = { ...d.rows[1], taxModel: true, inputVat: true, stopaj: 7.35, payableVat: null, vatDetail: null };
      d.rows[2] = { ...d.rows[2], taxModel: true, inputVat: true, stopaj: 1.67, payableVat: -3.12, vatDetail: vd, profit: -12.4, profitPct: -7.4 };
      d.summary = { ...d.summary, taxModel: true, stopaj: 10.69, payableVat: -6.24, profit: -52.96 };
    }
    return out;
  }
  if (url === '/credits/balance') return { data: { balance: 25 } };
  if (url === '/credits/prices') return { data: { xmlConvertCost: 1, xmlImportDefaultCost: 5, buyboxCheckCost: 1, buyboxAdjustCost: 0.1, autoReplyCost: 1, categoryAiCost: 0.5, productCategoryAiCost: 0.05 } };
  if (url === '/public/pricing-plans') return { data: [{ id: 'pl1', name: 'Başlangıç', price: '₺299', period: '/ ay', yearlyPrice: '₺2.990', features: ['1.000 ürün', '2 XML kaynağı'], isHighlighted: true }, { id: 'pl2', name: 'Pro', price: '₺599', period: '/ ay', features: ['10.000 ürün'] }] };
  if (url === '/marketplace/connections/c1/buybox-history') {
    const row = (barcode, title, sku, order, bbp, our) => ({ barcode, title, sku, buyboxOrder: order, buyboxPrice: bbp, ourPrice: our, hasMultipleSeller: order > 1, checkedAt: '2026-11-08T10:00:00Z', productId: 'p' + barcode });
    return { data: [row('869001', 'Gümüş Kolye İnci', 'KLY-1', 1, 100, 100), row('869002', 'Altın Yüzük Taşlı', 'YZK-2', 2, 90, 100), row('869003', 'Çelik Bileklik', 'BLK-3', 3, 50, 80)] };
  }
  if (url === '/whatsapp/events') return { data: [{ group: 'Destek', key: 'support_status', to: 'both', label: 'Destek talebinin durumu değişti' }, { group: 'XML ve ürün', key: 'product_sync', to: 'both', label: 'XML güncellendi' }] };
  if (url === '/whatsapp/engine') return { data: { engine: wa.engine, node: 'v22.0.0' } };
  if (url === '/whatsapp/connections') return { data: [{ id: 'w1', name: 'wp', instanceId: 'default' }] };
  if (url === '/whatsapp/connections/w1/status') return { data: wa.status };
  if (url === '/whatsapp/connections/w1/qr') { wa.qrCalls++; return { data: typeof wa.qr === 'function' ? wa.qr(wa.qrCalls) : wa.qr }; }
  if (url.startsWith('/admin/system-settings')) return { data: { waha_enabled: 'false', waha_session: 'default', waha_admin_phone: '905551112233', waha_events: '["new_order"]', waha_otp_enabled: 'false' } };
  if (url === '/marketplace/local-categories') return { data: ['Giyim', 'Aksesuar', 'Ev ve Yaşam'] };
  if (url === '/marketplace/connections/c1/categories') return { data: { categories: [] } };
  if (url === '/credits/prices') return { data: { categoryAiCost: 0.5 } };
  if (url === '/marketplace/connections/c1/product-categories/overview') return { data: { total: 8, assigned: 1, mapped: 2, missing: 5, aiCostPerProduct: 0.05, categories: [{ category: 'Ev ve Yaşam', total: 6, missing: 4 }, { category: 'Oyuncak &amp; Kırtasiye', total: 2, missing: 1 }] } };
  if (url === '/marketplace/connections/c1/product-categories/products') {
    const sug = (id, name, path, coverage = 1) => ({ id, name, path, score: 20, coverage });
    return { data: { total: 3, page: 1, limit: 50, products: [
      { id: 'q1', title: 'Çelik Pense Seti 3 Parça', category: 'Ev ve Yaşam', stock: 5, current: null, suggestions: [sug('10', 'Pense', 'Hırdavat > Manuel El Aletleri > Pense'), sug('11', 'Çelik Set', 'Hırdavat > Set & Takım > Çelik Set', 0.5)] },
      { id: 'q2', title: 'Peluş Ayıcık', category: 'Oyuncak &amp; Kırtasiye', stock: 3, current: null, suggestions: [] },
      { id: 'q3', title: 'Seramik Kupa', category: 'Ev ve Yaşam', stock: 9, current: { categoryId: '30', name: 'Ev & Mobilya > Sofra > Kupa', productLevel: true, source: 'ai' }, suggestions: [] },
    ] } };
  }
  if (url === '/marketplace/connections/c1/product-categories/ids') return { data: { total: 3, ids: ['q1', 'q2', 'q3'], truncated: false } };
  if (url === '/marketplace/connections/c1/product-categories/search') return { data: [{ id: '10', name: 'Pense', path: 'Hırdavat > Manuel El Aletleri > Pense' }] };
  if (url === '/marketplace/connections/c1/product-categories/groups') return { data: [{ categoryId: '555', name: 'Ev & Mobilya > Mum > Mum Seti', count: 4, required: [{ id: '5', name: 'Renk' }], missing: [{ id: '5', name: 'Renk', triedDefaults: false, allowCustom: false, examples: ['Beyaz', 'Siyah'] }, { id: '9', name: 'Cinsiyet', triedDefaults: false, allowCustom: false, examples: ['Unisex', 'Erkek', 'Kadın / Kız'] }], attributes: {} }] };
  if (url === '/marketplace/connections/c1/product-categories/attribute-defaults') return { data: { saved: false, rules: [{ name: 'Menşei', value: 'TR' }, { name: 'Renk, Web Color', value: 'Çok Renkli' }], fallback: { enabled: true, value: 'Belirtilmemiş' } } };
  if (url === '/marketplace/connections/c1/categories/555/attributes') return { data: { categoryAttributes: [{ required: true, allowCustom: false, attribute: { id: 5, name: 'Renk' }, attributeValues: [{ id: 91, name: 'Beyaz' }, { id: 92, name: 'Siyah' }] }] } };
  throw new Error('unmocked GET ' + url);
};
const post = async (url, body) => {
  calls.push({ m: 'POST', url, body });
  if (url === '/xml-converter/feeds/status') { const feeds = {}; for (const u of body.urls) feeds[u] = conv.feeds[u] === undefined ? null : conv.feeds[u]; return { data: { feeds } }; }
  if (url === '/xml-converter/preview') return { data: { success: true, totalProducts: 4161, sample: [{ stok_kodu: 'A1', adi: 'Örnek ürün', fiyat: { son_kullanici: '10', bayi_fiyati: '8' }, miktar: '3', marka: 'M', kategori: 'K' }], feed: conv.previewFeed, convertedUrl: '/api/xml-converter/proxy?url=x&sig=y' } };
  if (url === '/orders/profit/refresh') return { data: { message: '5 siparişten 0 komisyon, 0 kargo bilgisi Trendyol\'dan alındı', pending: 5 } };
  if (/product-categories\/reset$/.test(url)) return { data: { removedProducts: 1, removedMappings: body.includeMappings ? 2 : 0 } };
  if (/product-categories\/apply-suggestions$/.test(url)) return { data: { applied: body.productIds.length - 1, skipped: 1 } };
  if (/product-categories\/ai-match$/.test(url)) {
    if (pc.aiError) { const e = new Error('x'); e.response = { status: 502, data: { error: pc.aiError, aiUnavailable: true, refunded: true } }; throw e; }
    return { data: { matched: Math.min(pc.aiMatched, body.productIds.length), unmatched: Math.max(0, body.productIds.length - pc.aiMatched), noCandidates: 0, charged: 0.1 } };
  }
  if (/send-products$/.test(url)) {
    if (sendBehaviour.allBelowStock) { const e = new Error('x'); e.response = { status: 400, data: { error: `Seçili ${body.productIds.length} ürünün stoğu minimum stok eşiğinin (${body.minStock}) altında olduğu için hiçbiri gönderilmedi`, belowMinStock: body.productIds.length } }; throw e; }
    if (body.productIds.includes('id150') && sendBehaviour.failAt150) { const e = new Error('x'); e.response = { status: 400, data: { error: 'Trendyol API hatası', message: 'Trendyol reddetti' } }; throw e; }
    return { data: { message: 'ok', sent: body.productIds.length, alreadyListed: 0, offSale: 0, errors: 0 } };
  }
  if (/buybox-check$/.test(url)) {
    const total = 450; const off = body.offset ?? 0; const n = body.offset === undefined ? (body.batchSize || total) : Math.max(0, Math.min(body.batchSize, total - off));
    return { data: { checked: n, totalEligible: total, winning: n - 1 > 0 ? n - 1 : 0, losing: n > 0 ? 1 : 0, creditUsed: Math.ceil(n / 10), autoAdjusted: 0, autoSkipped: null, autoError: null, results: Array.from({ length: n }, (_, i) => ({ barcode: 'b' + (off + i), buyboxOrder: i ? 1 : 2 })) } };
  }
  if (/sync-price-stock$/.test(url)) return { data: { message: '1 ürün pazaryerlerinde güncellendi', count: 1 } };
  if (/send-products$/.test(url)) return { data: { message: '1 ürün Trendyol’a gönderildi', sent: 1 } };
  if (url === '/products/reset-manual-prices') return { data: { ok: true, removed: body.productIds ? body.productIds.length : 1, skippedNoTemplate: 0, productIds: body.productIds || ['p3'], activeProductIds: ['p1'] } };
  if (url === '/pricing/calculate' && body.conditions && body.conditions.inputVat) return { data: { price: 586.9, purchase: 195, fixedCosts: 119.19, cost: 314.19, commissionAmount: 129.12, profit: 114.77, profitPct: 58.86, vatAmount: 97.82, marginOnPricePct: 19.56,
    taxModel: true, inputVat: true, serviceFee: 13.19, otherCost: 0, withholding: 4.89, payableVat: 23.93, vatDetail: { sale: 97.82, purchase: 32.5, shipping: 17.67, commission: 21.52, serviceFee: 2.2, other: 0, total: 23.93 }, shippingCost: 106, shippingTier: null, profitTier: null, profitValue: null } };
  if (url === '/pricing/calculate') return { data: { price: 314, purchase: 100, fixedCosts: 84, cost: 184, commissionAmount: 47.1, profit: 30, profitPct: 30, vatAmount: 52.33, marginOnPricePct: 9.55, shippingTier: body.conditions.shippingTiers && body.conditions.shippingTiers.length ? 2 : null, shippingCost: 84, profitTier: null } };
  if (url === '/pricing/coverage') return { data: { total: 4098, covered: 4098, priced: 4098, unpriced: 0, losing: 2, totalProfit: 285400.5, avgProfit: 69.6, avgPrice: 250, avgPurchase: 100, minProfit: -3, maxProfit: 210, marginOnPricePct: 14.2,
    bands: [
      { from: 0, to: 60, count: 410, avgPurchase: 40, avgPrice: 112, avgProfit: 14, marginOnPricePct: 12, shippingTier: 1, mixedTiers: false, losing: 0 },
      { from: 60, to: 100, count: 1835, avgPurchase: 80, avgPrice: 205, avgProfit: 31, marginOnPricePct: 15, shippingTier: 2, mixedTiers: true, losing: 2 },
      { from: 100, to: null, count: 1853, avgPurchase: 150, avgPrice: 540, avgProfit: 96, marginOnPricePct: 18, shippingTier: 3, mixedTiers: false, losing: 0 },
    ],
    losingSamples: [{ id: 'x1', title: 'Zarar eden ürün', purchase: 90, price: 150, profit: -3 }] } };
  return { data: { message: 'ok', updated: 0, errors: [] } }; };
const put = async (url, body) => {
  calls.push({ m: 'PUT', url, body });
  if (url === '/orders/profit/cost' || url === '/orders/profit/settings') return { data: { ok: true } };
  if (/product-categories\/attribute-defaults$/.test(url)) return { data: { saved: true, categories: 3, products: 12, pending: 0, unresolved: [{ name: 'Cinsiyet', categories: 2 }] } };
  if (/product-categories$/.test(url)) return { data: { saved: body.assignments.length, skipped: 0 } };
  if (/product-categories\/attributes$/.test(url)) return { data: { updated: 4 } };

  if (/\/sale-price$/.test(url)) {
    if (body.price < 120 && body.confirmLoss !== true) { const e = new Error('409'); e.response = { status: 409, data: { error: 'Bu fiyatta zarar edersiniz', loss: true } }; throw e; }
    return { data: { ok: true, pricing: { salePrice: body.price, manual: true } } };
  }
  if (/send-settings$/.test(url)) return { data: { settings: body.settings, summary: [] } }; return { data: {} }; };
const del = async (url, cfg) => { calls.push({ m: 'DELETE', url, params: cfg && cfg.params, body: cfg && cfg.data }); return { data: /sale-price$/.test(url) ? { ok: true, removed: 1 } : (/product-categories$/.test(url) ? { removed: (cfg.data.productIds || []).length } : {}) }; };
module.exports = { get, post, put, delete: del, calls, wa, sendBehaviour, pc, profitTax, conv };
module.exports.default = module.exports;
