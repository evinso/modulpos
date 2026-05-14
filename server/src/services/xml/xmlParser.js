const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/xml, text/xml, */*'
};

// In-memory cache for preview/analyze downloads — avoids re-downloading during
// the analyze → field-map → preview workflow (same URL hit multiple times in minutes)
const previewCache = new Map();
const PREVIEW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchForPreview(url) {
  const cached = previewCache.get(url);
  if (cached && Date.now() - cached.ts < PREVIEW_CACHE_TTL) return cached.data;

  const res = await axios.get(url, {
    timeout: 30000,
    maxContentLength: 5 * 1024 * 1024, // 5 MB — enough to detect structure and first ~100 products
    headers: HEADERS
  });

  previewCache.set(url, { data: res.data, ts: Date.now() });
  // Evict stale entries to avoid unbounded memory growth
  if (previewCache.size > 15) {
    const now = Date.now();
    for (const [k, v] of previewCache) if (now - v.ts > PREVIEW_CACHE_TTL) previewCache.delete(k);
  }
  return res.data;
}

async function fetchForSync(url) {
  const res = await axios.get(url, {
    timeout: 120000,
    maxContentLength: 200 * 1024 * 1024,
    headers: HEADERS
  });
  return res.data;
}

/**
 * XML'i analiz edip yapısını döndürür.
 * Kullanıcının hangi tag'ları eşleştireceğini görmesi için.
 */
async function analyzeXml(url) {
  const response = { data: await fetchForPreview(url) };
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) => {
      // These tags can appear multiple times in RSS/Google Shopping feeds
      const arrayTags = ['item', 'Urun', 'product', 'Product', 'row', 'entry', 'category', 'product_type', 'filtre', 'resim'];
      return arrayTags.includes(tagName);
    },
    allowBooleanAttributes: true,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(response.data);

  // Ürün dizisini bul
  const { rawProducts, productPath } = findProductArray(parsed);

  if (!rawProducts || rawProducts.length === 0) {
    return { success: false, error: 'XML içinde ürün listesi bulunamadı', structure: flattenKeys(parsed) };
  }

  // İlk üründen tüm alanları çıkar
  const sampleProduct = rawProducts[0];
  const fields = extractFields(sampleProduct);

  // İlk 5 üründen örnek veriler çıkar
  const sampleData = rawProducts.slice(0, 5).map(p => {
    const row = {};
    for (const field of fields) {
      row[field.path] = getNestedValue(p, field.path);
    }
    return row;
  });

  // Extract all unique categories (try common paths if not specified)
  const categoryPaths = ['Category', 'category', 'Kategori', 'kategori', 'CategoryName', 'KategoriAdi', 'product_type'];
  const uniqueCategories = new Set();
  
  for (const p of rawProducts) {
    for (const cp of categoryPaths) {
      const catVal = getNestedValue(p, cp);
      if (catVal && typeof catVal === 'string') {
        uniqueCategories.add(catVal.trim());
        break;
      }
    }
  }

  return {
    success: true,
    totalProducts: rawProducts.length,
    productPath,
    fields,
    sampleData,
    sampleProduct,
    categories: Array.from(uniqueCategories).slice(0, 500) // max 500 categories
  };
}

/**
 * Ürün dizisini XML yapısında bul
 */
