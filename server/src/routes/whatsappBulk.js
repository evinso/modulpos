const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const { ownedParam } = require('../middleware/ownership');
const wa = require('../services/whatsapp');
const { parseList, cleanPhone, renderMessage, placeholdersOf, fold, NAME_ALIASES, MAX_ROWS } = require('../services/whatsapp/bulkCsv');
const { getRunner, sentTodayFor, parseVars, gapStats, MIN_DELAY_FLOOR_SEC, MAX_DELAY_CEIL_SEC } = require('../services/whatsapp/bulkRunner');

/**
 * Bulk WhatsApp (admin only): a message to a list of numbers, one after another with a random pause between a minimum and a maximum
 * number of seconds. The list can be typed / pasted or imported from a CSV file. The sending itself is done by services/whatsapp/bulkRunner.js.
 */
const router = express.Router();
router.use(auth);
router.use((req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  next();
});
router.param('id', ownedParam('whatsappCampaign'));

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

const shape = (c, counts) => ({
  id: c.id, name: c.name, message: c.message, minDelaySec: c.minDelaySec, maxDelaySec: c.maxDelaySec, dailyLimit: c.dailyLimit,
  status: c.status, statusNote: c.statusNote, nextSendAt: c.nextSendAt, startedAt: c.startedAt, finishedAt: c.finishedAt, createdAt: c.createdAt,
  counts: counts || { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 },
});

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

async function connectionState() {
  try {
    const row = await prisma.systemSettings.findUnique({ where: { key: 'waha_session' } }).catch(() => null);
    const s = await wa.createClient((row && row.value) || 'default').getStatus();
    return { state: s.stateInstance || 'unknown', message: s.message || '' };
  } catch (err) { return { state: 'error', message: wa.describeError(err) }; }
}

// ── overview ───────────────────────────────────────────────────────────────────────────────────────────────
router.get('/overview', async (req, res, next) => {
  try {
    const store = await storeOf(req);
    const [connection, sentToday, running] = await Promise.all([
      connectionState(), sentTodayFor(prisma, store.id),
      prisma.whatsappCampaign.findFirst({ where: { storeId: store.id, status: 'running' }, select: { id: true, name: true } }),
    ]);
    res.json({
      connection, engine: wa.engineName(), sentToday, running,
      limits: { minDelayFloorSec: MIN_DELAY_FLOOR_SEC, maxDelayCeilSec: MAX_DELAY_CEIL_SEC, maxRecipients: MAX_ROWS, maxMessage: MAX_MESSAGE, maxDaily: MAX_DAILY },
      defaults: DEFAULTS,
    });
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
    const counts = await countsFor(list.map((c) => c.id));
    res.json(list.map((c) => shape(c, counts.get(c.id))));
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

    const created = await prisma.whatsappCampaign.create({ data: { storeId: store.id, ...s.settings } });
    await insertRecipients(created.id, r.rows, 1);
    const counts = await countsFor([created.id]);
    res.json({ ...shape(created, counts.get(created.id)), skipped: { invalid: r.invalid, duplicates: r.duplicates } });
  } catch (err) { next(err); }
});

router.get('/campaigns/:id', async (req, res, next) => {
  try {
    const store = await storeOf(req);
    const c = await campaignOf(req);
    const [counts, sentToday, first, lastSent] = await Promise.all([
      countsFor([c.id]), sentTodayFor(prisma, store.id),
      prisma.whatsappCampaignRecipient.findMany({ where: { campaignId: c.id }, orderBy: { position: 'asc' }, take: 3 }),
      prisma.whatsappCampaignRecipient.findMany({ where: { campaignId: c.id, status: 'sent' }, orderBy: { sentAt: 'desc' }, take: 200, select: { sentAt: true } }),
    ]);
    if (c.status === 'running') getRunner().ensure();
    res.json({
      ...shape(c, counts.get(c.id)), sentToday,
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
    const updated = await prisma.whatsappCampaign.update({ where: { id: c.id }, data: s.settings });
    const counts = await countsFor([c.id]);
    res.json(shape(updated, counts.get(c.id)));
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
    const other = await prisma.whatsappCampaign.findFirst({ where: { storeId: store.id, status: 'running', id: { not: c.id } }, select: { name: true } });
    if (other) return res.status(409).json({ error: `“${other.name}” kampanyası çalışıyor. Numara tek olduğu için aynı anda yalnızca bir kampanya gönderir; önce onu duraklatın.` });
    const counts = (await countsFor([c.id])).get(c.id);
    if (counts.pending === 0) return res.status(409).json({ error: 'Gönderilecek numara kalmadı.' });
    const conn = await connectionState();
    if (!['authorized', 'starting'].includes(conn.state)) {
      return res.status(409).json({ error: conn.message || 'WhatsApp bağlı değil. WhatsApp sayfasında QR kodu okutup telefonu bağlayın, sonra tekrar deneyin.' });
    }
    const updated = await prisma.whatsappCampaign.update({ where: { id: c.id }, data: { status: 'running', startedAt: c.startedAt || new Date(), finishedAt: null, nextSendAt: null, statusNote: null } });
    getRunner().kick();
    res.json(shape(updated, counts));
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
