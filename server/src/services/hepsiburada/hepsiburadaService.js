const axios = require('axios');
const FormData = require('form-data');

const LISTING_BASE = 'https://listing-external.hepsiburada.com';
const MPOP_BASE    = 'https://mpop.hepsiburada.com';

class HepsiburadaService {
  constructor(connection) {
    this.merchantId = connection.sellerId;
    this.credentials = Buffer.from(`${connection.apiKey}:${connection.apiSecret}`).toString('base64');
  }

  _headers() {
    return {
      Authorization: `Basic ${this.credentials}`,
      Accept: 'application/json',
    };
  }

  async _request(method, baseUrl, path, data, params) {
    try {
      const headers = { ...this._headers() };
      if (data) headers['Content-Type'] = 'application/json';
      const res = await axios({ method, url: `${baseUrl}${path}`, headers, data, params, timeout: 20000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;
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

  // ─── Listing API (price / stock for existing SKUs) ─────────────────────────

  async getListings(params = {}) {
    return this._request('get', LISTING_BASE, `/Listings/merchantid/${this.merchantId}`, null, { limit: 1000, offset: 0, ...params });
  }

  async getBuyboxRankings(limit = 500, offset = 0) {
    return this._request('get', LISTING_BASE, `/Listings/merchantid/${this.merchantId}`, null, { limit, offset });
  }

  async updateListing(sku, price, availableCount) {
    const body = {};
    if (price !== null && price !== undefined) body.price = price;
    if (availableCount !== null && availableCount !== undefined) body.availableCount = availableCount;
    return this._request('post', LISTING_BASE, `/Listings/merchantid/${this.merchantId}/sku/${encodeURIComponent(sku)}`, body);
  }

  async suspendListing(sku) {
    return this._request('delete', LISTING_BASE, `/Listings/merchantid/${this.merchantId}/sku/${encodeURIComponent(sku)}`);
  }

  // ─── MPOP Catalog API ──────────────────────────────────────────────────────

  /**
   * Get leaf categories available for product creation.
   * leaf=true → only bottom-level categories (where products can be created)
   * status=ACTIVE, available=true → only usable categories
   * size max 1000 per docs.
   */
  async getCategories(page = 0, size = 1000) {
    return this._request('get', MPOP_BASE, '/product/api/categories/get-all-categories', null, {
      leaf: true,
      status: 'ACTIVE',
      available: true,
      version: 1,
      page,
      size,
    });
  }

  /**
   * Get attributes for a category (version=1 per docs).
   * Returns array of attributes; those with type=enum need getAttributeValues() next.
   */
  async getCategoryAttributes(categoryId) {
    return this._request('get', MPOP_BASE, `/product/api/categories/${categoryId}/attributes`, null, { version: 1 });
  }

  /**
   * Get allowed values for an enum attribute.
   * version=4, page=0, size=1000 per docs.
   */
  async getAttributeValues(categoryId, attributeId, page = 0, size = 1000) {
    return this._request('get', MPOP_BASE,
      `/product/api/categories/${categoryId}/attribute/${attributeId}/values`, null,
      { version: 4, page, size });
  }

  /**
   * Submit new product listing(s) to HepsiBurada catalog via multipart/form-data file upload.
   * products: array of { categoryId, merchant, attributes } per HepsiBurada integrator.json spec.
   * Returns { trackingId } — poll with getImportStatus().
   */
  async createProducts(products) {
    try {
      const form = new FormData();
      const json = JSON.stringify(products);
      form.append('file', Buffer.from(json), {
        filename: 'integrator.json',
        contentType: 'application/json',
      });
      const res = await axios.post(`${MPOP_BASE}/product/api/products/import`, form, {
        headers: {
          Authorization: `Basic ${this.credentials}`,
          Accept: 'application/json',
          ...form.getHeaders(),
        },
        params: { version: 1 },
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;
      if (status === 401 || status === 403) throw new Error('Kimlik doğrulama hatası: Kullanıcı adı veya şifre hatalı');
      throw new Error(detail?.message || detail?.Message || err.message);
    }
  }

  async getImportStatus(trackingId) {
    return this._request('get', MPOP_BASE, `/product/api/products/status/${trackingId}`, null, {
      version: 1,
      page: 0,
      size: 1000,
    });
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  async getOrders(status = 'Created', params = {}) {
    return this._request('get', LISTING_BASE, `/orders/merchantid/${this.merchantId}/status/${status}`, null, params);
  }
}

module.exports = HepsiburadaService;
