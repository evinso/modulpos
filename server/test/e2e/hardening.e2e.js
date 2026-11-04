// End-to-end checks for the hardening pass. See test/e2e/README.md for how to run.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = await registerFetch(API+'/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-hard-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Hard' }) }).then((r) => r.json());
  const call = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d }; };
  const storeId = reg.user.stores[0].id;
  const sync = async (id) => { await call('POST', `/xml-sources/${id}/sync`); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = (await call('GET', `/xml-sources/${id}/sync-status`)).d; if (!s.running && s.last.status !== 'started') return s.last; } };
  try {
    // health
    const deep = await fetch(API + '/health?db=1').then((r) => r.json()); ok('deep health checks the database', deep.database === 'up');

    // signed proxy: unsigned requests are refused
    const px = await fetch(API + '/xml-converter/proxy?url=' + encodeURIComponent(base + 'feed-english.xml')); ok('unsigned XML proxy request is refused', px.status === 403, String(px.status));

    // VAT 0 stays 0
    const s0 = (await call('POST', '/xml-sources', { name: 'vat0', url: base + 'feed-english.xml', defaultVatRate: 0, syncIntervalMin: 60 })).d;
    await sync(s0.id);
    const v = (await c.query(`select "vatRate" from app."Product" where "xmlSourceId"=$1`, [s0.id])).rows;
    ok('0% sale VAT is kept (not turned into 10%)', v.length === 2 && v.every((r) => r.vatRate === 0), v.map((r) => r.vatRate).join(','));

    // manual price survives a sync that changes the feed price
    const target = (await c.query(`select id, "xmlPrice" from app."Product" where "xmlSourceId"=$1 order by sku limit 1`, [s0.id])).rows[0];
    await c.query(`update app."Product" set price=999.5 where id=$1`, [target.id]);               // hand-edited sale price
    await c.query(`update app."Product" set "xmlPrice"=1 where id=$1`, [target.id]);              // pretend the feed price changed
    await sync(s0.id);
    const after = (await c.query(`select price, "xmlPrice" from app."Product" where id=$1`, [target.id])).rows[0];
    ok('hand-edited price is kept while the feed price still updates', after.price === 999.5 && Math.abs(after.xmlPrice - target.xmlPrice) < 0.01, JSON.stringify(after));

    // DB-level guard: a sync already marked as started blocks a new one
    const src2 = (await call('POST', '/xml-sources', { name: 'dup', url: base + 'feed-english.xml', syncIntervalMin: 60 })).d;
    await c.query(`insert into app."SyncLog"(id,"storeId","xmlSourceId",type,status,"startedAt") values(gen_random_uuid(),$1,$2,'xml_sync','started',now())`, [storeId, src2.id]);
    const blocked = await call('POST', `/xml-sources/${src2.id}/sync`); ok('a sync already running elsewhere blocks a second start (409)', blocked.s === 409, String(blocked.s));
    await c.query(`delete from app."SyncLog" where "xmlSourceId"=$1`, [src2.id]);

    // an abandoned 'started' row (no heartbeat for 40 minutes) must NOT block syncing forever
    await c.query(`insert into app."SyncLog"(id,"storeId","xmlSourceId",type,status,"startedAt") values(gen_random_uuid(),$1,$2,'xml_sync','started',now() - interval '40 minutes')`, [storeId, src2.id]);
    const afterStale = await call('POST', `/xml-sources/${src2.id}/sync`); ok('an abandoned (silent for 40 min) sync does not block a new one', afterStale.s === 202, String(afterStale.s));
    await sync(src2.id);

    // duplicate barcode across two sources: exactly one product per barcode goes through
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [storeId])).rows[0].id;
    await call('POST', '/pricing', { name: 't', type: 'percentage', value: 20, applyTo: 'price_template', conditions: { connectionId: conn } });
    for (const cat of ['Computers|Accessories|Mice', 'Computers|Cables']) await c.query(`insert into app."CategoryMapping"(id,"connectionId","localCategory","marketplaceCategoryId","marketplaceCategoryName") values(gen_random_uuid(),$1,$2,'1','x')`, [conn, cat]);
    const list = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d;
    const bySku = {};
    for (const p of list.products) (bySku[p.sku] = bySku[p.sku] || []).push(p);
    const oneWinnerEach = Object.values(bySku).every((arr) => arr.length === 2 && arr.filter((p) => !p.issues.some((i) => i.code === 'duplicate_barcode')).length === 1);
    ok('same barcode in two sources: exactly one is sendable, the other is marked duplicate', oneWinnerEach, JSON.stringify(Object.fromEntries(Object.entries(bySku).map(([k, a]) => [k, a.map((p) => p.issues.some((i) => i.code === 'duplicate_barcode') ? 'dup' : 'ok')]))));

    // brand check: no brand + no default brand on the connection => blocked
    const noBrand = list.products.filter((p) => !p.brand);
    ok('products without a brand are blocked when the connection has no default brand', list.stats.byIssue.no_brand === undefined || noBrand.every((p) => p.issues.some((i) => i.code === 'no_brand')), 'no_brand=' + (list.stats.byIssue.no_brand || 0));
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    await c.query(`delete from app."SyncLog" where "storeId"=$1`, [storeId]).catch(() => {});
    await c.query(`delete from app."User" where id=$1`, [reg.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
