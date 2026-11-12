// Saf yardımcılar (React yok): satır içi biçim ayrıştırma, düz metin çıkarma, arama.

const TOKEN = /(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|\{\{[^}|]+\|[^}]+\}\})/g;

/** "Önce **kalın** [[Düğme]] {{/yol|Bağlantı}}" -> [{ k:'text'|'bold'|'ui'|'link'|'jump', ... }] */
export function parseInline(text) {
  const out = [];
  for (const part of String(text).split(TOKEN)) {
    if (!part) continue;
    if (part.startsWith('**')) out.push({ k: 'bold', x: part.slice(2, -2) });
    else if (part.startsWith('[[')) out.push({ k: 'ui', x: part.slice(2, -2) });
    else if (part.startsWith('{{')) {
      const [target, label] = part.slice(2, -2).split('|');
      if (target.startsWith('#')) out.push({ k: 'jump', id: target.slice(1), x: label });
      else out.push({ k: 'link', to: target, x: label });
    } else out.push({ k: 'text', x: part });
  }
  return out;
}

export const plain = (text) => parseInline(text).map((p) => p.x).join('');

/** Bir bloktaki bütün metin (aramada kullanılır). */
export function blockText(b) {
  switch (b.t) {
    case 'p': case 'note': return plain(b.x);
    case 'ul': case 'steps': return b.x.map(plain).join(' ');
    case 'table': return [...b.head, ...b.rows.flat()].map(plain).join(' ');
    case 'qa': return b.x.flatMap(([q, a]) => [plain(q), plain(a)]).join(' ');
    default: return '';
  }
}

const FOLD = { 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g', 'Ü': 'u', 'ü': 'u', 'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c' };
/** Türkçe harfleri sadeleştirip küçültür: "Şablon" ve "sablon" aynı sayılır. */
export const fold = (s) => String(s || '').replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => FOLD[c]).toLowerCase();

export const topicText = (topic) => fold([topic.title, ...topic.blocks.map(blockText)].join(' '));

/** Aranan her kelimeyi içeren konular. Boş arama = hepsi. */
export function filterSections(sections, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return sections;
  return sections
    .map((s) => ({ ...s, topics: s.topics.filter((t) => { const txt = topicText(t); return words.every((w) => txt.includes(w)); }) }))
    .filter((s) => s.topics.length > 0);
}

/** Rehberde geçen bütün [[...]] adları ve {{yol|...}} bağlantıları (denetim için). */
export function collectRefs(sections) {
  const ui = new Set(); const links = new Set(); const jumps = new Set();
  const scan = (text) => { for (const p of parseInline(text)) { if (p.k === 'ui') ui.add(p.x); if (p.k === 'link') links.add(p.to); if (p.k === 'jump') jumps.add(p.id); } };
  for (const s of sections) for (const t of s.topics) for (const b of t.blocks) {
    if (b.t === 'p' || b.t === 'note') scan(b.x);
    else if (b.t === 'ul' || b.t === 'steps') b.x.forEach(scan);
    else if (b.t === 'table') [...b.head, ...b.rows.flat()].forEach(scan);
    else if (b.t === 'qa') b.x.forEach(([q, a]) => { scan(q); scan(a); });
  }
  return { ui, links, jumps };
}

/** Kredi birim fiyatı: 0 → "Ücretsiz", 0.05 → "0,05 kredi" */
export function creditLabel(n, unit) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return 'Ücretsiz';
  return `${String(Math.round(v * 100) / 100).replace('.', ',')} kredi${unit ? ` ${unit}` : ''}`;
}


/** Rehberdeki bütün metin parçaları (biçim denetimi için). */
export function allTexts(sections) {
  const out = [];
  for (const s of sections) for (const t of s.topics) for (const b of t.blocks) {
    if (b.t === 'p' || b.t === 'note') out.push(b.x);
    else if (b.t === 'ul' || b.t === 'steps') out.push(...b.x);
    else if (b.t === 'table') out.push(...b.head, ...b.rows.flat());
    else if (b.t === 'qa') b.x.forEach(([q, a]) => out.push(q, a));
  }
  return out;
}
