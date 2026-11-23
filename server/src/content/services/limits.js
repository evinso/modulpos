const db = require('../db');
const { env } = require('../env');
const { dayKey } = require('../lib/time');
const { bad, HttpError } = require('../lib/http');

/**
 * Daily work limits.
 *
 * There are three levels: the whole platform ("global"), one project, one category. All that apply must have room, otherwise nothing is reserved.
 *   global    a row in daily_work_limits (or the default below)
 *   project   new_article: niche_profiles.daily_article_limit (every project has one); other kinds: a row in daily_work_limits
 *   category  new_article: categories.daily_max; publish: a row in daily_work_limits   (empty = no category limit)
 * The global limit is the upper bound for everything: a project or category limit can only make it stricter.
 *
 * reserve() is the ONLY way work is allowed to start. It works in one transaction that takes row locks on the usage rows in a fixed order, so any number of
 * workers (processes, threads, a double click) can ask at the same moment and the limit still holds exactly. "Day" is the day in the configured time zone.
 */
const WORK_TYPES = {
  new_article: { label: 'Yeni makale', def: 3, max: 50 },
  old_check: { label: 'Eski makale kontrolü', def: 10, max: 500 },
  refresh: { label: 'Kapsamlı içerik güncellemesi', def: 2, max: 50 },
  article_fix: { label: 'Otomatik makale düzeltme', def: 4, max: 100 },
  publish: { label: 'WordPress yayını', def: 5, max: 200 },
  seo_keywords: { label: 'SEO anahtar kelime araştırması', def: 100, max: 5000 },
  serp_queries: { label: 'SERP sorgusu', def: 30, max: 2000 },
  news_items: { label: 'İşlenen haber', def: 1000, max: 5000 },
};
const TYPES = Object.keys(WORK_TYPES);
const CATEGORY_TYPES = new Set(['new_article', 'publish']);
const ZERO = '00000000-0000-0000-0000-000000000000';
const SCOPE_ORDER = "CASE scope WHEN 'global' THEN 0 WHEN 'project' THEN 1 ELSE 2 END";

const assertType = (t) => { if (!WORK_TYPES[t]) throw bad(`Bilinmeyen iş türü: ${t}`); return t; };
const limitValue = (v, type) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > WORK_TYPES[type].max) throw bad(`${WORK_TYPES[type].label} limiti 0 ile ${WORK_TYPES[type].max} arasında bir tam sayı olmalı`);
  return n;
};

/** The limit rows / columns that apply to this work, as [{ scope, limit|null }] (global first). */
async function resolve(c, { workType, projectId, categoryId }) {
  const out = [];
  const g = (await c.query("SELECT max_per_day FROM daily_work_limits WHERE scope = 'global' AND work_type = $1", [workType])).rows[0];
  out.push({ scope: 'global', limit: g ? g.max_per_day : WORK_TYPES[workType].def });
  if (projectId) {
    let limit = null;
    if (workType === 'new_article') {
      const n = (await c.query('SELECT daily_article_limit FROM niche_profiles WHERE project_id = $1', [projectId])).rows[0];
      limit = n ? n.daily_article_limit : null;
    } else {
      const r = (await c.query("SELECT max_per_day FROM daily_work_limits WHERE scope = 'project' AND project_id = $1 AND work_type = $2", [projectId, workType])).rows[0];
      limit = r ? r.max_per_day : null;
    }
    out.push({ scope: 'project', limit });
  }
  if (categoryId && CATEGORY_TYPES.has(workType)) {
    let limit = null;
    if (workType === 'new_article') {
      const r = (await c.query('SELECT daily_max FROM categories WHERE id = $1', [categoryId])).rows[0];
      limit = r ? r.daily_max : null;
    } else {
      const r = (await c.query("SELECT max_per_day FROM daily_work_limits WHERE scope = 'category' AND category_id = $1 AND work_type = $2", [categoryId, workType])).rows[0];
      limit = r ? r.max_per_day : null;
    }
    out.push({ scope: 'category', limit });
  }
  return out;
}

async function botsPaused(c) {
  const r = (await c.query("SELECT value FROM automation_settings WHERE scope = 'global' AND key = 'bots'")).rows[0];
  return !!(r && r.value && r.value.paused);
}

