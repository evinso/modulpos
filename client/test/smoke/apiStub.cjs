// Canned API responses with the same shapes the real server returns (verified by test/e2e/products-page.e2e.js)
const IMG = JSON.stringify(['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg']);
const mk = (i, over = {}) => ({
  id: 'p' + i, sku: 'SKU-' + i, barcode: '869000000000' + i, title: 'Test ürünü ' + i, price: 100 + i, xmlPrice: 100 + i, stock: [0, 3, 40][i % 3],
  brand: i % 2 ? 'ModaX' : null, category: 'Giyim|Kadın|Elbise', images: IMG, status: i === 4 ? 'passive' : 'active', vatRate: 20, hasDescription: true, xmlSourceId: 's1',
  xmlSource: { name: 'Tedarikçi A', globalProviderId: null },
  marketplaceProducts: i === 1 ? [{ id: 'm1', connectionId: 'c1', status: 'active', connection: { marketplaceType: 'trendyol', supplierName: 'Mağazam' } }] : [],
  pricing: i === 2 ? { salePrice: null, rule: null, profit: null, ready: false, issues: [{ code: 'no_price_rule', message: 'x' }], mapName: null }
    : { salePrice: 250.9 + i, rule: 'genel', profit: 50 + i, ready: i % 2 === 1, issues: i % 2 ? [] : [{ code: 'no_category_mapping', message: 'Kategori eşleştirmesi yok' }], mapName: 'Aksesuar > Elbise' },
  ...over,
});
const calls = [];
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
  if (url === '/xml-sources') return { data: [{ id: 's1', name: 'Tedarikçi A' }] };
  if (url === '/marketplace/connections') return { data: [{ id: 'c1', marketplaceType: 'trendyol', supplierName: 'Mağazam' }] };
  if (url === '/products/summary') return { data: { total: 8, active: 7, passive: 1, outOfStock: 3, lowStock: 2, noImage: 1, noBarcode: 0, lowStockMax: 5 } };
  if (url === '/products/facets') return { data: { categories: [{ name: 'Giyim|Kadın|Elbise', count: 8 }], brands: [{ name: 'ModaX', count: 4 }] } };
  if (url === '/products/stats') return { data: { total: 8, mpStatus: { active: 1, pending: 0, rejected: 0, passive: 0, not_sent: 7 } } };
  if (url === '/products') { const rows = [0, 1, 2, 3, 4].map((i) => mk(i)); return { data: { products: rows, pagination: { total: 8, page: cfg.params?.page || 1, limit: cfg.params?.limit || 20, totalPages: 1 } } }; }
  if (url === '/products/ids') return { data: { ids: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], total: 8 } };
  if (/^\/products\/[^/]+\/detail$/.test(url)) return { data: detail };
  if (/^\/products\/[^/]+$/.test(url)) return { data: { ...mk(1), description: 'Tam açıklama' } };
  if (url === '/pricing') return { data: [] };
  if (url === '/pricing/summaries') return { data: { total: 0, rules: {} } };
  throw new Error('unmocked GET ' + url);
};
const post = async (url, body) => {
  calls.push({ m: 'POST', url, body });
  if (url === '/pricing/calculate') return { data: { price: 314, purchase: 100, fixedCosts: 84, cost: 184, commissionAmount: 47.1, profit: 30, profitPct: 30, vatAmount: 52.33, marginOnPricePct: 9.55, shippingTier: body.conditions.shippingTiers && body.conditions.shippingTiers.length ? 2 : null, shippingCost: 84, profitTier: null } };
  if (url === '/pricing/coverage') return { data: { total: 4098, covered: 4098, priced: 4098, unpriced: 0, losing: 2, totalProfit: 285400.5, avgProfit: 69.6, avgPrice: 250, avgPurchase: 100, minProfit: -3, maxProfit: 210, marginOnPricePct: 14.2,
    bands: [
      { from: 0, to: 60, count: 410, avgPurchase: 40, avgPrice: 112, avgProfit: 14, marginOnPricePct: 12, shippingTier: 1, mixedTiers: false, losing: 0 },
      { from: 60, to: 100, count: 1835, avgPurchase: 80, avgPrice: 205, avgProfit: 31, marginOnPricePct: 15, shippingTier: 2, mixedTiers: true, losing: 2 },
      { from: 100, to: null, count: 1853, avgPurchase: 150, avgPrice: 540, avgProfit: 96, marginOnPricePct: 18, shippingTier: 3, mixedTiers: false, losing: 0 },
    ],
    losingSamples: [{ id: 'x1', title: 'Zarar eden ürün', purchase: 90, price: 150, profit: -3 }] } };
  return { data: { message: 'ok', updated: 0, errors: [] } }; };
const put = async (url, body) => { calls.push({ m: 'PUT', url, body }); return { data: {} }; };
const del = async (url) => { calls.push({ m: 'DELETE', url }); return { data: {} }; };
module.exports = { get, post, put, delete: del, calls };
module.exports.default = module.exports;
