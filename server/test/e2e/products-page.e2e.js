// Products screen API: summary, facets, filters, sorting, paging, per-marketplace pricing and the detail panel. See test/e2e/README.md.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const mk = (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: tag }) }).then((r) => r.json());
  const A = await mk('prodA'), B = await mk('prodB');
  const call = (tok) => async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d }; };
  const a = call(A.token), b = call(B.token); const storeId = A.user.stores[0].id;
  const sync = async (id) => { await a('POST', `/xml-sources/${id}/sync`); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = (await a('GET', `/xml-sources/${id}/sync-status`)).d; if (!s.running && s.last.status !== 'started') return s.last; } };
  try {
    const sources = {};
    for (const f of ['feed-google.xml', 'feed-turkish.xml', 'feed-english.xml']) { sources[f] = (await a('POST', '/xml-sources', { name: f, url: base + f, syncIntervalMin: 60, defaultVatRate: 20, options: { content: { defaultBrand: 'Markasiz' } } })).d; await sync(sources[f].id); }
    const total = (await c.query(`select count(*)::int n from app."Product" where "storeId"=$1`, [storeId])).rows[0].n;
    ok('three feeds imported', total === 8, 'products=' + total);

    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [storeId])).rows[0].id;
    const tpl = { name: 'genel', type: 'percentage', value: 30, applyTo: 'price_template', conditions: { connectionId: conn, commissionBasis: 'gross', commissionPct: 10, shippingCost: 10, vatRate: null } };
    ok('price template created', (await a('POST', '/pricing', tpl)).s === 201);

    // ---- summary + facets
    const sum = (await a('GET', '/products/summary')).d;
    ok('summary: totals add up', sum.total === 8 && sum.active + sum.passive === sum.total, JSON.stringify(sum));
    ok('summary: stock-out and image-less products counted', sum.outOfStock >= 2 && sum.noImage >= 1, `out=${sum.outOfStock} noImage=${sum.noImage}`);
    const sumOne = (await a('GET', `/products/summary?xmlSourceId=${sources['feed-english.xml'].id}`)).d;
    ok('summary can be limited to one XML source', sumOne.total === 2, String(sumOne.total));
    const fac = (await a('GET', '/products/facets')).d;
    ok('facets: categories and brands with counts', fac.categories.some((x) => x.name === 'Giyim|Kadın|Elbise' && x.count === 1) && fac.brands.some((x) => x.name === 'Clickr' && x.count === 2));

    // ---- list: filters, sorting, paging
    const outList = (await a('GET', '/products?stockFilter=out&limit=50')).d;
    ok('stock filter "out" only returns products without stock', outList.products.length === sum.outOfStock && outList.products.every((p) => p.stock <= 0));
    const lowList = (await a('GET', '/products?stockFilter=low&limit=50')).d;
    ok('stock filter "low" = 1..5', lowList.products.every((p) => p.stock >= 1 && p.stock <= 5), String(lowList.products.length));
    const byBrand = (await a('GET', '/products?brand=Clickr')).d; ok('brand filter', byBrand.pagination.total === 2);
    const byCat = (await a('GET', '/products?category=' + encodeURIComponent('Computers'))).d; ok('category filter is path aware ("Computers" finds Computers|Cables…)', byCat.pagination.total === 2, String(byCat.pagination.total));
    const srch = (await a('GET', '/products?search=wIrElEsS')).d; ok('search is case-insensitive', srch.pagination.total === 1);
    const asc = (await a('GET', '/products?sortBy=xmlPrice&sortOrder=asc&limit=50')).d.products.map((p) => p.xmlPrice);
    const desc = (await a('GET', '/products?sortBy=xmlPrice&sortOrder=desc&limit=50')).d.products.map((p) => p.xmlPrice);
    ok('sorting by purchase price works both ways', asc.every((v, i) => i === 0 || asc[i - 1] <= v) && desc.every((v, i) => i === 0 || desc[i - 1] >= v) && asc.length === 8);
    const bad = await a('GET', '/products?sortBy=passwordHash&limit=3'); ok('unknown sort column is ignored, not an error', bad.s === 200);
    const clamp = (await a('GET', '/products?limit=5000')).d; ok('page size is capped at 100', clamp.pagination.limit === 100);
    const pg1 = (await a('GET', '/products?limit=3&page=1&sortBy=sku&sortOrder=asc')).d, pg2 = (await a('GET', '/products?limit=3&page=2&sortBy=sku&sortOrder=asc')).d;
    ok('paging: no overlap, pages add up', pg1.products.length === 3 && pg2.products.length === 3 && pg1.pagination.totalPages === 3 && !pg1.products.some((p) => pg2.products.find((q) => q.id === p.id)));
    ok('list rows do not carry the heavy fields', !('rawXmlData' in pg1.products[0]) && !('description' in pg1.products[0]) && 'hasDescription' in pg1.products[0]);

    // ---- per-marketplace pricing on the list
    const priced = (await a('GET', `/products?limit=50&priceFor=${conn}`)).d.products;
    ok('priceFor adds a sale price, rule and profit to every product', priced.every((p) => p.pricing && p.pricing.salePrice > 0 && p.pricing.rule === 'genel'));
    const mouse = priced.find((p) => p.sku === 'EN-1');
    ok('profit shown equals the requested 30% of the purchase price', Math.abs(mouse.pricing.profit - mouse.xmlPrice * 0.3) < 0.02, `purchase ${mouse.xmlPrice} profit ${mouse.pricing.profit} price ${mouse.pricing.salePrice}`);
    ok('readiness issues are reported (no category mapping yet)', priced.every((p) => p.pricing.issues.some((i) => i.code === 'no_category_mapping')));
    const foreignConn = await b('GET', `/products?priceFor=${conn}`); ok("another store cannot price against my marketplace connection", foreignConn.s === 404);

    // ---- detail panel
    const det = (await a('GET', `/products/${mouse.id}/detail`)).d;
    ok('detail: product, parsed images, feed copy', det.product.sku === 'EN-1' && det.product.images.length === 2 && det.feed && det.feed.sku === 'EN-1' && det.feedHidden === false);
    const m0 = det.marketplaces.find((m) => m.connectionId === conn);
    ok('detail: price breakdown per marketplace', m0 && m0.pricing && m0.pricing.rule === 'genel' && m0.pricing.vatRate === 20 && m0.pricing.breakdown.profit > 0, m0 && m0.pricing && JSON.stringify(m0.pricing.breakdown));
    ok('detail: blocking reasons listed', m0.ready === false && m0.issues.length > 0);
    ok('detail: change history present', Array.isArray(det.logs) && det.logs.length >= 1);
    ok("another store cannot open my product's detail", (await b('GET', `/products/${mouse.id}/detail`)).s === 404);

    // ---- stats: only marketplace status counts now (the old readiness count used other tenants' rules)
    const st = (await a('GET', `/products/stats?connectionId=${conn}`)).d;
    ok('stats: marketplace status counts for a connection', st.total === 8 && st.mpStatus.not_sent === 8 && st.ready === undefined, JSON.stringify(st.mpStatus));
    const ids = (await a('GET', '/products/ids?stockFilter=out')).d; ok('"select all pages" ids follow the same filters', ids.total === sum.outOfStock);
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const u of [A, B]) { await c.query(`delete from app."SyncLog" where "storeId"=$1`, [u.user.stores[0].id]).catch(() => {}); await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch((e) => console.log('cleanup:', e.message)); }
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
