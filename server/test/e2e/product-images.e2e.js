// Pictures uploaded for products added by hand: a loan on our server, served publicly (the marketplace downloads them), tied to the product
// that uses them, removed with it, never taken by another store. (The release after Trendyol has them is unit-tested: it needs a real account.)
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/product-images.e2e.js
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = async (tag) => {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-img-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Img ' + tag }) });
    const j = await r.json();
    if (!j.user) throw new Error(`register failed (HTTP ${r.status}; 20 per 15 minutes): ${JSON.stringify(j).slice(0, 160)}`);
    return j;
  };
  const caller = (token) => async (m, u, b) => {
    const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined });
    let d; try { d = await r.json(); } catch { /* empty */ }
    return { s: r.status, d };
  };
  const users = [];
  const row = async (id) => (await c.query(`select id, "storeId", "productId", mime, ext, size from app."ProductImageUpload" where id=$1`, [id])).rows[0];
  try {
    const A = await reg('a'); users.push(A.user.id);
    const B = await reg('b'); users.push(B.user.id);
    const a = caller(A.token), b = caller(B.token), anon = caller(null);

    ok('anonymous cannot upload (401)', (await anon('POST', '/products/images', { data: PNG_1x1 })).s === 401);
    const up = await a('POST', '/products/images', { data: PNG_1x1 });
    ok('a picture is accepted and answered with a public address on the API', up.s === 201 && /^https?:\/\/[^/]+\/api\/uploads\/[0-9a-f-]{36}\.png$/.test(up.d.url) && up.d.size > 10, JSON.stringify(up.d));
    const id = up.d.id;
    const r0 = await row(id);
    ok('stored in the database, for this store, not used by any product yet', r0 && r0.storeId === A.user.stores[0].id && r0.productId === null && r0.mime === 'image/png' && r0.ext === 'png');

    // public download (what the marketplace does): no login
    const dl = await fetch(up.d.url);
    const bytes = Buffer.from(await dl.arrayBuffer());
    ok('the address downloads without logging in: same bytes, image type, cross-origin allowed, no sniffing', dl.status === 200 && dl.headers.get('content-type') === 'image/png' && bytes.equals(Buffer.from(PNG_1x1, 'base64'))
      && dl.headers.get('x-content-type-options') === 'nosniff' && dl.headers.get('cross-origin-resource-policy') === 'cross-origin', `${dl.status} ${dl.headers.get('content-type')}`);
    const wrongExt = await fetch(up.d.url.replace(/\.png$/, '.jpg'));
    const unknown = await fetch(up.d.url.replace(id, '00000000-0000-4000-8000-000000000000'));
    const junk = await fetch(up.d.url.replace(/[^/]+$/, 'x.png'));
    ok('a wrong extension, an unknown id and a malformed name are all 404', wrongExt.status === 404 && unknown.status === 404 && junk.status === 404, `${wrongExt.status} ${unknown.status} ${junk.status}`);

    // what is refused
    const svg = await a('POST', '/products/images', { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64') });
    ok('an SVG (can carry script) is refused (400)', svg.s === 400 && /JPG, PNG ya da WebP/.test(svg.d.error), `${svg.s} ${svg.d && svg.d.error}`);
    const junkB = await a('POST', '/products/images', { data: '%%%not base64%%%' });
    ok('text that is not a picture is refused (400)', junkB.s === 400 && /okunamadı/.test(junkB.d.error));
    const big = await a('POST', '/products/images', { data: Buffer.concat([Buffer.from(PNG_1x1, 'base64'), Buffer.alloc(3.6 * 1024 * 1024)]).toString('base64') });
    ok('a picture over 3.5 MB is refused with a sentence (413)', big.s === 413 && /çok büyük/.test(big.d.error), `${big.s} ${big.d && big.d.error}`);
    const none = await a('POST', '/products/images', {});
    ok('no data at all is refused (400)', none.s === 400);

    // used by a product
    const body = { sku: 'IMG-1', barcode: 'e2e-img-1', title: 'Fotoğraflı ürün', price: 100, stock: 1, vatRate: 20, brand: 'Atölye', images: [up.d.url, 'https://example.com/link.jpg'] };
    const p = await a('POST', '/products', body);
    ok('a product created with that address is saved', p.s === 201 && JSON.parse(p.d.images)[0] === up.d.url);
    ok('the picture now belongs to the product', (await row(id)).productId === p.d.id);

    // another store can not take it, nor reach the product through it
    const other = await b('POST', '/products', { ...body, sku: 'IMG-B', barcode: 'e2e-img-b' });
    ok('another store using the same address does NOT take the picture over', other.s === 201 && (await row(id)).productId === p.d.id);

    // removing the picture from the product deletes it
    const up2 = (await a('POST', '/products/images', { data: PNG_1x1 })).d;
    await a('PUT', `/products/${p.d.id}`, { images: [up.d.url, up2.url] });
    ok('adding a second upload to the product attaches it', (await row(up2.id)).productId === p.d.id);
    await a('PUT', `/products/${p.d.id}`, { images: [up.d.url] });
    ok('taking it out of the product\'s list deletes it from the server', (await row(up2.id)) === undefined && (await row(id)).productId === p.d.id);
    ok('a bad address in an edit is refused (400)', (await a('PUT', `/products/${p.d.id}`, { images: ['ftp://x/y.jpg'] })).s === 400);

    // deleting the product deletes its pictures
    const del = await a('DELETE', `/products/${p.d.id}`);
    ok('deleting the product deletes its uploaded pictures too', del.s === 200 && (await row(id)) === undefined);
    ok('and the public address is gone', (await fetch(up.d.url)).status === 404);

    // an upload nobody uses yet is limited
    let last;
    for (let i = 0; i < 42; i++) { last = await a('POST', '/products/images', { data: PNG_1x1 }); if (last.s !== 201) break; }
    ok('too many unused uploads are refused (429) with a sentence', last.s === 429 && /Kullanılmamış/.test(last.d.error), `${last.s} ${last.d && last.d.error}`);
    const stillB = await b('POST', '/products/images', { data: PNG_1x1 });
    ok('another store has its own allowance', stillB.s === 201);
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    console.log('leftover uploads of removed stores:', (await c.query(`select count(*)::int n from app."ProductImageUpload" u left join app."Store" s on s.id=u."storeId" where s.id is null`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
