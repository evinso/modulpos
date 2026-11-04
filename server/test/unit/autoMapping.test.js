const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestMapping } = require('../../src/services/xml/autoMapping');

const f = (path, sample, type = 'string') => ({ path, key: path.split('.').pop(), type, sample });

test('Turkish feed', () => {
  const m = suggestMapping([f('URUNKODU', 'TR-1'), f('BARKOD', '8691111000011'), f('URUNADI', 'Kupa'), f('ACIKLAMA', 'x'), f('SATISFIYATI', '1874.7'),
    f('STOK', '25'), f('MARKA', 'EvDekor'), f('KATEGORI', 'Ev'), f('RESIMLER', '', 'object'), f('RESIMLER.RESIM', 'https://i/1.jpg', 'array')]);
  assert.equal(m.sku, 'URUNKODU'); assert.equal(m.barcode, 'BARKOD'); assert.equal(m.title, 'URUNADI');
  assert.equal(m.price, 'SATISFIYATI'); assert.equal(m.stock, 'STOK'); assert.equal(m.images, 'RESIMLER.RESIM');
});
test('Google Merchant feed (g: prefix)', () => {
  const m = suggestMapping([f('G:ID', 'GM-1'), f('G:TITLE', 'Elbise'), f('G:PRICE', '1.874,70 TRY'), f('G:QUANTITY', '12'),
    f('G:GTIN', '8690000000011'), f('G:IMAGE_LINK', 'https://i/1.jpg'), f('G:ADDITIONAL_IMAGE_LINK', 'https://i/2.jpg')]);
  assert.equal(m.sku, 'G:ID'); assert.equal(m.price, 'G:PRICE'); assert.equal(m.barcode, 'G:GTIN');
  assert.equal(m.images, 'G:IMAGE_LINK,G:ADDITIONAL_IMAGE_LINK');
});
test('does not use a list/old price as the main price', () => {
  const m = suggestMapping([f('ESKIFIYAT', '500'), f('LISTEFIYATI', '450'), f('FIYAT', '300')]);
  assert.equal(m.price, 'FIYAT'); assert.equal(m.listPrice, 'LISTEFIYATI');
});
test('availability flag is used when there is no quantity', () => {
  const m = suggestMapping([f('G:ID', '1'), f('G:AVAILABILITY', 'in stock')]);
  assert.equal(m.stock, 'G:AVAILABILITY');
});
