const axios = require('axios');

const WAHA_BASE = process.env.WAHA_BASE_URL || 'http://localhost:3002';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'modulpos2024';

const headers = () => ({ 'X-Api-Key': WAHA_API_KEY });

class WahaService {
  constructor(sessionName) {
    this.session = sessionName || 'default';
  }

  async getStatus() {
    try {
      const res = await axios.get(`${WAHA_BASE}/api/sessions/${this.session}`, { timeout: 10000, headers: headers() });
      const status = res.data?.status;
      const map = { WORKING: 'authorized', FAILED: 'notAuthorized', STOPPED: 'notAuthorized', STARTING: 'starting', SCAN_QR_CODE: 'notAuthorized' };
      return { stateInstance: map[status] || 'notAuthorized', wahaStatus: status };
    } catch {
      return { stateInstance: 'notAuthorized' };
    }
  }

  async getQR() {
    try {
      await this._ensureSession();
      // Wait for session to reach SCAN_QR_CODE state (up to 8 seconds)
      for (let i = 0; i < 8; i++) {
        const statusRes = await axios.get(`${WAHA_BASE}/api/sessions/${this.session}`, { timeout: 5000, headers: headers() });
        const s = statusRes.data?.status;
        if (s === 'SCAN_QR_CODE') break;
        if (s === 'WORKING') return { type: 'alreadyLogged', message: '' };
        if (s === 'FAILED') return { type: 'loading', message: '' };
        await new Promise(r => setTimeout(r, 1000));
      }
      const res = await axios.get(`${WAHA_BASE}/api/${this.session}/auth/qr`, {
        params: { format: 'image' },
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: headers(),
      });
      const base64 = Buffer.from(res.data).toString('base64');
      return { type: 'qrCode', message: base64 };
    } catch {
      return { type: 'loading', message: '' };
    }
  }

  async sendMessage(phone, message) {
    const chatId = this._normalizeChatId(phone);
    const res = await axios.post(`${WAHA_BASE}/api/sendText`, {
      chatId, text: message, session: this.session,
    }, { timeout: 15000, headers: headers() });
    return { idMessage: res.data?.id || 'sent' };
  }

  async sendFileByUrl(phone, url, caption = '') {
    const chatId = this._normalizeChatId(phone);
    const res = await axios.post(`${WAHA_BASE}/api/sendImage`, {
      chatId, url, caption, session: this.session,
    }, { timeout: 20000, headers: headers() });
    return res.data;
  }

  async logout() {
    try {
      await axios.post(`${WAHA_BASE}/api/sessions/${this.session}/logout`, {}, { timeout: 10000, headers: headers() });
    } catch {}
    return { success: true };
  }

  async reboot() {
    try {
      await axios.post(`${WAHA_BASE}/api/sessions/${this.session}/stop`, {}, { timeout: 10000, headers: headers() });
      await new Promise(r => setTimeout(r, 1000));
      await this._ensureSession();
    } catch {}
    return { success: true };
  }

  async _ensureSession() {
    try {
      const res = await axios.get(`${WAHA_BASE}/api/sessions/${this.session}`, { timeout: 5000, headers: headers() });
      const status = res.data?.status;
      if (status === 'STOPPED' || status === 'FAILED') {
        await axios.post(`${WAHA_BASE}/api/sessions/${this.session}/start`, {}, { timeout: 10000, headers: headers() });
      }
    } catch (err) {
      if (err.response?.status === 404) {
        await axios.post(`${WAHA_BASE}/api/sessions`, {
          name: this.session, config: { proxy: null },
        }, { timeout: 10000, headers: headers() });
      }
    }
  }

  _normalizeChatId(phone) {
    if (phone.includes('@')) return phone;
    return `${phone.replace(/\D/g, '')}@c.us`;
  }
}

module.exports = WahaService;
