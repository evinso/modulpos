const { bad } = require('./http');

/**
 * Small input checks (no library). Each throws a 400 with a sentence naming the field; callers pass the label the person sees.
 * Everything that reaches the database goes through one of these.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v, label, { min = 0, max = 500, required = false, trim = true, multiline = false } = {}) {
  if (v === undefined || v === null) { if (required) throw bad(`${label} zorunlu`); return ''; }
  if (typeof v !== 'string') throw bad(`${label} metin olmalı`);
  let s = trim ? v.trim() : v;
  if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');
  if (required && s === '') throw bad(`${label} zorunlu`);
  if (s.length < min) throw bad(`${label} en az ${min} karakter olmalı`);
  if (s.length > max) throw bad(`${label} en fazla ${max} karakter olabilir`);
  return s;
}

function int(v, label, { min = -2147483648, max = 2147483647, required = true, nullable = false } = {}) {
  if (v === undefined || v === null || v === '') { if (nullable) return null; if (required) throw bad(`${label} zorunlu`); return undefined; }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) throw bad(`${label} tam sayı olmalı`);
  if (n < min || n > max) throw bad(`${label} ${min} ile ${max} arasında olmalı`);
  return n;
}

function bool(v, label, fallback) {
  if (v === undefined || v === null) { if (fallback !== undefined) return fallback; throw bad(`${label} zorunlu`); }
  if (typeof v !== 'boolean') throw bad(`${label} açık/kapalı (true/false) olmalı`);
  return v;
}

function oneOf(v, label, allowed, { required = true, fallback } = {}) {
  if (v === undefined || v === null || v === '') { if (fallback !== undefined) return fallback; if (required) throw bad(`${label} zorunlu`); return undefined; }
  if (!allowed.includes(v)) throw bad(`${label} şunlardan biri olmalı: ${allowed.join(', ')}`);
  return v;
}

function strList(v, label, { maxItems = 50, maxLen = 120 } = {}) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${label} bir liste olmalı`);
  if (v.length > maxItems) throw bad(`${label} en fazla ${maxItems} öğe içerebilir`);
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') throw bad(`${label} yalnızca metin içerebilir`);
    const t = item.replace(/\s+/g, ' ').trim();
    if (t.length > maxLen) throw bad(`${label} öğeleri en fazla ${maxLen} karakter olabilir`);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

function uuid(v, label, { required = true } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${label} zorunlu`); return null; }
  if (typeof v !== 'string' || !UUID.test(v)) throw bad(`${label} geçersiz`);
  return v.toLowerCase();
}

const email = (v, label = 'E-posta') => {
  const s = str(v, label, { required: true, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad(`${label} geçerli bir adres olmalı`);
  return s;
};

module.exports = { str, int, bool, oneOf, strList, uuid, email, UUID };
