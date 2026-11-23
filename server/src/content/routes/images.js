const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const articles = require('../services/articles');
const images = require('../services/images');
const providers = require('../services/providers');
const settings = require('../services/settings');

/**
 * The cover picture of one article. Reading is open to every signed-in role, editing the alt text / removing it needs "articles.write", drawing a new one costs money: admin ("research.paid").
 */
module.exports = function imageRoutes(r, { wrap, mw, A }) {
  const PAID = mw.need('research.paid'); const WRITE = mw.need('articles.write');
  const shape = (m) => m && { ...m, bytes: undefined };

  r.get('/articles/:id/image', wrap(async (req, res) => {
    const a = await articles.get(req.params.id);
    const [m, openai, pixabay, cfg, src] = await Promise.all([images.forArticle(a.id), providers.get('openai'), providers.get('pixabay'), settings.get('images', a.projectId), images.resolveSource(a.projectId)]);
    res.json({ image: shape(m), typedUrl: a.featuredImageUrl || '', openaiConfigured: !!openai.configured, pixabayConfigured: !!pixabay.configured, auto: !!cfg.value.auto, quality: cfg.value.quality, source: cfg.value.source, stockType: cfg.value.stockType, usedSource: src.source, focusKeyword: a.focusKeyword || '' });
  }));
  // free photos: a search shows candidates (nothing is saved), choosing one downloads it to our own storage and makes it the cover
  r.get('/articles/:id/image/stock-search', WRITE, wrap(async (req, res) => {
    const a = await articles.get(req.params.id);
    const out = await images.searchForArticle(a.id, { query: V.str(req.query.query, 'Aranan kelime', { max: 100, required: true }), type: req.query.type ? V.oneOf(req.query.type, 'Görsel türü', ['photo', 'illustration', 'all']) : undefined });
    res.json({ candidates: out.candidates.map((c) => ({ id: c.id, thumb: c.thumb, pageUrl: c.pageUrl, tags: c.tags, width: c.width, height: c.height, user: c.user, problem: c.problem })), total: out.total, cached: out.cached });
  }));
  r.post('/articles/:id/image/stock', WRITE, wrap(async (req, res) => {
    const a = await articles.get(req.params.id);
    const m = await images.stockForArticle(a.id, { photoId: V.str(req.body.photoId, 'Fotoğraf', { max: 20, required: true }), query: V.str(req.body.query, 'Aranan kelime', { max: 100 }) });
    await A(req, 'article.image_stock', 'article', a.id, null, { photoId: m.sourceId, credit: m.creditName });
    res.json({ image: shape(m) });
  }));
  r.get('/articles/:id/image/file', wrap(async (req, res) => {
    await articles.get(req.params.id);
    const f = await images.file(req.params.id); if (!f) throw new HttpError(404, 'Bu makalenin görseli yok');
    res.set('Content-Type', f.mime); res.set('Content-Disposition', 'inline'); res.set('X-Content-Type-Options', 'nosniff'); res.send(f.buffer);
  }));
  r.post('/articles/:id/image/generate', PAID, wrap(async (req, res) => {
    const a = await articles.get(req.params.id);
    const quality = req.body.quality === undefined ? undefined : V.oneOf(req.body.quality, 'Görsel kalitesi', ['low', 'medium', 'high']);
    const visual = V.str(req.body.prompt, 'Görsel tarifi', { max: 700 });
    const m = await images.generateForArticle(a.id, { visual, alt: V.str(req.body.alt, 'Alt metin', { max: 200 }), quality, operation: 'image_generate' });
    await A(req, 'article.image_generate', 'article', a.id, null, { model: m.model, quality: m.quality, costUsd: m.costUsd });
    res.json({ image: shape(m) });
  }));
  r.put('/articles/:id/image', WRITE, wrap(async (req, res) => {
    const a = await articles.get(req.params.id); const m = await images.setAlt(a.id, req.body.alt);
    await A(req, 'article.image_alt', 'article', a.id, null, { alt: m.alt }); res.json({ image: shape(m) });
  }));
  r.delete('/articles/:id/image', WRITE, wrap(async (req, res) => {
    const a = await articles.get(req.params.id); const done = await images.remove(a.id); if (!done) throw new HttpError(404, 'Bu makalenin görseli yok');
    await A(req, 'article.image_remove', 'article', a.id, null, null); res.json({ ok: true });
  }));
};
