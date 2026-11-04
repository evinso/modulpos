const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const productListCache = require('../services/productListCache');
const { ContentRuleSet, buildRegex } = require('../services/contentRules');

const router = express.Router();
router.use(auth);

const isAdmin = (u) => u.role === 'admin' || u.role === 'superadmin';
const ACTIONS = ['replace', 'remove', 'block'];
const FIELDS = ['title', 'description', 'both'];
const MATCH = ['word', 'contains'];

async function getStore(userId) {
  return prisma.store.findFirst({ where: { userId }, select: { id: true } });
}

function clean(body) {
  const pattern = String(body.pattern || '').trim();
  if (!pattern) { const e = new Error('Kelime zorunludur'); e.status = 400; throw e; }
  if (pattern.length > 100) { const e = new Error('Kelime en fazla 100 karakter olabilir'); e.status = 400; throw e; }
  const action = ACTIONS.includes(body.action) ? body.action : 'replace';
  const data = {
    pattern,
    action,
    field: FIELDS.includes(body.field) ? body.field : 'both',
    matchType: MATCH.includes(body.matchType) ? body.matchType : 'word',
    caseSensitive: !!body.caseSensitive,
    replacement: action === 'replace' ? String(body.replacement ?? '').slice(0, 100) : '',
    note: body.note ? String(body.note).slice(0, 200) : null,
  };
  if (!buildRegex(data)) { const e = new Error('Geçersiz kelime'); e.status = 400; throw e; }
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  return data;
}

// List own rules + global rules (global ones are read-only for normal users)
router.get('/', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const [own, global] = await Promise.all([
      prisma.contentRule.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' } }),
      prisma.contentRule.findMany({ where: { storeId: null }, orderBy: { createdAt: 'desc' } }),
    ]);
    res.json({ own, global, canEditGlobal: isAdmin(req.user) });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const wantGlobal = !!req.body.isGlobal;
    if (wantGlobal && !isAdmin(req.user)) return res.status(403).json({ error: 'Genel kural eklemek için yönetici olmalısınız' });
    const rule = await prisma.contentRule.create({ data: { ...clean(req.body), storeId: wantGlobal ? null : store.id } });
    productListCache.invalidate(wantGlobal ? null : store.id);
    res.status(201).json(rule);
  } catch (e) { next(e); }
});

async function findEditable(req) {
  const store = await getStore(req.user.id);
  if (!store) return null;
  const rule = await prisma.contentRule.findUnique({ where: { id: req.params.id } });
  if (!rule) return null;
  if (rule.storeId === null) return isAdmin(req.user) ? rule : null;
  return rule.storeId === store.id ? rule : null;
}

router.put('/:id', async (req, res, next) => {
  try {
    const rule = await findEditable(req);
    if (!rule) return res.status(404).json({ error: 'Kural bulunamadı' });
    const updated = await prisma.contentRule.update({ where: { id: rule.id }, data: clean({ ...rule, ...req.body }) });
    productListCache.invalidate(rule.storeId);
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const rule = await findEditable(req);
    if (!rule) return res.status(404).json({ error: 'Kural bulunamadı' });
    await prisma.contentRule.delete({ where: { id: rule.id } });
    productListCache.invalidate(rule.storeId);
    res.json({ message: 'Kural silindi' });
  } catch (e) { next(e); }
});

// Try the active rules on a piece of text without saving anything
router.post('/test', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const rules = await prisma.contentRule.findMany({ where: { isActive: true, OR: [{ storeId: store.id }, { storeId: null }] } });
    const out = new ContentRuleSet(rules).apply({ title: String(req.body.title ?? ''), description: String(req.body.description ?? '') });
    res.json({ title: out.title, description: out.description, changed: out.changed, blocked: out.blocked, blockedBy: out.blockedBy });
  } catch (e) { next(e); }
});

/**
 * Re-applies the current rules to products already in the store.
 * The text is re-derived from the untouched feed copy (rawXmlData), so changing or
 * deleting a rule can also restore the original wording.
 *
 * body: { dryRun: true|false, xmlSourceId? }
 *   dryRun (default) – read-only preview, answers immediately
 *   dryRun:false     – starts a background job (HTTP 202); poll GET /apply/status
 */
const jobs = new Map(); // storeId -> { state, scanned, total, changed, blocked, startedAt, finishedAt, error }

async function* productBatches(where, size = 500) {
  let cursor = null;
  for (;;) {
    const batch = await prisma.product.findMany({
      where, select: { id: true, title: true, description: true, rawXmlData: true },
      orderBy: { id: 'asc' }, take: size, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!batch.length) return;
    yield batch;
    cursor = batch[batch.length - 1].id;
    if (batch.length < size) return;
  }
}

function changeFor(p, set) {
  let raw = {};
  try { raw = p.rawXmlData ? JSON.parse(p.rawXmlData) : {}; } catch { /* keep empty */ }
  const out = set.apply({ title: raw.title || p.title, description: raw.description ?? p.description });
  const title = out.title || p.title;
  const description = out.description ?? p.description;
  const changed = title !== p.title || (description ?? null) !== (p.description ?? null);
  return { changed, title, description, blocked: out.blocked, before: p.title };
}

router.post('/apply', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const dryRun = req.body.dryRun !== false; // default: preview only
    const rules = await prisma.contentRule.findMany({ where: { isActive: true, OR: [{ storeId: store.id }, { storeId: null }] } });
    const set = new ContentRuleSet(rules);
    const where = { storeId: store.id, ...(req.body.xmlSourceId ? { xmlSourceId: req.body.xmlSourceId } : {}) };

    if (dryRun) {
      let scanned = 0, willChange = 0, blocked = 0;
      const samples = [];
      for await (const batch of productBatches(where)) {
        for (const p of batch) {
          scanned++;
          const c = changeFor(p, set);
          if (c.blocked) blocked++;
          if (c.changed) { willChange++; if (samples.length < 10) samples.push({ before: c.before, after: c.title }); }
        }
      }
      return res.json({ dryRun: true, scanned, willChange, blocked, samples });
    }

    const running = jobs.get(store.id);
    if (running && running.state === 'running') return res.status(409).json({ error: 'Zaten çalışan bir uygulama işlemi var', job: running });

    const total = await prisma.product.count({ where });
    const job = { state: 'running', scanned: 0, total, changed: 0, blocked: 0, startedAt: Date.now(), finishedAt: null, error: null };
    jobs.set(store.id, job);

    (async () => {
      try {
        for await (const batch of productBatches(where)) {
          const updates = [];
          for (const p of batch) {
            job.scanned++;
            const c = changeFor(p, set);
            if (c.blocked) job.blocked++;
            if (c.changed) updates.push({ id: p.id, title: c.title, description: c.description });
          }
          for (let i = 0; i < updates.length; i += 50) {
            const part = updates.slice(i, i + 50);
            await prisma.$transaction(part.map((u) => prisma.product.update({ where: { id: u.id }, data: { title: u.title, description: u.description } })));
            job.changed += part.length;
          }
        }
        job.state = 'done';
      } catch (err) {
        console.error('[content-rules/apply]', err.message);
        job.state = 'failed'; job.error = err.message;
      } finally {
        job.finishedAt = Date.now();
        productListCache.invalidate(store.id);
      }
    })();

    res.status(202).json({ started: true, job });
  } catch (e) { next(e); }
});

router.get('/apply/status', async (req, res, next) => {
  try {
    const store = await getStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    res.json({ job: jobs.get(store.id) || null });
  } catch (e) { next(e); }
});

module.exports = router;
