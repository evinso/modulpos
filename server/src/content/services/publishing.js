const db = require('../db');
const V = require('../lib/validate');
const H = require('../lib/html');
const safeFetch = require('../lib/safeFetch');
const sched = require('../lib/schedule');
const { dayKey, startOfLocalDay } = require('../lib/time');
const { env } = require('../env');
const { HttpError, bad } = require('../lib/http');
const settings = require('./settings');
const limits = require('./limits');
const queue = require('./queue');
const articles = require('./articles');
const sites = require('./sites');
const wp = require('./wordpress');
const images = require('./images');
const notifications = require('./notifications');

/**
 * Sending articles to WordPress (phase 5). Rules that never bend:
 *  - an article reaches a site only through ONE `publications` row per (article, site): the same article can never be created twice on the same site; the row keeps the
 *    WordPress post id and address, and later edits UPDATE that post (the post id is kept)
 *  - going PUBLIC (publish now / scheduled) needs the article to be "ready" (a person approved it and every mandatory check passes); a draft on the site is allowed earlier
 *  - the day's `publish` limit and the site's own daily limit are checked for the day the post goes public (a scheduled post counts for ITS day)
 *  - a write whose answer was lost (timeout) is "unknown": the retry first looks the post up by its slug and adopts it instead of creating a second copy
 *  - the actual calls run as jobs of the persistent queue (bot `content_publishing`): retried when WordPress is busy, never started twice
 * Real WordPress sites have never been used; the tests talk to a fake WordPress server over real HTTP.
 */
