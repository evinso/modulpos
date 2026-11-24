const { parsePrice } = require('../utils/parsePrice');
const xmlHandImport = require('./xmlHandImport');

/**
 * Products ADDED BY HAND (no XML source, no feed price = `isHandAdded`): the workspace to list, edit and change them in bulk. There is no feed to update them, so everything is typed:
 * the price (the NET amount the owner keeps per sale), the stock, the brand, the VAT, the barcode / stock code, the pictures, the Trendyol category.
 * This file is the logic without the database (the routes only read and write): the filters, the plan of a bulk change (with a preview of what would change and what cannot), and the reading of a pasted price / stock list.
 */
const FILTERS = ['all', 'no_price', 'no_stock', 'no_brand', 'no_barcode', 'no_image', 'no_category', 'sent', 'not_sent'];
const SORTS = { createdAt: 'createdAt', updatedAt: 'updatedAt', title: 'title', price: 'price', stock: 'stock', sku: 'sku', brand: 'brand' };
const VAT = [0, 1, 8, 10, 18, 20];
const MAX_BULK = 5000;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const clean = (v) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
const round2 = (n) => Math.round(n * 100) / 100;

/** a hand-added product: the same test as pricingEngine.isHandAdded, as a database filter */
const HAND_WHERE = { xmlSourceId: null, xmlPrice: { lte: 0 } };

/** Prisma `where` for the list / the bulk selection. @param f { q, filter, connectionId (needed for "no_category": the Trendyol connection whose product-level categories are looked at) } */
function whereFor(storeId, f = {}) {
  const filter = FILTERS.includes(f.filter) ? f.filter : 'all'; const and = [];
  const blank = (field) => ({ OR: [{ [field]: null }, { [field]: '' }] });
  if (f.q && clean(f.q)) { const q = clean(f.q).slice(0, 100); and.push({ OR: [{ title: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { barcode: { contains: q, mode: 'insensitive' } }] }); }
  if (filter === 'no_price') and.push({ price: { lte: 0 } });
  else if (filter === 'no_stock') and.push({ stock: { lte: 0 } });
  else if (filter === 'no_brand') and.push(blank('brand'));
  else if (filter === 'no_barcode') and.push(blank('barcode'));
  else if (filter === 'no_image') and.push({ OR: [{ images: null }, { images: '' }, { images: '[]' }] });
  else if (filter === 'no_category' && f.connectionId) and.push({ categoryOverrides: { none: { connectionId: String(f.connectionId) } } });
  else if (filter === 'sent') and.push({ marketplaceProducts: { some: {} } });
  else if (filter === 'not_sent') and.push({ marketplaceProducts: { none: {} } });
  return { storeId, ...HAND_WHERE, ...(and.length ? { AND: and } : {}) };
}

/** how the list is ordered ({ field: dir }) */
const orderFor = (sort, dir) => [{ [SORTS[sort] || 'createdAt']: String(dir).toLowerCase() === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }];

const imageCount = (p) => { try { const l = JSON.parse(p.images || '[]'); return Array.isArray(l) ? l.length : 0; } catch { return 0; } };
const firstImage = (p) => { try { const l = JSON.parse(p.images || '[]'); return Array.isArray(l) && l[0] ? String(l[0]) : null; } catch { return null; } };

// ── a bulk change ─────────────────────────────────────────────────────────────────────────────
const num = (v, label, { min, max, int = false }) => {
  const n = Number(v === '' || v === null || v === undefined ? NaN : v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n)) || n < min || n > max) throw bad(`${label} ${int ? 'tam sayı olmalı' : 'sayı olmalı'} (${min} ile ${max} arası)`);
  return n;
};

