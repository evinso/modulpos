/**
 * Reads a keyword-data FILE the owner exports from a tool that has search volumes (Google Ads Keyword Planner, Keywords Everywhere, Ubersuggest, any spreadsheet).
 * This is how real search volume gets in when no paid data API is connected. The rules are strict on purpose, because a number that is not exact must not become a
 * "search volume": a row is imported only when its volume is an exact number. Everything else is skipped AND counted, with the reason.
 *   exact       1200, "1,200", "1.200", "1 200"
 *   range       "1K – 10K", "100 - 1000"  (Keyword Planner shows ranges for accounts that do not spend)      -> skipped ("range")
 *   rounded     "10K", "1.2M"                                                                              -> skipped ("rounded")
 *   empty       "", "-", "—"                                                                               -> skipped ("empty")
 * The file may be tab, semicolon or comma separated, with a title block above the header (Keyword Planner writes two lines first), quoted cells, a BOM, and
 * any column order. Columns are found by their header name (English); a file without a header is read as "keyword[, volume]".
 */
const fold = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9()%. ]+/g, ' ').replace(/\s+/g, ' ').trim();

const HEAD = {
  keyword: ['keyword', 'keywords', 'search term', 'search terms', 'search query', 'query', 'anahtar kelime', 'kelime'],
  volume: ['avg. monthly searches', 'avg monthly searches', 'average monthly searches', 'monthly searches', 'monthly search volume', 'search volume', 'volume', 'vol', 'searches', 'aylik arama', 'aylik arama hacmi'],
  cpc: ['cpc', 'cpc (usd)', 'cpc usd', 'avg. cpc', 'avg cpc', 'average cpc'],
  competitionIndex: ['competition (indexed value)'],
  competition: ['competition', 'paid competition', 'paid comp', 'comp'],
  difficulty: ['keyword difficulty', 'difficulty', 'kd', 'seo difficulty', 'sd'],
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Cells of every row, quotes and line breaks inside quotes handled. */
function tokenize(text, delim) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 12);
  const score = (d) => lines.reduce((a, l) => a + (l.split(d).length - 1), 0);
  const best = [['\t', score('\t')], [';', score(';')], [',', score(',')]].sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** @returns { kind: 'exact'|'range'|'rounded'|'empty'|'bad', value: number|null } */
function parseVolume(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).replace(/[\u00a0\u202f\u2009]/g, ' ').trim();
  if (s === '' || /^[-–—]+$/.test(s) || /^(n\/?a|null|none)$/i.test(s)) return { kind: 'empty', value: null };
  if (/\d\s*[kKmM]?\s*(?:[–—-]|\bto\b)\s*\d/.test(s)) return { kind: 'range', value: null };
  if (/^\d+(?:[.,]\d+)?\s*[kKmM]$/.test(s)) return { kind: 'rounded', value: null };
  const t = s.replace(/^\+/, '');
  if (/^\d+$/.test(t)) return { kind: 'exact', value: Number(t) };
  if (/^\d{1,3}(?:[, .]\d{3})+$/.test(t)) return { kind: 'exact', value: Number(t.replace(/[, .]/g, '')) };
  return { kind: 'bad', value: null };
}

function parseMoney(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw).replace(/[$€£ ]|usd/gi, '').trim();
  if (s === '' || /^[-–—]+$/.test(s)) return null;
  if (/^\d+,\d{1,4}$/.test(s)) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null;
}

