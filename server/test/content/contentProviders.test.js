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
  assert.deepEqual((await PR.list()).map((p) => [p.key, p.configured]), [['openai', false], ['anthropic', false], ['gemini', false], ['apify', false], ['serper', false], ['searchconsole', false], ['telegram', false]]);
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

test('Apify test: sends the token in the header, reads the account and this month\'s usage, checks the actor still exists, and says in words what is wrong (token, actor gone, no credit)', opts, async () => {
  const { fakeApify } = require('./fakeApify'); const f = fakeApify({ volumes: {} });
  await assert.rejects(PR.save('apify', { secret: 'short' }), /beklenen biçimde değil/); await assert.rejects(PR.save('apify', { secret: 'has a space 0123456789' }), /boşluk içermemeli/);
  const saved = await PR.save('apify', { secret: 'apify_api_TokenValue0123456789' }); assert.equal(saved.configured, true); assert.ok(!JSON.stringify(saved).includes('TokenValue'));
  assert.equal(saved.extra.actor, undefined, 'nothing typed: the default actor is used'); assert.equal((await PR.save('apify', { extra: { actor: ' gaelasao/keyword-research-api ', batchSize: '20', monthlyKeywordCap: '600' } })).extra.batchSize, '20');
  await assert.rejects(PR.save('apify', { extra: { batchSize: '0' } }), /1 ile 1000 arasında bir tam sayı/); await assert.rejects(PR.save('apify', { extra: { monthlyKeywordCap: 'many' } }), /0 ile 100000 arasında bir tam sayı/);
  const r = await PR.test('apify', { fetchImpl: f.fetchImpl }); assert.equal(r.ok, true); assert.match(r.message, /hesap: owner, plan: FREE/); assert.match(r.message, /Bu ay kullanılan: \$1\.20 \/ \$5\.00/); assert.match(r.message, /gaelasao\/keyword-research-api/); assert.match(r.message, /Test ücretsizdir/);
  assert.deepEqual(f.calls.map((c) => [c.method, c.path]), [['GET', '/v2/users/me'], ['GET', '/v2/users/me/limits'], ['GET', '/v2/acts/gaelasao~keyword-research-api']], 'only free calls: no actor run, no keyword asked'); assert.ok(f.calls.every((c) => c.auth === 'Bearer apify_api_TokenValue0123456789'));
  f.state.actorGone = true; const gone = await PR.test('apify', { fetchImpl: f.fetchImpl }); assert.equal(gone.ok, false); assert.match(gone.message, /Belirteç doğru.*aktörü bulunamadı.*kaldırılmış ya da adı değişmiş/); f.state.actorGone = false;
  for (const [st, re] of [[401, /belirteci reddedildi \(401\)/], [429, /istek sınırı/]]) { f.state.fail = st; const x = await PR.test('apify', { fetchImpl: f.fetchImpl }); assert.equal(x.ok, false); assert.match(x.message, re); assert.ok(!x.message.includes('TokenValue')); }
  f.state.fail = 'timeout'; assert.match((await PR.test('apify', { fetchImpl: f.fetchImpl })).message, /cevap vermedi/); f.state.fail = 'network'; assert.match((await PR.test('apify', { fetchImpl: f.fetchImpl })).message, /ulaşılamadı/);
  assert.equal((await PR.get('apify')).lastTestOk, false); assert.match((await PR.get('apify')).help, /ÖNERİLEN ÜCRETSİZ BAŞLANGIÇ/); assert.equal((await PR.get('apify')).paid, false, 'no dollar budgets: the price is not known to us');
});

test('usage: unknown cost stays unknown ("Bilinmiyor"), known costs add up per day / month / provider', opts, async () => {
  await PR.recordUsage({ provider: 'openai', endpoint: '/v1/responses', operation: 'article', requests: 1, units: 1500, costUsd: 0.0123 });
  await PR.recordUsage({ provider: 'openai', operation: 'article', costUsd: null, units: null });
  await PR.recordUsage({ provider: 'serper', endpoint: '/v3/keywords', operation: 'volume', requests: 3, costUsd: 0.05 });
  await PR.recordUsage({ provider: 'serper', operation: 'volume', result: 'error', costUsd: 0 });
  assert.equal(await PR.recordUsage({ provider: 'openai', costUsd: -5 }), null, 'an impossible cost is not stored (and does not throw into the caller)');
  const rep = await PR.usageReport({ days: 7, now: new Date() });
  assert.ok(Math.abs(rep.today.costUsd - 0.0623) < 1e-9); assert.equal(rep.today.unknownCalls, 1); assert.equal(rep.today.requests, 6);
  assert.deepEqual(rep.providers.map((p) => [p.provider, p.errors]), [['openai', 0], ['serper', 1]]);
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
  assert.equal((await PR.guard('serper', 5, { now: NOON })).ok, true, 'another provider has its own budget');
  // yesterday's money does not count today, but counts for the month
  await H.db().query("INSERT INTO api_usage (provider, cost_micros, created_at) VALUES ('openai', 9150000, $1)", [new Date(NOON.getTime() - 20 * 3600000)]);   // 16:00 on the 20th
  assert.equal((await PR.guard('openai', 0.05, { now: NOON })).ok, true, 'daily budget: only today counts (0.85 of 1); month 9.95 + 0.05 = 10 still fits');
  const month = await PR.guard('openai', 0.1, { now: NOON });   // today 0.80 + 0.10 fits the day; month 9.95 + 0.10 does not fit 10
  assert.equal(month.ok, false); assert.match(month.message, /aylık bütçesi/);
  // platform budget over all providers
  await PR.save('openai', { dailyBudgetUsd: null, monthlyBudgetUsd: null });
  await S.set('budget', { dailyTotalUsd: 1, monthlyTotalUsd: null });
  await H.db().query("INSERT INTO api_usage (provider, cost_micros, created_at) VALUES ('serper', 150000, $1)", [at(-2)]);
  const plat = await PR.guard('serper', 0.1, { now: NOON });
  assert.equal(plat.ok, false); assert.match(plat.message, /Platform günlük bütçesi/);
  assert.equal((await PR.guard('serper', 0, { now: new Date('2026-11-22T09:00:00Z') })).ok, true, 'next day: fresh');
});

