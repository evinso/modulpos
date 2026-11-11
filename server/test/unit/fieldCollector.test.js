const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createFieldCollector, streamProductObjects } = require('../../src/services/xml/xmlParser');
const { suggestMapping } = require('../../src/services/xml/autoMapping');

const paths = (c) => c.fields().map((f) => f.path);

test('tags missing from the first product still appear (2 images first, 5 images later)', () => {
  const c = createFieldCollector();
  c.add({ Barkod: '1', Ad: 'A', Resim1: 'https://i/1.jpg', Resim2: 'https://i/2.jpg', Fiyat: '10' });
  c.add({ Barkod: '2', Ad: 'B', Resim1: 'https://i/a.jpg', Resim2: 'https://i/b.jpg', Resim3: 'https://i/c.jpg', Resim4: 'https://i/d.jpg', Resim5: 'https://i/e.jpg', Fiyat: '20' });
  const p = paths(c);
  for (const r of ['Resim3', 'Resim4', 'Resim5']) assert.ok(p.includes(r), `${r} missing`);
  // new tags sit next to their sibling, not at the very end
  assert.deepEqual(p, ['Barkod', 'Ad', 'Resim1', 'Resim2', 'Resim3', 'Resim4', 'Resim5', 'Fiyat']);
  assert.equal(c.fields().find((f) => f.path === 'Resim4').sample, 'https://i/d.jpg');
});

test('an empty tag in the first product takes its sample and type from a later product', () => {
  const c = createFieldCollector();
  c.add({ Ad: 'A', Resim3: '' });
  c.add({ Ad: 'B', Resim3: 'https://i/3.jpg' });
  const f = c.fields().find((x) => x.path === 'Resim3');
  assert.equal(f.sample, 'https://i/3.jpg');
  assert.equal(f.type, 'string');
});

test('repeated <Resim> nodes keep the longest list length', () => {
  const c = createFieldCollector();
  c.add({ Resimler: { Resim: ['https://i/1.jpg', 'https://i/2.jpg'] } });
  c.add({ Resimler: { Resim: ['https://i/1.jpg', 'https://i/2.jpg', 'https://i/3.jpg', 'https://i/4.jpg', 'https://i/5.jpg'] } });
  assert.equal(c.fields().find((f) => f.path === 'Resimler.Resim').length, 5);
});

test('the field list is capped', () => {
  const c = createFieldCollector(10);
  for (let i = 0; i < 50; i++) c.add({ ['T' + i]: 'x' });
  assert.equal(c.fields().length, 10);
});

test('streamed feed: auto mapping picks up all five image tags', async () => {
  const xml = '<?xml version="1.0"?><Urunler>'
    + '<Urun><Barkod>1</Barkod><UrunAdi>A</UrunAdi><Fiyat>10</Fiyat><Resim1>https://i/1.jpg</Resim1><Resim2>https://i/2.jpg</Resim2></Urun>'
    + '<Urun><Barkod>2</Barkod><UrunAdi>B</UrunAdi><Fiyat>20</Fiyat><Resim1>https://i/a.jpg</Resim1><Resim2>https://i/b.jpg</Resim2><Resim3>https://i/c.jpg</Resim3><Resim4>https://i/d.jpg</Resim4><Resim5>https://i/e.jpg</Resim5></Urun>'
    + '</Urunler>';
  const c = createFieldCollector();
  await streamProductObjects('http://feed.test/x.xml', { responseStream: Readable.from([xml]), onProduct: (p) => { c.add(p); return true; } });
  const p = paths(c).map((x) => x.toUpperCase());
  assert.ok(p.includes('RESIM5'));
  const m = suggestMapping(c.fields());
  assert.equal(m.images.split(',').length, 5);
});
