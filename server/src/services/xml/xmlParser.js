const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const sax = require('sax');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/xml, text/xml, */*'
};

// Tags that are always product-level elements
const PRODUCT_TAGS = new Set(['item', 'Item', 'Urun', 'urun', 'product', 'Product', 'row', 'Row', 'entry', 'Entry', 'PRODUCT', 'URUN', 'ITEM']);

// Preview cache stores up to PREVIEW_MAX_BYTES of XML per URL (for analyzeXml only)
const previewCache = new Map();
const PREVIEW_CACHE_TTL = 5 * 60 * 1000;
const PREVIEW_MAX_BYTES = 3 * 1024 * 1024; // 3 MB cap — sufficient for field analysis

// ─── HTTP helpers ────────────────────────────────────────────────────────────

/**
 * Stream URL, collect at most PREVIEW_MAX_BYTES into a string.
 * Destroys the stream early once the cap is reached.
 */
async function fetchPartialStream(url) {
  const cached = previewCache.get(url);
  if (cached && Date.now() - cached.ts < PREVIEW_CACHE_TTL) return cached.data;

  let res;
  try {
    res = await axios.get(url, {
      responseType: 'stream',
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: HEADERS,
      decompress: true,
    });
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error(`XML URL'sine bağlanılamadı: istek zaman aşımına uğradı (${url})`);
    }
    if (err.response) throw new Error(`XML URL'si HTTP ${err.response.status} döndürdü: ${url}`);
    throw new Error(`XML URL'sine erişilemedi: ${err.message}`);
  }

  const chunks = [];
  let totalBytes = 0;

  await new Promise((resolve, reject) => {
    res.data.on('data', (chunk) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      if (totalBytes >= PREVIEW_MAX_BYTES) {
        res.data.destroy();
        resolve();
      }
    });
    res.data.on('end', resolve);
    res.data.on('error', (e) => { if (e.code !== 'ERR_STREAM_DESTROYED') reject(e); else resolve(); });
  });

  const data = Buffer.concat(chunks).toString('utf8');
  previewCache.set(url, { data, ts: Date.now() });

  if (previewCache.size > 15) {
    const now = Date.now();
    for (const [k, v] of previewCache) if (now - v.ts > PREVIEW_CACHE_TTL) previewCache.delete(k);
  }
  return data;
}

// ─── SAX streaming parser ────────────────────────────────────────────────────

/**
 * Stream XML from url via SAX, collect raw product objects.
 * Stops after maxProducts (0 = unlimited).
 * Never buffers the full XML string — memory stays near O(single product).
 *
 * Options:
 *   maxProducts  — stop after N products (0 = all)
 *   responseStream — pre-opened readable stream (skips HTTP fetch)
 *   onProduct    — async callback(product, index) called for each product.
 *                  When provided, returns { count } instead of an array.
 *                  Return false from callback to stop early.
 */
