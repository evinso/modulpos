const crypto = require('node:crypto');
const db = require('../db');
const { env } = require('../env');
const { HttpError } = require('../lib/http');
const audit = require('./audit');
const providers = require('./providers');
const settings = require('./settings');

/**
 * Telegram (phase 7): notifications to the owner's chats and a few commands.
 *
 *  - ONE bot, ONE list of authorized chat ids (panel: API Kullanımı → Telegram). Commands from any other chat are ignored; only `/start` and `/id` answer with that chat's number, so the
 *    owner can find the number to add. Nothing else is revealed to a stranger.
 *  - updates arrive by WEBHOOK (the free hosting sleeps: Telegram retries until the API wakes up). The webhook is protected by a secret that Telegram sends in a header
 *    (derived from the encryption key and the bot token, never stored or shown), every update id is handled once, and a state-changing command older than 10 minutes is refused
 *    (a command that waited in Telegram's queue while the API slept must not run hours later).
 *  - notifications reach Telegram from `notifications.create` (never blocking, never throwing): a per-hour cap and a repeat filter keep a failure storm from flooding the chat.
 *  - commands read the same services the panel reads. The only ones that change anything are /pause, /resume and `/generate onay` (a draft that always waits for a person).
 *  - the bot token is only ever in the URL of the request to Telegram: it is removed from every error text that could be stored or shown.
 */
const API = 'https://api.telegram.org';
const OLD_COMMAND_MS = 10 * 60 * 1000;
const HOURLY_CAP = 30;
const REPEAT_MS = 10 * 60 * 1000;

class TelegramError extends Error {
  constructor(message, { code = null, retryable = false } = {}) { super(message); this.name = 'TelegramError'; this.code = code; this.retryable = retryable; }
}

const seam = { fetchImpl: null };                                    // tests give a fake Telegram here
const doFetch = (o) => (o && o.fetchImpl) || seam.fetchImpl || globalThis.fetch;
const sent = { times: [], recent: new Map(), suppressed: 0 };

// ── the configuration ───────────────────────────────────────────────────────────────────────────────────────────
async function credentials() {
  const token = await providers.secretFor('telegram');
  const p = await providers.get('telegram');
  const chatIds = String((p.extra && p.extra.chatIds) || '').split(',').map((x) => x.trim()).filter(Boolean);
  return { token, chatIds, configured: !!token };
}

async function getState(key) { const r = (await db.query('SELECT value FROM telegram_state WHERE key = $1', [key])).rows[0]; return r ? r.value : null; }
async function setState(key, value) { await db.query('INSERT INTO telegram_state (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()', [key, JSON.stringify(value)]); }

