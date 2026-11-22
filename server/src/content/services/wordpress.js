const safeFetch = require('../lib/safeFetch');
const { env } = require('../env');

/**
 * WordPress REST API client (https://developer.wordpress.org/rest-api/). Written from the documentation; it has been run only against a fake WordPress server of the tests.
 *  - authentication: HTTP Basic with the user's APPLICATION password (WordPress 5.6+); it is sent to the configured site only (no redirect is ever followed with it)
 *  - every address goes through lib/safeFetch (public addresses only, size and time limits); the site must be https (http only in tests)
 *  - REST route styles: pretty (/wp-json/wp/v2/...) and the query style (/?rest_route=/wp/v2/...) of sites without pretty permalinks
 *  - errors are WpError(code, message in Turkish, status, retryable, maybeSent): `maybeSent` = a write that may have reached the site although no answer came back
 */
class WpError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'WpError'; this.code = code; Object.assign(this, extra); }
}

/** the site's root address: https://example.com (a pasted /wp-json or /wp-admin part and a trailing slash are removed) */
function normalizeSite(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new WpError('url', 'WordPress adresi geçerli değil (örn. https://siteniz.com)'); }
  if (u.username || u.password) throw new WpError('url', 'Adreste kullanıcı adı/şifre olamaz');
  if (u.protocol !== 'https:' && !(env().allowPrivateFetch && u.protocol === 'http:')) throw new WpError('url', 'WordPress adresi https ile başlamalı (uygulama şifresi açık bağlantıdan gönderilmez)');
  const path = u.pathname.replace(/\/(wp-json|wp-admin|wp-login\.php).*$/i, '').replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

const MESSAGES = {
  rest_not_logged_in: ['auth', 'WordPress kullanıcı adı ya da uygulama şifresini reddetti'], incorrect_password: ['auth', 'WordPress uygulama şifresini reddetti'], invalid_username: ['auth', 'WordPress kullanıcı adını tanımıyor'],
  rest_cannot_create: ['rights', 'Bu kullanıcının yazı oluşturma yetkisi yok (en az “Yazar” rolü gerekir)'], rest_cannot_publish: ['rights', 'Bu kullanıcı yazıyı yayımlayamıyor (“Yazar” ya da “Editör” rolü gerekir; “Katkıda bulunan” yalnızca taslak yazabilir)'],
  rest_cannot_edit: ['rights', 'Bu kullanıcının bu yazıyı düzenleme yetkisi yok'], rest_forbidden: ['rights', 'Bu işlem için kullanıcının yetkisi yok'], rest_upload_no_content_disposition: ['invalid', 'Görsel yükleme isteği hatalı'],
  rest_no_route: ['no_rest', 'WordPress REST API bu adreste bulunamadı (kalıcı bağlantılar kapalı olabilir ya da bir güvenlik eklentisi REST’i engelliyor)'], rest_post_invalid_id: ['gone', 'WordPress’te bu yazı artık yok (silinmiş olabilir)'],
  rest_term_invalid: ['invalid', 'WordPress kategori/etiketi geçersiz buldu'],
};

function parseJson(text) {
  const s = String(text || '').replace(/^﻿/, '').trim();
  if (!s) return null;
  const i = Math.min(...['{', '['].map((c) => { const k = s.indexOf(c); return k < 0 ? Infinity : k; }));          // some hosts print PHP notices before the JSON
  if (!Number.isFinite(i)) return undefined;
  try { return JSON.parse(s.slice(i)); } catch { return undefined; }
}

