const axios = require('axios');
const FormData = require('form-data');

const LISTING_BASE   = 'https://listing-external.hepsiburada.com';
const MPOP_BASE      = 'https://mpop.hepsiburada.com';
const TICKET_BASE    = 'https://mpop.hepsiburada.com/ticket-api';

class HepsiburadaService {
  constructor(connection) {
    this.merchantId = connection.sellerId;
    this.credentials = Buffer.from(`${connection.apiKey}:${connection.apiSecret}`).toString('base64');
  }

  _headers() {
    return {
      Authorization: `Basic ${this.credentials}`,
      Accept: 'application/json',
      'User-Agent': 'ModulPOS/1.0',
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

  // Get listings with optional filters: hbSkuList, merchantSkuList, 'salable-listings', 'notsalable-listings', updateStartDate, updateEndDate
  async getListings(params = {}) {
    return this._request('get', LISTING_BASE, `/listings/merchantid/${this.merchantId}`, null, { limit: 2000, offset: 0, ...params });
  }

  // Get BuyBox rankings for up to 10 SKUs at a time (pass hbSku list)
  async getBuyboxRankings(skuList = []) {
    const params = {};
    if (skuList.length) params.skuList = skuList.join(',');
    return this._request('get', LISTING_BASE, `/buybox-orders/merchantid/${this.merchantId}`, null, params);
  }

  // Get commission rates for up to 50 SKUs at a time
  async getCommissions(skuList = []) {
    const params = {};
    if (skuList.length) params.skuList = skuList.join(',');
    return this._request('get', LISTING_BASE, `/commissions/merchantid/${this.merchantId}`, null, params);
  }

  // Batch inventory update via XML (price, stock, dispatch time, cargo company)
  // listings: [{ merchantSku, hbSku?, price, stock, dispatchTime?, cargoCompany? }]
  async uploadInventory(listings) {
    const items = listings.map(l => {
      const price = typeof l.price === 'number'
        ? l.price.toFixed(2).replace('.', ',')
        : String(l.price).replace('.', ',');
      return [
        '  <listing>',
        '    <UniqueIdentifier />',
        `    <HepsiburadaSku>${l.hbSku || ''}</HepsiburadaSku>`,
        `    <MerchantSku>${l.merchantSku}</MerchantSku>`,
        `    <Price>${price}</Price>`,
        `    <AvailableStock>${l.stock ?? 0}</AvailableStock>`,
        `    <DispatchTime>${l.dispatchTime ?? 1}</DispatchTime>`,
        `    <CargoCompany1>${l.cargoCompany || 'Yurtiçi Kargo'}</CargoCompany1>`,
        '  </listing>',
      ].join('\n');
    }).join('\n');

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<listings xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      items,
      '</listings>',
    ].join('\n');

    try {
      const res = await axios.post(
        `${LISTING_BASE}/listings/merchantid/${this.merchantId}/inventory-uploads`,
        xml,
        {
          headers: {
            Authorization: `Basic ${this.credentials}`,
            'Content-Type': 'application/xml',
            Accept: 'application/json',
          },
          timeout: 30000,
        }
      );
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;
      if (status === 401 || status === 403) throw new Error('Kimlik doğrulama hatası');
      throw new Error(detail?.message || detail?.Message || err.message);
    }
  }

  // Convenience: single-item price/stock update via XML batch
  async updateListing(sku, price, stock) {
    return this.uploadInventory([{ merchantSku: sku, price: price ?? 0, stock: stock ?? 0 }]);
  }

  // Query inventory-upload batch status by uploadId
  async getInventoryUploadStatus(uploadId) {
    return this._request('get', LISTING_BASE, `/listings/merchantid/${this.merchantId}/inventory-uploads/id/${uploadId}`, null, null);
  }

  // Stock-only batch update — items: [{ hepsiburadaSku?, merchantSku?, availableStock }]
  async uploadStock(items) {
    return this._request('post', LISTING_BASE, `/listings/merchantid/${this.merchantId}/stock-uploads`,
      { Items: items.map(i => ({ HepsiburadaSku: i.hepsiburadaSku || '', MerchantSku: i.merchantSku || '', AvailableStock: i.availableStock ?? 0 })) });
  }

  async getStockUploadStatus(uploadId) {
    return this._request('get', LISTING_BASE, `/listings/merchantid/${this.merchantId}/stock-uploads/id/${uploadId}`, null, null);
  }

  // Price-only batch update — items: [{ hepsiburadaSku?, merchantSku?, price }]
  async uploadPrice(items) {
    return this._request('post', LISTING_BASE, `/listings/merchantid/${this.merchantId}/price-uploads`, items);
  }

  async getPriceUploadStatus(uploadId) {
    return this._request('get', LISTING_BASE, `/listings/merchantid/${this.merchantId}/price-uploads/id/${uploadId}`, null, null);
  }

  // Delivery/shipping batch update — items: [{ hepsiburadaSku?, merchantSku?, dispatchTime?, shippingProfileName?, cargoCompany1?, cargoCompany2?, cargoCompany3? }]
  async uploadShippingInfo(items) {
    return this._request('post', LISTING_BASE, `/listings/merchantid/${this.merchantId}/shipping-info-uploads`, items);
  }

  async getShippingUploadStatus(uploadId) {
    return this._request('get', LISTING_BASE, `/listings/merchantid/${this.merchantId}/shipping-info-uploads/id/${uploadId}`, null, null);
  }

  // Additional info batch update — items: [{ hepsiburadaSku?, merchantSku?, productName?, maximumPurchasableQuantity? }]
  async uploadAdditionalInfo(items) {
    return this._request('post', LISTING_BASE, `/listings/merchantid/${this.merchantId}/additional-info-uploads`, items);
  }

  async getAdditionalInfoUploadStatus(uploadId) {
    return this._request('get', LISTING_BASE, `/listings/merchantid/${this.merchantId}/additional-info-uploads/id/${uploadId}`, null, null);
  }

  // Bulk unlock listings locked due to price threshold breaches
  async bulkUnlock(hbSkuList) {
    return this._request('post', LISTING_BASE, `/listings/merchantid/${this.merchantId}/bulk-unlock`, { hbSkuList });
  }

  async activateListing(sku) {
    return this._request('post', LISTING_BASE, `/listings/merchantid/${this.merchantId}/sku/${encodeURIComponent(sku)}/activate`);
  }

  async deactivateListing(sku) {
    return this._request('post', LISTING_BASE, `/listings/merchantid/${this.merchantId}/sku/${encodeURIComponent(sku)}/deactivate`);
  }

  async deleteListing(sku, merchantSku) {
    return this._request('delete', LISTING_BASE,
      `/listings/merchantid/${this.merchantId}/sku/${encodeURIComponent(sku)}/merchantsku/${encodeURIComponent(merchantSku)}`
    );
  }

  // Legacy alias kept for BuyBox adjust route
  async suspendListing(sku) {
    return this.deactivateListing(sku);
  }

  // ─── MPOP Catalog API ──────────────────────────────────────────────────────

  // leaf: true=only leaf nodes (default), status: ACTIVE/INACTIVE/ARCHIVED (default ACTIVE)
  // available: true (default), type: HX/HB/HC (optional), version: 1 (default)
  async getCategories({ leaf = true, status = 'ACTIVE', available = true, type, page = 0, size = 1000 } = {}) {
    const params = { leaf, status, available, version: 1, page, size };
    if (type) params.type = type;
    return this._request('get', MPOP_BASE, '/product/api/categories/get-all-categories', null, params);
  }

  // version=2 per API docs (previously 1 — updated)
  async getCategoryAttributes(categoryId, modifiedAtSince) {
    const params = { version: 2 };
    if (modifiedAtSince) params.modifiedAtSince = modifiedAtSince;
    return this._request('get', MPOP_BASE, `/product/api/categories/${categoryId}/attributes`, null, params);
  }

  // version=5 per API docs (previously 4 — updated), page/size with default 1000
  async getAttributeValues(categoryId, attributeId, page = 0, size = 1000, modifiedAtSince) {
    const params = { version: 5, page, size };
    if (modifiedAtSince) params.modifiedAtSince = modifiedAtSince;
    return this._request('get', MPOP_BASE,
      `/product/api/categories/${categoryId}/attribute/${attributeId}/values`, null, params);
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

  // trackingId-history: version=2 (docs default)
  async getTrackingHistory(page = 0, size = 1000) {
    return this._request('get', MPOP_BASE, '/product/api/products/trackingId-history', null, {
      version: 2,
      page,
      size,
    });
  }

  // Products by merchant + status — English statuses: WAITING, IN_EXTERNAL_PROGRESS, PRE_MATCHED, MATCHED, REJECTED
  async getProductsByStatus(productStatus, page = 0, size = 1000) {
    const params = { merchantId: this.merchantId, version: 1, page, size, taskStatus: false };
    if (productStatus) params.productStatus = productStatus;
    return this._request('get', MPOP_BASE, '/product/api/products/products-by-merchant-and-status', null, params);
  }

  // All products of merchant (catalog integration only) — searchable by barcode/merchantSku/hbSku
  async getAllMerchantProducts({ barcode, merchantSku, hbSku, page = 0, size = 1000 } = {}) {
    const params = { page, size };
    if (barcode) params.barcode = barcode;
    if (merchantSku) params.merchantSku = merchantSku;
    if (hbSku) params.hbSku = hbSku;
    return this._request('get', MPOP_BASE, `/product/api/products/all-products-of-merchant/${this.merchantId}`, null, params);
  }

  // Batch approve PRE_MATCHED products
  async approvePrematch(merchantSkuList) {
    return this._request('post', MPOP_BASE, '/product/api/products/approve-prematch',
      { merchantSkuList }, { version: 1 });
  }

  // Batch reject PRE_MATCHED products
  async rejectPrematch(merchantSkuList) {
    return this._request('post', MPOP_BASE, '/product/api/products/reject-prematch',
      { merchantSkuList }, { version: 1 });
  }

  // Fast listing — simplified product creation for catalog-matched products
  async fastListing(products) {
    return this._request('post', MPOP_BASE, '/product/api/products/fastlisting', products, { version: 1 });
  }

  // Delete products by merchantSku list — returns trackingId
  async deleteProducts(merchantSkuList) {
    return this._request('post', MPOP_BASE, '/product/api/products/delete-process',
      { merchantSkuList }, { version: 1 });
  }

  // Check delete process status by trackingId
  async getDeleteProcess(trackingId) {
    return this._request('get', MPOP_BASE, `/product/api/products/delete-process/${trackingId}`, null, null);
  }

  // Check product status by merchantSku list
  async checkProductStatus(merchantSkuList) {
    return this._request('post', MPOP_BASE, '/product/api/products/check-product-status',
      { merchantSkuList }, { version: 1 });
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  async getOrders(status = 'Created', params = {}) {
    return this._request('get', LISTING_BASE, `/orders/merchantid/${this.merchantId}/status/${status}`, null, params);
  }

  // ─── Ticket API (Product Content Update) ──────────────────────────────────

  // items: [{ hbSku, productName?, productDescription?, image1-10?, video?, attributes?, barcode?, kdv?, warrantyPeriod?, desi? }]
  // Only include fields you want to update — omitting preserves HB-enriched data.
  // To delete an attribute value, send it with an empty string "".
  async uploadProductUpdate(items) {
    const payload = { merchantId: this.merchantId, items };
    const form = new FormData();
    form.append('file', Buffer.from(JSON.stringify(payload)), {
      filename: 'integrator-ticket-upload.json',
      contentType: 'application/json',
    });
    try {
      const res = await axios.post(`${TICKET_BASE}/api/integrator/import`, form, {
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
      if (status === 401 || status === 403) throw new Error('Kimlik doğrulama hatası');
      throw new Error(detail?.message || detail?.description || err.message);
    }
  }

  // Poll update request status by trackingId
  async getTicketStatus(trackingId, page = 0, size = 1000) {
    return this._request('get', TICKET_BASE, `/api/integrator/status/${trackingId}`, null, { version: 1, page, size });
  }

  // Get update history for a product by hbSku
  async getProductUpdateHistory(hbSku) {
    return this._request('get', TICKET_BASE,
      `/api/integrator/merchant/${this.merchantId}/hbSku/${encodeURIComponent(hbSku)}`, null, null);
  }

  // ─── Ask to Seller (Customer Questions) ───────────────────────────────────

  _askHeaders() {
    return {
      Authorization: `Basic ${this.credentials}`,
      merchantId: this.merchantId,
      Accept: 'application/json',
    };
  }

  async _askRequest(method, path, data, params) {
    const ASK_BASE = 'https://api-asktoseller-merchant.hepsiburada.com';
    try {
      const headers = { ...this._askHeaders() };
      if (data) headers['Content-Type'] = 'application/json';
      const res = await axios({ method, url: `${ASK_BASE}${path}`, headers, data, params, timeout: 20000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;
      if (status === 401 || status === 403) throw new Error('Kimlik doğrulama hatası');
      if (status === 404) throw new Error('Kaynak bulunamadı (404)');
      throw new Error(detail?.message || detail?.Message || err.message);
    }
  }

  // status: undefined=WaitingForAnswer, 2=Answered, 3=Rejected, 4=AutoClosed
  // sortBy: 0=question date, 1=last updated date
  async getQuestions(status, sortBy = 0, page = 0, size = 20) {
    const params = { sortBy, page, size };
    if (status !== undefined && status !== null && status !== '') params.status = status;
    return this._askRequest('get', '/api/v1.0/issues', null, params);
  }

  async getQuestionCount() {
    return this._askRequest('get', '/api/v1.0/issues/count', null, null);
  }

  async answerQuestion(number, answerText) {
    const ASK_BASE = 'https://api-asktoseller-merchant.hepsiburada.com';
    const form = new FormData();
    form.append('Answer', answerText);
    try {
      const res = await axios.post(`${ASK_BASE}/api/v1.0/issues/${number}/answer`, form, {
        headers: { ...this._askHeaders(), ...form.getHeaders() },
        timeout: 20000,
      });
      return res.data;
    } catch (err) {
      const detail = err.response?.data;
      throw new Error(detail?.message || detail?.Message || err.message);
    }
  }

  async rejectQuestion(number, rejectReason) {
    return this._askRequest('post', `/api/v1.0/issues/${number}/reject`, { rejectReason });
  }
}

module.exports = HepsiburadaService;