test('Gemini / OpenAI setup: a key with dots is accepted (Google changes its formats), spaces are not; the test lists the models this key can WRITE with and suggests one; the model name is stored the way the call needs it', opts, async () => {
  await assert.rejects(PR.save('gemini', { secret: 'AIza short' }), /boşluk içermemeli/); await assert.rejects(PR.save('gemini', { secret: 'short' }), /beklenen biçimde değil/);
  const saved = await PR.save('gemini', { secret: 'AQ.Ab8RN6Kexample_key-with.dots0123456789' }); assert.equal(saved.configured, true); assert.ok(!JSON.stringify(saved).includes('AQ.Ab8RN6K'));
  const list = { models: [
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent', 'countTokens'] }, { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3-flash-preview', displayName: 'Preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] }, { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }] };
  let url; let key; const t = await PR.test('gemini', { fetchImpl: async (u, o) => { url = u; key = o.headers['x-goog-api-key']; return { status: 200, ok: true, json: async () => list }; } });
  assert.equal(t.ok, true); assert.match(url, /pageSize=100/); assert.equal(key, 'AQ.Ab8RN6Kexample_key-with.dots0123456789', 'the key travels in the header, not in the address');
  assert.deepEqual(t.models.map((m) => m.id), ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview'], 'only models that can write text; embedding, image, speech and non-Gemini ones are left out');
  assert.equal(t.suggested, 'gemini-2.5-flash', 'a stable flash model, not a preview, not lite'); assert.match(t.message, /4 tanesi makale yazabilir/); assert.match(t.message, /bir MODEL seçmeniz gerekir/);
  assert.equal((await PR.get('gemini')).lastTestOk, true); assert.ok(!('models' in (await PR.get('gemini'))), 'the list is not stored: it is asked again');
  const llm = require('../../src/content/services/llm'); assert.deepEqual((await llm.available()).find((v) => v.key === 'gemini').ready, false, 'a key without a model cannot write');
  assert.equal((await PR.save('gemini', { extra: { model: ' models/gemini-2.5-flash ' } })).extra.model, 'gemini-2.5-flash'); assert.equal((await llm.available()).find((v) => v.key === 'gemini').ready, true);
  assert.match((await PR.test('gemini', { fetchImpl: async () => ({ status: 200, ok: true, json: async () => list }) })).message, /Seçili model: gemini-2\.5-flash/);
  for (const st of [400, 401, 403]) { const r = await PR.test('gemini', { fetchImpl: reply(st, { error: { message: 'API key not valid' } }) }); assert.equal(r.ok, false); assert.match(r.message, new RegExp(`reddedildi \\(${st}\\)`)); assert.ok(!('models' in r)); }
  assert.match((await PR.test('gemini', { fetchImpl: reply(429, {}) })).message, /429/);
  // OpenAI: the same idea, no suggestion (names change too fast to guess)
  await PR.save('openai', { secret: 'sk-openai-test-0123456789abcdef' });
  const o = await PR.test('openai', { fetchImpl: reply(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'o3' }, { id: 'dall-e-3' }, { id: 'gpt-4o-audio-preview' }, { id: 'tts-1' }, { id: 'gpt-4o-transcribe' }] }) });
  assert.deepEqual([o.ok, o.models.map((m) => m.id), o.suggested], [true, ['gpt-4o', 'gpt-4o-mini', 'o3'], null]); assert.match(o.message, /Makale için bir model seçin/);
  assert.equal((await PR.list()).some((p) => p.key === 'dataforseo'), false, 'DataForSEO is not a provider of the platform any more');
});
