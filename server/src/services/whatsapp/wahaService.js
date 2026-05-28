const axios = require('axios');

const WAHA_BASE = process.env.WAHA_BASE_URL || 'http://localhost:3002';

class WahaService {
  constructor(sessionName) {
    this.session = sessionName || 'default';
    this.base = WAHA_BASE;
  }

  async getStatus() {
    try {
      const res = await axios.get(`${this.base}/api/sessions/${this.session}`, { timeout: 10000 });
      const status = res.data?.status;
      // Map WAHA statuses to Green API compatible format
      const map = { WORKING: 'authorized', FAILED: 'notAuthorized', STOPPED: 'notAuthorized', STARTING: 'starting', SCAN_QR_CODE: 'notAuthorized' };
      return { stateInstance: map[status] || 'notAuthorized', wahaStatus: status };
    } catch {
      return { stateInstance: 'notAuthorized' };
    }
  }

  async getQR() {
    try {
      // Start session if not exists
      await this._ensureSession();
      const res = await axios.get(`${this.base}/api/${this.session}/auth/qr`, {
        params: { format: 'image' },
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      const base64 = Buffer.from(res.data).toString('base64');
      return { type: 'qrCode', message: base64 };
    } catch (err) {
      return { type: 'loading', message: '' };
    }
  }

  async sendMessage(phone, message) {
    const chatId = this._normalizeChatId(phone);
    const res = await axios.post(`${this.base}/api/sendText`, {
      chatId,
      text: message,
      session: this.session,
    }, { timeout: 15000 });
    return { idMessage: res.data?.id || 'sent' };
  }

  async sendFileByUrl(phone, url, caption = '') {
    const chatId = this._normalizeChatId(phone);
    const res = await axios.post(`${this.base}/api/sendImage`, {
      chatId,
      url,
      caption,
      session: this.session,
    }, { timeout: 20000 });
    return res.data;
  }

  async logout() {
    try {
      await axios.post(`${this.base}/api/sessions/${this.session}/logout`, {}, { timeout: 10000 });
    } catch {}
    return { success: true };
  }

  async reboot() {
    try {
      await axios.post(`${this.base}/api/sessions/${this.session}/stop`, {}, { timeout: 10000 });
      await new Promise(r => setTimeout(r, 1000));
      await this._ensureSession();
    } catch {}
    return { success: true };
  }

  async _ensureSession() {
    try {
      await axios.get(`${this.base}/api/sessions/${this.session}`, { timeout: 5000 });
    } catch (err) {
      if (err.response?.status === 404) {
        await axios.post(`${this.base}/api/sessions`, {
          name: this.session,
          config: { proxy: null },
        }, { timeout: 10000 });
      }
    }
  }

  _normalizeChatId(phone) {
    if (phone.includes('@')) return phone;
    const digits = phone.replace(/\D/g, '');
    return `${digits}@c.us`;
  }
}

module.exports = WahaService;