/** The change, checked: only the fields that are present are changed. @returns the patch with numbers as numbers; throws a 400 sentence. @param o { count } how many products (for the numbering rules) */
function readPatch(raw, { count = 0 } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}; const out = {};
  if (r.price !== undefined) {
    const mode = r.price.mode === 'percent' ? 'percent' : 'set';
    out.price = mode === 'percent' ? { mode, value: num(r.price.value, 'Fiyat değişimi yüzdesi', { min: -90, max: 1000 }) } : { mode, value: num(r.price.value, 'Net tutar', { min: 0, max: 10000000 }) };
  }
  if (r.stock !== undefined) {
    const mode = r.stock.mode === 'add' ? 'add' : 'set';
    out.stock = mode === 'add' ? { mode, value: num(r.stock.value, 'Stok eklemesi', { min: -1000000, max: 1000000, int: true }) } : { mode, value: num(r.stock.value, 'Stok', { min: 0, max: 1000000, int: true }) };
  }
  if (r.brand !== undefined) { out.brand = clean(r.brand).slice(0, 120); if (!out.brand) throw bad('Marka boş olamaz'); }
  if (r.vatRate !== undefined) { out.vatRate = num(r.vatRate, 'KDV oranı', { min: 0, max: 100, int: true }); if (!VAT.includes(out.vatRate)) throw bad('KDV oranı 0, 1, 8, 10, 18 ya da 20 olmalı'); }
  if (r.status !== undefined) { if (!['active', 'passive'].includes(r.status)) throw bad('Durum “aktif” ya da “pasif” olmalı'); out.status = r.status; }
  if (r.categoryText !== undefined) out.categoryText = r.categoryText === null ? null : clean(r.categoryText).slice(0, 200) || null;
  if (r.title !== undefined) {
    const t = { prefix: clean(r.title.prefix), suffix: clean(r.title.suffix), find: clean(r.title.find), replace: clean(r.title.replace) };
    if (!t.prefix && !t.suffix && !t.find) throw bad('Başlık için bir baş/son ek ya da değiştirilecek metin yazın');
    if (t.prefix.length > 100 || t.suffix.length > 100 || t.find.length > 200 || t.replace.length > 200) throw bad('Başlık metinleri çok uzun'); out.title = t;
  }
  if (r.codes !== undefined) {
    out.codes = xmlHandImport.readCodeRules(r.codes, { count });
    if (out.codes.sku.mode === 'keep' && out.codes.barcode.mode === 'keep') delete out.codes;
  }
  if (!Object.keys(out).length) throw bad('Değiştirilecek bir alan seçin');
  return out;
}

/**
 * What the change would do to each product. @param products [{ id, sku, barcode, title, price, stock, brand, vatRate, status, category, sent }] in a stable order (the numbering rules count by position)
 * @param others { skus: Set, barcodes: Set } of the store's products that are NOT in this change
 * @returns { updates: [{ id, data }], rows: [{ id, title, before, after }], changed, problems: [{ id, title, reason }] }
 */
