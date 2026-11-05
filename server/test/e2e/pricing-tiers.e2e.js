// End-to-end test of shipping / profit tier tables in price templates against a RUNNING deployment.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/pricing-tiers.e2e.js
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const mk = (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: tag }) }).then((r) => r.json());
  const A = await mk('tierA'), B = await mk('tierB');
  const call = (tok) => async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* none */ } return { s: r.status, d }; };
  const a = call(A.token), b = call(B.token); const store = A.user.stores[0];
  const near = (x, y) => Math.abs(x - y) < 0.011;
  try {
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [store.id])).rows[0].id;
    const ship = [{ upTo: 200, cost: 46 }, { upTo: 350, cost: 84 }, { upTo: null, cost: 190 }];
    const conds = { connectionId: conn, commissionPct: 15, commissionBasis: 'gross', vatRate: 20, packagingCost: 0, shippingCost: 0, shippingTiers: ship };

    // calculator
    let r = await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 30, conditions: conds });
    ok('calculator picks shipping row 2 and keeps the planned profit', r.s === 200 && r.d.shippingTier === 2 && r.d.shippingCost === 84 && near(r.d.profit, 30), JSON.stringify(r.d).slice(0, 140));
    ok('calculator reports the margin on the sale price', r.s === 200 && near(r.d.marginOnPricePct, r.d.profit / r.d.price * 100));
    r = await a('POST', '/pricing/calculate', { purchasePrice: 40, value: 30, conditions: conds });
    ok('cheap product stays in row 1', r.d.shippingTier === 1 && r.d.price <= 200);
    r = await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 30, conditions: { ...conds, shippingTiers: [] } });
    ok('no table = single amount as before', r.s === 200 && r.d.shippingTier === null);

    // profit table
    const pt = [{ upTo: 100, value: 40 }, { upTo: null, value: 20 }];
    r = await a('POST', '/pricing/calculate', { purchasePrice: 80, value: 0, conditions: { ...conds, shippingTiers: [], profitTiers: pt } });
    ok('profit table row 1 for a cheap product', r.s === 200 && r.d.profitTier === 1 && near(r.d.profit, 32), JSON.stringify(r.d).slice(0, 100));
    r = await a('POST', '/pricing/calculate', { purchasePrice: 500, value: 0, conditions: { ...conds, shippingTiers: [], profitTiers: pt } });
    ok('profit table last row for an expensive product', r.d.profitTier === 2 && near(r.d.profit, 100));

    // validation
    for (const [name, bad] of [
      ['not ascending', { shippingTiers: [{ upTo: 300, cost: 1 }, { upTo: 200, cost: 2 }, { upTo: null, cost: 3 }] }],
      ['last row has a limit', { shippingTiers: [{ upTo: 100, cost: 1 }, { upTo: 200, cost: 2 }] }],
      ['negative amount', { shippingTiers: [{ upTo: 100, cost: -5 }, { upTo: null, cost: 2 }] }],
      ['too many rows', { profitTiers: [{ upTo: 1, value: 1 }, { upTo: 2, value: 1 }, { upTo: 3, value: 1 }, { upTo: null, value: 1 }] }],
      ['single row', { profitTiers: [{ upTo: null, value: 5 }] }],
    ]) {
      const x = await a('POST', '/pricing', { name: 'bad', type: 'percentage', value: 30, applyTo: 'price_template', conditions: { ...conds, ...bad } });
      const y = await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 30, conditions: { ...conds, ...bad } });
      ok(`rejected on save and calculate: ${name}`, x.s === 400 && y.s === 400 && /kademe/i.test(x.d?.error || ''), x.d?.error);
    }
    ok('nothing bad was stored', (await a('GET', '/pricing')).d.length === 0);

    // save, read back, tenant isolation, edit
    r = await a('POST', '/pricing', { name: 'Kademeli', type: 'percentage', value: 30, applyTo: 'price_template', conditions: conds });
    ok('template with tables saves', r.s === 201); const ruleId = r.d.id;
    const back = JSON.parse((await a('GET', '/pricing')).d[0].conditions);
    ok('tables are stored and read back as sent', back.shippingTiers.length === 3 && back.shippingTiers[2].upTo === null && back.shippingTiers[1].cost === 84);
    ok('other store cannot edit or see my template', (await b('PUT', '/pricing/' + ruleId, { name: 'x' })).s === 404 && (await b('GET', '/pricing')).d.length === 0);
    ok('editing with a broken table is refused, the old table stays', (await a('PUT', '/pricing/' + ruleId, { conditions: { ...conds, shippingTiers: [{ upTo: 5, cost: 1 }] } })).s === 400
      && JSON.parse((await a('GET', '/pricing')).d[0].conditions).shippingTiers.length === 3);

    // real product list: price comes from the same engine
    const p = await a('POST', '/products', { sku: 'T-1', barcode: '8690000009999', title: 'Tier product', price: 100, vatRate: 20, stock: 5 });
    ok('product created', p.s === 201 || p.s === 200, String(p.s));
    await c.query(`update app."Product" set "xmlPrice"=100,"vatRate"=20 where "storeId"=$1`, [store.id]);
    const list = await a('GET', `/marketplace/connections/${conn}/product-list?fresh=1&limit=5`);
    const row = list.d.products.find((x) => x.sku === 'T-1');
    ok('real product is priced with the shipping table (row 2)', row && near(row.salePrice, (await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 30, conditions: conds })).d.price), row && String(row.salePrice));
    ok('coverage uses the table and shows no loss', (await a('POST', '/pricing/coverage', { value: 30, conditions: conds })).d.losing === 0);
  } catch (e) { console.log('ERROR', e); fails++; }
  finally {
    for (const u of [A, B]) await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
