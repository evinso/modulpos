const { normalizePhone } = require('./wahaService');

/**
 * Number lists for the bulk WhatsApp page: a CSV file or numbers pasted into a box (one per line) become rows with a clean number.
 *
 *  - the separator is found by itself (; , tab |), a byte order mark and quoted cells ("Yılmaz, Ali") are understood
 *  - the first row is a header when it holds no number; the number column is found by its header (Telefon, GSM, Cep, Phone ...) or by
 *    looking at which column holds numbers; a name column (Ad, İsim, Ad Soyad ...) is found the same way
 *  - every other column can be used in the message as {column}: "Merhaba {ad}, {sehir} için indirim var"
 *  - numbers are completed the Turkish way (0532…, 532…, +90 532… -> 905321234567); what cannot be a WhatsApp number is reported
 *    with the reason instead of being dropped silently; a number listed twice is kept once
 */

const MAX_ROWS = 5000;
const DELIMITERS = [';', ',', '\t', '|'];

const PHONE_HEADERS = new Set(['telefon', 'tel', 'gsm', 'cep', 'ceptelefonu', 'ceptel', 'numara', 'phone', 'mobile', 'whatsapp', 'msisdn', 'telno', 'telefonno', 'telefonnumarasi', 'cepno', 'gsmno', 'cepnumarasi', 'telefonnumara', 'phonenumber']);
const NAME_HEADERS = new Set(['ad', 'adi', 'isim', 'name', 'adsoyad', 'adisoyadi', 'isimsoyisim', 'fullname', 'musteri', 'musteriadi', 'musteriisim', 'kisi', 'firma', 'firmaadi', 'unvan']);