function planBulk(products, patch, others = { skus: new Set(), barcodes: new Set() }) {
  const updates = []; const rows = []; const problems = []; const claimedSku = new Set(); const claimedCode = new Set();
  products.forEach((p, i) => {
    const data = {}; const before = {}; const after = {}; const set = (field, col, to) => { if (to !== p[col]) { data[col] = to; before[field] = p[col]; after[field] = to; } };
    if (patch.price) { const to = patch.price.mode === 'percent' ? round2(Math.max(0, p.price * (1 + patch.price.value / 100))) : round2(patch.price.value); set('price', 'price', to); }
    if (patch.stock) { const to = patch.stock.mode === 'add' ? Math.max(0, p.stock + patch.stock.value) : patch.stock.value; set('stock', 'stock', to); }
    if (patch.brand !== undefined) set('brand', 'brand', patch.brand);
    if (patch.vatRate !== undefined) set('vatRate', 'vatRate', patch.vatRate);
    if (patch.status !== undefined) set('status', 'status', patch.status);
    if (patch.categoryText !== undefined) set('category', 'category', patch.categoryText);
    if (patch.title) {
      let t = p.title; if (patch.title.find) t = t.split(patch.title.find).join(patch.title.replace); t = clean(`${patch.title.prefix} ${t} ${patch.title.suffix}`.replace(/\s+/g, ' ')).slice(0, 500);
      if (!t) problems.push({ id: p.id, title: p.title, reason: 'Ad boş kalırdı: değişmedi' }); else set('title', 'title', t);
    }
    if (patch.codes) {
      const c = xmlHandImport.codesFor({ ref: i, sku: p.sku, barcode: p.barcode || '' }, patch.codes);
      const skuChanges = c.sku !== p.sku; const codeChanges = (c.barcode || '') !== (p.barcode || '');
      if (skuChanges || codeChanges) {
        let why = '';
        if (p.sent) why = 'Pazaryerine gönderilmiş: stok kodu ve barkod değiştirilemez (değişirse pazaryerinde yeni ürün olur)';
        else if (skuChanges && (others.skus.has(c.sku) || claimedSku.has(c.sku))) why = `Yeni stok kodu (${c.sku}) başka bir üründe var`;
        else if (codeChanges && c.barcode && (others.barcodes.has(c.barcode) || claimedCode.has(c.barcode))) why = `Yeni barkod (${c.barcode}) başka bir üründe var`;
        if (why) problems.push({ id: p.id, title: p.title, reason: `${why}: kodlar değişmedi` });
        else { if (skuChanges) { data.sku = c.sku; before.sku = p.sku; after.sku = c.sku; claimedSku.add(c.sku); } if (codeChanges) { data.barcode = c.barcode || null; before.barcode = p.barcode || ''; after.barcode = c.barcode || ''; if (c.barcode) claimedCode.add(c.barcode); } }
      }
      if (!data.sku) claimedSku.add(p.sku); if (!data.barcode && p.barcode) claimedCode.add(p.barcode);
    }
    if (Object.keys(data).length) { updates.push({ id: p.id, data }); rows.push({ id: p.id, title: p.title, before, after }); }
  });
  return { updates, rows, changed: updates.length, problems };
}

// ── a pasted price / stock list ─────────────────────────────────────────────────────────────────
const isHeaderCell = (c) => /^(sku|barkod|barcode|stok\s*kodu|stok\s*kod|kod|ürün\s*kodu|urun\s*kodu|ürün|urun)$/i.test(clean(c));
const splitLine = (line, d) => (d === 'space' ? line.split(/\s{2,}/) : line.split(d)).map((c) => clean(c));
function delimiterOf(lines) {
  const l = lines.find((x) => x.trim()) || '';
  if (l.includes('\t')) return '\t'; if (l.includes(';')) return ';'; if (l.includes('|')) return '|';
  if ((l.match(/,/g) || []).length >= 2) return ','; if (/\S\s{2,}\S/.test(l)) return 'space';
  return (l.match(/,/g) || []).length === 1 ? ',' : '\t';
}