const webhookSecret = (token) => crypto.createHmac('sha256', String(env().encryptionKey || 'no-key')).update(`telegram-webhook:${token}`).digest('base64url');
async function verifyWebhook(headerValue) {
  const { token, configured } = await credentials(); if (!configured || typeof headerValue !== 'string') return false;
  const a = Buffer.from(headerValue); const b = Buffer.from(webhookSecret(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── talking to Telegram ─────────────────────────────────────────────────────────────────────────────────────────
async function call(token, method, body, o = {}) {
  let res;
  try { res = await doFetch(o)(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(o.timeoutMs || 10000) }); }
  catch (err) { throw new TelegramError(err && err.name === 'TimeoutError' ? 'Telegram 10 saniyede cevap vermedi' : 'Telegram’a ulaşılamadı (ağ hatası)', { code: 'network', retryable: true }); }
  const j = await res.json().catch(() => null);
  if (res.ok && j && j.ok) return j.result;
  const code = (j && j.error_code) || res.status; const desc = String((j && j.description) || '').split(token).join('[gizli]').slice(0, 200);
  const known = code === 401 ? 'Bot belirteci (token) reddedildi' : code === 403 ? 'Bot bu sohbetten engellenmiş ya da sohbete hiç başlanmamış (önce bota /start yazın)' : code === 400 && /chat not found/i.test(desc) ? 'Sohbet bulunamadı (kimlik yanlış ya da bota hiç yazılmamış)' : code === 429 ? 'Telegram istek sınırı koydu (429)' : `Telegram hata verdi (${code})`;
  throw new TelegramError(`${known}${desc && code !== 401 ? `: ${desc}` : ''}`, { code, retryable: code === 429 || code >= 500 });
}

async function sendTo(token, chatId, text, o = {}) {
  return call(token, 'sendMessage', { chat_id: /^-?\d+$/.test(String(chatId)) ? Number(chatId) : chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true }, o);
}

/** a message to every authorized chat. @returns { sent, failed: [{ chatId, error }] } */
async function broadcast(text, o = {}) {
  const { token, chatIds, configured } = await credentials();
  if (!configured) throw new HttpError(409, 'Telegram bot belirteci kayıtlı değil (API Kullanımı → Telegram)');
  if (!chatIds.length) throw new HttpError(409, 'Yetkili sohbet kimliği yazılmamış (API Kullanımı → Telegram). Bota /start yazarsanız kimliğinizi söyler.');
  const out = { sent: 0, failed: [] };
  for (const id of chatIds) { try { await sendTo(token, id, text, o); out.sent++; } catch (err) { out.failed.push({ chatId: id, error: err.message }); } }
  return out;
}

// ── notifications → Telegram ────────────────────────────────────────────────────────────────────────────────────
const GROUP_OF = { article_ready: 'newArticle', article_fixed: 'newArticle', article_fix_failed: 'botError', critical_correction: 'critical', budget_full: 'budget', budget_warning: 'budget', report_ready: 'report', publish_failed: 'publishError', adsense_risk: 'adsense', sensitive_found: 'adsense', adsense_site: 'adsense', bot_disabled: 'botError', job_failed: 'botError', pipeline_published: 'newArticle', pipeline_stopped: 'botError' };
const ICON = { info: 'ℹ️', warning: '⚠️', critical: '🔴' };

/** Called by notifications.create for every new notification. Never throws; sends only what the owner asked for. @returns what happened (for tests) */
async function forward(n, o = {}) {
  try {
    const { token, chatIds, configured } = await credentials();
    if (!configured || !chatIds.length) return { skipped: 'not_configured' };
    const group = GROUP_OF[n.type] || (n.severity === 'critical' ? 'critical' : null);
    if (!group) return { skipped: 'not_wanted_type' };
    const cfg = (await settings.get('telegram')).value;
    if (!cfg.notify[group]) return { skipped: 'switched_off' };
    const now = Date.now(); const key = `${n.type}|${n.title}`;
    for (const [k, t] of sent.recent) if (now - t > REPEAT_MS) sent.recent.delete(k);
    if (sent.recent.has(key)) return { skipped: 'repeat' };
    sent.times = sent.times.filter((t) => now - t < 3600000);
    if (sent.times.length >= HOURLY_CAP) { sent.suppressed++; return { skipped: 'hourly_cap' }; }
    sent.recent.set(key, now); sent.times.push(now);
    const text = `${ICON[n.severity] || 'ℹ️'} ${n.title}${n.body ? `\n${String(n.body).slice(0, 600)}` : ''}\n\nModulPOS Content`;
    let ok = 0; const errors = [];
    for (const id of chatIds) { try { await sendTo(token, id, text, o); ok++; } catch (err) { errors.push(`${id}: ${err.message}`); } }
    await setState('lastForward', { at: new Date().toISOString(), ok, failed: errors.length, error: errors[0] || null, type: n.type });
    return { sent: ok, failed: errors.length };
  } catch (err) { console.error('[Content] telegram forward failed:', err.message); return { skipped: 'error', error: err.message }; }
}

// ── commands ────────────────────────────────────────────────────────────────────────────────────────────────────
const num = (v) => new Intl.NumberFormat('tr-TR').format(v);
const usdText = (v) => `$${Number(v).toFixed(2)}`;
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

async function defaultProject() {
  const p = (await db.query("SELECT id, name FROM content_projects WHERE status = 'active' ORDER BY created_at LIMIT 1")).rows[0];
  if (!p) throw new HttpError(409, 'Etkin bir proje yok');
  const n = (await db.query("SELECT count(*)::int n FROM content_projects WHERE status = 'active'")).rows[0].n;
  return { ...p, many: n > 1 };
}

const COMMANDS = {
  async help() {
    return ['Komutlar:', '/status — sistem durumu', '/trends — güncel gündem', '/articles — onay bekleyen ve hazır makaleler', '/generate — sıradaki fikri göster (yazdırmak için: /generate onay)', '/updates — güncelleme bekleyenler', '/report — en son günlük rapor (haftalık için: /report weekly)',
      '/adsense — AdSense riskleri ve site denetimi', '/cost — API maliyetleri', '/pause — botları duraklat', '/resume — botları devam ettir', '/id — bu sohbetin kimliği'].join('\n');
  },
  async status({ now }) {
    const p = await defaultProject(); const bots = require('./bots'); const limits = require('./limits'); const scheduler = require('./scheduler');
    const b = await bots.list(); const sc = scheduler.status();
    const a = (await db.query(`SELECT count(*) FILTER (WHERE status = 'ready')::int ready, count(*) FILTER (WHERE status IN ('needs_review', 'fact_checking'))::int review, count(*) FILTER (WHERE status = 'published')::int published,
      count(*) FILTER (WHERE status = 'needs_update')::int needs_update FROM articles WHERE project_id = $1`, [p.id])).rows[0];
    const j = (await db.query("SELECT count(*) FILTER (WHERE status = 'queued')::int q, count(*) FILTER (WHERE status = 'running')::int r, count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '24 hours')::int f FROM jobs")).rows[0];
    const lim = (await limits.status({ projectId: p.id, now })).items.filter((i) => ['new_article', 'publish'].includes(i.workType));
    const usage = await providers.usageReport({ days: 1, now });
    const unread = (await db.query('SELECT count(*)::int n FROM notifications WHERE read_at IS NULL')).rows[0].n;
    return [`📊 ${p.name}`, `Botlar: ${b.paused ? `DURAKLATILDI${b.pausedBy ? ` (${b.pausedBy})` : ''}` : 'çalışıyor'} · zamanlayıcı: ${sc.running ? 'açık' : 'kapalı'}`,
      `Kuyruk: ${j.q} bekleyen, ${j.r} çalışan, son 24 saatte ${j.f} başarısız görev`, `Makaleler: ${a.ready} hazır · ${a.review} onay/kontrol bekleyen · ${a.published} yayında · ${a.needs_update} güncelleme bekleyen`,
      `Bugünkü limitler: ${lim.map((i) => `${i.label.toLowerCase()} ${i.done}/${i.limit}`).join(', ')}`, `API bugün: ${usdText(usage.today.costUsd)}${usage.today.unknownCalls ? ` (+${usage.today.unknownCalls} çağrının maliyeti bilinmiyor)` : ''}`, `Okunmamış bildirim: ${unread}`].join('\n');
  },
  async trends({ now }) {
    const p = await defaultProject(); const t = await require('./trends').overview(p.id, { now, limit: 6 });
    if (!t.clusters.length) return `Son ${t.hours} saatte nişe uygun gündem yok.`;
    return [`🔥 Gündem (son ${t.hours} saat, ${p.name})`, ...t.clusters.map((c, i) => `${i + 1}. ${clip(c.title, 90)} — ${c.sourceCount} kaynak${c.categoryName ? ` · ${c.categoryName}` : ''}`)].join('\n');
  },
  async articles() {
    const p = await defaultProject();
    const rows = (await db.query("SELECT h1, status, quality_score, adsense_risk FROM articles WHERE project_id = $1 AND status IN ('ready', 'needs_review') ORDER BY (status = 'ready') DESC, updated_at DESC LIMIT 8", [p.id])).rows;
    if (!rows.length) return 'Onay bekleyen ya da yayına hazır makale yok.';
    return [`📝 Makaleler (${p.name})`, ...rows.map((r) => `• ${clip(r.h1, 80)} — ${r.status === 'ready' ? 'yayına hazır' : 'onay bekliyor'}, kalite ${r.quality_score === null ? 'ölçülmedi' : r.quality_score}, AdSense ${r.adsense_risk || 'ölçülmedi'}`), 'Onaylamak ve yayımlamak için paneli kullanın.'].join('\n');
  },
  async updates() {
    const p = await defaultProject();
    const a = (await db.query("SELECT count(*) FILTER (WHERE status = 'needs_update')::int flagged FROM articles WHERE project_id = $1", [p.id])).rows[0];
    const r = (await db.query("SELECT kind, count(*)::int n FROM refresh_proposals WHERE project_id = $1 AND status = 'proposed' GROUP BY kind", [p.id])).rows;
    const open = r.reduce((s, x) => s + x.n, 0);
    return [`🔄 Güncellemeler (${p.name})`, `Güncelleme bekleyen (kanıtlı) makale: ${a.flagged}`, `Onay bekleyen taslak: ${open}${r.length ? ` (${r.map((x) => `${x.n} ${({ minor: 'küçük', major: 'kapsamlı', critical: 'KRİTİK' })[x.kind] || x.kind}`).join(', ')})` : ''}`, open ? 'Onay için Güncelleme Merkezi’ni kullanın.' : ''].filter(Boolean).join('\n');
  },
  async adsense() {
    const p = await defaultProject(); const au = await require('./adsenseAudit').overview(p.id);
    const risky = (await db.query("SELECT count(*) FILTER (WHERE adsense_risk = 'review')::int review, count(*) FILTER (WHERE adsense_risk = 'blocked')::int blocked FROM articles WHERE project_id = $1 AND status <> 'archived'", [p.id])).rows[0];
    return [`🛡 AdSense (${p.name})`, `Makale riski: ${risky.blocked} yayınlanamaz, ${risky.review} inceleme gerekli (resmî bir Google puanı değildir)`,
      ...(au.latest.length ? au.latest.slice(0, 4).map((a) => `Site: ${a.url.replace(/^https?:\/\//, '')} — ${a.verdictLabel || 'denetlenemedi'}${a.summary ? ` (${a.summary.requiredMissing.length} zorunlu eksik, ${a.summary.warning} uyarı)` : ''}`) : ['Site denetimi henüz yapılmadı.']), 'Bu bir onay değildir; ayrıntı panelde “AdSense Denetimi”.'].join('\n');
  },
  async cost({ now }) {
    const u = await providers.usageReport({ days: 1, now }); const list = await providers.list();
    const unk = (x) => (x.unknownCalls ? ` (+${x.unknownCalls} çağrının maliyeti bilinmiyor)` : '');
    const budgets = list.filter((x) => x.dailyBudgetUsd !== null || x.monthlyBudgetUsd !== null).map((x) => `${x.label}: günlük ${x.dailyBudgetUsd === null ? '—' : usdText(x.dailyBudgetUsd)} / aylık ${x.monthlyBudgetUsd === null ? '—' : usdText(x.monthlyBudgetUsd)}`);
    return [`💰 API maliyeti`, `Bugün: ${usdText(u.today.costUsd)}${unk(u.today)} · ${u.today.requests} istek`, `Bu ay: ${usdText(u.month.costUsd)}${unk(u.month)} · ${u.month.requests} istek`,
      ...u.providers.filter((p) => p.requests || p.costUsd).map((p) => `• ${p.provider}: ${usdText(p.costUsd)} (${p.requests} istek${p.unknownCalls ? `, ${p.unknownCalls} tanesinin maliyeti bilinmiyor` : ''})`), ...(budgets.length ? ['Bütçeler:', ...budgets] : ['Bütçe sınırı tanımlı değil.'])].join('\n');
  },
  async report({ args }) {
    const p = await defaultProject(); const kind = String(args[0] || '').toLowerCase() === 'weekly' ? 'weekly' : 'daily';
    const r = await require('./reports').latest(p.id, kind);
    return r ? r.body : `Henüz ${kind === 'weekly' ? 'haftalık' : 'günlük'} rapor yok. Raporlar her sabah kendiliğinden hazırlanır (pazartesileri haftalık da); panelde Raporlar sayfasından hemen üretebilirsiniz.`;
  },
  async pause({ chatId }) {
    const bots = require('./bots'); await bots.setPaused(true, { email: `telegram:${chatId}` }); await audit.audit({ user: { id: null, email: `telegram:${chatId}` }, ip: 'telegram' }, { action: 'bots.pause', entity: 'bots', entityId: 'telegram' });
    return '⏸ Botlar duraklatıldı. Devam ettirmek için /resume. (Sizin elle başlattığınız işler durmaz.)';
  },
  async resume({ chatId }) {
    const bots = require('./bots'); await bots.setPaused(false, { email: `telegram:${chatId}` }); await audit.audit({ user: { id: null, email: `telegram:${chatId}` }, ip: 'telegram' }, { action: 'bots.resume', entity: 'bots', entityId: 'telegram' });
    return '▶️ Botlar devam ediyor.';
  },
  async generate({ args, chatId, now, modelFetch }) {
    const p = await defaultProject(); const sel = await require('./opportunities').selectForGeneration(p.id, { count: 1, now });
    if (!sel.picks.length) return `Bugün yazılacak uygun fikir yok${sel.note ? `: ${sel.note}` : ''}.`;
    const pick = sel.picks[0]; const label = clip(pick.keyword || pick.title || pick.id, 90);
    if (String(args[0] || '').toLowerCase() !== 'onay') return [`✍️ Sıradaki fikir: “${label}”${pick.categoryName ? ` (${pick.categoryName})` : ''}`, pick.why, 'Yazdırmak için: /generate onay', 'Yapay zekâ kredisi harcar ve günün “yeni makale” limitinden bir yer alır. Taslak asla kendiliğinden yayımlanmaz; onayınızı bekler.'].filter(Boolean).join('\n');
    const out = await require('./writer').start(pick.id, { manual: true, userId: null, fetchImpl: modelFetch, background: true, now });
    await audit.audit({ user: { id: null, email: `telegram:${chatId}` }, ip: 'telegram' }, { action: 'article.generate', entity: 'opportunity', entityId: pick.id, after: { via: 'telegram' } });
    return `✍️ “${label}” için makale yazımı başladı (birkaç dakika sürer). Bitince “Yeni makale taslağı hazır” bildirimi gelir; taslak onayınızı bekler.${out && out.run ? '' : ''}`;
  },
  async id({ chatId }) { return `Bu sohbetin kimliği: ${chatId}`; },
};
const CHANGES_STATE = new Set(['pause', 'resume', 'generate']);

/** "/status@MyBot extra words" -> { name: 'status', args: ['extra', 'words'] }; null when it is not a command */
function parseCommand(text) {
  const m = /^\/([A-Za-z_]{1,32})(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  return m ? { name: m[1].toLowerCase(), args: (m[2] || '').trim().split(/\s+/).filter(Boolean).slice(0, 5) } : null;
}

/**
 * One update from Telegram's webhook. @returns what was done (for tests and logs): { ignored: reason } or { command, authorized, replied }
 * @param o { fetchImpl (Telegram), modelFetch (for /generate onay), now }
 */
async function handleUpdate(update, o = {}) {
  const now = o.now || new Date();
  const cred = await credentials(); if (!cred.configured) return { ignored: 'not_configured' };
  const id = update && Number(update.update_id); if (!Number.isSafeInteger(id)) return { ignored: 'bad_update' };
  const fresh = (await db.query('INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id', [id])).rowCount;
  if (!fresh) return { ignored: 'duplicate' };
  if (Math.random() < 0.02) await db.query("DELETE FROM telegram_updates WHERE received_at < now() - interval '7 days'").catch(() => {});
  try {
    const m = update.message;
    if (!m || typeof m.text !== 'string' || !m.chat || m.chat.id === undefined || (m.from && m.from.is_bot)) return { ignored: 'not_a_text_message' };
    if (!cred.chatIds.includes(String(m.chat.id))) await rememberChat(m.chat);                     // so the panel can say "someone wrote to your bot: is this you?"
    const cmd = parseCommand(m.text); if (!cmd) return { ignored: 'not_a_command' };
    const chatId = String(m.chat.id);
    const reply = (text) => sendTo(cred.token, chatId, text, o);
    if (!cred.chatIds.includes(chatId)) {
      if (cmd.name === 'start' || cmd.name === 'id') { await reply(`Bu bot yalnızca yetkili sohbetlere cevap verir. Bu sohbetin kimliği: ${chatId}\nSahibi iseniz bu sayıyı panelde API Kullanımı → Telegram → “Yetkili sohbet kimlikleri” alanına ekleyin.`); return { ignored: 'unauthorized', command: cmd.name, replied: true }; }
      await audit.systemLog('warn', 'telegram', 'Yetkisiz sohbetten komut geldi (yok sayıldı)', { chatId, command: cmd.name });
      return { ignored: 'unauthorized', command: cmd.name, replied: false };
    }
    if (cmd.name === 'start') { await reply(`Merhaba! ModulPOS Content botuna bağlısınız. Komutlar için /help.\n\n${await COMMANDS.status({ now })}`); return { command: 'start', authorized: true, replied: true }; }
    const h = COMMANDS[cmd.name];
    if (!h) { await reply('Bu komutu tanımıyorum. Komutlar için /help'); return { command: cmd.name, authorized: true, replied: true, unknown: true }; }
    if (CHANGES_STATE.has(cmd.name) && m.date && now.getTime() - m.date * 1000 > OLD_COMMAND_MS) { await reply('Bu komut 10 dakikadan eski (bot uykudayken gelmiş olabilir): güvenlik için çalıştırılmadı. Tekrar gönderin.'); return { command: cmd.name, authorized: true, replied: true, stale: true }; }
    let text;
    try { text = await h({ args: cmd.args, chatId, now, modelFetch: o.modelFetch }); }
    catch (err) { text = `⚠️ ${err instanceof HttpError ? err.message : 'Komut çalışırken bir hata oldu; ayrıntı panelde İşlem Geçmişi’nde.'}`; if (!(err instanceof HttpError)) await audit.systemLog('error', 'telegram', `/${cmd.name} başarısız: ${err.message}`, {}); }
    await reply(text);
    return { command: cmd.name, authorized: true, replied: true };
  } catch (err) {
    await db.query('DELETE FROM telegram_updates WHERE update_id = $1', [id]).catch(() => {});          // Telegram may deliver it again: let that retry be handled
    throw err;
  }
}

// ── the panel's side ────────────────────────────────────────────────────────────────────────────────────────────
/** what the panel shows (never the token) */
async function status() {
  const c = await credentials(); const cfg = (await settings.get('telegram')).value;
  return { configured: c.configured, chatIds: c.chatIds, bot: await getState('bot'), webhook: await getState('webhook'), lastForward: await getState('lastForward'), seenChats: ((await getState('seenChats')) || []).filter((x) => !c.chatIds.includes(x.chatId)), notify: cfg.notify, suppressed: sent.suppressed, hourlyCap: HOURLY_CAP,
    commands: Object.keys(COMMANDS).filter((k) => k !== 'id').map((k) => `/${k}`) };
}

/** the connection test of the provider card (also remembers the bot's name for the panel) */
async function testConnection({ secret, extra, fetchImpl }) {
  const me = await call(secret, 'getMe', {}, { fetchImpl });
  await setState('bot', { id: me.id, username: me.username, name: me.first_name });
  const ids = String((extra && extra.chatIds) || '').split(',').map((x) => x.trim()).filter(Boolean);
  return { ok: true, message: `Telegram bağlantısı çalışıyor: @${me.username}.${ids.length ? ` ${ids.length} yetkili sohbet tanımlı.` : ' Yetkili sohbet kimliği yok: bota /start yazın, kimliğinizi söyler; sonra buraya ekleyin.'}` };
}

/** tells Telegram where to send updates. `baseUrl` is the public address of this API (https). */
async function setWebhook(baseUrl, o = {}) {
  const { token, configured } = await credentials(); if (!configured) throw new HttpError(409, 'Önce bot belirtecini kaydedin');
  if (!/^https:\/\/[^/\s]+$/i.test(String(baseUrl || ''))) throw new HttpError(400, 'Webhook adresi https ile başlamalı (Telegram yalnızca https’e gönderir)');
  const url = `${baseUrl}/api/content/telegram/webhook`;
  try { await call(token, 'setWebhook', { url, secret_token: webhookSecret(token), allowed_updates: ['message'], max_connections: 2, drop_pending_updates: false }, o); }
  catch (err) { throw new HttpError(502, err.message); }
  await setState('webhook', { url, setAt: new Date().toISOString() });
  return { url };
}
async function deleteWebhook(o = {}) {
  const { token, configured } = await credentials(); if (!configured) throw new HttpError(409, 'Bot belirteci kayıtlı değil');
  try { await call(token, 'deleteWebhook', { drop_pending_updates: false }, o); } catch (err) { throw new HttpError(502, err.message); }
  await setState('webhook', null);
}
/** what Telegram itself says about the webhook (pending updates, the last error it saw) */
async function webhookInfo(o = {}) {
  const { token, configured } = await credentials(); if (!configured) throw new HttpError(409, 'Bot belirteci kayıtlı değil');
  try { const i = await call(token, 'getWebhookInfo', {}, o); return { url: i.url || null, pending: i.pending_update_count || 0, lastError: i.last_error_message || null, lastErrorAt: i.last_error_date ? new Date(i.last_error_date * 1000).toISOString() : null }; }
  catch (err) { throw new HttpError(502, err.message); }
}
async function sendTest(o = {}) { return broadcast('✅ ModulPOS Content test mesajı: bildirimler bu sohbete gelecek. Komutlar için /help', o); }

// ── finding out why the bot is silent, and who is talking to it ──────────────────────────────────────────────────────
const chatName = (c) => String(c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.username ? `@${c.username}` : '') || '').slice(0, 60);
const asChat = (c) => ({ chatId: String(c.id), type: c.type || 'private', name: chatName(c) });

/** the last few chats that wrote to the bot without being authorized (id and name only, never what they wrote) */
async function rememberChat(chat) {
  try {
    const seen = ((await getState('seenChats')) || []).filter((x) => x.chatId !== String(chat.id));
    await setState('seenChats', [{ ...asChat(chat), at: new Date().toISOString() }, ...seen].slice(0, 8));
  } catch (err) { console.error('[Content] telegram seen chat failed:', err.message); }
}

/** Adds a chat id to the authorized list (what the owner types into the provider card, by one click). */
async function addChat(chatId) {
  const id = String(chatId || '').trim();
  if (!/^-?\d{3,20}$/.test(id)) throw new HttpError(400, 'Sohbet kimliği yalnızca sayı olmalı');
  const p = await providers.get('telegram'); const ids = String((p.extra && p.extra.chatIds) || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.includes(id)) ids.push(id);
  await providers.save('telegram', { extra: { chatIds: ids.join(',') } });
  await setState('seenChats', ((await getState('seenChats')) || []).filter((x) => x.chatId !== id));
  return { chatIds: ids };
}

/**
 * The chats that wrote to the bot. With no webhook Telegram still holds the messages for a day, so they can be read (getUpdates; nothing is consumed); while a webhook is active
 * Telegram refuses that, and the chats this server saw are listed instead.
 */
async function findChats(o = {}) {
  const { token, configured, chatIds } = await credentials(); if (!configured) throw new HttpError(409, 'Önce bot belirtecini kaydedin');
  let info; try { info = await call(token, 'getWebhookInfo', {}, o); } catch (err) { throw new HttpError(502, err.message); }
  const known = new Set(chatIds); const out = new Map();
  if (info.url) { for (const c of (await getState('seenChats')) || []) if (!known.has(c.chatId)) out.set(c.chatId, c); return { source: 'seen', webhookActive: true, chats: [...out.values()], note: 'Webhook kurulu olduğu için Telegram’ın bekleyen listesine bakılamaz; bu sunucunun bota yazarken gördüğü tanımadığı sohbetler gösteriliyor.' }; }
  let ups; try { ups = await call(token, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message'] }, { ...o, timeoutMs: 15000 }); } catch (err) { throw new HttpError(502, err.message); }
  for (const u of ups || []) { const c = u && u.message && u.message.chat; if (c && c.id !== undefined && !(u.message.from && u.message.from.is_bot) && !known.has(String(c.id))) out.set(String(c.id), { ...asChat(c), at: u.message.date ? new Date(u.message.date * 1000).toISOString() : null }); }
  return { source: 'telegram', webhookActive: false, chats: [...out.values()], note: out.size ? 'Bota yazan sohbetler (son 24 saat).' : 'Telegram’da bota yazılmış (henüz yetkili olmayan) bir mesaj görünmüyor: bota /start yazıp tekrar deneyin. Yanlış botla konuşmadığınızdan da emin olun (adı yukarıda).' };
}

/**
 * "Why does my bot not answer?": checks the token, the authorized chats and what Telegram itself says about the webhook, and says in plain words what to do.
 * @returns { ok, bot, findings: [{ level: 'ok' | 'warn' | 'bad', code, text, action? }] }
 */
async function diagnose(o = {}) {
  const findings = []; const add = (level, code, text, action) => findings.push({ level, code, text, ...(action ? { action } : {}) });
  const { token, chatIds, configured } = await credentials();
  if (!configured) { add('bad', 'no_token', 'Bot belirteci (token) kayıtlı değil.', 'API Kullanımı ve Maliyetler → Telegram kartına BotFather’ın verdiği belirteci yazıp Kaydet’e basın.'); return { ok: false, bot: null, findings }; }
  let bot = null;
  try { const me = await call(token, 'getMe', {}, o); bot = { id: me.id, username: me.username }; await setState('bot', { id: me.id, username: me.username, name: me.first_name }); add('ok', 'token_ok', `Belirteç doğru: bot @${me.username}. Telegram’da TAM OLARAK bu botla konuştuğunuzdan emin olun.`); }
  catch (err) { add('bad', 'token_bad', err.code === 401 ? 'Telegram bu belirteci tanımıyor (reddedildi): belirteç yanlış yazılmış ya da BotFather’da yenilenmiş.' : `Telegram’a ulaşılamadı: ${err.message}`, err.code === 401 ? 'BotFather’da /mybots → botunuz → API Token’dan güncel belirteci kopyalayıp API Kullanımı → Telegram kartına yapıştırın.' : 'Biraz sonra tekrar deneyin.'); return { ok: false, bot, findings }; }
  if (!chatIds.length) add('warn', 'no_chat', 'Yetkili sohbet kimliği yazılmamış: bot hiçbir sohbete bildirim göndermez ve komutlara cevap vermez (yalnızca /start kendi kimliğinizi söyler).', 'Aşağıdaki “Bota yazan sohbetleri bul” düğmesiyle kimliğinizi bulup “Yetkili yap”a basın.');
  else add('ok', 'chats_ok', `${chatIds.length} yetkili sohbet tanımlı.`);
  let info = null;
  try { info = await call(token, 'getWebhookInfo', {}, o); } catch (err) { add('bad', 'webhook_unreadable', `Telegram’ın webhook durumu okunamadı: ${err.message}`); return { ok: false, bot, findings }; }
  const ours = await getState('webhook');
  if (!info.url) add('bad', 'no_webhook', 'Webhook KURULU DEĞİL: Telegram, bota yazdıklarınızı bu sisteme iletmiyor; bu yüzden bot hiç tepki vermiyor (/start dahil).', 'Aşağıdaki “Webhook’u kur” düğmesine basın (adres kutusunda https://api.modulpos.com yazmalı).');
  else {
    if (!ours || ours.url !== info.url) add('warn', 'foreign_webhook', `Telegram’da bu sistemin kurmadığı bir webhook adresi var: ${info.url}.`, '“Webhook’u kur”a basarak bu sistemin adresini yeniden kurun.');
    else add('ok', 'webhook_ok', `Webhook kurulu: ${info.url}`);
    const err = String(info.last_error_message || '');
    if (err) {
      const when = info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null;
      const hint = /\b401\b/.test(err) ? 'Gizli anahtar uyuşmuyor (belirteci değiştirdiyseniz görülür).' : /\b404\b/.test(err) ? 'Bu adres API’de bulunamadı: adres yanlış ya da API eski sürümde.' : /\b(500|502|503|504)\b|timeout|timed out/i.test(err) ? 'API o sırada yanıt vermedi (uyuyor olabilir ya da hata verdi).' : /ssl|certificate|resolve|connect/i.test(err) ? 'Telegram adrese bağlanamadı (adres ya da sertifika sorunu).' : '';
      add('bad', 'webhook_error', `Telegram son denemede şu hatayı aldı: “${err.slice(0, 160)}”${when ? ` (${when})` : ''}. ${hint}`.trim(), '“Webhook’u yeniden kur”a basın; sürerse İşlem Geçmişi’ndeki hatalara bakın.');
    }
    if (info.pending_update_count > 0) add('warn', 'pending', `${info.pending_update_count} mesaj Telegram’da iletilmeyi bekliyor (bize ulaşamamış).`, 'API uyuyorsa birkaç saniye bekleyip yeniden kontrol edin; sürerse webhook’u yeniden kurun.');
  }
  return { ok: findings.every((f) => f.level === 'ok'), bot, findings };
}

const useFetch = (fn) => { seam.fetchImpl = fn || null; };
const resetCounters = () => { sent.times = []; sent.recent.clear(); sent.suppressed = 0; };

module.exports = { diagnose, findChats, addChat, TelegramError, COMMANDS, GROUP_OF, HOURLY_CAP, parseCommand, credentials, verifyWebhook, webhookSecret, forward, broadcast, handleUpdate, status, testConnection, setWebhook, deleteWebhook, webhookInfo, sendTest, useFetch, resetCounters, call };