/** "Ad Soyad" -> "adsoyad", "İl" -> "il": the key a column is known by in {placeholders}. */
function fold(s) {
  return String(s || '').toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

/** Cells as the user sees them: BOM and blanks removed. */
const clean = (s) => String(s == null ? '' : s).replace(/^﻿/, '').trim();

/** Splits text into rows of cells. Quotes ("") may hold the separator and line breaks. */
function splitRecords(text, delim) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const push = () => { row.push(cell); cell = ''; };
  const endRow = () => { push(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (delim && ch === delim) push();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

/** The separator that occurs in the first lines (outside nothing fancy: a count is enough to choose), or null for a one-column list. */
function detectDelimiter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((l) => l.trim()).slice(0, 8);
  if (lines.length === 0) return null;
  let best = null; let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 10 + counts[0];
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

const SCIENTIFIC = /^\s*\d+([.,]\d+)?\s*e\s*\+?\d+\s*$/i;                 // 5,32E+11: what Excel makes of a long number in a number cell
const looksLikePhone = (v) => {
  const s = clean(v);
  if (!s) return false;
  if (SCIENTIFIC.test(s)) return true;
  if (!/^[+()\d\s.\-/]+$/.test(s)) return false;
  const n = s.replace(/\D/g, '').length;
  return n >= 10 && n <= 15;
};

/**
 * One cell -> { phone } or { reason }.
 * Turkish numbers must be mobile numbers (905XXXXXXXXX); other countries are accepted with their country code (11-15 digits).
 */
function cleanPhone(raw) {
  const s = clean(raw);
  if (!s) return { reason: 'Numara boş' };
  if (SCIENTIFIC.test(s)) return { reason: `Excel numarayı bozmuş (${s}). Sütunu “Metin” biçimine çevirip dosyayı yeniden kaydedin.` };
  if (/[a-z]/i.test(s)) return { reason: 'Numarada harf var' };
  const phone = normalizePhone(s);
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10) return { reason: 'Numara çok kısa' };
  if (digits.length > 15) return { reason: 'Numara çok uzun' };
  if (digits.startsWith('0')) return { reason: 'Ülke kodu yok ya da hatalı (905XXXXXXXXX biçiminde yazın)' };
  if (digits.startsWith('90')) {
    if (digits.length !== 12) return { reason: digits.length < 12 ? 'Numara çok kısa (905XXXXXXXXX)' : 'Numara çok uzun (905XXXXXXXXX)' };
    if (digits[2] !== '5') return { reason: 'Cep numarası değil (905… ile başlamalı)' };
    return { phone: digits };
  }
  if (digits.length < 11) return { reason: 'Ülke kodu yok (ör. 905XXXXXXXXX)' };
  return { phone: digits };
}

/**
 * @param text raw text of a CSV file or of the paste box
 * @returns { columns: [{ key, label }], phoneColumn, nameColumn, hasHeader, delimiter,
 *            rows: [{ line, phone, name, vars, valid, duplicate, reason, raw }], total, valid, invalid, duplicates, tooMany }
 */
function parseList(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '');
  const delimiter = detectDelimiter(src);
  const records = splitRecords(src, delimiter).map((r, i) => ({ line: i + 1, cells: r.map(clean) })).filter((r) => r.cells.some((c) => c !== ''));
  const empty = { columns: [], phoneColumn: null, nameColumn: null, hasHeader: false, delimiter, rows: [], total: 0, valid: 0, invalid: 0, duplicates: 0, tooMany: 0 };
  if (records.length === 0) return empty;

  const width = Math.max(...records.map((r) => r.cells.length));
  const hasHeader = !records[0].cells.some(looksLikePhone);
  const headerCells = hasHeader ? records[0].cells : [];
  const body = hasHeader ? records.slice(1) : records;

  // columns: a key per column, unique, usable in {placeholders}
  const used = new Set();
  const columns = [];
  for (let i = 0; i < width; i++) {
    const label = clean(headerCells[i]) || `Sütun ${i + 1}`;
    let key = fold(label) || `sutun${i + 1}`;
    while (used.has(key)) key += '_';
    used.add(key);
    columns.push({ key, label });
  }

  // the number column: by header, else by what the cells look like
  let phoneIdx = -1;
  if (hasHeader) {
    phoneIdx = columns.findIndex((c) => PHONE_HEADERS.has(c.key));
    if (phoneIdx < 0) phoneIdx = columns.findIndex((c) => /(tel|gsm|cep|phone|mobile|numara|whatsapp)/.test(c.key));
  }
  if (phoneIdx < 0) {
    let bestCount = 0;
    for (let i = 0; i < width; i++) {
      const n = body.filter((r) => looksLikePhone(r.cells[i])).length;
      if (n > bestCount) { bestCount = n; phoneIdx = i; }
    }
  }
  if (phoneIdx < 0) phoneIdx = 0;
  let nameIdx = hasHeader ? columns.findIndex((c, i) => i !== phoneIdx && NAME_HEADERS.has(c.key)) : -1;
  if (!hasHeader && width > 1) {
    // without a header: the first column that is not the number and not made of digits is taken as the name
    nameIdx = columns.findIndex((_c, i) => i !== phoneIdx && body.some((r) => r.cells[i] && !/^[\d\s+()\-.,]+$/.test(r.cells[i])));
  }

  const seen = new Set();
  const rows = [];
  let valid = 0; let duplicates = 0;
  for (const rec of body) {
    const raw = rec.cells[phoneIdx] || '';
    const name = nameIdx >= 0 ? (rec.cells[nameIdx] || '').slice(0, 80) : '';
    const vars = {};
    columns.forEach((c, i) => { if (i !== phoneIdx && rec.cells[i]) vars[c.key] = rec.cells[i].slice(0, 200); });
    if (name) vars.ad = vars.ad || name;
    const res = cleanPhone(raw);
    const row = { line: rec.line, raw, phone: res.phone || null, name, vars, valid: false, duplicate: false, reason: res.reason || null };
    if (res.phone) {
      if (seen.has(res.phone)) { row.duplicate = true; row.reason = 'Listede zaten var (bir kez gönderilir)'; duplicates++; }
      else { seen.add(res.phone); row.valid = true; valid++; }
    }
    rows.push(row);
  }
  const tooMany = rows.length > MAX_ROWS ? rows.length : 0;
  return {
    columns: columns.filter((_c, i) => i !== phoneIdx), phoneColumn: columns[phoneIdx].label, nameColumn: nameIdx >= 0 ? columns[nameIdx].label : null,
    hasHeader, delimiter, rows: tooMany ? rows.slice(0, MAX_ROWS) : rows, total: rows.length, valid, invalid: rows.length - valid - duplicates, duplicates, tooMany,
  };
}

// ── message text ─────────────────────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER = /\{\s*([^{}|]+?)\s*(?:\|([^{}]*))?\}/g;
const NAME_ALIASES = new Set(['ad', 'isim', 'name']);

/** Folded keys of the {placeholders} a message uses. */
function placeholdersOf(template) {
  const keys = new Set();
  String(template || '').replace(PLACEHOLDER, (_m, k) => { keys.add(fold(k)); return ''; });
  return [...keys];
}

/**
 * The message for one person. {ad} is the name; {sehir} any other column; {ad|değerli müşterimiz} gives a replacement for people
 * whose cell is empty. An empty value without a replacement leaves nothing behind (and the space before a comma is tidied).
 */
function renderMessage(template, recipient) {
  const vars = recipient && recipient.vars && typeof recipient.vars === 'object' ? recipient.vars : {};
  let blank = false;
  const out = String(template || '').replace(PLACEHOLDER, (_m, k, fallback) => {
    const key = fold(k);
    const value = NAME_ALIASES.has(key) ? (recipient && recipient.name) || vars[key] || vars.ad || '' : vars[key] || '';
    const v = clean(value) || clean(fallback);
    if (!v) blank = true;
    return v;
  });
  return blank ? out.replace(/[ \t]+([,.!?:;])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim() : out;
}

module.exports = { parseList, cleanPhone, renderMessage, placeholdersOf, fold, splitRecords, detectDelimiter, MAX_ROWS, NAME_ALIASES };
