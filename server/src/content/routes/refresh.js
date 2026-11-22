const V = require('../lib/validate');
const { HttpError } = require('../lib/http');
const projects = require('../services/projects');
const articles = require('../services/articles');
const health = require('../services/health');
const refresh = require('../services/refresh');
const queue = require('../services/queue');
const sites = require('../services/sites');
const searchconsole = require('../services/searchconsole');
const internalLinks = require('../services/internalLinks');
const adsenseAudit = require('../services/adsenseAudit');
const telegram = require('../services/telegram');

/**
 * Phase 6 endpoints: content health, the Update Center (refresh proposals), version comparison.
 * Reading is open to every signed-in role; looking at an article (link check) needs "articles.write"; asking a model for an update draft needs admin ("research.paid"),
 * applying or rejecting a draft changes the archive and possibly the public site: admin ("publish.write").
 */
module.exports = function refreshRoutes(r, { wrap, mw, A, uid }) {
  const pid = async (req) => { const id = V.uuid(req.method === 'GET' ? req.query.projectId : req.body.projectId, 'Proje'); await projects.getProject(id); return id; };
  const PAID = mw.need('research.paid'); const PUB = mw.need('publish.write'); const WRITE = mw.need('articles.write');
  mw.uuidParams(r, ['uid', 'lid', 'aid']);

  r.get('/health', wrap(async (req, res) => res.json(await health.overview(await pid(req)))));
  r.get('/articles/:id/assessment', wrap(async (req, res) => res.json(await health.assess(req.params.id))));
  r.post('/articles/:id/health-check', WRITE, wrap(async (req, res) => { const out = await health.checkOne(req.params.id); await A(req, 'article.health_check', 'article', req.params.id, null, { flagged: out.flagged, broken: out.links.broken.length }); res.json(out); }));
  r.get('/articles/:id/diff', wrap(async (req, res) => res.json(await articles.compareVersions(req.params.id, req.query.from, req.query.to))));

  // AdSense site audit: reading the result is open to every role; starting one (about 30-45 requests to the site) needs "research.write"; it runs through the queue
  r.get('/adsense/overview', wrap(async (req, res) => {
    const id = await pid(req); const o = await adsenseAudit.overview(id);
    const pending = (await require('../db').query("SELECT id, status, payload FROM jobs WHERE bot_key = 'adsense_compliance' AND project_id = $1 AND status IN ('queued', 'running') AND payload ? 'url'", [id])).rows;
    res.json({ ...o, pending: pending.map((j) => ({ jobId: Number(j.id), status: j.status, url: j.payload.url })) });
  }));
  r.get('/adsense/audits', wrap(async (req, res) => res.json({ audits: await adsenseAudit.list(await pid(req), { url: req.query.url || null }) })));
  r.get('/adsense/audits/:aid', wrap(async (req, res) => { const a = await adsenseAudit.get(req.params.aid); await projects.getProject(a.projectId); res.json(a); }));
  r.post('/adsense/audits', mw.need('research.write'), wrap(async (req, res) => {
    const id = await pid(req); let url;
    if (req.body.siteId) { const s = await sites.load(req.body.siteId); if (s.project_id !== id) throw new HttpError(404, 'Site bulunamadı'); url = adsenseAudit.normalizeUrl(s.api_url); }
    else url = adsenseAudit.normalizeUrl(req.body.url);
    const q = await queue.enqueue({ botKey: 'adsense_compliance', projectId: id, payload: req.body.siteId ? { siteId: req.body.siteId, url } : { url }, trigger: 'manual', dedupeKey: `adsense_compliance:${id}:${url}`, maxAttempts: 2, userId: uid(req) });
    if (q.duplicate) throw new HttpError(409, 'Bu adres için bir denetim zaten kuyrukta ya da çalışıyor', { jobId: q.job && q.job.id });
    await A(req, 'adsense.audit', 'project', id, null, { url });
    res.status(202).json({ queued: true, jobId: q.job.id, url });
  }));

  // Telegram: setting it up is admin-only ("providers.write": the bot token lives with the other API keys); the webhook itself is in routes/index.js (no session)
  const TG = mw.need('providers.write');
  r.get('/telegram/status', TG, wrap(async (_req, res) => res.json(await telegram.status())));
  r.get('/telegram/webhook/info', TG, wrap(async (_req, res) => res.json(await telegram.webhookInfo())));
  r.post('/telegram/webhook/set', TG, wrap(async (req, res) => {
    const base = req.body.baseUrl ? String(req.body.baseUrl).replace(/\/+$/, '') : `${req.protocol}://${req.get('host')}`;
    const out = await telegram.setWebhook(base); await A(req, 'telegram.webhook_set', 'telegram', 'webhook', null, { url: out.url }); res.json(out);
  }));
  r.post('/telegram/webhook/delete', TG, wrap(async (req, res) => { await telegram.deleteWebhook(); await A(req, 'telegram.webhook_delete', 'telegram', 'webhook'); res.json({ ok: true }); }));
  r.post('/telegram/test-message', TG, wrap(async (req, res) => { const out = await telegram.sendTest(); await A(req, 'telegram.test_message', 'telegram', 'chats', null, { sent: out.sent, failed: out.failed.length }); res.json(out); }));

  // Search Console (numbers as Google reported them; nothing is estimated)
  r.get('/performance', wrap(async (req, res) => { const s = await sites.load(req.query.siteId); await projects.getProject(s.project_id); res.json(await searchconsole.performance(s.id, { days: parseInt(req.query.days, 10) || 28 })); }));
  r.get('/performance/opportunities', wrap(async (req, res) => { const s = await sites.load(req.query.siteId); res.json(await searchconsole.opportunities(s.id)); }));
  r.post('/sites/:sid/gsc-sync', mw.need('sites.write'), wrap(async (req, res) => { const out = await searchconsole.sync(req.params.sid); await A(req, 'site.gsc_sync', 'wp_site', req.params.sid, null, out); res.json(out); }));

  // internal links: found free, applied by a person
  r.get('/internal-links', wrap(async (req, res) => res.json({ links: await internalLinks.list(await pid(req), { status: req.query.status || 'suggested' }) })));
  r.post('/internal-links/find', mw.need('research.write'), wrap(async (req, res) => { const id = await pid(req); const out = await internalLinks.suggest(id); await A(req, 'internal_links.find', 'project', id, null, out); res.json(out); }));
  r.post('/internal-links/:lid/apply', PUB, wrap(async (req, res) => { const out = await internalLinks.apply(req.params.lid, { userId: uid(req) }); await A(req, 'internal_links.apply', 'internal_link', req.params.lid, null, { anchor: out.link && out.link.anchor }); res.json(out); }));
  r.post('/internal-links/:lid/reject', WRITE, wrap(async (req, res) => { await internalLinks.reject(req.params.lid); await A(req, 'internal_links.reject', 'internal_link', req.params.lid); res.json({ ok: true }); }));

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
