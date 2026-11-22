const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { fakeTelegram, update, TOKEN } = require('./fakeTelegram');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const PR = require('../../src/content/services/providers');
const TG = require('../../src/content/services/telegram');
const NT = require('../../src/content/services/notifications');
const S = require('../../src/content/services/settings');
const BOTS = require('../../src/content/services/bots');
const OPP = require('../../src/content/services/opportunities');
const WR = require('../../src/content/services/writer');
const CK = require('../../src/content/services/checks');

/**
 * Phase 7a, Telegram: the connection, who may command, what each command answers, the safety of the state-changing ones, the webhook secret, and the notifications that reach the
 * chat (only the wanted kinds, never flooding, never breaking the work that raised them). Telegram is a fake in the Bot API's documented shapes.
 */
const opts = { skip: H.skip };
const OWNER = '1001'; const GROUP = '-2002'; const STRANGER = '7777';
let tg;
test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); tg = fakeTelegram(); TG.useFetch(tg.fetchImpl); TG.resetCounters(); } });
test.afterEach(() => { TG.useFetch(null); });
test.after(async () => { if (!H.skip) await H.close(); });

const setup = async ({ chats = `${OWNER},${GROUP}` } = {}) => { const { projectId } = await P.seedDefault(); await PR.save('telegram', { secret: TOKEN, extra: { chatIds: chats } }); return projectId; };
const say = async (chat, text, o = {}) => { const before = tg.sent().length; const r = await TG.handleUpdate(update(++say.n, chat, text, o), { now: o.now }); return { r, replies: tg.sent().slice(before) }; };
say.n = 0;
let aseq = 0;
const art = async (pid, status, o = {}) => { aseq++; const cats = await P.listCategories(pid); const a = await A.create({ projectId: pid, h1: `Article ${aseq} about routers`, seoTitle: 'x', metaDescription: 'm'.repeat(100), focusKeyword: `focus ${aseq} phrase`, categoryId: cats[0].id, contentHtml: `<h2>x</h2><p>${'word '.repeat(300)}</p>`, articleType: 'evergreen_guide' }); await H.db().query('UPDATE articles SET status = $2, quality_score = $3, adsense_risk = $4 WHERE id = $1', [a.id, status, o.quality === undefined ? 90 : o.quality, o.risk || 'low']); return a; };

test('the connection: the token and chat ids are validated and never come back; the test says which bot answered and warns when no chat is authorized; a wrong token is refused', opts, async () => {
  await P.seedDefault();
  await assert.rejects(PR.save('telegram', { secret: 'not a token' }), /beklenen biçimde değil|boşluk/); await assert.rejects(PR.save('telegram', { secret: TOKEN, extra: { chatIds: 'abc' } }), /yalnızca sayı/);
  const saved = await PR.save('telegram', { secret: TOKEN, extra: { chatIds: ' 1001 , -2002 ' } }); assert.equal(saved.extra.chatIds, '1001,-2002'); assert.ok(!JSON.stringify(saved).includes(TOKEN) && saved.secretLast4 === TOKEN.slice(-4));
  const t = await PR.test('telegram', { fetchImpl: tg.fetchImpl }); assert.equal(t.ok, true); assert.match(t.message, /@modulpos_test_bot.*2 yetkili sohbet/);
  assert.deepEqual((await TG.status()).bot.username, 'modulpos_test_bot'); assert.ok(!JSON.stringify(await TG.status()).includes(TOKEN));
  await PR.save('telegram', { extra: { chatIds: '' } }); assert.match((await PR.test('telegram', { fetchImpl: tg.fetchImpl })).message, /bota \/start yazın/);
  await PR.save('telegram', { secret: '987654321:AAWrongTokenWrongTokenWrongToken' }); const bad = await PR.test('telegram', { fetchImpl: tg.fetchImpl }); assert.equal(bad.ok, false); assert.match(bad.message, /belirteci \(token\) reddedildi/); assert.ok(!bad.message.includes('987654321'));
  tg.st.down = true; await PR.save('telegram', { secret: TOKEN }); const down = await PR.test('telegram', { fetchImpl: tg.fetchImpl }); assert.equal(down.ok, false); assert.match(down.message, /ulaşılamadı/);
});

