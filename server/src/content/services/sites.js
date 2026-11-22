const db = require('../db');
const V = require('../lib/validate');
const cryptoBox = require('../lib/crypto');
const { isValidTimezone } = require('../lib/time');
const { HttpError, bad } = require('../lib/http');
const wp = require('./wordpress');

/**
 * WordPress connections ("Web Sitelerim"). One project can have several sites; every site has its own application password (encrypted, never returned),
 * daily publishing limit, default author / category and category mapping. Nothing here sends an article: that is services/publishing.js.
 */
const SEO_PLUGINS = ['none', 'rankmath', 'yoast'];

const shape = (r) => r && ({ id: r.id, projectId: r.project_id, name: r.name, domain: r.domain, apiUrl: r.api_url, username: r.username, passwordLast4: r.password_last4, hasPassword: !!r.encrypted_password,
  defaultAuthorId: r.default_author_id, defaultCategoryId: r.default_category_id, timezone: r.timezone, language: r.language, dailyLimit: r.daily_limit, seoPlugin: r.seo_plugin, status: r.status,
  lastTestedAt: r.last_tested_at, lastTestOk: r.last_test_ok, lastTestMessage: r.last_test_message, info: r.wp_info, gscProperty: r.gsc_property, adsensePubId: r.adsense_pub_id, gscSyncedAt: r.gsc_synced_at, gscError: r.gsc_error, createdAt: r.created_at, updatedAt: r.updated_at });

async function load(id) {
  const r = (await db.query('SELECT * FROM wp_sites WHERE id = $1', [V.uuid(id, 'Site')])).rows[0];
  if (!r) throw new HttpError(404, 'Site bulunamadı');
  return r;
}

async function list(projectId) {
  const rows = (await db.query(`SELECT s.*, (SELECT count(*)::int FROM publications p WHERE p.site_id = s.id) AS publications,
    (SELECT count(*)::int FROM publications p WHERE p.site_id = s.id AND p.status = 'published') AS published, (SELECT count(*)::int FROM publications p WHERE p.site_id = s.id AND p.status = 'scheduled') AS scheduled
    FROM wp_sites s WHERE s.project_id = $1 ORDER BY s.created_at`, [projectId])).rows;
  return rows.map((r) => ({ ...shape(r), counts: { total: r.publications, published: r.published, scheduled: r.scheduled } }));
}
async function get(id) { return shape(await load(id)); }

