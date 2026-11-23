const db = require('../db');
const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const imageModels = require('../lib/imageModels');
const settings = require('./settings');
const providers = require('./providers');
const stock = require('./stockPhotos');
const { LlmError, explain } = require('./llm');

/**
 * Cover images. One picture per article, drawn by an OpenAI image model from a short scene description the article writer gives with the article (so the picture fits
 * the text), stored in the database and handed to WordPress as the post's featured image with a descriptive alt text when the article is sent.
 *
 *  - OFF unless settings `images.auto` is on (it costs money); a person can always draw one for a single article.
 *  - no model name is hard-coded: the owner picks one from the list the key really offers (the names change often); none chosen = the newest plain name.
 *  - the budget guard runs BEFORE the call; EVERY call is a usage row; the cost is the price the owner typed per picture, otherwise NULL = "Bilinmiyor" (never 0).
 *  - never retried on its own (a retry could be billed twice); a refusal by OpenAI's safety filter or a missing organization verification is explained in words.
 *  - the picture never contains text, logos or real people (the prompt says so; the model may still draw something odd: a person looks at it before it is public in the semi-automatic mode).
 * Written from OpenAI's public API reference; never run against a real key: the tests use a fake fetch with the documented answer shape.
 */
const SIZE = '1536x1024';                           // landscape 3:2, accepted by the GPT image models (the newest also take any size divisible by 16)
const [WIDTH, HEIGHT] = SIZE.split('x').map(Number);
const MAX_BYTES = 6 * 1024 * 1024;
const STORAGE_CAP = 300 * 1024 * 1024;              // the free database is 500 MB: pictures may use at most 300 MB of it

const money = (v) => { const n = Number(v); return v !== undefined && v !== '' && v !== null && Number.isFinite(n) && n >= 0 ? n : null; };

/** image bytes by their first bytes (what the file claims is never trusted) */
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** OpenAI's error answer in one Turkish sentence; `fatal` = no other picture can work either (key, balance, verification, model) */
function explainImage(status, bodyText) {
  let j = {}; try { j = JSON.parse(bodyText); } catch { /* not json */ }
  const e = (j && j.error) || {}; const msg = String(e.message || bodyText || '').slice(0, 300); const code = String(e.code || e.type || '');
  if (/moderation_blocked|content_policy|safety system|safety_violations|rejected by the safety/i.test(`${code} ${msg}`)) return new LlmError('refused', 'OpenAI görsel isteğini güvenlik filtresiyle reddetti; farklı bir görsel tarifi deneyin (makale konusu hassas olabilir)', { status });
  if (/must be verified|organization.*verif|verify.*organization/i.test(msg)) return new LlmError('verification', 'OpenAI bu görsel modeli için kuruluş doğrulaması istiyor: platform.openai.com → Settings → Organization → Verification bölümünden doğrulayın (birkaç dakika sürebilir) ya da başka bir görsel modeli seçin', { fatal: true, status });
  if (status === 404 || /model_not_found|does not exist|has been (deprecated|shut ?down)|no longer available/i.test(`${code} ${msg}`)) return new LlmError('model', 'OpenAI bu görsel modelini bulamadı ya da kapatılmış (görsel modelleri sık değişir): API Kullanımı → OpenAI kartında “Bağlantıyı test et” deyip listeden güncel bir görsel modeli seçin', { fatal: true, status });
  return explain('OpenAI', status, msg || bodyText);
}

