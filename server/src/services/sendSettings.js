/**
 * Per-marketplace "send settings": rules that decide WHAT is sent to a marketplace and HOW it is shaped on the way out.
 * They live in MarketplaceConnection.config.sendSettings and are applied at send time (never to the stored products),
 * so the same product can be sent differently to two marketplaces.
 *
 *   minStock           products with less stock are not sent (already-listed ones are set to 0 so they cannot oversell)
 *   maxStock           quantity sent to the marketplace is capped at this value
 *   requireImage       products without a valid image are not sent
 *   titlePrefix / titleSuffix / titleCase   applied to the title that goes out
 *   maxImages          number of images sent
 */

const CASES = ['none', 'upper', 'lower', 'title'];

const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const nonNeg = (v) => { const n = num(v); return n !== null && n >= 0 ? n : null; };

function normalizeSendSettings(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const maxStock = nonNeg(o.maxStock);
  const maxImages = nonNeg(o.maxImages);
  return {
    minStock: Math.floor(nonNeg(o.minStock) ?? 0),
    maxStock: maxStock !== null && maxStock >= 1 ? Math.floor(maxStock) : null,
    requireImage: !!o.requireImage,
    titlePrefix: String(o.titlePrefix || '').slice(0, 60),
    titleSuffix: String(o.titleSuffix || '').slice(0, 60),
    titleCase: CASES.includes(o.titleCase) ? o.titleCase : 'none',
    maxImages: maxImages !== null && maxImages >= 1 ? Math.floor(maxImages) : null,
  };
}

function parseImageList(raw) {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (Array.isArray(v) ? v : []).map((u) => (typeof u === 'string' ? u : u?.url)).filter(Boolean);
  } catch { return []; }
}

/** Human-readable reasons why the settings keep this product from being sent (empty = allowed). */
function excludedReasons(p, s) {
  const why = [];
  const stock = p.stock ?? 0;
  if (s.minStock > 0 && stock < s.minStock) why.push(`stok (${stock}) minimum stok ayarının (${s.minStock}) altında`);

  if (s.requireImage && !parseImageList(p.images).some((u) => /^https?:\/\//i.test(u))) why.push('görseli yok (ayara göre görselsiz ürün gönderilmez)');
  return why;
}

function titleCase(t) {
  return t.toLocaleLowerCase('tr').replace(/(^|[\s\-/(])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('tr'));
}

/** The title as it will appear on the marketplace. */
function shapeTitle(title, s) {
  if (!title) return title;
  let t = String(title);
  if (s.titleCase === 'upper') t = t.toLocaleUpperCase('tr');
  else if (s.titleCase === 'lower') t = t.toLocaleLowerCase('tr');
  else if (s.titleCase === 'title') t = titleCase(t);
  return `${s.titlePrefix}${t}${s.titleSuffix}`.trim();
}

function shapeImages(raw, s) {
  const imgs = parseImageList(raw);
  return s.maxImages ? imgs.slice(0, s.maxImages) : imgs;
}

/** Quantity to publish: below the minimum it is 0 (so a listed product cannot oversell), above the maximum it is capped. */
function sendStock(stock, s) {
  let v = Math.max(0, Number(stock) || 0);
  if (s.minStock > 0 && v < s.minStock) return 0;
  if (s.maxStock !== null && v > s.maxStock) v = s.maxStock;
  return v;
}

/** Short list of the active settings, for the UI summary. */
function describeSettings(s) {
  const out = [];
  if (s.minStock > 0) out.push(`stok < ${s.minStock} gönderilmez`);
  if (s.maxStock !== null) out.push(`en fazla ${s.maxStock} adet`);
  if (s.requireImage) out.push('görselsiz gönderilmez');
  if (s.titlePrefix || s.titleSuffix || s.titleCase !== 'none') out.push('başlık düzeni');
  if (s.maxImages) out.push(`en fazla ${s.maxImages} görsel`);
  return out;
}

module.exports = { normalizeSendSettings, excludedReasons, shapeTitle, shapeImages, sendStock, describeSettings, parseImageList };
