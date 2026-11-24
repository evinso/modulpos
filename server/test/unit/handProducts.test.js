const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../src/services/handProducts');

/** Products added by hand: the change of many at once (with a preview of what would change and what cannot) and the reading of a pasted price / stock list. No database: the routes only read and write. */
const P = (i, over = {}) => ({ id: `p${i}`, sku: `S-${i}`, barcode: `869000000${i}`, title: `Ürün ${i}`, price: 100 + i, stock: i, brand: 'Marka', vatRate: 20, status: 'active', category: null, sent: false, ...over });
const list = (n, over) => Array.from({ length: n }, (_, i) => P(i, over && over(i)));
const others = (skus = [], barcodes = []) => ({ skus: new Set(skus), barcodes: new Set(barcodes) });

test('the filters are database filters of hand-added products only, and the ones that need the connection say so', () => {
  const w = H.whereFor('s1', {});
  assert.deepEqual([w.storeId, w.xmlSourceId, w.xmlPrice], ['s1', null, { lte: 0 }], 'no XML source and no feed price = added by hand');
  assert.deepEqual(H.whereFor('s1', { filter: 'no_price' }).AND, [{ price: { lte: 0 } }]);
  assert.deepEqual(H.whereFor('s1', { filter: 'no_stock' }).AND, [{ stock: { lte: 0 } }]);
  assert.deepEqual(H.whereFor('s1', { filter: 'no_brand' }).AND[0].OR, [{ brand: null }, { brand: '' }]);
  assert.equal(H.whereFor('s1', { filter: 'no_image' }).AND[0].OR.length, 3);
  assert.deepEqual(H.whereFor('s1', { filter: 'no_category', connectionId: 'c1' }).AND, [{ categoryOverrides: { none: { connectionId: 'c1' } } }]);
  assert.equal(H.whereFor('s1', { filter: 'no_category' }).AND, undefined, 'without a connection there is no category to look for: no filter');
  assert.deepEqual(H.whereFor('s1', { filter: 'sent' }).AND, [{ marketplaceProducts: { some: {} } }]); assert.deepEqual(H.whereFor('s1', { filter: 'not_sent' }).AND, [{ marketplaceProducts: { none: {} } }]);
  assert.equal(H.whereFor('s1', { filter: 'nonsense' }).AND, undefined);
  assert.equal(H.whereFor('s1', { q: ' kupa ' }).AND[0].OR.length, 3, 'name, stock code and barcode');
  assert.deepEqual(H.orderFor('price', 'asc'), [{ price: 'asc' }, { id: 'asc' }]); assert.deepEqual(H.orderFor('evil', 'x'), [{ createdAt: 'desc' }, { id: 'asc' }]);
  assert.equal(H.imageCount({ images: '["a","b"]' }), 2); assert.equal(H.imageCount({ images: 'x' }), 0); assert.equal(H.firstImage({ images: '["https://a/1.jpg"]' }), 'https://a/1.jpg');
});

test('the change is checked in words: numbers, VAT, status, title text, and "nothing to change"', () => {
  assert.throws(() => H.readPatch({}), /Değiştirilecek bir alan/); assert.throws(() => H.readPatch(null), /Değiştirilecek bir alan/);
  assert.throws(() => H.readPatch({ price: { mode: 'set', value: -1 } }), /Fiyat/); assert.throws(() => H.readPatch({ price: { mode: 'percent', value: -95 } }), /yüzdesi/);
  assert.throws(() => H.readPatch({ stock: { mode: 'set', value: 1.5 } }), /Stok/); assert.throws(() => H.readPatch({ stock: { mode: 'add', value: 'x' } }), /Stok eklemesi/);
  assert.throws(() => H.readPatch({ brand: '  ' }), /Marka boş/); assert.throws(() => H.readPatch({ vatRate: 7 }), /KDV oranı/); assert.throws(() => H.readPatch({ status: 'draft' }), /aktif/);
  assert.throws(() => H.readPatch({ title: { prefix: '', suffix: '', find: '' } }), /Başlık için/);
  const p = H.readPatch({ price: { mode: 'set', value: '125,5'.replace(',', '.') }, stock: { mode: 'add', value: '5' }, vatRate: '10', status: 'passive', categoryText: '  Ev / Mutfak ', brand: ' Atölye ' });
  assert.deepEqual([p.price, p.stock, p.vatRate, p.status, p.categoryText, p.brand], [{ mode: 'set', value: 125.5 }, { mode: 'add', value: 5 }, 10, 'passive', 'Ev / Mutfak', 'Atölye']);
  assert.equal(H.readPatch({ categoryText: null }).categoryText, null);
  assert.equal(H.readPatch({ codes: { sku: { mode: 'keep' }, barcode: { mode: 'keep' } }, status: 'active' }).codes, undefined, 'a code rule that keeps everything is no change');
  assert.throws(() => H.readPatch({ codes: { sku: { mode: 'replace' } } }), /değiştirilecek metni/, 'the code rules are the ones of the XML import');
});

