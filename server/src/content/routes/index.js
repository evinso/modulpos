const express = require('express');
const rateLimit = require('express-rate-limit');
const { env } = require('../env');
const { wrap, HttpError, bad } = require('../lib/http');
const cookies = require('../lib/cookies');
const mw = require('../middleware');
const auth = require('../services/auth');
const audit = require('../services/audit');
const projects = require('../services/projects');
const settings = require('../services/settings');
const limits = require('../services/limits');
const providers = require('../services/providers');
const articles = require('../services/articles');
const dashboard = require('../services/dashboard');
const notifications = require('../services/notifications');
const bots = require('../services/bots');
const scheduler = require('../services/scheduler');
const queue = require('../services/queue');
const telegram = require('../services/telegram');
const migrate = require('../migrate');
const db = require('../db');

/**
 * /api/content/*  (everything the admin panel at content.modulpos.com talks to).
 * Order of the guards: no-store -> state (database ready?) -> CSRF -> session -> permission -> handler. Every write is audited.
 */
function buildRouter(getState) {
  const r = express.Router();
  const ctx = (req) => ({ user: req.cu && req.cu.user, ip: req.ip });
  const A = (req, action, entity, entityId, before, after) => audit.audit(ctx(req), { action, entity, entityId, before, after });
  const uid = (req) => req.cu.user.id;

  r.use(mw.noStore);
  r.use((req, res, next) => {
    const st = getState();
    if (st.status === 'ready') return next();
    return res.status(503).json({ error: st.status === 'failed' ? 'İçerik veritabanına bağlanılamadı; birkaç dakika sonra yeniden denenecek' : 'İçerik modülü başlıyor, birkaç saniye sonra tekrar deneyin', state: st.status });
  });
  // Telegram's webhook: no session and no CSRF header (Telegram sends neither); it is protected by the secret Telegram puts in a header (see services/telegram.js)
  const hookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Çok fazla istek' } });
  r.post('/telegram/webhook', hookLimiter, wrap(async (req, res) => {
    if (!(await telegram.verifyWebhook(req.get('x-telegram-bot-api-secret-token')))) return res.status(401).json({ error: 'Yetkisiz' });
    await telegram.handleUpdate(req.body);                                                  // a failure here is a 500: Telegram delivers the update again
    res.json({ ok: true });
  }));
  r.use(mw.csrf);
  // the handlers read req.body fields: no body / another content type = an empty object; a JSON array or scalar is refused (400), never a crash
  r.use((req, _res, next) => {
    if (req.body === undefined || req.body === null) req.body = {};
    if (typeof req.body !== 'object' || Array.isArray(req.body)) return next(bad('İstek içeriği bir JSON nesnesi olmalı'));
    next();
  });
  mw.uuidParams(r, ['id', 'projectId', 'categoryId', 'userId']);

  // ── public: state, first setup, login ────────────────────────────────────────────────────────────────────
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.' } });

  r.get('/status', wrap(async (_req, res) => {
    const users = await auth.userCount();
    res.json({ ok: true, setupNeeded: users === 0, setupTokenConfigured: !!env().setupToken });
  }));

  r.post('/auth/setup', loginLimiter, wrap(async (req, res) => {
    const u = await auth.setupFirstAdmin({ token: String(req.body.token || ''), email: req.body.email, name: req.body.name, password: req.body.password });
    await audit.audit({ user: u, ip: req.ip }, { action: 'auth.setup', entity: 'user', entityId: u.id });
    res.status(201).json({ user: u });
  }));

  r.post('/auth/login', loginLimiter, wrap(async (req, res) => {
    const out = await auth.login({ email: req.body.email, password: req.body.password, ip: req.ip, userAgent: req.headers['user-agent'] });
    cookies.setSession(res, out.token, out.maxAgeSeconds);
    await audit.audit({ user: out.user, ip: req.ip }, { action: 'auth.login', entity: 'user', entityId: out.user.id });
    res.json({ user: out.user });
  }));

  r.post('/auth/logout', wrap(async (req, res) => { await auth.logout(cookies.readSession(req)); cookies.clearSession(res); res.json({ ok: true }); }));

  // ── everything below needs a session ─────────────────────────────────────────────────────────────────────
  r.use(mw.requireAuth);

  r.get('/auth/me', (req, res) => res.json({ user: req.cu.user, permissions: Object.keys(auth.PERMS).filter((p) => auth.can(req.cu.user.role, p)) }));
  r.post('/auth/password', wrap(async (req, res) => {
    await auth.changePassword(uid(req), { current: req.body.current, next: req.body.next });
    await A(req, 'auth.password', 'user', uid(req));
    cookies.clearSession(res);
    res.json({ ok: true, message: 'Şifre değişti; tüm cihazlardaki oturumlar kapatıldı. Yeniden giriş yapın.' });
  }));

  r.get('/dashboard', wrap(async (req, res) => res.json(await dashboard.build({ projectId: req.query.projectId || null, days: parseInt(req.query.days, 10) || 30 }))));

  // ── projects, niche, categories, excluded topics ─────────────────────────────────────────────────────────
  r.get('/projects', wrap(async (_req, res) => res.json({ projects: await projects.listProjects() })));
  r.post('/projects', mw.need('projects.write'), wrap(async (req, res) => { const p = await projects.createProject(req.body, { userId: uid(req) }); await A(req, 'project.create', 'project', p.id, null, p); res.status(201).json(p); }));
  r.get('/projects/:id', wrap(async (req, res) => res.json(await projects.getProject(req.params.id))));
  r.put('/projects/:id', mw.need('projects.write'), wrap(async (req, res) => { const before = await projects.getProject(req.params.id); const p = await projects.updateProject(req.params.id, req.body); await A(req, 'project.update', 'project', p.id, before, p); res.json(p); }));
  r.put('/projects/:id/niche', mw.need('projects.write'), wrap(async (req, res) => {
    const before = await projects.getProject(req.params.id);
    const p = await projects.updateNiche(req.params.id, req.body, { userId: uid(req) });
    await A(req, 'niche.update', 'project', p.id, before.niche, p.niche);
    res.json(p);
  }));
  r.get('/projects/:id/categories', wrap(async (req, res) => res.json({ categories: await projects.listCategories(req.params.id) })));
  r.post('/projects/:id/categories', mw.need('categories.write'), wrap(async (req, res) => { const c = await projects.createCategory(req.params.id, req.body); await A(req, 'category.create', 'category', c.id, null, c); res.status(201).json(c); }));
  r.put('/projects/:id/category-shares', mw.need('categories.write'), wrap(async (req, res) => {
    const before = await projects.listCategories(req.params.id);
    const cats = await projects.setShares(req.params.id, req.body.shares);
    await A(req, 'category.shares', 'project', req.params.id, before.map((c) => ({ id: c.id, share: c.targetSharePct })), cats.map((c) => ({ id: c.id, share: c.targetSharePct })));
    res.json({ categories: cats });
  }));
  r.put('/categories/:id', mw.need('categories.write'), wrap(async (req, res) => { const before = await projects.getCategory(req.params.id); const c = await projects.updateCategory(req.params.id, req.body); await A(req, 'category.update', 'category', c.id, before, c); res.json(c); }));
  r.post('/categories/:id/archive', mw.need('categories.write'), wrap(async (req, res) => { const c = await projects.archiveCategory(req.params.id); await A(req, 'category.archive', 'category', c.id); res.json({ category: c, categories: await projects.listCategories(c.projectId) }); }));
  r.delete('/categories/:id', mw.need('categories.write'), wrap(async (req, res) => { const c = await projects.getCategory(req.params.id); await projects.deleteCategory(req.params.id); await A(req, 'category.delete', 'category', req.params.id, c); res.json({ ok: true, categories: await projects.listCategories(c.project_id) }); }));
  r.get('/projects/:id/excluded-topics', wrap(async (req, res) => res.json({ topics: await projects.listExcluded(req.params.id) })));
  r.post('/projects/:id/excluded-topics', mw.need('categories.write'), wrap(async (req, res) => { const t = await projects.addExcluded(req.params.id, req.body); await A(req, 'excluded.add', 'project', req.params.id, null, t); res.status(201).json(t); }));
  r.put('/excluded-topics/:id', mw.need('categories.write'), wrap(async (req, res) => { const t = await projects.setExcludedActive(req.params.id, req.body.isActive); await A(req, 'excluded.toggle', 'excluded_topic', t.id, null, t); res.json(t); }));
  r.delete('/excluded-topics/:id', mw.need('categories.write'), wrap(async (req, res) => { await projects.removeExcluded(req.params.id); await A(req, 'excluded.remove', 'excluded_topic', req.params.id); res.json({ ok: true }); }));
  r.post('/projects/:id/check-topic', wrap(async (req, res) => res.json(await projects.checkTopic(req.params.id, String(req.body.text || '').slice(0, 2000), req.body.categoryId || null))));

  // ── daily work settings, other automation settings ───────────────────────────────────────────────────────
  r.get('/limits', wrap(async (req, res) => res.json({ ...(await limits.getLimits({ projectId: req.query.projectId || null })), bots: await bots.list() })));
  r.put('/limits/global', mw.need('settings.write'), wrap(async (req, res) => { const before = await limits.getLimits(); await limits.setGlobalLimits(req.body.limits, { userId: uid(req) }); const after = await limits.getLimits(); await A(req, 'limits.global', 'limits', 'global', before.global.map((i) => [i.workType, i.limit]), after.global.map((i) => [i.workType, i.limit])); res.json(after); }));
  r.put('/limits/projects/:id', mw.need('settings.write'), wrap(async (req, res) => { await limits.setProjectLimits(req.params.id, req.body.limits, { userId: uid(req) }); await A(req, 'limits.project', 'project', req.params.id, null, req.body.limits); res.json(await limits.getLimits({ projectId: req.params.id })); }));
  r.put('/limits/categories/:id', mw.need('settings.write'), wrap(async (req, res) => {
    const cat = await projects.getCategory(req.params.id);
    await limits.setCategoryLimits(req.params.id, { dailyMax: req.body.dailyMax, publishMax: req.body.publishMax }, { userId: uid(req) });
    await A(req, 'limits.category', 'category', req.params.id, null, { dailyMax: req.body.dailyMax, publishMax: req.body.publishMax });
    res.json(await limits.getLimits({ projectId: cat.project_id }));
  }));
  r.post('/limits/reset', mw.need('settings.write'), wrap(async (req, res) => {
    await limits.setGlobalLimits(Object.fromEntries(limits.TYPES.map((t) => [t, null])), { userId: uid(req) });
    await A(req, 'limits.reset', 'limits', 'global');
    res.json(await limits.getLimits({ projectId: req.body.projectId || null }));
  }));

  r.get('/settings', wrap(async (req, res) => res.json(await settings.getAll(req.query.projectId || null))));
  r.put('/settings/:group', mw.need('settings.write'), wrap(async (req, res) => {
    const scope = req.body.projectId ? 'project' : 'global';
    const before = (await settings.get(req.params.group, req.body.projectId || null)).value;
    const value = await settings.set(req.params.group, req.body.value, { scope, projectId: req.body.projectId || null, userId: uid(req) });
    await A(req, `settings.${req.params.group}`, 'settings', scope, before, value);
    res.json({ value });
  }));
  r.delete('/settings/:group', mw.need('settings.write'), wrap(async (req, res) => {
    const scope = req.query.projectId ? 'project' : 'global';
    await settings.reset(req.params.group, { scope, projectId: req.query.projectId || null });
    await A(req, `settings.${req.params.group}.reset`, 'settings', scope);
    res.json({ ok: true, ...(await settings.get(req.params.group, req.query.projectId || null)) });
  }));

  // ── bots ────────────────────────────────────────────────────────────────────────────────────────────────
  r.get('/bots', wrap(async (_req, res) => res.json(await bots.list())));
  r.put('/bots/:key/schedule', mw.need('bots.control'), wrap(async (req, res) => { const s = await scheduler.updateSchedule(req.params.key, req.body); await A(req, 'bots.schedule', 'bot', req.params.key, null, { enabled: s.enabled, intervalMinutes: s.intervalMinutes, window: s.windowStart ? `${s.windowStart}-${s.windowEnd}` : null }); res.json({ schedule: s, bots: await bots.list() }); }));
  // every scheduled bot, once, in the order the work depends on itself (see scheduler.RUN_ORDER): one click, a queued job per step
  r.post('/bots/run-all', mw.need('bots.control'), wrap(async (req, res) => { const out = await scheduler.runAll(req.body.projectId, { userId: uid(req) }); await A(req, 'bots.run_all', 'project', String(req.body.projectId), null, { queued: out.queued, alreadyActive: out.alreadyActive }); res.status(202).json(out); }));
  r.post('/bots/:key/run', mw.need('bots.control'), wrap(async (req, res) => { const job = await scheduler.runNow(req.params.key, req.body.projectId, { userId: uid(req) }); await A(req, 'bots.run', 'bot', req.params.key, null, { jobId: job.id }); res.status(202).json({ job }); }));
  r.get('/jobs', wrap(async (req, res) => res.json({ jobs: await queue.list({ status: req.query.status || null, botKey: req.query.bot || null, projectId: req.query.projectId || null, limit: parseInt(req.query.limit, 10) || 50 }), counts: await queue.counts() })));
  const jid = (req) => { const n = parseInt(req.params.jid, 10); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Görev bulunamadı'); return n; };
  r.post('/jobs/:jid/cancel', mw.need('bots.control'), wrap(async (req, res) => { const j = await queue.cancel(jid(req)); await A(req, 'jobs.cancel', 'job', String(j.id), null, { bot: j.botKey }); res.json(j); }));
  r.post('/jobs/:jid/retry', mw.need('bots.control'), wrap(async (req, res) => { const j = await queue.retry(jid(req), { userId: uid(req) }); await A(req, 'jobs.retry', 'job', String(j.id), null, { bot: j.botKey }); res.status(202).json(j); }));
  r.post('/bots/pause', mw.need('bots.control'), wrap(async (req, res) => { const out = await bots.setPaused(true, { userId: uid(req), email: req.cu.user.email }); await A(req, 'bots.pause', 'bots', 'all'); res.json(out); }));
  r.post('/bots/resume', mw.need('bots.control'), wrap(async (req, res) => { const out = await bots.setPaused(false, { userId: uid(req) }); await A(req, 'bots.resume', 'bots', 'all'); res.json(out); }));

  // ── external services and costs ──────────────────────────────────────────────────────────────────────────
  r.get('/providers', wrap(async (_req, res) => res.json({ providers: await providers.list() })));
  r.put('/providers/:key', mw.need('providers.write'), wrap(async (req, res) => {
    const p = await providers.save(req.params.key, req.body);
    await A(req, 'provider.save', 'provider', req.params.key, null, { configured: p.configured, secretLast4: p.secretLast4, extra: p.extra, secretChanged: typeof req.body.secret === 'string' && req.body.secret !== '' });
    res.json(p);
  }));
  r.post('/providers/:key/test', mw.need('providers.write'), wrap(async (req, res) => { const out = await providers.test(req.params.key); await A(req, 'provider.test', 'provider', req.params.key, null, { ok: out.ok }); res.json(out); }));
  r.get('/usage', wrap(async (req, res) => res.json(await providers.usageReport({ days: parseInt(req.query.days, 10) || 30, limit: parseInt(req.query.limit, 10) || 50, provider: req.query.provider || null }))));

  // ── articles ────────────────────────────────────────────────────────────────────────────────────────────
  r.get('/articles', wrap(async (req, res) => res.json(await articles.list(req.query))));
  r.get('/articles-export', wrap(async (req, res) => {
    const out = await articles.exportArticles({ ...req.query, ids: req.query.ids ? String(req.query.ids).split(',') : undefined }, String(req.query.format || 'csv'));
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Content-Security-Policy': 'sandbox', 'X-Article-Count': String(out.count) });
    res.send(out.body);
  }));
  r.post('/articles', mw.need('articles.write'), wrap(async (req, res) => { const a = await articles.create(req.body, { userId: uid(req) }); await A(req, 'article.create', 'article', a.id, null, { h1: a.h1, projectId: a.projectId }); res.status(201).json(a); }));
  r.post('/articles/bulk', mw.need('articles.write'), wrap(async (req, res) => { const out = await articles.bulk(req.body, { userId: uid(req) }); await A(req, `article.bulk.${req.body.action}`, 'article', '', null, { done: out.done.length, failed: out.failed.length }); res.json(out); }));
  r.get('/articles/:id', wrap(async (req, res) => res.json(await articles.get(req.params.id))));
  r.put('/articles/:id', mw.need('articles.write'), wrap(async (req, res) => { const a = await articles.update(req.params.id, req.body, { userId: uid(req) }); await A(req, 'article.update', 'article', a.id, null, { version: a.currentVersion, fields: Object.keys(req.body).filter((k) => !['contentHtml', 'expectedVersion'].includes(k)) }); res.json(a); }));
  r.delete('/articles/:id', mw.need('articles.write'), wrap(async (req, res) => { const a = await articles.get(req.params.id); await articles.remove(req.params.id); await A(req, 'article.delete', 'article', req.params.id, { h1: a.h1, status: a.status }); res.json({ ok: true }); }));
  r.post('/articles/:id/status', mw.need('articles.write'), wrap(async (req, res) => { const before = await articles.get(req.params.id); const a = await articles.setStatus(req.params.id, req.body.status, { userId: uid(req) }); await A(req, 'article.status', 'article', a.id, { status: before.status }, { status: a.status }); res.json(a); }));
  r.get('/articles/:id/readiness', wrap(async (req, res) => res.json(await articles.readiness(req.params.id))));
  r.post('/articles/:id/fact-check', mw.need('articles.write'), wrap(async (req, res) => { const a = await articles.markFactChecked(req.params.id, req.body.checked !== false); await A(req, 'article.factcheck', 'article', a.id, null, { checked: req.body.checked !== false }); res.json(a); }));
  r.put('/articles/:id/sources', mw.need('articles.write'), wrap(async (req, res) => { const n = await articles.setSources(req.params.id, req.body.sources); await A(req, 'article.sources', 'article', req.params.id, null, { count: n }); res.json(await articles.get(req.params.id)); }));
  r.get('/articles/:id/versions', wrap(async (req, res) => res.json({ versions: await articles.listVersions(req.params.id) })));
  r.get('/articles/:id/versions/:v', wrap(async (req, res) => res.json(await articles.getVersion(req.params.id, parseInt(req.params.v, 10)))));
  r.post('/articles/:id/versions/:v/restore', mw.need('articles.write'), wrap(async (req, res) => { const a = await articles.restoreVersion(req.params.id, parseInt(req.params.v, 10), { userId: uid(req) }); await A(req, 'article.restore', 'article', a.id, null, { from: a.restoredFrom }); res.json(a); }));

  // ── notifications, logs, users, system ───────────────────────────────────────────────────────────────────
  require('./research')(r, { wrap, mw, A, uid });
  require('./wordpress')(r, { wrap, mw, A, uid });
  require('./refresh')(r, { wrap, mw, A, uid });
  require('./automation')(r, { wrap, mw, A, uid });
  require('./images')(r, { wrap, mw, A, uid });

  r.get('/notifications', wrap(async (req, res) => res.json(await notifications.list({ unreadOnly: req.query.unread === '1', severity: req.query.severity || null, limit: parseInt(req.query.limit, 10) || 50, offset: parseInt(req.query.offset, 10) || 0 }))));
  r.post('/notifications/read-all', wrap(async (_req, res) => res.json({ marked: await notifications.markAllRead() })));
  r.post('/notifications/:id/read', wrap(async (req, res) => { await notifications.markRead(req.params.id); res.json({ ok: true }); }));

  r.get('/audit', mw.need('logs.read'), wrap(async (req, res) => res.json(await audit.listAudit({ limit: parseInt(req.query.limit, 10) || 50, offset: parseInt(req.query.offset, 10) || 0, entity: req.query.entity || null, action: req.query.action || null }))));
  r.get('/system-logs', mw.need('logs.read'), wrap(async (req, res) => res.json(await audit.listSystem({ limit: parseInt(req.query.limit, 10) || 50, offset: parseInt(req.query.offset, 10) || 0, level: req.query.level || null }))));

  r.get('/users', mw.need('users.manage'), wrap(async (_req, res) => res.json({ users: await auth.listUsers() })));
  r.post('/users', mw.need('users.manage'), wrap(async (req, res) => { const u = await auth.createUser(req.body); await A(req, 'user.create', 'user', u.id, null, { email: u.email, role: u.role }); res.status(201).json(u); }));
  r.put('/users/:userId', mw.need('users.manage'), wrap(async (req, res) => { const u = await auth.updateUser(req.params.userId, req.body); await A(req, 'user.update', 'user', u.id, null, { role: u.role, isActive: u.isActive }); res.json(u); }));

  r.get('/system', mw.need('users.manage'), wrap(async (_req, res) => {
    const e = env();
    const m = await db.query('SELECT id, applied_at FROM _migrations ORDER BY id');
    res.json({
      node: process.version, uptimeSeconds: Math.round(process.uptime()), timezone: e.defaultTimezone, production: e.isProd,
      migrations: m.rows.map((x) => ({ id: x.id, appliedAt: x.applied_at, })), migrationFilesTotal: migrate.files().length,
      config: { encryptionKeyConfigured: !!e.encryptionKey, setupTokenConfigured: !!e.setupToken, adminOrigins: e.adminOrigins, databaseSsl: e.dbSsl, poolMax: e.poolMax },
    });
  }));

  r.use((req, _res, next) => next(new HttpError(404, 'Adres bulunamadı')));

  // errors of this router: readable sentences for the panel, details (extra) for the screens that need them, nothing internal on 5xx
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'İstek içeriği okunamadı (geçersiz JSON)' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'İstek çok büyük' });
    if (err && (err.code === '22P02' || err.code === '22003' || err.code === '22001')) return res.status(400).json({ error: 'Gönderilen değerlerden biri geçersiz' });
    if (err && err.code === '57014') return res.status(503).json({ error: 'Veritabanı yanıt vermedi (zaman aşımı); tekrar deneyin' });
    console.error('[Content] request failed:', req.method, req.path, err && err.stack ? err.stack : err);
    audit.systemLog('error', 'http', `${req.method} ${req.path}: ${err && err.message}`, {});
    res.status(err && err.status >= 400 && err.status < 500 ? err.status : 500).json({ error: 'Sunucu hatası' });
  });
  return r;
}

module.exports = { buildRouter };
