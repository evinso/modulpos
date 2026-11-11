// A feed whose first product has 2 images and later products have 5: the mapping screen must offer ALL image tags,
// and a sync with all of them mapped keeps every image of every product. See test/e2e/README.md.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-img-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Img' }) }).then((r) => r.json());
  const call = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d }; };
  const storeId = reg.user.stores[0].id;
  const sync = async (id) => { await call('POST', `/xml-sources/${id}/sync`); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = (await call('GET', `/xml-sources/${id}/sync-status`)).d; if (!s.running && s.last.status !== 'started') return s.last; } };
  try {
    const an = await call('POST', '/xml-sources/analyze', { url: base + 'feed-images-varied.xml' });
    const paths = (an.d.fields || []).map((f) => f.path);
    const imgPaths = paths.filter((p) => /RESIM/i.test(p));
    ok('analyze succeeds', an.d.success === true);
    ok('mapping list offers all 5 image tags although the first product has only 2', imgPaths.length === 5, imgPaths.join(','));
    ok('tags are listed in order, next to their siblings', imgPaths.join(',').toUpperCase() === 'RESIM1,RESIM2,RESIM3,RESIM4,RESIM5', imgPaths.join(','));
    const sugg = (an.d.suggestedMapping || {}).images || '';
    ok('auto mapping suggests all 5 image tags', sugg.split(',').length === 5, sugg);
    const sample4 = (an.d.fields || []).find((f) => /RESIM4$/i.test(f.path));
    ok('a tag missing from the first product gets a sample from a later one', sample4 && /b4\.jpg/.test(sample4.sample || ''), sample4 && sample4.sample);

    const mapping = { ...an.d.suggestedMapping, images: imgPaths.join(',') };
    const add = await call('POST', '/xml-sources', { name: 'img', url: base + 'feed-images-varied.xml', syncIntervalMin: 60, defaultVatRate: 20, mappingConfig: mapping });
    ok('source with the full image mapping is saved', add.s === 201 || add.s === 200, String(add.s));
    const last = await sync(add.d.id);
    ok('sync completed', last && last.status === 'completed', last && last.status);
    const rows = (await c.query(`select sku,images from app."Product" where "xmlSourceId"=$1 order by sku`, [add.d.id])).rows;
    const counts = Object.fromEntries(rows.map((r) => [r.sku, JSON.parse(r.images || '[]').length]));
    ok('product 1 keeps 2 images, product 2 keeps 5, product 3 keeps 3', counts['IMG-1'] === 2 && counts['IMG-2'] === 5 && counts['IMG-3'] === 3, JSON.stringify(counts));

    // a feed that gets NO image mapping from the user: the automatic fallback must still find all five
    const add2 = await call('POST', '/xml-sources', { name: 'img-auto', url: base + 'feed-images-varied.xml', syncIntervalMin: 60, defaultVatRate: 20 });
    await sync(add2.d.id);
    const rows2 = (await c.query(`select sku,images from app."Product" where "xmlSourceId"=$1 order by sku`, [add2.d.id])).rows;
    const counts2 = Object.fromEntries(rows2.map((r) => [r.sku, JSON.parse(r.images || '[]').length]));
    ok('without any mapping the sync still collects all 5 images', counts2['IMG-2'] === 5 && counts2['IMG-1'] === 2, JSON.stringify(counts2));
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    await c.query(`delete from app."SyncLog" where "storeId"=$1`, [storeId]).catch(() => {});
    await c.query(`delete from app."User" where id=$1`, [reg.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end();
  }
  console.log(fails ? `FAIL=${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