test('price, stock, brand, VAT, status, category text: set, percent, add; products already at the value are left out; the preview rows say before and after', () => {
  const products = list(3, (i) => ({ price: i === 1 ? 0 : 100, stock: 5 }));
  let r = H.planBulk(products, H.readPatch({ price: { mode: 'set', value: 250 } }), others());
  assert.deepEqual(r.updates.map((u) => [u.id, u.data.price]), [['p0', 250], ['p1', 250], ['p2', 250]]);
  r = H.planBulk(products, H.readPatch({ price: { mode: 'percent', value: 10 } }), others());
  assert.deepEqual(r.updates.map((u) => [u.id, u.data.price]), [['p0', 110], ['p2', 110]], 'a price of 0 stays 0 (nothing to raise): that product is not in the change');
  r = H.planBulk(products, H.readPatch({ stock: { mode: 'add', value: -7 } }), others()); assert.deepEqual(r.updates.map((u) => u.data.stock), [0, 0, 0], 'stock never goes below 0');
  r = H.planBulk(products, H.readPatch({ stock: { mode: 'set', value: 5 }, brand: 'Marka' }), others()); assert.equal(r.changed, 0, 'already there: nothing to write'); assert.deepEqual(r.rows, []);
  r = H.planBulk(products, H.readPatch({ vatRate: 10, status: 'passive', brand: 'Yeni', categoryText: 'A / B' }), others());
  assert.deepEqual(r.updates[0].data, { vatRate: 10, status: 'passive', brand: 'Yeni', category: 'A / B' }); assert.deepEqual(r.rows[0].before, { vatRate: 20, status: 'active', brand: 'Marka', category: null }); assert.deepEqual(r.rows[0].after, { vatRate: 10, status: 'passive', brand: 'Yeni', category: 'A / B' });
});

test('the name: text before / after and find-and-replace, spaces tidied, never an empty name', () => {
  const products = [P(0, { title: 'Seramik Kupa Set' }), P(1, { title: 'XX' })];
  let r = H.planBulk(products, H.readPatch({ title: { prefix: 'Atölye', suffix: '6\'lı', find: 'Set', replace: 'Takım' } }), others());
  assert.deepEqual(r.updates.map((u) => u.data.title), ['Atölye Seramik Kupa Takım 6\'lı', 'Atölye XX 6\'lı']);
  r = H.planBulk(products, H.readPatch({ title: { find: 'XX', replace: '' } }), others());
  assert.equal(r.changed, 0); assert.match(r.problems[0].reason, /Ad boş kalırdı/);
});

test('stock codes and barcodes: the same rules as the XML import, by position; products already sent to a marketplace and codes another product has are refused with the reason, the rest is changed', () => {
  const products = list(4, (i) => ({ sent: i === 3 }));
  const rule = H.readPatch({ codes: { sku: { mode: 'counter', prefix: 'BEN-', start: 1, pad: 3 }, barcode: { mode: 'generate', digits: '200', start: 1 } } }, { count: 4 });
  const r = H.planBulk(products, rule, others(['BEN-002'], []));
  assert.deepEqual(r.updates.map((u) => [u.id, u.data.sku]), [['p0', 'BEN-001'], ['p2', 'BEN-003']]);
  assert.ok(/^2000000000\d{3}$/.test(r.updates[0].data.barcode) && r.updates[0].data.barcode.length === 13, r.updates[0].data.barcode);
  assert.deepEqual(r.problems.map((x) => [x.id, /Pazaryerine gönderilmiş|başka bir üründe var/.test(x.reason)]), [['p1', true], ['p3', true]]);
  assert.match(r.problems.find((x) => x.id === 'p1').reason, /BEN-002.*başka bir üründe var/); assert.match(r.problems.find((x) => x.id === 'p3').reason, /Pazaryerine gönderilmiş/);
  const clash = H.planBulk(list(2), H.readPatch({ codes: { sku: { mode: 'replace', find: 'S-', replace: 'K' } } }, { count: 2 }), others());
  assert.deepEqual(clash.updates.map((u) => u.data.sku), ['K0', 'K1']);
  const same = H.planBulk(list(2), H.readPatch({ codes: { sku: { mode: 'replace', find: 'S-1', replace: 'S-0' } } }, { count: 2 }), others());
  assert.deepEqual(same.updates.map((u) => u.data.sku), ['S-0'].filter(() => false).concat([]), 'p0 keeps its code (S-0) and p1 would take it: refused');
  assert.match(same.problems[0].reason, /S-0.*başka bir üründe var/);
  const none = H.planBulk(list(2, () => ({ barcode: '' })), H.readPatch({ codes: { barcode: { mode: 'sku' } } }, { count: 2 }), others());
  assert.deepEqual(none.updates.map((u) => u.data.barcode), ['S-0', 'S-1'], 'the barcode follows the stock code');
});

