// End-to-end checks for the bulk WhatsApp area (/api/whatsapp-bulk). See test/e2e/README.md for how to run.
//  * admin only (a normal user and an anonymous caller are refused everywhere)
//  * reading a list (CSV / pasted numbers), the checks on a campaign (pause range, daily limit, message fields, number limits)
//  * create / edit / add numbers / delete, paging and filtering of the numbers, isolation between two admins
// NO WhatsApp MESSAGE IS EVER SENT: no campaign is started (the start is only tried while no phone is linked, where it is refused).
const { Client } = require('pg');
const { registerFetch } = require('./_register');
const API = process.env.API_URL || 'https://api.modulpos.com/api';

(async () => {
  const c = new Client({ connectionString: process.env.E2E_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let fails = 0; const ok = (n, cnd, x) => { console.log((cnd ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!cnd) fails++; };
  const stamp = Date.now();
  const register = async (tag) => {
    const r = await registerFetch(API + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tmp-wb-${tag}-${stamp}@example.invalid`, password: 'Passw0rd!test', name: 'WB ' + tag }) });
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
  const B = '/whatsapp-bulk';
  const phone = (i) => `905${String(100000000 + i)}`;                  // 905 + 9 digits: a well-formed mobile number that nobody uses
  try {
    const normal = await register('user'); users.push(normal.user.id);
    const admin = await register('admin'); users.push(admin.user.id);
    const other = await register('other'); users.push(other.user.id);
    for (const u of [admin, other]) await c.query(`update app."User" set role='admin' where id=$1`, [u.user.id]);   // before the first authenticated call: no stale role is cached
    const asUser = caller(normal.token), asAdmin = caller(admin.token), asOther = caller(other.token), anon = caller(null);
    const fakeId = '00000000-0000-4000-8000-000000000000';

    // ── who may use it ──
    ok('anonymous: refused (401)', (await anon('GET', `${B}/overview`)).s === 401);
    const refused = [
      ['GET', `${B}/overview`], ['POST', `${B}/parse`, { text: '05321234567' }], ['GET', `${B}/campaigns`],
      ['POST', `${B}/campaigns`, { name: 'x', message: 'x', minDelaySec: 12, maxDelaySec: 20, dailyLimit: 0, recipients: [{ phone: phone(1) }] }],
      ['GET', `${B}/campaigns/${fakeId}`], ['PUT', `${B}/campaigns/${fakeId}`, { name: 'y' }], ['DELETE', `${B}/campaigns/${fakeId}`],
      ['POST', `${B}/campaigns/${fakeId}/start`], ['POST', `${B}/campaigns/${fakeId}/pause`], ['POST', `${B}/campaigns/${fakeId}/retry-failed`],
      ['POST', `${B}/campaigns/${fakeId}/recipients`, { recipients: [] }], ['GET', `${B}/campaigns/${fakeId}/recipients`],
    ];
    const bad = [];
    for (const [m, u, b] of refused) { const r = await asUser(m, u, b); if (r.s !== 403) bad.push(`${m} ${u} → ${r.s}`); }
    ok(`normal user: all ${refused.length} endpoints answer 403`, bad.length === 0, bad.join('; '));
    ok('normal user: nothing was stored', (await c.query(`select count(*)::int n from app."WhatsappCampaign" w join app."Store" s on s.id=w."storeId" where s."userId"=$1`, [normal.user.id])).rows[0].n === 0);

    // ── overview ──
    const ov = (await asAdmin('GET', `${B}/overview`)).d || {};
    ok('overview: connection state, limits and defaults', typeof (ov.connection && ov.connection.state) === 'string' && ov.limits && ov.limits.minDelayFloorSec === 5 && ov.limits.maxRecipients === 5000 && ov.defaults && ov.defaults.minDelaySec === 12 && typeof ov.sentToday === 'number', JSON.stringify(ov).slice(0, 220));

    // ── reading a list ──
    const csv = 'Ad;Telefon;Şehir\nAyşe Yılmaz;0533 111 22 33;İzmir\nVeli;0532 000 11 22;Ankara\nAli;05331112233;Van\nHatalı;12345;Bursa\nExcel;5,32E+11;Muğla\n';
    const parsed = await asAdmin('POST', `${B}/parse`, { text: csv });
    const pd = parsed.d || {};
    ok('parse: semicolon CSV with header: 2 good, 1 repeated, 2 refused', parsed.s === 200 && pd.valid === 2 && pd.duplicates === 1 && pd.invalid === 2 && pd.total === 5, JSON.stringify({ s: parsed.s, valid: pd.valid, dup: pd.duplicates, inv: pd.invalid }));
    ok('parse: columns, name and the clean number', pd.phoneColumn === 'Telefon' && pd.nameColumn === 'Ad' && pd.rows && pd.rows[0].phone === '905331112233' && pd.rows[0].vars.sehir === 'İzmir' && pd.columns.some((x) => x.key === 'sehir'));
    ok('parse: the Excel scientific number is explained', (pd.rows || []).some((r) => /Excel numarayı bozmuş/.test(r.reason || '')));
    const plain = (await asAdmin('POST', `${B}/parse`, { text: '0532 123 45 67\n+90 533 987 65 43\n' })).d || {};
    ok('parse: a plain list of numbers (no header)', plain.valid === 2 && plain.hasHeader === false && plain.rows[1].phone === '905339876543');
    const empty = await asAdmin('POST', `${B}/parse`, { text: '  ' });
    ok('parse: an empty list is refused with a sentence', empty.s === 400 && /Liste boş/.test((empty.d && empty.d.error) || ''));
    const xlsx = await asAdmin('POST', `${B}/parse`, { text: 'PK\u0003\u0004binary' });
    ok('parse: an Excel file is refused and CSV is explained', xlsx.s === 400 && /CSV/.test((xlsx.d && xlsx.d.error) || ''));
    const many = Array.from({ length: 5001 }, (_, i) => `90500${String(100000 + i).padStart(7, '0')}`).join('\n');
    const tooMany = await asAdmin('POST', `${B}/parse`, { text: many });
    ok('parse: more than 5000 numbers is refused', tooMany.s === 400 && /5000/.test((tooMany.d && tooMany.d.error) || ''), `${tooMany.s} ${tooMany.d && tooMany.d.error}`);

    // ── checks on a campaign ──
    const base = { name: 'e2e kampanya', message: 'Merhaba {ad}, {sehir} için fırsat!', minDelaySec: 12, maxDelaySec: 16, dailyLimit: 100,
      recipients: [
        { phone: '0500 010 00 01', name: 'Ayşe', vars: { sehir: 'İzmir' } },
        { phone: phone(2), name: 'Veli', vars: { sehir: 'Ankara' } },
        { phone: '+90 510 000 00 02', name: 'Veli (tekrar)', vars: { sehir: 'X' } },
        { phone: '12345' }, { phone: '' },
      ] };
    const refusal = async (label, patch, re) => {
      const r = await asAdmin('POST', `${B}/campaigns`, { ...base, ...patch });
      ok(`create: ${label} is refused (400)`, r.s === 400 && re.test((r.d && r.d.error) || ''), `${r.s} ${r.d && r.d.error}`);
    };
    await refusal('a missing name', { name: ' ' }, /ad verin/);
    await refusal('an empty message', { message: '  ' }, /Mesaj boş/);
    await refusal('a pause under 5 seconds', { minDelaySec: 2, maxDelaySec: 3 }, /en az 5/);
    await refusal('a maximum smaller than the minimum', { minDelaySec: 30, maxDelaySec: 20 }, /küçük olamaz/);
    await refusal('a pause over an hour', { maxDelaySec: 4000 }, /1 saat/);
    await refusal('a negative daily limit', { dailyLimit: -1 }, /Günlük sınır/);
    await refusal('a field the list does not have', { message: 'Merhaba {soyad}' }, /\{soyad\}/);
    await refusal('a list with no valid number', { recipients: [{ phone: '123' }, { phone: 'abc' }] }, /Geçerli numara yok/);
    await refusal('no list at all', { recipients: undefined }, /Alıcı listesi/);
    const huge = Array.from({ length: 5001 }, (_, i) => ({ phone: `90500${String(100000 + i).padStart(7, '0')}` }));
    await refusal('more than 5000 numbers', { message: 'x', recipients: huge }, /5000/);

    // ── create ──
    const made = await asAdmin('POST', `${B}/campaigns`, base);
    const camp = made.d || {};
    ok('create: saved as a DRAFT with the good numbers only (a repeated and two bad ones are left out)', made.s === 200 && camp.status === 'draft' && camp.counts.total === 2 && camp.counts.pending === 2 && camp.skipped.invalid === 2 && camp.skipped.duplicates === 1, JSON.stringify(made.d).slice(0, 200));
    ok('create: settings are kept', camp.minDelaySec === 12 && camp.maxDelaySec === 16 && camp.dailyLimit === 100 && camp.name === 'e2e kampanya');
    const id = camp.id;
    const rows = (await c.query(`select phone, name, vars, status from app."WhatsappCampaignRecipient" where "campaignId"=$1 order by position`, [id])).rows;
    ok('stored: numbers are normalised (905…) in the given order, all pending', rows.length === 2 && rows[0].phone === '905000100001' && rows[1].phone === phone(2) && rows.every((r) => r.status === 'pending'), JSON.stringify(rows.map((r) => r.phone)));
    ok('stored: other columns are kept for the message', JSON.parse(rows[0].vars).sehir === 'İzmir');

    // ── detail, preview, numbers ──
    const det = (await asAdmin('GET', `${B}/campaigns/${id}`)).d || {};
    ok('detail: the finished messages are previewed for the first people', det.preview && det.preview[0].text === 'Merhaba Ayşe, İzmir için fırsat!' && det.preview[1].text === 'Merhaba Veli, Ankara için fırsat!', JSON.stringify(det.preview).slice(0, 160));
    ok('detail: counts and today\'s total', det.counts.total === 2 && typeof det.sentToday === 'number');
    const list = (await asAdmin('GET', `${B}/campaigns`)).d || [];
    ok('list: the campaign is there with its counts', list.some((x) => x.id === id && x.counts.pending === 2));
    const rec = (await asAdmin('GET', `${B}/campaigns/${id}/recipients?limit=1&page=2`)).d || {};
    ok('numbers: paging', rec.total === 2 && rec.totalPages === 2 && rec.recipients.length === 1 && rec.recipients[0].phone === phone(2));
    const sentOnly = (await asAdmin('GET', `${B}/campaigns/${id}/recipients?status=sent`)).d || {};
    ok('numbers: filter by state (none sent)', sentOnly.total === 0);

    // ── edit ──
    const bad1 = await asAdmin('PUT', `${B}/campaigns/${id}`, { minDelaySec: 1 });
    ok('edit: the same checks apply (pause under 5 s refused)', bad1.s === 400 && /en az 5/.test((bad1.d && bad1.d.error) || ''));
    const bad2 = await asAdmin('PUT', `${B}/campaigns/${id}`, { message: 'Merhaba {soyad}' });
    ok('edit: a message field the list does not have is refused', bad2.s === 400 && /\{soyad\}/.test((bad2.d && bad2.d.error) || ''));
    const edited = await asAdmin('PUT', `${B}/campaigns/${id}`, { name: 'e2e kampanya 2', minDelaySec: 20, maxDelaySec: 45, dailyLimit: 0, message: 'Selam {ad}!' });
    ok('edit: a draft can be changed', edited.s === 200 && edited.d.name === 'e2e kampanya 2' && edited.d.minDelaySec === 20 && edited.d.maxDelaySec === 45 && edited.d.dailyLimit === 0 && edited.d.message === 'Selam {ad}!', JSON.stringify(edited.d).slice(0, 160));

    // ── adding numbers ──
    const add = await asAdmin('POST', `${B}/campaigns/${id}/recipients`, { recipients: [{ phone: phone(3), name: 'Fatma' }, { phone: phone(2) }, { phone: 'zzz' }] });
    ok('add: new numbers are appended, a number already in the list is not added twice', add.s === 200 && add.d.added === 1 && add.d.counts.total === 3, JSON.stringify(add.d).slice(0, 160));
    const addNone = await asAdmin('POST', `${B}/campaigns/${id}/recipients`, { recipients: [{ phone: phone(3) }] });
    ok('add: nothing new is a clear 400', addNone.s === 400 && /yeni numara yok/.test((addNone.d && addNone.d.error) || ''));
    const order = (await c.query(`select phone from app."WhatsappCampaignRecipient" where "campaignId"=$1 order by position`, [id])).rows.map((r) => r.phone);
    ok('add: the new number comes last', order.length === 3 && order[2] === phone(3));

    // ── states that need no WhatsApp ──
    const pauseIdle = await asAdmin('POST', `${B}/campaigns/${id}/pause`);
    ok('pause: a campaign that is not running says so (409)', pauseIdle.s === 409);
    const retry = await asAdmin('POST', `${B}/campaigns/${id}/retry-failed`);
    ok('retry: nothing failed, nothing re-queued', retry.s === 200 && retry.d.requeued === 0);

    // ── starting is only tried when no phone is linked: then it must be refused with the way out, and nothing is sent ──
    const linked = (await c.query(`select count(*)::int n from app."WhatsappAuthState"`)).rows[0].n;
    if (linked === 0) {
      const st = await asAdmin('POST', `${B}/campaigns/${id}/start`);
      ok('start: with no phone linked it is refused with a sentence (409), the campaign stays a draft', st.s === 409 && /bağlan|bağlı/i.test((st.d && st.d.error) || ''), `${st.s} ${st.d && st.d.error}`);
      ok('start: the campaign is still a draft', (await c.query(`select status from app."WhatsappCampaign" where id=$1`, [id])).rows[0].status === 'draft');
    } else console.log('SKIP  a phone is linked on this deployment: "start" is not called by the test (it would send real messages)');

    // ── isolation ──
    const probes = [
      ['GET', `${B}/campaigns/${id}`], ['GET', `${B}/campaigns/${id}/recipients`], ['PUT', `${B}/campaigns/${id}`, { name: 'hacked' }], ['DELETE', `${B}/campaigns/${id}`],
      ['POST', `${B}/campaigns/${id}/start`], ['POST', `${B}/campaigns/${id}/pause`], ['POST', `${B}/campaigns/${id}/retry-failed`], ['POST', `${B}/campaigns/${id}/recipients`, { recipients: [{ phone: phone(9) }] }],
    ];
    const leaked = [];
    for (const [m, u, b] of probes) { const r = await asOther(m, u, b); if (r.s !== 404) leaked.push(`${m} ${u.replace(id, ':id')} → ${r.s}`); }
    ok(`isolation: another admin gets 404 on all ${probes.length} routes of this campaign`, leaked.length === 0, leaked.join('; '));
    ok('isolation: another admin\'s list is empty', ((await asOther('GET', `${B}/campaigns`)).d || []).length === 0);
    ok('isolation: nothing of this campaign changed', (await c.query(`select name from app."WhatsappCampaign" where id=$1`, [id])).rows[0].name === 'e2e kampanya 2');

    // ── nothing was sent ──
    const states = (await c.query(`select status, count(*)::int n from app."WhatsappCampaignRecipient" where "campaignId"=$1 group by status`, [id])).rows;
    ok('no number was sent, claimed or failed', states.length === 1 && states[0].status === 'pending' && states[0].n === 3, JSON.stringify(states));

    // ── delete ──
    const del = await asAdmin('DELETE', `${B}/campaigns/${id}`);
    ok('delete: a draft can be deleted', del.s === 200 && del.d.success === true);
    ok('delete: it is gone, with its numbers', (await asAdmin('GET', `${B}/campaigns/${id}`)).s === 404 && (await c.query(`select count(*)::int n from app."WhatsappCampaignRecipient" where "campaignId"=$1`, [id])).rows[0].n === 0);
  } catch (e) { console.log('ERROR', e); fails++; } finally {
    for (const id of users) await c.query(`delete from app."User" where id=$1`, [id]).catch((e) => console.log('cleanup:', e.message));
    console.log('leftover temp users:', (await c.query(`select count(*)::int n from app."User" where email like 'tmp-%'`)).rows[0].n);
    console.log('leftover campaigns of temp users:', (await c.query(`select count(*)::int n from app."WhatsappCampaign" w left join app."Store" s on s.id=w."storeId" where s.id is null`)).rows[0].n);
    await c.end(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
  }
})();
