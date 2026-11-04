// Category mappings belong to one XML source; deleting the source removes them; the price template shows earnings. See test/e2e/README.md.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-map-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Map' }) }).then((r) => r.json());
  const call = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d }; };
  const storeId = reg.user.stores[0].id;
  const sync = async (id) => { await call('POST', `/xml-sources/${id}/sync`); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = (await call('GET', `/xml-sources/${id}/sync-status`)).d; if (!s.running && s.last.status !== 'started') return s.last; } };
  try {
    // two sources that both contain the SAME category name ("Computers|Accessories|Mice" from the english feed)
    const A = (await call('POST', '/xml-sources', { name: 'A', url: base + 'feed-english.xml', syncIntervalMin: 60 })).d;
    const B = (await call('POST', '/xml-sources', { name: 'B', url: base + 'feed-english.xml', syncIntervalMin: 60 })).d;
    await sync(A.id); await sync(B.id);
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [storeId])).rows[0].id;
    const cat = 'Computers|Accessories|Mice';

    const noSrc = await call('POST', `/marketplace/connections/${conn}/category-mappings`, { localCategory: cat, marketplaceCategoryId: 411, marketplaceCategoryName: 'x' });
    ok('a mapping without an XML source is refused', noSrc.s === 400, noSrc.d && noSrc.d.error);
    const bad = await call('POST', `/marketplace/connections/${conn}/category-mappings`, { xmlSourceId: '00000000-0000-0000-0000-000000000000', localCategory: cat, marketplaceCategoryId: 411 });
    ok('a mapping for a foreign / unknown source is refused', bad.s === 400);
    const mk = await call('POST', `/marketplace/connections/${conn}/category-mappings`, { xmlSourceId: A.id, localCategory: cat, marketplaceCategoryId: 411, marketplaceCategoryName: 'Aksesuar > Mouse' });
    ok('mapping for source A is saved', mk.s === 200 && mk.d.xmlSourceId === A.id);

    await call('POST', '/pricing', { name: 't', type: 'percentage', value: 20, applyTo: 'price_template', conditions: { connectionId: conn, commissionBasis: 'gross' } });
    const list = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d;
    const ofA = list.products.filter((p) => p.xmlSourceId === A.id && p.category === cat);
    const ofB = list.products.filter((p) => p.xmlSourceId === B.id && p.category === cat);
    ok("source A's product uses the mapping", ofA.length === 1 && ofA[0].mapName === 'Aksesuar > Mouse', ofA[0] && ofA[0].mapName);
    ok("source B's product with the same category name is NOT mapped", ofB.length === 1 && !ofB[0].mapName && ofB[0].issues.some((i) => i.code === 'no_category_mapping'));

    const forA = (await call('GET', `/marketplace/connections/${conn}/category-mappings?xmlSourceId=${A.id}`)).d;
    const forB = (await call('GET', `/marketplace/connections/${conn}/category-mappings?xmlSourceId=${B.id}`)).d;
    ok('mapping list is scoped per source', forA.length === 1 && forB.length === 0, `A=${forA.length} B=${forB.length}`);

    // deleting the source takes its mappings and products away, and the list stops showing them immediately
    await call('GET', `/marketplace/connections/${conn}/product-list?limit=5`);   // warm the list cache
    const del = await call('DELETE', `/xml-sources/${A.id}`); ok('source A deleted', del.s === 200);
    ok("A's mappings are gone with it", (await c.query(`select count(*)::int n from app."CategoryMapping" where "xmlSourceId"=$1`, [A.id])).rows[0].n === 0);
    ok('no stale mapping chips are returned any more', (await call('GET', `/marketplace/connections/${conn}/category-mappings`)).d.length === 0);
    const after = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50`)).d;       // NOT fresh=1: cache must have been invalidated
    ok("A's products disappear from the send list right away (no stale cache)", after.products.every((p) => p.xmlSourceId !== A.id));

    // earnings summary: purchase 100 -> check the profit really equals the requested profit with commission on the gross price
    const conds = { connectionId: conn, commissionBasis: 'gross', commissionPct: 10, shippingCost: 10, vatRate: null };
    const calc = (await call('POST', '/pricing/calculate', { purchasePrice: 100, value: 30, conditions: { ...conds, vatRate: 20 } })).d;
    ok('calculator: net profit equals the requested 30 TL', calc.profit === 30, `price ${calc.price}, commission ${calc.commissionAmount}`);
    ok('calculator: commission is 10% of the VAT-inclusive price', Math.abs(calc.commissionAmount - calc.price * 0.1) < 0.011);
    const cov = (await call('POST', '/pricing/coverage', { value: 25, conditions: { ...conds, xmlSourceIds: [B.id] } })).d;
    ok('coverage: reports covered products and a total profit', cov.covered === 2 && cov.priced === 2 && cov.totalProfit > 0, JSON.stringify({ covered: cov.covered, total: cov.totalProfit, avg: cov.avgProfit }));
    const own = (await call('POST', '/pricing/coverage', { value: 25, conditions: { ...conds, xmlSourceIds: [B.id], minPurchasePrice: 100000 } })).d;
    ok('coverage: no matching products -> zero', own.covered === 0 && own.totalProfit === 0);
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    await c.query(`delete from app."SyncLog" where "storeId"=$1`, [storeId]).catch(() => {});
    await c.query(`delete from app."User" where id=$1`, [reg.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
