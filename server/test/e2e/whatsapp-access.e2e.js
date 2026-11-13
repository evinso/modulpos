// End-to-end checks for the WhatsApp area. See test/e2e/README.md for how to run.
//  * a normal user can neither set WhatsApp up nor read/change its settings (the page and the API are admin only)
//  * an admin gets a readable reason when WAHA is not reachable (instead of an empty QR box / a fake "sent")
// With the built-in connection (no WAHA configured) it also opens a real connection to WhatsApp up to the QR code and closes it again.
// Nothing here changes the real WhatsApp settings and no WhatsApp message is ever sent. Do not run it while somebody is linking the phone
// (the QR check uses the one shared connection), it skips that part when a phone is already linked.
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const stamp = Date.now();
  const register = async (tag) => {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-wa-${tag}-${stamp}@example.invalid`, password: 'Passw0rd!test', name: 'WA ' + tag }) });
    const j = await r.json();
    if (!j.user) throw new Error(`register failed (HTTP ${r.status}; the API allows 20 logins/registrations per 15 minutes): ${JSON.stringify(j).slice(0, 160)}`);
    return j;
  };
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
      ['GET', '/whatsapp/engine'], ['GET', '/whatsapp/connections'], ['POST', '/whatsapp/connections', { name: 'x', instanceId: 'default' }],
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
    const eng = (await asAdmin('GET', '/whatsapp/engine')).d || {};
    ok('admin: knows which connection method is in use', ['embedded', 'waha'].includes(eng.engine), `${eng.engine}, node ${eng.node}`);
    const st = (await asAdmin('GET', `/whatsapp/connections/${id}/status`)).d || {};
    ok('admin: status always has a state', typeof st.stateInstance === 'string', JSON.stringify(st).slice(0, 120));
    const stored = (await c.query(`select count(*)::int n from app."WhatsappAuthState" where key like 'default:%'`)).rows[0].n;

    if (eng.engine === 'embedded') {
      if (stored === 0) {
        ok('built-in, nothing linked: the status says how to link', st.stateInstance === 'notAuthorized' && /QR Kodu Göster/.test(st.message || ''), JSON.stringify(st).slice(0, 120));
        const sent = await asAdmin('POST', `/whatsapp/connections/${id}/send`, { phone: '905550000000', message: 'e2e' });
        ok('built-in, nothing linked: a test message is refused with a readable sentence (nothing is sent)', sent.s === 502 && /henüz bağlanmadı/.test((sent.d && sent.d.error) || ''), `${sent.s} ${sent.d && sent.d.error}`);
        let qr = {};
        for (let i = 0; i < 4 && qr.type !== 'qrCode'; i++) { qr = (await asAdmin('GET', `/whatsapp/connections/${id}/qr`)).d || {}; if (qr.type !== 'qrCode') await new Promise((r) => setTimeout(r, 3000)); }
        ok('built-in: a real connection to WhatsApp produces a QR code (PNG)', qr.type === 'qrCode' && Buffer.from(qr.message || '', 'base64').subarray(0, 4).toString('hex') === '89504e47', JSON.stringify(qr).slice(0, 100));
        const st2 = (await asAdmin('GET', `/whatsapp/connections/${id}/status`)).d || {};
        ok('built-in: while the QR is shown the state is "waiting for scan"', st2.stateInstance === 'notAuthorized' && st2.wahaStatus === 'SCAN_QR_CODE', JSON.stringify(st2));
        const out = await asAdmin('POST', `/whatsapp/connections/${id}/logout`);
        ok('built-in: closing the session works', out.s === 200, String(out.s));
        const left = (await c.query(`select count(*)::int n from app."WhatsappAuthState" where key like 'default:%'`)).rows[0].n;
        ok('built-in: nothing is left stored afterwards', left === 0, String(left));
        const st3 = (await asAdmin('GET', `/whatsapp/connections/${id}/status`)).d || {};
        ok('built-in: and the status is "not linked" again', st3.wahaStatus === 'NOT_LINKED', JSON.stringify(st3));
      } else console.log('SKIP  a phone is already linked on this deployment: the QR / send / logout checks were skipped (they would disturb it)');
    } else if (st.stateInstance === 'unreachable' || st.stateInstance === 'error') {
      const qr = (await asAdmin('GET', `/whatsapp/connections/${id}/qr`)).d || {};
      ok('WAHA unreachable: the status says why', !!st.message, st.message);
      ok('WAHA unreachable: the QR call says why instead of staying empty', qr.type === 'error' && !!qr.message, qr.message);
      const sent = await asAdmin('POST', `/whatsapp/connections/${id}/send`, { phone: '905550000000', message: 'e2e' });
      ok('WAHA unreachable: a test message fails with a readable 502 (not a bare 500)', sent.s === 502 && sent.d && sent.d.error, `${sent.s} ${sent.d && sent.d.error}`);
    } else console.log(`SKIP  WAHA answers on this deployment (status "${st.stateInstance}"): the wording checks were skipped (no message is sent either way)`);
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