const BOT = 'content_publishing';
const PUBLIC = new Set(['publish', 'schedule']);
const DRAFT_OK = new Set(['needs_review', 'ready', 'needs_update', 'scheduled', 'published']);
const wpToOurs = { publish: 'published', future: 'scheduled', draft: 'draft', pending: 'draft', private: 'draft' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const shape = (r) => r && ({ id: r.id, projectId: r.project_id, articleId: r.article_id, siteId: r.site_id, mode: r.mode, status: r.status, wpPostId: r.wp_post_id === null || r.wp_post_id === undefined ? null : Number(r.wp_post_id), wpUrl: r.wp_url,
  scheduledAt: r.scheduled_at, publishedAt: r.published_at, articleVersion: r.article_version, attempts: r.attempts, lastError: r.last_error, warnings: r.warnings, createdAt: r.created_at, updatedAt: r.updated_at,
  articleTitle: r.article_h1, siteName: r.site_name, articleCurrentVersion: r.article_current_version, hasUpdate: r.article_current_version !== undefined && r.article_version !== null && r.article_current_version > r.article_version });

const SELECT = `SELECT p.*, a.h1 AS article_h1, a.current_version AS article_current_version, s.name AS site_name FROM publications p JOIN articles a ON a.id = p.article_id JOIN wp_sites s ON s.id = p.site_id`;
async function log(id, action, status, message = '') { await db.query('INSERT INTO publication_log (publication_id, action, status, message) VALUES ($1,$2,$3,$4)', [id, action, status, String(message).slice(0, 500)]); }
async function getRow(id) { const r = (await db.query(`${SELECT} WHERE p.id = $1`, [V.uuid(id, 'Yayın')])).rows[0]; if (!r) throw new HttpError(404, 'Yayın kaydı bulunamadı'); return r; }
async function get(id) { return shape(await getRow(id)); }

// ── limits for the day a post goes public ────────────────────────────────────────────────────────────────────────
const siteDay = (when, site) => dayKey(when, site.timezone);
async function siteLoad(site, day, exceptId = null) {
  return (await db.query(`SELECT count(*)::int n FROM publications WHERE site_id = $1 AND mode IN ('publish', 'schedule') AND status IN ('pending', 'sending', 'scheduled', 'published', 'unknown') AND id IS DISTINCT FROM $4
    AND (COALESCE(scheduled_at, published_at, created_at) AT TIME ZONE $2)::date = $3::date`, [site.id, site.timezone, day, exceptId])).rows[0].n;
}

/**
 * Checks everything that can be checked before a send and takes the day's place. Creates (or reuses) the publication row (status "pending") but calls no WordPress.
 * @param o { mode: 'draft' | 'publish' | 'schedule', scheduledAt, userId, manual (a person's own click ignores the "bots paused" switch), now }
 */
async function prepare(articleId, siteId, { mode, scheduledAt = null, userId = null, manual = true, now = new Date(), allowCrossDomain = false } = {}) {
  V.oneOf(mode, 'Yayın şekli', ['draft', 'publish', 'schedule']);
  const a = (await db.query('SELECT id, project_id, category_id, status, h1, current_version FROM articles WHERE id = $1', [V.uuid(articleId, 'Makale')])).rows[0];
  if (!a) throw new HttpError(404, 'Makale bulunamadı');
  const site = await sites.load(siteId);
  if (site.project_id !== a.project_id) throw new HttpError(409, 'Makale ve site farklı projelere ait');
  if (site.status !== 'active') throw new HttpError(409, 'Bu site duraklatılmış');
  let when = now;
  if (mode === 'schedule') {
    when = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) throw bad('Yayın zamanı geçerli değil');
    if (when.getTime() < now.getTime() + 5 * 60000) throw bad('Zamanlanmış yayın en az 5 dakika sonrasına verilebilir');
    if (when.getTime() > now.getTime() + 370 * 86400000) throw bad('Zamanlanmış yayın en fazla 1 yıl sonrasına verilebilir');
  }
  const cur = (await db.query('SELECT * FROM publications WHERE article_id = $1 AND site_id = $2', [a.id, site.id])).rows[0];
  if (!cur && !allowCrossDomain) {                                    // the same text on two domains is duplicate content: refused unless a person explicitly allows it
    const other = (await db.query("SELECT s.name FROM publications p JOIN wp_sites s ON s.id = p.site_id WHERE p.article_id = $1 AND p.site_id <> $2 AND p.status <> 'failed' LIMIT 1", [a.id, site.id])).rows[0];
    if (other) throw new HttpError(409, `Bu makale zaten “${other.name}” sitesine gönderilmiş; aynı içeriğin başka bir alan adında kopyası varsayılan olarak engellenir (kopya içerik). Gerçekten istiyorsanız “başka alan adına da gönder” seçeneğini işaretleyin`, { duplicateDomain: true });
  }
  if (cur && ['pending', 'sending'].includes(cur.status)) throw new HttpError(409, 'Bu makale bu siteye şu anda gönderiliyor');
  const wasPublic = !!cur && ['published', 'scheduled'].includes(cur.status);
  if (wasPublic && mode === 'draft') throw new HttpError(409, 'Yayında/zamanlanmış bir yazı taslağa çevrilemez; WordPress’te yapın');
  if (cur && cur.status === 'published' && mode === 'schedule') throw new HttpError(409, 'Yayımlanmış bir yazı yeniden zamanlanamaz');
  const goesPublic = PUBLIC.has(mode) || wasPublic;
  if (goesPublic) {
    if (!['ready', 'scheduled', 'published'].includes(a.status)) throw new HttpError(409, `Yayımlamak için makale “Yayına hazır” olmalı (şu an: ${articles.STATUS_LABELS[a.status] || a.status}); önce okuyup onaylayın`);
    const r = await articles.readiness(a.id);
    if (!r.ready) throw new HttpError(409, `Makale yayına hazır değil: ${r.problems.filter((p) => p.blocking).map((p) => p.message).join('; ')}`, { problems: r.problems });
  } else if (!DRAFT_OK.has(a.status)) throw new HttpError(409, `“${articles.STATUS_LABELS[a.status] || a.status}” durumundaki makale siteye gönderilemez`);

  let reserved = null;
  const needsPlace = PUBLIC.has(mode) && !(cur && cur.status === 'published') && !(cur && cur.status === 'scheduled' && mode === 'schedule' && cur.scheduled_at && siteDay(new Date(cur.scheduled_at), site) === siteDay(when, site));
  if (needsPlace) {
    const day = siteDay(when, site);
    if (await siteLoad(site, day, cur && cur.id) >= site.daily_limit) throw new HttpError(409, `“${site.name}” sitesinin günlük yayın limiti (${site.daily_limit}) ${day} için dolu`);
    const g = await limits.reserve({ workType: 'publish', projectId: a.project_id, categoryId: a.category_id, amount: 1, manual, now: when });
    if (!g.ok) throw new HttpError(409, g.message, { limit: true });
    reserved = { day: g.day, categoryId: a.category_id };
  }
  const old = cur && cur.reserved_day ? { day: cur.reserved_day, categoryId: cur.reserved_category } : null;
  let row;
  try {
    if (cur) {
      row = (await db.query(`UPDATE publications SET mode = $2, status = 'pending', scheduled_at = $3, last_error = NULL, reserved_day = $4, reserved_category = $5, updated_at = now(), created_by = COALESCE($6, created_by)
        WHERE id = $1 AND status NOT IN ('pending', 'sending') RETURNING *`, [cur.id, mode, mode === 'schedule' ? when : (cur.status === 'scheduled' && mode === 'publish' ? null : cur.scheduled_at), reserved ? reserved.day : (needsPlace ? null : cur.reserved_day), reserved ? reserved.categoryId : cur.reserved_category, userId])).rows[0];
      if (!row) throw new HttpError(409, 'Bu makale bu siteye şu anda gönderiliyor');
    } else {
      row = (await db.query(`INSERT INTO publications (project_id, article_id, site_id, mode, status, scheduled_at, reserved_day, reserved_category, created_by) VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8) RETURNING *`,
        [a.project_id, a.id, site.id, mode, mode === 'schedule' ? when : null, reserved ? reserved.day : null, reserved ? reserved.categoryId : null, userId])).rows[0];
    }
  } catch (err) {
    if (reserved) await limits.release({ workType: 'publish', projectId: a.project_id, categoryId: reserved.categoryId, amount: 1, day: reserved.day });
    if (err.code === '23505') throw new HttpError(409, 'Bu makale bu siteye zaten gönderilmiş');
    throw err;
  }
  if (reserved && old) await limits.release({ workType: 'publish', projectId: a.project_id, categoryId: old.categoryId, amount: 1, day: old.day });         // a re-scheduled post gives its old place back
  await log(row.id, 'prepare', 'pending', `${mode}${mode === 'schedule' ? ` ${when.toISOString()}` : ''}${cur ? ' (güncelleme)' : ''}`);
  return shape(row);
}

