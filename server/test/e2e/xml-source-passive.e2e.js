// A passive XML source: nothing is pulled or updated (sync, preview, analysis), it can be switched back, only "active"/"paused" are accepted.
//   E2E_DB_URL=postgresql://...:5432/postgres  [API_URL=...]  node test/e2e/xml-source-passive.e2e.js
// The feed address is unreachable on purpose: a passive source must not even try to fetch it, and nothing here syncs an active one.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const reg = async (tag) => {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-pas-${tag}-${Date.now()}@example.invalid`, password: 'Passw0rd!test', name: 'Pas ' + tag }) });
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
    const src = (await c.query(`insert into app."XmlSource"(id,"storeId",name,url,status,"errorMessage","updatedAt") values(gen_random_uuid(),$1,'pasif deneme','https://example.invalid/never-fetched.xml','error','eski hata',now()) returning id`, [A.user.stores[0].id])).rows[0].id;
    const status = async () => (await c.query(`select status, "errorMessage" from app."XmlSource" where id=$1`, [src])).rows[0];
    const logs = async () => (await c.query(`select count(*)::int n from app."SyncLog" where "xmlSourceId"=$1`, [src])).rows[0].n;

    const bad = await a('PUT', `/xml-sources/${src}`, { status: 'error' });
    ok('only "active" and "paused" can be set from outside ("error" is for the program): 400', bad.s === 400 && /active/.test(bad.d.error) && (await status()).status === 'error', `${bad.s} ${bad.d && bad.d.error}`);
    const weird = await a('PUT', `/xml-sources/${src}`, { status: 'whatever' });
    ok('any other status is refused too (400)', weird.s === 400);

    const pause = await a('PUT', `/xml-sources/${src}`, { status: 'paused' });
    ok('"paused" (Pasif yap) is saved', pause.s === 200 && pause.d.status === 'paused' && (await status()).status === 'paused');
    ok('the list shows it as paused', ((await a('GET', '/xml-sources')).d || []).find((x) => x.id === src).status === 'paused');

    const before = await logs();
    const sync = await a('POST', `/xml-sources/${src}/sync`);
    ok('"Şimdi Çek" on a passive source is refused (409) and says why', sync.s === 409 && sync.d.paused === true && /pasif/.test(sync.d.error), `${sync.s} ${JSON.stringify(sync.d)}`);
    ok('no sync was even started (no log row written)', (await logs()) === before);
    const pre = await a('POST', `/xml-sources/${src}/preview`, { mappingConfig: {} });
    const ana = await a('POST', `/xml-sources/${src}/analyze`);
    const xp = await a('GET', `/xml-sources/${src}/xml-preview`);
    ok('preview, analysis and the XML preview of a passive source are refused too (409): the supplier is not contacted', pre.s === 409 && ana.s === 409 && xp.s === 409 && pre.d.paused && ana.d.paused && xp.d.paused, [pre.s, ana.s, xp.s].join('/'));
    ok('it stays paused after all those tries', (await status()).status === 'paused');

    const foreign = await b('PUT', `/xml-sources/${src}`, { status: 'active' });
    ok('another store cannot switch it (404)', foreign.s === 404 && (await status()).status === 'paused');

    const resume = await a('PUT', `/xml-sources/${src}`, { status: 'active' });
    ok('"active" (Aktif yap) switches it back and clears an old error text', resume.s === 200 && resume.d.status === 'active' && (await status()).status === 'active' && (await status()).errorMessage === null);
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
