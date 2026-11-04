const { parsePrice } = require('../../utils/parsePrice');

/**
 * Suggests which XML field holds which product attribute, so a brand-new feed works
 * without the user mapping every field by hand. Works from the field list produced by
 * extractFields() (path, key, type, sample) and recognises Turkish, English and
 * Google-Merchant style names. The user can always override the suggestion.
 */

const TR = { 'İ': 'I', 'ı': 'I', 'Ş': 'S', 'ş': 'S', 'Ğ': 'G', 'ğ': 'G', 'Ü': 'U', 'ü': 'U', 'Ö': 'O', 'ö': 'O', 'Ç': 'C', 'ç': 'C' };

/** "g:Ürün_Adı" -> "URUNADI" (upper-case, Turkish letters folded, prefix and punctuation removed) */
function norm(s) {
  return String(s || '')
    .replace(/^[a-z]+:/i, '')
    .replace(/[İıŞşĞğÜüÖöÇç]/g, (c) => TR[c])
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Exact synonyms, in priority order (first existing + sane field wins)
const SYNONYMS = {
  sku: ['URUNKODU', 'STOKKODU', 'STOCKCODE', 'SKU', 'PRODUCTCODE', 'MODELKODU', 'MODELNUMBER', 'MPN', 'PRODUCTID', 'ITEMID', 'OFFERID', 'URUNID', 'KOD', 'ID'],
  barcode: ['BARKOD', 'BARCODE', 'EAN', 'EAN13', 'GTIN', 'UPC', 'ISBN', 'BARKODNO'],
  title: ['URUNADI', 'URUNISMI', 'BASLIK', 'TITLE', 'PRODUCTNAME', 'NAME', 'ADI', 'ISIM', 'AD', 'URUN'],
  description: ['ACIKLAMA', 'URUNACIKLAMA', 'DETAY', 'DESCRIPTION', 'DESC', 'ICERIK', 'LONGDESCRIPTION', 'URUNDETAY'],
  price: ['SATISFIYATI', 'SATISFIYAT', 'SALEPRICE', 'PRICE', 'FIYAT', 'GUNCELFIYAT', 'KDVLIFIYAT', 'KDVDAHILFIYAT', 'BIRIMFIYAT'],
  listPrice: ['LISTEFIYATI', 'LISTPRICE', 'PIYASAFIYATI', 'MARKETPRICE', 'ESKIFIYAT', 'INDIRIMSIZFIYAT', 'MSRP', 'RETAILPRICE'],
  stock: ['STOK', 'STOKMIKTARI', 'STOCK', 'STOCKQUANTITY', 'QUANTITY', 'QTY', 'MIKTAR', 'ADET', 'STOKADEDI', 'INVENTORY'],
  brand: ['MARKA', 'BRAND', 'BRANDNAME', 'MANUFACTURER', 'URETICI', 'MARKAADI', 'VENDOR'],
  category: ['KATEGORI', 'KATEGORIADI', 'KATEGORIYOLU', 'CATEGORY', 'CATEGORYNAME', 'CATEGORYPATH', 'GOOGLEPRODUCTCATEGORY', 'PRODUCTTYPE', 'URUNTIPI', 'ANAKATEGORI'],
};

// Tokens that disqualify a "contains" match for the main price
const PRICE_EXCLUDE = /LISTE|ESKI|PIYASA|ALIS|MALIYET|COST|OLD|LIST|MSRP|INDIRIMSIZ|KARGO|SHIPPING|KDV(?!LI|DAHIL)|PARA|CURRENCY|BIRIM(?!FIYAT)/;
const IMAGE_HINT = /RESIM|IMAGE|IMG|FOTO|GORSEL|PICTURE|PHOTO|THUMB/;

const isUrl = (v) => typeof v === 'string' && /^(https?:)?\/\//i.test(v.trim());
const leaf = (path) => String(path).split('.').pop().replace(/\[\d+\]$/, '');

function sane(target, f) {
  const sample = f.sample;
  if (f.type === 'object') return false; // containers are handled explicitly for images only
  switch (target) {
    case 'price':
    case 'listPrice':
      return parsePrice(sample) > 0;
    case 'stock':
      return sample === null || sample === undefined || sample === '' || /^-?\d+([.,]\d+)?$/.test(String(sample).trim());
    case 'barcode':
      return !isUrl(sample) && String(sample ?? '').length < 60;
    case 'sku':
      return !isUrl(sample) && String(sample ?? '').length < 80;
    case 'category':
      return !isUrl(sample);
    case 'title':
      return !isUrl(sample) && String(sample ?? '').trim().length > 0;
    default:
      return true;
  }
}

/**
 * @param fields  [{ path, key, type, sample, length? }] from extractFields(firstProduct)
 * @returns       { sku, barcode, title, description, price, listPrice, stock, brand, category, images } (paths; missing keys are omitted)
 */
function suggestMapping(fields) {
  const usable = (fields || []).filter((f) => f.type !== 'null' || true);
  const byLeaf = new Map(); // normalised leaf -> [fields]
  for (const f of usable) {
    const k = norm(leaf(f.path));
    if (!byLeaf.has(k)) byLeaf.set(k, []);
    byLeaf.get(k).push(f);
  }
  const used = new Set();
  const out = {};

  const pick = (target) => {
    for (const syn of SYNONYMS[target]) {
      for (const f of byLeaf.get(syn) || []) {
        if (used.has(f.path) || f.path.includes('[')) continue;
        if (!sane(target, f)) continue;
        return f;
      }
    }
    return null;
  };

  // Order matters: claim the specific fields first so generic ones (ID, NAME) do not steal them
  for (const target of ['barcode', 'price', 'listPrice', 'stock', 'brand', 'category', 'description', 'title', 'sku']) {
    const f = pick(target);
    if (f) { out[target] = f.path; used.add(f.path); }
  }

  // Looser fallback for the price: any field mentioning price/fiyat that is not a list/old/cost price
  if (!out.price) {
    const f = usable.find((x) => !used.has(x.path) && /FIYAT|PRICE/.test(norm(x.path)) && !PRICE_EXCLUDE.test(norm(x.path)) && sane('price', x));
    if (f) { out.price = f.path; used.add(f.path); }
  }
  if (!out.sku && out.barcode) out.sku = out.barcode; // some feeds only carry a barcode

  // Images: every field that looks like an image holder (URL leaf, or a list/container of URLs)
  const imgs = [];
  for (const f of usable) {
    if (f.path.includes('[') && !/\[0\]$/.test(f.path)) continue;
    const n = norm(f.path);
    if (!IMAGE_HINT.test(n)) continue;
    if (f.type === 'object') continue; // children are listed separately
    const sample = f.type === 'array' ? null : f.sample;
    if (f.type === 'array' || isUrl(sample) || (typeof sample === 'string' && sample.includes('http'))) {
      imgs.push(f.path.replace(/\[0\]/g, ''));
    }
  }
  if (imgs.length) out.images = [...new Set(imgs)].slice(0, 12).join(',');

  return out;
}

module.exports = { suggestMapping, norm };
