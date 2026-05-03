const axios = require('axios');
const staticCategories = require('../../data/trendyolCategories');

class TrendyolService {
  constructor(connection) {
    this.sellerId = (connection.sellerId || '').trim();
    this.apiKey = (connection.apiKey || '').trim();
    this.apiSecret = (connection.apiSecret || '').trim();
    this.supplierName = connection.supplierName;
    this.baseUrl = connection.baseUrl || process.env.TRENDYOL_BASE_URL || 'https://apigw.trendyol.com/integration';
    this.auth = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
  }

  getHeaders() {
    return {
      'Authorization': `Basic ${this.auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': `${this.sellerId} - SelfIntegration`
    };
  }

  /**
   * Cloudflare'in geçici bloklarını aşmak için retry mekanizması
   */
  async requestWithRetry(config, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await axios({ ...config, headers: this.getHeaders(), timeout: 15000 });
        return res;
      } catch (err) {
        const status = err.response?.status;
        const server = err.response?.headers?.['server'] || '';
        const isCloudflareBlock = server.toLowerCase().includes('cloudflare') && status === 403;
        
        // Cloudflare geçici bloku ise retry yap
        if (isCloudflareBlock && attempt < retries) {
          const delay = attempt * 2000; // 2s, 4s, 6s
          console.warn(`[TrendyolService] Cloudflare 403 engeli, ${delay}ms sonra tekrar deneniyor (${attempt}/${retries})...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * 403 hatasının Cloudflare kaynaklı mı yoksa gerçek API reddi mi olduğunu tespit eder
   */
  static isCloudflareBlock(error) {
    if (!error.response) return false;
    const server = error.response.headers?.['server'] || '';
    const cfRay = error.response.headers?.['cf-ray'];
    const body = typeof error.response.data === 'string' ? error.response.data : '';
    return (
      server.toLowerCase().includes('cloudflare') ||
      !!cfRay ||
      body.includes('Cloudflare') ||
      body.includes('cf-browser-verification') ||
      body.includes('challenge-platform')
    );
  }

  // === PRODUCT OPERATIONS ===
  async getCategories() {
    try {
      const res = await this.requestWithRetry({
        method: 'get',
        url: `${this.baseUrl}/product/product-categories`
      });
      return res.data;
    } catch (err) {
      // Geliştirme ortamında Cloudflare engeli (403) veya bağlantı hatası olduğunda
      // statik kategori listesini döndür
      console.warn('[TrendyolService] Kategori API erişilemedi, statik liste kullanılıyor:', err.response?.status || err.message);
      return staticCategories;
    }
  }

  async getCategoryAttributes(categoryId) {
    const res = await this.requestWithRetry({
      method: 'get',
      url: `${this.baseUrl}/product/product-categories/${categoryId}/attributes`
    });
    return res.data;
  }

  async getBrands(page = 0, size = 500) {
    const res = await this.requestWithRetry({
      method: 'get',
      url: `${this.baseUrl}/product/brands`,
      params: { page, size }
    });
    return res.data;
  }

  async searchBrand(name) {
    const res = await this.requestWithRetry({
      method: 'get',
      url: `${this.baseUrl}/product/brands/by-name`,
      params: { name }
    });
    return res.data;
  }

  async createProducts(products) {
    const payload = { items: products };
    const res = await this.requestWithRetry({
      method: 'post',
      url: `${this.baseUrl}/product/sellers/${this.sellerId}/v2/products`,
      data: payload
    });
    return res.data;
  }

  async updatePriceAndInventory(items) {
    const payload = { items };
    const res = await this.requestWithRetry({
      method: 'post',
      url: `${this.baseUrl}/inventory/sellers/${this.sellerId}/products/price-and-inventory`,
      data: payload
    });
    return res.data;
  }

  async getBatchRequestResult(batchRequestId) {
    const res = await this.requestWithRetry({
      method: 'get',
      url: `${this.baseUrl}/product/sellers/${this.sellerId}/products/batch-requests/${batchRequestId}`
    });
    return res.data;
  }

  async getProducts(page = 0, size = 50, approved = true, barcodes = []) {
    const params = { page, size, approved };
    if (barcodes && barcodes.length > 0) {
      params.barcode = barcodes.join(',');
    }
    const res = await this.requestWithRetry({
      method: 'get',
      url: `${this.baseUrl}/product/sellers/${this.sellerId}/products`,
      params
    });
    return res.data;
  }

  // === ORDER OPERATIONS ===
  async getOrders(params = {}) {
    const { startDate, endDate, status, page = 0, size = 50 } = params;
    const queryParams = { page, size };
    if (startDate) queryParams.startDate = startDate;
    if (endDate) queryParams.endDate = endDate;
    if (status) queryParams.status = status;

    const res = await this.requestWithRetry({
      method: 'get',
      url: `${this.baseUrl}/order/sellers/${this.sellerId}/orders`,
      params: queryParams
    });
    return res.data;
  }

  async updateShipment(shipmentPackageId, trackingNumber, cargoProviderCode) {
    const payload = { lines: [{ shipmentPackageId }], trackingNumber, cargoProviderCode };
    const res = await this.requestWithRetry({
      method: 'put',
      url: `${this.baseUrl}/order/sellers/${this.sellerId}/shipment-packages/${shipmentPackageId}`,
      data: payload
    });
    return res.data;
  }

  // === QUESTION OPERATIONS ===
  async getQuestions(params = {}) {
    const { page = 0, size = 50, status } = params;
    const queryParams = { page, size };
    if (status) queryParams.status = status;
    const res = await this.requestWithRetry({
      method: 'get',
      url: `${this.baseUrl}/qna/sellers/${this.sellerId}/questions/filter`,
      params: queryParams
    });
    return res.data;
  }

  async answerQuestion(questionId, text) {
    const res = await this.requestWithRetry({
      method: 'post',
      url: `${this.baseUrl}/qna/sellers/${this.sellerId}/questions/${questionId}/answers`,
      data: { text }
    });
    return res.data;
  }

  // Test connection - detaylı hata analizi ile
  async testConnection() {
    try {
      // Supplier'a özgü bir endpoint kullanarak gerçek kimlik doğrulaması yap (addresses endpoint'i her satıcıda çalışır)
      await this.requestWithRetry({
        method: 'get',
        url: `${this.baseUrl}/sellers/${this.sellerId}/addresses`
      });
      return { success: true, message: 'Trendyol bağlantısı başarılı' };
    } catch (error) {
      const status = error.response?.status;
      const isCloudflare = TrendyolService.isCloudflareBlock(error);
      
      if (status === 401) {
        return { success: false, message: 'API Key veya API Secret hatalı (401 Unauthorized).' };
      }
      
      if (status === 403) {
        if (isCloudflare) {
          return { 
            success: false, 
            message: 'Trendyol API\'ye erişim Cloudflare tarafından engelleniyor (403). Bu genellikle IP adresinizin geçici olarak engellendiği anlamına gelir. VPN kullanıyorsanız kapatın, birkaç dakika bekleyip tekrar deneyin. Sorun devam ederse Trendyol destek ile iletişime geçin.',
            cloudflareBlock: true
          };
        }
        return { 
          success: false, 
          message: 'Trendyol API erişimi reddedildi (403). Satıcı ID, API Key veya API Secret bilgilerini kontrol edin. Trendyol Seller Panel → Hesap Bilgilerim → Entegrasyon Bilgileri sayfasından doğru bilgileri aldığınızdan emin olun.'
        };
      }
      
      if (status === 404) {
        return { success: false, message: `Satıcı ID (${this.sellerId}) bulunamadı. Seller Panel'deki Entegrasyon Bilgileri'nden doğru Satıcı ID'yi kontrol edin.` };
      }
      
      if (status === 429) {
        return { success: false, message: 'Çok fazla istek gönderildi (429). Lütfen birkaç saniye bekleyip tekrar deneyin.' };
      }
      
      // Ağ hatası
      if (!error.response) {
        return { success: false, message: `Trendyol API'ye bağlanılamıyor: ${error.message}. İnternet bağlantınızı kontrol edin.` };
      }
      
      return { success: false, message: error.response?.data?.errors?.[0]?.message || error.message };
    }
  }


  // Format product for Trendyol API
  static formatProduct(product, categoryId, brandId, attributes = []) {
    // KDV oranı doğrulama (10 Temmuz sonrası: 0, 1, 10, 20)
    const validVatRates = [0, 1, 10, 20];
    let vatRate = product.vatRate || 10;
    if (!validVatRates.includes(vatRate)) {
      // Eski oranları en yakın yeni orana çevir
      if (vatRate === 8) vatRate = 10;
      else if (vatRate === 18) vatRate = 20;
      else vatRate = 10; // fallback
    }

    return {
      barcode: product.barcode,
      title: product.title,
      productMainId: product.sku,
      brandId: parseInt(brandId),
      categoryId: parseInt(categoryId),
      quantity: product.stock || 0,
      stockCode: product.sku,
      dimensionalWeight: product.desi || 1,
      description: product.description || product.title,
      currencyType: 'TRY',
      listPrice: product.listPrice || product.price,
      salePrice: product.price,
      vatRate: vatRate,
      cargoCompanyId: 17, // Default: Aras Kargo
      images: (typeof product.images === 'string' ? JSON.parse(product.images) : product.images || []).map(url => ({ url })),
      attributes: attributes
    };
  }
}

module.exports = TrendyolService;
