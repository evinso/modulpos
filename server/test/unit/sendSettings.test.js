const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/services/sendSettings');

const norm = S.normalizeSendSettings;
const P = (o = {}) => ({ stock: 10, category: 'Giyim|Kadın|Elbise', brand: 'ModaX', xmlPrice: 100, price: 100, images: JSON.stringify(['https://i/a.jpg', 'https://i/b.jpg', 'https://i/c.jpg']), title: 'Pamuklu elbise', ...o });

test('empty / garbage input gives harmless defaults (nothing is excluded or changed)', () => {
  for (const raw of [undefined, null, 'x', 5, {}, { minStock: 'abc', maxStock: -3, titleCase: 'weird' }]) {
    const s = norm(raw);
    assert.equal(s.minStock, 0); assert.equal(s.maxStock, null); assert.equal(s.titleCase, 'none'); assert.equal(s.maxImages, null);
    assert.deepEqual(S.excludedReasons(P(), s), []);
    assert.equal(S.shapeTitle('Ürün', s), 'Ürün'); assert.equal(S.sendStock(7, s), 7);
  }
});
test('comma strings and arrays both work for lists', () => {
  assert.deepEqual(norm({ includeCategories: 'Kolye, Küpe ,' }).includeCategories, ['Kolye', 'Küpe']);
  assert.deepEqual(norm({ excludeBrands: ['A', ' B '] }).excludeBrands, ['A', 'B']);
});
test('minimum stock excludes, with a readable reason', () => {
  const r = S.excludedReasons(P({ stock: 2 }), norm({ minStock: 5 }));
  assert.equal(r.length, 1); assert.match(r[0], /minimum stok/);
  assert.deepEqual(S.excludedReasons(P({ stock: 5 }), norm({ minStock: 5 })), []);
});
test('category lists are path-aware and case-insensitive', () => {
  assert.deepEqual(S.excludedReasons(P(), norm({ includeCategories: ['elbise'] })), []);
  assert.equal(S.excludedReasons(P(), norm({ includeCategories: ['Kolye'] })).length, 1);
  assert.equal(S.excludedReasons(P(), norm({ excludeCategories: ['KADIN'] })).length, 1);
  assert.deepEqual(S.excludedReasons(P(), norm({ excludeCategories: ['Kolye'] })), []);
});
test('brand lists', () => {
  assert.equal(S.excludedReasons(P(), norm({ includeBrands: ['Nike'] })).length, 1);
  assert.deepEqual(S.excludedReasons(P(), norm({ includeBrands: ['modax'] })), []);
  assert.equal(S.excludedReasons(P(), norm({ excludeBrands: ['ModaX'] })).length, 1);
  assert.equal(S.excludedReasons(P({ brand: null }), norm({ includeBrands: ['ModaX'] })).length, 1);
});
test('purchase price range', () => {
  const s = norm({ minPurchasePrice: 50, maxPurchasePrice: 150 });
  assert.deepEqual(S.excludedReasons(P({ xmlPrice: 100 }), s), []);
  assert.equal(S.excludedReasons(P({ xmlPrice: 10 }), s).length, 1);
  assert.equal(S.excludedReasons(P({ xmlPrice: 999 }), s).length, 1);
});
test('require image', () => {
  const s = norm({ requireImage: true });
  assert.deepEqual(S.excludedReasons(P(), s), []);
  assert.equal(S.excludedReasons(P({ images: null }), s).length, 1);
  assert.equal(S.excludedReasons(P({ images: '[]' }), s).length, 1);
  assert.equal(S.excludedReasons(P({ images: JSON.stringify(['not-a-url']) }), s).length, 1);
});
test('several reasons are all reported', () => {
  assert.equal(S.excludedReasons(P({ stock: 0, brand: 'X' }), norm({ minStock: 1, excludeBrands: ['X'] })).length, 2);
});
test('title shaping: prefix, suffix and Turkish-aware case', () => {
  assert.equal(S.shapeTitle('ışık demeti', norm({ titleCase: 'upper' })), 'IŞIK DEMETİ');
  assert.equal(S.shapeTitle('IŞIK DEMETİ', norm({ titleCase: 'lower' })), 'ışık demeti');
  assert.equal(S.shapeTitle('kadın pamuklu elbise', norm({ titleCase: 'title' })), 'Kadın Pamuklu Elbise');
  assert.equal(S.shapeTitle('Elbise', norm({ titlePrefix: 'Yeni ', titleSuffix: ' - Hızlı Kargo' })), 'Yeni Elbise - Hızlı Kargo');
});
test('images are capped, not mutated', () => {
  assert.equal(S.shapeImages(P().images, norm({ maxImages: 2 })).length, 2);
  assert.equal(S.shapeImages(P().images, norm({})).length, 3);
});
test('stock to publish: below minimum = 0, above maximum = cap, never negative', () => {
  const s = norm({ minStock: 3, maxStock: 8 });
  assert.equal(S.sendStock(2, s), 0); assert.equal(S.sendStock(5, s), 5); assert.equal(S.sendStock(50, s), 8); assert.equal(S.sendStock(-4, s), 0); assert.equal(S.sendStock(null, s), 0);
});
test('summary lists only what is active', () => {
  assert.deepEqual(S.describeSettings(norm({})), []);
  assert.ok(S.describeSettings(norm({ minStock: 2, requireImage: true, titleCase: 'upper' })).length === 3);
});
test('Turkish i/ı spelling differences do not break matching', () => {
  const s = norm({ excludeCategories: ['kadin'], includeBrands: ['MODAX'] });
  assert.equal(S.excludedReasons(P({ category: 'Giyim|Kadın|Elbise' }), s).length, 1);
  assert.deepEqual(S.excludedReasons(P({ category: 'Giyim|Erkek|Gömlek' }), s), []);
});
