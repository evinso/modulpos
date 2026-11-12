// The XML converter keeps the time of its last production ("Son güncelleme"): a conversion is noted, a pull of the signed proxy address
// updates it (product count, supplier date), the status route is free and answers only for the addresses sent. See test/e2e/README.md.
const crypto = require('crypto');
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';
const origin = API.replace(/\/api\/?$/, '');
const base = 'https://raw.githubusercontent.com/evinso/modulpos/main/server/test/fixtures/';
const hash = (u) => crypto.createHash('sha256').update(u).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-conv-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Conv' }) }).then((r) => r.json());
  const call = async (m, u, b) => { const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reg.token }, body: b ? JSON.stringify(b) : undefined }); let d; try { d = await r.json(); } catch { /* empty */ } return { s: r.status, d }; };
  // a different address on every run (the fixture ignores the query), so earlier runs never count
  const SRC = base + `feed-images-varied.xml?e2e=${Date.now()}`;
  const NEVER = base + `feed-english.xml?e2e-never=${Date.now()}`;
  try {
    await call('GET', '/credits/balance');
    await c.query(`update app."CreditBalance" set balance = 10 where "userId" = $1`, [reg.user.id]);
    const balance = async () => Number((await c.query(`select balance from app."CreditBalance" where "userId" = $1`, [reg.user.id])).rows[0].balance);

    const anon = await fetch(API + '/xml-converter/feeds/status', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ urls: [SRC] }) });
    ok('the status route needs a login', anon.status === 401, String(anon.status));

    const b0 = await balance();
    const before = await call('POST', '/xml-converter/feeds/status', { urls: [SRC, NEVER] });
    ok('an address nobody converted has no record (null), per address as sent', before.s === 200 && before.d.feeds[SRC] === null && before.d.feeds[NEVER] === null, JSON.stringify(before.d));
    ok('asking costs no credit', Math.abs((await balance()) - b0) < 1e-9);

    const pv = await call('POST', '/xml-converter/preview', { url: SRC });
    ok('"Dönüştür" works', pv.s === 200 && pv.d.success === true && pv.d.totalProducts === 3, JSON.stringify(pv.d).slice(0, 200));
    ok('it used the credit it always used', Math.abs((await balance()) - (b0 - 1)) < 1e-9, `${b0} -> ${await balance()}`);
    ok('the answer carries the status: converted just now, not pulled by anyone yet', !!pv.d.feed && !!pv.d.feed.convertedAt && pv.d.feed.servedAt === null && pv.d.feed.productCount === 3, JSON.stringify(pv.d.feed));
    ok('the conversion time is "now"', pv.d.feed && Math.abs(Date.now() - new Date(pv.d.feed.convertedAt).getTime()) < 120000);

    // the proxy address a XML source would use
    const px = await fetch(origin + pv.d.convertedUrl);
    const xml = await px.text();
    ok('the signed proxy still serves the converted XML', px.status === 200 && (xml.match(/<Urun>/g) || []).length === 3 && xml.trimEnd().endsWith('</Urunler>') && !xml.includes('XmlConverterError'), `${px.status} ${xml.length} bytes`);
    await sleep(2500);
    const after = await call('POST', '/xml-converter/feeds/status', { urls: [SRC] });
    const f = after.d.feeds[SRC];
    ok('after the pull "Son güncelleme" is set: when, ok, how many products', !!f && !!f.servedAt && f.servedOk === true && f.productCount === 3 && f.servedError === null, JSON.stringify(f));
    ok('and it is "now"', f && Math.abs(Date.now() - new Date(f.servedAt).getTime()) < 120000);
    ok('the conversion time is still there', f && !!f.convertedAt);
    ok('no internals leak (the address, the hash, ids)', !/urlHash|\bid\b|raw\.githubusercontent/.test(JSON.stringify(after.d)));
    ok('GitHub sends no Last-Modified, so the supplier date is empty rather than invented', f && (f.sourceModifiedAt === null || !Number.isNaN(Date.parse(f.sourceModifiedAt))), String(f && f.sourceModifiedAt));

    // a second pull moves the time forward
    const first = new Date(f.servedAt).getTime();
    await sleep(1200);
    await (await fetch(origin + pv.d.convertedUrl)).text(); await sleep(2500);
    const second = (await call('POST', '/xml-converter/feeds/status', { urls: [SRC] })).d.feeds[SRC];
    ok('every pull updates the time', new Date(second.servedAt).getTime() > first, `${f.servedAt} -> ${second.servedAt}`);

    // the same address typed without https:// is the same record
    const bare = await call('POST', '/xml-converter/feeds/status', { urls: [SRC.replace(/^https:\/\//, '')] });
    ok('an address typed without https:// finds the same record', Object.values(bare.d.feeds)[0] && Object.values(bare.d.feeds)[0].productCount === 3);

    // an address that was never converted stays empty
    const never = (await call('POST', '/xml-converter/feeds/status', { urls: [NEVER] })).d.feeds[NEVER];
    ok('other addresses are not touched', never === null);

    // unsigned requests are still refused and leave no record
    const bad = await fetch(origin + '/api/xml-converter/proxy?url=' + encodeURIComponent(NEVER));
    ok('an unsigned proxy request is still refused', bad.status === 403, String(bad.status));
    await sleep(800);
    ok('and it leaves no record', (await c.query(`select count(*)::int n from app."XmlConverterFeed" where "urlHash" = $1`, [hash(NEVER)])).rows[0].n === 0);

    // the download button counts as a production too
    const dl = await fetch(API + '/xml-converter/download?url=' + encodeURIComponent(SRC), { headers: { Authorization: 'Bearer ' + reg.token } });
    const dxml = await dl.text(); await sleep(2500);
    const afterDl = (await call('POST', '/xml-converter/feeds/status', { urls: [SRC] })).d.feeds[SRC];
    ok('the download still works and updates the time', dl.status === 200 && (dxml.match(/<Urun>/g) || []).length === 3 && new Date(afterDl.servedAt).getTime() > new Date(second.servedAt).getTime());
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    await c.query(`delete from app."XmlConverterFeed" where "urlHash" = any($1)`, [[hash(SRC), hash(NEVER)]]).catch((e) => console.log('cleanup feed:', e.message));
    await c.query(`delete from app."User" where id=$1`, [reg.user.id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end();
  }
  console.log(fails ? `FAIL=${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