async function streamProductObjects(url, { maxProducts = 0, responseStream, onProduct } = {}) {
  let stream = responseStream;
  if (!stream) {
    let res;
    try {
      res = await axios.get(url, {
        responseType: 'stream',
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: HEADERS,
        decompress: true,
      });
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
        throw new Error(`XML URL'sine bağlanılamadı: istek zaman aşımına uğradı (${url})`);
      }
      if (err.response) throw new Error(`XML URL'si HTTP ${err.response.status} döndürdü: ${url}`);
      throw new Error(`XML URL'sine erişilemedi: ${err.message}`);
    }
    stream = res.data;
  }

  return new Promise((resolve, reject) => {
    const saxStream = sax.createStream(false, { trim: true, normalize: true, xmlns: false });

    const allProducts = onProduct ? null : []; // null = callback mode, no array needed
    let productCount = 0;
    let currentDepth = 0;
    let productTagName = null;
    let productTagDepth = -1;
    let inProduct = false;
    let stack = []; // [{ name, obj, text }]
    let done = false;

    function finish(result) {
      if (done) return;
      done = true;
      try { stream.destroy(); } catch {}
      resolve(result);
    }

    function buildAttrObj(attributes) {
      const obj = {};
      for (const [k, v] of Object.entries(attributes || {})) obj[`@_${k}`] = v;
      return obj;
    }

    function mergeChild(parentObj, childName, value) {
      if (parentObj[childName] === undefined) {
        parentObj[childName] = value;
      } else if (Array.isArray(parentObj[childName])) {
        parentObj[childName].push(value);
      } else {
        parentObj[childName] = [parentObj[childName], value];
      }
    }

    saxStream.on('opentag', ({ name, attributes }) => {
      if (done) return;
      currentDepth++;

      if (!inProduct && PRODUCT_TAGS.has(name)) {
        if (productTagName === null) {
          productTagName = name;
          productTagDepth = currentDepth;
        }
        if (name === productTagName && currentDepth === productTagDepth) {
          inProduct = true;
          stack = [{ name, obj: buildAttrObj(attributes), text: '' }];
          return;
        }
      }

      if (inProduct) {
        stack.push({ name, obj: buildAttrObj(attributes), text: '' });
      }
    });

    saxStream.on('text', (t) => {
      if (!inProduct || stack.length === 0) return;
      stack[stack.length - 1].text += t;
    });

    saxStream.on('cdata', (c) => {
      if (!inProduct || stack.length === 0) return;
      stack[stack.length - 1].text += c;
    });

    saxStream.on('closetag', (name) => {
      if (done) return;

      if (inProduct) {
        const current = stack.pop();

        if (name === productTagName && currentDepth === productTagDepth) {
          inProduct = false;
          const productObj = current.obj;
          if (current.text.trim()) productObj['#text'] = current.text.trim();

          if (onProduct) {
            // Callback mode — don't accumulate, call handler immediately
            Promise.resolve(onProduct(productObj, productCount)).then((cont) => {
              productCount++;
              if (cont === false || (maxProducts > 0 && productCount >= maxProducts)) {
                finish({ count: productCount });
              }
            }).catch(reject);
          } else {
            allProducts.push(productObj);
            productCount++;
            if (maxProducts > 0 && productCount >= maxProducts) {
              finish(allProducts);
              return;
            }
          }
        } else if (stack.length > 0) {
          const parent = stack[stack.length - 1];
          let value;
          if (current.text.trim() !== '' && Object.keys(current.obj).length === 0) {
            value = current.text.trim();
          } else {
            if (current.text.trim()) current.obj['#text'] = current.text.trim();
            value = current.obj;
          }
          mergeChild(parent.obj, name, value);
        }
      }

      currentDepth--;
    });

    saxStream.on('error', (err) => {
      // SAX errors on malformed/truncated XML — resolve with what we collected
      if (onProduct) { if (!done) finish({ count: productCount }); }
      else if (allProducts.length > 0) finish(allProducts);
      else reject(new Error(`XML parse hatası: ${err.message}`));
    });

    saxStream.on('end', () => {
      if (!done) resolve(onProduct ? { count: productCount } : allProducts);
    });

    stream.pipe(saxStream);
  });
}

// ─── analyzeXml ──────────────────────────────────────────────────────────────

async function analyzeXml(url) {
  // Fetch up to 3 MB (prevents OOM on large files; enough for field detection)
  const rawData = await fetchPartialStream(url);
  const dataStr = typeof rawData === 'string' ? rawData : String(rawData);

  if (dataStr.trimStart().startsWith('<!DOCTYPE') || dataStr.trimStart().startsWith('<html')) {
    throw new Error('URL geçerli bir XML döndürmüyor — sunucu HTML sayfası döndürdü. URL\'nin doğrudan XML dosyasına işaret ettiğinden emin olun.');
  }

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

  let parsed;
  try {
    parsed = parser.parse(dataStr);
  } catch (parseErr) {
    // Truncated XML will throw — try to recover a partial object via SAX
    try {
      const { Readable } = require('stream');
      const readable = Readable.from([Buffer.from(dataStr, 'utf8')]);
      const products = await streamProductObjects(null, { maxProducts: 10, responseStream: readable });
      if (products.length === 0) throw new Error('empty');
      return buildAnalysisFromProducts(products);
    } catch {
      throw new Error(`XML parse hatası: ${parseErr.message}. URL geçerli bir XML dosyasına işaret etmiyor olabilir.`);
    }
  }

  if (parsed?.XmlConverterError) {
    const msg = parsed.XmlConverterError?.message || 'Bilinmeyen hata';
    return { success: false, error: `XML dönüştürücü hatası: ${msg}. Orijinal XML kaynağı erişilemiyor olabilir — XML Converter sayfasından yeni bir link oluşturun.` };
  }

  const { rawProducts, productPath } = findProductArray(parsed);

  if (!rawProducts || rawProducts.length === 0) {
    return { success: false, error: 'XML içinde ürün listesi bulunamadı', structure: flattenKeys(parsed) };
  }

  return buildAnalysisFromProducts(rawProducts, productPath);
}

