// Canned answers of the bulk WhatsApp API for the smoke test. The list reading is the REAL server code (bulkCsv.js), so the page
// is tested against what the server really answers for a CSV; the campaign itself lives in this object.
const { parseList } = require('../../../server/src/services/whatsapp/bulkCsv');

const bulk = {
  engine: 'embedded',
  senders: [],        // [{ id, name, state, status, message, ready, sentToday }] - the numbers linked on the page (not the platform's own)
  qr: { type: 'loading', message: 'QR hazırlanıyor.' }, qrCalls: 0, linked: false,   // what the QR / status calls of a sender answer
  sentToday: 3,
  c: null,            // the one campaign of the test: { id, name, message, minDelaySec, ..., status, statusNote, nextSendAt }
  recipients: [],     // [{ id, position, phone, name, status, error, sentAt }]
  progressOnRead: true,   // while running, every read of the campaign sends one more number (plays the server)
};
const counts = () => {
  const o = { pending: 0, sending: 0, sent: 0, failed: 0, total: bulk.recipients.length };
  bulk.recipients.forEach((r) => { o[r.status]++; });
  return o;
};
const senderOf = (id) => bulk.senders.find((x) => x.id === id) || null;
const shape = () => ({ ...bulk.c, senderName: (senderOf(bulk.c.senderId) || {}).name || null, counts: counts() });
const fail = (status, error) => { const e = new Error(error); e.response = { status, data: { error } }; throw e; };