/** queues the actual WordPress work of a prepared publication */
async function enqueue(publicationId, { userId = null, trigger = 'manual', now = new Date() } = {}) {
  const q = await queue.enqueue({ botKey: BOT, projectId: (await db.query('SELECT project_id FROM publications WHERE id = $1', [publicationId])).rows[0].project_id, payload: { publicationId }, trigger, dedupeKey: `pub:${publicationId}`, runAfter: now, maxAttempts: 3, userId });
  return q.job;
}

/** one article, one site: the checks, the place of the day, and the job. @returns the publication */
async function submit(articleId, siteId, opts = {}) {
  const pub = await prepare(articleId, siteId, opts);
  await enqueue(pub.id, { userId: opts.userId, now: opts.now });
  return get(pub.id);
}

// ── the send itself ───────────────────────────────────────────────────────────────────────────────────────────────
function postBody({ a, site, categoryIds, tagIds, mediaId, wpStatus, dateGmt, yoast }) {
  const faq = Array.isArray(a.faq) && a.faq.length ? `<h2>Frequently asked questions</h2>${a.faq.map((f) => `<h3>${esc(f.q)}</h3>${f.a}`).join('')}` : '';
  const body = { title: a.h1, slug: a.slug, content: `${a.content_html}${faq}`, excerpt: a.excerpt || a.meta_description || '', status: wpStatus };
  if (categoryIds.length) body.categories = categoryIds;
  if (tagIds.length) body.tags = tagIds;
  if (mediaId) body.featured_media = mediaId;
  if (site.default_author_id) body.author = site.default_author_id;
  if (dateGmt) body.date_gmt = dateGmt;
  if (yoast) body.meta = { _yoast_wpseo_title: a.seo_title, _yoast_wpseo_metadesc: a.meta_description, _yoast_wpseo_focuskw: a.focus_keyword };
  return body;
}

