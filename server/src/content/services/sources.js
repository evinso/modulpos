const db = require('../db');
const H = require('../lib/html');
const safeFetch = require('../lib/safeFetch');
const { HttpError } = require('../lib/http');

/**
 * The research material of an article: the reports of the news event the idea came from.
 *  - up to `max` DIFFERENT publishers, the most reliable first (an official source before an aggregator)
 *  - each page is read through the SSRF-safe fetcher (private addresses refused, size and time capped, redirects re-checked); its text is cut to 5,000 characters
 *  - a page that cannot be read (paywall, script-only page, error) falls back to the headline and the short summary the feed gave: `readOk = false`, and the checks know it
 *  - this text is THIRD-PARTY DATA: it is handed to the model as untrusted material and kept only as an internal verification cache (article_sources.excerpt)
 */
const MAX_TEXT = 5000;
const MIN_PAGE_TEXT = 500;

/** the main text of an HTML page: the biggest <article> (or <main>) block when there is one, else the body; scripts, styles and tags removed */
function mainText(html) {
  const s = String(html || '');
  const grab = (tag) => [...s.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
  const clean = (h) => H.htmlToText(h.replace(/<(script|style|noscript|nav|header|footer|aside|form|svg)\b[\s\S]*?<\/\1>/gi, ' ')).slice(0, MAX_TEXT);
  const block = grab('article') || grab('main');
  const part = block ? clean(block) : '';
  return part.length >= MIN_PAGE_TEXT ? part : (() => { const full = clean(s); return full.length > part.length ? full : part; })();         // a tiny <article> teaser is not the page: fall back to the whole body
}

const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/**
 * Reads the pages of some news items (the same guarded, capped reading as everywhere): at most `max` DIFFERENT publishers, the most reliable first; a page that cannot be read
 * falls back to the headline and summary with `readOk = false`.
 * @param items [{ url, title, summary, source_name, published_at, reliability }]
 * @returns [{ n, url, title, publisher, publishedAt, reliability, text, readOk }]
 */
async function gatherItems(items, { max = 5, fetcher = (u) => safeFetch.fetchText(u, { timeoutMs: 12000, maxBytes: 1.5 * 1024 * 1024 }), startAt = 1 } = {}) {
  const seen = new Set(); const picked = [];
  for (const it of items) { const key = String(it.source_name || '').toLowerCase() || domainOf(it.url); if (seen.has(key)) continue; seen.add(key); picked.push(it); if (picked.length >= max) break; }
  // pages are read side by side (at most 3 at a time): the free server is slow enough already
  const out = new Array(picked.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, picked.length) }, async () => {
    while (next < picked.length) {
      const i = next++; const it = picked[i];
      let page = '';
      try { const r = await fetcher(it.url); page = mainText(r && r.body); } catch { page = ''; }
      const readOk = page.length >= MIN_PAGE_TEXT;
      const text = readOk ? page : `${it.title}. ${it.summary || ''}`.trim();
      out[i] = { n: startAt + i, url: it.url, title: it.title, publisher: it.source_name, publishedAt: it.published_at, reliability: it.reliability, text, readOk };
    }
  }));
  return out;
}

/** the research material of a news event (the idea an article is written for) */
async function gatherForTopic(topicId, opts = {}) {
  const t = (await db.query('SELECT id, cluster_id, title FROM topics WHERE id = $1', [topicId])).rows[0];
  if (!t) throw new HttpError(404, 'Konu bulunamadı');
  if (!t.cluster_id) return [];
  const items = (await db.query(`SELECT i.url, i.title, i.summary, i.source_name, i.published_at, GREATEST(i.reliability, COALESCE(s.reliability, 0)) AS reliability
    FROM news_items i LEFT JOIN news_sources s ON s.id = i.source_id WHERE i.cluster_id = $1 ORDER BY GREATEST(i.reliability, COALESCE(s.reliability, 0)) DESC, i.published_at DESC NULLS LAST`, [t.cluster_id])).rows;
  return gatherItems(items, opts);
}

/** The saved sources of an article as the checks need them (full cached text); `preview` is what the API may show. */
async function forArticle(articleId) {
  const rows = (await db.query('SELECT id, url, title, publisher, excerpt, reliability, read_ok FROM article_sources WHERE article_id = $1 ORDER BY position, accessed_at, id', [articleId])).rows;
  return rows.map((r, i) => ({ n: r.position || i + 1, id: r.id, url: r.url, title: r.title, publisher: r.publisher, text: r.excerpt, reliability: r.reliability, readOk: r.read_ok }));
}

module.exports = { MAX_TEXT, MIN_PAGE_TEXT, mainText, gatherItems, gatherForTopic, forArticle };
