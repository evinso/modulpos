const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { ownedParam } = require('../middleware/ownership');
const wa = require('../services/whatsapp');   // only wa.engineName(): the platform's own connection is NEVER used here
const { getRegistry, MAX_SENDERS } = require('../services/whatsapp/senders');
const { parseList, cleanPhone, renderMessage, placeholdersOf, fold, NAME_ALIASES, MAX_ROWS } = require('../services/whatsapp/bulkCsv');
const { getRunner, sentTodayFor, parseVars, gapStats, MIN_DELAY_FLOOR_SEC, MAX_DELAY_CEIL_SEC } = require('../services/whatsapp/bulkRunner');

/**
 * Bulk WhatsApp (admin only): a message to a list of numbers, one after another with a random pause between a minimum and a maximum
 * number of seconds. The list can be typed / pasted or imported from a CSV file. The sending itself is done by services/whatsapp/bulkRunner.js.
 *
 * It sends from SENDER numbers (WhatsappSender) that are linked on this page with their own QR code. They are separate connections with
 * their own saved login: nothing here reads, uses or changes the platform's own WhatsApp number (the one for notifications).
 */
const router = express.Router();
router.use(auth);
router.use((req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  next();
});
// :id is a sender under /senders and a campaign everywhere else; both must belong to the caller's store
router.param('id', (req, res, next, id) => ownedParam(req.path.startsWith('/senders') ? 'whatsappSender' : 'whatsappCampaign')(req, res, next, id));

const MAX_MESSAGE = 4000;
const MAX_NAME = 100;
const MAX_DAILY = 5000;
const DEFAULTS = { minDelaySec: 12, maxDelaySec: 20, dailyLimit: 250 };
const STATUSES = ['pending', 'sending', 'sent', 'failed'];

const fail = (status, error) => Object.assign(new Error(error), { status, expose: true });
const send400 = (res, error) => res.status(400).json({ error });

async function storeOf(req) {
  const store = await prisma.store.findFirst({ where: { userId: req.user.id }, select: { id: true } });
  if (!store) throw fail(404, 'Mağaza bulunamadı');
  return store;
}

async function campaignOf(req) {
  const store = await storeOf(req);
  const c = await prisma.whatsappCampaign.findFirst({ where: { id: req.params.id, storeId: store.id } });
  if (!c) throw fail(404, 'Kampanya bulunamadı');
  return c;
}

/** { pending, sending, sent, failed, total } per campaign id */
async function countsFor(ids) {
  const out = new Map(ids.map((id) => [id, { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 }]));
  if (ids.length === 0) return out;
  const rows = await prisma.whatsappCampaignRecipient.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: ids } }, _count: { _all: true } });
  for (const r of rows) { const o = out.get(r.campaignId); if (o && STATUSES.includes(r.status)) { o[r.status] = r._count._all; o.total += r._count._all; } }
  return out;
}

const shape = (c, counts, senderName = null) => ({
  id: c.id, name: c.name, message: c.message, minDelaySec: c.minDelaySec, maxDelaySec: c.maxDelaySec, dailyLimit: c.dailyLimit,
  senderId: c.senderId || null, senderName,
  status: c.status, statusNote: c.statusNote, nextSendAt: c.nextSendAt, startedAt: c.startedAt, finishedAt: c.finishedAt, createdAt: c.createdAt,
  counts: counts || { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 },
});

// ── sender numbers ────────────────────────────────────────────────────────────────────────────────────────────
const READY = ['authorized', 'linked', 'starting'];   // a number that can send now (linked = saved login, the connection opens with the first message)
const embedded = () => wa.engineName() === 'embedded';
const NOT_EMBEDDED = 'Toplu gönderici numaralar yalnızca yerleşik WhatsApp bağlantısıyla çalışır; bu sunucuda WAHA ayarlı.';

