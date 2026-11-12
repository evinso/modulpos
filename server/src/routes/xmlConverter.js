const { safeAxiosOptions } = require('../utils/safeHttp');
const { parsePrice } = require('../utils/parsePrice');
const express = require('express');
const axios = require('axios');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const crypto = require('crypto');
const { auth } = require('../middleware/auth');

// The proxy is public (other systems consume it as an XML source URL), so every URL it will fetch must be
// signed by this server. Without that anyone could use it as a free relay for arbitrary pages.
const signUrl = (url) => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(String(url)).digest('hex');
const validSig = (url, sig) => {
  if (process.env.ALLOW_UNSIGNED_PROXY === '1') return true;
  const a = Buffer.from(signUrl(url)); const b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const { deductCredits, getSetting } = require('./credits');
const notificationService = require('../services/notificationService');
const { streamProductObjects } = require('../services/xml/xmlParser');
const { recordConverted, recordServed, parseHttpDate, statusFor } = require('../services/xml/converterFeeds');

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/xml, text/xml, */*'
};

/** Fallback: download first 5 MB, parse with fast-xml-parser, return raw products array. */
async function bufferedPreviewProducts(url) {
  const res = await axios.get(url, {
    ...safeAxiosOptions(url),
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
  // Build a lowercase-key index once per object for case-insensitive lookup
  // (SAX lax mode uppercases all tag names; fast-xml-parser preserves case)
  const lc = obj && typeof obj === 'object' ? Object.fromEntries(Object.keys(obj).map(k => [k.toLowerCase(), obj[k]])) : {};

  for (const key of keys) {
    const parts = key.split('.');
    let val = obj;
    let lcVal = lc;
    for (const p of parts) {
      if (val == null && lcVal == null) break;
      // Try original case first, then lowercase fallback
      const next = val?.[p] ?? lcVal?.[p.toLowerCase()];
      val = next;
      lcVal = val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.keys(val).map(k => [k.toLowerCase(), val[k]]))
        : null;
      if (Array.isArray(val)) {
        const primitive = val.find(v => typeof v !== 'object');
        val = primitive !== undefined ? primitive : val[0];
        lcVal = null;
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
  // Build a lowercase-key map once for case-insensitive field access
  const lc = {};
  for (const k of Object.keys(p)) lc[k.toLowerCase()] = p[k];

  // image_link, additional_image_link, additional_image_link1 ...
  for (const key of Object.keys(p)) {
    if (/^(image_link|additional_image_link\d*)$/i.test(key)) {
      const v = p[key];
      if (typeof v === 'string' && v.startsWith('http')) urls.push(v);
    }
  }

  // resim / RESIM nested object
  const resim = lc['resim'];
  if (resim && typeof resim === 'object' && !Array.isArray(resim)) {
    for (const v of Object.values(resim)) {
      if (typeof v === 'string' && v.startsWith('http')) urls.push(v);
    }
  }

  // Common image field names — check case-insensitively
  for (const f of ['images', 'image', 'imageurl', 'img', 'pictures', 'gorsel', 'resimurl']) {
    const v = lc[f];
    if (v && typeof v === 'string' && v.startsWith('http')) { urls.push(v); break; }
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
  const cleanPrice = (v) => String(parsePrice(v));

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

/**
 * Writes the converted XML of `url` into `res` (one product at a time, never the whole file in memory) and notes the result
 * (when it was produced, how many products, the supplier's own date) for the page. The note is written after the response ended.
 */
async function streamConverted(url, res, label) {
  let count = 0;
  let modified = null;
  let error = null;
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n<Urunler>\n');
  try {
    await streamProductObjects(url, {
      onHeaders: (h) => { modified = parseHttpDate(h['last-modified']); },
      onProduct: (rawProduct) => {
        count++;
        res.write(buildProductXml(normalizeProduct(rawProduct)) + '\n');
      }
    });
  } catch (err) {
    error = err.message || String(err);
    console.error(`[${label}] url:`, url, '| error:', error);
    res.write(`<XmlConverterError><message>${escapeXml(error)}</message></XmlConverterError>`);
  }
  res.write('</Urunler>');
  res.end();
  recordServed(url, { count, modified, error });
}

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

    // Stream full XML: count all products, keep only first 20 in memory for sampling
    const rawProducts = [];
    let totalProducts = 0;

    let sourceModified = null;
    await streamProductObjects(url, {
      onHeaders: (h) => { sourceModified = parseHttpDate(h['last-modified']); },
      onProduct: (rawProduct) => {
        totalProducts++;
        if (rawProducts.length < 20) rawProducts.push(rawProduct);
      }
    });

    if (totalProducts === 0) {
      console.log('[xml-converter/preview] SAX found 0 products, trying buffered fallback for:', url);
      const buffered = await bufferedPreviewProducts(url);
      if (buffered && buffered.length > 0) {
        rawProducts.push(...buffered.slice(0, 20));
        totalProducts = buffered.length;
      }
    }

    if (totalProducts === 0) throw new Error('XML içinde ürün listesi bulunamadı');

    const sample = rawProducts.slice(0, 5).map(normalizeProduct);

    notificationService.createForUser(req.user.id, {
      title: 'XML Dönüştürüldü',
      message: `XML başarıyla önizlendi (${totalProducts} ürün).`,
      type: 'success',
      link: '/xml-converter'
    });

    // when this converted XML was produced / what the supplier says about its own file (shown on the page; never blocks the answer)
    let feed = null;
    try {
      await recordConverted(url, { count: totalProducts, modified: sourceModified });
      feed = (await statusFor([url]))[url] || null;
    } catch { /* informational only */ }

    res.json({
      success: true,
      totalProducts,
      sample,
      feed,
      convertedUrl: `/api/xml-converter/proxy?url=${encodeURIComponent(url)}&sig=${signUrl(url)}`
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

/**
 * POST /api/xml-converter/feeds/status   { urls: [supplier addresses] }
 * -> { feeds: { [address]: { servedAt, servedOk, servedError, productCount, convertedAt, sourceModifiedAt } | null } }
 * When each converted XML was last produced. Only the addresses sent are looked up (the table has no addresses), no credit is used.
 */
router.post('/feeds/status', auth, async (req, res) => {
  try {
    res.json({ feeds: await statusFor(req.body && req.body.urls) });
  } catch (err) {
    console.error('[xml-converter/feeds/status] error:', err.message);
    res.status(500).json({ error: 'Güncelleme bilgisi okunamadı' });
  }
});

// ── Public proxy endpoint (no auth — used as XML source URL) ──────

/**
 * GET /api/xml-converter/proxy?url=<encoded_url>
 * Streams XML → normalizes one product at a time → writes directly to response.
 * Peak memory: O(one product), never buffers the full file.
 */
router.get('/proxy', async (req, res) => {
  const { url, sig } = req.query;
  if (!url) return res.status(400).send('<error>URL parametresi zorunludur</error>');
  if (!validSig(url, sig)) return res.status(403).send('<error>Geçersiz veya imzasız adres</error>');

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  await streamConverted(url, res, 'Proxy');
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
  await streamConverted(url, res, 'xml-converter/download');
});

module.exports = router;