/** The pasted text -> rows { line, key, price (number | null), stock (integer | null), error? }. Columns: stock code or barcode, net amount, stock (the last two are optional but one of them is needed). A header line is skipped and its names choose the columns. */
function parseList(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n'); const first = lines.findIndex((l) => l.trim());
  if (first < 0) throw bad('Yapıştırılacak bir liste yazın');
  if (lines.filter((l) => l.trim()).length > MAX_BULK) throw bad(`Bir seferde en çok ${MAX_BULK} satır yapıştırılabilir`);
  const d = delimiterOf(lines); let col = { key: 0, price: 1, stock: 2 }; let from = first;
  const head = splitLine(lines[first], d);
  if (isHeaderCell(head[0]) || head.some((c) => /^(fiyat|tutar|net|price|stok|stock|adet)/i.test(c))) {
    from = first + 1;
    const find = (re) => head.findIndex((c) => re.test(c));
    const price = find(/fiyat|tutar|net|price/i); const stock = find(/stok$|stock|adet|^stok\b(?!\s*kod)/i); const key = find(/^(sku|barkod|barcode|stok\s*kod|kod|ürün\s*kod|urun\s*kod)/i);
    col = { key: key >= 0 ? key : 0, price: price >= 0 ? price : (stock === 1 ? -1 : 1), stock: stock >= 0 ? stock : (price === 2 ? -1 : (price >= 0 ? -1 : 2)) };
  }
  const out = [];
  for (let i = from; i < lines.length; i++) {
    const raw = lines[i]; if (!raw.trim()) continue;
    const cells = splitLine(raw, d); const key = clean(cells[col.key]);
    const pc = col.price >= 0 ? clean(cells[col.price]) : ''; const sc = col.stock >= 0 ? clean(cells[col.stock]) : '';
    const row = { line: i + 1, key, price: null, stock: null };
    if (!key) { out.push({ ...row, error: 'Stok kodu / barkod yok' }); continue; }
    if (pc) { if (!/\d/.test(pc)) { out.push({ ...row, error: `Net tutar sayı değil: “${pc.slice(0, 20)}”` }); continue; } const n = parsePrice(pc); if (!(n >= 0) || n > 10000000) { out.push({ ...row, error: `Net tutar geçersiz: “${pc.slice(0, 20)}”` }); continue; } row.price = round2(n); }
    if (sc) { if (!/^\d+$/.test(sc.replace(/[.\s]/g, ''))) { out.push({ ...row, error: `Stok tam sayı olmalı: “${sc.slice(0, 20)}”` }); continue; } row.stock = parseInt(sc.replace(/[.\s]/g, ''), 10); if (row.stock > 1000000) { out.push({ ...row, error: 'Stok çok büyük' }); continue; } }
    if (row.price === null && row.stock === null) { out.push({ ...row, error: 'Net tutar ya da stok yok' }); continue; }
    out.push(row);
  }
  if (!out.length) throw bad('Listede ürün satırı bulunamadı');
  return out;
}

/** Matches the rows with the store's hand-added products (stock code first, then barcode, not case sensitive) and says what each row would do. @param products [{ id, sku, barcode, title, price, stock }] */
function planList(rows, products) {
  const bySku = new Map(); const byCode = new Map();
  for (const p of products) { const s = String(p.sku).toLowerCase(); bySku.set(s, [...(bySku.get(s) || []), p]); if (p.barcode) { const b = String(p.barcode).toLowerCase(); byCode.set(b, [...(byCode.get(b) || []), p]); } }
  const seen = new Map(); const items = []; const updates = [];
  for (const r of rows) {
    if (r.error) { items.push({ ...r, status: 'bad', note: r.error }); continue; }
    const k = r.key.toLowerCase(); const hit = bySku.get(k) || byCode.get(k) || [];
    if (!hit.length) { items.push({ ...r, status: 'unmatched', note: 'Elle eklenen ürünlerde bu kodla ürün yok' }); continue; }
    if (hit.length > 1) { items.push({ ...r, status: 'bad', note: `${hit.length} üründe aynı kod var: hangisi olduğu anlaşılmıyor` }); continue; }
    const p = hit[0];
    if (seen.has(p.id)) { items.push({ ...r, status: 'bad', note: `Bu ürün listede ${seen.get(p.id)}. satırda da var: sonraki alınmaz` }); continue; }
    seen.set(p.id, r.line);
    const data = {}; if (r.price !== null && r.price !== p.price) data.price = r.price; if (r.stock !== null && r.stock !== p.stock) data.stock = r.stock;
    items.push({ ...r, status: Object.keys(data).length ? 'ok' : 'same', note: Object.keys(data).length ? '' : 'Zaten bu değerde', product: { id: p.id, title: p.title, sku: p.sku, price: p.price, stock: p.stock } });
    if (Object.keys(data).length) updates.push({ id: p.id, data });
  }
  const n = (s) => items.filter((x) => x.status === s).length;
  return { items, updates, counts: { rows: items.length, ok: n('ok'), same: n('same'), unmatched: n('unmatched'), bad: n('bad') } };
}

module.exports = { FILTERS, VAT, MAX_BULK, HAND_WHERE, whereFor, orderFor, imageCount, firstImage, readPatch, planBulk, parseList, planList };