/** { id, name, state, status, message, ready, sentToday } - asked without opening any connection. */
async function senderView(sender, storeId) {
  const [st, sentToday] = await Promise.all([getRegistry().get(sender.id).peekStatus(), sentTodayFor(prisma, storeId, Date.now(), sender.id)]);
  return { id: sender.id, name: sender.name, state: st.stateInstance, status: st.wahaStatus || null, message: st.message || '', ready: READY.includes(st.stateInstance), sentToday };
}
async function senderViews(storeId) {
  const list = await prisma.whatsappSender.findMany({ where: { storeId }, orderBy: { createdAt: 'asc' } });
  return Promise.all(list.map((x) => senderView(x, storeId)));
}
async function senderOf(req) {
  const store = await storeOf(req);
  const sender = await prisma.whatsappSender.findFirst({ where: { id: req.params.id, storeId: store.id } });
  if (!sender) throw fail(404, 'Gönderici bulunamadı');
  return { store, sender };
}
/** A sender id from a request body: null / undefined = none, otherwise it must be one of this store's numbers. */
async function readSender(storeId, value) {
  if (value === undefined || value === null || value === '') return { senderId: null };
  const sender = await prisma.whatsappSender.findFirst({ where: { id: String(value), storeId }, select: { id: true } });
  return sender ? { senderId: sender.id } : { error: 'Gönderici numara bulunamadı' };
}
async function senderNames(storeId) {
  const list = await prisma.whatsappSender.findMany({ where: { storeId }, select: { id: true, name: true } });
  return new Map(list.map((x) => [x.id, x.name]));
}

/** The settings of a campaign from a request body, or an error sentence. */
function readSettings(body, current = {}) {
  const pick = (k) => (body[k] !== undefined ? body[k] : current[k]);
  const name = String(pick('name') ?? '').trim();
  const message = String(pick('message') ?? '').replace(/\r\n/g, '\n').trim();
  const min = Number(pick('minDelaySec')); const max = Number(pick('maxDelaySec'));
  const daily = pick('dailyLimit') === undefined || pick('dailyLimit') === null || pick('dailyLimit') === '' ? 0 : Number(pick('dailyLimit'));
  if (!name) return { error: 'Kampanyaya bir ad verin' };
  if (name.length > MAX_NAME) return { error: `Kampanya adı en fazla ${MAX_NAME} karakter olabilir` };
  if (!message) return { error: 'Mesaj boş olamaz' };
  if (message.length > MAX_MESSAGE) return { error: `Mesaj en fazla ${MAX_MESSAGE} karakter olabilir` };
  if (!Number.isInteger(min) || !Number.isInteger(max)) return { error: 'En az ve en çok bekleme süresini tam saniye olarak yazın (ör. 12 ve 20)' };
  if (min < MIN_DELAY_FLOOR_SEC) return { error: `Mesajlar arası bekleme en az ${MIN_DELAY_FLOOR_SEC} saniye olmalı (daha sık gönderim WhatsApp’ın numarayı kapatmasına yol açar)` };
  if (max < min) return { error: 'En çok süre, en az süreden küçük olamaz' };
  if (max > MAX_DELAY_CEIL_SEC) return { error: `En çok bekleme ${MAX_DELAY_CEIL_SEC} saniyeyi (1 saat) geçemez` };
  if (!Number.isInteger(daily) || daily < 0 || daily > MAX_DAILY) return { error: `Günlük sınır 0 (sınırsız) ile ${MAX_DAILY} arasında bir tam sayı olmalı` };
  return { settings: { name, message, minDelaySec: min, maxDelaySec: max, dailyLimit: daily } };
}

/** Recipients from a request: every number is checked again here (the page's check is only a courtesy). */
function readRecipients(list) {
  if (!Array.isArray(list)) return { error: 'Alıcı listesi gönderilmedi' };
  if (list.length > MAX_ROWS) return { error: `Bir kampanyaya en fazla ${MAX_ROWS} numara eklenebilir` };
  const seen = new Set(); const rows = []; let invalid = 0; let duplicates = 0;
  for (const r of list) {
    const res = cleanPhone(r && r.phone);
    if (!res.phone) { invalid++; continue; }
    if (seen.has(res.phone)) { duplicates++; continue; }
    seen.add(res.phone);
    const vars = {};
    if (r.vars && typeof r.vars === 'object') {
      for (const [k, v] of Object.entries(r.vars).slice(0, 30)) { const key = fold(k); if (key && v != null && String(v).trim()) vars[key] = String(v).trim().slice(0, 200); }
    }
    rows.push({ phone: res.phone, name: String((r && r.name) || '').trim().slice(0, 80) || null, vars });
  }
  return { rows, invalid, duplicates };
}