function buildAnalysisFromProducts(rawProducts, productPath) {
  const sampleProduct = rawProducts[0];
  const fields = extractFields(sampleProduct);

  const sampleData = rawProducts.slice(0, 5).map(p => {
    const row = {};
    for (const field of fields) row[field.path] = getNestedValue(p, field.path);
    return row;
  });

  const categoryPaths = ['Category', 'category', 'Kategori', 'kategori', 'CategoryName', 'KategoriAdi', 'product_type'];
  const uniqueCategories = new Set();
  for (const p of rawProducts) {
    for (const cp of categoryPaths) {
      const catVal = getNestedValue(p, cp);
      if (catVal && typeof catVal === 'string') { uniqueCategories.add(catVal.trim()); break; }
    }
  }

  return {
    success: true,
    totalProducts: rawProducts.length,
    productPath: productPath || 'streamed',
    fields,
    sampleData,
    sampleProduct,
    categories: Array.from(uniqueCategories).slice(0, 500),
  };
}

// ─── parseXml ────────────────────────────────────────────────────────────────

/**
 * Parse XML and return mapped product array.
 * Uses SAX streaming to avoid loading the full XML into memory.
 * options.preview = true  → cap at 200 products (for UI preview)
 * options.limit   = N     → return at most N products (0 = all)
 */
async function parseXml(url, mappingConfigStr, options = {}) {
  let mappingConfig = {};
  if (mappingConfigStr) {
    try { mappingConfig = JSON.parse(mappingConfigStr); } catch {}
  }

  const maxProducts = options.preview ? 200 : (options.limit ?? 0);

  let rawProducts;
  try {
    rawProducts = await streamProductObjects(url, { maxProducts });
  } catch (err) {
    throw new Error(`XML parse hatası: ${err.message}`);
  }

  if (!rawProducts || rawProducts.length === 0) {
    // SAX found no known product tags — fall back to buffered parse for unusual formats
    rawProducts = await parseXmlBuffered(url, options);
  }

  if (!rawProducts || rawProducts.length === 0) {
    throw new Error('XML içinde ürün listesi bulunamadı');
  }

  return mapProducts(rawProducts, mappingConfig);
}

/**
 * Fallback buffered parse for XML formats not using standard product tags.
 * Downloads up to 200 MB to handle large but unusual formats.
 */
async function parseXmlBuffered(url, options = {}) {
  const res = await axios.get(url, {
    timeout: 300000,
    maxContentLength: 200 * 1024 * 1024,
    maxBodyLength: 200 * 1024 * 1024,
    headers: HEADERS,
    decompress: true,
  });

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

  const parsed = parser.parse(typeof res.data === 'string' ? res.data : String(res.data));
  const { rawProducts: allProducts } = findProductArray(parsed);

  const limit = options.limit ?? 0;
  return limit > 0 ? allProducts.slice(0, limit) : allProducts;
}

// ─── Product mapping ─────────────────────────────────────────────────────────