/** Runs one prepared publication against the site. Throws WpError (with `retryable`) so the queue can retry; records every step. @returns the publication */
async function send(publicationId, { request, fetchBinary = safeFetch.fetchBinary } = {}) {
  const claimed = (await db.query("UPDATE publications SET status = 'sending', attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status IN ('pending', 'failed', 'unknown') RETURNING *", [V.uuid(publicationId, 'Yayın')])).rows[0];
  if (!claimed) return get(publicationId);                                                         // already sent / being sent: never twice
  const a = (await db.query('SELECT * FROM articles WHERE id = $1', [claimed.article_id])).rows[0];
  const site = await sites.load(claimed.site_id); const warnings = [];
  const fail = async (err, status) => {
    const final = status === 'failed' && !err.retryable;
    await db.query('UPDATE publications SET status = $2, last_error = $3, warnings = $4, updated_at = now() WHERE id = $1', [claimed.id, status, String(err.message).slice(0, 500), JSON.stringify(warnings)]);
    await log(claimed.id, 'send', status, err.message);
    if (final && claimed.reserved_day && !claimed.wp_post_id) await limits.release({ workType: 'publish', projectId: claimed.project_id, categoryId: claimed.reserved_category, amount: 1, day: claimed.reserved_day });
    if (final) await notifications.create({ type: 'publish_failed', severity: 'warning', title: 'WordPress yayını başarısız oldu', body: `“${a.h1.slice(0, 80)}” → ${site.name}: ${err.message}`, data: { publicationId: claimed.id, articleId: a.id } });
    if (final) err.fatal = true;
    throw err;
  };
  try {
    const client = await sites.clientFor(site, { request });
    // an earlier try may have created the post without our seeing the answer: look it up by slug first, never create a second copy
    let postId = claimed.wp_post_id ? Number(claimed.wp_post_id) : null;
    if (!postId) {
      const same = await client.findBySlug(a.slug);
      if (same.length) {
        if (claimed.status === 'unknown' || claimed.attempts > 1) { postId = same[0].id; warnings.push('Önceki denemeden kalan yazı bulundu ve yeniden kullanıldı'); await log(claimed.id, 'adopt', 'sending', `yazı ${postId}`); }
        else throw Object.assign(new wp.WpError('slug_taken', `Bu bağlantı (“${a.slug}”) sitede zaten bir yazıda kullanılıyor; makalenin bağlantısını değiştirin ya da mevcut yazıyı WordPress’te silin`), { retryable: false });
      }
    }
    // category and tags
    const map = (await db.query('SELECT wp_category_id FROM wp_category_map WHERE site_id = $1 AND category_id = $2', [site.id, a.category_id])).rows[0];
    const categoryIds = map ? [map.wp_category_id] : (site.default_category_id ? [site.default_category_id] : []);
    if (!categoryIds.length) warnings.push('Kategori eşleştirilmedi: yazı sitenin varsayılan kategorisine düşer');
    const tagIds = [];
    for (const t of (a.tags || []).slice(0, 8)) { try { tagIds.push(await client.tagId(t)); } catch (err) { warnings.push(`Etiket “${t}” aktarılamadı: ${err.message}`); break; } }
    // featured image: an address the owner typed (fetched through the guarded fetcher) wins; otherwise the cover picture stored with the article is uploaded (its alt text goes along)
    let mediaId = claimed.wp_media_id ? Number(claimed.wp_media_id) : null; let mediaSource = claimed.media_source;
    const cover = a.featured_image_url ? null : await images.file(a.id);
    if (cover && `stored:${cover.id}` !== claimed.media_source) {
      try { mediaId = (await client.uploadMedia({ buffer: cover.buffer, filename: `${a.slug}.${cover.mime.split('/')[1].replace('jpeg', 'jpg')}`, mime: cover.mime, alt: cover.alt || a.h1 })).id; mediaSource = `stored:${cover.id}`; }
      catch (err) { warnings.push(`Kapak görseli aktarılamadı: ${err.message}`); }
    } else if (a.featured_image_url && a.featured_image_url !== claimed.media_source) {
      try {
        const img = await fetchBinary(a.featured_image_url, { maxBytes: 4 * 1024 * 1024 });
        if (!/^image\/(jpeg|png|webp|gif)$/.test(img.contentType)) throw new Error(`desteklenmeyen dosya türü (${img.contentType || 'bilinmiyor'})`);
        mediaId = (await client.uploadMedia({ buffer: img.buffer, filename: `${a.slug}.${img.contentType.split('/')[1].replace('jpeg', 'jpg')}`, mime: img.contentType, alt: a.h1 })).id; mediaSource = a.featured_image_url;
      } catch (err) { warnings.push(`Kapak görseli aktarılamadı: ${err.message}`); }
    }
    const wpStatus = claimed.mode === 'draft' ? 'draft' : claimed.mode === 'schedule' ? 'future' : 'publish';
    const dateGmt = claimed.mode === 'schedule' ? new Date(claimed.scheduled_at).toISOString().replace(/\.\d+Z$/, '') : null;
    const body = postBody({ a, site, categoryIds, tagIds, mediaId, wpStatus, dateGmt, yoast: site.seo_plugin === 'yoast' });
    const post = postId ? await client.updatePost(postId, body) : await client.createPost(body);
    // SEO fields through the plugin's own supported way
    if (site.seo_plugin === 'rankmath') { try { await client.rankMathMeta(post.id, { title: a.seo_title, description: a.meta_description, focusKeyword: a.focus_keyword }); } catch (err) { warnings.push(`Rank Math SEO alanları yazılamadı: ${err.message}`); } }
    if (site.seo_plugin === 'yoast' && !(post.meta && post.meta._yoast_wpseo_metadesc !== undefined)) warnings.push('Yoast SEO alanları yazılamadı: site bu alanları REST’e açmamış (Yoast bunun için resmî bir yazma yolu sunmuyor); meta açıklama yazının özeti olarak gönderildi');
    if (site.seo_plugin === 'none' && a.meta_description) warnings.push('SEO eklentisi seçilmedi: meta açıklama yalnızca yazının özeti (excerpt) olarak gönderildi');
    const ours = wpToOurs[post.status] || 'draft'; const isPublic = ours === 'published' || ours === 'scheduled';
    await db.query(`UPDATE publications SET status = $2, wp_post_id = $3, wp_url = $4, published_at = CASE WHEN $2 = 'published' THEN COALESCE($5::timestamptz, now()) ELSE published_at END,
      article_version = $6, wp_media_id = $7, media_source = $8, last_error = NULL, warnings = $9, updated_at = now() WHERE id = $1`, [claimed.id, ours, post.id, post.link, post.date, a.current_version, mediaId, mediaSource, JSON.stringify(warnings)]);
    await log(claimed.id, postId ? 'update' : 'create', ours, `${post.link || ''}${warnings.length ? ` (${warnings.length} uyarı)` : ''}`);
    if (isPublic) await db.query('UPDATE articles SET status = $2, updated_at = now() WHERE id = $1 AND status IN (\'ready\', \'scheduled\', \'published\')', [a.id, ours === 'published' ? 'published' : 'scheduled']);
    return get(claimed.id);
  } catch (e) {
    let err = e;
    if (!(err instanceof wp.WpError) && err.name !== 'FetchError') err = Object.assign(new Error(`Beklenmeyen hata: ${err.message}`), { retryable: false });
    if (['auth', 'rights', 'no_rest', 'not_wp', 'gone', 'invalid', 'slug_taken', 'url', 'ssrf', 'redirect'].includes(err.code)) err.retryable = false;
    return fail(err, err.maybeSent ? 'unknown' : 'failed');
  }
}