/**
 * Asks for permission to do `amount` units of `workType`.
 * @param manual  true when a person started it (the "bots paused" switch does not stop a person, the limits still apply)
 * @returns { ok: true, day, scopes } or { ok: false, reason: 'paused' | 'stopped' | 'limit', scope?, limit?, used?, message }
 */
async function reserve({ workType, projectId = null, categoryId = null, amount = 1, tz = env().defaultTimezone, manual = false, now = new Date() }) {
  assertType(workType);
  if (!Number.isInteger(amount) || amount < 1) throw bad('Miktar 1 veya daha büyük bir tam sayı olmalı');
  const day = dayKey(now, tz);
  return db.tx(async (c) => {
    if (!manual && await botsPaused(c)) return { ok: false, reason: 'paused', message: 'Botlar duraklatıldı' };
    const scopes = await resolve(c, { workType, projectId, categoryId });
    for (const s of scopes) {
      await c.query(`INSERT INTO daily_work_usage (day, work_type, scope, project_id, category_id, used) VALUES ($1,$2,$3,$4,$5,0)
        ON CONFLICT (day, work_type, scope, COALESCE(project_id, '${ZERO}'::uuid), COALESCE(category_id, '${ZERO}'::uuid)) DO NOTHING`,
      [day, workType, s.scope, s.scope === 'project' ? projectId : null, s.scope === 'category' ? categoryId : null]);   // a category row never carries the project: one row per category, always
    }
    const locked = (await c.query(`SELECT id, scope, used FROM daily_work_usage WHERE day = $1 AND work_type = $2
      AND (scope = 'global' OR (scope = 'project' AND project_id = $3) OR (scope = 'category' AND category_id = $4)) ORDER BY ${SCOPE_ORDER}, id FOR UPDATE`, [day, workType, projectId, categoryId])).rows;
    const byScope = new Map(locked.map((r) => [r.scope, r]));
    for (const s of scopes) {
      const row = byScope.get(s.scope);
      if (s.limit === null) continue;
      if (s.limit === 0) return { ok: false, reason: 'stopped', scope: s.scope, limit: 0, used: row.used, message: `${WORK_TYPES[workType].label} durduruldu (limit 0)` };
      if (row.used + amount > s.limit) return { ok: false, reason: 'limit', scope: s.scope, limit: s.limit, used: row.used, message: `${WORK_TYPES[workType].label}: günlük limit doldu (${row.used}/${s.limit}, ${s.scope === 'global' ? 'genel' : s.scope === 'project' ? 'proje' : 'kategori'})` };
    }
    const results = [];
    for (const s of scopes) {
      const row = byScope.get(s.scope);
      await c.query('UPDATE daily_work_usage SET used = used + $1 WHERE id = $2', [amount, row.id]);
      results.push({ scope: s.scope, used: row.used + amount, limit: s.limit, remaining: s.limit === null ? null : s.limit - row.used - amount });
    }
    return { ok: true, day, scopes: results };
  });
}


/**
 * Like reserve(), but takes as much as is free (at most `amount`) instead of all-or-nothing: for work that can be done in parts (process 40 of 200 headlines today).
 * The free amount is computed inside the same locked transaction, so parallel callers can never hand out more than the narrowest limit allows.
 * @returns { ok, granted, wanted, ... }  granted === 0 carries the reason like reserve() does
 */
