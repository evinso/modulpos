const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

/**
 * XML'i analiz edip yapısını döndürür.
 * Kullanıcının hangi tag'ları eşleştireceğini görmesi için.
 */
async function analyzeXml(url) {
  const response = await axios.get(url, { timeout: 30000, maxContentLength: 100 * 1024 * 1024 });
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
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

  return {
    success: true,
    totalProducts: rawProducts.length,
    productPath,
    fields,
    sampleData,
    sampleProduct
  };
}

/**
 * Ürün dizisini XML yapısında bul
 */
function findProductArray(parsed) {
  // Bilinen yapıları kontrol et
  const knownPaths = [
    { path: 'Products.Product', check: (r) => r?.Products?.Product },
    { path: 'products.product', check: (r) => r?.products?.product },
    { path: 'Urunler.Urun', check: (r) => r?.Urunler?.Urun },
    { path: 'urunler.urun', check: (r) => r?.urunler?.urun },
    { path: 'Items.Item', check: (r) => r?.Items?.Item },
    { path: 'items.item', check: (r) => r?.items?.item },
    { path: 'ProductList.Product', check: (r) => r?.ProductList?.Product },
    { path: 'UrunListesi.Urun', check: (r) => r?.UrunListesi?.Urun },
    { path: 'catalog.product', check: (r) => r?.catalog?.product },
    { path: 'root.product', check: (r) => r?.root?.product },
    { path: 'root.row', check: (r) => r?.root?.row },
    { path: 'data.product', check: (r) => r?.data?.product },
  ];

  // XML kök elemanını bul (?xml, ?xml-stylesheet gibi deklarasyonları atla)
  const rootKeys = Object.keys(parsed).filter(k => !k.startsWith('?'));
  if (rootKeys.length === 0) {
    return { rawProducts: [], productPath: null };
  }

  // Her kök elemanı dene
  for (const rootKey of rootKeys) {
    const root = parsed[rootKey];

    // Doğrudan kök bir dizi ise
    if (Array.isArray(root)) {
      return { rawProducts: root, productPath: rootKey };
    }

    if (root && typeof root === 'object') {
      // Bilinen yolları kontrol et
      for (const { path, check } of knownPaths) {
        const result = check(root);
        if (result) {
          const arr = Array.isArray(result) ? result : [result];
          return { rawProducts: arr, productPath: `${rootKey}.${path}` };
        }
      }

      // Kök elemanının doğrudan alt elemanlarında dizi ara
      for (const childKey of Object.keys(root)) {
        const child = root[childKey];
        if (Array.isArray(child) && child.length > 0 && typeof child[0] === 'object') {
          return { rawProducts: child, productPath: `${rootKey}.${childKey}` };
        }
        // Tek eleman ama obje — içinde dizi olabilir (Products > Product[1] durumu)
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
  }
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return JSON.stringify(val).substring(0, 200);
  return String(val);
}

/**
 * Mapping config ile XML parse et
 */
async function parseXml(url, mappingConfigStr) {
  const response = await axios.get(url, { timeout: 30000, maxContentLength: 100 * 1024 * 1024 });
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(response.data);

  let mappingConfig = {};
  if (mappingConfigStr) {
    try { mappingConfig = JSON.parse(mappingConfigStr); } catch {}
  }

  const { rawProducts } = findProductArray(parsed);
  if (!rawProducts || rawProducts.length === 0) {
    throw new Error('XML içinde ürün listesi bulunamadı');
  }

  const mc = mappingConfig;
  const hasMappings = Object.keys(mc).some(k => mc[k] && mc[k] !== '');

  return rawProducts.map(p => ({
    sku: getFieldValue(p, mc.sku, ['StockCode', 'stockCode', 'sku', 'SKU', 'urunKodu', 'UrunKodu', 'ProductCode', 'productCode', 'Sku']),
    barcode: getFieldValue(p, mc.barcode, ['Barcode', 'barcode', 'Barkod', 'barkod', 'EAN', 'ean']),
    title: getFieldValue(p, mc.title, ['Name', 'name', 'Title', 'title', 'UrunAdi', 'urunAdi', 'ProductName', 'productName', 'Baslik']),
    description: getFieldValue(p, mc.description, ['Description', 'description', 'Aciklama', 'aciklama', 'Detay', 'detay', 'Detail']),
    price: parseFloat(getFieldValue(p, mc.price, ['Price', 'price', 'Fiyat', 'fiyat', 'SalePrice', 'salePrice', 'SatisFiyat']) || 0),
    listPrice: parseFloat(getFieldValue(p, mc.listPrice, ['ListPrice', 'listPrice', 'ListeFiyat', 'listeFiyat', 'MarketPrice', 'PiyasaFiyat']) || 0),
    cost: parseFloat(getFieldValue(p, mc.cost, ['Cost', 'cost', 'Maliyet', 'maliyet', 'AlisFiyat']) || 0),
    stock: parseInt(getFieldValue(p, mc.stock, ['Stock', 'stock', 'Stok', 'stok', 'Quantity', 'quantity', 'Adet', 'Miktar']) || 0),
    brand: getFieldValue(p, mc.brand, ['Brand', 'brand', 'Marka', 'marka', 'BrandName']),
    category: getFieldValue(p, mc.category, ['Category', 'category', 'Kategori', 'kategori', 'CategoryName', 'KategoriAdi']),
    images: getImagesValue(p, mc.images, ['Images', 'images', 'Resimler', 'Image', 'image', 'Resim', 'ImageUrl', 'img', 'Img', 'Pictures', 'Gorsel']),
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

  // Fallback
  for (const key of fallbackFields) {
    const val = obj[key];
    if (!val) continue;
    if (typeof val === 'string') {
      if (val.includes(',')) return val.split(',').map(s => s.trim()).filter(Boolean);
      if (val.startsWith('http')) return [val];
    }
    if (Array.isArray(val)) {
      return val.map(v => {
        if (typeof v === 'string') return v;
        return v?.url || v?.Url || v?.URL || v?.src || '';
      }).filter(Boolean);
    }
    if (typeof val === 'object' && !Array.isArray(val)) {
      const imgs = Object.values(val).filter(v => typeof v === 'string' && (v.startsWith('http') || v.startsWith('//')));
      if (imgs.length) return imgs;
    }
  }
  return [];
}

module.exports = { parseXml, analyzeXml };
