const sanitizeHtml = require('sanitize-html');
const { Parser } = require('htmlparser2');

/**
 * Article HTML. Everything that is stored passes through sanitizeArticleHtml (an allow list: no scripts, no inline handlers, no style, only
 * http(s)/mailto links and https pictures), so a pasted or generated article can never carry active content into the panel or into WordPress.
 */
const ALLOWED_TAGS = ['h2', 'h3', 'h4', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's', 'blockquote', 'code', 'pre', 'a', 'img',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];

const OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href', 'title', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};
const HEADINGS = { h1: 'h2', h5: 'h4', h6: 'h4' };
const noopener = (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'noopener' } });

function sanitizeArticleHtml(html) {
  return sanitizeHtml(String(html || ''), { ...OPTIONS, transformTags: { ...HEADINGS, a: noopener } }).trim();
}

/**
 * Keeps a link only when `isAllowed(href)` says yes; every other link is UNWRAPPED (its words stay, the address goes). Used on model output, so an article can never carry an
 * address the model made up. @returns { html, removed: [href] }
 */
function restrictLinks(html, isAllowed) {
  const removed = [];
  const out = sanitizeHtml(String(html || ''), { ...OPTIONS, transformTags: { ...HEADINGS, a: (tag, attribs) => {
    if (isAllowed(attribs.href || '')) return noopener(tag, attribs);
    removed.push(attribs.href || ''); return { tagName: 'span', attribs: {} };
  } } }).trim();
  return { html: out, removed };
}

/** Plain text of some HTML: tags removed, entities decoded, white space folded. */
function htmlToText(html) {
  const spaced = String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li|h[1-6]|tr|td|th|blockquote|ul|ol|table|figure|figcaption|pre)>/gi, ' ');   // blocks are separate words
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

const wordCount = (html) => { const t = htmlToText(html); return t ? t.split(/\s+/).length : 0; };

const TR = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };
/** URL slug: lower case ASCII words joined by hyphens (Turkish letters folded), at most 90 characters. */
function slugify(text, max = 90) {
  const s = String(text || '').replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/g, '');
}

/** Markdown from (sanitised) article HTML. Only the tags the sanitiser allows are understood. */
function htmlToMarkdown(html) {
  const out = [];
  const lists = [];           // stack of { ordered, n }
  let href = null; let inPre = false; let quote = 0;
  const table = { rows: [], row: null, header: false };
  const push = (s) => out.push(s);
  const nl = (n = 2) => { const t = out.join(''); const trailing = (t.match(/\n*$/) || [''])[0].length; if (t.length && trailing < n) push('\n'.repeat(n - trailing)); };
  const prefix = () => (quote ? '> '.repeat(quote) : '');
  const parser = new Parser({
    onopentag(name, a) {
      if (/^h[2-4]$/.test(name)) { nl(); push(`${'#'.repeat(Number(name[1]))} `); }
      else if (name === 'p') { nl(); push(prefix()); }
      else if (name === 'br') push('  \n');
      else if (name === 'hr') { nl(); push('---'); nl(); }
      else if (name === 'strong' || name === 'b') push('**');
      else if (name === 'em' || name === 'i') push('*');
      else if (name === 'code' && !inPre) push('`');
      else if (name === 'pre') { nl(); push('```\n'); inPre = true; }
      else if (name === 'a') { href = a.href || null; push('['); }
      else if (name === 'img') push(`![${a.alt || ''}](${a.src || ''})`);
      else if (name === 'ul' || name === 'ol') { if (!lists.length) nl(); lists.push({ ordered: name === 'ol', n: 0 }); }
      else if (name === 'li') { const l = lists[lists.length - 1] || { ordered: false, n: 0 }; l.n++; if (out.length && !/\n$/.test(out.join(''))) push('\n'); push(`${'  '.repeat(Math.max(0, lists.length - 1))}${l.ordered ? `${l.n}.` : '-'} `); }
      else if (name === 'blockquote') { nl(); quote++; }
      else if (name === 'table') { table.rows = []; }
      else if (name === 'tr') { table.row = []; table.header = false; }
      else if (name === 'th' || name === 'td') { if (name === 'th') table.header = true; table.cell = []; table.capture = true; }
    },
    ontext(t) {
      if (table.capture) { table.cell.push(t); return; }
      push(inPre ? t : t.replace(/\s+/g, ' '));
    },
    onclosetag(name) {
      if (/^h[2-4]$/.test(name)) nl();
      else if (name === 'p') nl();
      else if (name === 'strong' || name === 'b') push('**');
      else if (name === 'em' || name === 'i') push('*');
      else if (name === 'code' && !inPre) push('`');
      else if (name === 'pre') { push('\n```'); nl(); inPre = false; }
      else if (name === 'a') { push(`](${href || ''})`); href = null; }
      else if (name === 'ul' || name === 'ol') { lists.pop(); if (!lists.length) nl(); }
      else if (name === 'li') { if (!/\n$/.test(out.join(''))) push('\n'); }
      else if (name === 'blockquote') { quote = Math.max(0, quote - 1); nl(); }
      else if (name === 'th' || name === 'td') { table.capture = false; table.row.push(table.cell.join('').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()); }
      else if (name === 'tr') { table.rows.push({ cells: table.row, header: table.header }); }
      else if (name === 'table') {
        nl();
        const rows = table.rows.filter((r) => r.cells.length);
        if (rows.length) {
          const width = Math.max(...rows.map((r) => r.cells.length));
          const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ')} |`;
          push(`${line(rows[0].cells)}\n| ${Array(width).fill('---').join(' | ')} |\n`);
          for (const r of rows.slice(1)) push(`${line(r.cells)}\n`);
        }
        nl();
      }
    },
  }, { decodeEntities: true });
  parser.write(String(html || ''));
  parser.end();
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { sanitizeArticleHtml, restrictLinks, htmlToText, wordCount, slugify, htmlToMarkdown, ALLOWED_TAGS };
