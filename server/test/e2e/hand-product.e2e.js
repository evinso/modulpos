// Products added by hand: their "price" is the NET amount the owner wants to keep per sale, the marketplace price is worked out backwards
// from it by the price template of the scope "Elle eklenen ürünler" (xmlSourceIds: ['none']).
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/hand-product.e2e.js
// Temporary user + a Trendyol connection with FAKE credentials. Nothing is sent to any marketplace.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const near = (a, b, tol = 0.02) => typeof a === 'number' && Math.abs(a - b) <= tol;
  const reg = async (tag) => {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-hand-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Hand ' + tag }) });
    const j = await r.json();
    if (!j.user) throw new Error(`register failed (HTTP ${r.status}; 20 per 15 minutes): ${JSON.stringify(j).slice(0, 160)}`);
    return j;
  };
  const caller = (token) => async (m, u, b) => {
    const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: b ? JSON.stringify(b) : undefined });
    let d; try { d = await r.json(); } catch { /* empty */ }
    return { s: r.status, d };
  };
  const users = [];
  try {
    const A = await reg('a'); users.push(A.user.id);
    const a = caller(A.token); const store = A.user.stores[0];
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [store.id])).rows[0].id;

    // ── adding a product by hand ──
    const body = { sku: 'EL-1', barcode: 'e2e-el-1', title: 'El yapımı kupa', price: 100, stock: 5, vatRate: 20, brand: 'Atölye', images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] };
    const bad = async (label, patch, re, status = 400) => { const r = await a('POST', '/products', { ...body, sku: 'EL-X' + Math.random().toString(36).slice(2, 6), ...patch }); ok(`create: ${label} is refused (${status})`, r.s === status && re.test((r.d && r.d.error) || ''), `${r.s} ${r.d && r.d.error}`); };
    await bad('a picture address that is not http(s)', { images: ['javascript:alert(1)'] }, /http/);
    await bad('a negative amount', { price: -5 }, /Fiyat/);
    await bad('more than 12 pictures', { images: Array.from({ length: 13 }, (_, i) => `https://example.com/${i}.jpg`) }, /12/);
    const p = await a('POST', '/products', body);
    ok('create: the product is saved with its pictures, brand and barcode, without an XML source', p.s === 201 && p.d.xmlSourceId === null && p.d.price === 100 && JSON.parse(p.d.images).length === 2 && p.d.brand === 'Atölye', JSON.stringify(p.d).slice(0, 120));
    const dup = await a('POST', '/products', body);
    ok('create: the same SKU again is refused with a sentence (409)', dup.s === 409 && /SKU/.test((dup.d && dup.d.error) || ''), `${dup.s} ${dup.d && dup.d.error}`);
    const pid = p.d.id;

    // ── no template for hand-added products yet: no price, and the list says why ──
    const list0 = await a('GET', `/marketplace/connections/${conn}/product-list?fresh=1&limit=20&xmlSourceId=none`);
    const row0 = (list0.d.products || []).find((x) => x.id === pid);
    ok('without a template: no price and the reason "no pricing rule"', row0 && row0.salePrice == null && row0.issues.some((i) => i.code === 'no_price_rule'), JSON.stringify(row0 && row0.issues));

    // ── a template for "Elle eklenen ürünler": the owner's real costs ──
    const costs = { connectionId: null, xmlSourceIds: ['none'], categories: [], brands: [], shippingCost: 100, packagingCost: 0, extraCost: 0, commissionPct: 22, extraPct: 0, serviceFee: 13.19, inputVat: true, purchaseVatRate: 20, withholdingPct: 1,
      commissionBasis: 'gross', vatRate: null, profitMode: 'fixed', roundingMode: 'none', shippingTiers: [], profitTiers: [], netMode: 'cash' };
    const badMode = await a('POST', '/pricing', { name: 'x', type: 'percentage', value: 0, applyTo: 'price_template', conditions: { ...costs, netMode: 'weird' } });
    ok('template: an unknown net mode is refused (400)', badMode.s === 400 && /Net tutar/.test((badMode.d && badMode.d.error) || ''), `${badMode.s} ${badMode.d && badMode.d.error}`);
    const t = await a('POST', '/pricing', { name: 'Elle eklenenler', type: 'percentage', value: 0, applyTo: 'price_template', conditions: costs });
    ok('template: saved with the scope "none"', t.s === 200 || t.s === 201, String(t.s));
    const detail = async () => (await a('GET', `/products/${pid}/detail`)).d.marketplaces.find((m) => m.connectionId === conn).pricing;
    let pr = await detail();
    ok('cash mode: the amount 100 becomes ~302.84 on the marketplace (commission, shipping, fee, stopaj and VAT added on top)', pr && near(pr.salePrice, 302.84), JSON.stringify(pr && pr.salePrice));
    ok('cash mode: exactly 100 is left, no purchase cost, and the product says it is a net amount', pr && near(pr.breakdown.profit, 100) && pr.breakdown.purchase === 0 && pr.net && pr.net.amount === 100 && pr.net.mode === 'cash', JSON.stringify(pr && pr.net));
    ok('cash mode: the list adds up (price - commission - fee - stopaj - VAT to pay - shipping = what stays)', pr && near(pr.salePrice - pr.breakdown.commissionAmount - pr.breakdown.serviceFee - pr.breakdown.withholding - pr.breakdown.payableVat - pr.breakdown.shippingCost, pr.breakdown.profit, 0.04));
    const list1 = await a('GET', `/marketplace/connections/${conn}/product-list?fresh=1&limit=20&xmlSourceId=none`);
    const row1 = (list1.d.products || []).find((x) => x.id === pid);
    ok('the Trendyol list shows the same price and no pricing problem', row1 && near(row1.salePrice, 302.84) && !row1.issues.some((i) => i.code === 'no_price_rule'), JSON.stringify(row1 && [row1.salePrice, row1.issues.map((i) => i.code)]));

    // ── the other way of reading "100 TL": the amount is the purchase price, profit 0 ──
    await a('PUT', `/pricing/${t.d.id}`, { conditions: { ...costs, netMode: 'purchase' } });
    pr = await detail();
    ok('purchase mode: ~276.87 (the VAT inside a purchase price is deducted), profit 0', pr && near(pr.salePrice, 276.87) && near(pr.breakdown.profit, 0) && pr.breakdown.purchase === 100 && pr.net.mode === 'purchase', JSON.stringify(pr && [pr.salePrice, pr.net]));
    await a('PUT', `/pricing/${t.d.id}`, { conditions: { ...costs, netMode: 'cash' } });
    pr = await detail();
    ok('back to cash mode: ~302.84 again', pr && near(pr.salePrice, 302.84));

    // ── the template screen's calculator and coverage understand the scope ──
    const calc = await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 0, conditions: { ...costs, vatRate: 20 } });
    ok('calculator: the same number for the same costs, with the net info', calc.s === 200 && near(calc.d.price, 302.84) && calc.d.net && calc.d.net.mode === 'cash', JSON.stringify(calc.d).slice(0, 100));
    const calc0 = await a('POST', '/pricing/calculate', { purchasePrice: 0, value: 0, conditions: { ...costs, vatRate: 20 } });
    ok('calculator: no amount, no price (400)', calc0.s === 400);
    const cov = await a('POST', '/pricing/coverage', { value: 0, conditions: costs });
    ok('coverage: the template applies to the 1 product added by hand', cov.s === 200 && cov.d.covered === 1 && cov.d.priced === 1 && near(cov.d.totalProfit, 100), JSON.stringify(cov.d).slice(0, 140));

    // ── a price typed in by hand still wins, and a loss is told ──
    const lowP = await a('PUT', `/products/${pid}/sale-price`, { connectionId: conn, price: 140 });
    ok('a hand-typed sale price below the costs asks for confirmation (409, loss)', lowP.s === 409 && lowP.d.loss === true, `${lowP.s} ${JSON.stringify(lowP.d)}`);
    const highP = await a('PUT', `/products/${pid}/sale-price`, { connectionId: conn, price: 350 });
    pr = await detail();
    ok('a higher hand-typed price leaves more than 100 and keeps the net info', highP.s === 200 && pr.manual === true && pr.salePrice === 350 && pr.breakdown.profit > 100 && pr.net && pr.net.amount === 100, JSON.stringify(pr && [pr.manual, pr.salePrice]));
    await a('DELETE', `/products/${pid}/sale-price?connectionId=${conn}`);

    // ── the XML products are not touched by a template of the scope "none" ──
    const src = (await c.query(`insert into app."XmlSource"(id,"storeId",name,url,"updatedAt") values(gen_random_uuid(),$1,'e2e kaynak','https://example.invalid/x.xml',now()) returning id`, [store.id])).rows[0].id;
    const xp = (await a('POST', '/products', { ...body, sku: 'XML-1', barcode: 'e2e-xml-1', title: 'XML ürünü' })).d;
    await c.query(`update app."Product" set "xmlSourceId"=$1, "xmlPrice"=100 where id=$2`, [src, xp.id]);
    const xdetail = async () => (await a('GET', `/products/${xp.id}/detail`)).d.marketplaces.find((m) => m.connectionId === conn).pricing;
    ok('an XML product is not priced by the template of hand-added products', (await xdetail()) === null);
    const own = { ...costs, xmlSourceIds: [src], profitMode: 'percent_of_purchase' };
    await a('POST', '/pricing', { name: 'xml kaynağı', type: 'percentage', value: 30, applyTo: 'price_template', conditions: own });
    const xp1 = await xdetail();
    const calcX = await a('POST', '/pricing/calculate', { purchasePrice: 100, value: 30, conditions: { ...own, vatRate: 20 } });
    ok('its own template prices it the usual way (purchase + 30% profit), not as a net amount', xp1 && near(xp1.salePrice, calcX.d.price) && xp1.net === null && xp1.breakdown.purchase === 100, JSON.stringify(xp1 && [xp1.salePrice, calcX.d.price, xp1.net]));
    const again = await detail();
    ok('and the hand-added product is still priced by its own template', near(again.salePrice, 302.84));
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