/** the model to use: the owner's choice, otherwise the newest plain gpt-image name the key offers (one free call to the model list) */
async function resolveModel(extra, secret, fetchImpl) {
  if (extra && extra.imageModel) return String(extra.imageModel).trim();
  let res; try { res = await fetchImpl('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(12000) }); } catch { throw new LlmError('network', 'OpenAI’ya ulaşılamadı; biraz sonra tekrar deneyin', { retryable: true }); }
  if (!res.ok) throw explainImage(res.status, await res.text().catch(() => ''));
  const j = await res.json().catch(() => ({})); const model = imageModels.pickImageModel((Array.isArray(j.data) ? j.data : []).map((m) => m && m.id));
  if (!model) throw new HttpError(409, 'OpenAI hesabınızda görsel modeli görünmüyor (OpenAI görsel modelleri için kuruluş doğrulaması isteyebilir). API Kullanımı → OpenAI kartında “Bağlantıyı test et” deyip durumu görün; model adını “Görsel modeli” alanına da elle yazabilirsiniz');
  return model;
}

/** what is sent to the model: the writer's scene + the owner's style + fixed safety rules (no text, no logos, no real people) */
function buildPrompt({ visual, title, style }) {
  const scene = String(visual || '').replace(/\s+/g, ' ').trim() || `A concrete visual metaphor for: ${title}`;
  return `${scene.slice(0, 700)}\nStyle: ${String(style || '').trim() || 'Clean modern editorial illustration'}.\nLandscape cover image for a news and technology article titled "${String(title).slice(0, 160)}". Absolutely no text, letters, numbers, captions or watermarks anywhere in the image. No logos or brand marks, no screenshots, no real people or recognisable faces. Suitable for all audiences.`;
}

/**
 * Draws one picture. @param o { prompt, quality, projectId, operation, fetchImpl, now, timeoutMs }
 * @returns { buffer, mime, width, height, model, costUsd (null = unknown), inputTokens, outputTokens }
 */
async function generate({ prompt, quality = 'medium', projectId = null, operation = 'image_generate', fetchImpl = globalThis.fetch, now = new Date(), timeoutMs = 120000 } = {}) {
  const p = await providers.get('openai'); const secret = await providers.secretFor('openai');
  if (!secret) throw new HttpError(409, 'OpenAI henüz ayarlanmadı: API Kullanımı sayfasından API anahtarını kaydedip bağlantıyı test edin');
  const q = V.oneOf(quality, 'Görsel kalitesi', ['low', 'medium', 'high']);
  const model = await resolveModel(p.extra, secret, fetchImpl);
  const priceUsd = money(p.extra && p.extra.imagePriceUsd);
  const guard = await providers.guard('openai', priceUsd || 0, { projectId, now, operation });
  if (!guard.ok) throw new LlmError('budget', guard.message, { budget: true });
  let res; let text;
  try {
    res = await fetchImpl('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: String(prompt).slice(0, 4000), size: SIZE, quality: q, output_format: 'jpeg', output_compression: 85, n: 1 }), signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (err) {
    await providers.recordUsage({ provider: 'openai', endpoint: model, operation, requests: 1, units: null, costUsd: null, result: 'error', projectId, meta: { code: 'network' } });
    throw new LlmError(err && err.name === 'TimeoutError' ? 'timeout' : 'network', err && err.name === 'TimeoutError' ? `OpenAI görseli ${Math.round(timeoutMs / 1000)} saniyede üretemedi` : 'OpenAI’ya ulaşılamadı; biraz sonra tekrar deneyin', { maybeBilled: true, retryable: true });
  }
  if (!res.ok) {
    const err = explainImage(res.status, text); err.message = err.message.split(secret).join('[gizli]');
    await providers.recordUsage({ provider: 'openai', endpoint: model, operation, requests: 1, units: null, costUsd: null, result: 'error', projectId, meta: { code: err.code, status: res.status } });
    throw err;
  }
  let j; try { j = JSON.parse(text); } catch { throw new LlmError('bad_output', 'OpenAI görsel cevabı okunamadı', { maybeBilled: true }); }
  const usage = j.usage || {}; const inT = Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null; const outT = Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null;
  await providers.recordUsage({ provider: 'openai', endpoint: model, operation, requests: 1, units: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null, costUsd: priceUsd, projectId, meta: { quality: q, size: SIZE, inputTokens: inT, outputTokens: outT } });
  const b64 = j.data && j.data[0] && j.data[0].b64_json;
  if (!b64) throw new LlmError('empty', 'OpenAI görsel göndermedi (boş cevap)', { maybeBilled: true, costUsd: priceUsd });
  const buffer = Buffer.from(String(b64), 'base64'); const mime = sniff(buffer);
  if (!mime) throw new LlmError('bad_output', 'OpenAI’nın gönderdiği veri bir görsel dosyası değil', { maybeBilled: true, costUsd: priceUsd });
  if (buffer.length > MAX_BYTES) throw new LlmError('bad_output', `Görsel çok büyük (${Math.round(buffer.length / 1048576)} MB; en çok 6 MB)`, { maybeBilled: true, costUsd: priceUsd });
  const [w, h] = /^\d+x\d+$/.test(String(j.size || '')) ? String(j.size).split('x').map(Number) : [WIDTH, HEIGHT];
  return { buffer, mime, width: w, height: h, model, costUsd: priceUsd, inputTokens: inT, outputTokens: outT, quality: q };
}

// ── storage ─────────────────────────────────────────────────────────────────────────────────────
const meta = (r) => !r ? null : ({ id: r.id, articleId: r.article_id, mime: r.mime, width: r.width, height: r.height, byteSize: r.byte_size, alt: r.alt, provider: r.provider, model: r.model, prompt: r.prompt, quality: r.quality,
  costUsd: r.cost_micros === null || r.cost_micros === undefined ? null : Number(r.cost_micros) / 1e6, createdAt: r.created_at, sourceId: r.source_id || null, sourceUrl: r.source_url || null, creditName: r.credit_name || null, creditUrl: r.credit_url || null });
const COLS = 'id, article_id, mime, byte_size, width, height, alt, provider, model, prompt, quality, cost_micros, created_at, source_id, source_url, credit_name, credit_url';

/** the picture's data without its bytes, or null */
async function forArticle(articleId) { return meta((await db.query(`SELECT ${COLS} FROM article_images WHERE article_id = $1`, [articleId])).rows[0]); }
/** the picture with its bytes (for the panel and for WordPress), or null */
async function file(articleId) { const r = (await db.query(`SELECT ${COLS}, bytes FROM article_images WHERE article_id = $1`, [articleId])).rows[0]; return r ? { ...meta(r), buffer: r.bytes } : null; }

async function store(articleId, img, { alt, prompt, source = null }) {
  const used = (await db.query('SELECT coalesce(sum(byte_size), 0)::bigint AS n FROM article_images WHERE article_id <> $1', [articleId])).rows[0].n;
  if (Number(used) + img.buffer.length > STORAGE_CAP) throw new HttpError(409, 'Görsel alanı doldu (en çok 300 MB): eski makalelerin görsellerini silin');
  await db.query('DELETE FROM article_images WHERE article_id = $1', [articleId]);                       // a new picture REPLACES the old one (the id changes, so WordPress uploads the new file)
  const r = (await db.query(`INSERT INTO article_images (article_id, mime, bytes, byte_size, width, height, alt, provider, model, prompt, quality, cost_micros, source_id, source_url, credit_name, credit_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${COLS}`, [articleId, img.mime, img.buffer, img.buffer.length, img.width, img.height, String(alt || '').slice(0, 200), img.provider || 'openai', img.model, String(prompt || '').slice(0, 2000), img.quality || '',
    img.costUsd === null || img.costUsd === undefined ? null : Math.round(img.costUsd * 1e6), source && source.id || null, source && source.url || null, source && source.creditName || null, source && source.creditUrl || null])).rows[0];
  return meta(r);
}

/**
 * Draws the cover picture of an article and stores it. @param o { visual (the writer's scene), alt, quality, userId, projectId, fetchImpl, now }
 * Nothing here changes the article's text or status.
 */
async function generateForArticle(articleId, { visual = '', alt = '', quality, fetchImpl, now = new Date(), operation = 'image_generate' } = {}) {
  const a = (await db.query('SELECT id, project_id, h1, focus_keyword FROM articles WHERE id = $1', [V.uuid(articleId, 'Makale')])).rows[0];
  if (!a) throw new HttpError(404, 'Makale bulunamadı');
  const cfg = (await settings.get('images', a.project_id)).value;
  const prompt = buildPrompt({ visual, title: a.h1, style: cfg.style });
  const img = await generate({ prompt, quality: quality || cfg.quality, projectId: a.project_id, operation, fetchImpl, now });
  const saved = await store(a.id, img, { alt: String(alt || '').trim() || a.h1, prompt });
  return { ...saved, inputTokens: img.inputTokens, outputTokens: img.outputTokens };
}

/**
 * Where a picture comes from, by the setting `images.source` and the keys that exist: 'auto' (default) = a free Pixabay photo when its key is saved, otherwise an OpenAI picture;
 * 'stock' = only Pixabay; 'openai' = only OpenAI. null = the chosen service has no key. Nothing falls back to a PAID service on its own when the free one finds nothing.
 */
async function resolveSource(projectId) {
  const [cfg, px, oa] = await Promise.all([settings.get('images', projectId), providers.get('pixabay'), providers.get('openai')]);
  const c = cfg.value; const stockOk = !!px.configured; const aiOk = !!oa.configured;
  const source = c.source === 'stock' ? (stockOk ? 'stock' : null) : c.source === 'openai' ? (aiOk ? 'openai' : null) : (stockOk ? 'stock' : aiOk ? 'openai' : null);
  return { source, cfg: c, stockOk, aiOk };
}

/** the words to search a stock photo with, most specific first: the writer's own suggestion, the focus keyword, the first tags, the niche; at most 3 tries */
function stockQueries(a, hint = {}) {
  const raw = [hint.query, a.focus_keyword, (a.tags || []).slice(0, 2).join(' '), a.main_niche];
  const seen = new Set(); const out = [];
  for (const r of raw) { const q = stock.trimQuery(r); if (q.length >= 3 && !seen.has(q.toLowerCase())) { seen.add(q.toLowerCase()); out.push(q); } }
  return out.slice(0, 3);
}

/**
 * Finds a FREE photo for an article and stores it (a copy in our own database, as Pixabay asks). With `photoId` a person's own choice is used (looked up again by id, so what is saved is
 * what the service says it is); otherwise the searches in turn: the first photo that passes the tag filter and is not already some other article's cover of this project.
 * @param o { photoId, query, type, hint, fetchImpl, download, now }
 */
async function stockForArticle(articleId, { photoId = null, query = '', type, hint = {}, fetchImpl, download, now = new Date() } = {}) {
  const a = (await db.query('SELECT a.id, a.project_id, a.h1, a.focus_keyword, a.tags, n.main_niche FROM articles a LEFT JOIN niche_profiles n ON n.project_id = a.project_id WHERE a.id = $1', [V.uuid(articleId, 'Makale')])).rows[0];
  if (!a) throw new HttpError(404, 'Makale bulunamadı');
  const cfg = (await settings.get('images', a.project_id)).value; const kind = type || cfg.stockType;
  let pick = null; let used = null; const tried = [];
  if (photoId) {
    pick = (await stock.search({ id: photoId, projectId: a.project_id, fetchImpl, now })).candidates[0];
    if (!pick) throw new HttpError(404, 'Bu fotoğraf Pixabay’da bulunamadı (kaldırılmış olabilir); aramayı yenileyin');
    used = String(query || '').trim() || `fotoğraf ${pick.id}`;
  } else {
    const taken = new Set((await db.query("SELECT i.source_id FROM article_images i JOIN articles x ON x.id = i.article_id WHERE x.project_id = $1 AND i.provider = 'pixabay' AND i.article_id <> $2", [a.project_id, a.id])).rows.map((r) => r.source_id));
    for (const q of (String(query || '').trim() ? [stock.trimQuery(query)] : stockQueries(a, hint))) {
      tried.push(q);
      const found = await stock.search({ query: q, type: kind, projectId: a.project_id, fetchImpl, now });
      pick = found.candidates.find((c) => !c.problem && !taken.has(c.id)); if (pick) { used = q; break; }
    }
    if (!pick) throw new HttpError(404, `Uygun ücretsiz fotoğraf bulunamadı (aranan: ${tried.join(' · ') || '—'}). Kişi, logo/marka içeren ya da başka bir makalede kullanılmış fotoğraflar elenir; editördeki “Ücretsiz fotoğraf bul” ile elle arayabilirsiniz`);
  }
  const buffer = await stock.download(pick, { download });
  const mime = sniff(buffer); if (!mime) throw new HttpError(502, 'Pixabay’dan inen dosya bir görsel dosyası değil');
  const saved = await store(a.id, { buffer, mime, width: pick.savedWidth, height: pick.savedHeight, provider: 'pixabay', model: pick.kind || 'photo', quality: '', costUsd: 0 },
    { alt: stock.altFor(pick), prompt: used, source: { id: pick.id, url: pick.pageUrl, creditName: pick.user, creditUrl: pick.userId ? `https://pixabay.com/users/${encodeURIComponent(pick.user)}-${pick.userId}/` : null } });
  await providers.recordUsage({ provider: 'pixabay', endpoint: 'download', operation: 'image_download', requests: 0, costUsd: 0, projectId: a.project_id, meta: { photoId: pick.id, bytes: buffer.length } });
  return saved;
}

/** the candidates of a search, for the panel (nothing is saved) */
async function searchForArticle(articleId, { query, type, fetchImpl, now = new Date() } = {}) {
  const a = (await db.query('SELECT id, project_id FROM articles WHERE id = $1', [V.uuid(articleId, 'Makale')])).rows[0];
  if (!a) throw new HttpError(404, 'Makale bulunamadı');
  const cfg = (await settings.get('images', a.project_id)).value;
  return stock.search({ query, type: type || cfg.stockType, projectId: a.project_id, fetchImpl, now });
}

/**
 * The step the writer takes right after it saved an article: when `images.auto` is on and the chosen service has its key it finds (Pixabay, free) or draws (OpenAI, paid) the cover
 * picture, otherwise nothing happens. It NEVER throws: a failed picture is reported ({ status: 'failed', error, billed, costUsd }) and the article simply stays without one.
 * @returns { status: 'off' | 'ok' | 'failed', source?, error?, billed?, costUsd? }
 */
async function autoForArticle(articleId, projectId, hint = {}, { fetchImpl, download, now = new Date() } = {}) {
  try {
    const { source, cfg } = await resolveSource(projectId);
    if (!cfg.auto || !source) return { status: 'off' };
    if (source === 'stock') { await stockForArticle(articleId, { hint, fetchImpl, download, now }); return { status: 'ok', source, billed: false, costUsd: 0 }; }
    const im = await generateForArticle(articleId, { visual: hint.prompt, alt: hint.alt, fetchImpl, now });
    return { status: 'ok', source, billed: true, costUsd: im.costUsd };
  } catch (err) { return { status: 'failed', error: String((err && err.message) || err).slice(0, 300), billed: !!(err && err.maybeBilled), costUsd: err && err.costUsd !== undefined ? err.costUsd : null }; }
}

async function setAlt(articleId, alt) {
  const text = V.str(alt, 'Alt metin', { required: true, max: 200 });
  const r = (await db.query(`UPDATE article_images SET alt = $2 WHERE article_id = $1 RETURNING ${COLS}`, [articleId, text])).rows[0];
  if (!r) throw new HttpError(404, 'Bu makalenin görseli yok');
  return meta(r);
}
async function remove(articleId) { return (await db.query('DELETE FROM article_images WHERE article_id = $1', [articleId])).rowCount > 0; }

module.exports = { SIZE, sniff, explainImage, buildPrompt, generate, generateForArticle, autoForArticle, resolveSource, stockForArticle, searchForArticle, forArticle, file, setAlt, remove, STORAGE_CAP };
