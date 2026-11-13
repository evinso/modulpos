// Built-in WhatsApp connection: the API itself is the linked device (Baileys), so no separate WAHA server is needed.
// Same surface as WahaService (getStatus / getQR / sendMessage / logout / reboot), so the page and the notification code do not care.
//
// Why it fits the free hosting: every message is produced by the API itself, i.e. while the API is awake. The login is stored in the
// database (authStore.js), so a sleep or a deploy does not unlink the phone; the connection is opened lazily when something needs it.
//
// Nothing here reads incoming chats. One linked number for the whole platform (the admin's); users only receive messages.
const WahaService = require('./wahaService');
const { createDbStore, useStoreAuthState, storeIsLinked } = require('./authStore');

/** An error whose message is meant to be shown to the admin as it is. */
class WhatsappError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'WhatsappError'; this.status = status; this.userMessage = message; }
}

const BACKOFF_MS = [1000, 3000, 8000, 20000, 45000, 90000];   // reconnect attempts after a dropped connection
const MIN_GAP_MS = 1500;          // between two messages (looks less like a bot, gentler on the number)
const MAX_PER_HOUR = 120;         // safety valve: a runaway loop must not get the number blocked
const CONNECT_WAIT_MS = 25000;    // how long a send waits for the connection to come up
const { installQuietSignal } = require('./quietSignal');
const QR_WAIT_MS = 12000;
const POLL_MS = 250;
const VERSION_TTL_MS = 6 * 60 * 60 * 1000;

/** Baileys wants a pino-like logger; keep it quiet and only surface real errors. */
function makeLogger() {
  const noop = () => {};
  const brief = (a) => (a && typeof a === 'object' ? (a.err?.message || a.message || a.msg || '') : String(a ?? ''));
  const log = {
    level: 'silent', trace: noop, debug: noop, info: noop, warn: noop,
    error: (...a) => console.error('[WhatsApp]', ...a.map(brief).filter(Boolean)),
    fatal: (...a) => console.error('[WhatsApp]', ...a.map(brief).filter(Boolean)),
    child: () => log,
  };
  return log;
}

const last4 = (n) => String(n || '').replace(/\D/g, '').slice(-4);
const toJid = (phone) => {
  const n = WahaService.normalizePhone(phone);
  return n.includes('@') ? n.replace('@c.us', '@s.whatsapp.net') : `${n}@s.whatsapp.net`;
};

async function defaultQrToPng(qr) {
  const QRCode = require('qrcode');
  const url = await QRCode.toDataURL(qr, { margin: 2, scale: 6, errorCorrectionLevel: 'M' });
  return url.replace(/^data:image\/png;base64,/, '');
}

class EmbeddedWhatsapp {
  /** Every dependency can be replaced (tests use a fake Baileys, an in-memory store and no real waiting). */
  constructor(deps = {}) {
    this.loadBaileys = deps.loadBaileys || (() => import('@whiskeysockets/baileys'));
    this.store = deps.store || null;                       // created on first use (needs the database client)
    this.qrToPng = deps.qrToPng || defaultQrToPng;
    this.delay = deps.delay || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.schedule = deps.schedule || ((fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; });
    this.now = deps.now || Date.now;
    this.jitter = deps.jitter || (() => Math.floor(Math.random() * 700));
    this.fetchVersion = deps.fetchVersion || null;
    this.log = deps.log || ((...a) => console.log('[WhatsApp]', ...a));

    this.mod = null; this.auth = null; this.sock = null; this.qr = null;
    this.state = 'idle';            // idle | connecting | qr | open | closed
    this.starting = null; this.retryTimer = null; this.attempts = 0; this.wantOnline = false;
    this.lastClose = null;          // { code, reason: 'closed'|'replaced'|'forbidden'|'unlinked', message, at }
    this.sendChain = Promise.resolve(); this.lastSendAt = 0; this.sentAt = [];
    this.saveChain = Promise.resolve();
    this.versionCache = null;
  }

  // ── plumbing ───────────────────────────────────────────────────────────────────────────────────────────
  _store() { if (!this.store) this.store = createDbStore(); return this.store; }

  async _baileys() {
    if (!this.mod) {
      let m;
      try { m = await this.loadBaileys(); }
      catch (err) { throw new WhatsappError(`WhatsApp bileşeni yüklenemedi: ${String(err && err.message || err).slice(0, 120)}`, 500); }
      installQuietSignal();
      this.mod = { ...m, makeWASocket: (m.default && m.default.default) || m.default || m.makeWASocket };
    }
    return this.mod;
  }

