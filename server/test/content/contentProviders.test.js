const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const PR = require('../../src/content/services/providers');
const S = require('../../src/content/services/settings');

const opts = { skip: H.skip };
const KEY = 'sk-test-abcdefghijklmnop1234';
const NOON = new Date('2026-11-21T09:00:00Z');                              // 12:00 Istanbul

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('keys: stored encrypted, never returned, only the last 4 shown, empty secret keeps the old one', opts, async () => {
  assert.deepEqual((await PR.list()).map((p) => [p.key, p.configured]), [['openai', false], ['anthropic', false], ['gemini', false], ['dataforseo', false], ['serper', false], ['searchconsole', false], ['telegram', false]]);
  const saved = await PR.save('openai', { secret: KEY, extra: { model: 'gpt-x' }, dailyBudgetUsd: 5 });
  assert.equal(saved.configured, true); assert.equal(saved.secretLast4, '1234'); assert.equal(saved.dailyBudgetUsd, 5);
  assert.ok(!JSON.stringify(saved).includes(KEY) && !JSON.stringify(await PR.list()).includes('abcdefghij'));
  const raw = (await H.db().query("SELECT encrypted_secret, extra FROM api_providers WHERE key = 'openai'")).rows[0];
  assert.ok(raw.encrypted_secret.startsWith('enc:v1:') && !raw.encrypted_secret.includes('abcdefghij'));
  assert.equal(await PR.secretFor('openai'), KEY);
  const again = await PR.save('openai', { secret: '', monthlyBudgetUsd: 50 });
  assert.equal(again.secretLast4, '1234', 'empty secret = unchanged'); assert.equal(again.dailyBudgetUsd, 5, 'an untouched budget stays'); assert.equal(again.monthlyBudgetUsd, 50);
  assert.equal((await PR.save('openai', { dailyBudgetUsd: null })).dailyBudgetUsd, null, 'null removes a budget');
  await assert.rejects(PR.save('openai', { secret: 'not a key' }), /beklenen biçimde değil|boşluk/);
  await assert.rejects(PR.save('openai', { dailyBudgetUsd: -2 }), /0 ile 1.000.000/);
  await assert.rejects(PR.save('nope', {}), /Bilinmeyen sağlayıcı/);
  await assert.rejects(PR.save('telegram', { extra: { chatIds: '12, abc' } }), /yalnızca sayı/);
  const cleared = await PR.save('openai', { clearSecret: true });
  assert.equal(cleared.configured, false); assert.equal(await PR.secretFor('openai'), null);
});

test('connection tests: right sentences for 200 / 401 / 429 / errors / timeouts; the key never appears; result is remembered', opts, async () => {
  await assert.rejects(PR.test('openai'), /önce api anahtarı/i, 'no key saved: nothing is called');
  await PR.save('openai', { secret: KEY });
  let seen;
  const ok = await PR.test('openai', { fetchImpl: async (url, o) => { seen = { url, auth: o.headers.Authorization }; return { status: 200, ok: true, json: async () => ({ data: [1, 2, 3] }) }; } });
  assert.equal(ok.ok, true); assert.match(ok.message, /3 model/); assert.equal(seen.url, 'https://api.openai.com/v1/models'); assert.equal(seen.auth, `Bearer ${KEY}`);
  assert.equal((await PR.get('openai')).lastTestOk, true);
  assert.match((await PR.test('openai', { fetchImpl: reply(401, {}) })).message, /reddedildi/);
  assert.match((await PR.test('openai', { fetchImpl: reply(429, {}) })).message, /kota|sınırla/);
  assert.match((await PR.test('openai', { fetchImpl: reply(500, {}) })).message, /500/);
  const net = await PR.test('openai', { fetchImpl: async () => { throw new Error(`connect ECONNREFUSED while sending ${KEY}`); } });
  assert.equal(net.ok, false); assert.ok(!net.message.includes(KEY)); assert.match(net.message, /ulaşılamadı/);
  const slow = await PR.test('openai', { fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } });
  assert.match(slow.message, /12 saniye/);
  const g = await PR.get('openai'); assert.equal(g.lastTestOk, false); assert.ok(g.lastTestedAt);
  await PR.save('openai', { secret: 'sk-another-key-abcdefghijkl' });
  assert.equal((await PR.get('openai')).lastTestOk, null, 'a new key clears the old test result');
});

