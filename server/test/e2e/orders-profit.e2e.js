// Profit panel of the orders page: what the customer paid, commission / fee / shipping (real or estimated), our cost, profit.
// Orders and the "real" Trendyol figures are inserted straight into the database for temporary users; no marketplace is called
// except by the refresh check, which uses fake keys and must fail politely.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/orders-profit.e2e.js
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const mk = (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: tag }) }).then((r) => r.json());
  const A = await mk('profitA'), B = await mk('profitB');
  const call = (tok) => async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* none */ } return { s: r.status, d }; };
  const a = call(A.token), b = call(B.token); const store = A.user.stores[0];
  const near = (x, y) => Math.abs(x - y) < 0.011;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [store.id])).rows[0].id;
    await a('POST', '/products', { sku: 'OP-1', barcode: 'e2e-op1', title: 'Kâr ürünü', price: 100, vatRate: 20, stock: 5, category: 'Kolye' });
    await c.query(`update app."Product" set "xmlPrice"=100 where "storeId"=$1`, [store.id]);

    const line = (o) => JSON.stringify([{ quantity: 1, vatRate: 20, productName: 'Ürün', lineTyDiscount: 0, ...o }]);
    const order = async (num, status, totalAmount, items, date) => (await c.query(`insert into app."Order"(id,"storeId","connectionId","marketplaceOrderId","orderNumber",status,"totalAmount",items,"orderDate","updatedAt") values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,now()) returning id`, [store.id, conn, 'E2E' + num, 'TY-E2E' + num, status, totalAmount, items, date])).rows[0].id;
    const now = Date.now();
    const o1 = await order(1, 'delivered', 200, line({ barcode: 'e2e-op1', lineGrossAmount: 200, lineSellerDiscount: 0, lineTotalDiscount: 0, commission: 21 }), new Date(now - 5 * 86400000));
    const o2 = await order(2, 'shipped', 881.76, line({ barcode: 'e2e-unknown', lineGrossAmount: 938.1, lineSellerDiscount: 56.34, lineTotalDiscount: 56.34, commission: 16 }), new Date(now - 2 * 86400000));
    await order(3, 'cancelled', 100, line({ barcode: 'e2e-op1', lineGrossAmount: 100, commission: 10 }), new Date(now - 86400000));
    // Trendyol's real figures for order 1 (as read from the statement and the cargo invoice)
    await c.query(`insert into app."OrderFinance"(id,"orderId","commissionAmount","commissionRate","cargoAmount") values(gen_random_uuid(),$1,42,21,103.49)`, [o1]);

    const get = async (qs = '') => (await a('GET', '/orders/profit' + qs));
    let r = await get();
    ok('the panel answers with rows, a summary and the estimate settings', r.s === 200 && r.d.rows.length === 3 && r.d.summary && r.d.settings, JSON.stringify(r.d && r.d.summary));
    const row = (res, num) => res.d.rows.find((x) => x.marketplaceOrderId === 'E2E' + num);
    const x1 = row(r, 1), x2 = row(r, 2), x3 = row(r, 3);
    ok('order 1: list price, discounted sale and what the customer paid', x1.gross === 200 && x1.discounted === 200 && x1.customerPaid === 200);
    ok('order 1: commission and cargo are Trendyol\'s real figures', x1.commission === 42 && x1.commissionSource === 'trendyol' && x1.cargo === 103.49 && x1.cargoSource === 'trendyol');
    ok('order 1: platform fee is the 13.19 estimate', x1.serviceFee === 13.19 && x1.serviceFeeSource === 'estimate');
    ok('order 1: the cost comes from the product (100)', x1.cost === 100 && x1.lines[0].costSource === 'product');
    ok('order 1: profit = 200/1.2 - 42 - 13.19 - 103.49 - 100', near(x1.profit, -92.01) && x1.exact === true, String(x1.profit));
    ok('order 2: list 938.10, seller discount 56.34 -> 881.76 sale and paid', x2.gross === 938.1 && x2.sellerDiscount === 56.34 && x2.discounted === 881.76 && x2.customerPaid === 881.76);
    ok('order 2: commission is estimated from the line rate (16%)', near(x2.commission, 141.08) && x2.commissionSource === 'estimate');
    ok('order 2: cargo is estimated with the average of the known invoices (103.49)', x2.cargo === 103.49 && x2.cargoSource === 'estimate');
    ok('order 2: no product -> cost unknown and NO profit is invented', x2.costMissing === true && x2.cost === null && x2.profit === null);
    ok('cancelled order is listed but marked excluded', x3.excluded === true);
    ok('summary leaves the cancelled one out and counts the unknown', r.d.summary.orders === 2 && r.d.summary.excluded === 1 && r.d.summary.unknownProfit === 1 && r.d.summary.profitOrders === 1 && near(r.d.summary.profit, -92.01), JSON.stringify(r.d.summary));

    // the cost seen at the time stays: change the product's cost afterwards
    await wait(1200);
    const snap = (await c.query(`select "lineCosts" from app."Order" where id=$1`, [o1])).rows[0].lineCosts;
    ok('the order kept the product cost as a snapshot', snap && JSON.parse(snap)['e2e-op1'] === 100, String(snap));
    await c.query(`update app."Product" set "xmlPrice"=150 where "storeId"=$1`, [store.id]);
    r = await get();
    ok('a later purchase price change does not rewrite the old order', row(r, 1).cost === 100 && near(row(r, 1).profit, -92.01));

    // a cost typed by hand
    for (const bad of [0, -5, 'abc']) ok(`cost rejected: ${JSON.stringify(bad)}`, (await a('PUT', '/orders/profit/cost', { barcode: 'e2e-unknown', unitCost: bad })).s === 400);
    ok('cost without a barcode is rejected', (await a('PUT', '/orders/profit/cost', { unitCost: 10 })).s === 400);
    ok('cost saved', (await a('PUT', '/orders/profit/cost', { barcode: 'e2e-unknown', unitCost: 300 })).s === 200);
    r = await get();
    ok('order 2 now has a profit: 881.76/1.2 - 141.08 - 13.19 - 103.49 - 300', near(row(r, 2).profit, 177.04) && row(r, 2).lines[0].costSource === 'manual', String(row(r, 2).profit));
    ok('the other store does not see my orders or my typed cost', (await b('GET', '/orders/profit')).d.rows.length === 0);
    await b('PUT', '/orders/profit/cost', { barcode: 'e2e-unknown', unitCost: 1 });
    ok('and its own cost for the same barcode does not touch mine', near(row(await get(), 2).profit, 177.04));
    ok('cost removed', (await a('PUT', '/orders/profit/cost', { barcode: 'e2e-unknown', unitCost: null })).s === 200 && row(await get(), 2).profit === null);

    // settings
    ok('bad estimate settings are rejected', (await a('PUT', '/orders/profit/settings', { serviceFee: 'abc' })).s === 400 && (await a('PUT', '/orders/profit/settings', { serviceFee: -1 })).s === 400);
    const st = await a('PUT', '/orders/profit/settings', { serviceFee: 20, cargoEstimate: 80 });
    ok('settings saved', st.s === 200 && st.d.settings.serviceFee === 20 && st.d.settings.cargoEstimate === 80);
    r = await get();
    ok('they apply to the estimates only (order 2) and the platform fee to both', row(r, 2).cargo === 80 && row(r, 1).cargo === 103.49 && row(r, 1).serviceFee === 20);

    // filters
    ok('status filter', (await get('?status=delivered')).d.rows.length === 1);
    ok('search by order number', (await get('?q=E2E2')).d.rows.length === 1);
    const today = new Date().toISOString().slice(0, 10);
    ok('date filter keeps recent orders', (await get(`?from=${today}&to=${today}`)).d.rows.length === 0 && (await get('?from=2000-01-01&to=2100-01-01')).d.rows.length === 3);
    ok('paging', (await get('?limit=1&page=2')).d.rows.length === 1 && (await get('?limit=1')).d.pagination.totalPages === 3);

    // supplier service fee: set on the XML source, only for products of that source
    const before1 = row(await get(), 1);
    const src = (await c.query(`insert into app."XmlSource"(id,"storeId",name,url,"orderServiceFee","updatedAt") values(gen_random_uuid(),$1,'e2e-biii','https://example.invalid/x.xml',0,now()) returning id`, [store.id])).rows[0].id;
    const o4 = await order(4, 'delivered', 200, line({ barcode: 'e2e-op1', lineGrossAmount: 200, commission: 21 }), new Date(now - 6 * 86400000));
    await c.query(`update app."Order" set "lineFees"='{}' where id=$1`, [o4]);   // arrived while the source charged nothing
    await c.query(`update app."Product" set "xmlSourceId"=$1 where "storeId"=$2 and barcode='e2e-op1'`, [src, store.id]);
    ok('no fee on the source -> no supplier fee', row(await get(), 1).supplierFee === 0);
    ok('the fee is validated (negative / text rejected)', (await a('PUT', `/xml-sources/${src}`, { orderServiceFee: -5 })).s === 400 && (await a('PUT', `/xml-sources/${src}`, { orderServiceFee: 'abc' })).s === 400);
    ok('another store cannot change my source\'s fee', [403, 404].includes((await b('PUT', `/xml-sources/${src}`, { orderServiceFee: 99 })).s) && (await c.query(`select "orderServiceFee" f from app."XmlSource" where id=$1`, [src])).rows[0].f === 0);
    const put = await a('PUT', `/xml-sources/${src}`, { orderServiceFee: 30 });
    ok('fee of 30 TL per product saved on the source', put.s === 200 && put.d.orderServiceFee === 30);
    r = await get();
    ok('order 1 (product of that source) now carries 30 TL and the profit drops by exactly that', row(r, 1).supplierFee === 30 && near(before1.profit - row(r, 1).profit, 30), `${before1.profit} -> ${row(r, 1).profit}`);
    ok('an order that arrived while there was no fee keeps its snapshot (0)', row(r, 4).supplierFee === 0);
    ok('products that are not from that source (order 2) pay no fee', row(r, 2).supplierFee === 0);
    ok('the summary adds the supplier fee up', r.d.summary.supplierFee === 30, String(r.d.summary.supplierFee));
    await a('PUT', `/xml-sources/${src}`, { orderServiceFee: 45 });
    r = await get();
    ok('changing the fee later changes orders without a snapshot, not the one with one', row(r, 1).supplierFee === 45 && row(r, 4).supplierFee === 0);
    await a('PUT', `/xml-sources/${src}`, { orderServiceFee: 0 });
    ok('fee removed -> 0 again', row(await get(), 1).supplierFee === 0);

    // refresh with fake keys must fail politely, never throw a 500
    const ref = await a('POST', '/orders/profit/refresh');
    ok('refresh with unusable keys answers 200 with a message', ref.s === 200 && typeof ref.d.message === 'string', JSON.stringify(ref.d).slice(0, 200));

    ok('not logged in -> 401', (await fetch(API + '/orders/profit')).status === 401);
  } catch (e) { console.log('FAIL  unexpected error', e.message); fails++; }
  finally {
    for (const u of [A, B]) if (u && u.user) await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch(() => {});
    const left = await c.query(`select count(*)::int n from app."User" where email like 'tmp-profit%@example.invalid'`);
    console.log('leftover temp users: ' + left.rows[0].n);
    await c.end();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
