// A sale price typed in by hand for one product on one marketplace: saved, shown, honoured by the list and the
// readiness check, removable, isolated between stores.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/manual-price.e2e.js
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const mk = (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: tag }) }).then((r) => r.json());
  const A = await mk('manualA'), B = await mk('manualB');
  const call = (tok) => async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* none */ } return { s: r.status, d }; };
  const a = call(A.token), b = call(B.token); const store = A.user.stores[0];
  const near = (x, y) => Math.abs(x - y) < 0.011;
  try {
    const mkConn = async () => (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [store.id])).rows[0].id;
    const conn1 = await mkConn(), conn2 = await mkConn();
    // template only on conn1: shipping 10, commission 10% of the sale price, profit 30% of purchase, VAT from the product (20)
    const tpl = await a('POST', '/pricing', { name: 'e2e', type: 'percentage', value: 30, applyTo: 'price_template', conditions: { connectionId: conn1, shippingCost: 10, packagingCost: 0, commissionPct: 10, commissionBasis: 'gross', vatRate: null, profitMode: 'percent_of_purchase', roundingMode: 'none' } });
    ok('template created', tpl.s === 201);
    const p1 = (await a('POST', '/products', { sku: 'M-1', barcode: 'e2e-m1', title: 'Elle fiyat 1', price: 100, vatRate: 20, stock: 5, category: 'Kolye' })).d;
    const p2 = (await a('POST', '/products', { sku: 'M-2', barcode: 'e2e-m2', title: 'Elle fiyat 2', price: 100, vatRate: 20, stock: 5, category: 'Kolye' })).d;
    await c.query(`update app."Product" set "xmlPrice"=100 where "storeId"=$1`, [store.id]);
    const row = async (conn, id) => (await a('GET', `/products?priceFor=${conn}&limit=50`)).d.products.find((x) => x.id === id);

    // starting point: the template prices the product on conn1, nothing on conn2
    let r1 = await row(conn1, p1.id);
    const templatePrice = r1.pricing.salePrice;
    ok('template price on the first marketplace, not manual', templatePrice > 100 && r1.pricing.manual === false && r1.pricing.rule === 'e2e', JSON.stringify(r1.pricing));
    ok('no template on the second marketplace -> blocked for lack of a price', (await row(conn2, p1.id)).pricing.issues.some((i) => i.code === 'no_price_rule'));

    // preview: what a price would earn (no saving)
    const pv = await a('GET', `/products/${p1.id}/price-preview?connectionId=${conn1}&price=300`);
    ok('preview: profit from the template costs (300 incl. 20% VAT -> 250 net - 110 cost - 30 commission)', pv.s === 200 && near(pv.d.profit, 110) && pv.d.loss === false && near(pv.d.templatePrice, templatePrice), JSON.stringify(pv.d).slice(0, 160));
    ok('preview: a price under cost is flagged as a loss', (await a('GET', `/products/${p1.id}/price-preview?connectionId=${conn1}&price=90`)).d.loss === true);
    ok('preview does not save anything', (await row(conn1, p1.id)).pricing.manual === false);

    // validation
    for (const bad of [0, -5, 'abc', '', null, 1e9]) {
      const r = await a('PUT', `/products/${p1.id}/sale-price`, { connectionId: conn1, price: bad });
      ok(`rejected: price ${JSON.stringify(bad)}`, r.s === 400, r.d && r.d.error);
    }
    ok('a connection that is not mine is refused', (await a('PUT', `/products/${p1.id}/sale-price`, { connectionId: '00000000-0000-0000-0000-000000000000', price: 300 })).s === 404);

    // loss needs a confirmation
    const loss = await a('PUT', `/products/${p1.id}/sale-price`, { connectionId: conn1, price: 90 });
    ok('a price that loses money is refused until it is confirmed', loss.s === 409 && loss.d.loss === true && (await row(conn1, p1.id)).pricing.manual === false, JSON.stringify(loss.d));

    // save, then everything shows the new price
    const put = await a('PUT', `/products/${p1.id}/sale-price`, { connectionId: conn1, price: 300 });
    ok('hand-typed price saved', put.s === 200 && put.d.pricing.salePrice === 300 && put.d.pricing.manual === true, JSON.stringify(put.d));
    r1 = await row(conn1, p1.id);
    ok('the list shows it at once: price, manual flag, template price kept, profit at that price', r1.pricing.salePrice === 300 && r1.pricing.manual === true && near(r1.pricing.templatePrice, templatePrice) && near(r1.pricing.profit, 110) && r1.pricing.rule === 'Elle girilen fiyat', JSON.stringify(r1.pricing));
    ok('only this product changed', (await row(conn1, p2.id)).pricing.manual === false);
    ok('and only this marketplace: the other one still has no price for it', (await row(conn2, p1.id)).pricing.salePrice === null);
    const put2 = await a('PUT', `/products/${p1.id}/sale-price`, { connectionId: conn1, price: '349,9' });
    ok('a Turkish-style number is accepted and replaces the previous price', put2.s === 200 && put2.d.pricing.salePrice === 349.9 && (await c.query(`select count(*)::int n from app."ProductPriceOverride" where "productId"=$1`, [p1.id])).rows[0].n === 1);

    // a typed price makes a product without a template usable on that marketplace
    const put3 = await a('PUT', `/products/${p1.id}/sale-price`, { connectionId: conn2, price: 250 });
    const r2 = await row(conn2, p1.id);
    ok('without a template, a typed price removes the "no price" block', put3.s === 200 && r2.pricing.salePrice === 250 && !r2.pricing.issues.some((i) => i.code === 'no_price_rule'), JSON.stringify(r2.pricing.issues.map((i) => i.code)));
    ok('the price is not below cost, so no price warning either', !r2.pricing.issues.some((i) => i.code === 'price_below_cost'));

    // the detail panel and the history
    const det = await a('GET', `/products/${p1.id}/detail`);
    const m1 = det.d.marketplaces.find((m) => m.connectionId === conn1);
    ok('detail panel: manual price with the template price next to it', m1.pricing.manual === true && m1.pricing.salePrice === 349.9 && m1.pricing.rule === 'Elle girilen fiyat' && near(m1.pricing.templatePrice, templatePrice));
    ok('the change is in the product history', det.d.logs.some((l) => l.type === 'manual' && /elle/i.test(l.notes || '') && l.newPrice === 349.9));

    // back to the template
    const del = await a('DELETE', `/products/${p1.id}/sale-price?connectionId=${conn1}`);
    ok('"back to the template" removes the typed price', del.s === 200 && del.d.removed === 1 && near(del.d.pricing.salePrice, templatePrice), JSON.stringify(del.d));
    ok('and the list shows the template price again', (await row(conn1, p1.id)).pricing.manual === false);
    ok('removing twice is harmless', (await a('DELETE', `/products/${p1.id}/sale-price?connectionId=${conn1}`)).d.removed === 0);

    // isolation
    ok('another store cannot read, set or remove prices of my product', (await b('GET', `/products/${p1.id}/price-preview?connectionId=${conn1}&price=300`)).s === 404
      && (await b('PUT', `/products/${p1.id}/sale-price`, { connectionId: conn1, price: 300 })).s === 404 && (await b('DELETE', `/products/${p1.id}/sale-price?connectionId=${conn1}`)).s === 404);
    const bp = (await b('POST', '/products', { sku: 'B-1', barcode: 'e2e-b1', title: 'B ürünü', price: 100, vatRate: 20, stock: 1 })).d;
    ok('my marketplace cannot be used for someone else\'s product either', (await b('PUT', `/products/${bp.id}/sale-price`, { connectionId: conn1, price: 300 })).s === 404);

    // products without an XML source ("added by hand") can be selected as their own group
    const none = await a('GET', '/products?xmlSourceId=none&limit=50');
    ok('xmlSourceId=none lists the hand-added products only', none.s === 200 && none.d.products.length === 2 && none.d.products.every((p) => p.xmlSourceId === null));
    ok('summary for that group', (await a('GET', '/products/summary?xmlSourceId=none')).d.total === 2);
    ok('a real XML source id that has no products gives an empty list', (await a('GET', '/products?xmlSourceId=00000000-0000-0000-0000-000000000000')).d.products.length === 0);

    // deleting the product removes its typed prices
    await a('PUT', `/products/${p2.id}/sale-price`, { connectionId: conn1, price: 280 });
    ok('typed price exists', (await c.query(`select count(*)::int n from app."ProductPriceOverride" where "productId"=$1`, [p2.id])).rows[0].n === 1);
    await a('DELETE', `/products/${p2.id}`);
    ok('deleting the product removes its typed prices', (await c.query(`select count(*)::int n from app."ProductPriceOverride" where "productId"=$1`, [p2.id])).rows[0].n === 0);
  } catch (e) { console.log('ERROR', e); fails++; }
  finally {
    for (const u of [A, B]) await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
