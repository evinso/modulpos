const express = require('express');
const axios = require('axios');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { auth } = require('../middleware/auth');
const { deductCredits, getSetting } = require('./credits');
const notificationService = require('../services/notificationService');

const router = express.Router();

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/xml, text/xml, */*'
};

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (tagName) => {
    // Only list tags that genuinely repeat as siblings under a parent
    const arrayTags = ['item', 'Urun', 'product', 'Product', 'row', 'entry'];
    return arrayTags.includes(tagName);
  },
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
};

/**
 * Finds the product array in any parsed XML structure
 */
function findProductArray(parsed) {
  const knownPaths = [
    { check: (r) => r?.channel?.item },
    { check: (r) => r?.Products?.Product },
    { check: (r) => r?.products?.product },
    { check: (r) => r?.Urunler?.Urun },
    { check: (r) => r?.urunler?.urun },
    { check: (r) => r?.Items?.Item },
    { check: (r) => r?.items?.item },
    { check: (r) => r?.ProductList?.Product },
    { check: (r) => r?.UrunListesi?.Urun },
    { check: (r) => r?.catalog?.product },
    { check: (r) => r?.root?.product },
    { check: (r) => r?.root?.row },
    { check: (r) => r?.root?.item },
    { check: (r) => r?.data?.product },
    { check: (r) => r?.data?.item },
    { check: (r) => r?.entry },
    { check: (r) => r?.product },
    { check: (r) => r?.item },
    { check: (r) => r?.row },
  ];

  const rootKeys = Object.keys(parsed).filter(k => !k.startsWith('?'));
  for (const rootKey of rootKeys) {
    const root = parsed[rootKey];

    if (Array.isArray(root) && root.length > 0 && typeof root[0] === 'object') {
      return root;
    }

    if (root && typeof root === 'object') {
      for (const { check } of knownPaths) {
        const result = check(root);
        if (result) {
          const arr = Array.isArray(result) ? result : [result];
          if (arr.length > 0 && typeof arr[0] === 'object') return arr;
        }
      }
      // Auto-discover
      for (const childKey of Object.keys(root)) {
        const child = root[childKey];
        if (Array.isArray(child) && child.length > 0 && typeof child[0] === 'object') {
          return child;
        }
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          for (const grandKey of Object.keys(child)) {
            const grandChild = child[grandKey];
            if (Array.isArray(grandChild) && grandChild.length > 0 && typeof grandChild[0] === 'object') {
              return grandChild;
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Gets a scalar value from an object, handling arrays from duplicate tags
 */
function getVal(obj, ...keys) {
  for (const key of keys) {
    const parts = key.split('.');
    let val = obj;
    for (const p of parts) {
      if (val == null) break;
      val = val[p];
      if (Array.isArray(val)) {
        const primitive = val.find(v => typeof v !== 'object');
        val = primitive !== undefined ? primitive : val[0];
      }
    }
    if (val != null && val !== '' && typeof val !== 'object') return String(val).trim();
  }
  return '';
}

/**
 * Extracts image URLs from a product object
 */
function getImages(p) {
  const urls = [];

  // image_link, additional_image_link1, additional_image_link2 ...
  for (const key of Object.keys(p)) {
    if (/^(image_link|additional_image_link\d*)$/i.test(key)) {
      const v = p[key];
      if (typeof v === 'string' && v.startsWith('http')) urls.push(v);
    }
  }

  // resim.resim1, resim.resim2 ...
  if (p.resim && typeof p.resim === 'object' && !Array.isArray(p.resim)) {
    for (const k of Object.keys(p.resim)) {
      const v = p.resim[k];
      if (typeof v === 'string' && v.startsWith('http')) urls.push(v);
    }
  }

  // Images, Image, ImageUrl as string
  const imgFields = ['Images', 'images', 'Image', 'image', 'ImageUrl', 'img', 'Pictures'];
  for (const f of imgFields) {
    if (p[f]) {
      const v = p[f];
      if (typeof v === 'string' && v.startsWith('http')) { urls.push(v); break; }
    }
  }

  return [...new Set(urls)];
}

/**
 * Converts a raw product object from any XML format to our standard format
 */
function normalizeProduct(p) {
  const sku = getVal(p, 'StockCode', 'stockCode', 'sku', 'SKU', 'urunKodu', 'stok_kodu', 'ProductCode', 'model_number', 'id', 'product_id');
  const barcode = getVal(p, 'Barcode', 'barcode', 'Barkod', 'barkod', 'EAN', 'ean', 'gtin');
  const title = getVal(p, 'title', 'Name', 'name', 'Title', 'UrunAdi', 'adi', 'ProductName');
  const description = getVal(p, 'description', 'Description', 'aciklama', 'Aciklama', 'Detail');
  const priceRaw = getVal(p, 'price', 'Price', 'fiyat.son_kullanici', 'Fiyat', 'SalePrice', 'sale_price');
  const listPriceRaw = getVal(p, 'listprice', 'ListPrice', 'listPrice', 'fiyat.bayi_fiyati', 'MarketPrice');
  const stock = getVal(p, 'quantity', 'Quantity', 'stock', 'Stock', 'miktar', 'Miktar', 'Stok');
  const brand = getVal(p, 'brand', 'Brand', 'marka', 'Marka', 'BrandName');
  const category = getVal(p, 'kategori', 'category', 'Category', 'product_type', 'CategoryName');
  const kdv = getVal(p, 'kdv', 'vatRate', 'VatRate', 'vat');

  // Clean price: remove currency codes like "150.00 TRY"
  const cleanPrice = (v) => v ? v.replace(/[^\d.,]/g, '').replace(',', '.') || '0' : '0';

  const images = getImages(p);
  const imageXml = images.length > 0
    ? images.reduce((acc, url, i) => ({ ...acc, [`resim${i + 1}`]: url }), {})
    : {};

  return {
    stok_kodu: sku || barcode,
    barcode: barcode,
    adi: title || 'İsimsiz Ürün',
    aciklama: description,
    fiyat: { son_kullanici: cleanPrice(priceRaw), bayi_fiyati: cleanPrice(listPriceRaw) },
    miktar: stock || '0',
    marka: brand,
    kategori: category,
    kdv: kdv || '10',
    ...(images.length > 0 ? { resim: imageXml } : {}),
  };
}

/**
 * Fetches and converts any XML to our standard Urunler/Urun format
 */
async function convertXml(url) {
  const response = await axios.get(url, {
    timeout: 120000,
    maxContentLength: 200 * 1024 * 1024,
    headers: FETCH_HEADERS,
  });

  const parser = new XMLParser(PARSER_OPTIONS);
  const parsed = parser.parse(response.data);

  const rawProducts = findProductArray(parsed);
  if (!rawProducts || rawProducts.length === 0) {
    throw new Error('XML içinde ürün listesi bulunamadı');
  }

  const normalized = rawProducts.map(normalizeProduct);

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    indentBy: '  ',
    suppressEmptyNode: true,
  });

  const xmlObj = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    Urunler: { Urun: normalized }
  };

  return { xml: builder.build(xmlObj), count: normalized.length };
}

// ── Auth required routes ──────────────────────────────────────────

/**
 * POST /api/xml-converter/preview
 * Returns first 5 products from converted XML as JSON (for UI preview)
 */
router.post('/preview', auth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL zorunludur' });

  try {
    // Kredi kontrolü
    const convertCost = parseFloat(await getSetting('credit_xml_convert', '1'));
    if (convertCost > 0) {
      try {
        await deductCredits(
          req.user.id,
          convertCost,
          'xml_convert',
          `XML Dönüştürme: ${url.substring(0, 60)}...`
        );
      } catch (creditErr) {
        return res.status(402).json({ error: creditErr.message });
      }
    }

    const { xml, count } = await convertXml(url);

    // Parse back to get sample
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true, trimValues: true });
    const reparsed = parser.parse(xml);
    const sample = reparsed?.Urunler?.Urun?.slice(0, 5) || [];

    notificationService.createForUser(req.user.id, {
      title: 'XML Dönüştürüldü',
      message: `${count} ürün başarıyla dönüştürüldü.`,
      type: 'success',
      link: '/xml-converter'
    });

    res.json({ success: true, totalProducts: count, sample, convertedUrl: `/api/xml-converter/proxy?url=${encodeURIComponent(url)}` });
  } catch (err) {
    let msg = err.message;
    if (err.code === 'ECONNABORTED' || msg.includes('timeout')) msg = 'XML sunucusu zaman aşımına uğradı (120s). Sunucu çok yavaş.';
    else if (err.code === 'ENOTFOUND') msg = 'XML sunucusuna ulaşılamadı. URL\'yi kontrol edin.';
    else if (err.response?.status === 403) msg = 'XML sunucusu erişimi reddetti (403 Forbidden).';
    res.status(400).json({ error: msg });
  }
});

// ── Public proxy endpoint (no auth — used as XML source URL) ──────

/**
 * GET /api/xml-converter/proxy?url=<encoded_url>
 * Live proxy: fetches original XML, converts, returns standard Urunler/Urun XML
 * This URL can be used directly as an XML source in the system
 */
router.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('<error>URL parametresi zorunludur</error>');

  try {
    const { xml } = await convertXml(url);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(xml);
  } catch (err) {
    console.error('[Proxy Error] url:', url, '| error:', err.message);
    // 200 dönüyoruz ki analyze endpoint bu URL'yi fetch ettiğinde axios exception fırlatmasın
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><XmlConverterError><message>${err.message.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))}</message></XmlConverterError>`);
  }
});

/**
 * GET /api/xml-converter/download?url=<encoded_url>
 * Download converted XML as a file
 */
router.get('/download', auth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL zorunludur' });

  try {
    const { xml, count } = await convertXml(url);
    const filename = `converted_${count}_products_${Date.now()}.xml`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