function findProductArray(parsed) {
  // Bilinen yapıları kontrol et
  const knownPaths = [
    // RSS / Google Shopping Feed
    { path: 'channel.item', check: (r) => r?.channel?.item },
    // Türk e-ticaret XML formatları
    { path: 'Products.Product', check: (r) => r?.Products?.Product },
    { path: 'products.product', check: (r) => r?.products?.product },
    { path: 'Urunler.Urun', check: (r) => r?.Urunler?.Urun },
    { path: 'urunler.urun', check: (r) => r?.urunler?.urun },
    { path: 'Items.Item', check: (r) => r?.Items?.Item },
    { path: 'items.item', check: (r) => r?.items?.item },
    { path: 'ProductList.Product', check: (r) => r?.ProductList?.Product },
    { path: 'UrunListesi.Urun', check: (r) => r?.UrunListesi?.Urun },
    // Catalog / generic formats
    { path: 'catalog.product', check: (r) => r?.catalog?.product },
    { path: 'catalog.products.product', check: (r) => r?.catalog?.products?.product },
    { path: 'root.product', check: (r) => r?.root?.product },
    { path: 'root.row', check: (r) => r?.root?.row },
    { path: 'root.item', check: (r) => r?.root?.item },
    { path: 'data.product', check: (r) => r?.data?.product },
    { path: 'data.item', check: (r) => r?.data?.item },
    // Atom feed
    { path: 'entry', check: (r) => r?.entry },
    // Flat arrays
    { path: 'product', check: (r) => r?.product },
    { path: 'item', check: (r) => r?.item },
    { path: 'row', check: (r) => r?.row },
  ];

  // XML kök elemanını bul (?xml, ?xml-stylesheet gibi deklarasyonları atla)
  const rootKeys = Object.keys(parsed).filter(k => !k.startsWith('?'));
  if (rootKeys.length === 0) {
    return { rawProducts: [], productPath: null };
  }

  // Her kök elemanı dene
  for (const rootKey of rootKeys) {
    const root = parsed[rootKey];

    // Doğrudan kök bir dizi ise (item, Urun, product gibi her zaman array parse edilenler)
    if (Array.isArray(root) && root.length > 0 && typeof root[0] === 'object') {
      return { rawProducts: root, productPath: rootKey };
    }

    if (root && typeof root === 'object') {
      // Bilinen yolları kontrol et
      for (const { path, check } of knownPaths) {
        const result = check(root);
        if (result) {
          const arr = Array.isArray(result) ? result : [result];
          if (arr.length > 0 && typeof arr[0] === 'object') {
            return { rawProducts: arr, productPath: `${rootKey}.${path}` };
          }
        }
      }

      // Kök elemanının doğrudan alt elemanlarında dizi ara
      for (const childKey of Object.keys(root)) {
        const child = root[childKey];
        if (Array.isArray(child) && child.length > 0 && typeof child[0] === 'object') {
          return { rawProducts: child, productPath: `${rootKey}.${childKey}` };
        }
        // Tek eleman ama obje — içinde dizi olabilir
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          for (const grandKey of Object.keys(child)) {
            const grandChild = child[grandKey];
            if (Array.isArray(grandChild) && grandChild.length > 0 && typeof grandChild[0] === 'object') {
              return { rawProducts: grandChild, productPath: `${rootKey}.${childKey}.${grandKey}` };
            }
          }
        }
      }

      // Derinlemesine dizi ara
      const found = deepFindArray(root, rootKey);
      if (found) return found;
    }
  }

  return { rawProducts: [], productPath: null };
}

