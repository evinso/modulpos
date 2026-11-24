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

const VAT = new Set([0, 1, 8, 10, 18, 20]);
/** the choices of the person, checked: { vatRate, stock, brand, useBarcode } */
function readOptions(o = {}) {
  const vat = o.vatRate === undefined || o.vatRate === '' ? 20 : Number(o.vatRate);
  if (!VAT.has(vat)) throw Object.assign(new Error('KDV oranı 0, 1, 8, 10, 18 ya da 20 olmalı'), { status: 400 });
  const stock = o.stock === undefined || o.stock === '' ? 0 : Number(o.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) throw Object.assign(new Error('Stok 0 veya daha büyük bir tam sayı olmalı'), { status: 400 });
  const brand = clean(o.brand).slice(0, 120);
  return { vatRate: vat, stock, brand, useBarcode: o.useBarcode !== false };
}

/**
 * Writes the chosen rows as hand-added products. @param o { prisma, storeId, items (cached rows), refs, options, room (how many more products the plan allows) }
 * @returns { created, skipped: [{ ref, title, reason: 'exists' (same SKU) | 'barcode' (same barcode) | 'limit' (plan) | 'unknown' }], limitReached }
 */
async function create({ prisma, storeId, items, refs, options, room = Infinity }) {
  const byRef = new Map(items.map((it) => [it.ref, it]));
  const chosen = [...new Set((Array.isArray(refs) ? refs : []).map(Number).filter(Number.isInteger))].map((r) => byRef.get(r) || r);
  const have = await existing(prisma, storeId, chosen.filter((x) => typeof x === 'object'));
  const skipped = []; const data = []; const usedSku = new Set(); const usedCode = new Set(); let limitReached = false;
  for (const x of chosen) {
    if (typeof x !== 'object') { skipped.push({ ref: x, title: '', reason: 'unknown' }); continue; }
    const code = options.useBarcode ? x.barcode : '';
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

module.exports = { MAX_ITEMS, FIELDS, read, fromText, toItem, imageList, safeText, existing, keep, recall, forget, readOptions, create, _cache: cache };
