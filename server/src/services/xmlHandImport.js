const crypto = require('crypto');
const { Readable } = require('stream');
const { streamProductObjects, createFieldCollector, mapProducts } = require('./xml/xmlParser');
const { suggestMapping } = require('./xml/autoMapping');

/**
 * XML -> products ADDED BY HAND. The owner has the goods but no photos: the name, the description, the pictures (as addresses), the barcode / stock code and the category TEXT come from
 * an XML file or address; everything else is the owner's own and is NEVER taken from the XML: not the (purchase) price, not the brand, not the stock, not the VAT. The products are created exactly
 * like the "Yeni ürün" form creates them (no XML source, no feed price = `isHandAdded`), so no XML sync ever touches them and they are priced/updated by hand afterwards.
 *
 * Two steps, so the page can show what would happen before anything is written:
 *   read()   parses the file / address, keeps the cleaned rows in a short-lived memory cache under a token (a sleeping server forgets it: the page then reads again) and returns a small list
 *   create() takes the token and the chosen row numbers and writes the products (batches), skipping what the store already has (same SKU or barcode) and what the plan's product limit does not allow
 */
const MAX_ITEMS = 5000;                 // rows kept from one reading
const MAX_IMAGES = 12;                  // what a product may carry (same limit as the form)
const MAX_TITLE = 500; const MAX_DESC = 30000; const MAX_CACHE_CHARS = 15 * 1000 * 1000;       // the free hosting has 512 MB: one reading may keep ~30 MB of text
const FIELDS = ['title', 'description', 'images', 'sku', 'barcode', 'category'];
const TTL_MS = 45 * 60 * 1000; const MAX_TOKENS_PER_USER = 1; const MAX_TOKENS = 3;

const cache = new Map();                // token -> { userId, storeId, items, at }

const clean = (v) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
/** a description may carry markup from the supplier: scripts, styles and event handlers never reach the product */
const safeText = (v) => clean(v).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
const hash8 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