function deepFindArray(obj, currentPath, depth = 0) {
  if (depth > 5) return null;
  for (const key of Object.keys(obj || {})) {
    const val = obj[key];
    const newPath = `${currentPath}.${key}`;
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      return { rawProducts: val, productPath: newPath };
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      // Tek obje olan ama aslında liste olan durumlar
      const keys = Object.keys(val);
      if (keys.length > 2) {
        // Muhtemelen tek bir ürün objesi - dizi olarak sarmala
        // Ama altında dizi olabilir, devam et
      }
      const found = deepFindArray(val, newPath, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Bir objeden tüm alan yollarını çıkar (nested dahil)
 */
function extractFields(obj, prefix = '', depth = 0) {
  const fields = [];
  if (depth > 4 || !obj || typeof obj !== 'object') return fields;

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;

    if (val === null || val === undefined) {
      fields.push({ path, key, type: 'null', sample: null });
    } else if (Array.isArray(val)) {
      // Dizi ise ilk elemanının yapısını göster
      const sampleVal = val.length > 0 ? (typeof val[0] === 'object' ? JSON.stringify(val[0]).substring(0, 100) : String(val[0])) : '';
      fields.push({ path, key, type: 'array', sample: sampleVal, length: val.length });
      // Dizi elemanları obje ise alt alanları da çıkar
      if (val.length > 0 && typeof val[0] === 'object') {
        fields.push(...extractFields(val[0], `${path}[0]`, depth + 1));
      }
    } else if (typeof val === 'object') {
      fields.push({ path, key, type: 'object', sample: '' });
      fields.push(...extractFields(val, path, depth + 1));
    } else {
      fields.push({ path, key, type: typeof val, sample: String(val).substring(0, 200) });
    }
  }
  return fields;
}

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const key of Object.keys(obj || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      keys.push(path);
      keys.push(...flattenKeys(val, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function getNestedValue(obj, path) {
  const parts = path.split('.');
  let val = obj;
  for (const part of parts) {
    if (val === null || val === undefined) return null;
    // Dizi indeksi kontrolü: "images[0]" gibi
    const match = part.match(/^(.+)\[(\d+)\]$/);
    if (match) {
      val = val[match[1]];
      if (Array.isArray(val)) val = val[parseInt(match[2])];
    } else {
      val = val[part];
    }
    // If value is an array (from duplicate XML tags), take first non-object element or first element
    if (Array.isArray(val)) {
      const primitive = val.find(v => typeof v !== 'object');
      val = primitive !== undefined ? primitive : val[0];
    }
  }
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return JSON.stringify(val).substring(0, 200);
  return String(val);
}

/**
 * Mapping config ile XML parse et.
 * options.preview = true  → 5 MB cap + cache (for UI preview, analyze)
 * options.limit   = N     → return at most N products (0 = all)
 */
async function parseXml(url, mappingConfigStr, options = {}) {
  const xmlData = options.preview ? await fetchForPreview(url) : await fetchForSync(url);
  const response = { data: xmlData };
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) => {
      const arrayTags = ['item', 'Urun', 'product', 'Product', 'row', 'entry', 'category', 'product_type', 'filtre', 'resim'];
      return arrayTags.includes(tagName);
    },
    allowBooleanAttributes: true,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(response.data);

  let mappingConfig = {};
  if (mappingConfigStr) {
    try { mappingConfig = JSON.parse(mappingConfigStr); } catch {}
  }

  const { rawProducts: allProducts } = findProductArray(parsed);
  if (!allProducts || allProducts.length === 0) {
    throw new Error('XML içinde ürün listesi bulunamadı');
  }

  const limit = options.limit ?? 0;
  const rawProducts = limit > 0 ? allProducts.slice(0, limit) : allProducts;

  const mc = mappingConfig;
  const hasMappings = Object.keys(mc).some(k => mc[k] && mc[k] !== '');

  // Handles Turkish format (1.990,00), European (1.990,00), and standard (1990.50)
  const cleanPrice = (val) => {
    if (!val) return 0;
    let str = String(val).replace(/[^\d.,]/g, ''); // strip currency, spaces etc.
    // Turkish/European: dot as thousands sep, comma as decimal → "1.990,00" → "1990.00"
    if (/\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // Comma as thousands sep, dot as decimal → "1,990.00" → "1990.00"
      str = str.replace(/,(?=\d{3})/g, '').replace(',', '.');
    }
    return parseFloat(str) || 0;
  };

  return rawProducts.map(p => ({
    sku: getFieldValue(p, mc.sku, ['StockCode', 'stockCode', 'sku', 'SKU', 'urunKodu', 'UrunKodu', 'ProductCode', 'productCode', 'Sku', 'id', 'ID', 'model_number', 'mpn', 'g:id', 'g:mpn']),
    barcode: getFieldValue(p, mc.barcode, ['Barcode', 'barcode', 'Barkod', 'barkod', 'EAN', 'ean', 'gtin', 'GTIN', 'g:gtin', 'g:barcode']),
    title: getFieldValue(p, mc.title, ['Name', 'name', 'Title', 'title', 'UrunAdi', 'urunAdi', 'ProductName', 'productName', 'Baslik', 'g:title']),
    description: getFieldValue(p, mc.description, ['Description', 'description', 'Aciklama', 'aciklama', 'Detay', 'detay', 'Detail', 'g:description']),
    price: cleanPrice(getFieldValue(p, mc.price, ['Price', 'price', 'Fiyat', 'fiyat', 'SalePrice', 'salePrice', 'SatisFiyat', 'sale_price', 'g:price', 'g:sale_price'])),
    listPrice: cleanPrice(getFieldValue(p, mc.listPrice, ['ListPrice', 'listPrice', 'ListeFiyat', 'listeFiyat', 'MarketPrice', 'PiyasaFiyat', 'listprice', 'g:list_price'])),
    cost: cleanPrice(getFieldValue(p, mc.cost, ['Cost', 'cost', 'Maliyet', 'maliyet', 'AlisFiyat'])),
    stock: parseInt(getFieldValue(p, mc.stock, ['Stock', 'stock', 'Stok', 'stok', 'Quantity', 'quantity', 'Adet', 'Miktar', 'g:quantity']) || 0),
    brand: getFieldValue(p, mc.brand, ['Brand', 'brand', 'Marka', 'marka', 'BrandName', 'g:brand']),
    category: getFieldValue(p, mc.category, ['Category', 'category', 'Kategori', 'kategori', 'CategoryName', 'KategoriAdi', 'product_type', 'google_product_category', 'g:product_type', 'g:google_product_category']),
    images: getImagesValue(p, mc.images, ['Images', 'images', 'Resimler', 'Image', 'image', 'Resim', 'ImageUrl', 'imageUrl', 'img', 'Img', 'Pictures', 'Gorsel', 'gorsel', 'image_link', 'g:image_link', 'additional_image_link', 'g:additional_image_link', 'ProductImage', 'productImage', 'UrunResim', 'urunResim', 'BigImage', 'bigImage', 'MainImage', 'mainImage', 'Thumbnail', 'thumbnail', 'resim_url', 'gorsel_url', 'image_url', 'ImageURL', 'Photo', 'photo', 'Picture', 'picture', 'Foto', 'foto']),
    attributes: {}
  }));
}

/**
 * Kullanıcının eşleştirdiği alan varsa onu kullan, yoksa varsayılanları dene
 */
function getFieldValue(obj, mappedField, fallbackFields) {
  // Kullanıcı eşleştirme yaptıysa sadece onu kullan
  if (mappedField && mappedField.trim() !== '') {
    return getNestedValue(obj, mappedField);
  }
  // Eşleştirme yoksa varsayılanları dene
  for (const field of fallbackFields) {
    const val = getNestedValue(obj, field);
    if (val !== null && val !== undefined && val !== '') return val;
  }
  return null;
}

function getImagesValue(obj, mappedField, fallbackFields) {
  // Eşleştirme varsa
  if (mappedField && mappedField.trim() !== '') {
    const fields = mappedField.split(',').map(s => s.trim()).filter(Boolean);
    const resultImages = [];
    
    for (const field of fields) {
      const val = getNestedValue(obj, field);
      if (!val) continue;
      
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          resultImages.push(...parsed);
          continue;
        }
      } catch {}
      
      if (typeof val === 'string') {
        if (val.includes(',') && !val.startsWith('http')) {
          resultImages.push(...val.split(',').map(s => s.trim()).filter(Boolean));
        } else {
          resultImages.push(val);
        }
      }
    }
    
    if (resultImages.length > 0) return resultImages;
  }

  // Fallback - collect from ALL matching fields (RSS has image_link + additional_image_link as separate fields)
  const collectedImages = [];
  for (const key of fallbackFields) {
    const val = obj[key];
    if (!val) continue;
    if (typeof val === 'string') {
      if (val.includes(',')) {
        collectedImages.push(...val.split(',').map(s => s.trim()).filter(Boolean));
      } else if (val.startsWith('http') || val.startsWith('//')) {
        collectedImages.push(val);
      }
    } else if (Array.isArray(val)) {
      collectedImages.push(...val.map(v => {
        if (typeof v === 'string') return v;
        return v?.url || v?.Url || v?.URL || v?.src || '';
      }).filter(Boolean));
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      // Handle nested structures like { Image: "url" } or { Image: ["url1","url2"] }
      for (const v of Object.values(val)) {
        if (typeof v === 'string' && (v.startsWith('http') || v.startsWith('//'))) {
          collectedImages.push(v);
        } else if (Array.isArray(v)) {
          collectedImages.push(...v.map(item => {
            if (typeof item === 'string') return item;
            return item?.url || item?.Url || item?.URL || item?.src || item?.['#text'] || '';
          }).filter(s => typeof s === 'string' && (s.startsWith('http') || s.startsWith('//'))));
        } else if (typeof v === 'object' && v !== null) {
          const nested = v?.url || v?.Url || v?.URL || v?.src || v?.['#text'] || '';
          if (typeof nested === 'string' && (nested.startsWith('http') || nested.startsWith('//'))) {
            collectedImages.push(nested);
          }
        }
      }
    }
  }

  // Also scan for additional_image_link1..10, g:additional_image_link patterns
  for (const key of Object.keys(obj)) {
    if (/^(additional_image_link\d*|g:additional_image_link\d*)$/i.test(key)) {
      const val = obj[key];
      if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('//'))) {
        if (!collectedImages.includes(val)) collectedImages.push(val);
      }
    }
  }

  return collectedImages;
}

module.exports = { parseXml, analyzeXml };
