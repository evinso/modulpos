/**
 * Parses a price string in any common format into a Number.
 *   "1874.7" | "1.874,7" | "1,874.70" | "1.874,70 TL" | "₺1 874,70" -> 1874.7
 * Rules: when both "." and "," appear, the last one is the decimal separator.
 * A single repeated separator is a thousands separator. A single separator with
 * exactly 3 trailing digits (e.g. "1.874") is treated as thousands unless the
 * integer part is "0" ("0.125" -> 0.125).
 */
function parsePrice(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;

  const str = String(val).replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (!str) return 0;

  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  let decimalSep = null;

  if (lastDot !== -1 && lastComma !== -1) {
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const parts = str.split(sep);
    if (parts.length === 2) {
      const [intPart, decPart] = parts;
      const looksThousands = decPart.length === 3 && intPart !== '0' && intPart.length <= 3;
      decimalSep = looksThousands ? null : sep;
    }
  }

  let normalized;
  if (decimalSep) {
    const idx = str.lastIndexOf(decimalSep);
    normalized = str.slice(0, idx).replace(/[.,]/g, '') + '.' + str.slice(idx + 1).replace(/[.,]/g, '');
  } else {
    normalized = str.replace(/[.,]/g, '');
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { parsePrice };
