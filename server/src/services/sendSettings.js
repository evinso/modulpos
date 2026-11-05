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
 *   removeWords        words/phrases taken out of the title AND description that go out (e.g. words the marketplace flags as forbidden)
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
    removeWords: wordList(o.removeWords),
  };
}

/** "Çeyrek, Reşat" or ['Çeyrek', 'Reşat'] -> ['Çeyrek', 'Reşat'] (trimmed, no duplicates, sane sizes) */
function wordList(raw) {
  const items = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const w = String(it || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = w.toLocaleLowerCase('tr');
    if (w && !seen.has(key)) { seen.add(key); out.push(w); }
    if (out.length >= 50) break;
  }
  return out;
}

// Turkish letters match their plain forms too, in either case: "Çeyrek" = "ceyrek" = "ÇEYREK"
const LETTER_CLASS = { a: 'aAâÂ', c: 'cCçÇ', e: 'eEêÊ', g: 'gGğĞ', i: 'iIİıîÎ', o: 'oOöÖôÔ', s: 'sSşŞ', u: 'uUüÜûÛ' };
const escapeRe = (ch) => ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
function letterPattern(ch) {
  const base = ch.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const k = base === 'ı' ? 'i' : base;
  if (LETTER_CLASS[k]) return `[${LETTER_CLASS[k]}]`;
  if (/\p{L}/u.test(ch)) return `[${ch.toLocaleLowerCase('tr')}${ch.toLocaleUpperCase('tr')}]`;
  return escapeRe(ch);
}
const removalCache = new Map();
/** One regex per word list: whole words / phrases only ("Çeyrek" never cuts "Çeyreklik"), any case, any Turkish spelling */
function removalRegex(words) {
  const key = words.join('\u0000');
  if (removalCache.has(key)) return removalCache.get(key);
  const alts = words.map((w) => w.split(' ').map((part) => [...part].map(letterPattern).join('')).join('[\\s\\u00a0]+'));
  const re = alts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'gu') : null;
  if (removalCache.size > 50) removalCache.clear();
  removalCache.set(key, re);
  return re;
}

/** Text without the listed words; the gaps they leave are closed ("A Çeyrek B" -> "A B", "A, Çeyrek, B" -> "A, B"). */
function removeWordsFrom(text, words) {
  if (!text || !words || !words.length) return text;
  const re = removalRegex(words);
  if (!re) return text;
  return String(text).replace(re, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')               // "Kolye (Çeyrek)" -> "Kolye"
    .replace(/([,;])(\s*[,;])+/g, '$1')
    .replace(/[ \t\u00a0]{2,}/g, ' ')
    .replace(/(^|\n)[ \t]+/g, '$1')
    .replace(/^[\s,;\-–|/]+/, '').replace(/[ \t,;\-–|/]+$/, '')
    .replace(/[ \t]+([,;.])/g, '$1');
}

/** The description as it will appear on the marketplace (listed words taken out). */
function shapeDescription(description, s) {
  return removeWordsFrom(description, s.removeWords);
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
  let t = removeWordsFrom(String(title), s.removeWords);
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
  if (s.removeWords && s.removeWords.length) out.push(`${s.removeWords.length} kelime çıkarılır`);
  return out;
}

module.exports = { normalizeSendSettings, excludedReasons, shapeTitle, shapeDescription, removeWordsFrom, shapeImages, sendStock, describeSettings, parseImageList };
