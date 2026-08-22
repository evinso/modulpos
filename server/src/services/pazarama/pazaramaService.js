const axios = require('axios');

const AUTH_URL = 'https://isortagimgiris.pazarama.com/connect/token';
const API_URL  = 'https://isortagimapi.pazarama.com';

// Token cache: connectionId → { token, expiresAt }
const tokenCache = new Map();

class PazaramaService {
  constructor(connection) {
    this.connectionId = connection.id || null;
    this.clientId     = (connection.apiKey    || '').trim();
    this.clientSecret = (connection.apiSecret || '').trim();
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async getToken() {
    const cached = tokenCache.get(this.connectionId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const creds = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await axios.post(AUTH_URL,
      'grant_type=client_credentials&scope=merchantgatewayapi.fullaccess',
      {
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      }
    );

    const token = res.data.access_token;
    tokenCache.set(this.connectionId, {
      token,
      expiresAt: Date.now() + 55 * 60 * 1000, // 55 min (safe margin)
    });
    return token;
  }

  async headers() {
    const token = await this.getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async get(path, params = {}) {
    const res = await axios.get(`${API_URL}${path}`, {
      headers: await this.headers(),
      params,
      timeout: 15000,
    });
    return res.data;
  }

  async post(path, data = {}) {
    const res = await axios.post(`${API_URL}${path}`, data, {
      headers: await this.headers(),
      timeout: 15000,
    });
    return res.data;
  }

  // ─── Connection test ───────────────────────────────────────────────────────

  async testConnection() {
    try {
      await this.getToken();
      // Fetch first page of products as a connectivity check
      await this.get('/product/getProducts', { Approved: true, Size: 1, Page: 1 });
      return { success: true, message: 'Pazarama bağlantısı başarılı' };
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      return { success: false, message: `Bağlantı hatası: ${msg}` };
    }
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  async getCategoryTree() {
    return this.get('/category/getCategoryTree');
  }

  async getCategoryAttributes(categoryId) {
    return this.get('/category/getCategoryWithAttributes', { Id: categoryId });
  }

  // ─── Brands ───────────────────────────────────────────────────────────────

  async getBrands(page = 1, size = 100) {
    return this.get('/brand/getBrands', { page, size });
  }

  // ─── Products ─────────────────────────────────────────────────────────────

  async getProducts({ page = 1, size = 50, approved = true } = {}) {
    return this.get('/product/getProducts', { Approved: approved, Size: size, Page: page });
  }

  async createProducts(products) {
    // products: array of product objects per Pazarama spec
    return this.post('/product/create', { products });
  }

  async getBatchResult(batchRequestId) {
    return this.get('/product/getProductBatchResult', { BatchRequestId: batchRequestId });
  }

  // ─── Price & Stock ────────────────────────────────────────────────────────

  async updatePrice(items) {
    // items: [{ code, listPrice, salePrice }]
    return this.post('/product/updatePrice', { items });
  }

  async updateStock(items) {
    // items: [{ code, stockCount }]
    return this.post('/product/updateStock', { items });
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  async getOrders({ startDate, endDate, page = 1, size = 50 } = {}) {
    return this.post('/order/getOrdersForApi', { StartDate: startDate, EndDate: endDate, Page: page, Size: size });
  }
}

module.exports = PazaramaService;
