const axios = require('axios');

// WAHA (https://waha.devlike.pro) is a SEPARATE server that holds the logged-in WhatsApp session; this service only talks to it over HTTP.
// Settings are read at call time (not at load) so a changed environment takes effect without re-requiring the module.
const isConfigured = () => !!String(process.env.WAHA_BASE_URL || '').trim();
const baseUrl = () => {
  let u = String(process.env.WAHA_BASE_URL || 'http://localhost:3002').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
};
const apiKey = () => process.env.WAHA_API_KEY || 'modulpos2024';
const headers = (extra) => ({ 'X-Api-Key': apiKey(), ...extra });

const STATE_OF = { WORKING: 'authorized', FAILED: 'notAuthorized', STOPPED: 'notAuthorized', STARTING: 'starting', SCAN_QR_CODE: 'notAuthorized' };

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

/** The message WAHA put in an error body, if any (the QR call asks for a buffer, so the body may be raw bytes). */
function bodyMessage(err) {
  let d = err?.response?.data;
  if (d && (Buffer.isBuffer(d) || d instanceof ArrayBuffer)) {
    try { d = JSON.parse(Buffer.from(d).toString('utf8')); } catch { d = null; }
  }
  const m = d && typeof d === 'object' ? d.message : null;
  return typeof m === 'string' ? m.slice(0, 200) : '';
}

/** Turns a failed WAHA call into a sentence the admin can act on (shown on the WhatsApp page; admin only). */
function describeError(err) {
  const status = err?.response?.status;
  if (!status) {
    if (!isConfigured()) {
      return 'WAHA sunucu adresi tanımlı değil. WAHA ayrı bir sunucuda çalışmalıdır; adresini Render > modulpos-api > Environment bölümüne WAHA_BASE_URL (ve WAHA_API_KEY) olarak ekleyin.';
    }
    return `WAHA sunucusuna ulaşılamıyor (${hostOf(baseUrl())}). Sunucunun açık olduğunu ve WAHA_BASE_URL adresinin doğru olduğunu kontrol edin.`;
  }
  const detail = bodyMessage(err);
  if (status === 401 || status === 403) return 'WAHA API anahtarını kabul etmedi. Render’daki WAHA_API_KEY, WAHA sunucusundaki WAHA_API_KEY ile aynı olmalı.';
  if (status === 404) return detail || 'WAHA bu isteği bulamadı (404). Adresin WAHA sunucusunu gösterdiğini ve oturum adını kontrol edin.';
  if (status === 422) return `WAHA isteği kabul etmedi: ${detail || 'oturum uygun durumda değil (QR okutulmamış olabilir)'}.`;
  return `WAHA hata döndürdü (HTTP ${status})${detail ? `: ${detail}` : ''}.`;
}

/**
 * Chat id for WAHA. Turkish numbers are often typed the local way (05XX XXX XX XX / 5XX XXX XX XX), but WhatsApp needs the
 * country code (90…), so those are completed; numbers that already carry a country code are left alone.
 */
function normalizePhone(phone) {
  const raw = String(phone ?? '').trim();
  if (raw.includes('@')) return raw;
  let d = raw.replace(/\D/g, '').replace(/^00/, '');
  if (/^0\d{10}$/.test(d)) d = `90${d.slice(1)}`;
  else if (/^5\d{9}$/.test(d)) d = `90${d}`;
  return d;
}

class WahaService {
  constructor(sessionName) {
    this.session = sessionName || 'default';
  }

  get _s() { return encodeURIComponent(this.session); }

  _get(path, { timeout = 10000, ...rest } = {}) {
    return axios.get(`${baseUrl()}${path}`, { timeout, ...rest, headers: headers(rest.headers) });
  }

  _post(path, body, timeout = 10000) {
    return axios.post(`${baseUrl()}${path}`, body, { timeout, headers: headers() });
  }

  async getStatus() {
    try {
      const res = await this._get(`/api/sessions/${this._s}`);
      const status = res.data?.status;
      return { stateInstance: STATE_OF[status] || 'notAuthorized', wahaStatus: status };
    } catch (err) {
      // 404 = the session simply has not been created yet (the QR button creates it)
      if (err.response?.status === 404) return { stateInstance: 'notAuthorized', wahaStatus: 'NOT_CREATED', message: 'Oturum henüz oluşturulmamış. “QR Kodu Göster” ile başlatın.' };
      return { stateInstance: err.response ? 'error' : 'unreachable', message: describeError(err) };
    }
  }

