const db = require('../db');
const V = require('../lib/validate');
const H = require('../lib/html');
const { toCsv } = require('../lib/csv');
const { HttpError, bad } = require('../lib/http');
const settings = require('./settings');
const projects = require('./projects');
const checks = require('./checks');
const { diffWords } = require('../lib/diff');

/**
 * The article archive: articles live in the content database (never on a public site) until they are published to WordPress (phase 5).
 *  - every write sanitises the HTML (lib/html.js), recomputes the word count and, when something changed, stores a NEW version (snapshot of every editable field)
 *  - "Last Updated" (last_updated_at) moves only on an explicit meaningful update, never by a typo fix or a status change
 *  - an article a person edited is marked manual_edited: automation must never overwrite it silently
 *  - statuses: a person may set only the ones in TRANSITIONS; the engine owns generating / fact_checking / scheduled / published ...
 *  - "ready" needs readiness() to pass: the mandatory checks (fact check, AdSense risk, duplicate / cannibalisation, excluded topics, sources for news types, minimum length)
 *  - two people editing the same article: the second save with a stale `expectedVersion` is refused (409) instead of silently winning
 */
const STATUSES = ['topic_discovered', 'seo_researching', 'ready_to_generate', 'generating', 'fact_checking', 'needs_review', 'ready', 'scheduled', 'published', 'needs_update', 'updating', 'archived', 'failed'];
const STATUS_LABELS = { topic_discovered: 'Konu bulundu', seo_researching: 'SEO araştırılıyor', ready_to_generate: 'Üretime hazır', generating: 'Üretiliyor', fact_checking: 'Doğruluk kontrolünde', needs_review: 'Onay bekliyor',
  ready: 'Yayına hazır', scheduled: 'Zamanlandı', published: 'Yayımlandı', needs_update: 'Güncelleme bekliyor', updating: 'Güncelleniyor', archived: 'Arşivde', failed: 'Başarısız' };
const TYPES = projects.CONTENT_TYPES;
const NEWS_TYPES = new Set(['breaking_news_explainer', 'latest_update', 'product_update', 'consumer_alert']);
const MIN_WORDS = 300;
const MAX_HTML = 300000;
const RISKS = ['low', 'review', 'blocked'];

/** what a person may do by hand: from -> allowed targets */
const TRANSITIONS = {
  topic_discovered: ['archived'], seo_researching: ['archived'], ready_to_generate: ['archived'],
  needs_review: ['ready', 'needs_update', 'archived'], ready: ['needs_review', 'archived'], needs_update: ['needs_review', 'archived', 'published'],
  failed: ['needs_review', 'archived'], archived: ['needs_review'], published: ['needs_update'],
};
const DELETABLE = new Set(['topic_discovered', 'seo_researching', 'ready_to_generate', 'needs_review', 'ready', 'needs_update', 'failed', 'archived']);

const SNAPSHOT_FIELDS = ['categoryId', 'articleType', 'seoTitle', 'h1', 'slug', 'metaDescription', 'focusKeyword', 'secondaryKeywords', 'excerpt', 'contentHtml', 'faq', 'tags', 'targetCountry', 'language', 'featuredImageUrl', 'adsenseRisk'];

function row(r, { withContent = true } = {}) {
  if (!r) return r;
  const out = {
    id: r.id, projectId: r.project_id, categoryId: r.category_id, categoryName: r.category_name, status: r.status, statusLabel: STATUS_LABELS[r.status], articleType: r.article_type, seoTitle: r.seo_title, h1: r.h1, slug: r.slug,
    metaDescription: r.meta_description, focusKeyword: r.focus_keyword, secondaryKeywords: r.secondary_keywords, excerpt: r.excerpt, faq: r.faq, tags: r.tags, targetCountry: r.target_country, language: r.language,
    qualityScore: r.quality_score, adsenseRisk: r.adsense_risk, adsenseAccepted: r.adsense_risk === 'review' && r.adsense_accepted_risk === 'review', adsenseAcceptedAt: r.adsense_accepted_at, adsenseAcceptedNote: r.adsense_accepted_note, factCheckedAt: r.fact_checked_at, lastUpdatedAt: r.last_updated_at, featuredImageUrl: r.featured_image_url, wordCount: r.word_count,
    currentVersion: r.current_version, generation: r.generation, manualEdited: r.manual_edited, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at,
  };
  if (withContent) out.contentHtml = r.content_html;
  return out;
}

const httpsUrl = (v, label) => {
  const s = V.str(v, label, { max: 500 });
  if (!s) return '';
  let u; try { u = new URL(s); } catch { throw bad(`${label} geçerli bir adres olmalı`); }
  if (u.protocol !== 'https:') throw bad(`${label} https ile başlamalı`);
  return u.toString();
};

function faqList(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 20) throw bad('SSS en fazla 20 soru içeren bir liste olmalı');
  return v.map((x) => {
    if (!x || typeof x !== 'object') throw bad('SSS öğeleri { q, a } olmalı');
    const q = H.htmlToText(V.str(x.q, 'SSS sorusu', { max: 300 })); const a = H.sanitizeArticleHtml(V.str(x.a, 'SSS cevabı', { max: 3000, multiline: true }));
    if (!q || !H.htmlToText(a)) throw bad('SSS sorusu ve cevabı boş olamaz');
    return { q, a };
  });
}

