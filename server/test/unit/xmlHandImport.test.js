const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../../src/services/xmlHandImport');

/**
 * XML -> products added by hand: only name, description, pictures (as addresses), barcode / stock code and the category TEXT come from the file. The price, the brand, the stock and the VAT are the owner's
 * (the XML's own are never read into the product), and the products are created exactly like the "Yeni ürün" form creates them (no XML source, no feed price).
 */
const fixture = (n) => fs.readFileSync(path.join(__dirname, '../fixtures', n), 'utf8');
const readText = (xml, mapping) => H.read({ stream: H.fromText(xml), mapping });

test('a Turkish feed: name, description, every picture address, stock code, barcode and the category text; nothing else', async () => {
  const r = await readText(fixture('feed-turkish.xml'));
  assert.equal(r.total, 3); assert.equal(r.items.length, 3); assert.equal(r.truncated, false);
  const a = r.items[0];
  assert.deepEqual(a, { ref: 0, sku: 'TR-100', skuGenerated: false, barcode: '8691111000011', title: 'Seramik Kupa Set 6\'lı', description: 'Bulaşık makinesinde yıkanabilir.',
    images: ['https://img.example.com/k1.jpg', 'https://img.example.com/k2.jpg'], category: 'Ev & Yaşam / Mutfak / Kupa' });
  assert.ok(!('price' in a) && !('brand' in a) && !('stock' in a) && !('listPrice' in a), 'the XML\'s price, brand and stock never enter a row');
  assert.deepEqual([r.items[1].sku, r.items[1].barcode, r.items[1].images.length, r.items[2].images.length], ['TR-101', '', 1, 0], 'a product without pictures is listed (the page says it cannot be sent)');
  assert.equal(r.mapping.title, 'URUNADI'); assert.equal(r.mapping.sku, 'URUNKODU'); assert.ok(r.fields.some((f) => f.path === 'ACIKLAMA'), 'the page can offer every field with a sample');
});

test('a feed whose later products carry more pictures: all of them are taken (up to 12)', async () => {
  const r = await readText(fixture('feed-images-varied.xml'));
  assert.deepEqual(r.items.map((i) => i.images.length).slice(0, 3), [2, 5, 3]);
});

test('cleaning: protocol-relative pictures get https, scripts and handlers leave the description, a product without a code gets a stable one from its name, a product without a name is dropped, the same SKU twice is one product', async () => {
  const xml = `<?xml version="1.0"?><Products>
    <Product><Name>Çelik Termos 500 ml</Name><Description><![CDATA[<p onclick="x()">Sıcak tutar.</p><script>alert(1)</script><style>p{}</style>]]></Description><Image>//cdn.example.com/t1.jpg</Image></Product>
    <Product><Sku>A-1</Sku><Name>First</Name><Description>a</Description><Image>https://i.example.com/1.jpg</Image></Product>
    <Product><Sku>A-1</Sku><Name>First again</Name><Description>b</Description><Image>https://i.example.com/2.jpg</Image></Product>
    <Product><Sku>A-2</Sku><Name></Name><Description>no name</Description></Product>
  </Products>`;
  const r = await readText(xml); const again = await readText(xml);
  assert.equal(r.total, 4); assert.equal(r.items.length, 2); assert.deepEqual([r.noName, r.duplicatesInFile], [1, 1]);
  const t = r.items[0]; assert.equal(t.title, 'Çelik Termos 500 ml'); assert.deepEqual(t.images, ['https://cdn.example.com/t1.jpg']);
  assert.ok(!/script|onclick|<style/i.test(t.description) && /Sıcak tutar/.test(t.description), t.description);
  assert.match(t.sku, /^XML-[0-9a-f]{8}$/); assert.equal(t.skuGenerated, true); assert.equal(t.sku, again.items[0].sku, 'reading the same file again finds the same product');
  assert.deepEqual([r.items[1].sku, r.items[1].title], ['A-1', 'First'], 'the first of two equal SKUs is kept');
});

test('the person can choose which XML field is which (the choice wins over the guess)', async () => {
  const r = await readText(fixture('feed-turkish.xml'), { title: 'URUNKODU', description: 'URUNADI' });          // (the parser upper-cases tag names: the page offers the paths exactly as they are)
  assert.deepEqual([r.items[0].title, r.items[0].description, r.mapping.title], ['TR-100', 'Seramik Kupa Set 6\'lı', 'URUNKODU']);
});

test('a file that is not a product list is refused in words', async () => {
  await assert.rejects(readText('<?xml version="1.0"?><root><a>1</a></root>'), (e) => /ürün bulunamadı/.test(e.message));
});

// ── writing ──────────────────────────────────────────────────────────────────────────────────────
function fakePrisma(existing = []) {
  const created = [];
  return { created, product: { async findMany() { return existing.map((p) => ({ sku: p.sku, barcode: p.barcode || null })); }, async createMany({ data }) { created.push(...data); return { count: data.length }; } } };
}
const items = (n) => Array.from({ length: n }, (_, i) => ({ ref: i, sku: `S${i}`, skuGenerated: false, barcode: `869000000${i}`, title: `Ürün ${i}`, description: `Açıklama ${i}`, images: [`https://i.example.com/${i}.jpg`], category: 'Kategori / Alt' }));
const opts = (o = {}) => H.readOptions({ brand: 'Benim Markam', ...o });

