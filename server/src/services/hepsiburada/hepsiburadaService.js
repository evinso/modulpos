const axios = require('axios');

const LISTING_BASE = 'https://listing-external.hepsiburada.com';
const MPOP_BASE    = 'https://mpop.hepsiburada.com';

class HepsiburadaService {
  constructor(connection) {
    this.merchantId = connection.sellerId;
    this.credentials = Buffer.from(`${connection.apiKey}:${connection.apiSecret}`).toString('base64');
  }

  _headers(contentType = 'application/json') {
    return {
      Authorization: `Basic ${this.credentials}`,
      'Content-Type': contentType,
      Accept: 'application/json',
    };
  }

  async _request(method, baseUrl, path, data, params) {
    try {
      const res = await axios({ method, url: `${baseUrl}${path}`, headers: this._headers(), data, params, timeout: 20000 });
      return res.data;
    } catch (err) {
      const status  = err.response?.status;
      const detail  = err.response?.data;
      if (status === 401 || status === 403) throw new Error('Kimlik doğrulama hatası: Kullanıcı adı veya şifre hatalı');
      if (status === 404) throw new Error('Kaynak bulunamadı (404)');
      throw new Error(detail?.message || detail?.Message || err.message);
    }
  }

  async testConnection() {
    try {
      await this._request('get', LISTING_BASE, `/Listings/merchantid/${this.merchantId}`, null, { limit: 1, offset: 0 });
      return { success: true, message: 'Hepsiburada bağlantısı başarılı!' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async getListings(params = {}) {
    return this._request('get', LISTING_BASE, `/Listings/merchantid/${this.merchantId}`, null, { limit: 1000, offset: 0, ...params });
  }

  // Update price and/or stock for an existing listing
  async updateListing(sku, price, availableCount) {
    return this._request('post', LISTING_BASE, `/Listings/merchantid/${this.merchantId}/sku/${encodeURIComponent(sku)}`,
      { price, availableCount });
  }

  async suspendListing(sku) {
    return this._request('delete', LISTING_BASE, `/Listings/merchantid/${this.merchantId}/sku/${encodeURIComponent(sku)}`);
  }

  // Get categories from MPOP (product catalog)
  async getCategories() {
    return this._request('get', MPOP_BASE, '/product/api/categories/get-all-categories');
  }

  // Get category attributes for product creation
  async getCategoryAttributes(categoryId) {
    return this._request('get', MPOP_BASE, `/product/api/categories/${categoryId}/attributes`);
  }

  // Get orders
  async getOrders(status = 'Created', params = {}) {
    return this._request('get', LISTING_BASE, `/orders/merchantid/${this.merchantId}/status/${status}`, null, params);
  }
}

module.exports = HepsiburadaService;
