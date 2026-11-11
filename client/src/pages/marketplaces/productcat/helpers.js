export const SOURCE_LABEL = { manual: 'Elle seçildi', rule: 'Öneri uygulandı', ai: 'Yapay zeka' };

export const STATUS_OPTIONS = [
  { value: 'missing', label: 'Kategorisi olmayanlar' },
  { value: 'assigned', label: 'Ürüne özel kategorisi olanlar' },
  { value: 'mapped', label: 'Kategori eşleştirmesiyle gidenler' },
  { value: 'all', label: 'Tümü' },
];

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** "A > B > C > D" -> "C › D" (the full path stays in the tooltip) */
export function shortPath(path, levels = 2) {
  return String(path || '').split(' > ').slice(-levels).join(' › ');
}

export function creditText(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v).replace('.', ',');
}