/** the queue gave up after its last attempt: give the day's place back and tell the owner (a hopeless error did this already inside send) */
async function giveUp(publicationId, err) {
  const r = (await db.query("UPDATE publications SET status = CASE WHEN status = 'unknown' THEN 'unknown' ELSE 'failed' END, last_error = $2, updated_at = now() WHERE id = $1 AND status IN ('failed', 'unknown', 'sending', 'pending') RETURNING *", [publicationId, String(err.message).slice(0, 500)])).rows[0];
  if (!r) return;
  if (r.reserved_day && !r.wp_post_id && r.status !== 'unknown') await limits.release({ workType: 'publish', projectId: r.project_id, categoryId: r.reserved_category, amount: 1, day: r.reserved_day });
  const a = (await db.query('SELECT h1 FROM articles WHERE id = $1', [r.article_id])).rows[0];
  await log(r.id, 'give_up', r.status, err.message);
  await notifications.create({ type: 'publish_failed', severity: 'warning', title: 'WordPress yayını başarısız oldu', body: `“${(a ? a.h1 : '').slice(0, 80)}”: ${err.message}`, data: { publicationId: r.id } });
}

/** a person clears a publication whose post vanished from WordPress (so it can be sent again as new) */
async function reset(publicationId) {
  const r = (await db.query(`UPDATE publications SET wp_post_id = NULL, wp_url = NULL, status = 'failed', last_error = 'Kayıt sıfırlandı: yazı yeniden oluşturulacak', published_at = NULL, article_version = NULL, wp_media_id = NULL, media_source = NULL, updated_at = now()
    WHERE id = $1 AND status IN ('failed', 'unknown', 'draft') RETURNING id`, [V.uuid(publicationId, 'Yayın')])).rows[0];
  if (!r) throw new HttpError(409, 'Yalnızca başarısız/bilinmeyen/taslak kayıtlar sıfırlanabilir');
  await log(publicationId, 'reset', 'failed', 'kişi tarafından'); return get(publicationId);
}

const DRAFT_RECHECK_MIN = 30;                                    // a draft is asked about again only after this long (a person asking by hand is never held back)
/** the date WordPress gives, when it is a real one (a draft that was never public can carry "0000-00-00") */
const wpDate = (iso, fallback) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) && d.getUTCFullYear() > 2000 ? d : fallback; };

/**
 * What became of our posts on the WordPress side, read back so the panel tells the truth. Two cases:
 *  - a SCHEDULED post whose time has come (WordPress publishes it by itself);
 *  - a DRAFT that a person published, or scheduled, in WordPress by hand. That is the normal way in "Yarı otomatik": the system only ever sends drafts, the last word is in WordPress.
 * READ ONLY towards WordPress (one GET per post, nothing is sent, changed or published there). The article becomes "Yayımlandı" / "Zamanlandı" only from an approval-stage status
 * (a person's own click in WordPress is the truth); the publication keeps its `mode` (how WE sent it) and takes no place from the day's limits: the system did not do the publishing.
 * @param o { articleId (a person asked about this article: all its draft and scheduled posts are read now), projectId, limit }
 * @returns { checked, published, scheduled, errors }
 */