/** "Low" / "Medium" / "High" or a number (0-1 or 0-100) -> { level, value 0..1 }. */
function parseCompetition(raw, { indexed = false } = {}) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (s === '' || /^[-–—]+$/.test(s)) return { level: null, value: null };
  const lv = /^(low|medium|high)$/i.exec(s);
  if (lv) return { level: lv[1].toUpperCase(), value: { LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8 }[lv[1].toUpperCase()] };
  const n = Number(s.replace('%', '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { level: null, value: null };
  const v = indexed || n > 1 ? n / 100 : n;
  return v > 1 ? { level: null, value: null } : { level: null, value: Math.round(v * 10000) / 10000 };
}

const toMonth = (header) => { const m = /(?:searches|volume)?[: ]*\b([a-z]{3})[a-z]*\.?\s+(20\d{2})\b/i.exec(String(header)); return m && MONTHS[m[1].toLowerCase()] ? { month: MONTHS[m[1].toLowerCase()], year: Number(m[2]) } : null; };

/**
 * @param text the file as text (the page decodes UTF-8 / UTF-16 / Windows-1254)
 * @param opts { maxRows }
 * @returns { rows: [{ line, keyword, volume, cpc, competition, competitionLevel, difficulty, monthly }], skipped: { range, rounded, empty, bad, noKeyword }, examples: { range: [...], ... }, columns, delimiter }
 */
function parseKeywordFile(text, { maxRows = 2000 } = {}) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  if (src.includes('\u0000')) { const e = new Error('Dosya UTF-16 olarak okunamadı (boş karakterler var). Dosyayı Excel’de “CSV UTF-8” olarak kaydedip yeniden deneyin.'); e.code = 'encoding'; throw e; }
  const delim = detectDelimiter(src);
  const all = tokenize(src, delim);
  let headerAt = -1; let cols = null;
  for (let i = 0; i < Math.min(all.length, 12); i++) {
    const names = all[i].map(fold);
    const kw = names.findIndex((n) => HEAD.keyword.includes(n));
    if (kw >= 0 && (names.some((n) => HEAD.volume.includes(n)) || names.length >= 2 || i === 0)) {
      const find = (list) => names.findIndex((n) => list.includes(n));
      const monthly = all[i].map((h, idx) => ({ idx, ...toMonth(h) })).filter((m) => m.month);
      cols = { keyword: kw, volume: find(HEAD.volume), cpc: find(HEAD.cpc), competitionIndex: find(HEAD.competitionIndex), competition: find(HEAD.competition), difficulty: find(HEAD.difficulty), monthly };
      headerAt = i; break;
    }
  }
  const out = { rows: [], skipped: { range: 0, rounded: 0, empty: 0, bad: 0, noKeyword: 0 }, examples: { range: [], rounded: [], empty: [], bad: [] }, delimiter: delim === '\t' ? 'tab' : delim, hasHeader: headerAt >= 0, columns: null };
  if (headerAt < 0) {                                                                           // no header: "keyword" or "keyword, volume"
    if (!all.length || all.some((r) => r.length > 3)) { const e = new Error('Anahtar kelime sütunu bulunamadı: dosyanın başlık satırında “Keyword” (ve hacim için “Avg. monthly searches” ya da “Volume”) sütunları olmalı.'); e.code = 'format'; throw e; }
    cols = { keyword: 0, volume: all.some((r) => r.length >= 2) ? 1 : -1, cpc: -1, competitionIndex: -1, competition: -1, difficulty: -1, monthly: [] };
    // a first row whose second cell is not a number is a header we do not know (not a keyword): never import it as data
    if (cols.volume >= 0 && ['bad'].includes(parseVolume(all[0][1]).kind)) { const e = new Error('Anahtar kelime sütunu bulunamadı: dosyanın başlık satırında “Keyword” (ve hacim için “Avg. monthly searches” ya da “Volume”) sütunları olmalı.'); e.code = 'format'; throw e; }
  }
  out.columns = { keyword: true, volume: cols.volume >= 0, cpc: cols.cpc >= 0, competition: cols.competition >= 0 || cols.competitionIndex >= 0, difficulty: cols.difficulty >= 0, monthlyMonths: cols.monthly.length };
  if (cols.volume < 0) { const e = new Error('Hacim sütunu bulunamadı: “Avg. monthly searches”, “Search Volume” ya da “Volume” başlıklı bir sütun gerekli. Hacimsiz kelimeler için “Kelime ekle”yi kullanın.'); e.code = 'format'; throw e; }
  const note = (kind, kw) => { out.skipped[kind]++; if (out.examples[kind] && out.examples[kind].length < 5) out.examples[kind].push(kw); };
  for (let i = headerAt + 1; i < all.length; i++) {
    const r = all[i]; const kw = String(r[cols.keyword] || '').trim();
    if (!kw || !/\p{L}/u.test(kw)) { out.skipped.noKeyword++; continue; }                       // a phrase has letters: a bare number is a damaged row
    const vol = parseVolume(r[cols.volume]);
    if (vol.kind !== 'exact') { note(vol.kind, kw); continue; }
    if (out.rows.length >= maxRows) { const e = new Error(`Tek seferde en fazla ${maxRows} satır içe aktarılabilir; dosyayı bölün.`); e.code = 'too_many'; throw e; }
    const byText = cols.competition >= 0 ? parseCompetition(r[cols.competition]) : { level: null, value: null };
    const byIndex = cols.competitionIndex >= 0 ? parseCompetition(r[cols.competitionIndex], { indexed: true }) : { level: null, value: null };
    const comp = { value: byIndex.value !== null ? byIndex.value : byText.value, level: byText.level || byIndex.level };
    const diffRaw = cols.difficulty >= 0 ? String(r[cols.difficulty] === undefined ? '' : r[cols.difficulty]).replace('%', '').trim() : '';
    const diff = /^\d{1,3}$/.test(diffRaw) ? Number(diffRaw) : NaN;                           // an empty cell is "no data", never 0
    const monthly = cols.monthly.map((m) => ({ year: m.year, month: m.month, searchVolume: (() => { const v = parseVolume(r[m.idx]); return v.kind === 'exact' ? v.value : null; })() })).sort((a, b) => a.year - b.year || a.month - b.month);
    out.rows.push({ line: i + 1, keyword: kw, volume: vol.value, cpc: cols.cpc >= 0 ? parseMoney(r[cols.cpc]) : null, competition: comp.value, competitionLevel: comp.level,
      difficulty: Number.isFinite(diff) && diff >= 0 && diff <= 100 ? Math.round(diff) : null, monthly });
  }
  return out;
}

module.exports = { parseKeywordFile, parseVolume, parseMoney, parseCompetition, tokenize };
