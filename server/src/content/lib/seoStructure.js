const { Parser } = require('htmlparser2');

/**
 * The on-page SEO structure of an article's HTML, measured without a model: the heading outline (H2-H4), the links, the pictures and their alt text, the paragraphs,
 * the lists and how long each section is. Pure and deterministic, so it can run on every edit. It reads what is there; judging it is the rules' job (services/checks.js).
 */
const BLOCK = /^(p|h[1-6]|ul|ol|table|blockquote|figure|img|div)$/;
const wc = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/** a link address in a comparable form: https/http alike, no www, no fragment, no trailing slash, no tracking parameters; null when it is not an address */
function normUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(k)) u.searchParams.delete(k);
  const host = u.hostname.toLowerCase().replace(/^www\./, ''); const path = u.pathname.replace(/\/+$/, '') || '';
  return `${host}${path}${u.search}`;
}
const hostOf = (raw) => { try { return new URL(String(raw || '').trim()).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

/**
 * @returns { headings: [{ level, text }], links: [{ href, text }], images: [{ src, alt }], paragraphs: [words], lists, firstTag,
 *            sections: [{ title, words }]  (the text between two headings; the first one, before any heading, is the introduction) }
 */
function structure(html) {
  const s = { headings: [], links: [], images: [], paragraphs: [], lists: 0, firstTag: null, sections: [] };
  let head = null; let link = null; let para = null; let body = 0; let sec = { title: '', words: 0 };
  const parser = new Parser({
    onopentag(name, a) {
      if (s.firstTag === null && BLOCK.test(name)) s.firstTag = name;
      if (/^h[1-6]$/.test(name)) { s.sections.push(sec); head = { level: Number(name[1]), text: '' }; }
      else if (name === 'p') para = '';
      else if (name === 'a') link = { href: a.href || '', text: '' };
      else if (name === 'img') s.images.push({ src: a.src || '', alt: clean(a.alt) });
      else if (name === 'ul' || name === 'ol') s.lists++;
      if (/^(p|li|blockquote|td|th)$/.test(name)) body++;
    },
    ontext(t) {
      if (head) head.text += t; if (link) link.text += t; if (para !== null) para += t;
      if (body > 0 && !head) sec.words += wc(t);
    },
    onclosetag(name) {
      if (/^h[1-6]$/.test(name) && head) { head.text = clean(head.text); s.headings.push(head); sec = { title: head.text, words: 0 }; head = null; }
      else if (name === 'p' && para !== null) { s.paragraphs.push(wc(para)); para = null; }
      else if (name === 'a' && link) { link.text = clean(link.text); s.links.push(link); link = null; }
      if (/^(p|li|blockquote|td|th)$/.test(name) && body > 0) body--;
    },
  }, { decodeEntities: true });
  parser.write(String(html || '')); parser.end();
  s.sections.push(sec);
  s.sections = s.sections.filter((x, i) => i > 0 || x.words > 0).map((x, i, all) => ({ title: x.title || 'Giriş', words: x.words, index: i, of: all.length }));
  return s;
}

/**
 * Problems of the heading outline, in words (an empty list = a sound outline). The article's own title is the single H1, so the first heading of the text must be an H2,
 * a level may go one step deeper at a time (H2 > H3 > H4) and may come back up freely; empty, repeated or very long headings are named.
 */
function outlineProblems(headings) {
  const out = []; let prev = 1; const seen = new Map();
  headings.forEach((h, i) => {
    const label = h.text ? `“${h.text.slice(0, 48)}”` : 'adsız başlık';
    if (h.level === 1) out.push('İçerikte ikinci bir H1 var (ana başlık yalnızca bir kez, başlık alanında olmalı)');
    else if (i === 0 && h.level !== 2) out.push(`İlk alt başlık H${h.level}: bölümler H2 ile başlamalı (${label})`);
    else if (h.level > prev + 1) out.push(`${label} H${h.level} ama bir üstündeki seviye H${prev}: seviye atlanmış (H${prev} → H${h.level})`);
    if (!h.text) out.push('Boş bir başlık var');
    else if (h.text.length > 80) out.push(`${label} çok uzun (${h.text.length} karakter; ~70’i geçmeyin)`);
    const key = h.text.toLowerCase(); if (key) seen.set(key, (seen.get(key) || 0) + 1);
    prev = h.level;
  });
  for (const [k, n] of seen) if (n > 1) out.push(`“${k.slice(0, 48)}” başlığı ${n} kez geçiyor`);
  return [...new Set(out)];
}

module.exports = { structure, outlineProblems, normUrl, hostOf };