function handle(method, url, body, cfg) {
  if (!url.startsWith('/whatsapp-bulk')) return null;
  const path = url.replace('/whatsapp-bulk', '');
  const m = /^\/campaigns\/([^/]+)(\/[a-z-]+)?$/.exec(path);

  if (method === 'GET' && path === '/overview') {
    return { data: { engine: bulk.engine, senders: bulk.senders, maxSenders: 3, running: bulk.c && bulk.c.status === 'running' ? { id: bulk.c.id, name: bulk.c.name } : null,
      limits: { minDelayFloorSec: 5, maxDelayCeilSec: 3600, maxRecipients: 5000, maxMessage: 4000, maxDaily: 5000 }, defaults: { minDelaySec: 12, maxDelaySec: 20, dailyLimit: 250 } } };
  }
  const sm = /^\/senders(?:\/([^/]+)(\/[a-z]+)?)?$/.exec(path);
  if (sm) {
    const sender = sm[1] ? senderOf(sm[1]) : null; const sub = sm[2] || '';
    if (method === 'POST' && !sm[1]) {
      if (!String(body.name || '').trim()) fail(400, 'Numaraya bir ad verin');
      const x = { id: 's' + (bulk.senders.length + 1), name: body.name, state: 'notAuthorized', status: 'NOT_LINKED', message: 'Henüz bağlanmadı. “QR kodu göster” ile telefonunuzu bağlayın.', ready: false, sentToday: 0 };
      bulk.senders.push(x); return { data: x };
    }
    if (!sender) return null;
    if (method === 'GET' && sub === '/qr') { bulk.qrCalls++; return { data: typeof bulk.qr === 'function' ? bulk.qr(bulk.qrCalls) : bulk.qr }; }
    if (method === 'GET' && sub === '/status') {
      if (bulk.linked) Object.assign(sender, { state: 'authorized', status: 'WORKING', message: 'Bağlı numara: ••••4567', ready: true });
      return { data: { stateInstance: bulk.linked ? 'authorized' : 'notAuthorized' } };
    }
    if (method === 'POST' && sub === '/logout') { Object.assign(sender, { state: 'notAuthorized', status: 'NOT_LINKED', message: 'Henüz bağlanmadı.', ready: false }); bulk.linked = false; return { data: { success: true } }; }
    if (method === 'DELETE' && sub === '') { bulk.senders = bulk.senders.filter((x) => x.id !== sender.id); if (bulk.c && bulk.c.senderId === sender.id) bulk.c.senderId = null; return { data: { success: true } }; }
  }
  if (method === 'POST' && path === '/parse') {
    if (!String(body.text || '').trim()) fail(400, 'Liste boş. Numaraları yazın ya da bir CSV dosyası seçin.');
    return { data: parseList(body.text) };
  }
  if (method === 'GET' && path === '/campaigns') return { data: bulk.c ? [shape()] : [] };
  if (method === 'POST' && path === '/campaigns') {
    if (bulk.createError) fail(400, bulk.createError);
    bulk.c = { id: 'k1', name: body.name, senderId: body.senderId || null, message: body.message, minDelaySec: body.minDelaySec, maxDelaySec: body.maxDelaySec, dailyLimit: body.dailyLimit, status: 'draft', statusNote: null, nextSendAt: null };
    bulk.recipients = body.recipients.map((r, i) => ({ id: 'r' + (i + 1), position: i + 1, phone: r.phone, name: r.name || null, status: 'pending', error: null, sentAt: null }));
    return { data: { ...shape(), skipped: { invalid: 0, duplicates: 0 } } };
  }
  if (!m || !bulk.c) return null;
  const sub = m[2] || '';
  if (method === 'GET' && sub === '') {
    if (bulk.c.status === 'running' && bulk.progressOnRead) {
      const next = bulk.recipients.find((r) => r.status === 'pending');
      if (next) { next.status = 'sent'; next.sentAt = new Date().toISOString(); }
      bulk.c.nextSendAt = new Date(Date.now() + 14000).toISOString();
      if (!bulk.recipients.some((r) => r.status === 'pending')) { bulk.c.status = 'done'; bulk.c.nextSendAt = null; }
    }
    return { data: { ...shape(), sender: senderOf(bulk.c.senderId), sentToday: (senderOf(bulk.c.senderId) || {}).sentToday || 0, observed: bulk.observed || null, preview: bulk.recipients.slice(0, 3).map((r) => ({ phone: r.phone, name: r.name, text: bulk.c.message.replace(/\{ad\}/g, r.name || '') })) } };
  }
  if (method === 'GET' && sub === '/recipients') {
    const st = cfg && cfg.params && cfg.params.status;
    const rows = bulk.recipients.filter((r) => !st || r.status === st);
    return { data: { total: rows.length, page: 1, limit: 50, totalPages: 1, recipients: rows } };
  }
  if (method === 'PUT' && sub === '') { Object.assign(bulk.c, body); return { data: shape() }; }
  if (method === 'POST' && sub === '/start') {
    const snd = senderOf(bulk.c.senderId);
    if (!snd) fail(409, 'Bu kampanya için gönderici numara seçilmemiş.');
    if (!snd.ready) fail(409, `“${snd.name}” numarası bağlı değil. ${snd.message}`);
    if (bulk.startError) fail(409, bulk.startError);
    bulk.c.status = 'running'; return { data: shape() };
  }
  if (method === 'POST' && sub === '/pause') { bulk.c.status = 'paused'; bulk.c.nextSendAt = null; return { data: shape() }; }
  if (method === 'POST' && sub === '/retry-failed') {
    const n = bulk.recipients.filter((r) => r.status === 'failed').length;
    bulk.recipients.forEach((r) => { if (r.status === 'failed') { r.status = 'pending'; r.error = null; } });
    if (n && bulk.c.status === 'done') bulk.c.status = 'paused';
    return { data: { requeued: n, campaign: shape() } };
  }
  if (method === 'POST' && sub === '/recipients') {
    body.recipients.forEach((r) => bulk.recipients.push({ id: 'r' + (bulk.recipients.length + 1), position: bulk.recipients.length + 1, phone: r.phone, name: r.name || null, status: 'pending', error: null, sentAt: null }));
    return { data: { added: body.recipients.length, skipped: { invalid: 0, duplicates: 0 }, counts: counts(), missingColumns: [] } };
  }
  if (method === 'DELETE' && sub === '') { bulk.c = null; bulk.recipients = []; return { data: { success: true } }; }
  return null;
}

module.exports = { bulk, handle };
