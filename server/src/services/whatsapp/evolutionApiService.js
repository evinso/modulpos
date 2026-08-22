const axios = require('axios');

class EvolutionApiService {
  constructor(serverUrl, apiKey) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  _headers() {
    return { apikey: this.apiKey, 'Content-Type': 'application/json' };
  }

  async _req(method, path, data) {
    const res = await axios({
      method,
      url: `${this.serverUrl}${path}`,
      data,
      headers: this._headers(),
      timeout: 15000,
    });
    return res.data;
  }

  // List all instances
  async fetchInstances() {
    return this._req('get', '/instance/fetchInstances');
  }

  // Create a new instance
  async createInstance(instanceName) {
    return this._req('post', '/instance/create', {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });
  }

  // Get QR code for an instance
  async getQR(instanceName) {
    return this._req('get', `/instance/connect/${instanceName}`);
  }

  // Get connection state
  async getState(instanceName) {
    return this._req('get', `/instance/connectionState/${instanceName}`);
  }

  // Delete instance
  async deleteInstance(instanceName) {
    return this._req('delete', `/instance/delete/${instanceName}`);
  }

  // Logout (disconnect) instance
  async logoutInstance(instanceName) {
    return this._req('delete', `/instance/logout/${instanceName}`);
  }

  // Send text message
  // number format: '905XXXXXXXXX' (no + prefix)
  async sendText(instanceName, number, text) {
    const normalized = number.replace(/\D/g, '');
    return this._req('post', `/message/sendText/${instanceName}`, {
      number: normalized,
      text,
    });
  }
}

module.exports = EvolutionApiService;