/** A message may only use {placeholders} that the list has a column for (otherwise the raw "{xyz}" would reach people). */
function unknownPlaceholders(message, rows) {
  const known = new Set([...NAME_ALIASES]);
  for (const r of rows) for (const k of Object.keys(r.vars || {})) known.add(k);
  return placeholdersOf(message).filter((k) => !known.has(k));
}

async function insertRecipients(campaignId, rows, startPosition) {
  let position = startPosition;
  for (let i = 0; i < rows.length; i += 1000) {
    const part = rows.slice(i, i + 1000);
    await prisma.whatsappCampaignRecipient.createMany({
      data: part.map((r) => ({ campaignId, position: position++, phone: r.phone, name: r.name, vars: Object.keys(r.vars).length ? JSON.stringify(r.vars) : null })),
      skipDuplicates: true,
    });
  }
}

// ── overview ───────────────────────────────────────────────────────────────────────────────────────────────
router.get('/overview', async (req, res, next) => {
  try {
    const store = await storeOf(req);
    const [senders, running] = await Promise.all([
      embedded() ? senderViews(store.id) : [],
      prisma.whatsappCampaign.findFirst({ where: { storeId: store.id, status: 'running' }, select: { id: true, name: true } }),
    ]);
    res.json({
      engine: wa.engineName(), senders, maxSenders: MAX_SENDERS, running,
      limits: { minDelayFloorSec: MIN_DELAY_FLOOR_SEC, maxDelayCeilSec: MAX_DELAY_CEIL_SEC, maxRecipients: MAX_ROWS, maxMessage: MAX_MESSAGE, maxDaily: MAX_DAILY },
      defaults: DEFAULTS,
    });
  } catch (err) { next(err); }
});

// ── senders: link a number with its own QR ─────────────────────────────────────────────────────────────────
router.get('/senders', async (req, res, next) => {
  try { const store = await storeOf(req); res.json(embedded() ? await senderViews(store.id) : []); } catch (err) { next(err); }
});

router.post('/senders', async (req, res, next) => {
  try {
    if (!embedded()) return res.status(409).json({ error: NOT_EMBEDDED });
    const store = await storeOf(req);
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return send400(res, 'Numaraya bir ad verin (ör. “Kampanya hattı”)');
    if (name.length > 60) return send400(res, 'Ad en fazla 60 karakter olabilir');
    const have = await prisma.whatsappSender.count({ where: { storeId: store.id } });
    if (have >= MAX_SENDERS) return send400(res, `En fazla ${MAX_SENDERS} gönderici numara eklenebilir (her bağlı numara sunucu belleği kullanır). Birini silip yenisini ekleyin.`);
    const created = await prisma.whatsappSender.create({ data: { storeId: store.id, name } });
    res.json(await senderView(created, store.id));
  } catch (err) { next(err); }
});

router.put('/senders/:id', async (req, res, next) => {
  try {
    const { store, sender } = await senderOf(req);
    const name = String((req.body && req.body.name) || '').trim();
    if (!name || name.length > 60) return send400(res, 'Ad 1-60 karakter olmalı');
    const updated = await prisma.whatsappSender.update({ where: { id: sender.id }, data: { name } });
    res.json(await senderView(updated, store.id));
  } catch (err) { next(err); }
});

// Status / QR of ONE sender (the QR panel calls them while it waits for the scan; unlike the list they may bring the connection up)
router.get('/senders/:id/status', async (req, res, next) => {
  try {
    const { sender } = await senderOf(req);
    if (!embedded()) return res.json({ stateInstance: 'error', message: NOT_EMBEDDED });
    res.json(await getRegistry().get(sender.id).getStatus());
  } catch (err) { next(err); }
});

router.get('/senders/:id/qr', async (req, res, next) => {
  try {
    const { sender } = await senderOf(req);
    if (!embedded()) return res.json({ type: 'error', message: NOT_EMBEDDED });
    const data = await getRegistry().get(sender.id).getQR();
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); res.set('Pragma', 'no-cache');
    res.json(data);
  } catch (err) { next(err); }
});

async function runningWith(senderId) {
  return prisma.whatsappCampaign.findFirst({ where: { senderId, status: 'running' }, select: { name: true } });
}

