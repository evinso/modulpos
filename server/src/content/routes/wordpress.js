const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const projects = require('../services/projects');
const sites = require('../services/sites');
const publishing = require('../services/publishing');
const articles = require('../services/articles');

/**
 * Phase 5 endpoints: WordPress sites (admin), category mapping, sending articles, bulk plans, the publication history and the calendar.
 * Reading is open to every signed-in role; connecting a site and every send to a public site needs admin ("sites.write" / "publish.write").
 */
module.exports = function wordpress(r, { wrap, mw, A, uid }) {
  const pid = async (req) => { const id = V.uuid(req.method === 'GET' || req.method === 'DELETE' ? req.query.projectId : req.body.projectId, 'Proje'); await projects.getProject(id); return id; };
  const SITES = mw.need('sites.write'); const PUB = mw.need('publish.write');
  mw.uuidParams(r, ['pubid']);

  r.get('/sites', wrap(async (req, res) => res.json({ sites: await sites.list(await pid(req)) })));
  r.post('/sites', SITES, wrap(async (req, res) => { const id = await pid(req); const s = await sites.create(id, req.body); await A(req, 'site.create', 'wp_site', s.id, null, { name: s.name, apiUrl: s.apiUrl }); res.status(201).json(s); }));
  r.get('/sites/:sid', wrap(async (req, res) => res.json(await sites.get(req.params.sid))));
  r.put('/sites/:sid', SITES, wrap(async (req, res) => { const s = await sites.update(req.params.sid, req.body); await A(req, 'site.update', 'wp_site', s.id, null, { name: s.name, status: s.status, passwordChanged: !!(req.body.password) }); res.json(s); }));
  r.delete('/sites/:sid', SITES, wrap(async (req, res) => { const s = await sites.get(req.params.sid); await sites.remove(req.params.sid); await A(req, 'site.delete', 'wp_site', req.params.sid, { name: s.name, apiUrl: s.apiUrl }); res.json({ ok: true }); }));
  r.post('/sites/:sid/test', SITES, wrap(async (req, res) => { const out = await sites.test(req.params.sid); await A(req, 'site.test', 'wp_site', req.params.sid, null, { ok: out.ok }); res.json(out); }));
  r.get('/sites/:sid/categories', wrap(async (req, res) => res.json(await sites.categoryMap(req.params.sid, { live: req.query.live !== '0' }))));
  r.put('/sites/:sid/categories', SITES, wrap(async (req, res) => { const out = await sites.saveCategoryMap(req.params.sid, req.body.entries); await A(req, 'site.categories', 'wp_site', req.params.sid, null, out); res.json({ ...out, map: await sites.categoryMap(req.params.sid, { live: false }) }); }));

  // one article to one site (a background job; the answer is the publication row)
  r.post('/articles/:id/publish', PUB, wrap(async (req, res) => {
    const pub = await publishing.submit(req.params.id, V.uuid(req.body.siteId, 'Site'), { mode: req.body.mode, scheduledAt: req.body.scheduledAt, userId: uid(req), allowCrossDomain: req.body.allowCrossDomain === true });
    await A(req, 'article.publish', 'article', req.params.id, null, { siteId: pub.siteId, mode: pub.mode, publicationId: pub.id }); res.status(202).json(pub);
  }));
  r.get('/articles/:id/publications', wrap(async (req, res) => { const a = await articles.get(req.params.id); res.json({ publications: await publishing.list(a.projectId, { articleId: a.id }) }); }));
  r.get('/publications', wrap(async (req, res) => res.json({ publications: await publishing.list(await pid(req), { siteId: req.query.siteId || null, status: req.query.status || null, limit: parseInt(req.query.limit, 10) || 100 }) })));
  r.get('/publications/:pubid', wrap(async (req, res) => res.json({ publication: await publishing.get(req.params.pubid), history: await publishing.history(req.params.pubid) })));
  r.post('/publications/:pubid/retry', PUB, wrap(async (req, res) => {
    const p = await publishing.get(req.params.pubid);
    if (!['failed', 'unknown'].includes(p.status)) throw new HttpError(409, 'Yalnızca başarısız ya da sonucu bilinmeyen gönderimler yeniden denenebilir');
    const out = await publishing.submit(p.articleId, p.siteId, { mode: p.mode === 'schedule' && p.scheduledAt && new Date(p.scheduledAt) < new Date(Date.now() + 6 * 60000) ? 'publish' : p.mode, scheduledAt: p.scheduledAt, userId: uid(req) });
    await A(req, 'publication.retry', 'publication', p.id, null, { articleId: p.articleId }); res.status(202).json(out);
  }));
  r.post('/publications/:pubid/reset', PUB, wrap(async (req, res) => { const out = await publishing.reset(req.params.pubid); await A(req, 'publication.reset', 'publication', req.params.pubid); res.json(out); }));
  r.post('/publications/sync', PUB, wrap(async (req, res) => { const id = await pid(req); const articleId = req.body.articleId ? V.uuid(req.body.articleId, 'Makale') : null; const out = await publishing.syncDue({ projectId: id, articleId }); await A(req, 'publication.sync', articleId ? 'article' : 'project', articleId || id, null, out); res.json(out); }));

  // many articles: a dry run, then the real thing as a background job
  r.post('/publishing/plan', PUB, wrap(async (req, res) => res.json(await publishing.plan({ siteId: V.uuid(req.body.siteId, 'Site'), articleIds: req.body.articleIds, mode: req.body.mode, startAt: req.body.startAt || null }))));
  r.post('/publishing/bulk', PUB, wrap(async (req, res) => {
    const out = await publishing.submitBatch({ siteId: V.uuid(req.body.siteId, 'Site'), articleIds: req.body.articleIds, mode: req.body.mode, startAt: req.body.startAt || null, userId: uid(req) });
    await A(req, 'publishing.bulk', 'wp_site', req.body.siteId, null, { mode: req.body.mode, planned: out.planned, unplanned: out.unplanned.length }); res.status(202).json(out);
  }));
  r.get('/calendar', wrap(async (req, res) => res.json(await publishing.calendar(await pid(req), { from: req.query.from, to: req.query.to }))));
};
