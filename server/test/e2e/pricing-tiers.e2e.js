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

    // tariff-style table (VAT-exclusive numbers, as printed by the marketplace)
    const exConds = { ...conds, shippingTiersExVat: true, shippingTiers: [{ upTo: 199.99, cost: 48.33 }, { upTo: 349.99, cost: 79.16 }, { upTo: null, cost: 88.96 }] };
    r = await a('POST', '/pricing/calculate', { purchasePrice: 40, value: 30, conditions: exConds });
    ok('VAT-exclusive table: row 1, shipping charged with 20% VAT (48.33 -> 58.00)', r.s === 200 && r.d.shippingTier === 1 && near(r.d.shippingCost, 58.0), JSON.stringify(r.d).slice(0, 120));
    r = await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 30, conditions: exConds });
    ok('VAT-exclusive table: row 2 (limit 199.99 ex VAT = 240 incl VAT), profit kept', r.d.shippingTier === 2 && near(r.d.shippingCost, 94.99) && near(r.d.profit, 30), JSON.stringify(r.d).slice(0, 120));

    // net margin method (profit = value% of the VAT-inclusive sale price), together with the tariff-style shipping table
    const mConds = { ...exConds, profitMode: 'margin_on_gross', packagingCost: 16.39, commissionPct: 22.37 };
    for (const P of [20, 96, 300]) {
      r = await a('POST', '/pricing/calculate', { purchasePrice: P, value: 10, conditions: mConds });
      ok(`net margin 10% holds for purchase ${P} (shipping row ${r.d?.shippingTier})`, r.s === 200 && r.d.marginOnPricePct >= 9.99 && r.d.marginOnPricePct < 10.6, r.d && JSON.stringify([r.d.price, r.d.profit, r.d.marginOnPricePct]));
    }
    r = await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 95, conditions: mConds });
    ok('an impossible margin is refused with a clear message', r.s === 400, JSON.stringify(r.d));

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
    // bands + per-template summaries over several products
    for (let i = 0; i < 12; i++) await a('POST', '/products', { sku: 'B-' + i, barcode: '86900000100' + i, title: 'Band ' + i, price: 20 + i * 25, vatRate: 20, stock: 1 });
    await c.query(`update app."Product" set "xmlPrice"=price,"vatRate"=20 where "storeId"=$1`, [store.id]);
    const cov = (await a('POST', '/pricing/coverage', { value: 30, conditions: conds })).d;
    ok('coverage returns auto bands that add up to the products', cov.bands.length >= 3 && cov.bands.reduce((t, x) => t + x.count, 0) === cov.priced && cov.bands[0].from === 0 && cov.bands[cov.bands.length - 1].to === null, JSON.stringify(cov.bands.map((x) => [x.from, x.to, x.count])));
    ok('bands show the shipping row and it rises with the price', cov.bands[0].shippingTier <= cov.bands[cov.bands.length - 1].shippingTier && cov.bands[cov.bands.length - 1].shippingTier >= 2);
    const sums = (await a('GET', '/pricing/summaries')).d;
    ok('template list summary: products, margin, total', sums.rules[ruleId] && sums.rules[ruleId].covered === cov.covered && near(sums.rules[ruleId].totalProfit, cov.totalProfit), JSON.stringify(sums.rules[ruleId]));
    ok('other store sees no summaries of mine', Object.keys((await b('GET', '/pricing/summaries')).d.rules).length === 0);
  } catch (e) { console.log('ERROR', e); fails++; }
  finally {
    for (const u of [A, B]) await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