/** Validates the editable fields that were SENT; returns { camelName: value } for them only. */
function fields(b, { create = false } = {}) {
  const f = {};
  const has = (k) => b[k] !== undefined;
  if (has('articleType') || create) f.articleType = V.oneOf(b.articleType, 'Makale türü', TYPES, { fallback: 'evergreen_guide' });
  if (has('h1') || create) f.h1 = V.str(b.h1, 'Ana başlık (H1)', { required: create || has('h1'), max: 200 });
  if (has('seoTitle')) f.seoTitle = V.str(b.seoTitle, 'SEO başlığı', { max: 120 });
  if (has('metaDescription')) f.metaDescription = V.str(b.metaDescription, 'Meta açıklama', { max: 320 });
  if (has('focusKeyword')) f.focusKeyword = V.str(b.focusKeyword, 'Odak anahtar kelime', { max: 120 }).toLowerCase();
  if (has('secondaryKeywords')) f.secondaryKeywords = V.strList(b.secondaryKeywords, 'İkincil anahtar kelimeler', { maxItems: 30, maxLen: 120 }).map((x) => x.toLowerCase());
  if (has('excerpt')) f.excerpt = V.str(b.excerpt, 'Özet', { max: 600, multiline: true });
  if (has('contentHtml')) { const raw = V.str(b.contentHtml, 'İçerik', { max: MAX_HTML * 2, multiline: true, trim: true }); f.contentHtml = H.sanitizeArticleHtml(raw); if (f.contentHtml.length > MAX_HTML) throw bad('İçerik çok uzun'); }
  if (has('faq')) f.faq = faqList(b.faq);
  if (has('tags')) f.tags = V.strList(b.tags, 'Etiketler', { maxItems: 30, maxLen: 60 });
  if (has('targetCountry')) f.targetCountry = V.str(b.targetCountry, 'Hedef ülke', { required: true, max: 2 }).toUpperCase();
  if (has('language')) f.language = V.str(b.language, 'Dil', { required: true, max: 10 });
  if (has('featuredImageUrl')) f.featuredImageUrl = httpsUrl(b.featuredImageUrl, 'Öne çıkan görsel');
  if (has('adsenseRisk')) f.adsenseRisk = b.adsenseRisk === null || b.adsenseRisk === '' ? null : V.oneOf(b.adsenseRisk, 'AdSense risk sonucu', RISKS);
  if (has('categoryId')) f.categoryId = b.categoryId ? V.uuid(b.categoryId, 'Kategori') : null;
  if (has('slug') && b.slug !== '' && b.slug !== null) {
    const s = V.str(b.slug, 'Bağlantı (slug)', { max: 100 });
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw bad('Bağlantı yalnızca küçük harf, rakam ve tire içermeli (ör. new-ai-tool-explained)');
    f.slug = s;
  }
  if (f.targetCountry && !/^[A-Z]{2}$/.test(f.targetCountry)) throw bad('Hedef ülke iki harfli kod olmalı (ör. US)');
  return f;
}

async function freeSlug(c, projectId, base, exceptId = null) {
  const root = base || 'article';
  for (let i = 1; i < 500; i++) {
    const s = i === 1 ? root : `${root.slice(0, 94)}-${i}`;
    const hit = (await c.query('SELECT 1 FROM articles WHERE project_id = $1 AND slug = $2 AND ($3::uuid IS NULL OR id <> $3)', [projectId, s, exceptId])).rows[0];
    if (!hit) return s;
  }
  throw new HttpError(409, 'Uygun bir bağlantı (slug) bulunamadı');
}

async function checkCategory(c, projectId, categoryId) {
  if (!categoryId) return;
  const cat = (await c.query('SELECT project_id, status FROM categories WHERE id = $1', [categoryId])).rows[0];
  if (!cat || cat.project_id !== projectId) throw bad('Kategori bu projeye ait değil');
  if (cat.status === 'archived') throw bad('Arşivlenmiş kategoriye makale eklenemez');
}

const snapshotOf = (r) => ({
  categoryId: r.category_id, articleType: r.article_type, seoTitle: r.seo_title, h1: r.h1, slug: r.slug, metaDescription: r.meta_description, focusKeyword: r.focus_keyword, secondaryKeywords: r.secondary_keywords,
  excerpt: r.excerpt, contentHtml: r.content_html, faq: r.faq, tags: r.tags, targetCountry: r.target_country, language: r.language, featuredImageUrl: r.featured_image_url, adsenseRisk: r.adsense_risk,
});

const COLS = { categoryId: 'category_id', articleType: 'article_type', seoTitle: 'seo_title', h1: 'h1', slug: 'slug', metaDescription: 'meta_description', focusKeyword: 'focus_keyword', secondaryKeywords: 'secondary_keywords',
  excerpt: 'excerpt', contentHtml: 'content_html', faq: 'faq', tags: 'tags', targetCountry: 'target_country', language: 'language', featuredImageUrl: 'featured_image_url', adsenseRisk: 'adsense_risk' };
const JSONB = new Set(['faq']);

// ── create / read ───────────────────────────────────────────────────────────────────────────────────────────
async function create(body, { userId = null } = {}) {
  const projectId = V.uuid(body.projectId, 'Proje');
  await projects.getProject(projectId);
  const f = fields(body, { create: true });
  return db.tx(async (c) => {
    await checkCategory(c, projectId, f.categoryId);
    let slug;
    if (f.slug) {
      if ((await c.query('SELECT 1 FROM articles WHERE project_id = $1 AND slug = $2', [projectId, f.slug])).rows[0]) throw new HttpError(409, 'Bu bağlantı (slug) bu projede zaten kullanılıyor');
      slug = f.slug;
    } else slug = await freeSlug(c, projectId, H.slugify(f.h1));
    const html = f.contentHtml || '';
    const r = (await c.query(`INSERT INTO articles (project_id, category_id, status, article_type, seo_title, h1, slug, meta_description, focus_keyword, secondary_keywords, excerpt, content_html, faq, tags,
        target_country, language, featured_image_url, adsense_risk, word_count, manual_edited, created_by, created_user)
      VALUES ($1,$2,'needs_review',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true,'manual',$19) RETURNING *`,
    [projectId, f.categoryId || null, f.articleType, f.seoTitle || f.h1, f.h1, slug, f.metaDescription || '', f.focusKeyword || '', f.secondaryKeywords || [], f.excerpt || '', html, JSON.stringify(f.faq || []), f.tags || [],
      f.targetCountry || 'US', f.language || 'en-US', f.featuredImageUrl || '', f.adsenseRisk || null, H.wordCount(html), userId])).rows[0];
    await c.query('INSERT INTO article_versions (article_id, version, snapshot, reason, created_by, created_user) VALUES ($1,1,$2,$3,$4,$5)', [r.id, JSON.stringify(snapshotOf(r)), 'İlk sürüm', 'manual', userId]);
    return row(r);
  });
}

