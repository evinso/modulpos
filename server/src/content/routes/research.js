const V = require('../lib/validate');
const { HttpError, bad } = require('../lib/http');
const projects = require('../services/projects');
const news = require('../services/news');
const trends = require('../services/trends');
const keywords = require('../services/keywords');
const serp = require('../services/serp');
const opportunities = require('../services/opportunities');
const niche = require('../services/nicheDiscovery');
const runs = require('../services/runs');
const providers = require('../services/providers');

/**
 * Phase 2 endpoints: news sources and discovery, events, trends, niche suggestions, keywords, SERP, opportunities.
 * Reading is open to every signed-in role. Free work (reading news, scoring) needs "research.write" (admin, editor); sources and every PAID call to DataForSEO need admin.
 */
module.exports = function research(r, { wrap, mw, A, uid }) {
  const pid = async (req) => { const id = V.uuid(req.method === 'GET' || req.method === 'DELETE' ? req.query.projectId : req.body.projectId, 'Proje'); await projects.getProject(id); return id; };
  const W = mw.need('research.write'); const SRC = mw.need('sources.write'); const PAID = mw.need('research.paid');
  mw.uuidParams(r, ['sid', 'cid', 'kid', 'oid', 'nid']);

  // ── news sources and runs ─────────────────────────────────────────────────────────────────────────────────
  r.get('/news/sources', wrap(async (req, res) => res.json({ sources: await news.listSources(await pid(req)) })));
  r.post('/news/sources', SRC, wrap(async (req, res) => { const id = await pid(req); const s = await news.createSource(id, req.body); await A(req, 'news.source.create', 'news_source', s.id, null, { name: s.name, kind: s.kind, url: s.url }); res.status(201).json(s); }));
  r.post('/news/sources/defaults', SRC, wrap(async (req, res) => { const id = await pid(req); const n = await news.seedDefaultSources(id); await A(req, 'news.source.defaults', 'project', id, null, { added: n }); res.json({ added: n, sources: await news.listSources(id) }); }));
  r.put('/news/sources/:sid', SRC, wrap(async (req, res) => { const s = await news.updateSource(req.params.sid, req.body); await A(req, 'news.source.update', 'news_source', s.id, null, { name: s.name, enabled: s.enabled, reliability: s.reliability }); res.json(s); }));
  r.delete('/news/sources/:sid', SRC, wrap(async (req, res) => { const s = await news.getSource(req.params.sid); await news.deleteSource(req.params.sid); await A(req, 'news.source.delete', 'news_source', req.params.sid, { name: s.name, url: s.url }); res.json({ ok: true }); }));
  r.post('/news/sources/:sid/test', SRC, wrap(async (req, res) => res.json(await news.testSource(req.params.sid))));
  r.post('/news/run', W, wrap(async (req, res) => {
    const id = await pid(req);
    const run = await news.startDiscovery(id, { trigger: 'manual', userId: uid(req), force: req.body.force === true, sourceIds: Array.isArray(req.body.sourceIds) ? req.body.sourceIds.map((x) => V.uuid(x, 'Kaynak')) : undefined });
    await A(req, 'news.run', 'project', id, null, { runId: run.id });
    res.status(202).json({ run });
  }));
  r.get('/runs', wrap(async (req, res) => res.json({ runs: await runs.list({ botKey: req.query.bot || null, projectId: req.query.projectId ? V.uuid(req.query.projectId, 'Proje') : null, limit: parseInt(req.query.limit, 10) || 20 }) })));
  r.get('/runs/:runId', wrap(async (req, res) => { const n = parseInt(req.params.runId, 10); if (!Number.isInteger(n)) throw new HttpError(404, 'Kayıt bulunamadı'); res.json(await runs.get(n)); }));

  // ── headlines, events, trends ──────────────────────────────────────────────────────────────────────────────
  r.get('/news/items', wrap(async (req, res) => res.json(await news.listItems(await pid(req), req.query))));
  r.get('/news/clusters', wrap(async (req, res) => res.json(await news.listClusters(await pid(req), req.query))));
  r.get('/news/clusters/:cid', wrap(async (req, res) => res.json(await news.getCluster(req.params.cid))));
  r.post('/news/clusters/:cid/status', W, wrap(async (req, res) => { const c = await news.setClusterStatus(req.params.cid, req.body.status, { categoryId: req.body.categoryId }); await A(req, 'news.cluster.status', 'news_cluster', c.id, null, { status: c.status }); res.json(c); }));
  r.get('/trends', wrap(async (req, res) => res.json(await trends.overview(await pid(req), { hours: parseInt(req.query.hours, 10) || 48 }))));

  // ── niche suggestions ──────────────────────────────────────────────────────────────────────────────────────
  r.get('/niche-suggestions', wrap(async (req, res) => res.json({ suggestions: await niche.list(await pid(req), { status: req.query.status || undefined }) })));
  r.post('/niche-suggestions/discover', W, wrap(async (req, res) => { const id = await pid(req); const out = await niche.discover(id, { userId: uid(req) }); await A(req, 'niche.discover', 'project', id, null, out); res.json({ ...out, suggestions: await niche.list(id) }); }));
  r.post('/niche-suggestions/:nid/decide', mw.need('categories.write'), wrap(async (req, res) => { const s = await niche.decide(req.params.nid, req.body, { userId: uid(req) }); await A(req, `niche.${req.body.action}`, 'niche_suggestion', s.id, null, { label: s.label, status: s.status, categoryId: s.linkedCategoryId }); res.json(s); }));

  // ── keywords (DataForSEO) ──────────────────────────────────────────────────────────────────────────────────
  r.get('/keywords', wrap(async (req, res) => res.json(await keywords.list(await pid(req), req.query))));
  r.get('/keywords-export', wrap(async (req, res) => { const out = await keywords.exportCsv(await pid(req), req.query); res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"` }); res.send(out.body); }));
  r.post('/keywords', W, wrap(async (req, res) => {
    const id = await pid(req); const cats = req.body.categoryId ? V.uuid(req.body.categoryId, 'Kategori') : null;
    const text = Array.isArray(req.body.keywords) ? req.body.keywords : String(req.body.keywords || '').split(/[\n,]/);
    const out = await keywords.add(id, text, { origin: 'manual', country: req.body.country || 'US', categoryId: cats });
    await A(req, 'keywords.add', 'project', id, null, out); res.status(201).json(out);
  }));
  r.delete('/keywords', W, wrap(async (req, res) => { const id = await pid(req); const n = await keywords.remove(id, String(req.query.ids || '').split(',').filter(Boolean)); await A(req, 'keywords.delete', 'project', id, null, { deleted: n }); res.json({ deleted: n }); }));
  r.post('/keywords/plan', W, wrap(async (req, res) => res.json(await keywords.plan(await pid(req), { ids: Array.isArray(req.body.ids) ? req.body.ids : undefined }))));
  r.post('/keywords/fetch', PAID, wrap(async (req, res) => {
    const id = await pid(req);
    const out = await keywords.fetchMetrics(id, { ids: Array.isArray(req.body.ids) ? req.body.ids : undefined, userId: uid(req) });
    await A(req, 'keywords.fetch', 'project', id, null, { requested: out.requested, fetched: out.fetched, costUsd: out.costUsd }); res.json(out);
  }));
  r.post('/keywords/suggest', PAID, wrap(async (req, res) => {
    const id = await pid(req);
    const out = await keywords.suggest(id, req.body.seed, { mode: req.body.mode || 'suggestions', limit: req.body.limit === undefined ? 50 : req.body.limit, country: req.body.country || 'US', userId: uid(req) });
    await A(req, 'keywords.suggest', 'project', id, null, { seed: String(req.body.seed).slice(0, 80), added: out.added, costUsd: out.costUsd }); res.json(out);
  }));

  // ── SERP analysis ──────────────────────────────────────────────────────────────────────────────────────────
  r.get('/serp', wrap(async (req, res) => res.json({ analyses: await serp.list(await pid(req)), disclaimer: serp.DISCLAIMER })));
  r.get('/keywords/:kid/serp', wrap(async (req, res) => res.json({ analysis: await serp.latest(req.params.kid), disclaimer: serp.DISCLAIMER })));
  r.post('/keywords/:kid/serp', PAID, wrap(async (req, res) => {
    const out = await serp.analyze(req.params.kid, { force: req.body.force === true, userId: uid(req) });
    await A(req, 'serp.analyze', 'keyword', req.params.kid, null, { cached: out.cached, competition: out.analysis && out.analysis.competition, costUsd: out.analysis && !out.cached ? out.analysis.costUsd : 0 }); res.json({ ...out, disclaimer: serp.DISCLAIMER });
  }));

  // ── opportunities ──────────────────────────────────────────────────────────────────────────────────────────
  r.post('/opportunities/refresh', W, wrap(async (req, res) => { const id = await pid(req); const out = await opportunities.refresh(id, { userId: uid(req) }); await A(req, 'opportunities.refresh', 'project', id, null, out); res.json(out); }));
  r.get('/opportunities', wrap(async (req, res) => res.json(await opportunities.list(await pid(req), req.query))));
  r.get('/opportunities-select', wrap(async (req, res) => res.json(await opportunities.selectForGeneration(await pid(req), { count: req.query.count === undefined ? undefined : V.int(req.query.count, 'Adet', { min: 0, max: 50 }) }))));
  r.get('/opportunities/:oid', wrap(async (req, res) => res.json(await opportunities.get(req.params.oid))));
  r.post('/opportunities/:oid/status', W, wrap(async (req, res) => { const o = await opportunities.setStatus(req.params.oid, req.body.status); await A(req, 'opportunity.status', 'opportunity', o.id, null, { status: o.status }); res.json(o); }));

  // the missing piece of one idea: the organic competition of ITS best keyword (paid), then the idea is scored again
  r.post('/opportunities/:oid/serp', PAID, wrap(async (req, res) => {
    const o = await opportunities.get(req.params.oid);
    if (!o.keywordId) throw new HttpError(409, 'Bu fikir için gerçek verisi olan bir anahtar kelime yok; önce anahtar kelime verisini çekin');
    const out = await serp.analyze(o.keywordId, { force: req.body.force === true, userId: uid(req) });
    await A(req, 'serp.analyze', 'opportunity', o.id, null, { keyword: o.keyword, cached: out.cached, competition: out.analysis && out.analysis.competition });
    res.json({ ...out, opportunity: await opportunities.rescore(o.id), disclaimer: serp.DISCLAIMER });
  }));

  // the data source status the research pages show as a banner
  r.get('/research/status', wrap(async (req, res) => { const p = await providers.get('dataforseo'); res.json({ dataforseo: { configured: p.configured && !!p.extra.login, lastTestOk: p.lastTestOk, lastTestMessage: p.lastTestMessage, dailyBudgetUsd: p.dailyBudgetUsd, monthlyBudgetUsd: p.monthlyBudgetUsd } }); }));
  void bad;
};
