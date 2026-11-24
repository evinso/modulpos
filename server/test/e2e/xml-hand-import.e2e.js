// XML -> products ADDED BY HAND: only name, description, pictures, barcode / stock code and the category text come from the file; price, brand, stock and VAT are the owner's.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/xml-hand-import.e2e.js
// Temporary user; a file sent as the request body (what the page does) and nothing else leaves the server (no XML address is fetched).
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<Urunler>
<Urun><UrunKodu>X-100</UrunKodu><Barkod>8693330000011</Barkod><UrunAdi>Seramik Kupa Set 6'lı</UrunAdi><Aciklama>Bulaşık makinesinde yıkanabilir.</Aciklama><SatisFiyati>1874.7</SatisFiyati><Stok>25</Stok><Marka>TedarikciMarka</Marka><Kategori>Ev &amp; Yaşam / Mutfak / Kupa</Kategori><Resimler><Resim>https://img.example.com/k1.jpg</Resim><Resim>//img.example.com/k2.jpg</Resim></Resimler></Urun>
<Urun><UrunKodu>X-101</UrunKodu><Barkod>8693330000028</Barkod><UrunAdi>Bambu Kesme Tahtası</UrunAdi><Aciklama><![CDATA[<p onclick="x()">Doğal bambu.</p><script>alert(1)</script>]]></Aciklama><SatisFiyati>99</SatisFiyati><Stok>3</Stok><Marka>TedarikciMarka</Marka><Kategori>Ev &amp; Yaşam / Mutfak</Kategori><Resimler><Resim>https://img.example.com/t1.jpg</Resim></Resimler></Urun>
<Urun><UrunKodu>X-102</UrunKodu><Barkod>8693330000035</Barkod><UrunAdi>Görseli Olmayan Ürün</UrunAdi><Aciklama>Fotoğrafı yok.</Aciklama><SatisFiyati>10</SatisFiyati><Stok>1</Stok><Marka>TedarikciMarka</Marka><Kategori>Diğer</Kategori><Resimler></Resimler></Urun>
</Urunler>`;

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const users = [];
  try {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-xmlhand-${Date.now()}@example.invalid`, password: 'Tmp-Pass-123456!', name: 'E2E XML Hand' }) });
    const A = await r.json(); if (!A.user) throw new Error(`register failed (HTTP ${r.status}): ${JSON.stringify(A).slice(0, 160)}`);
    users.push(A.user.id);
    const call = async (m, u, b, type = 'application/json') => {
      const res = await fetch(API + u, { method: m, headers: { 'Content-Type': type, Authorization: 'Bearer ' + A.token, 'X-Requested-With': 'XMLHttpRequest' }, body: b === undefined ? undefined : (typeof b === 'string' ? b : JSON.stringify(b)) });
      let d; try { d = await res.json(); } catch { /* empty */ } return { s: res.status, d };
    };

    // ── read: nothing is written ──
    const before = (await c.query(`select count(*)::int n from app."Product" where "storeId" = $1`, [A.user.stores[0].id])).rows[0].n;
    const none = await call('POST', '/products/xml-import/read', {}); ok('read: neither a file nor an address is refused in words (400)', none.s === 400 && /XML/.test((none.d && none.d.error) || ''), `${none.s} ${none.d && none.d.error}`);
    const junk = await call('POST', '/products/xml-import/read', '<?xml version="1.0"?><root><a>1</a></root>', 'text/xml'); ok('read: a file without products is refused in words (422)', junk.s === 422 && /ürün bulunamadı/.test((junk.d && junk.d.error) || ''), `${junk.s} ${junk.d && junk.d.error}`);
    const rd = await call('POST', '/products/xml-import/read', XML, 'text/xml');
    ok('read: three products, the fields the page offers, a token', rd.s === 200 && rd.d.total === 3 && rd.d.items.length === 3 && !!rd.d.token && rd.d.fields.length > 5, `${rd.s} ${JSON.stringify(rd.d).slice(0, 160)}`);
    const it = rd.d.items;
    ok('read: name, stock code, barcode, category, picture count; the XML\'s price, brand and stock are not in the answer', it[0].title === "Seramik Kupa Set 6'lı" && it[0].sku === 'X-100' && it[0].barcode === '8693330000011' && it[0].imageCount === 2 && /Mutfak/.test(it[0].category) && !JSON.stringify(rd.d).includes('TedarikciMarka') && !JSON.stringify(rd.d).includes('1874'));
    ok('read: a product without a picture says so (imageCount 0)', it[2].imageCount === 0 && it[2].firstImage === null);
    ok('read: nothing was written', (await c.query(`select count(*)::int n from app."Product" where "storeId" = $1`, [A.user.stores[0].id])).rows[0].n === before);

    // ── import ──
    const opts = { vatRate: 10, stock: 0, brand: 'Benim Markam', useBarcode: true };
    const bad = await call('POST', '/products/xml-import', { token: 'x'.repeat(24), refs: [0], options: opts }); ok('import: an unknown or expired token asks to read again (410)', bad.s === 410 && /yeniden okuyun/.test((bad.d && bad.d.error) || ''), `${bad.s} ${bad.d && bad.d.error}`);
    const badVat = await call('POST', '/products/xml-import', { token: rd.d.token, refs: [0], options: { ...opts, vatRate: 7 } }); ok('import: a VAT rate that does not exist is refused (400)', badVat.s === 400 && /KDV/.test((badVat.d && badVat.d.error) || ''), `${badVat.s} ${badVat.d && badVat.d.error}`);
    const many = await call('POST', '/products/xml-import', { token: rd.d.token, refs: [], options: opts }); ok('import: no rows chosen is refused (400)', many.s === 400);
    const imp = await call('POST', '/products/xml-import', { token: rd.d.token, refs: [0, 1, 2], options: opts });
    ok('import: three products created', imp.s === 201 && imp.d.created === 3 && imp.d.skipped.length === 0, `${imp.s} ${JSON.stringify(imp.d)}`);
    const rows = (await c.query(`select * from app."Product" where "storeId" = $1 order by sku`, [A.user.stores[0].id])).rows;
    const k = rows.find((x) => x.sku === 'X-100'); const t = rows.find((x) => x.sku === 'X-101');
    ok('import: created like the "Yeni ürün" form does: no XML source, no feed price (hand-added), price 0, own brand and VAT, stock 0', rows.length === 3 && rows.every((x) => x.xmlSourceId === null && Number(x.xmlPrice) === 0 && Number(x.price) === 0 && x.brand === 'Benim Markam' && x.vatRate === 10 && x.stock === 0 && x.status === 'active'));
    ok('import: name, barcode, category and BOTH pictures (the // one with https) are kept; the supplier\'s brand and price are nowhere', k.title === "Seramik Kupa Set 6'lı" && k.barcode === '8693330000011' && /Kupa/.test(k.category) && JSON.stringify(JSON.parse(k.images)) === JSON.stringify(['https://img.example.com/k1.jpg', 'https://img.example.com/k2.jpg']) && rows.every((x) => !JSON.stringify(x).includes('TedarikciMarka')));
    ok('import: scripts and handlers are gone from a description', /Doğal bambu/.test(t.description) && !/script|onclick/i.test(t.description), t.description);

    // ── reading the same file again: what exists is flagged; importing it again skips it ──
    const rd2 = await call('POST', '/products/xml-import/read', XML, 'text/xml'); ok('read again: every row says it already exists (same SKU)', rd2.s === 200 && rd2.d.items.every((x) => x.exists === 'sku'), JSON.stringify(rd2.d.items.map((x) => x.exists)));
    const again = await call('POST', '/products/xml-import', { token: rd2.d.token, refs: [0, 1, 2], options: opts }); ok('import again: nothing is created, three are skipped as existing', again.s === 200 && again.d.created === 0 && again.d.skipped.length === 3 && again.d.skipped.every((x) => x.reason === 'exists'), `${again.s} ${JSON.stringify(again.d)}`);

    // ── the plan's product limit ──
    await c.query(`delete from app."Product" where "storeId" = $1 and sku = 'X-102'`, [A.user.stores[0].id]);
    await c.query(`update app."User" set "maxProducts" = 2 where id = $1`, [A.user.id]);
    const rd3 = await call('POST', '/products/xml-import/read', XML, 'text/xml'); const lim = await call('POST', '/products/xml-import', { token: rd3.d.token, refs: [0, 1, 2], options: opts });
    ok('limit: the third product is not created, the answer says the plan allows 2', lim.s === 200 && lim.d.created === 0 && lim.d.limitReached === true && lim.d.skipped.some((x) => x.reason === 'limit') && /2 ürün/.test(lim.d.limitMessage || ''), `${lim.s} ${JSON.stringify(lim.d)}`);

    // ── another user cannot use my reading ──
    const r2 = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-xmlhand-b-${Date.now()}@example.invalid`, password: 'Tmp-Pass-123456!', name: 'E2E XML Hand B' }) });
    const B = await r2.json(); users.push(B.user.id);
    const other = await fetch(API + '/products/xml-import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + B.token, 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ token: rd3.d.token, refs: [0], options: opts }) });
    ok('isolation: another account cannot use my reading (410) and creates nothing', other.status === 410 && (await c.query(`select count(*)::int n from app."Product" where "storeId" = $1`, [B.user.stores[0].id])).rows[0].n === 0, String(other.status));
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