test('who may command: only the listed chats; a stranger gets nothing except /start and /id (which only say THEIR number); duplicates, bots and plain text are ignored', opts, async () => {
  await setup();
  let x = await say(STRANGER, '/status'); assert.deepEqual([x.r.ignored, x.replies.length], ['unauthorized', 0], 'a stranger asking for the status gets no answer');
  assert.ok((await H.db().query("SELECT 1 FROM system_logs WHERE source = 'telegram'")).rows.length === 1, 'but it is written to the log');
  x = await say(STRANGER, '/start'); assert.equal(x.replies.length, 1); assert.match(x.replies[0].text, /kimliği: 7777/); assert.ok(!/makale|bot(lar)?\b.*çalışıyor|\$/.test(x.replies[0].text.replace('Bu bot yalnızca yetkili', '')), 'nothing about the system');
  x = await say(STRANGER, '/id'); assert.match(x.replies[0].text, /7777/);
  x = await say(OWNER, '/start'); assert.match(x.replies[0].text, /bağlısınız/); assert.match(x.replies[0].text, /Botlar: çalışıyor/);
  x = await say(OWNER, 'hello there'); assert.deepEqual([x.r.ignored, x.replies.length], ['not_a_command', 0]);
  x = await say(OWNER, '/status', { bot: true }); assert.equal(x.r.ignored, 'not_a_text_message');
  const dup = update(5000, OWNER, '/help'); await TG.handleUpdate(dup); const n = tg.sent().length; const again = await TG.handleUpdate(dup); assert.deepEqual([again.ignored, tg.sent().length], ['duplicate', n], 'Telegram retried: handled once');
  assert.equal((await TG.handleUpdate({ update_id: 'x' })).ignored, 'bad_update'); assert.equal((await TG.handleUpdate({ update_id: 6000, edited_message: {} })).ignored, 'not_a_text_message');
  x = await say(GROUP, '/help@modulpos_test_bot'); assert.match(x.replies[0].text, /\/status/, 'a group in the list may command, "@botname" is accepted'); assert.equal(x.replies[0].chat, GROUP);
  x = await say(OWNER, '/nonsense'); assert.match(x.replies[0].text, /tanımıyorum/);
  await PR.save('telegram', { clearSecret: true }); assert.equal((await TG.handleUpdate(update(7000, OWNER, '/status'))).ignored, 'not_configured', 'without a token nothing is handled');
});