async function reserveUpTo({ workType, projectId = null, categoryId = null, amount = 1, tz = env().defaultTimezone, manual = false, now = new Date() }) {
  assertType(workType);
  if (!Number.isInteger(amount) || amount < 1) throw bad('Miktar 1 veya daha büyük bir tam sayı olmalı');
  const day = dayKey(now, tz);
  return db.tx(async (c) => {
    if (!manual && await botsPaused(c)) return { ok: false, granted: 0, wanted: amount, reason: 'paused', message: 'Botlar duraklatıldı' };
    const scopes = await resolve(c, { workType, projectId, categoryId });
    for (const s of scopes) {
      await c.query(`INSERT INTO daily_work_usage (day, work_type, scope, project_id, category_id, used) VALUES ($1,$2,$3,$4,$5,0)
        ON CONFLICT (day, work_type, scope, COALESCE(project_id, '${ZERO}'::uuid), COALESCE(category_id, '${ZERO}'::uuid)) DO NOTHING`,
      [day, workType, s.scope, s.scope === 'project' ? projectId : null, s.scope === 'category' ? categoryId : null]);
    }
    const locked = (await c.query(`SELECT id, scope, used FROM daily_work_usage WHERE day = $1 AND work_type = $2
      AND (scope = 'global' OR (scope = 'project' AND project_id = $3) OR (scope = 'category' AND category_id = $4)) ORDER BY ${SCOPE_ORDER}, id FOR UPDATE`, [day, workType, projectId, categoryId])).rows;
    const byScope = new Map(locked.map((r) => [r.scope, r]));
    let granted = amount; let narrow = null;
    for (const s of scopes) {
      if (s.limit === null) continue;
      const free = Math.max(0, s.limit - byScope.get(s.scope).used);
      if (free < granted) { granted = free; narrow = { scope: s.scope, limit: s.limit, used: byScope.get(s.scope).used }; }
    }
    if (granted === 0) {
      const n = narrow || { scope: 'global', limit: 0, used: 0 };
      return { ok: false, granted: 0, wanted: amount, reason: n.limit === 0 ? 'stopped' : 'limit', ...n, message: `${WORK_TYPES[workType].label}: ${n.limit === 0 ? 'durduruldu (limit 0)' : `günlük limit doldu (${n.used}/${n.limit}, ${n.scope === 'global' ? 'genel' : n.scope === 'project' ? 'proje' : 'kategori'})`}` };
    }
    for (const s of scopes) await c.query('UPDATE daily_work_usage SET used = used + $1 WHERE id = $2', [granted, byScope.get(s.scope).id]);
    return { ok: true, granted, wanted: amount, partial: granted < amount, day, limitedBy: narrow };
  });
}

/** Gives reserved units back (work that failed before it did anything). Never goes below 0. */
async function release({ workType, projectId = null, categoryId = null, amount = 1, day }) {
  assertType(workType);
  if (!day) throw bad('Gün belirtilmedi');
  return db.tx(async (c) => {
    const rows = (await c.query(`SELECT id FROM daily_work_usage WHERE day = $1 AND work_type = $2
      AND (scope = 'global' OR (scope = 'project' AND project_id = $3) OR (scope = 'category' AND category_id = $4)) ORDER BY ${SCOPE_ORDER}, id FOR UPDATE`, [day, workType, projectId, categoryId])).rows;
    for (const r of rows) await c.query('UPDATE daily_work_usage SET used = GREATEST(used - $1, 0) WHERE id = $2', [amount, r.id]);
    return rows.length;
  });
}

/** Today's table: kind of work, limit, done, left (for the platform, and for one project when given). */
async function status({ projectId = null, tz = env().defaultTimezone, now = new Date() } = {}) {
  const day = dayKey(now, tz);
  const limits = new Map((await db.query("SELECT work_type, max_per_day FROM daily_work_limits WHERE scope = 'global'")).rows.map((r) => [r.work_type, r.max_per_day]));
  const used = (await db.query("SELECT work_type, scope, used FROM daily_work_usage WHERE day = $1 AND (scope = 'global' OR (scope = 'project' AND project_id = $2))", [day, projectId])).rows;
  const u = (type, scope) => { const r = used.find((x) => x.work_type === type && x.scope === scope); return r ? r.used : 0; };
  let proj = {};
  if (projectId) {
    const n = (await db.query('SELECT daily_article_limit FROM niche_profiles WHERE project_id = $1', [projectId])).rows[0];
    const rows = (await db.query("SELECT work_type, max_per_day FROM daily_work_limits WHERE scope = 'project' AND project_id = $1", [projectId])).rows;
    proj = Object.fromEntries(rows.map((r) => [r.work_type, r.max_per_day]));
    if (n) proj.new_article = n.daily_article_limit;
  }
  return {
    day,
    items: TYPES.map((t) => {
      const limit = limits.has(t) ? limits.get(t) : WORK_TYPES[t].def;
      const done = u(t, 'global');
      return { workType: t, label: WORK_TYPES[t].label, limit, isDefault: !limits.has(t), done, remaining: Math.max(0, limit - done), max: WORK_TYPES[t].max,
        project: projectId && proj[t] !== undefined ? { limit: proj[t], done: u(t, 'project'), remaining: Math.max(0, proj[t] - u(t, 'project')) } : null };
    }),
  };
}