// Unlink: the phone is logged out of this number's WhatsApp link and the saved login is deleted (the sender itself stays and can be linked again)
router.post('/senders/:id/logout', async (req, res, next) => {
  try {
    const { sender } = await senderOf(req);
    const busy = await runningWith(sender.id);
    if (busy) return res.status(409).json({ error: `“${busy.name}” kampanyası bu numarayla çalışıyor. Önce duraklatın.` });
    await getRegistry().get(sender.id).logout();
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/senders/:id', async (req, res, next) => {
  try {
    const { sender } = await senderOf(req);
    const busy = await runningWith(sender.id);
    if (busy) return res.status(409).json({ error: `“${busy.name}” kampanyası bu numarayla çalışıyor. Önce duraklatın.` });
    await getRegistry().remove(sender.id).catch(() => {});
    await prisma.whatsappSender.delete({ where: { id: sender.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── reading a list (nothing is saved) ──────────────────────────────────────────────────────────────────────────
router.post('/parse', (req, res) => {
  const text = req.body && req.body.text;
  if (typeof text !== 'string' || !text.trim()) return send400(res, 'Liste boş. Numaraları yazın ya da bir CSV dosyası seçin.');
  if (text.length > 3_000_000) return send400(res, 'Dosya çok büyük. Bir seferde en fazla 5.000 numara alınır.');
  if (/^PK\u0003\u0004/.test(text)) return send400(res, 'Bu bir Excel (.xlsx) dosyası. Excel’de “Farklı Kaydet > CSV” ile kaydedip CSV dosyasını seçin.');
  const parsed = parseList(text);
  if (parsed.tooMany) return send400(res, `Dosyada ${parsed.tooMany} satır var; bir kampanyaya en fazla ${MAX_ROWS} numara eklenebilir. Dosyayı bölün.`);
  if (parsed.total === 0) return send400(res, 'Listede numara bulunamadı.');
  res.json(parsed);
});

// ── campaigns ───────────────────────────────────────────────────────────────────────────────────────────────
router.get('/campaigns', async (req, res, next) => {
  try {
    const store = await storeOf(req);
    const list = await prisma.whatsappCampaign.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const [counts, names] = await Promise.all([countsFor(list.map((c) => c.id)), senderNames(store.id)]);
    res.json(list.map((c) => shape(c, counts.get(c.id), names.get(c.senderId) || null)));
  } catch (err) { next(err); }
});

router.post('/campaigns', async (req, res, next) => {
  try {
    const store = await storeOf(req);
    const s = readSettings(req.body || {});
    if (s.error) return send400(res, s.error);
    const r = readRecipients(req.body && req.body.recipients);
    if (r.error) return send400(res, r.error);
    if (r.rows.length === 0) return send400(res, 'Geçerli numara yok. Numaraları ülke koduyla (905XXXXXXXXX) ya da 05XX biçiminde yazın.');
    const unknown = unknownPlaceholders(s.settings.message, r.rows);
    if (unknown.length) return send400(res, `Mesajda {${unknown[0]}} yazıyor ama listede bu adda bir sütun yok. Sütun adlarıyla aynı yazın (ör. {ad}).`);

    const sd = await readSender(store.id, req.body && req.body.senderId);
    if (sd.error) return send400(res, sd.error);
    const created = await prisma.whatsappCampaign.create({ data: { storeId: store.id, senderId: sd.senderId, ...s.settings } });
    await insertRecipients(created.id, r.rows, 1);
    const [counts, names] = await Promise.all([countsFor([created.id]), senderNames(store.id)]);
    res.json({ ...shape(created, counts.get(created.id), names.get(created.senderId) || null), skipped: { invalid: r.invalid, duplicates: r.duplicates } });
  } catch (err) { next(err); }
});

router.get('/campaigns/:id', async (req, res, next) => {
  try {
    const store = await storeOf(req);
    const c = await campaignOf(req);
    const [counts, sender, first, lastSent] = await Promise.all([
      countsFor([c.id]),
      c.senderId && embedded() ? prisma.whatsappSender.findFirst({ where: { id: c.senderId, storeId: store.id } }).then((x) => (x ? senderView(x, store.id) : null)) : null,
      prisma.whatsappCampaignRecipient.findMany({ where: { campaignId: c.id }, orderBy: { position: 'asc' }, take: 3 }),
      prisma.whatsappCampaignRecipient.findMany({ where: { campaignId: c.id, status: 'sent' }, orderBy: { sentAt: 'desc' }, take: 200, select: { sentAt: true } }),
    ]);
    if (c.status === 'running') getRunner().ensure();
    res.json({
      ...shape(c, counts.get(c.id), sender && sender.name), sender, sentToday: sender ? sender.sentToday : 0,
      observed: gapStats(lastSent.map((x) => x.sentAt), c.maxDelaySec),   // the pauses that really happened (last 200 messages)
      preview: first.map((r) => ({ phone: r.phone, name: r.name, text: renderMessage(c.message, { name: r.name, vars: parseVars(r.vars) }) })),
    });
  } catch (err) { next(err); }
});

router.get('/campaigns/:id/recipients', async (req, res, next) => {
  try {
    const c = await campaignOf(req);
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const where = { campaignId: c.id, ...(status ? { status } : {}) };
    const [total, rows] = await Promise.all([
      prisma.whatsappCampaignRecipient.count({ where }),
      prisma.whatsappCampaignRecipient.findMany({ where, orderBy: { position: 'asc' }, skip: (page - 1) * limit, take: limit, select: { id: true, position: true, phone: true, name: true, status: true, error: true, sentAt: true } }),
    ]);
    res.json({ total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), recipients: rows });
  } catch (err) { next(err); }
});

router.put('/campaigns/:id', async (req, res, next) => {
  try {
    const c = await campaignOf(req);
    if (!['draft', 'paused'].includes(c.status)) return res.status(409).json({ error: c.status === 'running' ? 'Çalışan kampanya düzenlenemez. Önce duraklatın.' : 'Biten kampanya düzenlenemez.' });
    const s = readSettings(req.body || {}, c);
    if (s.error) return send400(res, s.error);
    if (s.settings.message !== c.message) {
      const sample = await prisma.whatsappCampaignRecipient.findMany({ where: { campaignId: c.id }, select: { vars: true }, take: 500 });
      const unknown = unknownPlaceholders(s.settings.message, sample.map((x) => ({ vars: parseVars(x.vars) })));
      if (unknown.length) return send400(res, `Mesajda {${unknown[0]}} yazıyor ama listede bu adda bir sütun yok.`);
    }
    const data = { ...s.settings };
    if (req.body && 'senderId' in req.body) {
      const sd = await readSender(c.storeId, req.body.senderId);
      if (sd.error) return send400(res, sd.error);
      data.senderId = sd.senderId;
    }
    const updated = await prisma.whatsappCampaign.update({ where: { id: c.id }, data });
    const [counts, names] = await Promise.all([countsFor([c.id]), senderNames(c.storeId)]);
    res.json(shape(updated, counts.get(c.id), names.get(updated.senderId) || null));
  } catch (err) { next(err); }
});

router.post('/campaigns/:id/recipients', async (req, res, next) => {
  try {
    const c = await campaignOf(req);
    if (c.status === 'running') return res.status(409).json({ error: 'Çalışan kampanyaya numara eklenemez. Önce duraklatın.' });
    const r = readRecipients(req.body && req.body.recipients);
    if (r.error) return send400(res, r.error);
    const have = await prisma.whatsappCampaignRecipient.findMany({ where: { campaignId: c.id }, select: { phone: true, position: true } });
    const existing = new Set(have.map((x) => x.phone));
    const fresh = r.rows.filter((x) => !existing.has(x.phone));
    if (have.length + fresh.length > MAX_ROWS) return send400(res, `Bir kampanyada en fazla ${MAX_ROWS} numara olabilir.`);
    if (fresh.length === 0) return send400(res, 'Eklenecek yeni numara yok (hepsi listede var ya da geçersiz).');
    const unknown = unknownPlaceholders(c.message, fresh);
    const lastPos = have.reduce((m, x) => Math.max(m, x.position), 0);
    await insertRecipients(c.id, fresh, lastPos + 1);
    if (c.status === 'done') await prisma.whatsappCampaign.update({ where: { id: c.id }, data: { status: 'paused', finishedAt: null } });
    const counts = await countsFor([c.id]);
    res.json({ added: fresh.length, skipped: { invalid: r.invalid, duplicates: r.duplicates + (r.rows.length - fresh.length) }, counts: counts.get(c.id), missingColumns: unknown });
  } catch (err) { next(err); }
});

router.post('/campaigns/:id/start', async (req, res, next) => {
  try {
    const store = await storeOf(req);
    const c = await campaignOf(req);
    if (c.status === 'running') return res.status(409).json({ error: 'Kampanya zaten çalışıyor.' });
    if (c.status === 'done') return res.status(409).json({ error: 'Bu kampanya bitti. Başarısız olanları yeniden denemek için “Başarısızları yeniden dene”yi kullanın.' });
    if (!embedded()) return res.status(409).json({ error: NOT_EMBEDDED });
    const sender = c.senderId ? await prisma.whatsappSender.findFirst({ where: { id: c.senderId, storeId: store.id } }) : null;
    if (!sender) return res.status(409).json({ error: 'Bu kampanya için gönderici numara seçilmemiş. “Düzenle” ile bir gönderici seçin (numara yoksa önce üstten ekleyip QR ile bağlayın).' });
    const other = await prisma.whatsappCampaign.findFirst({ where: { senderId: sender.id, status: 'running', id: { not: c.id } }, select: { name: true } });
    if (other) return res.status(409).json({ error: `“${other.name}” kampanyası “${sender.name}” numarasıyla çalışıyor. Bir numara aynı anda tek kampanya gönderir; önce onu duraklatın ya da başka bir numara seçin.` });
    const counts = (await countsFor([c.id])).get(c.id);
    if (counts.pending === 0) return res.status(409).json({ error: 'Gönderilecek numara kalmadı.' });
    const st = await getRegistry().get(sender.id).peekStatus();
    if (!READY.includes(st.stateInstance)) {
      return res.status(409).json({ error: `“${sender.name}” numarası bağlı değil. ${st.message || 'QR kodunu okutup telefonu bağlayın.'}` });
    }
    const updated = await prisma.whatsappCampaign.update({ where: { id: c.id }, data: { status: 'running', startedAt: c.startedAt || new Date(), finishedAt: null, nextSendAt: null, statusNote: null } });
    getRunner().kick();
    res.json(shape(updated, counts, sender.name));
  } catch (err) { next(err); }
});

router.post('/campaigns/:id/pause', async (req, res, next) => {
  try {
    const c = await campaignOf(req);
    if (c.status !== 'running') return res.status(409).json({ error: 'Kampanya çalışmıyor.' });
    await prisma.whatsappCampaign.updateMany({ where: { id: c.id, status: 'running' }, data: { status: 'paused', nextSendAt: null, statusNote: null } });
    const updated = await prisma.whatsappCampaign.findUnique({ where: { id: c.id } });
    const counts = await countsFor([c.id]);
    res.json(shape(updated, counts.get(c.id)));
  } catch (err) { next(err); }
});

router.post('/campaigns/:id/retry-failed', async (req, res, next) => {
  try {
    const c = await campaignOf(req);
    const r = await prisma.whatsappCampaignRecipient.updateMany({ where: { campaignId: c.id, status: 'failed' }, data: { status: 'pending', error: null } });
    if (r.count > 0 && c.status === 'done') await prisma.whatsappCampaign.update({ where: { id: c.id }, data: { status: 'paused', finishedAt: null } });
    const updated = await prisma.whatsappCampaign.findUnique({ where: { id: c.id } });
    const counts = await countsFor([c.id]);
    res.json({ requeued: r.count, campaign: shape(updated, counts.get(c.id)) });
  } catch (err) { next(err); }
});

router.delete('/campaigns/:id', async (req, res, next) => {
  try {
    const c = await campaignOf(req);
    if (c.status === 'running') return res.status(409).json({ error: 'Çalışan kampanya silinemez. Önce duraklatın.' });
    await prisma.whatsappCampaign.delete({ where: { id: c.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Errors raised here with a sentence meant for the admin are shown as they are
router.use((err, _req, res, next) => {
  if (err && err.expose && err.status) return res.status(err.status).json({ error: err.message });
  next(err);
});

module.exports = router;