function fields(b, { create = false } = {}) {
  const f = {};
  const has = (k) => b[k] !== undefined;
  if (has('name') || create) f.name = V.str(b.name, 'Site adı', { required: true, max: 120 });
  if (has('domain')) f.domain = V.str(b.domain, 'Alan adı', { max: 200 }).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (has('apiUrl') || create) { try { f.apiUrl = wp.normalizeSite(V.str(b.apiUrl, 'WordPress adresi', { required: true, max: 300 })); } catch (e) { if (e instanceof wp.WpError) throw bad(e.message); throw e; } }
  if (has('username') || create) f.username = V.str(b.username, 'Kullanıcı adı', { required: true, max: 120 });
  if (has('password')) { const p = V.str(b.password, 'Uygulama şifresi', { max: 200 }); if (p) f.password = p; }
  if (create && !f.password) throw bad('Uygulama şifresi gerekli (WordPress → Kullanıcılar → Profil → Uygulama Şifreleri)');
  const optInt = (k, label) => { if (!has(k)) return; f[k] = b[k] === null || b[k] === '' ? null : V.int(b[k], label, { min: 1, max: 2147483647 }); };
  optInt('defaultAuthorId', 'Varsayılan yazar (WordPress kullanıcı numarası)'); optInt('defaultCategoryId', 'Varsayılan kategori (WordPress kategori numarası)');
  if (has('timezone')) { const tz = V.str(b.timezone, 'Saat dilimi', { required: true, max: 60 }); if (!isValidTimezone(tz)) throw bad('Saat dilimi geçersiz (ör. Europe/Istanbul)'); f.timezone = tz; }
  if (has('language')) f.language = V.str(b.language, 'Yayın dili', { required: true, max: 10 });
  if (has('dailyLimit')) f.dailyLimit = V.int(b.dailyLimit, 'Günlük yayın limiti', { min: 0, max: 200 });
  if (has('seoPlugin')) f.seoPlugin = V.oneOf(b.seoPlugin, 'SEO eklentisi', SEO_PLUGINS);
  if (has('status')) f.status = V.oneOf(b.status, 'Durum', ['active', 'paused']);
  if (has('gscProperty')) {
    const g = b.gscProperty === null ? '' : V.str(b.gscProperty, 'Search Console sitesi', { max: 200 });
    if (g && !/^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/[^\s]+\/)$/i.test(g)) throw bad('Search Console sitesi “sc-domain:alanadi.com” ya da “https://alanadi.com/” (sonunda / ile) biçiminde olmalı');
    f.gscProperty = g || null;
  }
  if (has('adsensePubId')) {
    const p = b.adsensePubId === null ? '' : V.str(b.adsensePubId, 'AdSense yayıncı numarası', { max: 40 }).replace(/^ca-/i, '');
    if (p && !/^pub-\d{10,20}$/i.test(p)) throw bad('AdSense yayıncı numarası “pub-1234567890123456” biçiminde olmalı (AdSense → Hesap → Hesap bilgileri)');
    f.adsensePubId = p ? p.toLowerCase() : null;
  }
  return f;
}

const COLS = { name: 'name', domain: 'domain', apiUrl: 'api_url', username: 'username', defaultAuthorId: 'default_author_id', defaultCategoryId: 'default_category_id', timezone: 'timezone', language: 'language', dailyLimit: 'daily_limit', seoPlugin: 'seo_plugin', status: 'status', gscProperty: 'gsc_property', adsensePubId: 'adsense_pub_id' };

