// What happens to products when the XML feed changes, and the tools around hand-typed sale prices:
//   - a product that leaves the feed gets stock 0 (and comes back with the feed); a feed that looks broken is never acted on
//   - a purchase price rise that pushes a hand-priced product into loss is reported once, and the row/detail say so
//   - hand-typed prices can be given back to the price template (selected products or everything in a view)
// Needs the fixtures feed-stock-*.xml to be pushed to the repository first (the API downloads them from GitHub).
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/feed-changes.e2e.js
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';
(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const mk = (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: tag }) }).then((r) => r.json());
  const A = await mk('feedA'), B = await mk('feedB');
  const call = (tok) => async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* none */ } return { s: r.status, d }; };
  const a = call(A.token), b = call(B.token); const store = A.user.stores[0], storeB = B.user.stores[0];
  const near = (x, y) => Math.abs(x - y) < 0.011;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sync = async (id) => {
    for (let i = 0; i < 5; i++) { const r = await a('POST', `/xml-sources/${id}/sync`); if (r.s === 202 || r.s === 409) break; await sleep(1000); }
    let last;
    for (let i = 0; i < 60; i++) { await sleep(1500); last = (await a('GET', `/xml-sources/${id}/sync-status`)).d; if (!last.running && last.last && last.last.status !== 'started') break; }
    return last.last;
  };
  const stocks = async (src) => Object.fromEntries((await c.query(`select sku, stock from app."Product" where "xmlSourceId"=$1`, [src])).rows.map((r) => [r.sku, r.stock]));
  const notes = async () => (await c.query(`select title, message, type, data from app."Notification" where "storeId"=$1 order by "createdAt"`, [store.id])).rows;
  const lastSyncNote = async () => (await notes()).filter((n) => n.data && n.data.notifType === 'xml_sync').pop();
  const lossNotes = async () => (await notes()).filter((n) => n.data && n.data.notifType === 'manual_price_loss');
  try {
    // ── set-up: a source with six products, a marketplace with a template, some hand-typed prices
    const src = (await a('POST', '/xml-sources', { name: 'stok-a', url: base + 'feed-stock-a.xml', syncIntervalMin: 60, defaultVatRate: 20 })).d.id;
    let l = await sync(src);
    let st = await stocks(src);
    ok('first sync: six products, stock 10 each', l.status === 'completed' && Object.keys(st).length === 6 && Object.values(st).every((v) => v === 10), JSON.stringify(st));

    // "disconnected" so the automatic marketplace update never touches this fake connection
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret",status,"updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s','disconnected',now()) returning id`, [store.id])).rows[0].id;
    // shipping 10, commission 10% of the sale price, profit 30% of the purchase price; products above 300 purchase are NOT covered
    const tpl = await a('POST', '/pricing', { name: 'e2e', type: 'percentage', value: 30, applyTo: 'price_template', conditions: { connectionId: conn, shippingCost: 10, packagingCost: 0, commissionPct: 10, commissionBasis: 'gross', vatRate: null, profitMode: 'percent_of_purchase', roundingMode: 'none', maxPurchasePrice: 300 } });
    ok('template created', tpl.s === 201);
    const pid = async (sku, s = src) => (await c.query(`select id from app."Product" where "xmlSourceId"=$1 and sku=$2`, [s, sku])).rows[0].id;
    const ids = {}; for (const k of ['V-001', 'V-002', 'V-003', 'V-004', 'V-005', 'V-006']) ids[k] = await pid(k);
    const setManual = async (sku, price) => a('PUT', `/products/${ids[sku]}/sale-price`, { connectionId: conn, price });
    ok('hand-typed prices: V-001 300, V-002 250, V-003 200 (profit 36.67 at purchase 100), V-006 700 (no template covers it)',
      (await setManual('V-001', 300)).s === 200 && (await setManual('V-002', 250)).s === 200 && (await setManual('V-003', 200)).s === 200 && (await setManual('V-006', 700)).s === 200);
    const list = async (extra = '') => (await a('GET', `/products?priceFor=${conn}&xmlSourceId=${src}&limit=50${extra}`)).d.products;
    const bySku = (rows) => Object.fromEntries(rows.map((p) => [p.sku, p]));
    let rows = bySku(await list());
    ok('before any change nobody loses money', ['V-001', 'V-002', 'V-003', 'V-006'].every((k) => rows[k].pricing.manual === true && rows[k].pricing.loss === false) && rows['V-004'].pricing.loss === false, JSON.stringify(rows['V-003'].pricing));

    // ── 1) products that leave the feed
    await a('PUT', `/xml-sources/${src}`, { url: base + 'feed-stock-b.xml' });
    l = await sync(src);
    st = await stocks(src);
    ok('products that left the feed have stock 0, the others are untouched', l.status === 'completed' && st['V-005'] === 0 && st['V-006'] === 0 && ['V-001', 'V-002', 'V-003', 'V-004'].every((k) => st[k] === 10), JSON.stringify(st));
    ok('they are NOT deleted and keep their price', (await c.query(`select count(*)::int n from app."Product" where "xmlSourceId"=$1 and "xmlPrice">0`, [src])).rows[0].n === 6);
    const logs = (await c.query(`select type,"oldStock","newStock",notes,source from app."ProductLog" where "productId"=$1 order by "createdAt" desc`, [ids['V-005']])).rows;
    ok('the history says why', logs.some((x) => x.type === 'synced' && x['oldStock'] === 10 && x['newStock'] === 0 && /kalktı/.test(x.notes || '') && x.source === 'xml_sync'), JSON.stringify(logs[0]));
    let n = await lastSyncNote();
    ok('the sync notification reports it, structured', n && /2 ürün XML'den kalktığı için stoğu sıfırlandı/.test(n.message) && n.data.removed === 2 && n.data.removedHeld === 0, n && n.message);
    const det = JSON.parse((await c.query(`select details from app."SyncLog" where "xmlSourceId"=$1 order by "startedAt" desc limit 1`, [src])).rows[0].details);
    ok('the sync record counts them too', det.removed === 2 && det.removedHeld === 0, JSON.stringify(det));

    // ── 2) the purchase price of V-003 rose from 100 to 160 under its hand-typed 200: now a loss, reported once
    let loss = await lossNotes();
    ok('exactly one loss notification, for V-003 only', loss.length === 1 && loss[0].data.total === 1 && loss[0].data.items[0].sku === 'V-003' && loss[0].type === 'warning', JSON.stringify(loss.map((x) => x.data && x.data.items && x.data.items.map((i) => i.sku))));
    const it = loss[0].data.items[0];
    ok('it says old and new purchase price, the hand-typed price and the loss', it.purchaseOld === 100 && it.purchaseNew === 160 && it.price === 200 && it.profit < 0 && it.marketplace, JSON.stringify(it));
    rows = bySku(await list());
    ok('the list marks it on the row; others are not marked', rows['V-003'].pricing.loss === true && rows['V-003'].pricing.manual === true && rows['V-001'].pricing.loss === false && rows['V-004'].pricing.loss === false, JSON.stringify(rows['V-003'].pricing));
    const detail = (await a('GET', `/products/${ids['V-003']}/detail`)).d.marketplaces.find((m) => m.connectionId === conn);
    ok('and the detail panel says so', detail.pricing.loss === true && detail.pricing.manual === true && detail.pricing.breakdown.profit < 0);

    // ── 3) the same feed again: nothing new to report
    l = await sync(src);
    n = await lastSyncNote();
    ok('a second sync of the same feed repeats nothing', l.status === 'completed' && n.data.removed === 0 && (await lossNotes()).length === 1 && (await stocks(src))['V-005'] === 0);

    // ── 4) the products come back with the feed
    await a('PUT', `/xml-sources/${src}`, { url: base + 'feed-stock-a.xml' });
    l = await sync(src);
    st = await stocks(src);
    ok('products that are in the feed again get their stock back', st['V-005'] === 10 && st['V-006'] === 10 && Object.values(st).every((v) => v === 10), JSON.stringify(st));
    rows = bySku(await list());
    ok('a falling purchase price ends the loss and reports nothing', rows['V-003'].pricing.loss === false && (await lossNotes()).length === 1);

    // ── 5) a feed that cannot be read never empties the shop
    await a('PUT', `/xml-sources/${src}`, { url: base + 'feed-stock-empty.xml' });
    l = await sync(src);
    st = await stocks(src);
    ok('an empty feed changes nothing', Object.keys(st).length === 6 && Object.values(st).every((v) => v === 10), `sync ${l.status}: ${JSON.stringify(st)}`);
    await a('PUT', `/xml-sources/${src}`, { url: base + 'feed-stock-a.xml' });

    // ── 6) a feed that suddenly lacks most products is held back and the owner is told
    const big = (await a('POST', '/xml-sources', { name: 'stok-big', url: base + 'feed-stock-big-a.xml', syncIntervalMin: 60, defaultVatRate: 20 })).d.id;
    l = await sync(big);
    ok('big source: 40 products with stock 5', l.status === 'completed' && Object.values(await stocks(big)).filter((v) => v === 5).length === 40);
    await a('PUT', `/xml-sources/${big}`, { url: base + 'feed-stock-big-b.xml' });
    l = await sync(big);
    st = await stocks(big);
    ok('30 of 40 missing: nothing is zeroed', l.status === 'completed' && Object.keys(st).length === 40 && Object.values(st).every((v) => v === 5), JSON.stringify(Object.values(st).filter((v) => v !== 5).length));
    n = await lastSyncNote();
    ok('the owner is told why (warning, count, advice)', n.type === 'warning' && n.data.removed === 0 && n.data.removedHeld === 30 && /30 ürün XML'de görünmüyor ama stokları sıfırlanmadı/.test(n.message) && /kontrol edin/.test(n.message), n.message);
    ok('the first source was not affected by the second', Object.values(await stocks(src)).every((v) => v === 10));

    // ── 7) giving hand-typed prices back to the price template
    let stats = (await a('GET', `/products/stats?connectionId=${conn}&xmlSourceId=${src}`)).d;
    ok('statistics count the hand-priced products of this view', stats.manual === 4, JSON.stringify(stats));
    ok('and none without a marketplace', (await a('GET', `/products/stats?xmlSourceId=${src}`)).d.manual === 0);
    const only = await a('GET', `/products?priceFor=${conn}&xmlSourceId=${src}&manualPriceConnectionId=${conn}&limit=50`);
    ok('the filter lists exactly the hand-priced products', only.s === 200 && only.d.products.length === 4 && only.d.products.every((p) => p.pricing.manual === true), only.d.products && only.d.products.map((p) => p.sku).join(','));
    const idsOnly = await a('GET', `/products/ids?xmlSourceId=${src}&manualPriceConnectionId=${conn}`);
    ok('"select all" ids agree with the filter', idsOnly.d.total === 4);
    ok('another marketplace has none', (await a('GET', `/products?xmlSourceId=${src}&manualPriceConnectionId=00000000-0000-0000-0000-000000000000`)).d.products.length === 0);

    const reset = (body, who = a) => who('POST', '/products/reset-manual-prices', body);
    ok('a scope is required', (await reset({ connectionId: conn })).s === 400);
    ok('an unknown marketplace is refused', (await reset({ connectionId: '00000000-0000-0000-0000-000000000000', xmlSourceId: src })).s === 404);
    ok('another store cannot use my marketplace', (await reset({ connectionId: conn, xmlSourceId: src }, b)).s === 404 && (await reset({ connectionId: conn, productIds: [ids['V-001']] }, b)).s === 404);
    const connB = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret",status,"updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s','disconnected',now()) returning id`, [storeB.id])).rows[0].id;
    const foreign = await reset({ connectionId: connB, productIds: Object.values(ids) }, b);
    ok('another store cannot reset my products through its own marketplace', foreign.s === 200 && foreign.d.removed === 0, JSON.stringify(foreign.d));
    ok('my hand-typed prices are all still there', (await a('GET', `/products/stats?connectionId=${conn}&xmlSourceId=${src}`)).d.manual === 4);
    ok('an empty selection does nothing', (await reset({ connectionId: conn, productIds: [] })).d.removed === 0);
    ok('products that are not hand-priced are ignored', (await reset({ connectionId: conn, productIds: [ids['V-004']] })).d.removed === 0);

    const r1 = await reset({ connectionId: conn, xmlSourceId: src, productIds: [ids['V-001']] });
    ok('selected product: back on the template', r1.s === 200 && r1.d.removed === 1 && r1.d.skippedNoTemplate === 0 && r1.d.productIds[0] === ids['V-001'] && r1.d.activeProductIds.length === 0, JSON.stringify(r1.d));
    rows = bySku(await list());
    ok('its price follows the template again; the other hand-priced ones are untouched', rows['V-001'].pricing.manual === false && rows['V-001'].pricing.salePrice > 100 && rows['V-001'].pricing.salePrice !== 300 && rows['V-002'].pricing.manual === true && rows['V-002'].pricing.salePrice === 250, JSON.stringify(rows['V-001'].pricing));
    const hist = (await c.query(`select "oldPrice","newPrice",notes from app."ProductLog" where "productId"=$1 and type='manual' order by "createdAt" desc limit 1`, [ids['V-001']])).rows[0];
    ok('the history shows old and new price', hist && hist.oldPrice === 300 && near(hist.newPrice, rows['V-001'].pricing.salePrice) && /toplu/.test(hist.notes), JSON.stringify(hist));

    // V-002 is on sale on the marketplace: its new price can be sent right away
    await c.query(`insert into app."MarketplaceProduct"(id,"productId","connectionId",status,"marketplacePrice","marketplaceStock","updatedAt") values(gen_random_uuid(),$1,$2,'active',250,10,now())`, [ids['V-002'], conn]);
    await setManual('V-004', 210);
    const none = await reset({ connectionId: conn, xmlSourceId: 'none' });
    ok('"added by hand" scope does not touch the XML source\'s products', none.s === 200 && none.d.removed === 0 && (await a('GET', `/products/stats?connectionId=${conn}&xmlSourceId=${src}`)).d.manual === 4, JSON.stringify(none.d));
    const all = await reset({ connectionId: conn, xmlSourceId: src });
    ok('everything in the view: covered products go back, the one without a template keeps its price', all.s === 200 && all.d.removed === 3 && all.d.skippedNoTemplate === 1 && !all.d.productIds.includes(ids['V-006']), JSON.stringify(all.d));
    ok('only the product that is on sale is offered for sending', all.d.activeProductIds.length === 1 && all.d.activeProductIds[0] === ids['V-002'], JSON.stringify(all.d.activeProductIds));
    rows = bySku(await list());
    ok('V-006 (no template) is still hand-priced; the rest follow the template', rows['V-006'].pricing.manual === true && rows['V-006'].pricing.salePrice === 700 && ['V-001', 'V-002', 'V-003', 'V-004'].every((k) => rows[k].pricing.manual === false && rows[k].pricing.salePrice > 0), JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, p]) => [k, [p.pricing.manual, p.pricing.salePrice]]))));
    stats = (await a('GET', `/products/stats?connectionId=${conn}&xmlSourceId=${src}`)).d;
    ok('statistics follow', stats.manual === 1, JSON.stringify(stats));
    const again = await reset({ connectionId: conn, xmlSourceId: src });
    ok('doing it again changes nothing', again.d.removed === 0 && again.d.skippedNoTemplate === 1);
    ok('typed prices of a product that was reset are really gone from the table', (await c.query(`select count(*)::int n from app."ProductPriceOverride" where "connectionId"=$1`, [conn])).rows[0].n === 1);
  } catch (e) { console.log('ERROR', e); fails++; }
  finally {
    for (const s of [store, storeB]) await c.query(`delete from app."SyncLog" where "storeId"=$1`, [s.id]).catch(() => {});
    for (const u of [A, B]) await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
