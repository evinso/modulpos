/**
 * Product data from a Trendyol product page ("Yeni ürün" > Trendyol linkinden doldur).
 *
 * IMPORTANT: Trendyol blocks automated requests (Cloudflare answers 403 to servers, checked 2026-11-21 from several places), so a server that
 * fetches the link will usually be refused. The owner's own browser is not: that is why the page source can also be handed over
 * (Ctrl+U, copy all, paste) and is read here the same way. `extract` therefore works on text, `fetchPage` is only "try, and say so when blocked".
 *
 * What is read, best source first per field: the page's state JSON (`__PRODUCT_DETAIL_APP_INITIAL_STATE__`), the schema.org Product block
 * (`application/ld+json`), the og: meta tags. Nothing is invented: a field that is not found stays empty. The structure of Trendyol's own state
 * JSON could not be checked against a real page (blocked), so it is read defensively (several likely shapes) and the result says what was found.
 */

const CDN = 'https://cdn.dsmcdn.com';
const MAX_IMAGES = 12;

// ── the address ────────────────────────────────────────────────────────────────────────────────────────────
/** Only Trendyol's own addresses are ever fetched (no other host, no credentials in the address, https only). */
function parseTrendyolUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return { error: 'Geçerli bir Trendyol ürün linki yazın (https://www.trendyol.com/...)' }; }
  if (u.protocol !== 'https:') return { error: 'Link https:// ile başlamalı' };
  if (u.username || u.password || u.port) return { error: 'Bu link kabul edilmiyor' };
  const host = u.hostname.toLowerCase();
  if (!/^(www\.|m\.)?trendyol\.com$/.test(host)) return { error: 'Yalnızca trendyol.com ürün linkleri kabul edilir' };
  const m = /-p-(\d{4,})/.exec(u.pathname);
  if (!m) return { error: 'Bu bir ürün linki gibi görünmüyor (adreste “-p-” ve ürün numarası olmalı)' };
  return { url: `https://${host}${u.pathname}`, contentId: m[1] };
}

// ── text helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
  });
}
/** HTML or plain text -> plain text with line breaks where the markup had them. */
function plainText(html, max = 6000) {
  return decodeEntities(String(html == null ? '' : html)
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
const str = (v) => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''));
const absoluteImage = (u) => {
  const s = str(u);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${CDN}${s}`;
  return '';
};
const isImageUrl = (u) => /^https?:\/\/\S+\.(jpe?g|png|webp)(\?\S*)?$/i.test(u);
const uniq = (list) => [...new Set(list.filter(Boolean))];

// ── sources inside the page ────────────────────────────────────────────────────────────────────────────────
/** schema.org blocks: every <script type="application/ld+json">, arrays and @graph unfolded. */
function jsonLdNodes(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { out.push(n); if (Array.isArray(n['@graph'])) n['@graph'].forEach(walk); } };
    walk(data);
  }
  return out;
}
const isType = (n, t) => [].concat(n && n['@type'] || []).map(String).includes(t);

/** The JSON assigned to window.__PRODUCT_DETAIL_APP_INITIAL_STATE__ (balanced braces, strings respected), or null. */
function stateJson(html) {
  const at = html.search(/__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*/);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } }
    if (i - start > 6_000_000) return null;
  }
  return null;
}

function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${prop}["'][^>]*>`, 'i');
  const tag = re.exec(html);
  if (!tag) return '';
  const c = /content\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag[0]);
  return c ? decodeEntities(c[2] !== undefined ? c[2] : c[3]).trim() : '';
}

/** Several likely shapes of Trendyol's own product JSON, read defensively. */
function fromState(state) {
  if (!state || typeof state !== 'object') return {};
  const p = (state.product && typeof state.product === 'object' ? state.product : state);
  const out = {};
  out.title = str(p.name) || str(p.nameWithProductCode);
  const d = Array.isArray(p.contentDescriptions) ? p.contentDescriptions.map((x) => str(x && x.description)).filter(Boolean).join('\n') : '';
  out.description = plainText(d || p.description || '');
  const b = p.brand;
  out.brand = typeof b === 'string' ? b.trim() : str(b && b.name);
  const c = p.category || state.category;
  if (c && typeof c === 'object') out.category = { id: c.id != null ? String(c.id) : '', name: str(c.name), hierarchy: str(c.hierarchy || c.path) };
  const imgs = Array.isArray(p.images) ? p.images : [];
  out.images = imgs.map((i) => absoluteImage(typeof i === 'string' ? i : (i && (i.url || i.imageUrl)))).filter(Boolean);
  const attrs = Array.isArray(p.attributes) ? p.attributes : (Array.isArray(p.productAttributes) ? p.productAttributes : []);
  out.attributes = attrs.map((a) => ({
    name: str(a && a.key && a.key.name) || str(a && a.name) || str(a && a.attributeName),
    value: str(a && a.value && a.value.name) || (typeof (a && a.value) === 'string' ? a.value.trim() : '') || str(a && a.attributeValue),
  })).filter((a) => a.name && a.value);
  const price = p.price && typeof p.price === 'object' ? (p.price.sellingPrice && p.price.sellingPrice.value) ?? p.price.discountedPrice?.value ?? p.price.value : p.price;
  const n = Number(price);
  if (Number.isFinite(n) && n > 0) out.price = n;
  return out;
}

