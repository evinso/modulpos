const axios = require('axios');

const BASE = 'https://api.green-api.com';

class GreenApiService {
  constructor(instanceId, apiToken) {
    this.instanceId = instanceId;
    this.apiToken = apiToken;
    this.base = `${BASE}/waInstance${instanceId}`;
  }

  async getStatus() {
    const res = await axios.get(`${this.base}/getStateInstance/${this.apiToken}`, { timeout: 10000 });
    return res.data; // { stateInstance: 'authorized' | 'notAuthorized' | 'blocked' | 'starting' }
  }

  async getQR() {
    const res = await axios.get(`${this.base}/qr/${this.apiToken}`, { timeout: 15000 });
    return res.data; // { type: 'qrCode' | 'alreadyLogged' | 'loading', message: 'base64...' }
  }

  async sendMessage(phone, message) {
    const chatId = this._normalizeChatId(phone);
    const res = await axios.post(`${this.base}/sendMessage/${this.apiToken}`, {
      chatId,
      message,
    }, { timeout: 15000 });
    return res.data; // { idMessage: '...' }
  }

  async sendFileByUrl(phone, url, caption = '') {
    const chatId = this._normalizeChatId(phone);
    const res = await axios.post(`${this.base}/sendFileByUrl/${this.apiToken}`, {
      chatId,
      urlFile: url,
      fileName: url.split('/').pop() || 'file',
      caption,
    }, { timeout: 20000 });
    return res.data;
  }

  async logout() {
    const res = await axios.get(`${this.base}/logout/${this.apiToken}`, { timeout: 10000 });
    return res.data;
  }

  async reboot() {
    const res = await axios.get(`${this.base}/reboot/${this.apiToken}`, { timeout: 10000 });
    return res.data;
  }

  // phone: '905XXXXXXXXX' or '+90 5XX ...' → '905XXXXXXXXX@c.us'
  _normalizeChatId(phone) {
    if (phone.includes('@')) return phone;
    const digits = phone.replace(/\D/g, '');
    return `${digits}@c.us`;
  }
}

module.exports = GreenApiService;
