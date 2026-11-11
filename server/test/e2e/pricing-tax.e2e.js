// Price template tax options (KDV mükellefiyim = recoverable VAT on costs, stopaj, service fee) against a RUNNING deployment.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/pricing-tax.e2e.js
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';
(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const A = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-tax-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Tax' }) }).then((r) => r.json());
  const a = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A.token }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d }; };
  const storeId = A.user.stores[0].id;
  const near = (x, y, t = 0.011) => Math.abs(x - y) < t;
  const sync = async (id) => { await a('POST', `/xml-sources/${id}/sync`); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = (await a('GET', `/xml-sources/${id}/sync-status`)).d; if (!s.running && s.last.status !== 'started') return s.last; } };
  try {
    // the owner's reference sale: 586,90 TL, purchase 195, shipping 106, commission 22%, service fee 13,19, stopaj 1%, VAT 20%
    const TAX = { commissionPct: 22, commissionBasis: 'gross', vatRate: 20, shippingCost: 106, serviceFee: 13.19, inputVat: true, purchaseVatRate: 20, withholdingPct: 1, profitMode: 'fixed' };
    const r = await a('POST', '/pricing/calculate', { purchasePrice: 195, value: 114.77, conditions: TAX });
    ok('the calculator reproduces the reference sale: price 586,90 for a net profit of 114,77', r.s === 200 && near(r.d.price, 586.9, 0.02) && near(r.d.profit, 114.77, 0.03), JSON.stringify([r.d.price, r.d.profit]));
    ok('with every line of the reference screen', r.d.taxModel === true && near(r.d.commissionAmount, 129.12, 0.02) && near(r.d.serviceFee, 13.19) && near(r.d.withholding, 4.89, 0.02) && near(r.d.payableVat, 23.93, 0.03) && r.d.shippingCost === 106, JSON.stringify([r.d.commissionAmount, r.d.withholding, r.d.payableVat]));
    ok('and the VAT breakdown', r.d.vatDetail && near(r.d.vatDetail.sale, 97.82, 0.03) && near(r.d.vatDetail.purchase, 32.5, 0.02) && near(r.d.vatDetail.shipping, 17.67) && near(r.d.vatDetail.commission, 21.52, 0.02) && near(r.d.vatDetail.serviceFee, 2.2), JSON.stringify(r.d.vatDetail));

    // the earlier calculation is untouched when the options are absent
    const old = await a('POST', '/pricing/calculate', { purchasePrice: 195, value: 114.77, conditions: { commissionPct: 22, commissionBasis: 'gross', vatRate: 20, shippingCost: 106, packagingCost: 13.19, profitMode: 'fixed' } });
    ok('without the options the same profit target gives the earlier, higher price (no VAT credit, no stopaj)', old.s === 200 && old.d.taxModel === undefined && old.d.price > r.d.price + 50, JSON.stringify([old.d.price, r.d.price]));

    // a stored template with the options prices real products and shows the breakdown
    const src = (await a('POST', '/xml-sources', { name: 'tax', url: base + 'feed-turkish.xml', syncIntervalMin: 60, defaultVatRate: 20 })).d;
    await sync(src.id);
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [storeId])).rows[0].id;
    const prod = (await c.query(`select id from app."Product" where "xmlSourceId"=$1 order by sku limit 1`, [src.id])).rows[0].id;
    const plain = { connectionId: conn, commissionPct: 22, commissionBasis: 'gross', shippingCost: 100, packagingCost: 13.19, profitMode: 'percent_of_purchase', xmlSourceIds: [src.id], shippingTiers: [], profitTiers: [] };
    const t1 = await a('POST', '/pricing', { name: 'eski hesap', type: 'percentage', value: 40, applyTo: 'price_template', conditions: plain });
    const priceOf = async () => (await a('GET', `/products/${prod}/detail`)).d.marketplaces.find((m) => m.connectionId === conn).pricing;
    const p1 = await priceOf();
    ok('earlier template: no tax lines in the breakdown', p1.breakdown && p1.breakdown.taxModel === undefined, JSON.stringify(p1.breakdown && p1.breakdown.profit));
    ok('editing a template to switch the options on is accepted', (await a('PUT', '/pricing/' + t1.d.id, { conditions: { ...plain, packagingCost: 0, serviceFee: 13.19, inputVat: true, purchaseVatRate: 20, withholdingPct: 1 } })).s === 200);
    const p2 = await priceOf();
    ok('the same product now has a LOWER price and the tax breakdown, profit still on target (40% of purchase)', p2.salePrice < p1.salePrice && p2.breakdown.taxModel === true && near(p2.breakdown.profit, p2.breakdown.purchase * 0.4, 0.05), JSON.stringify([p1.salePrice, p2.salePrice, p2.breakdown.profit]));
    const prev = await a('GET', `/products/${prod}/price-preview?connectionId=${conn}&price=${p2.salePrice}`);
    ok('the price dialog gets the full breakdown', prev.s === 200 && prev.d.breakdown && prev.d.breakdown.taxModel === true && near(prev.d.profit, p2.breakdown.profit, 0.02), JSON.stringify(prev.d.breakdown && prev.d.breakdown.payableVat));
    const cov = await a('POST', '/pricing/coverage', { value: 40, conditions: { ...plain, packagingCost: 0, serviceFee: 13.19, inputVat: true, purchaseVatRate: 20, withholdingPct: 1 } });
    ok('coverage (total earnings of the screen) uses the same model', cov.s === 200 && cov.d.priced === 3 && cov.d.losing === 0, JSON.stringify([cov.d.priced, cov.d.totalProfit]));
    const stored = JSON.parse((await a('GET', '/pricing')).d.find((x) => x.id === t1.d.id).conditions);
    ok('the options are stored with the template', stored.inputVat === true && stored.withholdingPct === 1 && stored.serviceFee === 13.19 && stored.purchaseVatRate === 20);
  } catch (e) { console.log('ERROR', e); fails++; }
  finally {
    await c.query(`delete from app."SyncLog" where "storeId"=$1`, [storeId]).catch(() => {});
    await c.query(`delete from app."User" where id=$1`, [A.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