  async _loadAuth() {
    if (!this.auth) this.auth = await useStoreAuthState(this._store(), await this._baileys());
    return this.auth;
  }

  async _linked() {
    return this.auth ? this.auth.isLinked() : storeIsLinked(this._store());
  }

  async _version(mod) {
    if (this.versionCache && this.now() - this.versionCache.at < VERSION_TTL_MS) return this.versionCache.version;
    let version;
    try {
      const get = this.fetchVersion || mod.fetchLatestBaileysVersion;
      const r = await Promise.race([get(), new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 8000); if (t.unref) t.unref(); })]);
      version = r && r.version;
    } catch { /* offline GitHub etc.: fall back to the version bundled with Baileys */ }
    if (version) this.versionCache = { version, at: this.now() };
    return version;
  }

  _queueSave() {
    this.saveChain = this.saveChain
      .then(() => (this.auth ? this.auth.saveCreds() : null))
      .catch((err) => console.error('[WhatsApp] giriş bilgisi kaydedilemedi:', err && err.message));
  }

  _endSocket() {
    const s = this.sock; this.sock = null;
    if (s) { try { s.end(undefined); } catch { /* already closed */ } }
  }

  async _waitFor(cond, ms) {
    const steps = Math.ceil(ms / POLL_MS);
    for (let i = 0; i <= steps; i++) {
      if (cond()) return true;
      if (i < steps) await this.delay(POLL_MS);
    }
    return !!cond();
  }

  /** The connection was closed for a reason retrying will not fix (taken over elsewhere / restricted / unlinked). */
  _fatal() { return !!(this.lastClose && this.lastClose.reason !== 'closed'); }

  _notConnected() {
    const r = this.lastClose && this.lastClose.reason;
    if (r === 'replaced') return new WhatsappError('WhatsApp bağlantısı başka bir yerde açıldığı için kapandı. Birkaç dakika sonra tekrar denenecek.', 503);
    if (r === 'forbidden') return new WhatsappError('WhatsApp bu numaraya erişimi kısıtlamış görünüyor (403). Numarayı kontrol edin.', 403);
    if (r === 'unlinked') return new WhatsappError('WhatsApp oturumu telefondan kapatılmış. WhatsApp sayfasında yeniden QR okutun.', 409);
    return new WhatsappError('WhatsApp bağlantısı kurulamadı (zaman aşımı). Biraz sonra tekrar denenecek.', 503);
  }

  _accountLabel() {
    const id = this.auth && this.auth.state.creds.me && this.auth.state.creds.me.id;
    return id ? `Bağlı numara: ••••${last4(String(id).split(':')[0].split('@')[0])}` : '';
  }

  // ── connection life cycle ──────────────────────────────────────────────────────────────────────────────
  /** Opens the connection unless one is already open / opening. Resolves once the socket exists, not once it is online. */
  _start() {
    if (this.starting) return this.starting;
    if (this.sock && ['connecting', 'qr', 'open'].includes(this.state)) return Promise.resolve();
    this.starting = (async () => {
      try {
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
        const mod = await this._baileys();
        const auth = await this._loadAuth();
        const version = await this._version(mod);
        const logger = makeLogger();
        this.state = 'connecting'; this.qr = null; this.lastClose = null;
        const sock = mod.makeWASocket({
          ...(version ? { version } : {}),
          // the same live creds object is reused for a restart, so a login that has not reached the database yet is not lost
          auth: { creds: auth.state.creds, keys: mod.makeCacheableSignalKeyStore(auth.state.keys, logger) },
          logger,
          browser: mod.Browsers.ubuntu('Chrome'),
          syncFullHistory: false,
          shouldSyncHistoryMessage: () => false,
          markOnlineOnConnect: false,
          generateHighQualityLinkPreview: false,
          defaultQueryTimeoutMs: 30000,
          getMessage: async () => undefined,
        });
        this.sock = sock;
        sock.ev.on('creds.update', () => { if (this.sock === sock) this._queueSave(); });
        sock.ev.on('connection.update', (u) => { if (this.sock === sock) this._onUpdate(u); });
      } catch (err) {
        this.state = this.sock ? this.state : 'idle';
        throw err;
      } finally { this.starting = null; }
    })();
    return this.starting;
  }

  _onUpdate(u) {
    try {
      if (u.qr) { this.qr = u.qr; this.state = 'qr'; }
      if (u.connection === 'open') {
        this.state = 'open'; this.qr = null; this.attempts = 0; this.wantOnline = true; this.lastClose = null;
        this.log('bağlandı', this._accountLabel());
      } else if (u.connection === 'close') {
        this._onClose(u.lastDisconnect && u.lastDisconnect.error);
      }
    } catch (err) { console.error('[WhatsApp] olay işlenemedi:', err && err.message); }
  }

  _onClose(err) {
    const R = (this.mod && this.mod.DisconnectReason) || {};
    const code = err && err.output && err.output.statusCode;
    const message = String((err && err.message) || '').slice(0, 160);
    this.sock = null; this.qr = null; this.state = 'closed';
    this.lastClose = { code, reason: 'closed', message, at: this.now() };
    this.log('bağlantı kapandı', code, message);

    if (code === R.loggedOut || code === R.badSession) { this._unlink(); return; }                // phone removed the device / broken login
    if (code === R.restartRequired) { this._start().catch((e) => console.error('[WhatsApp]', e.message)); return; }   // normal right after the QR scan
    if (code === R.connectionReplaced) { this.lastClose.reason = 'replaced'; this.wantOnline = false; return; }
    if (code === R.forbidden) { this.lastClose.reason = 'forbidden'; this.wantOnline = false; return; }

    if (this.wantOnline && this.attempts < BACKOFF_MS.length) {
      const wait = BACKOFF_MS[this.attempts++];
      this.log(`${wait / 1000} sn sonra yeniden bağlanılacak (${this.attempts}/${BACKOFF_MS.length})`);
      this.retryTimer = this.schedule(() => { this.retryTimer = null; this._start().catch((e) => console.error('[WhatsApp]', e.message)); }, wait);
    }
  }

  /** The login is no good any more: forget it, so the next QR starts clean. */
  _unlink() {
    this.wantOnline = false; this.auth = null;
    if (this.lastClose) this.lastClose.reason = 'unlinked';
    this._store().clear().catch((e) => console.error('[WhatsApp] oturum silinemedi:', e && e.message));
  }

  // ── what the page and the notification code call ───────────────────────────────────────────────────────
  async getStatus() {
    try {
      if (this.state === 'open') return { stateInstance: 'authorized', wahaStatus: 'WORKING', message: this._accountLabel() };
      if (this.state === 'qr') return { stateInstance: 'notAuthorized', wahaStatus: 'SCAN_QR_CODE' };
      if (this.state === 'connecting') return { stateInstance: 'starting', wahaStatus: 'STARTING', message: 'Bağlanılıyor…' };
      if (await this._linked()) {
        if (this._fatal()) return { stateInstance: 'notAuthorized', wahaStatus: 'FAILED', message: this._notConnected().message };
        // a login is saved but the connection is down (after a sleep / deploy): bring it back in the background
        this.wantOnline = true;
        this._start().catch((e) => console.error('[WhatsApp]', e.message));
        return { stateInstance: 'starting', wahaStatus: 'STARTING', message: 'Kayıtlı WhatsApp oturumuna yeniden bağlanılıyor…' };
      }
      const why = this.lastClose && this.lastClose.reason === 'unlinked' ? this._notConnected().message : '';
      return { stateInstance: 'notAuthorized', wahaStatus: 'NOT_LINKED', message: why || 'Henüz bağlanmadı. “QR Kodu Göster” ile telefonunuzu bağlayın.' };
    } catch (err) {
      return { stateInstance: 'error', message: describe(err) };
    }
  }

  /** { type: 'qrCode', message: <base64 png>, mimetype } | 'alreadyLogged' | 'loading' (call again) | 'error' */
  async getQR() {
    try {
      if (this.state === 'open') return { type: 'alreadyLogged', message: '' };
      if (await this._linked()) {
        // a saved login exists: reconnect it instead of linking a second device for nothing
        this.wantOnline = true;
        await this._start();
        await this._waitFor(() => this.state === 'open' || this._fatal(), 10000);
        if (this.state === 'open') return { type: 'alreadyLogged', message: '' };
        if (await this._linked()) {
          return { type: 'loading', message: this._fatal() ? this._notConnected().message : 'Kayıtlı WhatsApp oturumuna yeniden bağlanılıyor…' };
        }
        // the saved login turned out to be dead and was dropped: fall through and show a QR
      }
      await this._start();
      await this._waitFor(() => !!this.qr || this.state === 'open', QR_WAIT_MS);
      if (this.state === 'open') return { type: 'alreadyLogged', message: '' };
      if (!this.qr) return { type: 'loading', message: 'QR hazırlanıyor. Birkaç saniye içinde burada görünecek.' };
      return { type: 'qrCode', message: await this.qrToPng(this.qr), mimetype: 'image/png' };
    } catch (err) {
      return { type: 'error', message: describe(err) };
    }
  }

  /**
   * Messages go out one at a time with a pause in between, whatever the callers do in parallel.
   * opts.bulk: a message of the bulk page (services/whatsapp/bulkRunner.js). It paces itself (random pause, daily limit), so it neither
   * counts against the hourly safety valve nor is stopped by it: the platform's own notifications keep their whole allowance.
   */
  sendMessage(phone, text, opts = {}) {
    const run = () => this._send(phone, text, opts);
    const p = this.sendChain.then(run, run);
    this.sendChain = p.catch(() => {});
    return p;
  }

  async _send(phone, text, opts = {}) {
    if (!(await this._linked())) throw new WhatsappError('WhatsApp henüz bağlanmadı. WhatsApp sayfasında “QR Kodu Göster” ile telefonunuzu bağlayın.', 409);
    const cutoff = this.now() - 3600000;
    this.sentAt = this.sentAt.filter((t) => t > cutoff);
    if (!opts.bulk && this.sentAt.length >= MAX_PER_HOUR) throw new WhatsappError(`Saatlik mesaj sınırına (${MAX_PER_HOUR}) ulaşıldı. Numarayı korumak için gönderim bir süre durduruldu.`, 429);

    if (this.state !== 'open') {
      this.wantOnline = true;
      await this._start();
      await this._waitFor(() => this.state === 'open' || this._fatal(), CONNECT_WAIT_MS);
      if (this.state !== 'open') throw this._notConnected();
    }
    const wait = this.lastSendAt + MIN_GAP_MS - this.now();
    if (this.lastSendAt && wait > 0) await this.delay(wait + this.jitter());
    if (this.state !== 'open' || !this.sock) throw this._notConnected();

    let jid = toJid(phone);
    try {
      const found = await this.sock.onWhatsApp(jid);
      if (Array.isArray(found) && found[0]) {
        if (found[0].exists === false) throw new WhatsappError(`••••${last4(jid)} numarasında WhatsApp hesabı bulunamadı. Numarayı ülke koduyla (905XXXXXXXXX) yazdığınızdan emin olun.`, 422);
        if (found[0].jid) jid = found[0].jid;
      }
    } catch (err) {
      if (err instanceof WhatsappError) throw err;   // a failed lookup is not a reason to drop the message: just try to send
    }
    let res;
    try { res = await this.sock.sendMessage(jid, { text }); }
    catch (err) { throw new WhatsappError(`WhatsApp mesajı gönderemedi: ${String(err && err.message || err).slice(0, 140)}`, 502); }
    this.lastSendAt = this.now();
    if (!opts.bulk) this.sentAt.push(this.lastSendAt);
    return { idMessage: (res && res.key && res.key.id) || 'sent' };
  }

  async logout() {
    this.wantOnline = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const sock = this.sock;
    if (sock && this.state === 'open') { try { await sock.logout(); } catch { /* already gone */ } }
    this._endSocket();
    this.auth = null; this.qr = null; this.state = 'idle'; this.lastClose = null; this.attempts = 0;
    await this._store().clear();
    return { success: true };
  }

  async reboot() {
    this._endSocket();
    this.qr = null; this.state = 'idle'; this.lastClose = null; this.attempts = 0;
    if (await this._linked()) this.wantOnline = true;
    await this._start();
    return { success: true };
  }
}

/** Text for an error caught while talking to the built-in connection. */
function describe(err) {
  if (err && err.userMessage) return err.userMessage;
  return `WhatsApp hatası: ${String((err && err.message) || err).slice(0, 160)}`;
}

let instance = null;
/** The one shared connection of this process. */
function getEmbedded() {
  if (!instance) instance = new EmbeddedWhatsapp();
  return instance;
}

module.exports = { EmbeddedWhatsapp, WhatsappError, getEmbedded, describeEmbeddedError: describe, MIN_GAP_MS, MAX_PER_HOUR, BACKOFF_MS };