async function syncDue({ projectId = null, articleId = null, now = new Date(), limit = 30, request } = {}) {
  const p = []; let where;
  if (articleId) { p.push(V.uuid(articleId, 'Makale')); where = `p.article_id = $1 AND p.status IN ('scheduled', 'draft')`; }
  else { p.push(now); where = `((p.status = 'scheduled' AND p.scheduled_at <= $1) OR (p.status = 'draft' AND (p.synced_at IS NULL OR p.synced_at <= $1::timestamptz - interval '${DRAFT_RECHECK_MIN} minutes')))`; }
  if (projectId) { p.push(V.uuid(projectId, 'Proje')); where += ` AND p.project_id = $${p.length}`; }
  const rows = (await db.query(`SELECT p.* FROM publications p WHERE p.wp_post_id IS NOT NULL AND ${where} ORDER BY (p.status = 'scheduled') DESC, p.synced_at NULLS FIRST, p.scheduled_at LIMIT ${Math.min(50, limit | 0 || 30)}`, p)).rows;
  const out = { checked: 0, published: 0, scheduled: 0, errors: 0 };
  for (const r of rows) {
    out.checked++;
    try {
      const site = await sites.load(r.site_id); const post = await (await sites.clientFor(site, { request })).getPost(r.wp_post_id);
      const ours = wpToOurs[post.status] || 'draft'; const byHand = r.status === 'draft';
      if (ours === 'published') {
        await db.query("UPDATE publications SET status = 'published', published_at = $2, wp_url = $3, synced_at = $4, updated_at = now() WHERE id = $1", [r.id, wpDate(post.date, now), post.link, now]);
        await db.query("UPDATE articles SET status = 'published', updated_at = now() WHERE id = $1 AND status IN ('needs_review', 'ready', 'scheduled', 'needs_update')", [r.article_id]);
        if (byHand) await db.query("UPDATE articles SET adsense_accepted_risk = 'review', adsense_accepted_at = now(), adsense_accepted_note = 'WordPress’te elle yayımlandı (yayımlayan kişi kabul etmiş sayıldı)' WHERE id = $1 AND adsense_risk = 'review' AND adsense_accepted_risk IS NULL", [r.article_id]);
        await log(r.id, 'sync', 'published', byHand ? `WordPress’te elle yayımlanmış: ${post.link}` : post.link); out.published++;
      } else if (ours === 'scheduled' && byHand && wpDate(post.date, null)) {
        await db.query("UPDATE publications SET status = 'scheduled', scheduled_at = $2, wp_url = $3, synced_at = $4, updated_at = now() WHERE id = $1", [r.id, wpDate(post.date, now), post.link, now]);
        await db.query("UPDATE articles SET status = 'scheduled', updated_at = now() WHERE id = $1 AND status IN ('needs_review', 'ready', 'needs_update')", [r.article_id]);
        await log(r.id, 'sync', 'scheduled', `WordPress’te elle zamanlanmış: ${post.link}`); out.scheduled++;
      } else await db.query('UPDATE publications SET synced_at = $2 WHERE id = $1', [r.id, now]);
    } catch (err) { out.errors++; await db.query('UPDATE publications SET synced_at = $2 WHERE id = $1', [r.id, now]); await log(r.id, 'sync', r.status, err.message); }
  }
  return out;
}

// ── planning many articles ───────────────────────────────────────────────────────────────────────────────────────
const at = (day, minutes, tz) => new Date(startOfLocalDay(day, tz).getTime() + minutes * 60000);

/**
 * A dry run for "send these articles": which day and time each one would go, within the working window, the weekend setting, the site's daily limit and the project's
 * daily `publish` limit (nothing beyond a limit is planned). mode: 'draft' | 'publish_now' | 'spread'.
 * @returns { items: [{ articleId, title, mode, scheduledAt, day }], unplanned: [{ articleId, title, reason }] }
 */
