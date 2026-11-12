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
    // a store that never saved anything gets the tax options ON (VAT payer, 20% VAT in purchases, 1% stopaj); the older checks below run with them OFF
    // (checked on the other store, so this store's first view is still the first one: the cost snapshot is made then)
    const fresh = (await b('GET', '/orders/profit')).d.settings;
    ok('by default the profit uses the tax options (KDV mükellefiyim, 20% purchase VAT, 1% stopaj)', fresh.inputVat === true && fresh.purchaseVatRate === 20 && fresh.withholdingPct === 1, JSON.stringify(fresh));
    ok('the older method is still available (options switched off)', (await a('PUT', '/orders/profit/settings', { inputVat: false, withholdingPct: 0 })).d.settings.inputVat === false);
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
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);   // the page filters by Turkey time
    ok('date filter keeps recent orders', (await get(`?from=${today}&to=${today}`)).d.rows.length === 0 && (await get('?from=2000-01-01&to=2100-01-01')).d.rows.length === 3);
    ok('paging', (await get('?limit=1&page=2')).d.rows.length === 1 && (await get('?limit=1')).d.pagination.totalPages === 3);

    // "Diğer gider" of the PRICE TEMPLATE (e.g. the supplier's service fee per unit): taken off the profit for the products the template prices
    const before1 = row(await get(), 1);
    const src = (await c.query(`insert into app."XmlSource"(id,"storeId",name,url,"orderServiceFee","updatedAt") values(gen_random_uuid(),$1,'e2e-biii','https://example.invalid/x.xml',0,now()) returning id`, [store.id])).rows[0].id;
    const o4 = await order(4, 'delivered', 200, line({ barcode: 'e2e-op1', lineGrossAmount: 200, commission: 21 }), new Date(now - 6 * 86400000));
    await c.query(`update app."Product" set "xmlSourceId"=$1 where "storeId"=$2 and barcode='e2e-op1'`, [src, store.id]);
    const tplConds = (other) => ({ connectionId: conn, xmlSourceIds: [src], commissionBasis: 'gross', commissionPct: 20, shippingCost: 50, packagingCost: other, vatRate: null, profitMode: 'percent_of_purchase', profitTiers: [], shippingTiers: [] });
    ok('no template covers the product -> no other cost', row(await get(), 1).otherCost === 0);
    const tpl = await a('POST', '/pricing', { name: 'e2e şablon', type: 'percentage', value: 30, applyTo: 'price_template', conditions: tplConds(30) });
    ok('template with "Diğer gider" 30 saved', tpl.s === 201);
    r = await get();
    ok('order 1 (a product that template prices) now carries 30 TL and the profit drops by exactly that', row(r, 1).otherCost === 30 && near(before1.profit - row(r, 1).profit, 30), `${before1.profit} -> ${row(r, 1).profit}`);
    ok('the line shows the amount per unit', row(r, 1).lines[0].unitOther === 30);
    ok('products no template prices (order 2) pay nothing', row(r, 2).otherCost === 0);
    await c.query(`update app."Order" set "lineFees"=$2 where id=$1`, [o4, JSON.stringify({ 'e2e-op1': 10 })]);   // arrived when the template said 10
    r = await get();
    ok('an order with a saved amount keeps it (10), the others follow the template (30)', row(r, 4).otherCost === 10 && row(r, 1).otherCost === 30);
    ok('the summary adds the other cost up', r.d.summary.otherCost === 40, String(r.d.summary.otherCost));
    await a('PUT', `/pricing/${tpl.d.id}`, { conditions: tplConds(45) });
    r = await get();
    ok('changing the template changes orders without a saved amount, not the one with one', row(r, 1).otherCost === 45 && row(r, 4).otherCost === 10);
    await a('PUT', `/pricing/${tpl.d.id}`, { conditions: tplConds(0) });
    ok('"Diğer gider" removed from the template -> 0 again (the saved one stays)', row(await get(), 1).otherCost === 0 && row(await get(), 4).otherCost === 10);
    ok('another store\'s templates do not touch my orders', (await b('GET', '/orders/profit')).d.rows.length === 0);
    // the old per-XML-source field is gone: the API ignores it and nothing reads it
    await a('PUT', `/xml-sources/${src}`, { orderServiceFee: 99 });
    ok('the XML source API ignores the old field and the profit does not read it', (await c.query(`select "orderServiceFee" f from app."XmlSource" where id=$1`, [src])).rows[0].f === 0 && row(await get(), 1).otherCost === 0);
    await a('DELETE', `/pricing/${tpl.d.id}`);

    // refresh with fake keys must fail politely, never throw a 500
    const ref = await a('POST', '/orders/profit/refresh');
    ok('refresh with unusable keys answers 200 with a message', ref.s === 200 && typeof ref.d.message === 'string', JSON.stringify(ref.d).slice(0, 200));

    await c.query(`update app."Order" set "lineFees"=null where id=$1`, [o4]);   // back to "no amount" for the tax checks below
    // tax options: the owner's model (VAT payer: VAT inside costs comes back; stopaj on the VAT-exclusive revenue)
    ok('bad tax options are rejected', (await a('PUT', '/orders/profit/settings', { inputVat: 'yes' })).s === 400 && (await a('PUT', '/orders/profit/settings', { withholdingPct: 50 })).s === 400 && (await a('PUT', '/orders/profit/settings', { purchaseVatRate: -1 })).s === 400);
    const on = await a('PUT', '/orders/profit/settings', { serviceFee: 13.19, cargoEstimate: null, inputVat: true, purchaseVatRate: 20, withholdingPct: 1 });
    ok('tax options saved', on.s === 200 && on.d.settings.inputVat === true && on.d.settings.withholdingPct === 1);
    ok('saving only the estimates leaves the tax options as they were', (await a('PUT', '/orders/profit/settings', { serviceFee: 13.19, cargoEstimate: null })).d.settings.withholdingPct === 1);
    r = await get();
    const t1 = row(r, 1);
    // order 1: sale 200 (VAT 33.33), commission 42, fee 13.19, cargo 103.49, cost 100: VAT inside = 16.67 + 17.25 + 7.00 + 2.20 -> to pay -9.79 (a credit); stopaj 1.67
    ok('order 1 with the tax model: stopaj 1.67, VAT to pay -9.79, net profit -50.56', t1.taxModel === true && near(t1.stopaj, 1.67) && near(t1.payableVat, -9.79) && near(t1.profit, -50.56), JSON.stringify([t1.stopaj, t1.payableVat, t1.profit]));
    ok('with the VAT breakdown', t1.vatDetail && near(t1.vatDetail.sale, 33.33) && near(t1.vatDetail.purchase, 16.67) && near(t1.vatDetail.cargo, 17.25) && near(t1.vatDetail.commission, 7) && near(t1.vatDetail.serviceFee, 2.2));
    ok('order 2 (no cost yet): stopaj is known, VAT to pay and profit are not invented', row(r, 2).stopaj > 0 && row(r, 2).payableVat === null && row(r, 2).profit === null);
    ok('the summary carries stopaj and the VAT to pay (orders 1 and 4 have a known profit: -9.79 and -18.12, the product cost of order 4 was raised to 150 earlier in this test)', r.d.summary.taxModel === true && r.d.summary.stopaj > 0 && near(r.d.summary.payableVat, -27.91), JSON.stringify([r.d.summary.stopaj, r.d.summary.payableVat, r.d.rows.map((x) => [x.marketplaceOrderId, x.status, x.cost, x.cargo, x.supplierFee, x.payableVat, x.profit])]));

    // shipping fee typed in by hand (seller panel "Sipariş Kayıtları"), used until Trendyol's cargo invoice exists
    ok('bad shipping amounts are rejected', (await a('PUT', '/orders/profit/cargo', { orderId: o4, amount: -5 })).s === 400 && (await a('PUT', '/orders/profit/cargo', { orderId: o4, amount: 'abc' })).s === 400);
    ok('an unknown order is refused', (await a('PUT', '/orders/profit/cargo', { orderId: '00000000-0000-0000-0000-000000000000', amount: 100 })).s === 404 && (await a('PUT', '/orders/profit/cargo', { amount: 100 })).s === 404);
    ok('another store cannot set the shipping of my order', (await b('PUT', '/orders/profit/cargo', { orderId: o4, amount: 1 })).s === 404);
    const before4 = row(await get(), 4);
    ok('order 4 (no invoice yet) uses the estimate', before4.cargoSource === 'estimate' && before4.exact === false);
    ok('shipping typed in', (await a('PUT', '/orders/profit/cargo', { orderId: o4, amount: 120 })).s === 200);
    r = await get();
    const m4 = row(r, 4);
    ok('it replaces the estimate and changes the profit (order 4 stays "not exact": its commission is still an estimate)', m4.cargo === 120 && m4.cargoSource === 'manual' && m4.exact === false && m4.profit !== before4.profit, JSON.stringify([m4.cargo, m4.cargoSource, before4.profit, m4.profit]));
    ok('the VAT to pay follows the typed amount (VAT inside 120 = 20)', near(m4.vatDetail.cargo, 20), JSON.stringify(m4.vatDetail));
    ok('Trendyol\'s invoice figure beats a typed amount (order 1 has 103,49 from the invoice)', (await a('PUT', '/orders/profit/cargo', { orderId: o1, amount: 50 })).s === 200 && row(await get(), 1).cargo === 103.49 && row(await get(), 1).cargoSource === 'trendyol');
    ok('shipping removed -> the estimate again', (await a('PUT', '/orders/profit/cargo', { orderId: o4, amount: null })).s === 200 && row(await get(), 4).cargoSource === 'estimate');

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