test('the products are created like the "Yeni ürün" form creates them: no XML source, no feed price, price/stock/brand/VAT are the owner\'s own', async () => {
  const p = fakePrisma(); const out = await H.create({ prisma: p, storeId: 's1', items: items(3), refs: [0, 1, 2], options: opts({ vatRate: 10, stock: 7 }) });
  assert.deepEqual([out.created, out.skipped.length, out.limitReached], [3, 0, false]);
  const d = p.created[0];
  assert.deepEqual(d, { storeId: 's1', sku: 'S0', barcode: '8690000000', title: 'Ürün 0', description: 'Açıklama 0', price: 0, cost: 0, listPrice: 0, stock: 7, brand: 'Benim Markam', category: 'Kategori / Alt',
    images: JSON.stringify(['https://i.example.com/0.jpg']), vatRate: 10, status: 'active' });
  assert.ok(!('xmlSourceId' in d) && !('xmlPrice' in d), 'no XML source and no feed price: that is what makes it a hand-added product');
});

test('what the store already has is skipped (same SKU, or the same barcode), a repeat inside one batch too, and the plan\'s product limit stops the rest', async () => {
  const p = fakePrisma([{ sku: 'S0', barcode: '1' }, { sku: 'OTHER', barcode: '8690000001' }]);
  const list = items(6); list[4].barcode = list[3].barcode;                                              // two rows with one barcode
  const out = await H.create({ prisma: p, storeId: 's1', items: list, refs: [0, 1, 2, 3, 4, 5, 99], options: opts(), room: 2 });
  assert.deepEqual(out.skipped.map((s) => [s.ref, s.reason]), [[0, 'exists'], [1, 'barcode'], [4, 'barcode'], [5, 'limit'], [99, 'unknown']].sort((a, b) => [0, 1, 2, 3, 4, 5, 99].indexOf(a[0]) - [0, 1, 2, 3, 4, 5, 99].indexOf(b[0])));
  assert.deepEqual(p.created.map((x) => x.sku), ['S2', 'S3'], 'two products were allowed by the plan'); assert.equal(out.limitReached, true);
});

test('without "use the barcode" the products are created without one (the owner types their own)', async () => {
  const p = fakePrisma(); await H.create({ prisma: p, storeId: 's1', items: items(1), refs: [0], options: opts({ useBarcode: false }) });
  assert.equal(p.created[0].barcode, null);
});

test('the choices are checked: VAT, stock, brand length', () => {
  assert.deepEqual(H.readOptions({}), { vatRate: 20, stock: 0, brand: '', useBarcode: true });
  assert.throws(() => H.readOptions({ vatRate: 5 }), /KDV oranı/); assert.throws(() => H.readOptions({ stock: -1 }), /Stok/); assert.throws(() => H.readOptions({ stock: 1.5 }), /Stok/);
  assert.equal(H.readOptions({ brand: 'x'.repeat(300) }).brand.length, 120);
});

test('the reading is kept for 45 minutes for the person who made it only, one reading per person, three in all', () => {
  H._cache.clear();
  const base = { storeId: 's1', items: items(1) }; const T0 = 1_000_000;
  const a = H.keep({ ...base, userId: 'u1', now: T0 }); const b = H.keep({ ...base, userId: 'u1', now: T0 + 1 });
  assert.throws(() => H.recall(a, { userId: 'u1', storeId: 's1', now: T0 + 2 }), (e) => e.status === 410, 'a new reading replaces the person\'s earlier one (memory is small on the free hosting)');
  assert.equal(H.recall(b, { userId: 'u1', storeId: 's1', now: T0 + 2 }).items.length, 1);
  assert.throws(() => H.recall(b, { userId: 'u2', storeId: 's1', now: T0 + 2 }), (e) => e.status === 410, 'another user cannot use it');
  assert.throws(() => H.recall(b, { userId: 'u1', storeId: 's2', now: T0 + 2 }), (e) => e.status === 410, 'nor another store');
  const c1 = H.keep({ ...base, userId: 'u2', now: T0 + 3 }); const c2 = H.keep({ ...base, userId: 'u3', now: T0 + 4 }); const c3 = H.keep({ ...base, userId: 'u4', now: T0 + 5 });
  assert.equal(H._cache.size, 3, 'at most three readings in all: the oldest makes room'); assert.throws(() => H.recall(b, { userId: 'u1', storeId: 's1', now: T0 + 6 }), (e) => e.status === 410);
  assert.ok(c1 && c2 && c3);
  assert.throws(() => H.recall(c3, { userId: 'u4', storeId: 's1', now: T0 + 46 * 60000 }), (e) => e.status === 410 && /yeniden okuyun/.test(e.message), 'after 45 minutes it is gone');
  assert.throws(() => H.keep({ storeId: 's1', userId: 'u9', items: [{ ...items(1)[0], description: 'x'.repeat(16 * 1000 * 1000) }], now: T0 }), (e) => e.status === 413, 'a reading that would not fit in memory is refused in words');
  H._cache.clear();
});
