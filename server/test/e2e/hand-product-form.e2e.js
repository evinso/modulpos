// The new-product form's server side: the required attributes of a Trendyol category as a form (real Trendyol attribute lists: they are public data),
// the values the owner chooses for ONE product, and reading a Trendyol product page / link.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/hand-product-form.e2e.js
// Temporary user + a Trendyol connection with FAKE credentials. Nothing is sent to any marketplace.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = async (tag) => {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-hform-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'HForm ' + tag }) });
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
    const B = await reg('b'); users.push(B.user.id);
    const a = caller(A.token), b = caller(B.token);
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [A.user.stores[0].id])).rows[0].id;
    const connB = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [B.user.stores[0].id])).rows[0].id;
    const base = `/marketplace/connections/${conn}/product-categories`;

    // ── a real category and its real required attributes ──
    let found = [];
    for (const q of ['kupa', 'bardak', 'kolye', 'yüzük']) { found = (await a('GET', `${base}/search?q=${encodeURIComponent(q)}`)).d || []; if (found.length) break; }
    ok('the category tree answers a search', found.length > 0, JSON.stringify(found.slice(0, 2)));
    let cat = null, form = null;
    for (const leaf of found.slice(0, 8)) {
      const r = await a('POST', `${base}/attribute-form`, { categoryId: String(leaf.id), title: 'El yapımı Seramik Kupa', description: '300 ml' });
      if (r.s === 200 && r.d && !r.d.unavailable && r.d.attributes.length >= 1) { cat = leaf; form = r.d; break; }
    }
    ok('attribute form: the required attributes of a category load with their allowed values', !!form && form.category.id === String(cat.id) && form.attributes.every((x) => x.id && x.name && Array.isArray(x.values)), form ? `${form.attributes.length} attributes: ${form.attributes.map((x) => x.name).join(', ')}` : 'none of the first 8 categories had required attributes');
    if (!form) throw new Error('no category with required attributes found; the rest cannot be checked');

    const withList = form.attributes.find((x) => x.values.length >= 2);
    if (withList) {
      const pick = withList.values[1];
      const h = (await a('POST', `${base}/attribute-form`, { categoryId: String(cat.id), title: 'x', hints: [{ name: withList.name, value: pick.name }] })).d;
      const got = h.attributes.find((x) => x.id === withList.id);
      ok('a hint from a Trendyol page is matched to the allowed value and marked "page"', got && got.answer && got.answer.valueId === pick.id && got.answer.from === 'page', JSON.stringify(got && got.answer));
      const wrong = (await a('POST', `${base}/attribute-form`, { categoryId: String(cat.id), title: 'x', hints: [{ name: withList.name, value: 'olmayan-bir-değer-xyz' }] })).d;
      const gw = wrong.attributes.find((x) => x.id === withList.id);
      ok('a hint whose value is not allowed is NOT taken (nothing is guessed)', !gw.answer || gw.answer.from !== 'page' || withList.allowCustom, JSON.stringify(gw.answer));
    } else console.log('SKIP  no required attribute with a value list in this category: the hint check was skipped');
    ok('a bad category is refused (400)', (await a('POST', `${base}/attribute-form`, { categoryId: '0' })).s === 400);
    ok('another store cannot use my connection (404)', (await b('POST', `${base}/attribute-form`, { categoryId: String(cat.id) })).s === 404);

    // ── values chosen for ONE product ──
    const p = (await a('POST', '/products', { sku: 'HF-1', barcode: 'e2e-hf-1', title: 'Form ürünü', price: 100, stock: 1, vatRate: 20, brand: 'Atölye', images: ['https://example.com/a.jpg'] })).d;
    const none = await a('PUT', `${base}/product-attributes`, { productId: p.id, categoryId: String(cat.id), attributes: [] });
    ok('values cannot be saved before the product has this category (409)', none.s === 409 && /atayın/.test(none.d.error), `${none.s} ${none.d && none.d.error}`);
    const assign = await a('PUT', base, { assignments: [{ productId: p.id, categoryId: String(cat.id), source: 'manual' }] });
    ok('the category is assigned', assign.s === 200 && assign.d.saved === 1);
    const target = form.attributes.find((x) => x.values.length >= 1) || form.attributes[0];
    const items = [{ id: target.id, valueId: target.values.length ? target.values[0].id : '', valueName: target.values.length ? '' : 'e2e değer' }, { id: target.id + '-yok', valueId: '1' }];
    const put = await a('PUT', `${base}/product-attributes`, { productId: p.id, categoryId: String(cat.id), attributes: items });
    ok('the chosen value is saved for the product (a made-up attribute is ignored)', put.s === 200 && put.d.saved === 1, JSON.stringify(put.d));
    const row = (await c.query(`select attributes from app."ProductCategoryOverride" where "productId"=$1`, [p.id])).rows[0];
    const stored = JSON.parse(row.attributes)[target.id];
    ok('stored under the attribute, as this product\'s own value (`from: form`, no auto flag)', stored && stored.from === 'form' && stored.auto === undefined && (target.values.length ? stored.valueId === target.values[0].id : stored.valueName === 'e2e değer'), JSON.stringify(stored));
    const bad = await a('PUT', `${base}/product-attributes`, { productId: p.id, categoryId: String(cat.id), attributes: [{ id: target.id, valueId: '99999999' }] });
    ok('a value that is not in the allowed list is refused (skipped), the stored one stays', bad.s === 200 && bad.d.saved === 0 && bad.d.skipped.length === 1 && JSON.parse((await c.query(`select attributes from app."ProductCategoryOverride" where "productId"=$1`, [p.id])).rows[0].attributes)[target.id].from === 'form');
    ok('another store cannot touch the product (404)', (await b('PUT', `/marketplace/connections/${connB}/product-categories/product-attributes`, { productId: p.id, categoryId: String(cat.id), attributes: [] })).s === 404);
    const wrongCat = await a('PUT', `${base}/product-attributes`, { productId: p.id, categoryId: String(Number(cat.id) + 1), attributes: [] });
    ok('values for a different category than the product\'s are refused (409)', wrongCat.s === 409);

    // ── reading a Trendyol page ──
    const imp = (body) => a('POST', '/products/trendyol-import', body);
    for (const bad of ['', 'https://evil.com/a-p-123456', 'http://www.trendyol.com/a-p-123456', 'https://www.trendyol.com@evil.com/a-p-123456', 'https://169.254.169.254/a-p-123456', 'https://www.trendyol.com/kupa-y-s12017']) {
      const r = await imp({ url: bad });
      if (r.s !== 400) { ok(`import: ${bad || '(empty)'} is refused (400)`, false, `${r.s} ${JSON.stringify(r.d).slice(0, 100)}`); }
    }
    ok('import: addresses that are not Trendyol product links are all refused (400), nothing is fetched', true);
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'Seramik Kupa 300 ml - Fiyatı, Yorumları', description: '<p>El yapımı</p>', image: ['https://cdn.dsmcdn.com/ty1/a_org_zoom.jpg'], brand: { name: 'Atölye' }, offers: { price: '199.5' } };
    const fromSource = await imp({ source: `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>` });
    ok('import from pasted page source: title (site suffix dropped), text, picture, brand, price', fromSource.s === 200 && fromSource.d.data.title === 'Seramik Kupa 300 ml' && fromSource.d.data.description === 'El yapımı' && fromSource.d.data.images.length === 1 && fromSource.d.data.brand === 'Atölye' && fromSource.d.data.price === 199.5, JSON.stringify(fromSource.d).slice(0, 200));
    const state = { product: { name: 'Kupa', category: { id: cat.id, name: cat.name, hierarchy: 'x/y' }, attributes: [{ key: { name: 'Renk' }, value: { name: 'Beyaz' } }], images: ['/ty1/x.jpg'] } };
    const exact = await imp({ source: `<script>window.__PRODUCT_DETAIL_APP_INITIAL_STATE__=${JSON.stringify(state)};</script>` });
    ok('the page\'s category id, when it is a category of our tree with the same name, is taken as it is ("exact")', exact.s === 200 && exact.d.data.category && exact.d.data.category.id === String(cat.id) && exact.d.data.category.how === 'exact' && exact.d.data.attributes[0].name === 'Renk', JSON.stringify(exact.d && exact.d.data && exact.d.data.category));
    state.product.category = { id: 0, name: 'Kupa Bardak', hierarchy: 'x/y/Kupa' };
    const guess = await imp({ source: `<script>window.__PRODUCT_DETAIL_APP_INITIAL_STATE__=${JSON.stringify(state)};</script>` });
    ok('when the id does not fit, the category is a GUESS by name, flagged as such', guess.s === 200 && guess.d.data.category && guess.d.data.category.how === 'guess', JSON.stringify(guess.d && guess.d.data && guess.d.data.category));
    const empty = await imp({ source: '<html><body>Merhaba</body></html>' });
    ok('a text without product data is refused with a sentence (422)', empty.s === 422 && empty.d.notFound === true && /ürün bilgisi bulunamadı/.test(empty.d.error), `${empty.s} ${empty.d && empty.d.error}`);
    const huge = await imp({ source: 'x'.repeat(4_600_000) });
    ok('a text over 4.5 MB is refused (413 / 400)', huge.s === 413 || huge.s === 400, String(huge.s));
    const live = await imp({ url: 'https://www.trendyol.com/his-studio/geyik-figurlu-3d-kabartmali-tamamiyla-el-yapimi-seramik-kupa-p-1075130175' });
    console.log(`INFO  reading a real Trendyol link from the server: HTTP ${live.s} ${live.d && (live.d.blocked ? '(blocked by Trendyol, as expected: the page asks for the page source)' : (live.d.data ? '(worked!)' : JSON.stringify(live.d).slice(0, 100)))}`);
    ok('a real link either works or is reported as blocked / failed with a sentence (never a crash)', live.s === 200 || (live.s === 422 && live.d.blocked) || (live.s === 502 && live.d.error), `${live.s}`);
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