function mapProducts(rawProducts, mc) {
  const cleanPrice = (val) => {
    if (!val) return 0;
    const str = String(val).replace(/[^\d.,]/g, '');
    if (!str) return 0;
    const dots   = (str.match(/\./g) || []).length;
    const commas = (str.match(/,/g)  || []).length;

    if (dots >= 2 && commas === 0) {
      const parts = str.split('.');
      return parseFloat(parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]) || 0;
    }
    if (commas >= 2 && dots === 0) {
      const parts = str.split(',');
      return parseFloat(parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]) || 0;
    }
    if (dots >= 1 && commas === 1 && str.lastIndexOf(',') > str.lastIndexOf('.')) {
      return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
    }
    if (commas >= 1 && dots === 1 && str.lastIndexOf('.') > str.lastIndexOf(',')) {
      return parseFloat(str.replace(/,/g, '')) || 0;
    }
    if (dots === 1 && commas === 0) {
      const [intPart, decPart] = str.split('.');
      if (decPart.length === 3 && intPart.length <= 3) return parseFloat(str.replace('.', '')) || 0;
      return parseFloat(str) || 0;
    }
    if (commas === 1 && dots === 0) {
      const [intPart, decPart] = str.split(',');
      if (decPart.length === 3 && intPart.length <= 3) return parseFloat(str.replace(',', '')) || 0;
      return parseFloat(str.replace(',', '.')) || 0;
    }
    return parseFloat(str) || 0;
  };

  return rawProducts.map(p => ({
    sku:         getFieldValue(p, mc.sku,         ['StockCode', 'stockCode', 'sku', 'SKU', 'urunKodu', 'UrunKodu', 'ProductCode', 'productCode', 'Sku', 'id', 'ID', 'model_number', 'mpn', 'g:id', 'g:mpn']),
    barcode:     getFieldValue(p, mc.barcode,     ['Barcode', 'barcode', 'Barkod', 'barkod', 'EAN', 'ean', 'gtin', 'GTIN', 'g:gtin', 'g:barcode']),
    title:       getFieldValue(p, mc.title,       ['Name', 'name', 'Title', 'title', 'UrunAdi', 'urunAdi', 'ProductName', 'productName', 'Baslik', 'g:title']),
    description: getFieldValue(p, mc.description, ['Description', 'description', 'Aciklama', 'aciklama', 'Detay', 'detay', 'Detail', 'g:description']),
    price:       cleanPrice(getFieldValue(p, mc.price,     ['Price', 'price', 'Fiyat', 'fiyat', 'SalePrice', 'salePrice', 'SatisFiyat', 'sale_price', 'g:price', 'g:sale_price'])),
    listPrice:   cleanPrice(getFieldValue(p, mc.listPrice, ['ListPrice', 'listPrice', 'ListeFiyat', 'listeFiyat', 'MarketPrice', 'PiyasaFiyat', 'listprice', 'g:list_price'])),
    cost:        cleanPrice(getFieldValue(p, mc.cost,      ['Cost', 'cost', 'Maliyet', 'maliyet', 'AlisFiyat'])),
    stock:       parseInt(getFieldValue(p, mc.stock,       ['Stock', 'stock', 'Stok', 'stok', 'Quantity', 'quantity', 'Adet', 'Miktar', 'g:quantity']) || 0),
    brand:       getFieldValue(p, mc.brand,       ['Brand', 'brand', 'Marka', 'marka', 'BrandName', 'g:brand']),
    category:    getFieldValue(p, mc.category,    ['Category', 'category', 'Kategori', 'kategori', 'CategoryName', 'KategoriAdi', 'product_type', 'google_product_category', 'g:product_type', 'g:google_product_category']),
    images:      getImagesValue(p, mc.images,     ['Images', 'images', 'Resimler', 'Image', 'image', 'Resim', 'ImageUrl', 'imageUrl', 'img', 'Img', 'Pictures', 'Gorsel', 'gorsel', 'image_link', 'g:image_link', 'additional_image_link', 'g:additional_image_link', 'ProductImage', 'productImage', 'UrunResim', 'urunResim', 'BigImage', 'bigImage', 'MainImage', 'mainImage', 'Thumbnail', 'thumbnail', 'resim_url', 'gorsel_url', 'image_url', 'ImageURL', 'Photo', 'photo', 'Picture', 'picture', 'Foto', 'foto']),
    attributes:  {}
  }));
}

// ─── XML structure helpers ───────────────────────────────────────────────────

