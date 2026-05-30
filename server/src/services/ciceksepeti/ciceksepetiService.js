const axios = require('axios');

const PROD_BASE = 'https://apis.ciceksepeti.com/api/v1';
const SANDBOX_BASE = 'https://sandbox-apis.ciceksepeti.com/api/v1';

class CiceksepetiService {
  constructor(connection) {
    this.supplierId = connection.sellerId;
    this.apiKey = connection.apiKey;
    this.base = PROD_BASE;
  }

  _headers() {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `${this.supplierId}-ModulPOS`,
    };
  }

  async _request(method, path, data = null, params = null) {
    try {
      const config = {
        method,
        url: `${this.base}${path}`,
        headers: this._headers(),
      };
      if (data) config.data = data;
      if (params) config.params = params;

      const res = await axios(config);
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;
      if (status === 401 || status === 403) throw new Error('Kimlik doğrulama hatası: API anahtarı geçersiz');
      if (status === 404) throw new Error('Kaynak bulunamadı');
      const msg = detail?.message || detail?.Message || detail?.errorMessage || err.message;
      throw new Error(msg || 'Bilinmeyen hata');
    }
  }

  async testConnection() {
    try {
      await this._request('get', '/Categories', null, { page: 0, pageSize: 1 });
      return { success: true, message: 'Çiçeksepeti bağlantısı başarılı!' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ─── Categories ───────────────────────────────────────────────────────
  async getCategories({ page = 0, pageSize = 500 } = {}) {
    return this._request('get', '/Categories', null, { page, pageSize });
  }

  async getCategoryAttributes(categoryId) {
    return this._request('get', `/Categories/${categoryId}/attributes`);
  }

  // ─── Products ─────────────────────────────────────────────────────────
  // status: Active | Passive | WaitingForApproval | All
  async getProducts({ status = 'Active', page = 0, pageSize = 100 } = {}) {
    return this._request('get', '/Products', null, { status, page, pageSize });
  }

  async createProducts(products) {
    return this._request('post', '/Products', { products });
  }

  async updateProducts(products) {
    return this._request('put', '/Products', { products });
  }

  async updatePriceAndStock(items) {
    // items: [{ productCode, quantity, salePrice, listPrice }]
    return this._request('put', '/Products/price-and-inventory', { items });
  }

  // ─── Orders ───────────────────────────────────────────────────────────
  // statusId: 1=Yeni, 2=Hazırlanıyor, 3=Kargoya Verildi, 4=Teslim Edildi, 5=İptal, 6=İade
  async getOrders({ startDate, endDate, statusId, page = 0, pageSize = 100 } = {}) {
    const body = { page, pageSize };
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    if (statusId !== undefined) body.statusId = statusId;
    return this._request('post', '/Order/GetOrders', body);
  }

  async markReadyForCargo(orderLineIds) {
    // orderLineIds: array of order line IDs
    return this._request('put', '/Order/readyforcargowithcsintegration', { orderLines: orderLineIds });
  }

  async updateShipmentStatus(orders) {
    // orders: [{ orderNumber, cargoCompany, trackingNumber }]
    return this._request('put', '/Order/statusupdatewithsupplierintegration', { orders });
  }
}

module.exports = CiceksepetiService;