/**
 * An article written by a model (phase 3). The fields go through the same validation and HTML sanitiser as a typed article; the article starts in "fact_checking"
 * (the checks run next), is marked created_by 'ai' and NOT manual_edited, and carries who wrote it (`generation`) and the sources it was written from.
 * @param body the model's fields  @param o { projectId, categoryId, generation, sources: [{ url, title, publisher, text, reliability, readOk }] }
 */
async function createFromAi(body, { projectId, categoryId = null, generation = {}, sources: srcs = [] }) {
  await projects.getProject(projectId);
  const f = fields({ ...body, categoryId: categoryId || undefined }, { create: true });
  return db.tx(async (c) => {
    await checkCategory(c, projectId, f.categoryId);
    const slug = await freeSlug(c, projectId, f.slug || H.slugify(f.h1));
    const html = f.contentHtml || '';
    const r = (await c.query(`INSERT INTO articles (project_id, category_id, status, article_type, seo_title, h1, slug, meta_description, focus_keyword, secondary_keywords, excerpt, content_html, faq, tags,
        target_country, language, word_count, manual_edited, created_by, generation)
      VALUES ($1,$2,'fact_checking',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false,'ai',$17) RETURNING *`,
    [projectId, f.categoryId || null, f.articleType, f.seoTitle || f.h1, f.h1, slug, f.metaDescription || '', f.focusKeyword || '', f.secondaryKeywords || [], f.excerpt || '', html, JSON.stringify(f.faq || []), f.tags || [],
      f.targetCountry || 'US', f.language || 'en-US', H.wordCount(html), JSON.stringify(generation || {})])).rows[0];
    await c.query('INSERT INTO article_versions (article_id, version, snapshot, reason, created_by) VALUES ($1,1,$2,$3,$4)', [r.id, JSON.stringify(snapshotOf(r)), 'Yapay zekâ ilk taslağı', 'ai']);
    for (const s2 of srcs) await c.query('INSERT INTO article_sources (article_id, url, title, publisher, excerpt, reliability, read_ok, note, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [r.id, s2.url, String(s2.title || '').slice(0, 300), String(s2.publisher || '').slice(0, 150), String(s2.text || '').slice(0, 5000), Number.isFinite(s2.reliability) ? s2.reliability : null, !!s2.readOk, s2.readOk ? '' : 'Sayfa okunamadı: yalnızca başlık ve özet', s2.n || 0]);
    return row(r);
  });
}

async function loadRow(id, c = db) {
  const r = (await c.query('SELECT a.*, c.name_en AS category_name FROM articles a LEFT JOIN categories c ON c.id = a.category_id WHERE a.id = $1', [V.uuid(id, 'Makale')])).rows[0];
  if (!r) throw new HttpError(404, 'Makale bulunamadı');
  return r;
}

async function get(id) {
  const r = await loadRow(id);
  const sources = (await db.query('SELECT id, url, title, publisher, note, accessed_at FROM article_sources WHERE article_id = $1 ORDER BY accessed_at, id', [id])).rows;
  const live = (await liveMap([r.id])).get(r.id) || null;
  return { ...row(r), live, sources: sources.map((s) => ({ id: s.id, url: s.url, title: s.title, publisher: s.publisher, note: s.note, accessedAt: s.accessed_at })) };
}

const SORTS = { updated: 'a.updated_at', created: 'a.created_at', quality: 'a.quality_score', words: 'a.word_count', title: 'lower(a.h1)', status: 'a.status' };
const like = (s) => `%${String(s).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function where(q, params) {
  const w = [];
  const add = (sql, v) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
  if (q.projectId) add('a.project_id = ?', V.uuid(q.projectId, 'Proje'));
  if (q.categoryId) add('a.category_id = ?', V.uuid(q.categoryId, 'Kategori'));
  if (q.status) { const l = String(q.status).split(',').filter(Boolean); for (const s of l) if (!STATUSES.includes(s)) throw bad(`Bilinmeyen durum: ${s}`); add('a.status = ANY(?)', l); }
  if (q.type) add('a.article_type = ?', V.oneOf(q.type, 'Makale türü', TYPES));
  if (q.adsenseRisk) add('a.adsense_risk = ?', V.oneOf(q.adsenseRisk, 'AdSense riski', RISKS));
  if (q.createdBy) add('a.created_by = ?', V.oneOf(q.createdBy, 'Oluşturan', ['manual', 'ai']));
  if (q.q) { params.push(like(String(q.q).slice(0, 100))); const n = `$${params.length}`; w.push(`(a.h1 ILIKE ${n} OR a.seo_title ILIKE ${n} OR a.focus_keyword ILIKE ${n} OR a.slug ILIKE ${n})`); }
  if (q.from) { if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from)) throw bad('Başlangıç tarihi YYYY-AA-GG olmalı'); add('a.created_at >= ?::date', q.from); }
  if (q.to) { if (!/^\d{4}-\d{2}-\d{2}$/.test(q.to)) throw bad('Bitiş tarihi YYYY-AA-GG olmalı'); add("a.created_at < (?::date + 1)", q.to); }
  return w.length ? `WHERE ${w.join(' AND ')}` : '';
}

/** which of these articles are LIVE on WordPress now (a publication that is "published"): Map(articleId -> { url, publishedAt, version, siteName }) */
async function liveMap(ids) {
  if (!ids.length) return new Map();
  const rows = (await db.query(`SELECT DISTINCT ON (p.article_id) p.article_id, p.wp_url, p.published_at, p.article_version, s.name AS site_name FROM publications p LEFT JOIN wp_sites s ON s.id = p.site_id
    WHERE p.article_id = ANY($1::uuid[]) AND p.status = 'published' ORDER BY p.article_id, p.published_at DESC NULLS LAST`, [ids])).rows;
  return new Map(rows.map((r) => [r.article_id, { url: r.wp_url, publishedAt: r.published_at, version: r.article_version, siteName: r.site_name }]));
}

async function list(q = {}) {
  const params = []; const w = where(q, params);
  const sort = SORTS[q.sort] || SORTS.updated; const dir = String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || 25)); const page = Math.max(1, parseInt(q.page, 10) || 1);
  const total = (await db.query(`SELECT count(*)::int n FROM articles a ${w}`, params)).rows[0].n;
  const rows = (await db.query(`SELECT a.*, c.name_en AS category_name FROM articles a LEFT JOIN categories c ON c.id = a.category_id ${w}
    ORDER BY ${sort} ${dir} NULLS LAST, a.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, (page - 1) * pageSize])).rows;
  const live = await liveMap(rows.map((r) => r.id));
  return { total, page, pageSize, items: rows.map((r) => ({ ...row(r, { withContent: false }), live: live.get(r.id) || null })) };
}

