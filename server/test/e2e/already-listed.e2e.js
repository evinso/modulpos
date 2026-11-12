// "Same barcode already exists" is not a rejection: those products are already on the marketplace.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/already-listed.e2e.js
// Uses a temporary user and a Trendyol connection with FAKE credentials. Nothing is created on the marketplace;
// the status sync makes a few read-only calls that the marketplace answers with "unauthorized".
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const DUP = (b) => `Aynı barkodlu bir ürününüz bulunduğundan yeni ürün oluşturulamaz. Barkod: ${b}`;
(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const mk = (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: tag }) }).then((r) => r.json());
  const A = await mk('listedA'), B = await mk('listedB');
  const call = (tok) => async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* none */ } return { s: r.status, d }; };
  const a = call(A.token), b = call(B.token); const store = A.user.stores[0];
  try {
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [store.id])).rows[0].id;
    const mkp = async (sku) => (await a('POST', '/products', { sku, barcode: 'e2e-' + sku, title: 'Ürün ' + sku, price: 100, stock: 10, vatRate: 20, category: 'Kolye' })).d;
    const P = {}; for (const k of ['active', 'pending', 'dup', 'real', 'fresh', 'off']) P[k] = await mkp(k);
    ok('products created', Object.values(P).every((p) => p && p.id));
    const mp = (pid, status, msg) => c.query(`insert into app."MarketplaceProduct"(id,"productId","connectionId",status,"errorMessage","updatedAt") values(gen_random_uuid(),$1,$2,$3,$4,now())`, [pid, conn, status, msg]);
    await mp(P.active.id, 'active', null);
    await mp(P.pending.id, 'pending', null);
    await mp(P.dup.id, 'rejected', DUP('e2e-dup'));
    await mp(P.real.id, 'rejected', 'Marka geçersiz');
    await mp(P.off.id, 'passive', 'Yasaklı Kelime: Çeyrek');
    const st = async () => Object.fromEntries((await c.query(`select p.sku,mp.status,mp."errorMessage" from app."MarketplaceProduct" mp join app."Product" p on p.id=mp."productId" where mp."connectionId"=$1`, [conn])).rows.map((r) => [r.sku, { status: r.status, err: r.errorMessage }]));

    // the list must not show the "already exists" answer as a blocking rejection, a real rejection stays blocked
    const list = await a('GET', `/marketplace/connections/${conn}/product-list?fresh=1&limit=50`);
    const row = (sku) => list.d.products.find((p) => p.sku === sku);
    ok('product list: "already exists" is not shown as a rejection', row('dup') && !row('dup').issues.some((i) => i.code === 'rejected_by_marketplace'));
    ok('product list: a real rejection still blocks', row('real') && row('real').issues.some((i) => i.code === 'rejected_by_marketplace'));

    // send everything: listed products are skipped, never sent again
    const all = await a('POST', `/marketplace/connections/${conn}/send-all-ready`, { minStock: 0 });
    ok('send-all-ready skips products that are already on the marketplace (active, pending, "already exists")', all.s === 400 && all.d.skipReasons && all.d.skipReasons.already_listed === 3, JSON.stringify(all.d && all.d.skipReasons));
    ok('a real rejection and a never-sent product are not counted as "already listed"', (all.d.skipped || 0) >= 3 && all.d.skipReasons.already_listed === 3);
    ok('a product that is on the marketplace but removed there is skipped with its own reason (not re-sent, not flipped to active)', all.d.skipReasons.off_sale === 1, JSON.stringify(all.d.skipReasons));

    // the Trendyol send page always works inside ONE XML source; "none" is the products added by hand, a foreign/unknown source is empty
    const noneList = await a('GET', `/marketplace/connections/${conn}/product-list?fresh=1&limit=50&xmlSourceId=none`);
    ok('product list: xmlSourceId=none lists exactly the products added by hand', noneList.s === 200 && noneList.d.products.length === 6 && noneList.d.pagination.total === 6, String(noneList.d.pagination && noneList.d.pagination.total));
    const noneIds = await a('GET', `/marketplace/connections/${conn}/product-list/ids?fresh=1&xmlSourceId=none`);
    ok('the "select all" ids follow the same scope', noneIds.s === 200 && noneIds.d.matching === 6, JSON.stringify(noneIds.d).slice(0, 120));
    const otherList = await a('GET', `/marketplace/connections/${conn}/product-list?fresh=1&limit=50&xmlSourceId=00000000-0000-0000-0000-000000000000`);
    ok('product list: a source that has none of these products is empty', otherList.s === 200 && otherList.d.products.length === 0);
    const allNone = await a('POST', `/marketplace/connections/${conn}/send-all-ready`, { minStock: 0, xmlSourceId: 'none' });
    ok('send-all-ready with xmlSourceId=none works on the products added by hand (same skip reasons)', allNone.s === 400 && allNone.d.skipReasons && allNone.d.skipReasons.already_listed === 3 && allNone.d.skipReasons.off_sale === 1, JSON.stringify(allNone.d && allNone.d.skipReasons));
    const allOther = await a('POST', `/marketplace/connections/${conn}/send-all-ready`, { minStock: 0, xmlSourceId: '00000000-0000-0000-0000-000000000000' });
    ok('send-all-ready inside a source that has none of them finds nothing to send', allOther.s === 400 && /Ürün bulunamadı/.test(allOther.d.error || ''), JSON.stringify(allOther.d).slice(0, 100));

    // sending selected products: same rule, clear message
    const offSel = await a('POST', `/marketplace/connections/${conn}/send-products`, { productIds: [P.off.id] });
    ok('send-products tells the user the removed product has to be fixed in the marketplace panel', offSel.s === 400 && /satışta değil/i.test(offSel.d.error || '') && offSel.d.offSale === 1, JSON.stringify(offSel.d).slice(0, 140));
    const sel = await a('POST', `/marketplace/connections/${conn}/send-products`, { productIds: [P.active.id, P.pending.id, P.dup.id] });
    ok('send-products refuses already listed products with a clear message', sel.s === 400 && /zaten Trendyol/i.test(sel.d.error || '') && sel.d.alreadyListed === 3, JSON.stringify(sel.d).slice(0, 140));
    const after1 = await st();
    ok('nothing was changed by the refused sends', after1.active.status === 'active' && after1.pending.status === 'pending' && after1.dup.status === 'rejected');

    // the status update turns the wrongly rejected one into an active listing and clears the message
    const sync = await a('POST', `/marketplace/connections/${conn}/sync-status`);
    ok('status update succeeds', sync.s === 200, JSON.stringify(sync.d).slice(0, 160));
    const after2 = await st();
    ok('"already exists" rejection -> active, message cleared', after2.dup.status === 'active' && after2.dup.err === null, JSON.stringify(after2.dup));
    ok('a real rejection is left alone', after2.real.status === 'rejected' && after2.real.err === 'Marka geçersiz');
    ok('a removed listing stays removed when the marketplace cannot confirm it is on sale again (reason kept)', after2.off.status === 'passive' && after2.off.err === 'Yasaklı Kelime: Çeyrek', JSON.stringify(after2.off));
    ok('the update reports the fixed listing as active', sync.d.activated >= 1 && sync.d.updated >= 1, `activated=${sync.d.activated}`);
    const list2 = await a('GET', `/marketplace/connections/${conn}/product-list?fresh=1&limit=50`);
    const dupRow = list2.d.products.find((p) => p.sku === 'dup');
    ok('product list now shows it as on sale (active, no error text)', dupRow.marketplaceProducts[0].status === 'active' && !dupRow.marketplaceProducts[0].errorMessage);
    ok('list statistics count it as active', list2.d.stats.mp.active >= 2, JSON.stringify(list2.d.stats.mp));

    // a second status update changes nothing
    const sync2 = await a('POST', `/marketplace/connections/${conn}/sync-status`);
    ok('repeating the update is harmless', sync2.s === 200 && (await st()).dup.status === 'active');

    // tenant isolation
    ok('another store cannot run the status update on my connection', (await b('POST', `/marketplace/connections/${conn}/sync-status`)).s === 404);
    ok('another store cannot send on my connection', (await b('POST', `/marketplace/connections/${conn}/send-all-ready`, {})).s === 404);
  } catch (e) { console.log('ERROR', e); fails++; }
  finally {
    for (const u of [A, B]) await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
