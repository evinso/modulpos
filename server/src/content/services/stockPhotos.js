const { HttpError } = require('../lib/http');
const providers = require('./providers');
const safeFetch = require('../lib/safeFetch');

/**
 * FREE cover photos from Pixabay (https://pixabay.com/api/docs/). Read from the service's own documentation (2026-11-23); never run against a real key: the tests use a fake fetch.
 *  - the key travels in the query string (`key`), the search is `GET https://pixabay.com/api/?q=…&image_type=photo&orientation=horizontal&safesearch=true`, one photo by `?id=`.
 *  - the documentation forbids permanent hotlinking: the chosen photo is DOWNLOADED to our own storage (images.js keeps it in the database); the returned addresses are used only to show search results.
 *  - "requests must be cached for 24 hours": identical searches are answered from memory for a day (per process; a sleeping server forgets, which only costs a request).
 *  - limit 100 requests per 60 seconds per key (429 is told in words); every search is a usage row with a KNOWN cost of 0 (the service is free).
 *  - the content license allows commercial use without credit, but identifiable people, logos and brands may carry other people's rights and the service does not mark AI-generated
 *    pictures separately: the automatic choice therefore skips a photo whose TAGS mention a person, a logo/brand or "ai generated". That is a word filter on tags, NOT a look at the
 *    picture: nothing here can tell what a photo really shows. A person looks at the pictures in the semi-automatic mode.
 *  - the photographer's name and page are stored with the picture (shown in the panel); showing it on the site is not required by the license.
 */
const API = 'https://pixabay.com/api/';
const HOST = /(^|\.)pixabay\.com$/i;
const CACHE_MS = 24 * 3600 * 1000; const CACHE_MAX = 300;
const MIN_WIDTH = 1200;
const MAX_BYTES = 5 * 1024 * 1024;
const PEOPLE = /\b(man|men|woman|women|people|person|persons|child|children|kid|kids|boy|girl|baby|toddler|portrait|face|faces|couple|family|student|students|businessman|businesswoman|model|crowd|team|teenager|teen|lady|guy|selfie|smile)\b/i;
const MARKS = /\b(logo|logos|brand|trademark|screenshot|ai generated|ai-generated|generative|midjourney|dall-e|stable diffusion)\b/i;
const TYPES = ['photo', 'illustration', 'all'];

