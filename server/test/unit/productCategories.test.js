const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// readiness.js pulls in the database module; a stand-in keeps this test free of any connection
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub(path.join(__dirname, '../../src/config/database.js'), {});
const { buildOverrideMappings } = require('../../src/services/productCategories');
const { ReadinessContext, MappingIndex, ISSUE } = require('../../src/services/readiness');

const ov = (productId, cat, extra = {}) => ({ id: 'o-' + productId, productId, marketplaceCategoryId: cat, marketplaceCategoryName: 'Yol > ' + cat, attributes: null, source: 'manual', ...extra });
const attrs = (id, valueId) => JSON.stringify({ [id]: { name: 'Renk', valueId, valueName: '' } });

test('attribute values are reused: own > another product of the same category > a category mapping', () => {
  const m = buildOverrideMappings(
    [ov('a', '10'), ov('b', '10', { attributes: attrs(5, '77') }), ov('c', '20'), ov('d', '30')],
    [{ marketplaceCategoryId: 20, attributes: attrs(5, '88') }],
  );
  assert.equal(m.get('a').attributes, attrs(5, '77'), 'takes the values typed for product b (same category)');
  assert.equal(m.get('b').attributes, attrs(5, '77'));
  assert.equal(m.get('c').attributes, attrs(5, '88'), 'takes the category mapping of the same Trendyol category');
  assert.equal(m.get('d').attributes, null, 'nothing to reuse');
  assert.equal(m.get('a').productLevel, true);
  assert.equal(typeof m.get('a').marketplaceCategoryId, 'string');
});

test('empty attribute objects do not count as values', () => {
  const m = buildOverrideMappings([ov('a', '10'), ov('b', '10', { attributes: JSON.stringify({ 5: { name: 'Renk', valueId: '', valueName: ' ' } }) })], []);
  assert.equal(m.get('a').attributes, null);
});

function ctx({ overrides = [], mappings = {}, requiredAttrs = new Map(), catMappings = [] } = {}) {
  return new ReadinessContext({
    indexes: new Map([['src1', new MappingIndex(mappings)]]),
    globalCatMap: {},
    priceCtx: { priceFor: () => ({ price: 100, ruleId: 'r', ruleName: 'Kural' }) },
    dupBarcodes: new Set(), dupWinner: new Map(), mpByProduct: new Map(), requiredAttrs,
    brandCfg: { strategy: 'xml', defaultBrandId: '1' },
    productMappings: buildOverrideMappings(overrides, catMappings),
  });
}
const prod = (id, category = 'Ev ve Yaşam') => ({ id, xmlSourceId: 'src1', category, barcode: '869000000' + id, title: 'Ürün ' + id, description: 'Açıklama', images: JSON.stringify(['https://i/1.jpg']), brand: 'X', stock: 5, xmlPrice: 50, price: 50 });

test('a category chosen for the product wins over the mapping of its XML category', () => {
  const c = ctx({ overrides: [ov('1', '555')], mappings: { 'Ev ve Yaşam': { marketplaceCategoryId: 111, marketplaceCategoryName: 'Genel' } } });
  const a = c.evaluate(prod('1'));
  assert.equal(a.mapping.marketplaceCategoryId, '555');
  assert.equal(a.ready, true);
  const b = c.evaluate(prod('2'));                       // no own category: the XML category mapping still applies
  assert.equal(b.mapping.marketplaceCategoryId, 111);
});

test('without a mapping and without an own category the product is blocked as before', () => {
  const r = ctx().evaluate(prod('1'));
  assert.equal(r.ready, false);
  assert.ok(r.issues.some((i) => i.code === ISSUE.NO_CATEGORY));
});

test('a product with its own category needs no mapping of its XML category', () => {
  const r = ctx({ overrides: [ov('1', '555')] }).evaluate(prod('1', 'Hiçbir Eşleşmeyen Kategori'));
  assert.equal(r.ready, true);
  assert.equal(r.mapping.productLevel, true);
});

test('required Trendyol attributes of the chosen category are enforced; values reused from a mapping satisfy them', () => {
  const required = new Map([['555', [{ id: '5', name: 'Renk' }]]]);
  const blocked = ctx({ overrides: [ov('1', '555')], requiredAttrs: required }).evaluate(prod('1'));
  assert.ok(blocked.issues.some((i) => i.code === ISSUE.MISSING_ATTR && /Renk/.test(i.message)));
  const ok = ctx({ overrides: [ov('1', '555')], requiredAttrs: required, catMappings: [{ marketplaceCategoryId: 555, attributes: attrs(5, '9') }] }).evaluate(prod('1'));
  assert.equal(ok.ready, true);
});
