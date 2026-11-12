const test = require('node:test');
const assert = require('node:assert/strict');
const { pickValue, words, usable } = require('../../src/services/attributeFromText');

const def = (name, values, extra = {}) => ({ id: '1', name, allowCustom: false, values: values.map((n, i) => ({ id: 100 + i, name: n })), ...extra });
const pick = (d, title, desc = '') => { const r = pickValue(d, title, desc); return r ? r.valueName : null; };

test('a value named once in the title is taken', () => {
  const renk = def('Renk', ['Kırmızı', 'Mavi', 'Siyah']);
  assert.equal(pick(renk, 'Kırmızı Seramik Kupa'), 'Kırmızı');
  assert.deepEqual(pickValue(renk, 'Kırmızı Seramik Kupa'), { valueId: '100', valueName: 'Kırmızı', from: 'title' });
});

test('Turkish endings are tolerated, other words that merely start the same are not', () => {
  assert.equal(pick(def('Cinsiyet', ['Kadın', 'Erkek']), 'Kadınlar İçin Kolye'), 'Kadın');
  assert.equal(pick(def('Materyal', ['Pamuk', 'Deri']), 'Pamuklu Havlu'), 'Pamuk');
  assert.equal(pick(def('Materyal', ['Pamuk', 'Deri']), 'Derin Tabak'), null, '"derin" is not "deri"');
});

test('synonyms of common values: bayan = Kadın', () => {
  assert.equal(pick(def('Cinsiyet', ['Kadın', 'Erkek', 'Unisex']), 'Bayan Terlik'), 'Kadın');
});

test('a longer value hides the shorter one it contains', () => {
  assert.equal(pick(def('Renk', ['Mavi', 'Açık Mavi']), 'Açık Mavi Tişört'), 'Açık Mavi');
  assert.equal(pick(def('Cinsiyet', ['Erkek', 'Erkek Çocuk']), 'Erkek Çocuk Mont'), 'Erkek Çocuk');
});

test('two different values in the title are ambiguous: nothing is taken', () => {
  assert.equal(pick(def('Renk', ['Kırmızı', 'Mavi']), 'Kırmızı Mavi Çizgili Havlu'), null);
});

test('the description is only read when the title names nothing, and only when it is clear', () => {
  const renk = def('Renk', ['Kırmızı', 'Mavi', 'Siyah']);
  assert.deepEqual(pickValue(renk, 'Seramik Kupa', 'Zarif tasarımlı siyah bir kupa.'), { valueId: '102', valueName: 'Siyah', from: 'description' });
  assert.equal(pick(renk, 'Seramik Kupa', 'Mavi ve siyah seçenekleri vardır.'), null, 'two values once each: ambiguous');
  assert.equal(pick(renk, 'Seramik Kupa', 'Siyah kupa. Siyah dış yüzey, mavi detay.'), 'Siyah', 'clearly the one named most often');
  assert.equal(pick(renk, 'Mavi Kupa', 'Siyah kutuda gelir.'), 'Mavi', 'the title wins over the description');
});

test('the description is plain text for the reader: markup does not matter to words()', () => {
  assert.deepEqual(words('500ml  Su-Şişesi'), ['500', 'ml', 'su', 'sisesi']);
});

test('codes, letters and placeholders never match a word of a sentence ("VE" is Venezuela, "ve" is "and")', () => {
  assert.equal(usable('VE'), false);
  assert.equal(usable('S'), false);
  assert.equal(usable('Belirtilmemiş'), false);
  assert.equal(usable('Diğer'), false);
  assert.equal(usable('Kırmızı'), true);
  assert.equal(pick(def('Ülke', ['VE', 'TR']), 'Kedi Tarağı ve Fırça'), null);
  assert.equal(pick(def('Beden', ['S', 'M', 'L']), 'S Beden Tişört M'), null);
});

test('attributes about the seller are never read from the text', () => {
  assert.equal(pick(def('Menşei', ['Çin', 'TR']), 'Çin Malı Tencere'), null);
  assert.equal(pick(def('Marka', ['Nike']), 'Nike Çanta'), null);
});

test('values with a sign that carries the meaning are not matched from text', () => {
  assert.equal(usable('6+ Yaş'), false);
  assert.equal(usable('0-3 Ay'), false);
  assert.equal(pick(def('Yaş', ['6+ Yaş', '12+ Yaş']), 'Çocuk Deniz Kolluğu (3-6 Yaş)'), null);
});

test('a value with a number needs the attribute\'s own name next to it', () => {
  const garanti = def('Garanti Süresi', ['1 Yıl', '2 Yıl', '5 Yıl']);
  assert.equal(pick(garanti, 'TV Askı Aparatı', '5 yıl garantili ürünümüz'), '5 Yıl', '"5 yıl garantili" - the attribute word "garanti" stands next to it');
  assert.equal(pick(garanti, 'TV Askı Aparatı', 'Raf ömrü 2 yıl olan bir ürün.'), null, 'a number of years that is not about the guarantee');
  assert.equal(pick(def('Beden', ['1', '25', '38']), 'Su Tabancası', 'Çocuklar için 1 adet su tabancası'), null, 'a bare number in a sentence');
  assert.equal(pick(def('Beden', ['1', '25', '38']), 'Terlik Beden 38'), '38');
  assert.equal(pick(def('Kanat Sayısı', ['3', '4', '6']), 'Tavan Vantilatörü 6 Kanatlı'), '6');
});

test('a number inside a range or a dimension is not the attribute\'s value', () => {
  const gen = def('Genişlik', ['2 cm', '38 cm']);
  assert.equal(pick(gen, 'Kaydırmaz Bant 2x38 cm'), null, '2x38 cm is length x width, not "38 cm" wide');
  assert.equal(pick(gen, 'Kaydırmaz Bant Genişlik 38 cm'), '38 cm');
  assert.equal(pick(gen, 'Bant', 'Genişliği 2 cm olan bant'), '2 cm', 'an ending on the attribute word is fine');
  assert.equal(pick(def('Yaş', ['6 Yaş', '12 Yaş']), 'Kolluk 3-6 Yaş'), null);
});

test('no list, no answer; unknown values are not invented', () => {
  assert.equal(pickValue(def('Renk', []), 'Kırmızı Kupa'), null);
  assert.equal(pickValue({ id: '1', name: 'Renk', allowCustom: true, values: [] }, 'Kırmızı Kupa'), null);
  assert.equal(pick(def('Renk', ['Kırmızı']), 'Mor Kupa'), null);
});