function fromLd(nodes) {
  const prod = nodes.find((n) => isType(n, 'Product'));
  if (!prod) return {};
  const out = { title: str(prod.name), description: plainText(prod.description || '') };
  const b = prod.brand;
  out.brand = typeof b === 'string' ? b.trim() : str(b && b.name);
  const img = [].concat(prod.image || []);
  out.images = img.map((i) => absoluteImage(typeof i === 'string' ? i : (i && (i.url || i.contentUrl)))).filter(Boolean);
  const offers = [].concat(prod.offers || []);
  const o = offers.find((x) => x && (x.price != null || x.lowPrice != null));
  const n = o ? Number(o.price != null ? o.price : o.lowPrice) : NaN;
  if (Number.isFinite(n) && n > 0) out.price = n;
  if (typeof prod.category === 'string' && prod.category.trim()) out.category = { id: '', name: '', hierarchy: prod.category.trim() };
  if (Array.isArray(prod.additionalProperty)) {
    out.attributes = prod.additionalProperty.map((a) => ({ name: str(a && a.name), value: str(a && a.value) })).filter((a) => a.name && a.value);
  }
  return out;
}

/**
 * @param source the page's HTML (or the text of a state JSON / pieces of the page)
 * @returns { found: boolean, title, description, brand, images: [url], price, category: { id, name, hierarchy } | null, attributes: [{ name, value }] }
 *          `found` is false when nothing usable was in the text.
 */
function extract(source) {
  const html = String(source == null ? '' : source);
  const state = fromState(stateJson(html));
  const ld = fromLd(jsonLdNodes(html));
  const og = { title: metaContent(html, 'og:title'), description: plainText(metaContent(html, 'og:description')), images: [absoluteImage(metaContent(html, 'og:image'))].filter(Boolean) };
  const pick = (k) => state[k] || ld[k] || og[k] || '';
  const images = uniq([...(state.images || []), ...(ld.images || []), ...(og.images || [])]).filter(isImageUrl).slice(0, MAX_IMAGES);
  const attributes = (state.attributes && state.attributes.length ? state.attributes : (ld.attributes || []));
  const category = state.category && (state.category.name || state.category.id) ? state.category : (ld.category || null);
  const title = pick('title').replace(/\s*-\s*Fiyatı,\s*Yorumları.*$/i, '').slice(0, 300);
  const out = {
    title, description: pick('description'), brand: pick('brand'), images, price: state.price || ld.price || null,
    category, attributes: attributes.slice(0, 60),
  };
  out.found = !!(out.title || out.images.length || out.description);
  return out;
}

// ── fetching (best effort) ───────────────────────────────────────────────────────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.5',
};

/** Does this answer look like Trendyol's bot protection instead of the product page? */
function looksBlocked(status, body) {
  if ([401, 403, 429, 503].includes(status)) return true;
  const t = String(body || '').slice(0, 4000);
  return /cf-chl|challenge-platform|Just a moment|Attention Required|Access denied/i.test(t) && !/__PRODUCT_DETAIL_APP_INITIAL_STATE__|application\/ld\+json/i.test(String(body || ''));
}

/**
 * Tries to read the page. @param get (url, config) => axios-like response (injectable); redirects only to trendyol.com hosts.
 * @returns { html } or throws an Error with `code`: 'BLOCKED' (the usual outcome from a server) | 'FAILED'
 */
async function fetchPage(url, { get }) {
  let res;
  try {
    res = await get(url, {
      headers: BROWSER_HEADERS, timeout: 12000, maxRedirects: 3, maxContentLength: 4_000_000, responseType: 'text', transformResponse: (d) => d, validateStatus: () => true,
      beforeRedirect: (opts) => { if (!/^(www\.|m\.)?trendyol\.com$/i.test(String(opts.hostname || opts.host || '').toLowerCase())) throw new Error('redirect to another host refused'); },
    });
  } catch (err) {
    throw Object.assign(new Error(`Trendyol’a ulaşılamadı: ${String(err && err.message || err).slice(0, 100)}`), { code: 'FAILED' });
  }
  const body = typeof res.data === 'string' ? res.data : '';
  if (looksBlocked(res.status, body)) throw Object.assign(new Error('Trendyol, sunucudan gelen isteği engelledi'), { code: 'BLOCKED', status: res.status });
  if (res.status >= 400) throw Object.assign(new Error(`Trendyol sayfası açılamadı (HTTP ${res.status})`), { code: 'FAILED', status: res.status });
  return { html: body };
}

module.exports = { parseTrendyolUrl, extract, fetchPage, looksBlocked, plainText, decodeEntities, stateJson, jsonLdNodes, CDN, MAX_IMAGES };
