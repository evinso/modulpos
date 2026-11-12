// Product-level Trendyol categories: assignment, priority over the XML-category mapping, readiness, isolation,
// attributes per category, and the paid AI step (credits are refunded when nothing comes back). See test/e2e/README.md.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const mk = async (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: tag }) }).then((r) => r.json());
  const A = await mk('pcat'); const B = await mk('pcatb');
  const callAs = (reg) => async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d }; };
  const call = callAs(A); const callB = callAs(B);
  const storeId = A.user.stores[0].id;
  const sync = async (id) => { await call('POST', `/xml-sources/${id}/sync`); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = (await call('GET', `/xml-sources/${id}/sync-status`)).d; if (!s.running && s.last.status !== 'started') return s.last; } };
  const balance = async () => (await c.query(`select balance from app."CreditBalance" where "userId"=$1`, [A.user.id])).rows[0]?.balance;
  try {
    const src = (await call('POST', '/xml-sources', { name: 'pcat', url: base + 'feed-turkish.xml', syncIntervalMin: 60, defaultVatRate: 20 })).d;
    await sync(src.id);
    const conn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','1','k','s',now()) returning id`, [storeId])).rows[0].id;
    const P = `/marketplace/connections/${conn}/product-categories`;
    await call('POST', '/pricing', { name: 't', type: 'percentage', value: 20, applyTo: 'price_template', conditions: { connectionId: conn, commissionBasis: 'gross' } });

    const ov0 = (await call('GET', `${P}/overview?xmlSourceId=${src.id}`)).d;
    ok('overview counts the imported products, none has a category yet', ov0.total === 3 && ov0.missing === 3 && ov0.assigned === 0 && ov0.aiCostPerProduct >= 0, JSON.stringify({ t: ov0.total, m: ov0.missing }));
    const page = (await call('GET', `${P}/products?xmlSourceId=${src.id}&status=missing`)).d;
    ok('the list gives free suggestions for products without a category', page.total === 3 && page.products.every((p) => Array.isArray(p.suggestions)) && page.products.some((p) => p.suggestions.length > 0), page.products.map((p) => p.suggestions.length).join(','));
    const ids = (await call('GET', `${P}/ids?xmlSourceId=${src.id}&status=missing`)).d;
    ok('"select all filtered" returns every id', ids.total === 3 && ids.ids.length === 3);
    ok('manual picker searches the Trendyol tree', (await call('GET', `${P}/search?q=kupa`)).d.some((r) => r.name === 'Kupa'));

    // free suggestions for the XML CATEGORIES (the "Kategori eşleştirme" tab)
    const bal0 = await balance();
    const cs = await call('GET', `${P}/category-suggestions?xmlSourceId=${src.id}`);
    const dbCats = (await c.query(`select category, count(*)::int n from app."Product" where "xmlSourceId"=$1 and category is not null group by 1`, [src.id])).rows;
    const csRows = (cs.d && cs.d.categories) || [];
    ok('category suggestions: one row per XML category with its product count', cs.s === 200 && csRows.length === dbCats.length && dbCats.length > 0 && csRows.every((r) => dbCats.some((d) => d.category === r.category && d.n === r.total)), JSON.stringify(csRows.map((r) => [r.category, r.total])));
    ok('every row has the flags and suggestions with a Trendyol id, name, path and share', csRows.every((r) => typeof r.mixed === 'boolean' && typeof r.weak === 'boolean' && Array.isArray(r.suggestions) && r.suggestions.length <= 3 && r.suggestions.every((x) => x.id && x.name && x.path && typeof x.share === 'number')));
    ok('a 3-product feed has too little evidence: every category is weak, none mixed', csRows.every((r) => r.weak === true && r.mixed === false));
    ok('at least one XML category gets a suggestion from its product titles', csRows.some((r) => r.suggestions.length > 0));
    ok('it needs a XML source ("none" and missing are refused)', (await call('GET', `${P}/category-suggestions`)).s === 400 && (await call('GET', `${P}/category-suggestions?xmlSourceId=none`)).s === 400);
    ok('a source that is not this store\'s is not found', (await call('GET', `${P}/category-suggestions?xmlSourceId=00000000-0000-0000-0000-000000000000`)).s === 404);
    ok('another store cannot read them (the connection is not found)', (await callB('GET', `${P}/category-suggestions?xmlSourceId=${src.id}`)).s === 404);
    ok('suggestions are free', String(await balance()) === String(bal0));

    // readiness BEFORE: blocked for lack of any category
    const before = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d.products;
    ok('before: every product is blocked by "no category"', before.length === 3 && before.every((p) => p.issues.some((i) => i.code === 'no_category_mapping')));

    // assign one category to one product
    const kupa = (await call('GET', `${P}/search?q=kupa`)).d.find((r) => r.name === 'Kupa');
    const target = page.products[0];
    const put = await call('PUT', P, { assignments: [{ productId: target.id, categoryId: kupa.id, source: 'manual' }] });
    ok('assigning a category to one product is saved', put.s === 200 && put.d.saved === 1, JSON.stringify(put.d));
    const after = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d.products;
    const one = after.find((p) => p.id === target.id); const rest = after.filter((p) => p.id !== target.id);
    ok('after: that product is no longer blocked by "no category" and shows the chosen category', !one.issues.some((i) => i.code === 'no_category_mapping') && /Kupa/.test(one.mapName || ''), one.mapName);
    ok('the other products are untouched', rest.every((p) => p.issues.some((i) => i.code === 'no_category_mapping')));
    const ov1 = (await call('GET', `${P}/overview?xmlSourceId=${src.id}`)).d;
    ok('overview follows', ov1.assigned === 1 && ov1.missing === 2, JSON.stringify({ a: ov1.assigned, m: ov1.missing }));
    ok('status filter "assigned" lists exactly it', (await call('GET', `${P}/products?xmlSourceId=${src.id}&status=assigned`)).d.products.map((p) => p.id).join() === target.id);

    // priority over an XML-category mapping
    const sample = (await c.query(`select category from app."Product" where id=$1`, [target.id])).rows[0].category;
    await call('POST', `/marketplace/connections/${conn}/category-mappings`, { xmlSourceId: src.id, localCategory: sample, marketplaceCategoryId: 411, marketplaceCategoryName: 'Genel > Kategori' });
    const mixed = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d.products;
    ok('the product\'s own category beats the XML-category mapping', /Kupa/.test(mixed.find((p) => p.id === target.id).mapName || ''));

    // validation + isolation
    ok('an unknown Trendyol category is refused', (await call('PUT', P, { assignments: [{ productId: target.id, categoryId: 'zzz' }] })).s === 400);
    ok('another store cannot see the connection (404)', (await callB('GET', `${P}/overview?xmlSourceId=${src.id}`)).s === 404);
    const foreign = (await callB('PUT', P, { assignments: [{ productId: target.id, categoryId: kupa.id }] }));
    ok('another store cannot assign to our connection either (404)', foreign.s === 404);
    const bConn = (await c.query(`insert into app."MarketplaceConnection"(id,"storeId","marketplaceType","sellerId","apiKey","apiSecret","updatedAt") values(gen_random_uuid(),$1,'trendyol','2','k','s',now()) returning id`, [B.user.stores[0].id])).rows[0].id;
    const crossProd = await callB('PUT', `/marketplace/connections/${bConn}/product-categories`, { assignments: [{ productId: target.id, categoryId: kupa.id }] });
    ok('our products cannot be given a category through someone else\'s connection', crossProd.s === 200 && crossProd.d.saved === 0, JSON.stringify(crossProd.d));

    // free bulk step
    const bulk = await call('POST', `${P}/apply-suggestions`, { productIds: ids.ids });
    ok('free bulk step applies the best suggestion where one exists', bulk.s === 200 && bulk.d.applied + bulk.d.skipped === 3 && bulk.d.applied >= 1, JSON.stringify(bulk.d));
    const rows = (await c.query(`select source from app."ProductCategoryOverride" where "connectionId"=$1`, [conn])).rows;
    ok('those are stored with the source "rule" (the manual one is replaced by the suggestion only because it was listed)', rows.some((r) => r.source === 'rule'));

    // attributes belong to the category
    const grp = (await call('GET', `${P}/groups`)).d;
    ok('groups lists the chosen categories with counts', Array.isArray(grp) && grp.length >= 1 && grp.every((g) => g.count >= 1));
    const catId = grp[0].categoryId;
    ok('bad attribute payload is refused', (await call('PUT', `${P}/attributes`, { categoryId: catId, attributes: { x: 1 } })).s === 400);
    const at = await call('PUT', `${P}/attributes`, { categoryId: catId, attributes: { 5: { name: 'Renk', valueId: '91', valueName: 'Beyaz' } } });
    ok('attributes are stored for every product of that category', at.s === 200 && at.d.updated >= 1, JSON.stringify(at.d));

    // default answers for required attributes (saved on the connection, applied to the chosen categories)
    await c.query(`update app."MarketplaceConnection" set config=$2 where id=$1`, [conn, JSON.stringify({ brandStrategy: 'override', defaultBrandId: 7 })]);
    const d0 = (await call('GET', `${P}/attribute-defaults`)).d;
    ok('before anything is saved the page gets the suggestion (Menşei TR, colours Çok Renkli, rest Belirtilmemiş)', d0.saved === false && d0.rules.some((r) => r.name === 'Menşei' && r.value === 'TR') && d0.fallback.enabled === true && d0.fallback.value === 'Belirtilmemiş', JSON.stringify(d0));
    ok('a half rule is refused', (await call('PUT', `${P}/attribute-defaults`, { rules: [{ name: 'Menşei', value: '' }] })).s === 400);
    ok('"everything else" without a value is refused', (await call('PUT', `${P}/attribute-defaults`, { rules: [], fallback: { enabled: true, value: '' } })).s === 400);
    ok('nothing was saved by refused requests', (await call('GET', `${P}/attribute-defaults`)).d.saved === false);
    ok('another store cannot read or change them (404)', (await callB('GET', `${P}/attribute-defaults`)).s === 404 && (await callB('PUT', `${P}/attribute-defaults`, { rules: [] })).s === 404);
    const sd = await call('PUT', `${P}/attribute-defaults`, { rules: [{ name: 'Menşei', value: 'TR' }, { name: 'Renk, Web Color', value: 'Çok Renkli' }], fallback: { enabled: true, value: 'Belirtilmemiş' } });
    ok('saving works and reports what it applied (test credentials cannot reach Trendyol, so categories wait as "pending")', sd.s === 200 && sd.d.saved === true && typeof sd.d.products === 'number' && typeof sd.d.pending === 'number', JSON.stringify({ s: sd.s, c: sd.d.categories, p: sd.d.products, pend: sd.d.pending }));
    const d1 = (await call('GET', `${P}/attribute-defaults`)).d;
    ok('they are stored and read back', d1.saved === true && d1.rules.length === 2 && d1.fallback.value === 'Belirtilmemiş');
    const cfg = JSON.parse((await c.query(`select config from app."MarketplaceConnection" where id=$1`, [conn])).rows[0].config);
    ok('other connection settings are untouched', cfg.brandStrategy === 'override' && cfg.defaultBrandId === 7 && !!cfg.attributeDefaults);
    const again = await call('PUT', P, { assignments: [{ productId: ids.ids[2], categoryId: kupa.id, source: 'manual' }] });
    ok('assigning a category still works when the defaults cannot be applied right now', again.s === 200 && again.d.saved === 1);

    // open required attributes read from each product's title and description (the test credentials cannot reach Trendyol: no value lists)
    await call('GET', '/credits/balance');
    await c.query(`update app."CreditBalance" set balance = 50 where "userId" = $1`, [A.user.id]);
    const balAttr0 = Number(await balance());
    const gaps = await call('GET', `${P}/attribute-gaps`);
    ok('gaps list: ids, attribute tally, AI price and how many categories could not be read', gaps.s === 200 && Array.isArray(gaps.d.ids) && Array.isArray(gaps.d.attributes) && typeof gaps.d.products === 'number' && gaps.d.aiCostPerProduct >= 0 && gaps.d.pending >= 0, JSON.stringify(gaps.d).slice(0, 160));
    ok('gaps list of a XML source works, a foreign source is not found', (await call('GET', `${P}/attribute-gaps?xmlSourceId=${src.id}`)).s === 200 && (await call('GET', `${P}/attribute-gaps?xmlSourceId=00000000-0000-0000-0000-000000000000`)).s === 404);
    const fromText = await call('POST', `${P}/attributes-from-text`, {});
    ok('free step answers with its report (nothing to read without value lists, nothing breaks)', fromText.s === 200 && ['scanned', 'products', 'filledProducts', 'filledAttributes'].every((k) => typeof fromText.d[k] === 'number') && Array.isArray(fromText.d.stillMissing) && fromText.d.byFrom && typeof fromText.d.pending === 'number', JSON.stringify(fromText.d).slice(0, 200));
    ok('free step: a XML source can be given, a foreign one is refused, bad input is refused', (await call('POST', `${P}/attributes-from-text`, { xmlSourceId: src.id })).s === 200 && (await call('POST', `${P}/attributes-from-text`, { xmlSourceId: '00000000-0000-0000-0000-000000000000' })).s === 404 && (await call('POST', `${P}/attributes-from-text`, { productIds: 'x' })).s === 400);
    ok('free step: "none" (products added by hand) is understood', (await call('POST', `${P}/attributes-from-text`, { xmlSourceId: 'none' })).s === 200);
    ok('AI attribute step: no products and too many products are refused', (await call('POST', `${P}/attributes-ai`, { productIds: [] })).s === 400 && (await call('POST', `${P}/attributes-ai`, { productIds: Array.from({ length: 41 }, (_, i) => 'x' + i) })).s === 400);
    const aiAttr = await call('POST', `${P}/attributes-ai`, { productIds: ids.ids });
    ok('AI attribute step with nothing to ask (no value lists) asks nothing and costs nothing', aiAttr.s === 200 && aiAttr.d.asked === 0 && aiAttr.d.charged === 0 && Math.abs(Number(await balance()) - balAttr0) < 1e-9, JSON.stringify(aiAttr.d));
    ok('another store cannot use any of the attribute steps (404)', (await callB('GET', `${P}/attribute-gaps`)).s === 404 && (await callB('POST', `${P}/attributes-from-text`, {})).s === 404 && (await callB('POST', `${P}/attributes-ai`, { productIds: ids.ids })).s === 404);
    ok('the credit price is public to the page', (await call('GET', '/credits/prices')).d.productAttributeAiCost >= 0);

    // paid AI step: give the temp user credits, call, and check the books balance whatever the vendor says
    await call('GET', '/credits/balance');
    await c.query(`update app."CreditBalance" set balance = 50 where "userId" = $1`, [A.user.id]);
    const b0 = await balance();
    const ai = await call('POST', `${P}/ai-match`, { productIds: [ids.ids[1]] });
    const b1 = await balance();
    if (ai.s === 502) ok('AI unavailable: a clear message and the credits are back', !!ai.d.error && ai.d.refunded === true && Math.abs(b1 - b0) < 1e-6, `${ai.d.error} | ${b0} -> ${b1}`);
    else ok('AI answered: charged only for products with a result', ai.s === 200 && Math.abs((b0 - b1) - ai.d.charged) < 1e-6, JSON.stringify({ s: ai.s, matched: ai.d.matched, charged: ai.d.charged, b0, b1 }));
    ok('AI limits: more than 100 products in one call is refused', (await call('POST', `${P}/ai-match`, { productIds: Array.from({ length: 101 }, (_, i) => 'x' + i) })).s === 400);
    const b2 = await balance();
    ok('the refused call cost nothing', Math.abs(b2 - b1) < 1e-6);

    // reset one source: every per-product category goes, XML-category mappings stay unless asked
    const ovCount = async () => (await c.query(`select count(*)::int n from app."ProductCategoryOverride" where "connectionId"=$1`, [conn])).rows[0].n;
    const mapCount = async () => (await c.query(`select count(*)::int n from app."CategoryMapping" where "connectionId"=$1`, [conn])).rows[0].n;
    ok('another store cannot reset our connection (404)', (await callB('POST', `${P}/reset`, { xmlSourceId: src.id })).s === 404);
    ok('a source that is not the caller\'s is refused (404) and nothing is deleted', (await callB('POST', `/marketplace/connections/${bConn}/product-categories/reset`, { xmlSourceId: src.id })).s === 404 && (await ovCount()) >= 1);
    ok('a reset needs a source', (await call('POST', `${P}/reset`, {})).s === 400);
    const ovBefore = await ovCount(); const mapsBefore = await mapCount();
    const rs = await call('POST', `${P}/reset`, { xmlSourceId: src.id });
    ok('reset removes every per-product category of the source', rs.s === 200 && ovBefore >= 1 && rs.d.removedProducts === ovBefore && rs.d.removedMappings === 0 && (await ovCount()) === 0, JSON.stringify(rs.d));
    ok('the XML-category mapping is still there', (await mapCount()) === mapsBefore && mapsBefore >= 1);
    const afterReset = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d.products.find((p) => p.id === target.id);
    ok('the product is back on the XML-category mapping at once', afterReset.mapName === 'Genel > Kategori', afterReset.mapName);
    ok('the overview shows nothing assigned any more', (await call('GET', `${P}/overview?xmlSourceId=${src.id}`)).d.assigned === 0);
    await call('PUT', P, { assignments: ids.ids.map((id) => ({ productId: id, categoryId: kupa.id, source: 'rule' })) });

    // removing gives the product back to the mapping
    const del = await call('DELETE', P, { productIds: ids.ids });
    ok('removing the own categories works', del.s === 200 && del.d.removed >= 1, JSON.stringify(del.d));
    const back = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d.products.find((p) => p.id === target.id);
    ok('the product is back on the XML-category mapping', back.mapName === 'Genel > Kategori', back.mapName);
    await call('PUT', P, { assignments: [{ productId: target.id, categoryId: kupa.id, source: 'manual' }] });
    const rs2 = await call('POST', `${P}/reset`, { xmlSourceId: src.id, includeMappings: true });
    ok('reset with the mappings option also deletes the XML-category mappings of that source', rs2.s === 200 && rs2.d.removedProducts === 1 && rs2.d.removedMappings === mapsBefore && (await mapCount()) === 0 && (await ovCount()) === 0, JSON.stringify(rs2.d));
    const gone = (await call('GET', `/marketplace/connections/${conn}/product-list?limit=50&fresh=1`)).d.products.find((p) => p.id === target.id);
    ok('now the product has no category at all', gone.issues.some((i) => i.code === 'no_category_mapping'));
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    await c.query(`delete from app."SyncLog" where "storeId"=$1`, [storeId]).catch(() => {});
    for (const u of [A, B]) await c.query(`delete from app."User" where id=$1`, [u.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