/** the picture addresses of one row: http(s) only, protocol-relative ones get https, no duplicates, at most MAX_IMAGES */
function imageList(v) {
  const out = [];
  for (const u of Array.isArray(v) ? v : []) {
    let s = clean(typeof u === 'string' ? u : (u && (u.url || u.Url || u.URL || u.src)) || '');
    if (s.startsWith('//')) s = `https:${s}`;
    if (/^https?:\/\/\S+$/i.test(s) && !out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_IMAGES);
}

/** one mapped XML row -> what a hand-added product takes from it (null when there is no name) */
function toItem(r, ref) {
  const title = clean(r.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE);
  if (!title) return null;
  const barcode = clean(r.barcode).replace(/\s+/g, '').slice(0, 60);
  const given = clean(r.sku).slice(0, 80);
  const sku = given || barcode || `XML-${hash8(title)}`;                      // no code at all: a stable one from the name, so reading the same file again finds the same product
  return { ref, sku, skuGenerated: !given && !barcode, barcode, title, description: safeText(r.description).slice(0, MAX_DESC), images: imageList(r.images), category: clean(r.category).replace(/\s*\|\s*/g, ' / ').slice(0, 200) };      // the parser joins the steps of a category path with "|"
}

/**
 * Reads products from an XML stream or address. @param o { url | stream, mapping (paths the person chose: { title, description, images, sku, barcode, category }) }
 * @returns { total, truncated, mapping (the paths actually used), fields: [{ path, sample }], items }   (items are full rows; the route keeps them and sends a short list)
 */
async function read({ url, stream, mapping = {}, cap = MAX_ITEMS } = {}) {
  const raw = []; const collector = createFieldCollector(); let total = 0;
  await streamProductObjects(url, {
    responseStream: stream,
    onProduct: (p) => { total++; if (total <= 2000 || total % 25 === 0) collector.add(p); if (raw.length < cap) raw.push(p); },
  });
  if (!total) throw Object.assign(new Error('XML içinde ürün bulunamadı. Dosyanın ürün listesi içeren bir XML olduğundan emin olun.'), { status: 422 });
  const auto = suggestMapping(collector.fields());
  const used = {};
  for (const k of FIELDS) { const v = clean(mapping && mapping[k]); if (v) used[k] = v; else if (auto[k]) used[k] = auto[k]; }
  const rows = mapProducts(raw, used);
  const items = []; const seen = new Set(); let noName = 0; let duplicatesInFile = 0;
  for (const r of rows) {
    const it = toItem(r, items.length);
    if (!it) { noName++; continue; }
    if (seen.has(it.sku)) { duplicatesInFile++; continue; }                    // the same SKU twice in the file is one product
    seen.add(it.sku); items.push(it);
  }
  return { total, truncated: total > raw.length, mapping: used, fields: collector.fields().filter((f) => f.type !== 'object').map((f) => ({ path: f.path, sample: f.sample === null ? '' : String(f.sample).slice(0, 80) })), items, noName, duplicatesInFile };
}

const fromText = (text) => Readable.from([Buffer.from(String(text), 'utf8')], { objectMode: false });

/** which of these items the store already has (same SKU, or the same non-empty barcode): Map(ref -> 'sku' | 'barcode') */
async function existing(prisma, storeId, items) {
  const rows = await prisma.product.findMany({ where: { storeId }, select: { sku: true, barcode: true } });
  const skus = new Set(rows.map((r) => String(r.sku))); const codes = new Set(rows.map((r) => r.barcode).filter(Boolean).map(String));
  const out = new Map();
  for (const it of items) { if (skus.has(it.sku)) out.set(it.ref, 'sku'); else if (it.barcode && codes.has(it.barcode)) out.set(it.ref, 'barcode'); }
  return out;
}

/**
 * What every row would get under the rules and what the store already has: { rows: [{ ref, sku, barcode, exists: 'sku' | 'barcode' | 'file' | null }], conflicts }.
 * 'file' = another row of the same reading ends with the same code (only the first one is written).
 */
async function preview({ prisma, storeId, items, rules }) {
  const mapped = items.map((it) => ({ ref: it.ref, ...codesFor(it, rules) }));
  const have = await existing(prisma, storeId, mapped); const skus = new Set(); const codes = new Set();
  const rows = mapped.map((m) => {
    let exists = have.get(m.ref) || null;
    if (!exists && skus.has(m.sku)) exists = 'file'; else if (!exists && m.barcode && codes.has(m.barcode)) exists = 'file';
    if (!exists) { skus.add(m.sku); if (m.barcode) codes.add(m.barcode); }
    return { ref: m.ref, sku: m.sku, barcode: m.barcode, exists };
  });
  return { rows, conflicts: rows.filter((r) => r.exists).length };
}

// ── the short-lived cache of one reading ───────────────────────────────────────────────────────
function sweep(now = Date.now()) { for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k); }
function keep({ userId, storeId, items, now = Date.now() }) {
  sweep(now);
  const chars = items.reduce((n, it) => n + it.description.length + it.title.length + 200, 0);
  if (chars > MAX_CACHE_CHARS) throw Object.assign(new Error('Dosya çok büyük (açıklamalar çok uzun): daha küçük parçalara bölüp ayrı ayrı ekleyin'), { status: 413 });
  const mine = [...cache.entries()].filter(([, v]) => v.userId === userId).sort((a, b) => a[1].at - b[1].at);
  while (mine.length >= MAX_TOKENS_PER_USER) cache.delete(mine.shift()[0]);
  while (cache.size >= MAX_TOKENS) cache.delete([...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
  const token = crypto.randomBytes(12).toString('hex'); cache.set(token, { userId, storeId, items, at: now });
  return token;
}
function recall(token, { userId, storeId, now = Date.now() }) {
  sweep(now); const e = cache.get(String(token || ''));
  if (!e || e.userId !== userId || e.storeId !== storeId) throw Object.assign(new Error('Okunan dosyanın süresi doldu (sunucu yeniden başlamış ya da 45 dakika geçmiş olabilir): dosyayı yeniden okuyun'), { status: 410 });
  return e;
}
const forget = (token) => cache.delete(String(token || ''));

// ── stock codes and barcodes: ONE rule for each, applied to every product ───────────────────────────────────────────────
// The XML's codes are the supplier's; the owner may want their own. Each of the two has a single choice:
//   stock code (sku):  keep | affix (text before / after) | replace (find -> replace) | barcode (use the XML's barcode) | counter (own numbering: prefix + number + suffix)
//   barcode:           keep | none | sku (same as the final stock code) | affix | replace | generate (own EAN-13 for in-store use: a prefix of digits + a running number + the check digit)
// A number is `start + row number`, so reading the same file again gives the same codes. The rule is checked here (never trusted from the page) and the preview and the write use the same function.
const SKU_MODES = ['keep', 'affix', 'replace', 'barcode', 'counter']; const BAR_MODES = ['keep', 'none', 'sku', 'affix', 'replace', 'generate'];
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const text = (v, max, label) => { const t = clean(v); if (t.length > max) throw bad(`${label} en çok ${max} karakter olabilir`); return t; };

/** @returns { sku: {...}, barcode: {...} } with every field checked; throws a 400 sentence. @param count how many rows there are (a running number must not overflow its width) */
function readCodeRules(o = {}, { count = 0 } = {}) {
  const s = (o && o.sku) || {}; const b = (o && o.barcode) || {};
  const sm = s.mode || 'keep'; const bm = b.mode || 'keep';
  if (!SKU_MODES.includes(sm)) throw bad('Stok kodu kuralı geçersiz'); if (!BAR_MODES.includes(bm)) throw bad('Barkod kuralı geçersiz');
  const sku = { mode: sm, prefix: text(s.prefix, 30, 'Stok kodu başı'), suffix: text(s.suffix, 30, 'Stok kodu sonu'), find: text(s.find, 60, 'Aranan metin'), replace: text(s.replace, 60, 'Yeni metin'), start: 1, pad: 4 };
  const bar = { mode: bm, prefix: text(b.prefix, 30, 'Barkod başı'), suffix: text(b.suffix, 30, 'Barkod sonu'), find: text(b.find, 60, 'Aranan metin'), replace: text(b.replace, 60, 'Yeni metin'), start: 1, digits: '200' };
  if (sm === 'replace' && !sku.find) throw bad('Stok kodunda değiştirilecek metni yazın');
  if (bm === 'replace' && !bar.find) throw bad('Barkodda değiştirilecek metni yazın');
  if (sm === 'affix' && !sku.prefix && !sku.suffix) throw bad('Stok kodu için bir baş ya da son ek yazın');
  if (bm === 'affix' && !bar.prefix && !bar.suffix) throw bad('Barkod için bir baş ya da son ek yazın');
  if (sm === 'counter') {
    const start = Number(s.start === undefined || s.start === '' ? 1 : s.start); const pad = Number(s.pad === undefined || s.pad === '' ? 4 : s.pad);
    if (!Number.isInteger(start) || start < 0 || start > 99999999) throw bad('Stok kodu başlangıç numarası 0 ile 99.999.999 arasında olmalı'); if (!Number.isInteger(pad) || pad < 1 || pad > 10) throw bad('Basamak sayısı 1 ile 10 arasında olmalı');
    Object.assign(sku, { start, pad });
  }
  if (bm === 'generate') {
    const digits = clean(b.digits === undefined || b.digits === '' ? '200' : b.digits); const start = Number(b.start === undefined || b.start === '' ? 1 : b.start);
    if (!/^\d{1,8}$/.test(digits)) throw bad('Barkod başı 1 ile 8 haneli rakamlardan oluşmalı (ör. 200)');
    if (!Number.isInteger(start) || start < 0) throw bad('Barkod başlangıç numarası 0 ya da daha büyük bir tam sayı olmalı');
    const width = 12 - digits.length; if (start + Math.max(0, count - 1) >= 10 ** width) throw bad(`Bu barkod başıyla en çok ${10 ** width} ürüne numara verilebilir; daha kısa bir baş yazın`);
    Object.assign(bar, { digits, start, width });
  }
  return { sku, barcode: bar };
}

/** EAN-13 check digit of the first 12 digits */
const ean13 = (body12) => { let n = 0; for (let i = 0; i < 12; i++) n += Number(body12[i]) * (i % 2 ? 3 : 1); return `${body12}${(10 - (n % 10)) % 10}`; };
const swap = (v, r) => String(v).split(r.find).join(r.replace);

/** the stock code and barcode a row gets under the rules: { sku, barcode } (an emptied stock code falls back to the XML's) */
function codesFor(item, rules) {
  const { sku: s, barcode: b } = rules;
  let sku = item.sku;
  if (s.mode === 'affix') sku = `${s.prefix}${sku}${s.suffix}`;
  else if (s.mode === 'replace') sku = swap(sku, s);
  else if (s.mode === 'barcode') sku = item.barcode || sku;
  else if (s.mode === 'counter') sku = `${s.prefix}${String(s.start + item.ref).padStart(s.pad, '0')}${s.suffix}`;
  sku = clean(sku).replace(/\s+/g, ' ').slice(0, 80) || item.sku;
  let barcode = item.barcode;
  if (b.mode === 'none') barcode = '';
  else if (b.mode === 'sku') barcode = sku;
  else if (b.mode === 'affix') barcode = barcode ? `${b.prefix}${barcode}${b.suffix}` : '';
  else if (b.mode === 'replace') barcode = barcode ? swap(barcode, b) : '';
  else if (b.mode === 'generate') barcode = ean13(`${b.digits}${String(b.start + item.ref).padStart(b.width, '0')}`);
  return { sku, barcode: clean(barcode).replace(/\s+/g, '').slice(0, 60) };
}

const VAT = new Set([0, 1, 8, 10, 18, 20]);
/** the choices of the person, checked: { vatRate, stock, brand, useBarcode } */
function readOptions(o = {}, { count = 0 } = {}) {
  const vat = o.vatRate === undefined || o.vatRate === '' ? 20 : Number(o.vatRate);
  if (!VAT.has(vat)) throw Object.assign(new Error('KDV oranı 0, 1, 8, 10, 18 ya da 20 olmalı'), { status: 400 });
  const stock = o.stock === undefined || o.stock === '' ? 0 : Number(o.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) throw Object.assign(new Error('Stok 0 veya daha büyük bir tam sayı olmalı'), { status: 400 });
  const brand = clean(o.brand).slice(0, 120);
  const codes = readCodeRules(o.codes || (o.useBarcode === false ? { barcode: { mode: 'none' } } : {}), { count });      // the older "use the barcode" box is the barcode rule "none"
  return { vatRate: vat, stock, brand, useBarcode: codes.barcode.mode !== 'none', codes };
}

/**
 * Writes the chosen rows as hand-added products. @param o { prisma, storeId, items (cached rows), refs, options, room (how many more products the plan allows) }
 * @returns { created, skipped: [{ ref, title, reason: 'exists' (same SKU) | 'barcode' (same barcode) | 'limit' (plan) | 'unknown' }], limitReached }
 */
async function create({ prisma, storeId, items, refs, options, room = Infinity }) {
  const rules = options.codes || readCodeRules({ barcode: { mode: options.useBarcode === false ? 'none' : 'keep' } });
  const byRef = new Map(items.map((it) => [it.ref, { ...it, ...codesFor(it, rules) }]));                  // the codes the rules give; everything else of the row is the XML's
  const chosen = [...new Set((Array.isArray(refs) ? refs : []).map(Number).filter(Number.isInteger))].map((r) => byRef.get(r) || r);
  const have = await existing(prisma, storeId, chosen.filter((x) => typeof x === 'object'));
  const skipped = []; const data = []; const usedSku = new Set(); const usedCode = new Set(); let limitReached = false;
  for (const x of chosen) {
    if (typeof x !== 'object') { skipped.push({ ref: x, title: '', reason: 'unknown' }); continue; }
    const code = x.barcode;
    const h = have.get(x.ref);
    if (h === 'sku' || usedSku.has(x.sku)) { skipped.push({ ref: x.ref, title: x.title, reason: 'exists' }); continue; }
    if (h === 'barcode' || (code && usedCode.has(code))) { skipped.push({ ref: x.ref, title: x.title, reason: 'barcode' }); continue; }
    if (data.length >= room) { limitReached = true; skipped.push({ ref: x.ref, title: x.title, reason: 'limit' }); continue; }
    usedSku.add(x.sku); if (code) usedCode.add(code);
    data.push({ storeId, sku: x.sku, barcode: code || null, title: x.title, description: x.description || null, price: 0, cost: 0, listPrice: 0, stock: options.stock, brand: options.brand || null,
      category: x.category || null, images: x.images.length ? JSON.stringify(x.images) : null, vatRate: options.vatRate, status: 'active' });
  }
  if (data.length) await prisma.product.createMany({ data });
  return { created: data.length, skipped, limitReached };
}

module.exports = { MAX_ITEMS, FIELDS, read, fromText, toItem, imageList, safeText, existing, preview, keep, recall, forget, readOptions, readCodeRules, codesFor, ean13, create, _cache: cache };