// ── update, versions ────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param body    the fields to change (only those sent); `expectedVersion` (the version the editor was looking at), `reason`, `meaningful: true` (moves "Last Updated")
 * @param by      'manual' (a person: marks the article manual_edited) | 'ai'
 * @returns the article, or the article unchanged when nothing differs (no new version)
 */
async function update(id, body, { userId = null, by = 'manual', preserveChecks = false } = {}) {
  const f = fields(body);
  if (body.expectedVersion !== undefined && !Number.isInteger(body.expectedVersion)) throw bad('Sürüm numarası tam sayı olmalı');
  const reason = V.str(body.reason, 'Değişiklik notu', { max: 300 }) || 'Düzenleme';
  return db.tx(async (c) => {
    const cur = (await c.query('SELECT * FROM articles WHERE id = $1 FOR UPDATE', [V.uuid(id, 'Makale')])).rows[0];
    if (!cur) throw new HttpError(404, 'Makale bulunamadı');
    if (body.expectedVersion !== undefined && body.expectedVersion !== cur.current_version) throw new HttpError(409, `Makale siz düzenlerken değişti (şu an sürüm ${cur.current_version}). Sayfayı yenileyip tekrar deneyin`, { currentVersion: cur.current_version });
    if (cur.status === 'generating' || cur.status === 'updating') throw new HttpError(409, 'Makale şu anda üretiliyor/güncelleniyor; bitince düzenleyin');
    if (f.categoryId !== undefined) await checkCategory(c, cur.project_id, f.categoryId);
    if (f.slug !== undefined && f.slug !== cur.slug && (await c.query('SELECT 1 FROM articles WHERE project_id = $1 AND slug = $2 AND id <> $3', [cur.project_id, f.slug, cur.id])).rows[0]) throw new HttpError(409, 'Bu bağlantı (slug) bu projede zaten kullanılıyor');
    const before = snapshotOf(cur);
    const changed = Object.keys(f).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(before[k]));
    const wantsMeaningful = body.meaningful === true;
    if (!changed.length && !wantsMeaningful) return row(await loadRow(cur.id, c));
    const sets = []; const vals = [];
    for (const k of changed) { vals.push(JSONB.has(k) ? JSON.stringify(f[k]) : f[k]); sets.push(`${COLS[k]} = $${vals.length}`); }
    if (changed.includes('contentHtml')) { vals.push(H.wordCount(f.contentHtml)); sets.push(`word_count = $${vals.length}`); }
    if (changed.length) {
      sets.push('current_version = current_version + 1');
      if (by === 'manual') sets.push('manual_edited = true');
      if ((changed.includes('contentHtml') || changed.includes('h1')) && !(preserveChecks && by === 'ai')) {         // (only the engine's own link insertion may keep the checks: the words of the article did not change)
        sets.push('fact_checked_at = NULL');                                                                          // changed facts must be checked again
        if (cur.created_by === 'ai') { sets.push('quality_score = NULL'); if (!changed.includes('adsenseRisk')) sets.push('adsense_risk = NULL'); sets.push('adsense_accepted_risk = NULL', 'adsense_accepted_at = NULL', 'adsense_accepted_note = NULL'); }   // so are the AdSense class and the quality score of a written article (unless the person sets the class in the same save)
      }
    }
    if (wantsMeaningful) sets.push('last_updated_at = now()');
    vals.push(cur.id);
    const r = (await c.query(`UPDATE articles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals)).rows[0];
    if (changed.length) await c.query('INSERT INTO article_versions (article_id, version, snapshot, reason, created_by, created_user) VALUES ($1,$2,$3,$4,$5,$6)', [r.id, r.current_version, JSON.stringify(snapshotOf(r)), reason, by, userId]);
    return row(await loadRow(r.id, c));
  });
}

async function listVersions(id) {
  await loadRow(id);
  const rows = (await db.query('SELECT version, snapshot, reason, created_by, created_at FROM article_versions WHERE article_id = $1 ORDER BY version DESC', [id])).rows;
  return rows.map((v) => ({ version: v.version, reason: v.reason, createdBy: v.created_by, createdAt: v.created_at, h1: v.snapshot.h1, wordCount: H.wordCount(v.snapshot.contentHtml) }));
}

async function getVersion(id, version) {
  const v = (await db.query('SELECT version, snapshot, reason, created_by, created_at FROM article_versions WHERE article_id = $1 AND version = $2', [V.uuid(id, 'Makale'), V.int(version, 'Sürüm', { min: 1 })])).rows[0];
  if (!v) throw new HttpError(404, 'Sürüm bulunamadı');
  return { version: v.version, reason: v.reason, createdBy: v.created_by, createdAt: v.created_at, snapshot: v.snapshot };
}

/** Puts an older version back as a NEW version (history is never rewritten). Keeps the current slug when the old one is taken now. */
/** What changed between two versions of an article, field by field (word-level difference of the texts). */
async function compareVersions(id, from, to) {
  const a = await getVersion(id, V.int(from, 'Sürüm', { min: 1, max: 100000 })); const b = await getVersion(id, V.int(to, 'Sürüm', { min: 1, max: 100000 }));
  const sa = a.snapshot; const sb = b.snapshot; const text = (h) => H.htmlToText(h || '');
  const LABEL = { h1: 'Ana başlık (H1)', seoTitle: 'SEO başlığı', metaDescription: 'Meta açıklama', excerpt: 'Özet', focusKeyword: 'Odak anahtar kelime', slug: 'Bağlantı (slug)', articleType: 'Makale türü', targetCountry: 'Ülke', language: 'Dil', featuredImageUrl: 'Öne çıkan görsel', adsenseRisk: 'AdSense sonucu' };
  const fields = [];
  for (const [k, label] of Object.entries(LABEL)) if ((sa[k] ?? '') !== (sb[k] ?? '')) fields.push({ field: label, ...diffWords(String(sa[k] ?? ''), String(sb[k] ?? '')) });
  if (sa.contentHtml !== sb.contentHtml) fields.push({ field: 'İçerik', ...diffWords(text(sa.contentHtml), text(sb.contentHtml)) });
  const faq = (f) => (f || []).map((x) => `${x.q} ${text(x.a)}`).join(' | '); if (faq(sa.faq) !== faq(sb.faq)) fields.push({ field: 'SSS', ...diffWords(faq(sa.faq), faq(sb.faq)) });
  for (const [k, label] of [['tags', 'Etiketler'], ['secondaryKeywords', 'İkincil anahtar kelimeler']]) if (JSON.stringify(sa[k] || []) !== JSON.stringify(sb[k] || [])) fields.push({ field: label, ...diffWords((sa[k] || []).join(', '), (sb[k] || []).join(', ')) });
  return { from: { version: a.version, reason: a.reason, createdBy: a.createdBy, createdAt: a.createdAt }, to: { version: b.version, reason: b.reason, createdBy: b.createdBy, createdAt: b.createdAt }, fields };
}

async function restoreVersion(id, version, { userId = null } = {}) {
  const v = await getVersion(id, version);
  const cur = await loadRow(id);
  const snap = { ...v.snapshot };
  delete snap.slug;                                                       // a link that may already be public does not silently change by a restore
  if (snap.categoryId) {                                                  // the old category may be archived or gone by now: then the article keeps its current one
    const cat = (await db.query('SELECT project_id, status FROM categories WHERE id = $1', [snap.categoryId])).rows[0];
    if (!cat || cat.project_id !== cur.project_id || cat.status === 'archived') delete snap.categoryId;
  }
  const body = { ...snap, reason: `${v.version}. sürüme geri dönüldü` };
  const restored = await update(id, body, { userId });
  return { ...restored, restoredFrom: v.version, previousVersion: cur.current_version };
}

// ── facts, sources ──────────────────────────────────────────────────────────────────────────────────────────
async function setSources(id, list) {
  await loadRow(id);
  if (!Array.isArray(list) || list.length > 30) throw bad('Kaynaklar en fazla 30 öğe içeren bir liste olmalı');
  const clean = list.map((s) => {
    if (!s || typeof s !== 'object') throw bad('Kaynak { url, title, publisher, note } olmalı');
    const url = V.str(s.url, 'Kaynak adresi', { required: true, max: 600 });
    let u; try { u = new URL(url); } catch { throw bad(`Kaynak adresi geçerli değil: ${url.slice(0, 80)}`); }
    if (!/^https?:$/.test(u.protocol)) throw bad('Kaynak adresi http ya da https olmalı');
    return { url: u.toString(), title: V.str(s.title, 'Kaynak başlığı', { max: 300 }), publisher: V.str(s.publisher, 'Yayıncı', { max: 150 }), note: V.str(s.note, 'Not', { max: 500 }) };
  });
  await db.tx(async (c) => {
    await c.query('DELETE FROM article_sources WHERE article_id = $1', [id]);
    for (const s of clean) await c.query('INSERT INTO article_sources (article_id, url, title, publisher, note) VALUES ($1,$2,$3,$4,$5)', [id, s.url, s.title, s.publisher, s.note]);
  });
  return clean.length;
}

/** A person confirms that the facts were checked (phase 3's fact-check bot will set the same stamp). */
async function markFactChecked(id, checked = true) {
  const r = (await db.query('UPDATE articles SET fact_checked_at = $2, updated_at = now() WHERE id = $1 RETURNING id', [V.uuid(id, 'Makale'), checked ? new Date() : null])).rows[0];
  if (!r) throw new HttpError(404, 'Makale bulunamadı');
  return get(id);
}

// ── readiness and status ────────────────────────────────────────────────────────────────────────────────────
/** Everything that stands between this article and "ready": { ready, problems: [{ code, message, blocking }] }. Nothing is invented: a check that was not done is a problem. */
async function readiness(id) {
  const a = await loadRow(id);
  const q = (await settings.get('quality', a.project_id)).value;
  const problems = [];
  const add = (code, message, blocking = true) => problems.push({ code, message, blocking });
  if (!a.h1.trim()) add('no_h1', 'Ana başlık (H1) yok');
  if (!a.seo_title.trim()) add('no_seo_title', 'SEO başlığı yok');
  else if (a.seo_title.length > 65) add('seo_title_long', `SEO başlığı ${a.seo_title.length} karakter: arama sonuçlarında kesilebilir (en fazla ~60)`, false);
  if (!a.meta_description.trim()) add('no_meta', 'Meta açıklama yok', false);
  else if (a.meta_description.length < 70 || a.meta_description.length > 160) add('meta_length', `Meta açıklama ${a.meta_description.length} karakter (ideal 70–160)`, false);
  if (!a.focus_keyword.trim()) add('no_focus', 'Odak anahtar kelime yok', false);
  if (!a.category_id) add('no_category', 'Kategori seçilmedi');
  const line = (await settings.get('pipeline', a.project_id)).value;                            // while the production line is on its minimum length applies (owner: at least 950 words)
  const minWords = line.enabled ? Math.max(MIN_WORDS, Number(line.minWords) || 0) : MIN_WORDS;
  if (a.word_count < minWords) add('too_short', `İçerik ${a.word_count} kelime; en az ${minWords} gerekli (ince içerik AdSense riskidir)`);
  if (!a.fact_checked_at) {
    const fc = await checks.latestOf(a.id, 'fact', a.current_version);
    if (fc && fc.status === 'error') add('fact_check_error', `Doğruluk kontrolü çalıştırılamadı: ${String(fc.result.error || '').slice(0, 160)}`);
    else if (fc) add('fact_check_failed', `Doğruluk kontrolü sorun buldu: ${fc.result.counts.majorProblems} önemli iddia kaynaklarla doğrulanamadı ya da çelişiyor (editördeki “Kontroller”e bakın; yayımlanamaz)`);
    else add('not_fact_checked', 'Doğruluk kontrolü yapılmadı (zorunlu)');
  }
  // the production line's owner took the AdSense check out of the way to publishing (the check still runs and its class is shown; only "blocking" is dropped), unless he switched it back on
  const adsenseGate = !line.enabled || line.adsenseCheck === true;
  if (!adsenseGate) { if (a.adsense_risk && a.adsense_risk !== 'low') add('adsense_info', `AdSense sınıfı “${a.adsense_risk === 'blocked' ? 'yayınlanamaz' : 'inceleme gerekli'}” (Otomatik Üretim’de AdSense kontrolü yayını engellemez; bilgi olarak gösterilir)`, false); }
  else if (!a.adsense_risk) add('no_adsense', 'AdSense risk kontrolü yapılmadı (zorunlu)');
  else if (a.adsense_risk === 'review' && a.adsense_accepted_risk === 'review') add('adsense_accepted', `AdSense incelemesi “inceleme gerekli” dedi; siz kabul ettiniz${a.adsense_accepted_at ? ` (${new Date(a.adsense_accepted_at).toISOString().slice(0, 10)})` : ''}: bu bir kişi kararıdır, AdSense onayı garanti etmez`, false);
  else if (a.adsense_risk !== 'low') add('adsense_risk', a.adsense_risk === 'blocked' ? 'AdSense açısından yayınlanamaz olarak işaretli' : 'AdSense riski “inceleme gerekli” olarak işaretli; çözüp “düşük” yapın ya da editörde “AdSense uyarısını kabul et”');
  const nSources = (await db.query('SELECT count(*)::int n FROM article_sources WHERE article_id = $1', [a.id])).rows[0].n;
  if (nSources === 0) add('no_sources', NEWS_TYPES.has(a.article_type) ? 'Haber/güncelleme türü makalede kaynak gerekli' : 'Kaynak eklenmedi', NEWS_TYPES.has(a.article_type));
  if (a.created_by === 'ai' && a.quality_score === null) add('no_quality', 'Kalite puanı verilmedi (kontrollerin hepsi çalışmadı); editörde “Kontrolleri çalıştır”');
  if (a.quality_score !== null && a.quality_score < q.minScore) add('low_quality', `Kalite puanı ${a.quality_score} (en az ${q.minScore} gerekli)`);
  const dup = (await db.query(`SELECT id, h1 FROM articles WHERE project_id = $1 AND id <> $2 AND status NOT IN ('archived', 'failed')
    AND ((focus_keyword <> '' AND focus_keyword = $3) OR lower(h1) = lower($4)) LIMIT 3`, [a.project_id, a.id, a.focus_keyword, a.h1])).rows;
  if (dup.length) add('duplicate', `Aynı odak anahtar kelime/başlıkla başka makale var: “${dup[0].h1.slice(0, 80)}” (kanibalizasyon riski)`);
  if ((await settings.get('images', a.project_id)).value.auto && !a.featured_image_url && !(await db.query('SELECT 1 FROM article_images WHERE article_id = $1', [a.id])).rows.length) add('no_image', 'Kapak görseli yok (editörde “Kapak görseli” kartından üretilebilir)', false);
  const topic = await projects.checkTopic(a.project_id, `${a.h1} ${a.focus_keyword}`, a.category_id);
  if (!topic.allowed) add('excluded_topic', `Kapsam dışı konu: ${topic.matched.map((m) => m.topic).join(', ')}`);
  return { ready: !problems.some((p) => p.blocking), problems };
}

async function setStatus(id, status, { userId = null } = {}) {
  let target = V.oneOf(status, 'Durum', STATUSES);
  const cur = await loadRow(id);
  if (cur.status === target) return get(id);
  const live = (await liveMap([cur.id])).has(cur.id);
  if (live && cur.status === 'archived' && target === 'needs_review') target = 'published';                // an archived article that is live comes back as what it is
  if (live && ['needs_review', 'ready'].includes(target)) throw new HttpError(409, 'Bu makale WordPress’te yayında; “Onay bekliyor” ya da “Yayına hazır” yapılamaz. Güncelleme gerekmiyorsa “Yayımlandı olarak kalsın” deyin; sitede değiştirmek istiyorsanız yeni sürüm yazıp güncelleyin');
  if (target === 'published') {                                                                           // only a live article that was flagged "needs update" may be put back; everything else about publishing is WordPress's job
    if (!((cur.status === 'needs_update' || cur.status === 'archived') && live)) throw new HttpError(409, `“${STATUS_LABELS[cur.status]}” durumundaki makale elle “${STATUS_LABELS[target]}” yapılamaz (yayın WordPress modülüyle yapılır)`);
  } else if (!(TRANSITIONS[cur.status] || []).includes(target)) throw new HttpError(409, `“${STATUS_LABELS[cur.status]}” durumundaki makale elle “${STATUS_LABELS[target]}” yapılamaz${['scheduled', 'published'].includes(target) ? ' (yayın WordPress modülüyle yapılır)' : ''}`);
  if (target === 'ready') {
    const r = await readiness(id);
    if (!r.ready) throw new HttpError(409, `Makale yayına hazır değil: ${r.problems.filter((p) => p.blocking).map((p) => p.message).join('; ')}`, { problems: r.problems });
  }
  await db.query('UPDATE articles SET status = $1, archived_at = $2, updated_at = now() WHERE id = $3', [target, target === 'archived' ? new Date() : null, id]);
  return get(id);
}

/**
 * A PERSON accepts the AdSense reviewer's class "inceleme gerekli" for this article (or takes the acceptance back). Nothing about the check is rewritten: the class stays what the reviewer said,
 * the article only records who accepted it and when, and readiness stops treating it as a blocker. "Yayınlanamaz" cannot be accepted; the acceptance ends when the text changes (the checks reset).
 * With `approve` the article is also put on "Yayına hazır" (the person's approval): when another blocker remains the acceptance stays and the reason comes back instead of an error.
 * @returns { article, approved, reason }
 */
async function acceptAdsense(id, { accept = true, approve = false, note = 'Editörde kabul edildi' } = {}) {
  const a = await loadRow(id);
  if (!accept) { await db.query('UPDATE articles SET adsense_accepted_risk = NULL, adsense_accepted_at = NULL, adsense_accepted_note = NULL, updated_at = now() WHERE id = $1', [a.id]); return { article: await get(a.id), approved: false, reason: null }; }
  if (a.adsense_risk !== 'review') throw new HttpError(409, a.adsense_risk === 'blocked' ? 'AdSense sınıfı “yayınlanamaz”: bu kabul edilemez' : a.adsense_risk === 'low' ? 'AdSense sınıfı zaten “düşük”: kabul edilecek bir uyarı yok' : 'Makalenin AdSense sınıfı henüz belirlenmedi: önce kontrolleri çalıştırın');
  await db.query('UPDATE articles SET adsense_accepted_risk = $2, adsense_accepted_at = now(), adsense_accepted_note = $3, updated_at = now() WHERE id = $1', [a.id, 'review', V.str(note, 'Not', { max: 200 }) || 'Editörde kabul edildi']);
  let approved = false; let reason = null;
  if (approve && a.status === 'needs_review') { try { await setStatus(a.id, 'ready'); approved = true; } catch (err) { if (!(err instanceof HttpError)) throw err; reason = err.message; } }
  return { article: await get(a.id), approved, reason };
}

async function remove(id) {
  const sent = (await db.query('SELECT count(*)::int n FROM publications WHERE article_id = $1 AND wp_post_id IS NOT NULL', [V.uuid(id, 'Makale')])).rows[0].n;
  if (sent) throw new HttpError(409, 'Bu makale WordPress’e gönderilmiş; yazı numarası kaybolmasın diye silinemez. Arşivleyin');
  const cur = await loadRow(id);
  if (!DELETABLE.has(cur.status)) throw new HttpError(409, `“${STATUS_LABELS[cur.status]}” durumundaki makale silinemez; önce arşivleyin ya da yayından kaldırın`);
  await db.query('DELETE FROM articles WHERE id = $1', [id]);
}

/** One action on many articles; each is tried on its own: { done: [id], failed: [{ id, message }] }. */
async function bulk({ ids, action, categoryId, status }, ctx = {}) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw bad('1 ile 200 arasında makale seçin');
  const uniq = [...new Set(ids.map((x) => V.uuid(x, 'Makale')))];
  const ACTIONS = ['archive', 'restore', 'set_category', 'set_status', 'delete', 'accept_adsense'];
  V.oneOf(action, 'İşlem', ACTIONS);
  const done = []; const failed = [];
  for (const id of uniq) {
    try {
      if (action === 'archive') await setStatus(id, 'archived', ctx);
      else if (action === 'restore') await setStatus(id, 'needs_review', ctx);
      else if (action === 'set_status') await setStatus(id, status, ctx);
      else if (action === 'set_category') await update(id, { categoryId: V.uuid(categoryId, 'Kategori'), reason: 'Toplu kategori değişikliği' }, ctx);
      else if (action === 'delete') await remove(id);
      else if (action === 'accept_adsense') { const r = await acceptAdsense(id, { accept: true, approve: true }); if (r.reason) throw new HttpError(409, `AdSense uyarısı kabul edildi ama onaylanamadı: ${r.reason}`); }
      done.push(id);
    } catch (err) { failed.push({ id, message: err instanceof HttpError ? err.message : 'Beklenmeyen hata' }); }
  }
  return { done, failed };
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────
const FORMATS = { csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', markdown: 'text/markdown; charset=utf-8' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** @param q the same filters as list() (or `ids`); max 500 articles */
async function exportArticles(q = {}, format = 'csv') {
  if (!FORMATS[format]) throw bad(`Biçim şunlardan biri olmalı: ${Object.keys(FORMATS).join(', ')}`);
  const params = []; let w = where(q, params);
  if (Array.isArray(q.ids) && q.ids.length) {
    if (q.ids.length > 500) throw bad('En fazla 500 makale dışa aktarılabilir');
    params.push(q.ids.map((x) => V.uuid(x, 'Makale'))); w = `${w ? `${w} AND` : 'WHERE'} a.id = ANY($${params.length})`;
  }
  const rows = (await db.query(`SELECT a.*, c.name_en AS category_name FROM articles a LEFT JOIN categories c ON c.id = a.category_id ${w} ORDER BY a.created_at, a.id LIMIT 501`, params)).rows;
  if (rows.length > 500) throw bad('Dışa aktarılacak makale sayısı 500’ü aşıyor; filtreyi daraltın');
  const src = new Map();
  if (rows.length) for (const s of (await db.query('SELECT article_id, url, title, publisher FROM article_sources WHERE article_id = ANY($1) ORDER BY accessed_at, id', [rows.map((r) => r.id)])).rows) { if (!src.has(s.article_id)) src.set(s.article_id, []); src.get(s.article_id).push(s); }
  const stamp = new Date().toISOString().slice(0, 10);
  const items = rows.map((r) => ({ ...row(r), sources: (src.get(r.id) || []).map((s) => ({ url: s.url, title: s.title, publisher: s.publisher })) }));
  let body;
  if (format === 'csv') {
    body = toCsv(items, [
      { label: 'Başlık (H1)', key: 'h1' }, { label: 'SEO başlığı', key: 'seoTitle' }, { label: 'Bağlantı (slug)', key: 'slug' }, { label: 'Durum', key: 'statusLabel' }, { label: 'Kategori', key: 'categoryName' }, { label: 'Tür', key: 'articleType' },
      { label: 'Odak anahtar kelime', key: 'focusKeyword' }, { label: 'Meta açıklama', key: 'metaDescription' }, { label: 'Kelime sayısı', key: 'wordCount' }, { label: 'Kalite puanı', key: 'qualityScore' }, { label: 'AdSense riski', key: 'adsenseRisk' },
      { label: 'Kaynaklar', get: (r) => r.sources.map((s) => s.url) }, { label: 'Oluşturulma', get: (r) => r.createdAt && new Date(r.createdAt).toISOString() }, { label: 'Son güncelleme (Last Updated)', get: (r) => r.lastUpdatedAt && new Date(r.lastUpdatedAt).toISOString() },
    ]);
  } else if (format === 'json') body = JSON.stringify({ exportedAt: new Date().toISOString(), count: items.length, articles: items }, null, 2);
  else if (format === 'html') {
    body = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Articles export ${stamp}</title></head>\n<body>\n${items.map((a) => `<article data-slug="${esc(a.slug)}">\n<h1>${esc(a.h1)}</h1>\n${a.contentHtml}\n</article>`).join('\n<hr>\n')}\n</body></html>\n`;
  } else {
    body = items.map((a) => `---\ntitle: ${JSON.stringify(a.seoTitle || a.h1)}\nslug: ${JSON.stringify(a.slug)}\ndescription: ${JSON.stringify(a.metaDescription)}\nkeyword: ${JSON.stringify(a.focusKeyword)}\ncategory: ${JSON.stringify(a.categoryName || '')}\nstatus: ${JSON.stringify(a.status)}\ntags: ${JSON.stringify(a.tags)}\n---\n\n# ${a.h1}\n\n${H.htmlToMarkdown(a.contentHtml)}\n`).join('\n');
  }
  return { filename: `articles-${stamp}.${format === 'markdown' ? 'md' : format}`, contentType: FORMATS[format], body, count: items.length };
}

// ── numbers for the dashboard ───────────────────────────────────────────────────────────────────────────────
async function counts(projectId = null, { tz = 'Europe/Istanbul', days = 30 } = {}) {
  const p = projectId ? [V.uuid(projectId, 'Proje')] : [];
  const w = projectId ? 'WHERE project_id = $1' : '';
  const by = (await db.query(`SELECT status, count(*)::int n FROM articles ${w} GROUP BY status`, p)).rows;
  const cat = (await db.query(`SELECT c.id, c.name_en, c.target_share_pct, count(a.id)::int n FROM categories c LEFT JOIN articles a ON a.category_id = c.id AND a.status <> 'archived'
    ${projectId ? 'WHERE c.project_id = $1 AND' : 'WHERE'} c.status <> 'archived' GROUP BY c.id ORDER BY c.priority, c.name_en`, p)).rows;
  const risk = (await db.query(`SELECT count(*) FILTER (WHERE adsense_risk IN ('review', 'blocked'))::int AS risky, count(*) FILTER (WHERE adsense_risk IS NULL AND status IN ('needs_review', 'ready'))::int AS unchecked FROM articles ${w}`, p)).rows[0];
  const daily = (await db.query(`SELECT (created_at AT TIME ZONE $${p.length + 1})::date AS day, count(*)::int n FROM articles ${w ? `${w} AND` : 'WHERE'} created_at >= now() - ($${p.length + 2} || ' days')::interval GROUP BY 1 ORDER BY 1`, [...p, tz, String(days)])).rows;
  const status = Object.fromEntries(STATUSES.map((s) => [s, 0])); for (const r of by) status[r.status] = r.n;
  return { total: by.reduce((a, r) => a + r.n, 0), status, categories: cat.map((c) => ({ id: c.id, name: c.name_en, targetSharePct: c.target_share_pct, articles: c.n })),
    adsenseRisky: risk.risky, adsenseUnchecked: risk.unchecked, daily: daily.map((d) => ({ day: d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day), count: d.n })) };
}

module.exports = { STATUSES, STATUS_LABELS, TYPES, TRANSITIONS, MIN_WORDS, create, createFromAi, get, list, update, listVersions, getVersion, restoreVersion, compareVersions, setSources, markFactChecked, readiness, setStatus, acceptAdsense, liveMap, remove, bulk, exportArticles, counts };