test('DataForSEO test: needs the login, sends Basic auth, reads the balance, reports API-level errors', opts, async () => {
  await PR.save('dataforseo', { secret: 'api-pass-123' });
  assert.match((await PR.test('dataforseo', { fetchImpl: reply(200, {}) })).message, /login/, 'login missing: no call');
  await PR.save('dataforseo', { extra: { login: 'me@example.com' } });
  let auth;
  const body = { status_code: 20000, tasks: [{ result: [{ money: { balance: 12.345 } }] }] };
  const r = await PR.test('dataforseo', { fetchImpl: async (u, o) => { auth = o.headers.Authorization; return { status: 200, ok: true, json: async () => body }; } });
  assert.equal(r.ok, true); assert.equal(r.balanceUsd, 12.345); assert.match(r.message, /\$12\.35/);
  assert.equal(Buffer.from(auth.replace('Basic ', ''), 'base64').toString(), 'me@example.com:api-pass-123');
  assert.equal((await PR.test('dataforseo', { fetchImpl: reply(401, {}) })).ok, false);
  const apiErr = await PR.test('dataforseo', { fetchImpl: reply(200, { status_code: 40100, status_message: 'Authentication failed' }) });
  assert.equal(apiErr.ok, false); assert.match(apiErr.message, /Authentication failed/);
});

test('DataForSEO test on an UNVERIFIED account (seen for real): credentials and balance are fine, but every other endpoint says 40104 - the test must say so, not "ok"', opts, async () => {
  await PR.save('dataforseo', { secret: 'api-pass-123', extra: { login: 'me' } });
  const userData = { status_code: 20000, tasks: [{ result: [{ money: { total: 1, balance: 1 } }] }] };
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return url.includes('user_data') ? { status: 200, ok: true, json: async () => userData } : { status: 403, ok: false, json: async () => ({ status_code: 40104, status_message: 'Please verify your account' }) }; };
  const r = await PR.test('dataforseo', { fetchImpl });
  assert.equal(r.ok, false); assert.equal(r.balanceUsd, 1); assert.match(r.message, /Kimlik bilgileri doğru ama.*henüz doğrulanmamış.*Bakiye: \$1\.00/); assert.equal(calls.length, 2, 'only the two FREE calls were made');
  assert.equal((await PR.get('dataforseo')).lastTestOk, false);
  const ok = await PR.test('dataforseo', { fetchImpl: async (url) => ({ status: 200, ok: true, json: async () => (url.includes('user_data') ? userData : { status_code: 20000, tasks: [{ status_code: 20000 }] }) }) });
  assert.deepEqual([ok.ok, ok.balanceUsd], [true, 1]); assert.match(ok.message, /hesap doğrulanmış/);
});

test('Telegram test: getMe with the token', opts, async () => {
  await PR.save('telegram', { secret: '123456789:AAEhBP0av28ABCDEFGHIJKLMNOPQRSTU', extra: { chatIds: '111222333, -100999888' } });
  assert.equal((await PR.get('telegram')).extra.chatIds, '111222333,-100999888');
  let url;
  const r = await PR.test('telegram', { fetchImpl: async (u) => { url = u; return { status: 200, ok: true, json: async () => ({ ok: true, result: { username: 'my_bot' } }) }; } });
  assert.match(r.message, /@my_bot/); assert.ok(url.endsWith('/getMe'));
  assert.equal((await PR.test('telegram', { fetchImpl: reply(401, {}) })).ok, false);
});

