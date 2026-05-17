const express = require('express');
const axios = require('axios');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { auth } = require('../middleware/auth');
const { deductCredits, getSetting } = require('./credits');
const notificationService = require('../services/notificationService');
const { streamProductObjects } = require('../services/xml/xmlParser');

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/xml, text/xml, */*'
};

/** Fallback: download first 5 MB, parse with fast-xml-parser, return raw products array. */
async function bufferedPreviewProducts(url) {
  const res = await axios.get(url, {
    timeout: 60000,
    maxContentLength: 5 * 1024 * 1024,
    maxBodyLength: 5 * 1024 * 1024,
    headers: FETCH_HEADERS,
    decompress: true,
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['item','Urun','product','Product','row','entry'].includes(name),
    allowBooleanAttributes: true,
    parseTagValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(typeof res.data === 'string' ? res.data : String(res.data));
  const rootKeys = Object.keys(parsed).filter(k => !k.startsWith('?'));

  for (const rootKey of rootKeys) {
    const root = parsed[rootKey];
    if (!root || typeof root !== 'object') continue;
    for (const childKey of Object.keys(root)) {
      const child = root[childKey];
      if (Array.isArray(child) && child.length > 0 && typeof child[0] === 'object') return child;
      if (child && typeof child === 'object') {
        for (const grandKey of Object.keys(child)) {
          const grand = child[grandKey];
          if (Array.isArray(grand) && grand.length > 0 && typeof grand[0] === 'object') return grand;
        }
      }
    }
  }
  return [];
}

const router = express.Router();

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

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
});

/** Build XML string for a single normalized product */
function buildProductXml(normalized) {
  return builder.build({ Urun: normalized });
}

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

// ── Auth required routes ──────────────────────────────────────────

/**
 * POST /api/xml-converter/preview
 * Streams first 20 products, returns sample of 5 as JSON.
 */
router.post('/preview', auth, async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL zorunludur' });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const convertCost = parseFloat(await getSetting('credit_xml_convert', '1'));
    if (convertCost > 0) {
      try {
        await deductCredits(req.user.id, convertCost, 'xml_convert', `XML Dönüştürme: ${url.substring(0, 60)}...`);
      } catch (creditErr) {
        return res.status(402).json({ error: creditErr.message });
      }
    }

    // Try SAX streaming first; fall back to buffered parse for non-standard tag names
    let rawProducts = await streamProductObjects(url, { maxProducts: 20 });
    if (!rawProducts || rawProducts.length === 0) {
      console.log('[xml-converter/preview] SAX found 0 products, trying buffered fallback for:', url);
      rawProducts = await bufferedPreviewProducts(url);
    }
    if (!rawProducts || rawProducts.length === 0) throw new Error('XML içinde ürün listesi bulunamadı');

    const sample = rawProducts.slice(0, 5).map(normalizeProduct);

    notificationService.createForUser(req.user.id, {
      title: 'XML Dönüştürüldü',
      message: `XML başarıyla önizlendi (${rawProducts.length} ürün örneği).`,
      type: 'success',
      link: '/xml-converter'
    });

    res.json({
      success: true,
      totalProducts: rawProducts.length,
      sample,
      convertedUrl: `/api/xml-converter/proxy?url=${encodeURIComponent(url)}`
    });
  } catch (err) {
    const rawMsg = err.message || String(err);
    console.error('[xml-converter/preview] error:', rawMsg, '| code:', err.code, '| url:', req.body?.url);
    let msg = rawMsg;
    if (rawMsg.includes('timeout') || err.code === 'ECONNABORTED') msg = 'XML sunucusu zaman aşımına uğradı. Sunucu çok yavaş.';
    else if (err.code === 'ENOTFOUND' || rawMsg.includes('ENOTFOUND')) msg = 'XML sunucusuna ulaşılamadı. URL\'yi kontrol edin.';
    else if (rawMsg.includes('maxContentLength') || rawMsg.includes('maxBodyLength')) msg = 'XML dosyası çok büyük (5 MB önizleme limiti).';
    // Pass the raw technical message so the UI can show it for debugging
    res.status(400).json({ error: msg, detail: rawMsg });
  }
});

// ── Public proxy endpoint (no auth — used as XML source URL) ──────

/**
 * GET /api/xml-converter/proxy?url=<encoded_url>
 * Streams XML → normalizes one product at a time → writes directly to response.
 * Peak memory: O(one product), never buffers the full file.
 */
router.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('<error>URL parametresi zorunludur</error>');

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n<Urunler>\n');

  try {
    await streamProductObjects(url, {
      onProduct: (rawProduct) => {
        const xml = buildProductXml(normalizeProduct(rawProduct));
        res.write(xml + '\n');
      }
    });
    res.write('</Urunler>');
    res.end();
  } catch (err) {
    console.error('[Proxy Error] url:', url, '| error:', err.message);
    res.write(`<XmlConverterError><message>${escapeXml(err.message)}</message></XmlConverterError>`);
    res.write('</Urunler>');
    res.end();
  }
});

/**
 * GET /api/xml-converter/download?url=<encoded_url>
 * Streams XML → normalizes → writes directly to download response.
 */
router.get('/download', auth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL zorunludur' });

  const filename = `converted_${Date.now()}.xml`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n<Urunler>\n');

  try {
    await streamProductObjects(url, {
      onProduct: (rawProduct) => {
        res.write(buildProductXml(normalizeProduct(rawProduct)) + '\n');
      }
    });
    res.write('</Urunler>');
    res.end();
  } catch (err) {
    res.write(`<XmlConverterError><message>${escapeXml(err.message)}</message></XmlConverterError>`);
    res.write('</Urunler>');
    res.end();
  }
});

module.exports = router;