async function create(projectId, body) {
  const f = fields(body, { create: true });
  const host = new URL(f.apiUrl).hostname;
  try {
    const r = (await db.query(`INSERT INTO wp_sites (project_id, name, domain, api_url, username, encrypted_password, password_last4, default_author_id, default_category_id, timezone, language, daily_limit, seo_plugin, gsc_property, adsense_pub_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [projectId, f.name, f.domain || host, f.apiUrl, f.username, cryptoBox.encrypt(f.password), cryptoBox.last4(f.password), f.defaultAuthorId || null, f.defaultCategoryId || null,
      f.timezone || 'Europe/Istanbul', f.language || 'en-US', f.dailyLimit ?? 5, f.seoPlugin || 'none', f.gscProperty || null, f.adsensePubId || null])).rows[0];
    return shape(r);
  } catch (err) { if (err.code === '23505') throw new HttpError(409, 'Bu WordPress adresi bu projede zaten ekli'); throw err; }
}

async function update(id, body) {
  await load(id); const f = fields(body);
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(COLS)) if (f[k] !== undefined) { vals.push(f[k]); sets.push(`${col} = $${vals.length}`); }
  if (f.password) { vals.push(cryptoBox.encrypt(f.password)); sets.push(`encrypted_password = $${vals.length}`); vals.push(cryptoBox.last4(f.password)); sets.push(`password_last4 = $${vals.length}`); }
  if (f.apiUrl !== undefined || f.username !== undefined || f.password) sets.push('last_tested_at = NULL', 'last_test_ok = NULL', 'last_test_message = NULL');      // the old test no longer describes this connection
  if (!sets.length) return get(id);
  vals.push(id);
  try { await db.query(`UPDATE wp_sites SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals); }
  catch (err) { if (err.code === '23505') throw new HttpError(409, 'Bu WordPress adresi bu projede zaten ekli'); throw err; }
  return get(id);
}

/** a site that has publications is never deleted (the post numbers would be lost): pause it instead */
async function remove(id) {
  await load(id);
  const n = (await db.query('SELECT count(*)::int n FROM publications WHERE site_id = $1', [id])).rows[0].n;
  if (n) throw new HttpError(409, `Bu siteye ${n} makale gönderilmiş; yayın geçmişi ve WordPress yazı numaraları kaybolmasın diye silinemez. “Duraklat” ile kullanımdan çıkarın`);
  await db.query('DELETE FROM wp_sites WHERE id = $1', [id]);
}

/** the API client of a saved site (the password is decrypted here and nowhere else) */
async function clientFor(site, { request } = {}) {
  const r = site.encrypted_password ? site : await load(site.id);
  return wp.createClient({ apiUrl: r.api_url, username: r.username, password: cryptoBox.decrypt(r.encrypted_password), style: (r.wp_info && r.wp_info.restStyle) || 'pretty', ...(request ? { request } : {}) });
}

/**
 * Checks the connection with the site's own REST API: is it WordPress, does the login work, may this user write, which SEO plugin is installed. Free (no content is sent).
 * The sentence says what is wrong in plain words; the password never appears in it.
 */
async function test(id, { request } = {}) {
  const site = await load(id); const secret = cryptoBox.decrypt(site.encrypted_password);
  const info = { restStyle: 'pretty' }; let ok = false; let message;
  try {
    let client = wp.createClient({ apiUrl: site.api_url, username: site.username, password: secret, style: 'pretty', ...(request ? { request } : {}) });
    let root;
    try { root = await client.root(); } catch (err) { if (err.code === 'no_rest' || err.code === 'not_wp') { client = wp.createClient({ apiUrl: site.api_url, username: site.username, password: secret, style: 'query', ...(request ? { request } : {}) }); info.restStyle = 'query'; root = await client.root(); } else throw err; }
    if (!root.isWordPress) throw new wp.WpError('not_wp', 'Bu adres WordPress REST API (wp/v2) sunmuyor');
    const me = await client.me();
    Object.assign(info, { siteName: root.name, siteUrl: root.url, user: me.name, userId: me.id, roles: me.roles, canPost: me.canPost, canPublish: me.canPublish, canUpload: me.canUpload, canCreateTerms: me.canCreateTerms, plugins: { rankmath: root.namespaces.includes('rankmath/v1'), yoast: root.namespaces.includes('yoast/v1') } });
    if (!me.canPost) throw new wp.WpError('rights', 'Giriş doğru ama bu kullanıcı yazı oluşturamıyor (en az “Yazar” rolü gerekir)');
    ok = true;
    const notes = [];
    if (!me.canPublish) notes.push('bu kullanıcı yalnızca TASLAK yazabilir, yayımlayamaz');
    if (!me.canUpload) notes.push('görsel yükleme yetkisi yok (kapak görseli aktarılamaz)');
    if (info.plugins.rankmath) notes.push('Rank Math bulundu (SEO alanları yazılabilir)'); else if (info.plugins.yoast) notes.push('Yoast SEO bulundu (SEO alanları yalnızca site REST’e açtıysa yazılır)');
    message = `WordPress bağlantısı çalışıyor: “${root.name || site.domain}”, kullanıcı ${me.name}${notes.length ? ` · ${notes.join('; ')}` : ''}`;
  } catch (err) {
    message = err instanceof wp.WpError || err.name === 'FetchError' ? err.message : 'Bağlantı denenirken beklenmeyen bir hata oldu';
  }
  message = String(message).split(secret).join('[gizli]').slice(0, 400);
  await db.query('UPDATE wp_sites SET last_tested_at = now(), last_test_ok = $2, last_test_message = $3, wp_info = $4 WHERE id = $1', [id, ok, message, JSON.stringify(info)]);
  if (ok) await db.query("UPDATE content_projects SET domain = $2, mode = 'connected', updated_at = now() WHERE id = $1 AND domain IS NULL", [site.project_id, site.domain || new URL(site.api_url).hostname]);          // the first working site turns "Not Connected" into a connected project
  return { ok, message, info };
}

// ── category mapping ────────────────────────────────────────────────────────────────────────────────────────────
const fold = (s) => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();

/** our categories with their mapping to the site's, and (when the site answers) the site's own category list; a name match is only a SUGGESTION */
async function categoryMap(id, { request, live = true } = {}) {
  const site = await load(id);
  const ours = (await db.query("SELECT id, name_en FROM categories WHERE project_id = $1 AND status <> 'archived' ORDER BY priority, name_en", [site.project_id])).rows;
  const map = new Map((await db.query('SELECT * FROM wp_category_map WHERE site_id = $1', [id])).rows.map((r) => [r.category_id, r]));
  let remote = []; let remoteError = null;
  if (live) { try { remote = await (await clientFor(site, { request })).categories(); } catch (err) { remoteError = err.message; } }
  return { siteId: id, remoteError, wpCategories: remote, defaultCategoryId: site.default_category_id,
    categories: ours.map((c) => { const m = map.get(c.id); const hit = remote.find((x) => fold(x.name) === fold(c.name_en));
      return { categoryId: c.id, name: c.name_en, wpCategoryId: m ? m.wp_category_id : null, wpName: m ? m.wp_name : null, suggestion: !m && hit ? { id: hit.id, name: hit.name } : null }; }) };
}

/**
 * Saves the mapping. Each entry: { categoryId, wpCategoryId } (map to an existing category), { categoryId, create: true } (create a category with OUR name on the site) or { categoryId, wpCategoryId: null } (unmap).
 */
async function saveCategoryMap(id, entries, { request } = {}) {
  const site = await load(id);
  if (!Array.isArray(entries) || entries.length > 100) throw bad('Eşleştirme listesi en fazla 100 öğe içerebilir');
  const ours = new Map((await db.query('SELECT id, name_en FROM categories WHERE project_id = $1', [site.project_id])).rows.map((r) => [r.id, r.name_en]));
  const out = { mapped: 0, created: 0, unmapped: 0 }; let client = null; let remote = null;
  for (const e of entries) {
    const cid = V.uuid(e.categoryId, 'Kategori'); if (!ours.has(cid)) throw bad('Kategori bu projeye ait değil');
    if (e.wpCategoryId === null) { await db.query('DELETE FROM wp_category_map WHERE site_id = $1 AND category_id = $2', [id, cid]); out.unmapped++; continue; }
    let wpId; let wpName;
    if (e.create === true) {
      client = client || await clientFor(site, { request });
      try { const c = await client.createCategory(ours.get(cid)); wpId = c.id; wpName = c.name; out.created++; }
      catch (err) { if (err.wpCode === 'term_exists' || err.status === 400) { remote = remote || await client.categories(); const hit = remote.find((x) => fold(x.name) === fold(ours.get(cid))); if (!hit) throw new HttpError(502, err.message); wpId = hit.id; wpName = hit.name; out.mapped++; } else throw new HttpError(err.code === 'rights' ? 403 : 502, err.message); }
    } else { wpId = V.int(e.wpCategoryId, 'WordPress kategorisi', { min: 1, max: 2147483647 }); wpName = V.str(e.wpName, 'Kategori adı', { max: 200 }); out.mapped++; }
    await db.query(`INSERT INTO wp_category_map (site_id, category_id, wp_category_id, wp_name) VALUES ($1,$2,$3,$4) ON CONFLICT (site_id, category_id) DO UPDATE SET wp_category_id = $3, wp_name = $4`, [id, cid, wpId, wpName]);
  }
  return out;
}

module.exports = { SEO_PLUGINS, list, get, load, create, update, remove, clientFor, test, categoryMap, saveCategoryMap };