test('usage: unknown cost stays unknown ("Bilinmiyor"), known costs add up per day / month / provider', opts, async () => {
  await PR.recordUsage({ provider: 'openai', endpoint: '/v1/responses', operation: 'article', requests: 1, units: 1500, costUsd: 0.0123 });
  await PR.recordUsage({ provider: 'openai', operation: 'article', costUsd: null, units: null });
  await PR.recordUsage({ provider: 'dataforseo', endpoint: '/v3/keywords', operation: 'volume', requests: 3, costUsd: 0.05 });
  await PR.recordUsage({ provider: 'dataforseo', operation: 'volume', result: 'error', costUsd: 0 });
  assert.equal(await PR.recordUsage({ provider: 'openai', costUsd: -5 }), null, 'an impossible cost is not stored (and does not throw into the caller)');
  const rep = await PR.usageReport({ days: 7, now: new Date() });
  assert.ok(Math.abs(rep.today.costUsd - 0.0623) < 1e-9); assert.equal(rep.today.unknownCalls, 1); assert.equal(rep.today.requests, 6);
  assert.deepEqual(rep.providers.map((p) => [p.provider, p.errors]), [['dataforseo', 1], ['openai', 0]]);
  const unknown = rep.recent.find((x) => x.provider === 'openai' && x.costUsd === null);
  assert.equal(unknown.costText, 'Bilinmiyor'); assert.equal(rep.recent.find((x) => x.costUsd === 0.0123).costText, '$0.0123');
  assert.equal(rep.daily.reduce((a, d) => a + d.costUsd, 0).toFixed(4), '0.0623');
  const onlyOpenAi = await PR.usageReport({ provider: 'openai', limit: 10 });
  assert.ok(onlyOpenAi.recent.every((x) => x.provider === 'openai'));
});

test('budget guard: provider and platform, daily and monthly; a refusal is logged and stops before the call', opts, async () => {
  assert.deepEqual(await PR.guard('openai', 1, { now: NOON }), { ok: true }, 'no budget set: allowed');
  await PR.save('openai', { secret: KEY, dailyBudgetUsd: 1, monthlyBudgetUsd: 10 });
  const at = (h) => new Date(NOON.getTime() + h * 3600000);
  await H.db().query("INSERT INTO api_usage (provider, cost_micros, created_at) VALUES ('openai', 800000, $1)", [at(-1)]);        // $0.80 today
  assert.equal((await PR.guard('openai', 0.1, { now: NOON })).ok, true);
  const no = await PR.guard('openai', 0.3, { now: NOON, operation: 'article' });
  assert.equal(no.ok, false); assert.equal(no.reason, 'budget'); assert.match(no.message, /OpenAI günlük bütçesi doldu/);
  assert.equal((await H.db().query("SELECT count(*)::int n FROM api_usage WHERE result = 'blocked_budget'")).rows[0].n, 1, 'the refusal itself is recorded');
  assert.equal((await PR.guard('dataforseo', 5, { now: NOON })).ok, true, 'another provider has its own budget');
  // yesterday's money does not count today, but counts for the month
  await H.db().query("INSERT INTO api_usage (provider, cost_micros, created_at) VALUES ('openai', 9150000, $1)", [new Date(NOON.getTime() - 20 * 3600000)]);   // 16:00 on the 20th
  assert.equal((await PR.guard('openai', 0.05, { now: NOON })).ok, true, 'daily budget: only today counts (0.85 of 1); month 9.95 + 0.05 = 10 still fits');
  const month = await PR.guard('openai', 0.1, { now: NOON });   // today 0.80 + 0.10 fits the day; month 9.95 + 0.10 does not fit 10
  assert.equal(month.ok, false); assert.match(month.message, /aylık bütçesi/);
  // platform budget over all providers
  await PR.save('openai', { dailyBudgetUsd: null, monthlyBudgetUsd: null });
  await S.set('budget', { dailyTotalUsd: 1, monthlyTotalUsd: null });
  await H.db().query("INSERT INTO api_usage (provider, cost_micros, created_at) VALUES ('dataforseo', 150000, $1)", [at(-2)]);
  const plat = await PR.guard('dataforseo', 0.1, { now: NOON });
  assert.equal(plat.ok, false); assert.match(plat.message, /Platform günlük bütçesi/);
  assert.equal((await PR.guard('dataforseo', 0, { now: new Date('2026-11-22T09:00:00Z') })).ok, true, 'next day: fresh');
});
