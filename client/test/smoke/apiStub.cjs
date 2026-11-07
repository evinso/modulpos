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
  if (url === '/xml-sources') return { data: [{ id: 's1', name: 'Tedarikçi A', totalProducts: 8 }] };
  if (url === '/marketplace/connections/c1/category-mappings') return { data: [{ id: 'cm1', xmlSourceId: 's1', localCategory: 'Giyim' }, { id: 'cm2', xmlSourceId: 's1', localCategory: 'Aksesuar' }] };
  if (/^\/products\/[^/]+\/price-preview$/.test(url)) { const price = Number(cfg.params.price); return { data: { salePrice: price, templatePrice: 251.9, hasTemplate: true, ruleName: 'genel', purchase: 101, profit: Math.round((price * 0.5 - 120) * 100) / 100, profitPct: 30, marginOnPricePct: 12, commissionAmount: 20, fixedCosts: 10, vatAmount: 40, loss: price < 120 } }; }
  if (url === '/marketplace/connections') return { data: [{ id: 'c1', marketplaceType: 'trendyol', supplierName: 'Mağazam' }] };
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
  if (url === '/whatsapp/events') return { data: [{ group: 'Destek', key: 'support_status', to: 'both', label: 'Destek talebinin durumu değişti' }, { group: 'XML ve ürün', key: 'product_sync', to: 'both', label: 'XML güncellendi' }] };
  if (url === '/whatsapp/engine') return { data: { engine: wa.engine, node: 'v22.0.0' } };
  if (url === '/whatsapp/connections') return { data: [{ id: 'w1', name: 'wp', instanceId: 'default' }] };
  if (url === '/whatsapp/connections/w1/status') return { data: wa.status };
  if (url === '/whatsapp/connections/w1/qr') { wa.qrCalls++; return { data: typeof wa.qr === 'function' ? wa.qr(wa.qrCalls) : wa.qr }; }
  if (url.startsWith('/admin/system-settings')) return { data: { waha_enabled: 'false', waha_session: 'default', waha_admin_phone: '905551112233', waha_events: '["new_order"]', waha_otp_enabled: 'false' } };
  throw new Error('unmocked GET ' + url);
};
const post = async (url, body) => {
  calls.push({ m: 'POST', url, body });
  if (/sync-price-stock$/.test(url)) return { data: { message: '1 ürün pazaryerlerinde güncellendi', count: 1 } };
  if (/send-products$/.test(url)) return { data: { message: '1 ürün Trendyol’a gönderildi', sent: 1 } };
  if (url === '/products/reset-manual-prices') return { data: { ok: true, removed: body.productIds ? body.productIds.length : 1, skippedNoTemplate: 0, productIds: body.productIds || ['p3'], activeProductIds: ['p1'] } };
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
  if (/\/sale-price$/.test(url)) {
    if (body.price < 120 && body.confirmLoss !== true) { const e = new Error('409'); e.response = { status: 409, data: { error: 'Bu fiyatta zarar edersiniz', loss: true } }; throw e; }
    return { data: { ok: true, pricing: { salePrice: body.price, manual: true } } };
  }
  if (/send-settings$/.test(url)) return { data: { settings: body.settings, summary: [] } }; return { data: {} }; };
const del = async (url, cfg) => { calls.push({ m: 'DELETE', url, params: cfg && cfg.params }); return { data: /sale-price$/.test(url) ? { ok: true, removed: 1 } : {} }; };
module.exports = { get, post, put, delete: del, calls, wa };
module.exports.default = module.exports;
