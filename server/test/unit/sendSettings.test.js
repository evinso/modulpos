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
test('minimum stock excludes, with a readable reason', () => {
  const r = S.excludedReasons(P({ stock: 2 }), norm({ minStock: 5 }));
  assert.equal(r.length, 1); assert.match(r[0], /minimum stok/);
  assert.deepEqual(S.excludedReasons(P({ stock: 5 }), norm({ minStock: 5 })), []);
});
test('require image', () => {
  const s = norm({ requireImage: true });
  assert.deepEqual(S.excludedReasons(P(), s), []);
  assert.equal(S.excludedReasons(P({ images: null }), s).length, 1);
  assert.equal(S.excludedReasons(P({ images: '[]' }), s).length, 1);
  assert.equal(S.excludedReasons(P({ images: JSON.stringify(['not-a-url']) }), s).length, 1);
});
test('reasons are reported', () => {
  assert.equal(S.excludedReasons(P({ stock: 0 }), norm({ minStock: 1, requireImage: true })).length, 1);
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

test('removeWords: normalised from text or list, no duplicates, sane limits', () => {
  assert.deepEqual(norm({ removeWords: 'Çeyrek, reşat ,, ÇEYREK ; gram altın' }).removeWords, ['Çeyrek', 'reşat', 'gram altın']);
  assert.deepEqual(norm({ removeWords: ['A', ' a ', 'B'] }).removeWords, ['A', 'B']);
  assert.deepEqual(norm({}).removeWords, []);
  assert.deepEqual(norm({ removeWords: 5 }).removeWords, ['5']);
  assert.equal(norm({ removeWords: Array.from({ length: 80 }, (_, i) => 'w' + i) }).removeWords.length, 50);
  assert.equal(norm({ removeWords: 'x'.repeat(200) }).removeWords[0].length, 60);
});

test('removeWords: the word goes out of title and description, in any case and Turkish spelling', () => {
  const s = norm({ removeWords: 'Çeyrek, Reşat' });
  assert.equal(S.shapeTitle('316L Çelik Gold Renk Çeyrek Model Zirkon Taş Detay Kadın Kelepçe', s), '316L Çelik Gold Renk Model Zirkon Taş Detay Kadın Kelepçe');
  assert.equal(S.shapeTitle('Zirkon Taşlı CEYREK Takılabilir Kolye', s), 'Zirkon Taşlı Takılabilir Kolye');
  assert.equal(S.shapeTitle('Reşat Model Samanyolu Bileklik', s), 'Model Samanyolu Bileklik');
  assert.equal(S.shapeTitle('Samanyolu RESAT Bileklik', s), 'Samanyolu Bileklik');
  assert.equal(S.shapeDescription('Ürün tipi 316L çeliktir.\nÇeyrek modeli, reşat   desen.', s), 'Ürün tipi 316L çeliktir.\nmodeli, desen.');
});

test('removeWords: whole words only, gaps are closed, nothing else is touched', () => {
  const s = norm({ removeWords: 'Çeyrek' });
  assert.equal(S.shapeTitle('Çeyreklik Kolye', s), 'Çeyreklik Kolye');         // a longer word is not cut
  assert.equal(S.shapeTitle('Kolye, Çeyrek, Altın Renk', s), 'Kolye, Altın Renk');
  assert.equal(S.shapeTitle('Kolye (Çeyrek)', s), 'Kolye');
  assert.equal(S.shapeTitle('Kolye Çeyrek', s), 'Kolye');
  assert.equal(S.shapeTitle('Normal Kolye', s), 'Normal Kolye');
  assert.equal(S.shapeTitle('Çeyrek', s), '');                                    // readiness then reports an empty title
  assert.equal(S.shapeTitle('Kolye', norm({})), 'Kolye');
});

test('removeWords: phrases, regex characters in words are harmless, works together with the other title settings', () => {
  assert.equal(S.shapeTitle('1 gram  altın kaplama', norm({ removeWords: 'gram altın' })), '1 kaplama');
  assert.equal(S.shapeTitle('A (B) C', norm({ removeWords: '(B)' })), 'A C');      // regex characters are taken literally
  assert.equal(S.shapeTitle('A BB C', norm({ removeWords: '.*' })), 'A BB C');          // never a wildcard
  assert.equal(S.shapeTitle('Ürün a+b', norm({ removeWords: 'a+b' })), 'Ürün');
  assert.equal(S.shapeTitle('kolye çeyrek', norm({ removeWords: 'Çeyrek', titleCase: 'title', titlePrefix: 'Yeni ' })), 'Yeni Kolye');
});

test('removeWords: appears in the summary only when used', () => {
  assert.deepEqual(S.describeSettings(norm({})), []);
  assert.ok(S.describeSettings(norm({ removeWords: 'a, b' })).includes('2 kelime çıkarılır'));
});