const cache = new Map();
const clearCache = () => cache.clear();
const trimQuery = (q) => String(q || '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

/** why an automatic choice must not use this photo (null = fine) */
function reject(c) {
  if (!c.url || !c.thumb) return 'dosya adresi yok';
  try { if (!HOST.test(new URL(c.url).hostname)) return 'adres Pixabay’a ait değil'; } catch { return 'adres geçersiz'; }
  if (Number(c.width) < MIN_WIDTH) return `küçük (${c.width} px)`;
  if (PEOPLE.test(c.tags)) return 'etiketlerinde kişi/el var';
  if (MARKS.test(c.tags)) return 'etiketlerinde logo, marka ya da yapay zekâ çizimi var';
  return null;
}

const candidate = (h) => {
  const w = Number(h.imageWidth) || null; const hh = Number(h.imageHeight) || null; const k = w && hh ? Math.min(1, 1280 / Math.max(w, hh)) : null;       // largeImageURL is at most 1280 px on its long side
  const c = { id: String(h.id), pageUrl: String(h.pageURL || ''), tags: String(h.tags || ''), thumb: String(h.webformatURL || h.previewURL || ''), url: String(h.largeImageURL || ''), width: w, height: hh,
    savedWidth: k && Math.round(w * k), savedHeight: k && Math.round(hh * k), user: String(h.user || ''), userId: h.user_id === undefined ? null : String(h.user_id), kind: String(h.type || '') };
  c.problem = reject(c); return c;
};

/** the alt text of a found picture: Pixabay gives only tags, so it says what the tags name (a person can edit it on the card) */
function altFor(c) {
  const tags = c.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const what = /illustration|vector/i.test(c.kind) ? 'Illustration' : 'Photo';
  return tags.length ? `${what} of ${tags.join(', ')}` : what;
}

/**
 * One search (or one photo by id). @param o { query | id, type, perPage, projectId, fetchImpl, now }
 * @returns { candidates: [{ id, pageUrl, tags, thumb, url, width, height, savedWidth, savedHeight, user, userId, kind, problem }], total, cached }
 */
async function search({ query = '', id = null, type = 'photo', perPage = 30, projectId = null, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const secret = await providers.secretFor('pixabay');
  if (!secret) throw new HttpError(409, 'Pixabay anahtarı kayıtlı değil: API Kullanımı sayfasından ücretsiz anahtarı kaydedin');
  const p = new URLSearchParams();
  if (id) p.set('id', String(id).replace(/\D/g, '').slice(0, 15));
  else {
    const q = trimQuery(query); if (q.length < 2) throw new HttpError(400, 'Aranacak kelime en az 2 harf olmalı');
    p.set('q', q); p.set('image_type', TYPES.includes(type) ? type : 'photo'); p.set('orientation', 'horizontal'); p.set('safesearch', 'true'); p.set('min_width', String(MIN_WIDTH)); p.set('per_page', String(Math.max(3, Math.min(60, perPage | 0 || 30))));
  }
  const ck = p.toString(); const hit = cache.get(ck);
  if (hit && now.getTime() - hit.at < CACHE_MS) return { candidates: hit.candidates, total: hit.total, cached: true };
  let res; let text;
  try { res = await fetchImpl(`${API}?key=${encodeURIComponent(secret)}&${ck}`, { signal: AbortSignal.timeout(15000) }); text = await res.text(); }
  catch { await providers.recordUsage({ provider: 'pixabay', endpoint: 'search', operation: 'image_search', requests: 1, costUsd: 0, result: 'error', projectId, meta: { code: 'network' } }); throw new HttpError(503, 'Pixabay’a ulaşılamadı; biraz sonra tekrar deneyin'); }
  const scrub = (m) => String(m).split(secret).join('[gizli]').slice(0, 300);
  if (!res.ok) {
    await providers.recordUsage({ provider: 'pixabay', endpoint: 'search', operation: 'image_search', requests: 1, costUsd: 0, result: 'error', projectId, meta: { status: res.status } });
    if (res.status === 429) throw new HttpError(503, 'Pixabay hız sınırına takıldı (dakikada 100 istek); biraz sonra tekrar deneyin');
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /key/i.test(text))) throw new HttpError(409, 'Pixabay API anahtarı reddedildi: anahtarı pixabay.com/api/docs sayfasından (giriş yapmışken) yeniden kopyalayıp API Kullanımı’na yazın');
    throw new HttpError(502, scrub(`Pixabay beklenmedik cevap verdi (${res.status}) ${text}`));
  }
  let j; try { j = JSON.parse(text); } catch { throw new HttpError(502, 'Pixabay cevabı okunamadı (JSON değil)'); }
  const candidates = (Array.isArray(j.hits) ? j.hits : []).filter((h) => h && h.id !== undefined).map(candidate);
  await providers.recordUsage({ provider: 'pixabay', endpoint: 'search', operation: 'image_search', requests: 1, units: candidates.length, costUsd: 0, projectId, meta: { query: id ? `id:${id}` : p.get('q'), type: p.get('image_type') || null, hits: candidates.length } });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(ck, { at: now.getTime(), candidates, total: Number(j.totalHits) || candidates.length });
  return { candidates, total: Number(j.totalHits) || candidates.length, cached: false };
}

let downloadOverride = null;
/** test seam: replaces the download of the file (tests have no Pixabay); `useDownload(null)` puts the real one back */
const useDownload = (fn) => { downloadOverride = fn || null; };

/** the file itself, from Pixabay's own host only, through the guarded fetcher */
async function download(c, { download: dl = downloadOverride || ((u) => safeFetch.fetchBinary(u, { maxBytes: MAX_BYTES })) } = {}) {
  const bad = reject({ ...c, tags: '' }); if (bad) throw new HttpError(409, `Bu fotoğraf kullanılamaz: ${bad}`);
  let got; try { got = await dl(c.url); } catch (err) { throw new HttpError(502, `Fotoğraf indirilemedi: ${String((err && err.message) || err).slice(0, 160)}`); }
  if (!got || !Buffer.isBuffer(got.buffer) || !got.buffer.length) throw new HttpError(502, 'Pixabay boş dosya gönderdi');
  if (got.buffer.length > MAX_BYTES) throw new HttpError(409, 'Fotoğraf çok büyük (en çok 5 MB)');
  return got.buffer;
}

module.exports = { search, download, useDownload, altFor, reject, trimQuery, clearCache, TYPES, PEOPLE, MARKS, MIN_WIDTH };
