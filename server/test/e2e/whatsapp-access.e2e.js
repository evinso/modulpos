// End-to-end checks for the WhatsApp area. See test/e2e/README.md for how to run.
//  * a normal user can neither set WhatsApp up nor read/change its settings (the page and the API are admin only)
//  * an admin gets a readable reason when WAHA is not reachable (instead of an empty QR box / a fake "sent")
// Nothing here changes the real WhatsApp settings and no WhatsApp message is ever sent.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const stamp = Date.now();
  const register = (tag) => registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-wa-${tag}-${stamp}@example.invalid`, password: 'Passw0rd!test', name: 'WA ' + tag }) }).then((r) => r.json());
  const caller = (token) => async (m, u, b) => {
    const r = await fetch(API + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined });
    let d; try { d = await r.json(); } catch { /* empty */ }
    return { s: r.status, d };
  };
  const users = [];
  try {
    const normal = await register('user'); users.push(normal.user.id);
    const admin = await register('admin'); users.push(admin.user.id);
    await c.query(`update app."User" set role='admin' where id=$1`, [admin.user.id]);   // before its first authenticated call, so no stale role is cached
    const asUser = caller(normal.token), asAdmin = caller(admin.token), anon = caller(null);
    const realPhone = (await c.query(`select value from app."SystemSettings" where key='waha_admin_phone'`)).rows[0];
    const realEnabled = (await c.query(`select value from app."SystemSettings" where key='waha_enabled'`)).rows[0];
    const fakeId = '00000000-0000-4000-8000-000000000000';

    // ── not logged in ──
    ok('anonymous: connections list is refused (401)', (await anon('GET', '/whatsapp/connections')).s === 401);

    // ── a normal user ──
    const refused = [
      ['GET', '/whatsapp/connections'], ['POST', '/whatsapp/connections', { name: 'x', instanceId: 'default' }],
      ['PUT', `/whatsapp/connections/${fakeId}`, { name: 'y' }], ['DELETE', `/whatsapp/connections/${fakeId}`],
      ['GET', `/whatsapp/connections/${fakeId}/status`], ['GET', `/whatsapp/connections/${fakeId}/qr`],
      ['POST', `/whatsapp/connections/${fakeId}/send`, { phone: '905550000000', message: 'x' }],
      ['POST', `/whatsapp/connections/${fakeId}/logout`], ['POST', `/whatsapp/connections/${fakeId}/reboot`],
      ['GET', '/admin/system-settings?keys=waha_admin_phone,waha_enabled'], ['POST', '/admin/system-settings', { e2e_probe_key: 'x' }],
      ['POST', '/admin/whatsapp-test'], ['GET', '/admin/whatsapp-broadcast-recipients'], ['POST', '/admin/whatsapp-broadcast', { message: '' }],
    ];
    const bad = [];
    for (const [m, u, b] of refused) { const r = await asUser(m, u, b); if (r.s !== 403) bad.push(`${m} ${u.split('?')[0]} → ${r.s}`); }
    ok(`normal user: all ${refused.length} WhatsApp / settings endpoints answer 403`, bad.length === 0, bad.join('; '));
    const probe = (await c.query(`select count(*)::int n from app."SystemSettings" where key='e2e_probe_key'`)).rows[0].n;
    ok('normal user: a settings write attempt stored nothing', probe === 0);
    const owned = (await c.query(`select count(*)::int n from app."WhatsappConnection" w join app."Store" s on s.id=w."storeId" where s."userId"=$1`, [normal.user.id])).rows[0].n;
    ok('normal user: no WhatsApp connection exists for the account', owned === 0);

    // ── an admin: reasons instead of silence ──
    const made = await asAdmin('POST', '/whatsapp/connections', { name: 'e2e', instanceId: 'default' });
    ok('admin: can add a connection', made.s === 200 && made.d && made.d.id, JSON.stringify(made.d).slice(0, 80));
    const id = made.d && made.d.id;
    const st = (await asAdmin('GET', `/whatsapp/connections/${id}/status`)).d || {};
    ok('admin: status always has a state', typeof st.stateInstance === 'string', JSON.stringify(st).slice(0, 120));
    const qr = (await asAdmin('GET', `/whatsapp/connections/${id}/qr`)).d || {};
    ok('admin: the QR call answers with a known type', ['qrCode', 'alreadyLogged', 'loading', 'error'].includes(qr.type), JSON.stringify(qr).slice(0, 80));
    if (st.stateInstance === 'unreachable' || st.stateInstance === 'error') {
      ok('WAHA unreachable: the status says why', !!st.message, st.message);
      ok('WAHA unreachable: the QR call says why instead of staying empty', qr.type === 'error' && !!qr.message, qr.message);
      const sent = await asAdmin('POST', `/whatsapp/connections/${id}/send`, { phone: '905550000000', message: 'e2e' });
      ok('WAHA unreachable: a test message fails with a readable 502 (not a bare 500)', sent.s === 502 && sent.d && sent.d.error, `${sent.s} ${sent.d && sent.d.error}`);
    } else console.log(`SKIP  the status is "${st.stateInstance}", not unreachable: the "WAHA unreachable" wording checks were skipped (no message is sent either way)`);
    if ((realEnabled && realEnabled.value) !== 'true') {
      const t = await asAdmin('POST', '/admin/whatsapp-test');
      ok('"Test Gönder" with notifications off says so instead of pretending (400)', t.s === 400 && /kapalı/.test((t.d && t.d.error) || ''), `${t.s} ${t.d && t.d.error}`);
    } else console.log('SKIP  notifications are ON for real: "Test Gönder" is not called by the test (it would message the owner)');

    // the real settings were not touched
    const after = (await c.query(`select value from app."SystemSettings" where key='waha_admin_phone'`)).rows[0];
    ok('the real WhatsApp settings are unchanged', (after && after.value) === (realPhone && realPhone.value));
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    await c.query(`delete from app."SystemSettings" where key='e2e_probe_key'`).catch(() => {});
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