async function plan({ siteId, articleIds, mode, startAt = null, now = new Date() }) {
  V.oneOf(mode, 'Gönderim şekli', ['draft', 'publish_now', 'spread']);
  if (!Array.isArray(articleIds) || !articleIds.length || articleIds.length > 200) throw bad('1 ile 200 arasında makale seçin');
  const site = await sites.load(siteId); const ids = [...new Set(articleIds.map((x) => V.uuid(x, 'Makale')))];
  const rows = (await db.query(`SELECT a.id, a.h1, a.status, a.quality_score, p.status AS pub_status FROM articles a LEFT JOIN publications p ON p.article_id = a.id AND p.site_id = $2 WHERE a.id = ANY($1) AND a.project_id = $3`, [ids, site.id, site.project_id])).rows;
  const byId = new Map(rows.map((r) => [r.id, r])); const items = []; const unplanned = [];
  const eligible = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { unplanned.push({ articleId: id, title: '?', reason: 'Makale bulunamadı ya da bu projeye ait değil' }); continue; }
    if (r.pub_status && r.pub_status !== 'failed') { unplanned.push({ articleId: id, title: r.h1, reason: `Bu siteye zaten gönderilmiş (${r.pub_status})` }); continue; }
    if (mode === 'draft' ? !DRAFT_OK.has(r.status) : r.status !== 'ready') { unplanned.push({ articleId: id, title: r.h1, reason: mode === 'draft' ? `“${articles.STATUS_LABELS[r.status]}” durumundaki makale gönderilemez` : `Yayımlamak için “Yayına hazır” olmalı (şu an: ${articles.STATUS_LABELS[r.status]})` }); continue; }
    eligible.push(r);
  }
  eligible.sort((x, y) => (y.quality_score || 0) - (x.quality_score || 0));                       // the strongest articles go first
  if (mode === 'draft') { for (const r of eligible) items.push({ articleId: r.id, title: r.h1, mode: 'draft', scheduledAt: null, day: null }); return { items, unplanned, site: { id: site.id, name: site.name } }; }

  const pub = (await settings.get('publishing', site.project_id)).value;
  const startMin = sched.toMinutes(pub.windowStart) ?? 540; const endMin = sched.toMinutes(pub.windowEnd) ?? 1260;
  const tz = site.timezone;
  let cursor = startAt ? new Date(startAt) : new Date(now.getTime() + 10 * 60000);
  if (Number.isNaN(cursor.getTime()) || cursor < new Date(now.getTime() + 5 * 60000)) cursor = new Date(now.getTime() + 10 * 60000);
  const first = dayKey(cursor, tz); const dayList = [];
  for (let i = 0; i < 120; i++) { const d = new Date(startOfLocalDay(first, tz).getTime() + i * 86400000 + 3600000); const k = dayKey(d, tz); if (!dayList.includes(k)) dayList.push(k); }
  const placed = (await db.query(`SELECT (COALESCE(scheduled_at, published_at, created_at) AT TIME ZONE $2)::date::text AS d, count(*)::int n FROM publications WHERE site_id = $1 AND mode IN ('publish', 'schedule') AND status IN ('pending', 'sending', 'scheduled', 'published', 'unknown') GROUP BY 1`, [site.id, tz])).rows;
  const siteUsed = new Map(placed.map((r) => [r.d, r.n]));
  const g = new Map((await db.query("SELECT scope, max_per_day FROM daily_work_limits WHERE work_type = 'publish' AND (scope = 'global' OR (scope = 'project' AND project_id = $1))", [site.project_id])).rows.map((r) => [r.scope, r.max_per_day]));
  const usage = (await db.query("SELECT day::text AS d, scope, used FROM daily_work_usage WHERE work_type = 'publish' AND day = ANY($1::date[]) AND (scope = 'global' OR (scope = 'project' AND project_id = $2))", [dayList, site.project_id])).rows;
  const globalLimit = g.has('global') ? g.get('global') : 5; const projectLimit = g.has('project') ? g.get('project') : null;
  const used = (d, scope) => (usage.find((u) => u.d === d && u.scope === scope) || { used: 0 }).used;
  let idx = 0;
  const wantNow = mode === 'publish_now';
  for (const d of (wantNow ? [first] : dayList)) {
    if (idx >= eligible.length) break;
    const wd = sched.localParts(at(d, 720, tz), tz).weekday;
    if (!wantNow && !pub.weekends && wd > 5) continue;
    let room = Math.min(site.daily_limit - (siteUsed.get(d) || 0), globalLimit - used(d, 'global'), projectLimit === null ? Infinity : projectLimit - used(d, 'project'));
    if (room <= 0) continue;
    room = Math.min(room, eligible.length - idx);
    if (wantNow) { for (let i = 0; i < room; i++, idx++) items.push({ articleId: eligible[idx].id, title: eligible[idx].h1, mode: 'publish', scheduledAt: null, day: d }); break; }
    let lo = startMin; const hi = Math.max(lo + 30, endMin - 30);
    if (d === first) { const nowMin = sched.localParts(new Date(Math.max(cursor.getTime(), now.getTime() + 15 * 60000)), tz).minutes; lo = Math.max(lo, Math.ceil(nowMin / 5) * 5); if (lo >= endMin) continue; }
    const step = room > 1 ? Math.max(5, Math.floor((hi - lo) / (room - 1))) : 0;
    for (let i = 0; i < room; i++, idx++) { const t = at(d, Math.min(hi, lo + i * step), tz); if (t.getTime() < now.getTime() + 5 * 60000) { idx -= 0; continue; } items.push({ articleId: eligible[idx].id, title: eligible[idx].h1, mode: 'schedule', scheduledAt: t.toISOString(), day: d }); }
  }
  for (const r of eligible.slice(idx)) unplanned.push({ articleId: r.id, title: r.h1, reason: wantNow ? 'Bugünkü yayın limiti doldu' : 'Önümüzdeki 120 günde boş yayın yeri bulunamadı' });
  return { items, unplanned, site: { id: site.id, name: site.name } };
}

