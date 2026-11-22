const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const projects = require('../services/projects');
const articles = require('../services/articles');
const health = require('../services/health');
const refresh = require('../services/refresh');
const queue = require('../services/queue');

/**
 * Phase 6 endpoints: content health, the Update Center (refresh proposals), version comparison.
 * Reading is open to every signed-in role; looking at an article (link check) needs "articles.write"; asking a model for an update draft needs admin ("research.paid"),
 * applying or rejecting a draft changes the archive and possibly the public site: admin ("publish.write").
 */
module.exports = function refreshRoutes(r, { wrap, mw, A, uid }) {
  const pid = async (req) => { const id = V.uuid(req.method === 'GET' ? req.query.projectId : req.body.projectId, 'Proje'); await projects.getProject(id); return id; };
  const PAID = mw.need('research.paid'); const PUB = mw.need('publish.write'); const WRITE = mw.need('articles.write');
  mw.uuidParams(r, ['uid']);

  r.get('/health', wrap(async (req, res) => res.json(await health.overview(await pid(req)))));
  r.get('/articles/:id/assessment', wrap(async (req, res) => res.json(await health.assess(req.params.id))));
  r.post('/articles/:id/health-check', WRITE, wrap(async (req, res) => { const out = await health.checkOne(req.params.id); await A(req, 'article.health_check', 'article', req.params.id, null, { flagged: out.flagged, broken: out.links.broken.length }); res.json(out); }));
  r.get('/articles/:id/diff', wrap(async (req, res) => res.json(await articles.compareVersions(req.params.id, req.query.from, req.query.to))));

  r.get('/updates', wrap(async (req, res) => res.json({ proposals: await refresh.list(await pid(req), { status: req.query.status || null, articleId: req.query.articleId || null, limit: parseInt(req.query.limit, 10) || 50 }) })));
  r.get('/updates/:uid', wrap(async (req, res) => res.json(await refresh.detail(req.params.uid))));
  // a model writes an update draft for ONE article (background job: it reads pages and makes three model calls)
  r.post('/articles/:id/propose-update', PAID, wrap(async (req, res) => {
    const a = await articles.get(req.params.id);
    const q = await queue.enqueue({ botKey: refresh.BOT, projectId: a.projectId, payload: { articleId: a.id }, trigger: 'manual', dedupeKey: `${refresh.BOT}:${a.projectId}`, maxAttempts: 1, userId: uid(req) });
    if (q.duplicate) throw new HttpError(409, 'Bir güncelleme taslağı zaten hazırlanıyor; bitmesini bekleyin', { jobId: q.job && q.job.id });
    await A(req, 'article.propose_update', 'article', a.id, null, { jobId: q.job.id }); res.status(202).json({ job: q.job });
  }));
  r.post('/updates/:uid/apply', PUB, wrap(async (req, res) => { const p = await refresh.apply(req.params.uid, { userId: uid(req) }); await A(req, 'update.apply', 'refresh_proposal', req.params.uid, null, { articleId: p.articleId, kind: p.kind }); res.json(p); }));
  r.post('/updates/:uid/reject', PUB, wrap(async (req, res) => { const p = await refresh.reject(req.params.uid, { userId: uid(req), note: req.body.note }); await A(req, 'update.reject', 'refresh_proposal', req.params.uid, null, { articleId: p.articleId }); res.json(p); }));
};
