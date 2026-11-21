/**
 * CSV for Excel (UTF-8 with a byte order mark, so Turkish letters survive). A cell that starts with = + - @ (or a tab/CR) would be run as a formula by
 * a spreadsheet ("CSV injection"): it is prefixed with an apostrophe.
 */
function cell(v) {
  if (v === null || v === undefined) return '';
  let s = Array.isArray(v) ? v.join('; ') : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  const head = columns.map((c) => cell(c.label || c.key)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

module.exports = { toCsv, cell };