/**
 * Sends a whole plan: for each planned article the same checks as a single send, then one queue job each. A bulk send of 60 articles is itself a background job
 * (`submitBatch`), because each article needs a handful of database round trips to the far-away database.
 * @returns { created: [publicationId], rejected: [{ articleId, title, reason }] }
 */
async function submitPlan(items, siteId, { userId = null, manual = true, now = new Date() } = {}) {
  const out = { created: [], rejected: [] };
  for (const it of items) {
    try { const pub = await prepare(it.articleId, siteId, { mode: it.mode, scheduledAt: it.scheduledAt, userId, manual, now }); await enqueue(pub.id, { userId, trigger: manual ? 'manual' : 'schedule', now }); out.created.push(pub.id); }
    catch (err) { out.rejected.push({ articleId: it.articleId, title: it.title, reason: err.message }); }
  }
  return out;
}
async function submitBatch({ siteId, articleIds, mode, startAt = null, userId = null, now = new Date() }) {
  const site = await sites.load(siteId);
  const p = await plan({ siteId, articleIds, mode, startAt, now });
  const q = await queue.enqueue({ botKey: BOT, projectId: site.project_id, payload: { batch: { siteId, items: p.items } }, trigger: 'manual', dedupeKey: null, runAfter: now, maxAttempts: 1, userId });
  return { job: q.job, planned: p.items.length, unplanned: p.unplanned };
}

// ── reading ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function list(projectId, { siteId = null, status = null, articleId = null, limit = 100 } = {}) {
  const p = [projectId]; const w = ['p.project_id = $1'];
  if (siteId) { p.push(V.uuid(siteId, 'Site')); w.push(`p.site_id = $${p.length}`); }
  if (status) { p.push(V.oneOf(status, 'Durum', ['pending', 'sending', 'draft', 'scheduled', 'published', 'failed', 'unknown'])); w.push(`p.status = $${p.length}`); }
  if (articleId) { p.push(V.uuid(articleId, 'Makale')); w.push(`p.article_id = $${p.length}`); }
  p.push(Math.min(300, Math.max(1, limit | 0 || 100)));
  return (await db.query(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY COALESCE(p.scheduled_at, p.published_at, p.created_at) DESC LIMIT $${p.length}`, p)).rows.map(shape);
}
async function history(id) { return (await db.query('SELECT at, action, status, message FROM publication_log WHERE publication_id = $1 ORDER BY id', [V.uuid(id, 'Yayın')])).rows; }

/** the publishing calendar: what is scheduled / published per day, and (for the preparation calendar) how many articles were written per day */
async function calendar(projectId, { from, to, tz = env().defaultTimezone } = {}) {
  const a = from ? new Date(from) : new Date(Date.now() - 7 * 86400000); const b = to ? new Date(to) : new Date(Date.now() + 30 * 86400000);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b - a > 400 * 86400000) throw bad('Tarih aralığı geçersiz (en çok 400 gün)');
  const pubs = (await db.query(`${SELECT} WHERE p.project_id = $1 AND p.status IN ('scheduled', 'published') AND COALESCE(p.scheduled_at, p.published_at) BETWEEN $2 AND $3 ORDER BY COALESCE(p.scheduled_at, p.published_at)`, [projectId, a, b])).rows.map(shape);
  const made = (await db.query(`SELECT (created_at AT TIME ZONE $4)::date::text AS day, count(*)::int AS n FROM articles WHERE project_id = $1 AND status <> 'archived' AND created_by = 'ai' AND created_at BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`, [projectId, a, b, tz])).rows;
  const ready = (await db.query("SELECT count(*)::int n FROM articles WHERE project_id = $1 AND status = 'ready' AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.article_id = articles.id)", [projectId])).rows[0].n;
  return { from: a, to: b, publications: pubs, written: made, readyUnsent: ready, timezone: tz };
}

module.exports = { BOT, prepare, enqueue, submit, send, giveUp, reset, syncDue, plan, submitPlan, submitBatch, list, get, history, calendar, postBody, shape };
