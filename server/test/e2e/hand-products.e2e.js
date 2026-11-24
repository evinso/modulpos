// The workspace of the products ADDED BY HAND (/api/hand-products): the list with what is missing, one change for many products (preview first), a pasted price / stock list, isolation.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/hand-products.e2e.js
// Temporary users + a Trendyol connection with FAKE credentials. Nothing is sent to any marketplace.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = async (tag) => {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-handws-${tag}-${Date.now()}@example.invalid`, password: 'Tmp-Pass-123456!', name: `E2E hand ${tag}` }) });
    const j = await r.json(); if (!j.user) throw new Error(`register failed (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 160)}`); return j;
  };
  const caller = (token) => async (m, u, b) => {
    const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Requested-With': 'XMLHttpRequest' }, body: b ? JSON.stringify(b) : undefined });
    let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d };
  };
  const users = [];
  try {
    const A = await reg('a'); users.push(A.user.id); const a = caller(A.token); const store = A.user.stores[0];
    const B = await reg('b'); users.push(B.user.id); const b = caller(B.token);
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [store.id])).rows[0].id;

    // six hand-added products: no price, no stock, some without brand / picture / barcode
    const mk = (n, over = {}) => a('POST', '/products', { sku: `HW-${n}`, barcode: `869990000000${n}`, title: `Elle ürün ${n}`, price: 0, stock: 0, brand: '', vatRate: 20, images: ['https://example.com/a.jpg'], ...over });
    const made = [await mk(1), await mk(2, { brand: 'Atölye' }), await mk(3, { images: [] }), await mk(4, { barcode: '' }), await mk(5, { price: 80, stock: 3, brand: 'Atölye' }), await mk(6)];
    ok('setup: six hand-added products', made.every((m) => m.s === 201), made.map((m) => m.s).join());
    const id = (n) => made[n - 1].d.id;
    await c.query(`insert into app."MarketplaceProduct"(id,"productId","connectionId",status,"updatedAt") values(gen_random_uuid(),$1,$2,'active',now())`, [id(6), conn]);      // HW-6 is already on the marketplace
    // another store's product with a code we will try to take, and one XML-like product that is NOT hand-added
    const bp = await b('POST', '/products', { sku: 'HW-B1', barcode: '8699900009999', title: 'Başkasının ürünü', images: ['https://example.com/b.jpg'] });
    await c.query(`insert into app."Product"(id,"storeId",sku,title,price,"xmlPrice",stock,"vatRate",status,"updatedAt") values(gen_random_uuid(),$1,'FEED-1','Feed ürünü',100,100,5,20,'active',now())`, [store.id]);

    // ── the list ──
    const L = await a('GET', `/hand-products?connectionId=${conn}&limit=50`);
    ok('list: only the six hand-added products (not the feed product, not the other store\'s)', L.s === 200 && L.d.total === 6 && L.d.items.every((x) => /^HW-[1-6]$/.test(x.sku)), `${L.s} ${L.d && L.d.total}`);
    const S = L.d.summary;
    ok('summary: what is missing across ALL of them (no net amount 5, no stock 5, no brand 4, no barcode 1, no picture 1, one sent, no Trendyol category 6), no price template', S.total === 6 && S.noPrice === 5 && S.noStock === 5 && S.noBrand === 4 && S.noBarcode === 1 && S.noImage === 1 && S.sent === 1 && S.noCategory === 6 && S.template.exists === false, JSON.stringify(S));
    const row = L.d.items.find((x) => x.sku === 'HW-6'); ok('list: a product on the marketplace says so', row.sent === true && L.d.items.find((x) => x.sku === 'HW-1').sent === false);
    for (const [f, n] of [['no_price', 5], ['no_stock', 5], ['no_brand', 4], ['no_barcode', 1], ['no_image', 1], ['sent', 1], ['not_sent', 5], ['no_category', 6]]) { const r = await a('GET', `/hand-products?filter=${f}&connectionId=${conn}`); ok(`filter ${f}: ${n}`, r.s === 200 && r.d.total === n, `${r.d && r.d.total}`); }
    ok('search: by name, stock code and barcode', (await a('GET', '/hand-products?q=elle%20%C3%BCr%C3%BCn%203')).d.total === 1 && (await a('GET', '/hand-products?q=HW-2')).d.total === 1 && (await a('GET', '/hand-products?q=8699900000005')).d.total === 1);
    ok('paging: 2 per page', (await a('GET', '/hand-products?limit=2&page=3')).d.items.length === 2 && (await a('GET', '/hand-products?limit=2')).d.pages === 3);
    const foreign = await a('GET', '/hand-products?connectionId=00000000-0000-4000-8000-000000000000'); ok('a connection of nobody is ignored (no categories), not an error', foreign.s === 200 && foreign.d.connectionId === null);

    // ── one change for many: preview first ──
    const ids = [1, 2, 3, 4, 5, 6].map(id);
    const pv = await a('POST', '/hand-products/bulk', { ids, patch: { price: { mode: 'set', value: 120 }, stock: { mode: 'set', value: 7 }, brand: 'Benim Markam' }, dryRun: true });
    ok('bulk preview: 6 matched, 6 change, rows say before and after, nothing written', pv.s === 200 && pv.d.matched === 6 && pv.d.changed === 6 && pv.d.dryRun === true && pv.d.rows[0].before.price !== undefined && pv.d.rows[0].after.brand === 'Benim Markam', JSON.stringify(pv.d).slice(0, 200));
    ok('bulk preview wrote nothing', (await a('GET', '/hand-products?filter=no_price')).d.total === 5);
    const noFlag = await a('POST', '/hand-products/bulk', { ids, patch: { stock: { mode: 'set', value: 1 } } }); ok('without an explicit dryRun:false it is only a preview (safe default)', noFlag.d.dryRun === true && (await a('GET', '/hand-products?filter=no_stock')).d.total === 5);
    const bad = await a('POST', '/hand-products/bulk', { ids, patch: { vatRate: 7 }, dryRun: true }); ok('a bad value is refused in words (400)', bad.s === 400 && /KDV/.test((bad.d && bad.d.error) || ''), `${bad.s} ${bad.d && bad.d.error}`);
    const none = await a('POST', '/hand-products/bulk', { ids, patch: {}, dryRun: true }); ok('no field chosen is refused (400)', none.s === 400 && /Değiştirilecek/.test((none.d && none.d.error) || ''));
    const nosel = await a('POST', '/hand-products/bulk', { ids: [], patch: { stock: { mode: 'set', value: 1 } } }); ok('no product chosen is refused (400)', nosel.s === 400);
    const ap = await a('POST', '/hand-products/bulk', { ids, patch: { price: { mode: 'set', value: 120 }, stock: { mode: 'set', value: 7 }, brand: 'Benim Markam' }, dryRun: false });
    ok('bulk apply: 6 updated', ap.s === 200 && ap.d.applied === 6 && ap.d.dryRun === false, JSON.stringify(ap.d).slice(0, 160));
    const after = (await c.query(`select sku, price, stock, brand from app."Product" where "storeId" = $1 and sku like 'HW-%' order by sku`, [store.id])).rows;
    ok('bulk apply: net amount 120, stock 7, brand "Benim Markam" on all six, and the feed product untouched', after.length === 6 && after.every((x) => Number(x.price) === 120 && x.stock === 7 && x.brand === 'Benim Markam') && Number((await c.query(`select price from app."Product" where sku = 'FEED-1' and "storeId" = $1`, [store.id])).rows[0].price) === 100);
    const pc = await a('POST', '/hand-products/bulk', { ids: [id(1), id(2)], patch: { price: { mode: 'percent', value: 10 } }, dryRun: false }); ok('percent: 120 + 10% = 132', pc.d.applied === 2 && Number((await c.query(`select price from app."Product" where id = $1`, [id(1)])).rows[0].price) === 132);
    const add = await a('POST', '/hand-products/bulk', { ids: [id(1)], patch: { stock: { mode: 'add', value: -20 } }, dryRun: false }); ok('stock add never goes below 0', add.d.applied === 1 && (await c.query(`select stock from app."Product" where id = $1`, [id(1)])).rows[0].stock === 0);
    const byFilter = await a('POST', '/hand-products/bulk', { filter: { filter: 'no_brand' }, patch: { status: 'passive' }, dryRun: true }); ok('a filter can be the selection', byFilter.s === 200 && byFilter.d.matched === 0, JSON.stringify(byFilter.d).slice(0, 120));
    const title = await a('POST', '/hand-products/bulk', { ids: [id(1), id(2)], patch: { title: { prefix: 'Atölye', find: 'Elle', replace: 'El yapımı' } }, dryRun: false });
    ok('name: text before and find-and-replace', title.d.applied === 2 && (await c.query(`select title from app."Product" where id = $1`, [id(1)])).rows[0].title === 'Atölye El yapımı ürün 1');
    // codes: the rules of the XML import
    const other = await a('POST', '/products', { sku: 'KEEP-1', barcode: '8699900001111', title: 'Başka el ürünü', images: ['https://example.com/c.jpg'], brand: 'X' }); void other;
    const codes = await a('POST', '/hand-products/bulk', { ids: [id(1), id(2), id(6)], patch: { codes: { sku: { mode: 'counter', prefix: 'BEN-', start: 1, pad: 3 }, barcode: { mode: 'generate', digits: '200', start: 1 } } }, dryRun: false });
    const cs = (await c.query(`select sku, barcode from app."Product" where id = any($1) order by sku`, [[id(1), id(2), id(6)]])).rows;
    ok('codes: own numbering for two, the one already on the marketplace is refused with the reason (its codes stay)', codes.s === 200 && codes.d.applied === 2 && codes.d.problemCount === 1 && /Pazaryerine gönderilmiş/.test(codes.d.problems[0].reason) && cs.filter((x) => /^BEN-00[12]$/.test(x.sku)).length === 2 && cs.some((x) => x.sku === 'HW-6'), JSON.stringify([codes.d.problems, cs]));
    ok('codes: the generated barcodes are 13 digits and unique', cs.filter((x) => /^BEN/.test(x.sku)).every((x) => /^200\d{10}$/.test(x.barcode)) && new Set(cs.map((x) => x.barcode)).size === 3);
    const clash = await a('POST', '/hand-products/bulk', { ids: [id(3)], patch: { codes: { sku: { mode: 'replace', find: 'HW-3', replace: 'KEEP-1' } } }, dryRun: false });
    ok('codes: a stock code another product has is refused (the code stays)', clash.d.applied === 0 && clash.d.problemCount === 1 && /KEEP-1.*başka bir üründe var/.test(clash.d.problems[0].reason) && (await c.query(`select sku from app."Product" where id = $1`, [id(3)])).rows[0].sku === 'HW-3');

    // ── other store's products cannot be reached ──
    const b1 = (await c.query(`select id from app."Product" where sku = 'HW-B1'`)).rows[0].id;
    const cross = await a('POST', '/hand-products/bulk', { ids: [b1], patch: { stock: { mode: 'set', value: 999 } }, dryRun: false });
    ok('isolation: another store\'s product id changes nothing (0 matched)', cross.s === 200 && cross.d.matched === 0 && (await c.query(`select stock from app."Product" where id = $1`, [b1])).rows[0].stock === 0, JSON.stringify(cross.d).slice(0, 120));
    const feedId = (await c.query(`select id from app."Product" where sku = 'FEED-1'`)).rows[0].id;
    const feed = await a('POST', '/hand-products/bulk', { ids: [feedId], patch: { stock: { mode: 'set', value: 999 } }, dryRun: false });
    ok('a feed product (price from an XML) is not a hand-added one: not reachable here (0 matched)', feed.d.matched === 0 && (await c.query(`select stock from app."Product" where id = $1`, [feedId])).rows[0].stock === 5);
    ok('the other user sees none of ours', (await b('GET', '/hand-products')).d.total === 1 && (await b('GET', '/hand-products')).d.items[0].sku === 'HW-B1');

    // ── a pasted list ──
    const text = 'SKU\tFiyat\tStok\nHW-4\t1.874,70\t12\nHW-5\t80\t3\n8699900000003\t95,5\t\nYOK-1\t5\t5\nHW-3\tabc\t1\nBEN-001\t300\t2\nBEN-002\t132\t7\n';
    const pp = await a('POST', '/hand-products/paste', { text, dryRun: true });
    ok('paste preview: matched by stock code or barcode, the unchanged one is "same", the unknown and the broken ones are told', pp.s === 200 && pp.d.counts.rows === 7 && pp.d.counts.ok === 4 && pp.d.counts.same === 1 && pp.d.counts.unmatched === 1 && pp.d.counts.bad === 1 && pp.d.items.find((x) => x.key === 'YOK-1').status === 'unmatched' && /sayı değil/.test(pp.d.items.find((x) => x.key === 'HW-3').note), JSON.stringify(pp.d.counts));
    ok('paste preview wrote nothing', Number((await c.query(`select price from app."Product" where "storeId" = $1 and sku = 'HW-4'`, [store.id])).rows[0].price) === 120);
    const pa = await a('POST', '/hand-products/paste', { text, dryRun: false });
    const got = (await c.query(`select sku, price, stock from app."Product" where "storeId" = $1 and sku in ('HW-4','HW-5','HW-3','BEN-001') order by sku`, [store.id])).rows;
    const g = (k) => got.find((x) => x.sku === k);
    ok('paste apply: HW-4 = 1874.70 / 12, HW-5 = 80 / 3, HW-3 found by its barcode = 95.5 with its stock kept (7), BEN-001 = 300 / 2', pa.s === 200 && pa.d.applied === 4 && Number(g('HW-4').price) === 1874.7 && g('HW-4').stock === 12 && Number(g('HW-5').price) === 80 && g('HW-5').stock === 3 && Number(g('HW-3').price) === 95.5 && g('HW-3').stock === 7 && Number(g('BEN-001').price) === 300 && g('BEN-001').stock === 2, JSON.stringify(got));
    const empty = await a('POST', '/hand-products/paste', { text: '  ', dryRun: true }); ok('an empty list is refused in words (400)', empty.s === 400 && /Yapıştırılacak/.test((empty.d && empty.d.error) || ''));
    const crossPaste = await b('POST', '/hand-products/paste', { text: 'HW-4;1;1', dryRun: false }); ok('isolation: the other user\'s paste cannot reach our product (unmatched)', crossPaste.d.counts.unmatched === 1 && Number((await c.query(`select price from app."Product" where id = $1`, [id(4)])).rows[0].price) === 1874.7);

    // ── the price template shows up in the summary once it exists ──
    const conds = { connectionId: null, xmlSourceIds: ['none'], categories: [], brands: [], shippingCost: 100, packagingCost: 0, extraCost: 0, commissionPct: 22, extraPct: 0, serviceFee: 13.19, inputVat: true, commissionBasis: 'gross', vatRate: null, profitMode: 'fixed', roundingMode: 'none', shippingTiers: [], profitTiers: [], netMode: 'cash' };
    const t = await a('POST', '/pricing', { name: 'Elle eklenenler', type: 'percentage', value: 0, applyTo: 'price_template', conditions: conds });
    const S2 = (await a('GET', '/hand-products?limit=1')).d.summary;
    ok('summary: once the template for the hand-added scope exists it says so, and how it reads the amount', (t.s === 200 || t.s === 201) && S2.template.exists === true && S2.template.active === true && S2.template.name === 'Elle eklenenler' && S2.template.netMode === 'cash', JSON.stringify(S2.template));
    const priceOf = async (sku) => (await a('GET', `/hand-products?q=${sku}&connectionId=${conn}`)).d.items[0];
    const cashRow = await priceOf('HW-5');
    ok('list (cash template): the amount 80 becomes a sale price on the chosen connection, "what stays" is the amount', cashRow.price === 80 && cashRow.pricing && cashRow.pricing.salePrice > 80 && Math.abs(cashRow.pricing.profit - 80) < 0.05, JSON.stringify(cashRow.pricing));

    // ── netMode "profit": the amount is a PURCHASE price and the template's profit is added, like an XML product ──
    const badMode = await a('PUT', `/pricing/${t.d.id}`, { conditions: { ...conds, netMode: 'weird' } }); ok('a net mode that does not exist is still refused (400), and the message names the new one', badMode.s === 400 && /profit/.test((badMode.d && badMode.d.error) || ''), `${badMode.s} ${badMode.d && badMode.d.error}`);
    const pconds = { ...conds, profitMode: 'percent_of_purchase', netMode: 'profit' };
    const up = await a('PUT', `/pricing/${t.d.id}`, { value: 30, conditions: pconds }); ok('the template is saved with "alış fiyatı + kâr" (30%)', up.s === 200, `${up.s} ${up.d && up.d.error}`);
    const calc = await a('POST', '/pricing/calculate', { purchasePrice: 80, value: 30, conditions: pconds });
    const calcX = await a('POST', '/pricing/calculate', { purchasePrice: 80, value: 30, conditions: { ...pconds, xmlSourceIds: [] } });
    ok('the calculator treats a hand-scope template in profit mode as an ordinary one (purchase + profit), the same number as for an XML product', calc.s === 200 && Math.abs(calc.d.price - calcX.d.price) < 0.011 && calc.d.price > 80 * 1.3 && !calc.d.net && calc.d.purchase === 80, JSON.stringify(calc.d).slice(0, 160));
    const profitRow = await priceOf('HW-5');
    ok('list (profit template): purchase 80 + 30% profit and the costs: the same sale price the calculator gave, a real profit', Math.abs(profitRow.pricing.salePrice - calc.d.price) < 0.011 && profitRow.pricing.profit > 0 && profitRow.pricing.salePrice !== cashRow.pricing.salePrice, JSON.stringify(profitRow.pricing));
    const S3 = (await a('GET', '/hand-products?limit=1')).d.summary; ok('summary: the template says it reads the amount as a purchase price with profit', S3.template.netMode === 'profit', JSON.stringify(S3.template));
    const detail = (await a('GET', `/products/${id(5)}/detail`)).d; const mp = detail.marketplaces.find((m) => m.connectionId === conn);
    ok('the product detail shows the ordinary breakdown: purchase 80, no "net amount" reading', mp && mp.pricing && !mp.pricing.net && mp.pricing.breakdown && mp.pricing.breakdown.purchase === 80 && Math.abs(mp.pricing.salePrice - calc.d.price) < 0.011, JSON.stringify(mp && mp.pricing && [mp.pricing.net, mp.pricing.breakdown && mp.pricing.breakdown.purchase]));
    const raise = await a('POST', '/hand-products/bulk', { ids: [id(5)], patch: { price: { mode: 'percent', value: 10 } }, dryRun: false }); const dear = await priceOf('HW-5');
    ok('raising the purchase price by 10% in bulk raises the sale price the template makes of it', raise.d.applied === 1 && dear.price === 88 && dear.pricing.salePrice > profitRow.pricing.salePrice, JSON.stringify([dear.price, dear.pricing]));
    ok('unauthenticated: refused', (await fetch(API + '/hand-products')).status === 401);
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