function findProductArray(parsed) {
  const knownPaths = [
    { path: 'channel.item',              check: (r) => r?.channel?.item },
    { path: 'Products.Product',          check: (r) => r?.Products?.Product },
    { path: 'products.product',          check: (r) => r?.products?.product },
    { path: 'Urunler.Urun',              check: (r) => r?.Urunler?.Urun },
    { path: 'urunler.urun',              check: (r) => r?.urunler?.urun },
    { path: 'Items.Item',                check: (r) => r?.Items?.Item },
    { path: 'items.item',                check: (r) => r?.items?.item },
    { path: 'ProductList.Product',       check: (r) => r?.ProductList?.Product },
    { path: 'UrunListesi.Urun',          check: (r) => r?.UrunListesi?.Urun },
    { path: 'catalog.product',           check: (r) => r?.catalog?.product },
    { path: 'catalog.products.product',  check: (r) => r?.catalog?.products?.product },
    { path: 'root.product',              check: (r) => r?.root?.product },
    { path: 'root.row',                  check: (r) => r?.root?.row },
    { path: 'root.item',                 check: (r) => r?.root?.item },
    { path: 'data.product',              check: (r) => r?.data?.product },
    { path: 'data.item',                 check: (r) => r?.data?.item },
    { path: 'entry',                     check: (r) => r?.entry },
    { path: 'product',                   check: (r) => r?.product },
    { path: 'item',                      check: (r) => r?.item },
    { path: 'row',                       check: (r) => r?.row },
  ];

  const rootKeys = Object.keys(parsed).filter(k => !k.startsWith('?'));
  if (rootKeys.length === 0) return { rawProducts: [], productPath: null };

  for (const rootKey of rootKeys) {
    const root = parsed[rootKey];
    if (Array.isArray(root) && root.length > 0 && typeof root[0] === 'object') {
      return { rawProducts: root, productPath: rootKey };
    }
    if (root && typeof root === 'object') {
      for (const { path, check } of knownPaths) {
        const result = check(root);
        if (result) {
          const arr = Array.isArray(result) ? result : [result];
          if (arr.length > 0 && typeof arr[0] === 'object') {
            return { rawProducts: arr, productPath: `${rootKey}.${path}` };
          }
        }
      }
      for (const childKey of Object.keys(root)) {
        const child = root[childKey];
        if (Array.isArray(child) && child.length > 0 && typeof child[0] === 'object') {
          return { rawProducts: child, productPath: `${rootKey}.${childKey}` };
        }
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          for (const grandKey of Object.keys(child)) {
            const grandChild = child[grandKey];
            if (Array.isArray(grandChild) && grandChild.length > 0 && typeof grandChild[0] === 'object') {
              return { rawProducts: grandChild, productPath: `${rootKey}.${childKey}.${grandKey}` };
            }
          }
        }
      }
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
      const found = deepFindArray(val, newPath, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractFields(obj, prefix = '', depth = 0) {
  const fields = [];
  if (depth > 4 || !obj || typeof obj !== 'object') return fields;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (val === null || val === undefined) {
      fields.push({ path, key, type: 'null', sample: null });
    } else if (Array.isArray(val)) {
      const sampleVal = val.length > 0 ? (typeof val[0] === 'object' ? JSON.stringify(val[0]).substring(0, 100) : String(val[0])) : '';
      fields.push({ path, key, type: 'array', sample: sampleVal, length: val.length });
      if (val.length > 0 && typeof val[0] === 'object') fields.push(...extractFields(val[0], `${path}[0]`, depth + 1));
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
    const match = part.match(/^(.+)\[(\d+)\]$/);
    if (match) {
      val = val[match[1]];
      if (Array.isArray(val)) val = val[parseInt(match[2])];
    } else {
      val = val[part];
    }
    if (Array.isArray(val)) {
      const primitive = val.find(v => typeof v !== 'object');
      val = primitive !== undefined ? primitive : val[0];
    }
  }
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return JSON.stringify(val).substring(0, 200);
  return String(val);
}

function getFieldValue(obj, mappedField, fallbackFields) {
  if (mappedField && mappedField.trim() !== '') return getNestedValue(obj, mappedField);
  for (const field of fallbackFields) {
    const val = getNestedValue(obj, field);
    if (val !== null && val !== undefined && val !== '') return val;
  }
  return null;
}

function getImagesValue(obj, mappedField, fallbackFields) {
  if (mappedField && mappedField.trim() !== '') {
    const fields = mappedField.split(',').map(s => s.trim()).filter(Boolean);
    const resultImages = [];
    for (const field of fields) {
      const val = getNestedValue(obj, field);
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) { resultImages.push(...parsed); continue; }
      } catch {}
      if (typeof val === 'string') {
        if (val.includes(',') && !val.startsWith('http')) resultImages.push(...val.split(',').map(s => s.trim()).filter(Boolean));
        else resultImages.push(val);
      }
    }
    if (resultImages.length > 0) return resultImages;
  }

  const collectedImages = [];
  for (const key of fallbackFields) {
    const val = obj[key];
    if (!val) continue;
    if (typeof val === 'string') {
      if (val.includes(',')) collectedImages.push(...val.split(',').map(s => s.trim()).filter(Boolean));
      else if (val.startsWith('http') || val.startsWith('//')) collectedImages.push(val);
    } else if (Array.isArray(val)) {
      collectedImages.push(...val.map(v => {
        if (typeof v === 'string') return v;
        return v?.url || v?.Url || v?.URL || v?.src || '';
      }).filter(Boolean));
    } else if (typeof val === 'object' && !Array.isArray(val)) {
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
          if (typeof nested === 'string' && (nested.startsWith('http') || nested.startsWith('//'))) collectedImages.push(nested);
        }
      }
    }
  }

  for (const key of Object.keys(obj)) {
    if (/^(additional_image_link\d*|g:additional_image_link\d*)$/i.test(key)) {
      const val = obj[key];
      if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('//')) && !collectedImages.includes(val)) {
        collectedImages.push(val);
      }
    }
  }

  return collectedImages;
}

module.exports = { parseXml, analyzeXml, streamProductObjects };