/** Limits as the "Günlük Çalışma Ayarları" page edits them. */
async function getLimits({ projectId = null } = {}) {
  const st = await status({ projectId });
  const categories = projectId
    ? (await db.query(`SELECT c.id, c.name, c.name_en, c.status, c.daily_max,
        (SELECT max_per_day FROM daily_work_limits l WHERE l.scope = 'category' AND l.category_id = c.id AND l.work_type = 'publish') AS publish_max
        FROM categories c WHERE c.project_id = $1 AND c.status <> 'archived' ORDER BY c.priority, c.name`, [projectId])).rows
    : [];
  return { day: st.day, global: st.items, categories };
}

async function upsertLimit(c, { scope, projectId, categoryId, workType, value, userId }) {
  if (value === null) {
    await c.query(`DELETE FROM daily_work_limits WHERE scope = $1 AND project_id IS NOT DISTINCT FROM $2 AND category_id IS NOT DISTINCT FROM $3 AND work_type = $4`, [scope, projectId, categoryId, workType]);
    return;
  }
  await c.query(`INSERT INTO daily_work_limits (scope, project_id, category_id, work_type, max_per_day, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (scope, COALESCE(project_id, '${ZERO}'::uuid), COALESCE(category_id, '${ZERO}'::uuid), work_type) DO UPDATE SET max_per_day = EXCLUDED.max_per_day, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [scope, projectId, categoryId, workType, value, userId]);
}

/** Platform limits: { work_type: number | null } (null = back to the default). */
async function setGlobalLimits(limits, { userId = null } = {}) {
  if (!limits || typeof limits !== 'object') throw bad('Limitler gönderilmedi');
  const clean = Object.entries(limits).map(([t, v]) => [assertType(t), v === null ? null : limitValue(v, t)]);
  await db.tx(async (c) => { for (const [t, v] of clean) await upsertLimit(c, { scope: 'global', projectId: null, categoryId: null, workType: t, value: v, userId }); });
  return clean.length;
}

/** Project limits; new_article is the niche's daily limit (always a number). */
async function setProjectLimits(projectId, limits, { userId = null } = {}) {
  const p = (await db.query('SELECT id FROM content_projects WHERE id = $1', [projectId])).rows[0];
  if (!p) throw new HttpError(404, 'Proje bulunamadı');
  const clean = Object.entries(limits || {}).map(([t, v]) => [assertType(t), v === null ? null : limitValue(v, t)]);
  // every project HAS a daily article limit (the protection against runaway AI spending): "empty" is not an answer, and turning it into the default behind the person's back looked like the value "jumping back"
  if (clean.some(([t, v]) => t === 'new_article' && v === null)) throw new HttpError(400, `Yeni makale günlük sınırı boş bırakılamaz: 0 ile ${WORK_TYPES.new_article.max} arası bir sayı yazın (varsayılan ${WORK_TYPES.new_article.def}). Her projenin bir günlük makale sınırı olmak zorundadır; yapay zekâ harcamasına karşı korumadır`);
  await db.tx(async (c) => {
    for (const [t, v] of clean) {
      if (t === 'new_article') { await c.query('UPDATE niche_profiles SET daily_article_limit = $1, updated_by = $2, updated_at = now() WHERE project_id = $3', [v, userId, projectId]); continue; }
      await upsertLimit(c, { scope: 'project', projectId, categoryId: null, workType: t, value: v, userId });
    }
  });
  return clean.length;
}

/** Category limits: dailyMax (new articles) and publishMax (WordPress publishing); null = no limit. */
async function setCategoryLimits(categoryId, { dailyMax, publishMax }, { userId = null } = {}) {
  const cat = (await db.query('SELECT id FROM categories WHERE id = $1', [categoryId])).rows[0];
  if (!cat) throw new HttpError(404, 'Kategori bulunamadı');
  await db.tx(async (c) => {
    if (dailyMax !== undefined) await c.query('UPDATE categories SET daily_max = $1, updated_at = now() WHERE id = $2', [dailyMax === null ? null : limitValue(dailyMax, 'new_article'), categoryId]);
    if (publishMax !== undefined) await upsertLimit(c, { scope: 'category', projectId: null, categoryId, workType: 'publish', value: publishMax === null ? null : limitValue(publishMax, 'publish'), userId });
  });
}

module.exports = { WORK_TYPES, TYPES, reserve, reserveUpTo, release, status, getLimits, setGlobalLimits, setProjectLimits, setCategoryLimits, resolve };