test('the read commands answer from the real data and say what they could not measure', opts, async () => {
  const pid = await setup(); const a1 = await art(pid, 'ready', { quality: 91 }); await art(pid, 'needs_review', { quality: null, risk: 'review' }); await art(pid, 'published'); await art(pid, 'needs_update');
  await H.db().query("UPDATE articles SET adsense_risk = NULL WHERE id = $1", [a1.id]);
  let x = await say(OWNER, '/status'); const s = x.replies[0].text;
  assert.match(s, /Botlar: çalışıyor/); assert.match(s, /1 hazır · 1 onay\/kontrol bekleyen · 1 yayında · 1 güncelleme bekleyen/); assert.match(s, /Bugünkü limitler: .*yeni makale 0\//i); assert.match(s, /API bugün: \$0\.00/); assert.match(s, /Okunmamış bildirim: \d+/);
  x = await say(OWNER, '/articles'); assert.match(x.replies[0].text, /Article 1.*yayına hazır, kalite 91, AdSense ölçülmedi/); assert.match(x.replies[0].text, /onay bekliyor, kalite ölçülmedi, AdSense review/); assert.ok(!/published|Article 3/.test(x.replies[0].text));
  x = await say(OWNER, '/trends'); assert.match(x.replies[0].text, /nişe uygun gündem yok/);
  x = await say(OWNER, '/updates'); assert.match(x.replies[0].text, /Güncelleme bekleyen \(kanıtlı\) makale: 1/); assert.match(x.replies[0].text, /Onay bekleyen taslak: 0/);
  x = await say(OWNER, '/adsense'); assert.match(x.replies[0].text, /0 yayınlanamaz, 1 inceleme gerekli/); assert.match(x.replies[0].text, /Site denetimi henüz yapılmadı/); assert.match(x.replies[0].text, /resmî bir Google puanı değildir/);
  await PR.recordUsage({ provider: 'anthropic', operation: 'x', requests: 1, costUsd: 0.5, result: 'ok' }); await PR.recordUsage({ provider: 'openai', operation: 'y', requests: 2, costUsd: null, result: 'ok' }); await PR.save('anthropic', { dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
  x = await say(OWNER, '/cost'); const c = x.replies[0].text; assert.match(c, /Bugün: \$0\.50 \(\+1 çağrının maliyeti bilinmiyor\)/); assert.match(c, /anthropic: \$0\.50/); assert.match(c, /openai: \$0\.00 \(2 istek, 1 tanesinin maliyeti bilinmiyor\)/); assert.match(c, /Anthropic.*günlük \$5\.00 \/ aylık \$50\.00/);
  x = await say(OWNER, '/help'); for (const k of ['status', 'trends', 'articles', 'generate', 'updates', 'adsense', 'cost', 'pause', 'resume']) assert.ok(x.replies[0].text.includes(`/${k}`), k);
});

test('the commands that change something: /pause and /resume work and are audited with the chat; an old command is refused; /generate only shows the idea until "onay", then starts the writer once', opts, async () => {
  const pid = await setup(); void pid;
  let x = await say(OWNER, '/pause'); assert.match(x.replies[0].text, /duraklatıldı/); assert.equal((await BOTS.list()).paused, true); assert.equal((await S.get('bots')).value.pausedBy, `telegram:${OWNER}`);
  assert.ok((await H.db().query("SELECT 1 FROM audit_logs WHERE action = 'bots.pause' AND user_email = $1", [`telegram:${OWNER}`])).rows.length === 1);
  x = await say(OWNER, '/status'); assert.match(x.replies[0].text, /DURAKLATILDI \(telegram:1001\)/);
  x = await say(OWNER, '/resume'); assert.match(x.replies[0].text, /devam ediyor/); assert.equal((await BOTS.list()).paused, false);
  const old = await say(OWNER, '/pause', { date: Date.now() - 11 * 60000 }); assert.equal(old.r.stale, true); assert.match(old.replies[0].text, /10 dakikadan eski/); assert.equal((await BOTS.list()).paused, false, 'a command that waited while the API slept does not run');
  const read = await say(OWNER, '/status', { date: Date.now() - 3 * 3600000 }); assert.match(read.replies[0].text, /📊/, 'a read-only command is fine whenever it arrives');
  // /generate: no idea, then one idea (stubbed selection) shown, then "onay"
  assert.match((await say(OWNER, '/generate')).replies[0].text, /uygun fikir yok/);
  const origSel = OPP.selectForGeneration; const origStart = WR.start; const started = [];
  OPP.selectForGeneration = async () => ({ picks: [{ id: '11111111-1111-1111-1111-111111111111', keyword: 'best wifi 7 router', categoryName: 'Gadgets', why: 'Puan 82; “Gadgets” hedef payın 6 puan altında' }] });
  WR.start = async (id, o) => { started.push([id, o.manual, o.background, o.userId]); return { run: { id: 'r1' } }; };
  try {
    x = await say(OWNER, '/generate'); assert.match(x.replies[0].text, /best wifi 7 router.*Gadgets/s); assert.match(x.replies[0].text, /\/generate onay/); assert.match(x.replies[0].text, /kredisi harcar/); assert.equal(started.length, 0, 'showing is not starting');
    x = await say(OWNER, '/generate evet'); assert.equal(started.length, 0, 'only the word "onay" starts it');
    x = await say(OWNER, '/generate onay'); assert.deepEqual(started, [['11111111-1111-1111-1111-111111111111', true, true, null]]); assert.match(x.replies[0].text, /yazımı başladı/); assert.match(x.replies[0].text, /onayınızı bekler/);
    assert.ok((await H.db().query("SELECT 1 FROM audit_logs WHERE action = 'article.generate' AND user_email = $1", [`telegram:${OWNER}`])).rows.length === 1);
    WR.start = async () => { throw Object.assign(new Error('Bugünkü yeni makale limiti doldu'), { status: 409, name: 'HttpError' }); };
    const { HttpError } = require('../../src/content/lib/http'); WR.start = async () => { throw new HttpError(409, 'Günlük limit doldu (1/1)'); };
    x = await say(OWNER, '/generate onay'); assert.match(x.replies[0].text, /⚠️ Günlük limit doldu/, 'a refusal is told in words, not as a crash');
  } finally { OPP.selectForGeneration = origSel; WR.start = origStart; }
});

test('notifications reach Telegram: only wanted kinds, switched-off kinds stay quiet, a repeat and a flood are held back, a failing Telegram never breaks the work, the token is never in a stored text', opts, async () => {
  await setup(); const send = async (n) => { await NT.create(n); await NT.flush(); };
  await send({ type: 'publish_failed', severity: 'warning', title: 'WordPress yayını başarısız oldu', body: '“A” → Blog: 403' });
  assert.deepEqual(tg.sent().map((m) => m.chat).sort(), ['-2002', '1001'], 'every authorized chat'); assert.match(tg.sent()[0].text, /⚠️ WordPress yayını başarısız oldu\n“A” → Blog: 403\n\nModulPOS Content/);
  await send({ type: 'publish_failed', severity: 'warning', title: 'WordPress yayını başarısız oldu', body: 'again' }); assert.equal(tg.sent().length, 2, 'the same message within 10 minutes is not sent again');
  await send({ type: 'update_proposed', severity: 'info', title: 'Küçük güncelleme taslağı hazır' }); assert.equal(tg.sent().length, 2, 'an unlisted info type stays in the panel');
  await send({ type: 'something_new', severity: 'critical', title: 'A critical thing' }); assert.equal(tg.sent().length, 4, 'but anything critical goes');
  await S.set('telegram', { notify: { newArticle: false, critical: true, budget: true, publishError: false, adsense: true, botError: true } });
  await send({ type: 'publish_failed', severity: 'warning', title: 'Another failure' }); assert.equal(tg.sent().length, 4, 'switched off in the settings');
  await send({ type: 'article_ready', severity: 'info', title: 'Yeni makale taslağı hazır: X' }); assert.equal(tg.sent().length, 4);
  await S.set('telegram', { notify: { newArticle: true, critical: true, budget: true, publishError: true, adsense: true, botError: true } });
  await send({ type: 'article_ready', severity: 'info', title: 'Yeni makale taslağı hazır: X' }); assert.equal(tg.sent().length, 6);
  // flood: only HOURLY_CAP messages per hour in total
  TG.resetCounters(); const before = tg.sent().length;
  for (let i = 0; i < TG.HOURLY_CAP + 10; i++) await send({ type: 'job_failed', severity: 'warning', title: `Job ${i} failed` });
  assert.equal(tg.sent().length - before, TG.HOURLY_CAP * 2, 'capped (each message goes to both chats)'); assert.equal((await TG.status()).suppressed, 10); assert.equal((await NT.list({})).total >= TG.HOURLY_CAP + 10, true, 'the panel still has every one of them');
  // Telegram down / chat blocked: the notification is still created, the error is shown without the token
  TG.resetCounters(); tg.st.down = true; const id = await NT.create({ type: 'bot_disabled', severity: 'critical', title: 'Bot closed' }); await NT.flush(); assert.ok(id, 'the notification exists'); tg.st.down = false;
  tg.st.blocked.add(OWNER); TG.resetCounters(); await send({ type: 'bot_disabled', severity: 'critical', title: 'Bot closed 2' }); const last = (await TG.status()).lastForward;
  assert.deepEqual([last.ok, last.failed], [1, 1]); assert.match(last.error, /1001: Bot bu sohbetten engellenmiş/); assert.ok(!JSON.stringify(last).includes(TOKEN) && !JSON.stringify(await TG.status()).includes(TOKEN));
  await PR.save('telegram', { clearSecret: true }); const n0 = tg.calls.length; await send({ type: 'bot_disabled', severity: 'critical', title: 'Nobody listens' }); assert.equal(tg.calls.length, n0, 'not configured: no call');
});

test('the events the owner asked about create notifications: a new article draft, a risky AdSense class (once per change), and a full budget (once per budget and day)', opts, async () => {
  const pid = await setup(); void pid; const kinds = async () => (await NT.list({})).items.map((n) => n.type);
  // AdSense risk: only when the class changes to review/blocked
  const a = await art(pid, 'needs_review', { risk: 'low' }); await H.db().query("INSERT INTO article_checks (article_id, article_version, kind, status, result) VALUES ($1, 1, 'review', 'warn', $2)", [a.id, JSON.stringify({ risk: 'review', categories: [] })]);
  await CK.apply(a.id); await NT.flush(); assert.equal((await kinds()).filter((k) => k === 'adsense_risk').length, 1); assert.match(tg.sent()[0].text, /AdSense riski: inceleme gerekli/);
  await CK.apply(a.id); await NT.flush(); assert.equal((await kinds()).filter((k) => k === 'adsense_risk').length, 1, 're-running the same check does not repeat the message');
  // budget full: once per budget per day, the refused call is still recorded
  await PR.save('anthropic', { secret: 'sk-ant-test-0123456789abcdef', dailyBudgetUsd: 1 }); await PR.recordUsage({ provider: 'anthropic', operation: 'x', requests: 1, costUsd: 1, result: 'ok' });
  const g1 = await PR.guard('anthropic', 0.5, {}); const g2 = await PR.guard('anthropic', 0.5, {}); await NT.flush();
  assert.deepEqual([g1.ok, g2.ok], [false, false]); assert.equal((await kinds()).filter((k) => k === 'budget_full').length, 1, 'told once'); assert.ok(tg.sent().some((m) => /API bütçesi doldu/.test(m.text)));
  assert.equal((await H.db().query("SELECT count(*)::int n FROM api_usage WHERE result = 'blocked_budget'")).rows[0].n, 2, 'both refusals are recorded');
});

test('the webhook: set with the https address and a secret that only the server can compute; deleted; Telegram\'s own view is readable; a test message reaches every chat', opts, async () => {
  await setup();
  await assert.rejects(TG.setWebhook('http://api.example.com', { fetchImpl: tg.fetchImpl }), /https ile başlamalı/);
  const w = await TG.setWebhook('https://api.modulpos.com', { fetchImpl: tg.fetchImpl }); assert.equal(w.url, 'https://api.modulpos.com/api/content/telegram/webhook');
  assert.deepEqual([tg.st.webhook.url, tg.st.webhook.allowed], [w.url, ['message']]); assert.equal(tg.st.webhook.secret, TG.webhookSecret(TOKEN)); assert.ok(/^[A-Za-z0-9_-]{20,256}$/.test(tg.st.webhook.secret), 'a value Telegram accepts as secret_token');
  assert.equal(await TG.verifyWebhook(tg.st.webhook.secret), true); assert.equal(await TG.verifyWebhook('wrong'), false); assert.equal(await TG.verifyWebhook(undefined), false); assert.equal(await TG.verifyWebhook(TOKEN), false, 'the token is not the secret');
  assert.notEqual(TG.webhookSecret(TOKEN), TG.webhookSecret('987654321:AAOtherTokenOtherTokenOtherToken'));
  assert.equal((await TG.status()).webhook.url, w.url); const info = await TG.webhookInfo({ fetchImpl: tg.fetchImpl }); assert.deepEqual([info.url, info.pending, /503/.test(info.lastError)], [w.url, 2, true]);
  const t = await TG.sendTest({ fetchImpl: tg.fetchImpl }); assert.deepEqual([t.sent, t.failed.length], [2, 0]); assert.match(tg.sent().pop().text, /test mesajı/);
  tg.st.blocked.add(GROUP); const t2 = await TG.sendTest({ fetchImpl: tg.fetchImpl }); assert.deepEqual([t2.sent, t2.failed.length, t2.failed[0].chatId], [1, 1, GROUP]);
  await TG.deleteWebhook({ fetchImpl: tg.fetchImpl }); assert.equal(tg.st.webhook, null); assert.equal((await TG.status()).webhook, null);
  await PR.save('telegram', { extra: { chatIds: '' } }); await assert.rejects(TG.sendTest({ fetchImpl: tg.fetchImpl }), /Yetkili sohbet kimliği yazılmamış/);
});

test('"why is my bot silent?": the diagnosis names the cause in plain words (no token, wrong token, no chat, no webhook, a foreign webhook, an error Telegram saw, waiting messages) and is clean when everything is right', opts, async () => {
  await P.seedDefault(); let d = await TG.diagnose({ fetchImpl: tg.fetchImpl }); assert.deepEqual([d.ok, d.findings.map((f) => f.code)], [false, ['no_token']]); assert.match(d.findings[0].action, /API Kullanımı/); assert.equal(tg.calls.length, 0, 'nothing is asked of Telegram without a token');
  await PR.save('telegram', { secret: '987654321:AAWrongTokenWrongTokenWrongToken' }); d = await TG.diagnose({ fetchImpl: tg.fetchImpl }); assert.deepEqual(d.findings.map((f) => f.code), ['token_bad']); assert.match(d.findings[0].text, /belirteci tanımıyor/); assert.ok(!JSON.stringify(d).includes('987654321:'));
  await PR.save('telegram', { secret: TOKEN }); tg.st.info = { pending: 0, error: null };
  d = await TG.diagnose({ fetchImpl: tg.fetchImpl }); assert.deepEqual(d.findings.map((f) => f.code), ['token_ok', 'no_chat', 'no_webhook']); assert.equal(d.bot.username, 'modulpos_test_bot'); assert.match(d.findings[2].text, /bot hiç tepki vermiyor \(\/start dahil\)/); assert.match(d.findings[2].action, /Webhook’u kur/);
  await PR.save('telegram', { extra: { chatIds: OWNER } }); await TG.setWebhook('https://api.example.com', { fetchImpl: tg.fetchImpl }); d = await TG.diagnose({ fetchImpl: tg.fetchImpl }); assert.deepEqual([d.ok, d.findings.map((f) => f.code)], [true, ['token_ok', 'chats_ok', 'webhook_ok']]);
  tg.st.info = { pending: 3, error: 'Wrong response from the webhook: 401 Unauthorized' }; d = await TG.diagnose({ fetchImpl: tg.fetchImpl }); assert.deepEqual([d.ok, d.findings.slice(-2).map((f) => f.code)], [false, ['webhook_error', 'pending']]); assert.match(d.findings.find((f) => f.code === 'webhook_error').text, /Gizli anahtar uyuşmuyor/); assert.match(d.findings.find((f) => f.code === 'pending').text, /3 mesaj/);
  tg.st.info = { pending: 0, error: 'Connection timed out' }; assert.match((await TG.diagnose({ fetchImpl: tg.fetchImpl })).findings.find((f) => f.code === 'webhook_error').text, /yanıt vermedi/);
  tg.st.info = { pending: 0, error: null }; tg.st.webhook.url = 'https://elsewhere.example/hook'; d = await TG.diagnose({ fetchImpl: tg.fetchImpl }); assert.ok(d.findings.some((f) => f.code === 'foreign_webhook'));
  tg.st.down = true; d = await TG.diagnose({ fetchImpl: tg.fetchImpl }); assert.deepEqual(d.findings.map((f) => f.code), ['token_bad']); assert.match(d.findings[0].text, /ulaşılamadı/);
});

test('finding the owner\'s chat id: Telegram keeps what was written for a day (no webhook), the server remembers strangers (webhook), and one click authorizes a chat', opts, async () => {
  await setup({ chats: '' }); tg.st.info = { pending: 0, error: null };
  tg.st.updates = [{ update_id: 1, message: { message_id: 1, date: 1700000000, chat: { id: 5551234, type: 'private', first_name: 'Özgür', username: 'ozgur' }, from: { id: 5551234, is_bot: false }, text: '/start' } },
    { update_id: 2, message: { message_id: 2, date: 1700000100, chat: { id: 5551234, type: 'private', first_name: 'Özgür' }, from: { id: 5551234, is_bot: false }, text: 'hello' } }, { update_id: 3, message: { message_id: 3, chat: { id: -100777, type: 'group', title: 'Team' }, from: { id: 9, is_bot: false }, text: 'x' } },
    { update_id: 4, message: { message_id: 4, chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: true }, text: 'bot message' } }];
  let f = await TG.findChats({ fetchImpl: tg.fetchImpl }); assert.deepEqual([f.source, f.webhookActive, f.chats.map((c) => [c.chatId, c.name])], ['telegram', false, [['5551234', 'Özgür'], ['-100777', 'Team']]], 'a person once, a bot never'); assert.ok(tg.calls.some((c) => c.method === 'getUpdates' && c.body.timeout === 0));
  assert.deepEqual(await TG.addChat('5551234'), { chatIds: ['5551234'] }); assert.deepEqual((await TG.credentials()).chatIds, ['5551234']); await TG.addChat('5551234'); assert.deepEqual((await TG.credentials()).chatIds, ['5551234'], 'no duplicates');
  await assert.rejects(TG.addChat('abc'), /yalnızca sayı/); f = await TG.findChats({ fetchImpl: tg.fetchImpl }); assert.deepEqual(f.chats.map((c) => c.chatId), ['-100777'], 'an authorized chat is not offered again');
  tg.st.updates = []; assert.match((await TG.findChats({ fetchImpl: tg.fetchImpl })).note, /bota \/start yazıp tekrar deneyin/);
  // with a webhook Telegram refuses getUpdates: the server lists the strangers it saw itself (id and name only, never what they wrote)
  await TG.setWebhook('https://api.example.com', { fetchImpl: tg.fetchImpl }); const n = tg.calls.filter((c) => c.method === 'getUpdates').length;
  await TG.handleUpdate(update(801, 7777, '/status')); await TG.handleUpdate(update(802, 8888, 'just chatting'));
  f = await TG.findChats({ fetchImpl: tg.fetchImpl }); assert.deepEqual([f.source, f.webhookActive, f.chats.map((c) => c.chatId).sort()], ['seen', true, ['7777', '8888']]); assert.equal(tg.calls.filter((c) => c.method === 'getUpdates').length, n, 'getUpdates is not called while a webhook is active');
  assert.ok(!JSON.stringify(f).includes('just chatting') && !JSON.stringify(f).includes('/status'), 'what they wrote is never stored');
  assert.deepEqual((await TG.status()).seenChats.map((c) => c.chatId).sort(), ['7777', '8888']); await TG.addChat('7777'); assert.deepEqual((await TG.status()).seenChats.map((c) => c.chatId), ['8888']);
  assert.match(tg.sent().filter((m) => m.chat === '7777').length ? 'x' : 'no reply to the stranger', /no reply/);
});