function createClient({ apiUrl, username, password, style = 'pretty', request = safeFetch.request, timeoutMs = 30000 }) {
  const base = normalizeSite(apiUrl);
  const auth = `Basic ${Buffer.from(`${username}:${String(password).replace(/\s+/g, ' ')}`).toString('base64')}`;
  const url = (route, query = {}) => {
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
    return style === 'query' ? `${base}/?rest_route=${encodeURIComponent(route)}${q.toString() ? `&${q}` : ''}` : `${base}/wp-json${route}${q.toString() ? `?${q}` : ''}`;
  };

  async function call(method, route, { query, json, raw, headers = {}, authed = true, maxBytes } = {}) {
    let res;
    try {
      res = await request(url(route, query), { method, timeoutMs, maxBytes: maxBytes || 4 * 1024 * 1024, headers: { Accept: 'application/json', ...(authed ? { Authorization: auth } : {}), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: json !== undefined ? JSON.stringify(json) : (raw !== undefined ? raw : null) });
    } catch (err) {
      const write = method !== 'GET';
      if (err && err.name === 'FetchError') throw new WpError(err.code === 'timeout' ? 'timeout' : err.code === 'redirect' ? 'redirect' : err.code === 'ssrf' ? 'ssrf' : 'network', err.message, { retryable: !['ssrf', 'redirect', 'url'].includes(err.code), maybeSent: write && ['timeout', 'network'].includes(err.code) });
      throw err;
    }
    const data = parseJson(res.body);
    if (res.status >= 200 && res.status < 300) {
      if (data === undefined) throw new WpError('not_wp', 'Adres bir WordPress REST API gibi cevap vermedi (JSON yok): adresi ve varsa güvenlik/önbellek eklentisini kontrol edin', { status: res.status });
      return { data, headers: res.headers, status: res.status };
    }
    const code = data && data.code; const known = MESSAGES[code];
    if (res.status === 401) throw new WpError('auth', (known && known[1]) || 'WordPress kullanıcı adı ya da uygulama şifresini reddetti (401)', { status: 401, wpCode: code });
    if (res.status === 403) throw new WpError(known ? known[0] : 'rights', (known && known[1]) || 'Bu işlem için yetki yok ya da bir güvenlik eklentisi/WAF isteği engelledi (403)', { status: 403, wpCode: code });
    if (res.status === 404) throw new WpError(known ? known[0] : 'no_rest', (known && known[1]) || 'WordPress REST API bu adreste bulunamadı (404)', { status: 404, wpCode: code });
    if (res.status === 429 || res.status >= 500) throw new WpError('server', `WordPress sunucusu hata verdi (${res.status}); biraz sonra tekrar deneyin`, { status: res.status, retryable: true, maybeSent: method !== 'GET' && res.status >= 500, wpCode: code });
    throw new WpError(known ? known[0] : 'invalid', (known && known[1]) || `WordPress isteği reddetti (${res.status})${data && data.message ? `: ${String(data.message).replace(/<[^>]+>/g, '').slice(0, 200)}` : ''}`, { status: res.status, wpCode: code });
  }

  return {
    base, style,
    /** The site's own description: name, REST namespaces (which tell the SEO plugin). Needs no login. */
    async root() { const r = await call('GET', '/', { authed: false }); return { name: r.data.name || '', description: r.data.description || '', url: r.data.url || '', namespaces: Array.isArray(r.data.namespaces) ? r.data.namespaces : [], timezone: r.data.timezone_string || '', isWordPress: Array.isArray(r.data.namespaces) && r.data.namespaces.includes('wp/v2') }; },
    /** Who we are on the site (needs a valid application password) and what that user may do. */
    async me() { const r = await call('GET', '/wp/v2/users/me', { query: { context: 'edit' } }); const c = r.data.capabilities || {}; return { id: r.data.id, name: r.data.name, roles: r.data.roles || [], canPost: !!c.edit_posts, canPublish: !!c.publish_posts, canUpload: !!c.upload_files, canCreateTerms: !!c.manage_categories }; },
    async categories() {
      const out = [];
      for (let page = 1; page <= 5; page++) { const r = await call('GET', '/wp/v2/categories', { query: { per_page: 100, page, _fields: 'id,name,slug,parent,count' } }); out.push(...(Array.isArray(r.data) ? r.data : [])); if (!Array.isArray(r.data) || r.data.length < 100) break; }
      return out.map((c) => ({ id: c.id, name: String(c.name || '').replace(/&amp;/g, '&'), slug: c.slug, parent: c.parent || 0, count: c.count || 0 }));
    },
    async createCategory(name) { const r = await call('POST', '/wp/v2/categories', { json: { name } }); return { id: r.data.id, name: r.data.name, slug: r.data.slug }; },
    /** the tag with exactly this name (created when missing): WordPress wants tag IDS on a post */
    async tagId(name) {
      const r = await call('GET', '/wp/v2/tags', { query: { search: name, per_page: 20, _fields: 'id,name' } });
      const hit = (Array.isArray(r.data) ? r.data : []).find((t) => String(t.name).toLowerCase().replace(/&amp;/g, '&') === String(name).toLowerCase());
      if (hit) return hit.id;
      return (await call('POST', '/wp/v2/tags', { json: { name } })).data.id;
    },
    async uploadMedia({ buffer, filename, mime, alt = '' }) {
      const safe = String(filename).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'image';
      const r = await call('POST', '/wp/v2/media', { raw: buffer, headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${safe}"` }, maxBytes: 4 * 1024 * 1024 });
      if (alt) { try { await call('POST', `/wp/v2/media/${r.data.id}`, { json: { alt_text: alt } }); } catch { /* the alt text is nice to have */ } }
      return { id: r.data.id, url: r.data.source_url };
    },
    async createPost(body) { const r = await call('POST', '/wp/v2/posts', { json: body }); return postShape(r.data); },
    async updatePost(id, body) { const r = await call('POST', `/wp/v2/posts/${Number(id)}`, { json: body }); return postShape(r.data); },
    async getPost(id) { const r = await call('GET', `/wp/v2/posts/${Number(id)}`, { query: { context: 'edit' } }); return postShape(r.data); },
    /** a post of any status with this slug (the check that keeps a retry from creating a second copy) */
    async findBySlug(slug) { const r = await call('GET', '/wp/v2/posts', { query: { slug, status: 'any', context: 'edit', per_page: 5 } }); return (Array.isArray(r.data) ? r.data : []).map(postShape); },
    /** Rank Math's documented endpoint for the SEO fields of a post */
    async rankMathMeta(postId, { title, description, focusKeyword }) { await call('POST', '/rankmath/v1/updateMeta', { json: { objectID: postId, objectType: 'post', meta: { rank_math_title: title, rank_math_description: description, rank_math_focus_keyword: focusKeyword } } }); return true; },
  };
}

const postShape = (p) => ({ id: p.id, status: p.status, link: p.link, slug: p.slug, date: p.date_gmt ? `${p.date_gmt}Z` : null, meta: p.meta || {}, featuredMedia: p.featured_media || 0, modified: p.modified_gmt ? `${p.modified_gmt}Z` : null });

module.exports = { createClient, normalizeSite, WpError, parseJson };