test('a pasted list: Excel columns (tabs), semicolons, a header that names the columns, Turkish and English numbers, bad lines are told by line number', () => {
  const rows = H.parseList('SKU\tFiyat\tStok\nS-1\t1.874,70\t12\nS-2\t99.5\t\n8690000003\t\t7\n\nS-4\tabc\t1\nS-5\t10\t1,5\n\t5\t5\nS-7\t\t\n');
  const by = (l) => rows.find((r) => r.line === l);
  assert.deepEqual([by(2).key, by(2).price, by(2).stock], ['S-1', 1874.7, 12]); assert.deepEqual([by(3).price, by(3).stock], [99.5, null]); assert.deepEqual([by(4).price, by(4).stock], [null, 7]);
  assert.match(by(6).error, /Fiyat sayı değil/); assert.match(by(7).error, /Stok tam sayı olmalı/); assert.match(by(8).error, /Stok kodu \/ barkod yok/); assert.match(by(9).error, /Fiyat ya da stok yok/);
  assert.deepEqual(H.parseList('S-1;250;3\nS-2;260;4').map((r) => [r.key, r.price, r.stock]), [['S-1', 250, 3], ['S-2', 260, 4]]);
  assert.deepEqual(H.parseList('S-1,250.5,3\nS-2,260,4').map((r) => [r.key, r.price, r.stock]), [['S-1', 250.5, 3], ['S-2', 260, 4]]);
  assert.deepEqual(H.parseList('Barkod;Stok;Fiyat\n111;5;80').map((r) => [r.key, r.price, r.stock]), [['111', 80, 5]], 'the header says which column is which');
  assert.deepEqual(H.parseList('Kod;Fiyat\nA;10').map((r) => [r.key, r.price, r.stock]), [['A', 10, null]]);
  assert.throws(() => H.parseList('  \n  '), /Yapıştırılacak/); assert.throws(() => H.parseList(Array.from({ length: 5001 }, (_, i) => `S-${i};1;1`).join('\n')), /en çok 5000/);
});

test('the pasted list is matched with the products (stock code, then barcode, any case), and each line says what it does', () => {
  const products = [P(1), P(2, { price: 50 }), P(3, { sku: 'DUP' }), P(4, { sku: 'DUP' })];
  const rows = H.parseList('S-1;500;10\nS-2;50;2\n869000000X;5;5\n8690000001;7;7\nDUP;1;1\nS-1;600;11\nS-9;1;1\nbad;x;1');
  const out = H.planList(rows, products);
  assert.deepEqual(out.items.map((x) => x.status), ['ok', 'same', 'unmatched', 'bad', 'bad', 'bad', 'unmatched', 'bad']);
  assert.deepEqual(out.updates.map((u) => [u.id, u.data]), [['p1', { price: 500, stock: 10 }]], 'only what differs is written: S-2 already has this price and stock');
  assert.equal(out.items[1].note, 'Zaten bu değerde'); assert.match(out.items[3].note, /listede 1\. satırda da var/, 'the barcode of S-1 is the same product as line 1: only the first is taken'); assert.match(out.items[4].note, /2 üründe aynı kod var/); assert.match(out.items[5].note, /listede 1\. satırda da var/); assert.match(out.items[7].note, /Fiyat sayı değil/);
  assert.deepEqual(out.counts, { rows: 8, ok: 1, same: 1, unmatched: 2, bad: 4 });
  const lower = H.planList(H.parseList('s-1;777;1'), products); assert.deepEqual([lower.items[0].status, lower.updates[0].data], ['ok', { price: 777 }], 'a lower-case code finds the product');
});