  /** { type: 'qrCode', message: <base64>, mimetype } | 'alreadyLogged' | 'loading' (try again shortly) | 'error' (message says why) */
  async getQR() {
    try {
      await this._ensureSession();
      // A new session needs a few seconds before it offers a QR code
      let status;
      for (let i = 0; i < 10; i++) {
        status = (await this._get(`/api/sessions/${this._s}`, { timeout: 5000 })).data?.status;
        if (status === 'SCAN_QR_CODE') break;
        if (status === 'WORKING') return { type: 'alreadyLogged', message: '' };
        await WahaService.delay(1000);
      }
      if (status !== 'SCAN_QR_CODE') {
        return { type: 'loading', message: status === 'FAILED' ? 'Oturum hata durumunda, yeniden başlatılıyor. Birkaç saniye içinde tekrar denenecek.' : 'Oturum başlatılıyor. QR hazır olunca burada görünecek.' };
      }
      let res;
      try {
        // Ask for the picture explicitly: with "Accept: application/json" WAHA answers with base64 inside JSON instead
        res = await this._get(`/api/${this._s}/auth/qr`, { params: { format: 'image' }, responseType: 'arraybuffer', timeout: 15000, headers: { Accept: 'image/png' } });
      } catch (err) {
        // 422 = the QR was just replaced / not ready yet, which is normal; anything else is a real problem
        if (err.response?.status === 422) return { type: 'loading', message: 'QR henüz hazır değil, birkaç saniye içinde yenilenecek.' };
        throw err;
      }
      const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
      const buf = Buffer.from(res.data);
      if (contentType.includes('application/json')) {
        let j = null;
        try { j = JSON.parse(buf.toString('utf8')); } catch { /* not JSON after all */ }
        if (j && typeof j.data === 'string' && j.data) return { type: 'qrCode', message: j.data, mimetype: j.mimetype || 'image/png' };
        return { type: 'error', message: 'WAHA’dan gelen QR yanıtı okunamadı.' };
      }
      if (!contentType.startsWith('image/')) {
        return { type: 'error', message: 'WAHA_BASE_URL adresi WAHA yerine başka bir sayfaya çıkıyor (QR yerine web sayfası geldi). Adresi kontrol edin.' };
      }
      return { type: 'qrCode', message: buf.toString('base64'), mimetype: contentType.split(';')[0] };
    } catch (err) {
      return { type: 'error', message: describeError(err) };
    }
  }

  async sendMessage(phone, message) {
    const chatId = this._normalizeChatId(phone);
    const res = await this._post('/api/sendText', { chatId, text: message, session: this.session }, 15000);
    return { idMessage: res.data?.id || 'sent' };
  }

  async sendFileByUrl(phone, url, caption = '') {
    const chatId = this._normalizeChatId(phone);
    const res = await this._post('/api/sendImage', { chatId, url, caption, session: this.session }, 20000);
    return res.data;
  }

  async logout() {
    try {
      await this._post(`/api/sessions/${this._s}/logout`, {});
    } catch { /* best effort: WAHA answers with an error when nobody is logged in */ }
    return { success: true };
  }

  async reboot() {
    try {
      await this._post(`/api/sessions/${this._s}/stop`, {});
    } catch { /* it may not be running; starting it again is what matters */ }
    await WahaService.delay(1000);
    await this._ensureSession();
    return { success: true };
  }

  /** Makes sure the session exists and is started. Connection / key problems are thrown so callers can report them. */
  async _ensureSession() {
    let status;
    try {
      status = (await this._get(`/api/sessions/${this._s}`, { timeout: 5000 })).data?.status;
    } catch (err) {
      if (err.response?.status !== 404) throw err;
      // Not there yet: create it (WAHA starts a new session right away)
      await this._post('/api/sessions', { name: this.session, config: { proxy: null } });
      return;
    }
    if (status === 'FAILED') {
      // A failed session must be stopped before it can be started again
      await this._post(`/api/sessions/${this._s}/stop`, {}).catch(() => {});
      await WahaService.delay(1000);
      await this._post(`/api/sessions/${this._s}/start`, {});
    } else if (status === 'STOPPED') {
      await this._post(`/api/sessions/${this._s}/start`, {});
    }
  }

  _normalizeChatId(phone) {
    const n = normalizePhone(phone);
    return n.includes('@') ? n : `${n}@c.us`;
  }
}

WahaService.delay = (ms) => new Promise((r) => setTimeout(r, ms));   // replaceable in tests
WahaService.describeError = describeError;
WahaService.normalizePhone = normalizePhone;

module.exports = WahaService;
