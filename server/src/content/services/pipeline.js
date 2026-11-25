const db = require('../db');
const V = require('../lib/validate');
const { HttpError, bad } = require('../lib/http');
const { env } = require('../env');
const { dayKey, startOfLocalDay } = require('../lib/time');
const settings = require('./settings');
const limits = require('./limits');
const providers = require('./providers');
const queue = require('./queue');
const notifications = require('./notifications');
const projects = require('./projects');
const sites = require('./sites');
const llm = require('./llm');
const runs = require('./runs');
const news = require('./news');
const opportunities = require('./opportunities');
const keywords = require('./keywords');
const serp = require('./serp');
const writer = require('./writer');
const fixer = require('./fixer');
const articles = require('./articles');
const autoApprove = require('./autoApprove');
const audit = require('./audit');
const adsenseBot = require('./adsenseBot');
const publishing = require('./publishing');

/**
 * THE PRODUCTION LINE ("Otomatik Üretim"). One piece of work at a time, from an idea to a published article, then everything the day's research left behind is thrown away:
 *
 *   idea -> keyword data -> SERP analysis -> suitability -> write (+ the mandatory checks) -> fix what the checks found -> publish -> clean up
 *
 * THE GATE RULE: a step passes the cycle on to the next step ONLY when it really succeeded. An idea that fails a step is thrown away (said in the trail, nothing is relaxed) and the
 * cycle starts again from the first step with the next idea of the SAME category. "Unknown" data never counts as a pass. There is no cap on the number of ideas a cycle may try; what
 * bounds the work is the money and the day: the daily limits and the budget make the cycle WAIT (it goes on where it stopped, the next day or when a service answers again) and a
 * problem no other idea can cure (a rejected key, an empty balance, a site that refuses the login) STOPS it and tells the owner. Only a runaway (30 ideas in one cycle) stops it for a look.
 *
 * ONE CATEGORY PER CYCLE, in turns: the next cycle starts in the category after the one that last produced an article. A category with nothing suitable (or whose own daily limit
 * is used up) is skipped for this cycle; when no category has anything the cycle waits an hour, scans the news again and tries all of them again.
 *
 * It is a state machine saved after every step (table pipeline_runs): a restart or the sleep of the free server continues where it stopped. Everything runs INSIDE one queue job of the
 * bot `daily_pipeline` (a step never queues another job: the worker takes one job at a time, so waiting for a second job from inside the first would wait for ever). A job works for
 * at most JOB_MS and leaves the rest to the next tick (a minute later); the 20-minute lease of the queue is never reached.
 *
 * What it does NOT do: relax a check, publish something `articles.readiness()` refuses, touch an article a person wrote, or delete anything that a person typed in or put on the short list.
 */
const BOT = 'daily_pipeline';
const STEPS = ['idea', 'keyword', 'serp', 'check', 'write', 'fix', 'publish', 'cleanup'];
const LABEL = {
  idea: 'Fikir bulunuyor', keyword: 'Anahtar kelime araştırması', serp: 'SERP rekabet analizi (isteğe bağlı)', check: 'Uygunluk kontrolü', write: 'Makale yazılıyor ve zorunlu kontroller yapılıyor',
  fix: 'Düzeltme Botu: eksikler giderilip onaylanıyor', publish: 'WordPress’e yayımlanıyor', cleanup: 'Araştırma artıkları temizleniyor',
};
const FREQUENCIES = [[1440, 'Günde 1'], [720, 'Günde 2'], [480, 'Günde 3'], [360, '6 saatte 1'], [240, '4 saatte 1'], [180, '3 saatte 1'], [120, '2 saatte 1']];
const JOB_MS = 9 * 60000;
const RETRY_MIN = 10;                // a service that does not answer: look again after this long
const MAX_RETRIES = 6;               // ... and give up (stop, tell the owner) after this many tries in a row at one step
const STOP_RETRY_MIN = 30;           // a stopped cycle looks again by itself after this long (the owner may have fixed the cause)
const WRITE_TRIES = 2;
const RUNAWAY = 30;                  // ideas tried in ONE cycle before it stops for a human look
const DRY_WAIT_MIN = 60;
/** the reasons the idea scorer gives for an idea that no further research can rescue (soft reasons - "no keyword data yet", "score too low so far" - are what the next steps are for) */
const HARD = /Reddedildi|Kapsam dışı|Nişe uygun değil|kanibalizasyon|Hiçbir anahtar kelime için veri bulunamadı/;

const shape = (r) => (r ? {
  id: r.id, projectId: r.project_id, categoryId: r.category_id, trigger: r.trigger, status: r.status, step: r.step, stepSince: r.step_since, attempt: r.attempt, opportunityId: r.opportunity_id,
  articleId: r.article_id, publicationId: r.publication_id, waitUntil: r.wait_until, note: r.note, scanned: r.scanned, triedCategories: r.tried_categories || [], retries: r.retries, trail: r.trail || [],
  costUsd: Number(r.cost_usd), unknownCost: r.unknown_cost, rewrites: r.rewrites, hints: r.hints || {}, result: r.result, startedAt: r.started_at, finishedAt: r.finished_at, updatedAt: r.updated_at,
} : null);

const OPEN = "('running', 'waiting', 'stopped')";
const get = async (id) => shape((await db.query('SELECT * FROM pipeline_runs WHERE id = $1', [id])).rows[0]);
const openRun = async (projectId) => shape((await db.query(`SELECT * FROM pipeline_runs WHERE project_id = $1 AND status IN ${OPEN}`, [projectId])).rows[0]);
const lastRun = async (projectId) => shape((await db.query('SELECT * FROM pipeline_runs WHERE project_id = $1 ORDER BY started_at DESC LIMIT 1', [projectId])).rows[0]);

async function create(projectId, trigger, now) {
  const r = (await db.query('INSERT INTO pipeline_runs (project_id, trigger, started_at, step_since, updated_at) VALUES ($1,$2,$3,$3,$3) RETURNING *', [projectId, trigger, now])).rows[0];
  return shape(r);
}

/** writes every mutable column of the in-memory run (a step changes several at once; one statement keeps them consistent) */
async function persist(run, now = new Date()) {
  await db.query(`UPDATE pipeline_runs SET category_id = $2, status = $3, step = $4, step_since = $5, attempt = $6, opportunity_id = $7, article_id = $8, publication_id = $9, wait_until = $10, note = $11,
    scanned = $12, tried_categories = $13, retries = $14, trail = $15, cost_usd = $16, unknown_cost = $17, result = $18, finished_at = $19, updated_at = $20, rewrites = $21, hints = $22 WHERE id = $1`,
  [run.id, run.categoryId, run.status, run.step, run.stepSince, run.attempt, run.opportunityId, run.articleId, run.publicationId, run.waitUntil, run.note, run.scanned, run.triedCategories, run.retries,
    JSON.stringify(run.trail), run.costUsd, run.unknownCost, run.result ? JSON.stringify(run.result) : null, run.finishedAt, now, run.rewrites, JSON.stringify(run.hints || {})]);
}

const say = (run, step, ok, text) => {
  run.trail.push({ at: new Date().toISOString(), step, ok, text: String(text).slice(0, 320) });
  if (run.trail.length > 80) run.trail.splice(0, run.trail.length - 80);
};
const addCost = (run, usd) => { if (usd === null || usd === undefined || Number.isNaN(Number(usd))) run.unknownCost++; else run.costUsd = Math.round((run.costUsd + Number(usd)) * 1e6) / 1e6; };
const moveTo = (run, step, now) => { run.step = step; run.stepSince = now; run.retries = 0; };

const tz = () => env().defaultTimezone;
/** a few minutes after the next local midnight: the day's limits and budget are new then */
function tomorrow(now) {
  const t = startOfLocalDay(dayKey(new Date(startOfLocalDay(dayKey(now, tz()), tz()).getTime() + 26 * 3600000), tz()), tz());
  return new Date(t.getTime() + 5 * 60000);
}
const inMinutes = (now, m) => new Date(now.getTime() + m * 60000);

// ── settings, prerequisites, switching on ─────────────────────────────────────────────────────────────────────────────────────────────
async function config(projectId) { return (await settings.get('pipeline', projectId)).value; }
const isOn = async (projectId) => (await config(projectId)).enabled;

/** what the line cannot run without: [{ key, label, ok, detail, to }] and `ok` when every one is there */
async function prerequisites(projectId) {
  const [vendors, apify, serper, siteList, niche] = await Promise.all([llm.available(), providers.get('apify'), providers.get('serper'), sites.list(projectId), db.query('SELECT main_niche FROM niche_profiles WHERE project_id = $1', [projectId])]);
  const ready = vendors.filter((v) => v.ready); const okSites = siteList.filter((s) => s.status === 'active' && s.lastTestOk === true);
  const items = [
    { key: 'niche', label: 'Proje nişi', ok: !!(niche.rows[0] && niche.rows[0].main_niche), detail: niche.rows[0] && niche.rows[0].main_niche ? 'Yazıldı' : 'Ana niş boş', to: '/strategy' },
    { key: 'model', label: 'Yapay zekâ sağlayıcısı', ok: ready.length > 0, detail: ready.length ? ready.map((v) => v.label).join(', ') : 'Bağlı değil (anahtar + model adı)', to: '/api-usage' },
    { key: 'apify', label: 'Anahtar kelime verisi (Apify)', ok: !!apify.configured, detail: apify.configured ? 'Bağlı' : 'Bağlı değil', to: '/api-usage' },
    { key: 'serper', label: 'SERP rekabeti (Serper)', ok: !!serper.configured, detail: serper.configured ? 'Bağlı' : 'Bağlı değil', to: '/api-usage' },
    { key: 'wordpress', label: 'WordPress sitesi', ok: okSites.length > 0, detail: okSites.length ? okSites.map((s) => s.name).join(', ') : (siteList.length ? 'Site var ama bağlantı testi geçmedi' : 'Site eklenmedi'), to: '/sites' },
  ];
  return { ok: items.every((i) => i.ok), items, okSites, siteList };
}

/** the site the line publishes to: the one chosen in the publishing settings if it is active, else the first tested active site */
async function pickSite(projectId) {
  const list = await sites.list(projectId);
  const pub = (await settings.get('publishing', projectId)).value;
  return list.find((s) => s.id === pub.siteId && s.status === 'active') || list.find((s) => s.status === 'active' && s.lastTestOk === true) || list.find((s) => s.status === 'active') || null;
}

/** the daily limits the chosen pace needs (only ever RAISED: nothing a person set higher is cut) */
async function ensureRoom(projectId, everyMinutes, changes, userId) {
  const cycles = Math.ceil(1440 / everyMinutes);
  const wantArticles = cycles + 2;                       // + 2: an article that cannot be fixed still used its place
  const st = (await limits.status({ projectId })).items; const item = (t) => st.find((i) => i.workType === t);
  const raiseG = {}; const raiseP = {};
  const wantFix = cycles * 2 * adsenseBot.ROUNDS + 4;      // the AdSense fix bot may use up to 4 rounds on each of two drafts of an idea
  for (const [t, want] of [['new_article', wantArticles], ['publish', cycles], ['article_fix', wantFix]]) {
    if (item(t).limit < want) raiseG[t] = want;
    const pl = item(t).project;
    if ((pl ? pl.limit : -1) < want && (t === 'new_article' || pl)) raiseP[t] = want;
  }
  if (Object.keys(raiseG).length) { await limits.setGlobalLimits(raiseG, { userId }); changes.push(`Platform günlük limiti yükseltildi: ${Object.entries(raiseG).map(([k, v]) => `${limits.WORK_TYPES[k].label} ${v}`).join(', ')}`); }
  if (Object.keys(raiseP).length) { await limits.setProjectLimits(projectId, raiseP, { userId }); changes.push(`Proje günlük limiti yükseltildi: ${Object.entries(raiseP).map(([k, v]) => `${limits.WORK_TYPES[k].label} ${v}`).join(', ')}`); }
  const cats = (await db.query("SELECT id, name_en, daily_max FROM categories WHERE project_id = $1 AND status = 'active'", [projectId])).rows;
  const perCat = Math.ceil(cycles / Math.max(1, cats.length)) + 1;
  for (const c of cats) if (c.daily_max !== null && c.daily_max < perCat) { await limits.setCategoryLimits(c.id, { dailyMax: perCat }, { userId }); changes.push(`“${c.name_en}” kategorisinin günlük sınırı ${c.daily_max} → ${perCat}`); }
  const site = await pickSite(projectId);
  if (site && Number.isInteger(site.dailyLimit) && site.dailyLimit < cycles) { await db.query('UPDATE wp_sites SET daily_limit = $2 WHERE id = $1', [site.id, Math.min(cycles, 200)]); changes.push(`“${site.name}” sitesinin günlük yayın sınırı ${site.dailyLimit} → ${Math.min(cycles, 200)}`); }
}

/**
 * Switches the line on/off and sets its pace. Turning it ON needs every prerequisite and an explicit yes (it publishes without anybody looking), and brings the settings it depends on
 * into line (automatic approval, the publishing site, the daily limits for the pace); everything it changes is returned in `changes`.
 * @param body { enabled?, everyMinutes?, confirm? }
 */
async function setConfig(projectId, body, { userId = null } = {}) {
  const pid = V.uuid(projectId, 'Proje'); await projects.getProject(pid);
  const cur = await config(pid);
  const next = { enabled: body.enabled !== undefined ? V.bool(body.enabled, 'Otomatik üretim') : cur.enabled,
    everyMinutes: body.everyMinutes !== undefined ? V.oneOf(Number(body.everyMinutes), 'Üretim sıklığı', FREQUENCIES.map((f) => f[0])) : cur.everyMinutes,
    newsFallback: body.newsFallback !== undefined ? V.bool(body.newsFallback, 'Taze haber hattı') : cur.newsFallback,
    acceptSubjectWarning: body.acceptSubjectWarning !== undefined ? V.bool(body.acceptSubjectWarning, 'Konu kaynaklı uyarıyı hat kabul etsin') : cur.acceptSubjectWarning,
    minWords: body.minWords !== undefined ? V.int(body.minWords, 'Makale en az kelime', { min: 300, max: 3000 }) : cur.minWords,
    maxDrafts: body.maxDrafts !== undefined ? V.int(body.maxDrafts, 'Bir fikir için en çok taslak', { min: 1, max: 10 }) : cur.maxDrafts,
    adsenseCheck: body.adsenseCheck !== undefined ? V.bool(body.adsenseCheck, 'AdSense kontrolü yayını engellesin') : cur.adsenseCheck };
  const changes = [];
  if (next.enabled) {
    const pre = await prerequisites(pid);
    if (!pre.ok) throw new HttpError(409, `Otomatik üretim için eksikler var: ${pre.items.filter((i) => !i.ok).map((i) => `${i.label} (${i.detail})`).join('; ')}`, { problems: pre.items.filter((i) => !i.ok) });
    if (!cur.enabled && body.confirm !== true) {
      throw new HttpError(409, 'Bu ayarla her döngüde zorunlu kontrollerden (doğruluk, AdSense riski, tekrar, kalite) geçen makale SİZ BAKMADAN sitede herkese açık yayımlanır. Geçemeyen fikir elenir ve sıradaki denenir. Devam edilsin mi?', { requiresConfirmation: true });
    }
    const q = await settings.get('quality', pid);
    if (q.value.manualApprovalNewArticles !== false) {
      await settings.set('quality', { ...q.value, manualApprovalNewArticles: false }, q.overriddenForProject ? { scope: 'project', projectId: pid, userId } : { scope: 'global', userId });
      changes.push('Temiz geçen makalenin kendiliğinden “Yayına hazır” olması AÇILDI (hat bunsuz bitemez)');
    }
    const site = await pickSite(pid); const pub = (await settings.get('publishing', pid)).value;
    if (site && pub.siteId !== site.id) { await settings.set('publishing', { ...pub, siteId: site.id }, { scope: 'project', projectId: pid, userId }); changes.push(`Yayın sitesi: ${site.name}`); }
    await ensureRoom(pid, next.everyMinutes, changes, userId);
  }
  await settings.set('pipeline', next, { scope: 'project', projectId: pid, userId });
  if (next.enabled !== cur.enabled) changes.unshift(next.enabled ? 'Otomatik üretim AÇILDI (eski toplu botlar artık kendiliğinden çalışmaz: üretimi hat yürütür)' : 'Otomatik üretim kapatıldı (eski bot zamanlamaları yeniden geçerli)');
  if (next.everyMinutes !== cur.everyMinutes) changes.push(`Sıklık: ${FREQUENCIES.find((f) => f[0] === next.everyMinutes)[1]}`);
  if (next.minWords !== cur.minWords) changes.push(`Makale en az kelime: ${cur.minWords} → ${next.minWords}`);
  if (next.maxDrafts !== cur.maxDrafts) changes.push(`Bir fikir için en çok taslak: ${cur.maxDrafts} → ${next.maxDrafts}`);
  if (next.adsenseCheck !== cur.adsenseCheck) changes.push(`AdSense kontrolü yayını engellesin: ${cur.adsenseCheck ? 'açık' : 'kapalı'} → ${next.adsenseCheck ? 'açık' : 'kapalı'}`);
  if (next.newsFallback !== cur.newsFallback) changes.push(next.newsFallback ? 'Apify hakkı bitince taze haber hattıyla devam AÇILDI' : 'Apify hakkı bitince taze haber hattıyla devam kapatıldı (hat bekler)');
  if (next.acceptSubjectWarning !== cur.acceptSubjectWarning) changes.push(next.acceptSubjectWarning ? 'Konu kaynaklı AdSense uyarısını hat kendisi kabul etsin AÇILDI' : 'Konu kaynaklı AdSense uyarısı yine bir kişiye bırakılıyor (fikir elenir)');
  return { ...(await overview(pid)), changes };
}

// ── categories in turns ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const activeCategories = async (projectId) => (await db.query("SELECT id, name, name_en, daily_max FROM categories WHERE project_id = $1 AND status = 'active' ORDER BY priority, name_en", [projectId])).rows;
async function lastDoneCategory(projectId) {
  const r = (await db.query("SELECT category_id FROM pipeline_runs WHERE project_id = $1 AND status = 'done' AND category_id IS NOT NULL ORDER BY finished_at DESC LIMIT 1", [projectId])).rows[0];
  return r ? r.category_id : null;
}
/** the category after `afterId` in the fixed order (wrapping round), skipping `exclude`; null when none is left */
function nextCategory(cats, afterId, exclude = []) {
  if (!cats.length) return null;
  const at = cats.findIndex((c) => c.id === afterId);
  for (let i = 1; i <= cats.length; i++) { const c = cats[(at + i + cats.length) % cats.length]; if (!exclude.includes(c.id)) return c; }
  return null;
}
async function categoryUsed(categoryId, now) {
  const r = (await db.query("SELECT used FROM daily_work_usage WHERE day = $1 AND work_type = 'new_article' AND scope = 'category' AND category_id = $2", [dayKey(now, tz()), categoryId])).rows[0];
  return r ? r.used : 0;
}
async function roomFor(projectId, type, now) {
  const it = (await limits.status({ projectId, now })).items.find((i) => i.workType === type);
  const caps = [{ limit: it.limit, done: it.done }]; if (it.project) caps.push({ limit: it.project.limit, done: it.project.done });
  const tight = caps.reduce((a, b) => (b.limit - b.done < a.limit - a.done ? b : a));
  return { left: tight.limit - tight.done, limit: tight.limit, done: tight.done };
}

// ── the outcomes a step can end with ──────────────────────────────────────────────────────────────────────────────────────────────────
const go = (step) => ({ go: step });
const reject = (reason) => ({ reject: reason });
const wait = (until, reason) => ({ wait: { until, reason } });
const stop = (reason) => ({ stop: reason });
const retryLater = (reason) => ({ retry: reason });

/** what a thrown error means for the line (see the class comment): stop, wait for the day / for the service, or "this idea cannot be used" */
function classify(err, now) {
  const msg = String((err && err.message) || err);
  const code = err && err.code;
  if (err && (err.budget || (err.extra && err.extra.limit))) return wait(tomorrow(now), msg);
  if (err && (err.fatal || ['auth', 'funds', 'model'].includes(code) || err.status === 401 || err.status === 403)) return stop(msg);
  if (err && (err.retryable === true || ['rate_limit', 'overloaded', 'timeout', 'network'].includes(code) || err.name === 'TimeoutError' || err.status === 429 || err.status >= 500)) return retryLater(msg);
  if (err instanceof HttpError && err.status === 409 && /bağlı değil|anahtar yok|sağlayıcı|model adı|hazır bir|site yok|duraklat|kullanılamıyor|ayarlanmadı/i.test(msg)) return stop(msg);
  return { unknown: msg };
}

// ── the steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const idea = async (id) => (await db.query(`SELECT o.*, k.keyword, t.title AS topic_title, c.name_en AS category_name FROM content_opportunities o LEFT JOIN keywords k ON k.id = o.keyword_id
  JOIN topics t ON t.id = o.topic_id LEFT JOIN categories c ON c.id = o.category_id WHERE o.id = $1`, [id])).rows[0] || null;

async function scan(run, ctx, now) {
  const pid = run.projectId;
  try {
    const r = await news.runDiscovery(pid, { trigger: 'schedule', userId: null, fetchImpl: ctx.newsFetch, now, gapMs: ctx.gapMs, force: false });
    const o = await opportunities.refresh(pid, { trigger: 'schedule', userId: null, now });
    say(run, 'idea', true, `Haber kaynakları tarandı (${r && r.stats ? `${r.stats.newItems} yeni haber, ${r.stats.relevant} nişe uygun` : 'tamam'}); ${o.topicsCreated} yeni konu çıktı`);
  } catch (err) { say(run, 'idea', false, `Haber taraması tamamlanamadı (eldeki fikirlerle devam): ${String(err.message).slice(0, 160)}`); }
}

const GENERIC = new Set(['the', 'new', 'how', 'what', 'why', 'this', 'that', 'says', 'after', 'over', 'with', 'from', 'about', 'into', 'now', 'its', 'for', 'and']);
/**
 * Does this keyword look like something worth paying to look up and write an article around? It must contain a NAME of the headline: a word that is written with a capital letter (or a digit)
 * in the title (or inside a word: iPhone, eBay, macOS). A generic word the candidate builder picked out of a sentence ("leaked") has volume but no article behind it. The platform's own candidate builder is free, the lookup is not.
 */
function sane(keyword, title) {
  const names = new Set(String(title || '').split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => (/^[\p{Lu}\p{N}]/u.test(w) || /\p{Ll}.*\p{Lu}/u.test(w)) && w.length >= 2).map((w) => w.toLowerCase()).filter((w) => !GENERIC.has(w)));
  return String(keyword || '').toLowerCase().split(/\s+/).some((t) => names.has(t));
}

/** the ideas of the category, best first, that have at least one keyword worth asking for (`kwIds`); ideas without one are skipped (they are not tried, not counted, and the clean-up takes them away) */
async function candidatesOf(projectId, categoryId, limit = 40) {
  const rows = (await db.query(`SELECT o.id, o.title, o.provisional_score, o.topic_id, o.total_score, o.explain->'missing' AS missing, (o.explain->>'lane') = 'true' AS lane, (SELECT COALESCE(json_agg(json_build_object('id', k.id, 'keyword', k.keyword) ORDER BY k.created_at, k.id), '[]'::json) FROM keywords k WHERE k.topic_id = o.topic_id) AS kws
    FROM content_opportunities o JOIN topics t ON t.id = o.topic_id
    WHERE o.project_id = $1 AND o.category_id = $2 AND o.status IN ('new', 'shortlisted') AND t.status = 'new' AND o.provisional_score IS NOT NULL AND COALESCE(o.ineligible_reason, '') !~ $3
    ORDER BY o.provisional_score DESC, o.updated_at DESC LIMIT $4`, [projectId, categoryId, HARD.source, limit])).rows;
  return rows.map((r) => ({ ...r, kwIds: r.kws.filter((k) => sane(k.keyword, r.title)).map((k) => k.id) })).filter((r) => r.kwIds.length);
}

/**
 * While Apify's daily limit is known (hints.apifyOut) NOTHING is asked of it: an idea that already has real volume data goes on as it is, a fresh news idea goes on by the news lane (switch), and an idea that has neither is put
 * aside for later (hints.deferred) while the cycle takes the next idea that can go on. Only when no idea can does the cycle wait for the reset.
 */
const apifyOut = (run, now) => { const a = run.hints && run.hints.apifyOut; return a && new Date(a.until) > now ? a : null; };
const keepOut = (run, now) => { const a = apifyOut(run, now); return a ? { apifyOut: a, deferred: (run.hints && run.hints.deferred) || [] } : {}; };
const canGoOn = (c, cfg) => !(c.missing || []).includes('demand') && c.missing !== null && c.missing !== undefined || (cfg.newsFallback && c.lane === true);   // real volume data (the SERP part is optional), or a fresh news idea
async function bestCandidate(run, cfg, categoryId, now) {
  const list = await candidatesOf(run.projectId, categoryId);
  if (!apifyOut(run, now)) return list[0] || null;
  const later = new Set((run.hints && run.hints.deferred) || []);
  return list.find((c) => !later.has(c.id) && canGoOn(c, cfg)) || null;
}

/** every category has been looked at and none had anything: wait, then scan the news again and look at all of them again */
function dry(run, now) {
  const out = apifyOut(run, now);        // ideas are only held back by Apify's limit: no new scan, just wait for the reset
  if (out) { run.triedCategories = []; run.categoryId = null; return wait(out.until, `${out.reason} (Verisi hazır, devam edebilecek başka fikir de yok.)`); }
  run.triedCategories = []; run.scanned = false; run.categoryId = null;
  return wait(inMinutes(now, DRY_WAIT_MIN), 'Hiçbir kategoride uygun fikir yok; haber kaynakları 1 saat sonra yeniden taranacak');
}

async function stepIdea(run, ctx, now) {
  const pid = run.projectId;
  const room = await roomFor(pid, 'new_article', now);
  if (room.left <= 0) return wait(tomorrow(now), `Günlük yeni makale sınırı doldu (${room.done}/${room.limit}); yarın devam edilecek`);
  const cats = await activeCategories(pid); const cfg = await config(pid);
  if (!cats.length) return stop('Etkin kategori yok');
  if (!run.scanned) { await scan(run, ctx, now); run.scanned = true; await persist(run, now); }
  for (let guard = 0; guard < cats.length * 2 + 2; guard++) {
    let cat = run.categoryId && !run.triedCategories.includes(run.categoryId) ? cats.find((c) => c.id === run.categoryId) : null;
    if (!cat) {
      cat = nextCategory(cats, run.categoryId || await lastDoneCategory(pid), run.triedCategories);
      if (!cat) return dry(run, now);
      run.categoryId = cat.id; say(run, 'idea', null, `Bu turun kategorisi: ${cat.name_en}`);
    }
    if (cat.daily_max !== null && await categoryUsed(cat.id, now) >= cat.daily_max) {
      run.triedCategories.push(cat.id); run.categoryId = null; say(run, 'idea', false, `${cat.name_en}: günlük makale sınırı (${cat.daily_max}) dolu, sıradaki kategoriye geçildi`); continue;
    }
    const pick = await bestCandidate(run, cfg, cat.id, now);
    if (pick) { run.opportunityId = pick.id; say(run, 'idea', true, `Fikir seçildi: “${pick.title}” (${cat.name_en}, ön puan ${pick.provisional_score})`); return go('keyword'); }
    run.triedCategories.push(cat.id); run.categoryId = null; say(run, 'idea', false, `${cat.name_en}: uygun fikir yok, sıradaki kategoriye geçildi`);
  }
  return dry(run, now);
}

const utcNextMidnight = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5));
/**
 * Apify's free plan lets the keyword actor run 5 times a day (it resets at 00:00 UTC = 03:00 in Turkey) and, past that, still ends "SUCCEEDED" with an EMPTY dataset and a line in its log:
 * "today's 5 free runs are used ... Nothing was looked up or charged". The platform only sees "no record for any keyword", so when that happens the last run's log is read (free, read only).
 * @returns { until, reason } when the log says so, else null
 */
async function apifyFreeLimit(ctx, now) {
  try {
    const token = await providers.secretFor('apify'); if (!token) return null;
    const actor = ((await providers.get('apify')).extra || {}).actor || 'gaelasao/keyword-research-api';
    const f = ctx.fetchImpl || globalThis.fetch; const H = { headers: { Authorization: `Bearer ${token}` } };
    const runs = await (await f(`https://api.apify.com/v2/acts/${encodeURIComponent(actor.replace('/', '~'))}/runs?limit=1&desc=1`, H)).json();
    const id = runs && runs.data && runs.data.items && runs.data.items[0] && runs.data.items[0].id; if (!id) return null;
    const log = await (await f(`https://api.apify.com/v2/actor-runs/${id}/log`, H)).text();
    if (!/free runs are used|free plan/i.test(log)) return null;
    return { until: utcNextMidnight(now), reason: 'Apify ücretsiz planında günlük 5 çalıştırma hakkı bitti (sayaç 00:00 UTC’de, Türkiye saatiyle 03:00’te yenilenir). Hiçbir anahtar kelime sorgulanmadı; hat o zaman devam eder. Beklememek için Apify’ın ücretli planına geçebilirsiniz.' };
  } catch { return null; }
}

/** The free plan's keyword actor takes about 20 keywords per run (and only 5 runs a day), so ONE run asks for the chosen idea's keywords AND those of the next ideas of the category (data only: they are still worked one at a time). */
const DEFER_MAX = 12;                                                    // ideas put aside for the limit in one cycle (then the cycle just waits)
const PREFETCH = 20;
const NEAR = 9;

/** no volume data can be had (the daily run limit, the monthly cap): with the owner's switch on, a FRESH news idea goes on by the news lane (real SERP competition, no volume) instead of waiting; otherwise null */
async function newsFallback(run, cfg, why, now) {
  if (!cfg.newsFallback) return null;
  const r = await opportunities.rescore(run.opportunityId, { now });
  const missing = (r.explain && r.explain.missing) || [];
  if (!(r.explain && r.explain.lane) || !r.keywordId || !missing.every((m) => m === 'demand' || m === 'competition')) return null;
  say(run, 'keyword', null, `Hacim verisi alınamadı (${String(why).slice(0, 120)}): taze haber hattıyla devam ediliyor (gerçek SERP rekabeti ölçülecek, hacim puanı yok)`);
  return go('serp');
}

/**
 * The platform's own candidates are single NAMES ("faa", "netflix", "openai's"). Google itself knows what people type after a name: its autocomplete suggestions (one Serper credit) are added
 * as keywords of the topic ("staples canada data breach", "…settlement"), once per idea. Failing to get them never stops the cycle.
 */
async function enrichKeywords(run, ctx, o, now, all) {
  const have = (await db.query("SELECT count(*)::int n FROM keywords WHERE topic_id = $1 AND origin IN ('suggestion', 'related', 'question')", [o.topic_id])).rows[0].n;
  if (have) return;
  const names = all.filter((k) => sane(k.keyword, o.topic_title || o.title)).sort((a, b) => b.keyword.split(' ').length - a.keyword.split(' ').length);
  if (!names.length) return;
  try {
    const out = await keywords.suggest(run.projectId, names[0].keyword, { mode: 'suggestions', limit: 10, topicId: o.topic_id, categoryId: o.category_id, manual: false, fetchImpl: ctx.fetchImpl, now });
    say(run, 'keyword', out.added ? true : null, out.added ? `Google önerilerinden ${out.added} zengin anahtar kelime eklendi (“${names[0].keyword}” için)` : `Google önerisi gelmedi${out.stopped ? ` (${String(out.stopped).slice(0, 100)})` : ''}: mevcut kelimelerle devam`);
  } catch (err) { say(run, 'keyword', null, `Google önerileri alınamadı (${String(err.message).slice(0, 100)}): mevcut kelimelerle devam`); }
}

async function stepKeyword(run, ctx, now) {
  const pid = run.projectId; const o = await idea(run.opportunityId);
  if (!o) return reject('Fikir bulunamadı (silinmiş)');
  if (!(await providers.get('apify')).configured) return stop('Apify bağlı değil: anahtar kelime verisi alınamaz');
  const cfg = await config(pid); const seo = (await settings.get('seo', pid)).value;
  const own = async () => (await db.query('SELECT id, keyword FROM keywords WHERE topic_id = $1', [o.topic_id])).rows;
  let all = await own();
  if (!all.length) { await keywords.generateForTopic(o.topic_id); all = await own(); }
  if (all.some((k) => sane(k.keyword, o.topic_title || o.title))) { await enrichKeywords(run, ctx, o, now, all); all = await own(); }
  const mineIds = all.filter((k) => sane(k.keyword, o.topic_title || o.title)).map((k) => k.id);
  if (!mineIds.length) return reject('Bu konu için aranmaya değer bir anahtar kelime çıkmadı (başlıkta özel ad yok)');
  // no volume can be had now (Apify's daily limit, the monthly cap): never wait for it while something else can go on
  const hasDemand = async () => { const r = await opportunities.rescore(run.opportunityId, { now }); return !!r.keywordId && !((r.explain && r.explain.missing) || []).includes('demand'); };
  const noVolume = async (why, until) => {
    if (await hasDemand()) { say(run, 'keyword', null, `${String(why).slice(0, 110)}: bu fikrin aranma verisi zaten var, onunla devam ediliyor`); return go('serp'); }
    const fb = await newsFallback(run, cfg, why, now); if (fb) return fb;
    const later = [...new Set([...((run.hints && run.hints.deferred) || []), o.id])];
    if (later.length > DEFER_MAX) return wait(until, why);
    run.hints = { apifyOut: { until, reason: why }, deferred: later }; run.opportunityId = null;
    say(run, 'keyword', null, `Bu fikir için aranma verisi alınamıyor (${String(why).slice(0, 110)}): fikir kuyrukta bırakıldı, verisi hazır başka fikre geçiliyor`);
    return { go: 'idea', quiet: true };
  };
  const known = apifyOut(run, now);
  if (known) return noVolume(known.reason, known.until);
  const near = (await candidatesOf(pid, run.categoryId, NEAR + 1)).filter((c) => c.id !== o.id);
  const ids = [...mineIds, ...near.flatMap((c) => c.kwIds)]; const order = new Map(ids.map((id, i) => [id, i]));
  const need = (await keywords.needing(pid, { ids, cacheDays: seo.cacheDays, now })).sort((a, b) => order.get(a.id) - order.get(b.id));
  const mine = need.filter((k) => mineIds.includes(k.id));
  let out = { requested: 0, fetched: 0, noAnswer: 0, found: 0, costUsd: 0, unknownCost: 0 };
  if (mine.length) {
    const ask = need.slice(0, PREFETCH).map((k) => k.id);
    out = await keywords.fetchMetrics(pid, { ids: ask, manual: false, trigger: 'schedule', userId: null, fetchImpl: ctx.fetchImpl, now });
    run.costUsd = Math.round((run.costUsd + Number(out.costUsd || 0)) * 1e6) / 1e6; run.unknownCost += out.unknownCost || 0;
    if (out.stopped && !out.fetched && out.requested > 0) return noVolume(out.stopped, tomorrow(now));
    if (out.noAnswer && !out.fetched) {
      // nothing came back for ANY keyword: on Apify's free plan that is the daily run limit (the actor answers "today's 5 free runs are used" and looks nothing up); otherwise these keywords have no data
      const limit = await apifyFreeLimit(ctx, now);
      if (limit) return noVolume(limit.reason, limit.until);
      return reject('Veri sağlayıcısı bu anahtar kelimeler için hiç veri döndürmedi');
    }
  }
  const r = await opportunities.rescore(run.opportunityId, { now });
  if (!r.keywordId || (r.explain && (r.explain.missing || []).includes('demand'))) return reject(`Anahtar kelime verisi bulunamadı (${out.found || 0}/${out.fetched || 0} kelimede veri var)`);
  say(run, 'keyword', true, `Anahtar kelime: “${r.keyword || ''}”, aranma verisi bulundu${mine.length && need.length > mine.length ? ` (aynı çalıştırmada sıradaki ${Math.min(need.length, PREFETCH) - mine.length} kelime de alındı)` : ''}`);
  return go('serp');
}

/** the SERP analysis is NOT required (owner): when it cannot be had the cycle goes on without it, and the suitability step judges on the parts that are real */
const skipSerp = (run, why) => { say(run, 'serp', null, `SERP atlandı (zorunlu değil): ${String(why).slice(0, 160)}`); return { go: 'check', quiet: true }; };

async function stepSerp(run, ctx, now) {
  const o = await opportunities.get(run.opportunityId).catch(() => null);
  if (!o || !o.keywordId) return reject('Fikrin odak anahtar kelimesi yok');
  let out;
  try { out = await serp.analyze(o.keywordId, { manual: false, trigger: 'schedule', userId: null, fetchImpl: ctx.fetchImpl, now }); }
  catch (err) { return skipSerp(run, `SERP analizi alınamadı: ${err.message}`); }
  if (out.stopped && !out.analysis) return skipSerp(run, out.stopped);
  if (!out.analysis) return skipSerp(run, 'SERP analizi alınamadı');
  if (!out.cached) addCost(run, out.analysis.costUsd);
  await opportunities.rescore(run.opportunityId, { now });
  say(run, 'serp', true, `SERP rekabet tahmini: ${out.analysis.competition}/100${out.cached ? ' (önbellekten)' : ''}`);
  return { go: 'check', quiet: true };
}

const BONUS = { 1: 0, 2: 22, 3: 30, 4: 28, 5: 22, 6: 14 };
/** the focus keyword of the article: a phrase that holds a NAME of the headline, with several words (people search "staples canada data breach", not "staples"), real volume when there is some, no apostrophe oddities, not already an article's focus */
async function chooseFocus(run, o, now) {
  const rows = (await db.query(`SELECT k.id, k.keyword, m.found, m.search_volume FROM keywords k
    LEFT JOIN LATERAL (SELECT found, search_volume FROM keyword_metrics x WHERE x.keyword_id = k.id ORDER BY fetched_at DESC LIMIT 1) m ON true WHERE k.topic_id = $1`, [o.topic_id])).rows;
  const taken = new Set((await db.query("SELECT focus_keyword FROM articles WHERE project_id = $1 AND status NOT IN ('archived', 'failed') AND focus_keyword <> ''", [run.projectId])).rows.map((r) => r.focus_keyword));
  const title = o.topic_title || o.title;
  const scored = rows.filter((k) => sane(k.keyword, title) && !taken.has(k.keyword)).map((k) => {
    const n = k.keyword.split(' ').length; const vol = k.found && Number(k.search_volume) > 0 ? Math.log10(Number(k.search_volume) + 1) * 8 : 0;
    return { ...k, score: (BONUS[n] ?? 10) + vol - (/['’]/.test(k.keyword) ? 30 : 0) };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]; if (!best || best.id === o.keyword_id) return;
  await db.query('UPDATE content_opportunities SET keyword_id = $2, updated_at = now() WHERE id = $1', [o.id, best.id]);
  say(run, 'check', true, `Odak anahtar kelime seçildi: “${best.keyword}”${best.found && Number(best.search_volume) > 0 ? ` (aylık ~${Number(best.search_volume).toLocaleString('tr-TR')} arama)` : ''}`);
}

async function stepCheck(run, ctx, now) {
  const r = await opportunities.rescore(run.opportunityId, { now });
  const cfg = await config(run.projectId);
  const missing = (r.explain && r.explain.missing) || [];
  const minScore = r.explain && Number.isFinite(Number(r.explain.minScore)) ? Number(r.explain.minScore) : 70;
  const full = r.total !== null && r.total !== undefined && !missing.length;
  // SERP is optional (owner) and so is the volume number on the news lane (switch): what is missing may only be those two; everything else (trend, relevance, source) must be real, and the score of the REAL parts must reach the bar
  const demandOk = !missing.includes('demand') || (cfg.newsFallback && !!(r.explain && r.explain.lane));
  const other = missing.filter((m) => m !== 'demand' && m !== 'competition');
  const bar = Math.min(minScore, 60);
  const why = []; let basis = 'tam puan';
  if (r.status === 'rejected') why.push('Reddedilmiş');
  if (full) { if (!r.eligible) why.push(r.ineligibleReason || 'Fırsat puanı yetersiz'); }
  else if (other.length || !demandOk) why.push('Tam puan çıkmadı (eksik veri ya da kısmi puan geçerli sayılmaz)');
  else if ((r.provisional ?? 0) < bar) why.push(`Eldeki gerçek verilerle ön puan ${r.provisional}, en az ${bar} gerekli`);
  else basis = `${missing.map((m) => (m === 'competition' ? 'SERP' : 'hacim')).join(' ve ')} verisi olmadan, gerçek parçaların puanı`;
  if (!why.length) {
    const scope = await projects.checkTopic(run.projectId, `${r.title} ${r.keyword || ''}`, r.categoryId);
    if (!scope.allowed) why.push(`Kapsam dışı konu (${scope.matched.map((m) => m.topic).join(', ')})`);
  }
  if (why.length) return reject(why.join('; '));
  if (!r.eligible) await db.query("UPDATE content_opportunities SET eligible = true, ineligible_reason = '', updated_at = now() WHERE id = $1", [run.opportunityId]);       // the line's own judgement (like a person's short-list approval) lets the writer take it
  await chooseFocus(run, await idea(run.opportunityId), now);
  const f = await opportunities.get(run.opportunityId);
  say(run, 'check', true, `Uygun (${basis}): ${full ? `fırsat puanı ${r.total}` : `ön puan ${r.provisional}`}, odak anahtar kelime “${f.keyword}”`);
  return go('write');
}

async function stepWrite(run, ctx, now) {
  const o = await idea(run.opportunityId);
  if (!o) return reject('Fikir bulunamadı (silinmiş)');
  if (o.article_id) {
    const ex = (await db.query("SELECT id, status FROM articles WHERE id = $1 AND status NOT IN ('failed', 'archived')", [o.article_id])).rows[0];
    if (ex) { run.articleId = ex.id; return go('fix'); }
  }
  if (o.status === 'queued') {                                                    // a write that was running when the process died (the writer clears it itself at the next start; a person's click may be in flight)
    if (await runs.running('article_writer', run.projectId)) return retryLater('Bu fikir için bir yazım sürüyor');
    await db.query("UPDATE content_opportunities SET status = 'new', updated_at = now() WHERE id = $1", [o.id]);
  }
  const room = await roomFor(run.projectId, 'new_article', now);
  if (room.left <= 0) return wait(tomorrow(now), `Günlük yeni makale sınırı doldu (${room.done}/${room.limit}); yarın devam edilecek`);
  let started;
  try { started = await writer.start(o.id, { manual: false, userId: null, provider: (run.hints && run.hints.provider) || null, notes: (run.hints && run.hints.notes) || '', fetchImpl: ctx.fetchImpl, fetcher: ctx.fetcher, now, background: false }); }
  catch (err) {
    if (err instanceof HttpError && err.status === 409 && !(err.extra && err.extra.limit)) {
      if (/şu anda zaten çalışıyor|şu anda yazılıyor/.test(err.message)) return retryLater(err.message);
      if (/üretime uygun değil|zaten yazıldı|zaten var|odak anahtar kelimesi yok/.test(err.message)) return reject(err.message);
    }
    throw err;
  }
  const wr = await runs.get(started.run.id);
  addCost(run, wr.stats && wr.stats.costUsd); if (wr.stats && wr.stats.unknownCost) run.unknownCost += wr.stats.unknownCost;
  const after = await idea(o.id);
  if (wr.stats && wr.stats.outOfScope) return reject(`Kapsam dışı konu çıktı (${(wr.stats.outOfScope || []).join(', ')}); makale arşivlendi`);
  if (!after.article_id) {
    if (wr.stats && Number(wr.stats.calls) > 0) await limits.release({ workType: 'new_article', projectId: run.projectId, categoryId: o.category_id || null, amount: 1, day: dayKey(now, tz()) });      // paid, but no draft came out: no new article
    const code = wr.stats && wr.stats.code; const text = wr.error || 'Makale yazılamadı';
    if (['funds', 'auth', 'model'].includes(code)) return stop(text);
    if (['budget'].includes(code) || /bütçe/i.test(text)) return wait(tomorrow(now), text);
    if (['rate_limit', 'overloaded', 'timeout', 'network'].includes(code)) { if (run.retries >= WRITE_TRIES) return (await redo(run, `yazım ${WRITE_TRIES + 1} denemede tamamlanamadı: ${text}`, '', now, { noArticle: true })) || reject(`Yazım ${WRITE_TRIES + 1} denemede tamamlanamadı: ${text}`); return retryLater(text); }
    return (await redo(run, `makale yazılamadı: ${text}`, '', now, { noArticle: true })) || reject(`Makale yazılamadı: ${text}`);
  }
  run.articleId = after.article_id; run.hints = { ...(run.hints || {}), placeDay: dayKey(now, tz()) };
  const a = (await db.query('SELECT h1, word_count, quality_score, adsense_risk, status FROM articles WHERE id = $1', [run.articleId])).rows[0];
  say(run, 'write', true, `Makale yazıldı: “${a.h1}” (${a.word_count} kelime, kalite ${a.quality_score === null ? 'ölçülemedi' : a.quality_score}, AdSense riski ${a.adsense_risk || 'ölçülemedi'})`);
  return go('fix');
}

/**
 * Takes the cycle's draft away. Nothing may pile up in the archive (owner): the draft is DELETED (an article that was sent to WordPress cannot be, then it is archived as before). The day's counts (a new article,
 * an AdSense fix round) grow only for what is SHARED: the places the draft used - one new-article place, one fixing place per round that asked the model - go back to the day they were taken on.
 * The status guard makes it happen once per draft.
 */
async function archiveDraft(run) {
  if (!run.articleId) return false;
  const a = (await db.query("SELECT project_id, created_at FROM articles WHERE id = $1 AND status IN ('needs_review', 'fact_checking', 'ready')", [run.articleId])).rows[0];
  if (!a) return false;
  const cat = run.opportunityId ? (await db.query('SELECT category_id FROM content_opportunities WHERE id = $1', [run.opportunityId])).rows[0] : null;
  const day = (run.hints && run.hints.placeDay) || dayKey(a.created_at, tz());               // the day the places were taken on (the day the draft was written)
  const rounds = (await db.query('SELECT count(*)::int n FROM article_fixes WHERE article_id = $1 AND calls > 0', [run.articleId])).rows[0].n;
  try { await articles.remove(run.articleId); }
  catch { await db.query("UPDATE articles SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1 AND status IN ('needs_review', 'fact_checking', 'ready')", [run.articleId]); }
  await limits.release({ workType: 'new_article', projectId: a.project_id, categoryId: (cat && cat.category_id) || null, amount: 1, day });
  if (rounds) await limits.release({ workType: 'article_fix', projectId: a.project_id, amount: rounds, day });
  return true;
}

async function discardArticle(run, reason) {
  if (!run.articleId) return;
  await archiveDraft(run);
  say(run, 'fix', false, `Taslak silindi: ${reason}`);
}

/**
 * The line does not give up on the idea it found (owner: "bulduğun fikir yayınlanana kadar zorla"): before an idea is thrown away the line writes a FRESH draft of the SAME idea, by the other writer when there is one,
 * told what went wrong with every draft before (up to `maxDrafts` drafts per idea, the owner's number). The failed draft is deleted (nothing piles up). Not for what no draft can cure (a topic the site excludes,
 * a duplicate, no sources) and not past the number of drafts.
 * @returns { redo: 'write' } or null (no draft left for this idea / no place left today: the caller throws the idea away)
 */
async function redo(run, why, notes, now, { noArticle = false } = {}) {
  const cfg = await config(run.projectId);
  if (run.rewrites >= cfg.maxDrafts - 1) return null;
  const room = await roomFor(run.projectId, 'new_article', now); if (room.left <= 0) return null;
  const a = run.articleId ? (await db.query('SELECT generation FROM articles WHERE id = $1', [run.articleId])).rows[0] : null;
  const first = (a && a.generation && a.generation.provider) || (run.hints && run.hints.provider) || null;
  const ready = (await llm.available()).filter((v) => v.ready).map((v) => v.key);
  const alt = ready.find((k) => k !== first) || null;
  const earlier = (run.hints && run.hints.notes) || '';
  await archiveDraft(run);
  await db.query("UPDATE content_opportunities SET status = 'new', article_id = NULL, updated_at = now() WHERE id = $1", [run.opportunityId]);
  run.rewrites += 1; run.articleId = null; run.hints = { ...keepOut(run, now), provider: alt, notes: `${why}${notes ? `; ${notes}` : ''}${earlier ? ` || EARLIER DRAFTS FAILED ON: ${earlier}` : ''}`.slice(0, 1600) };
  say(run, run.step, null, `${noArticle ? 'Taslak çıkmadı' : `${run.rewrites}. taslak kontrollerden geçemedi`} (${String(why).slice(0, 160)}). Fikir elenmeden önce yeniden deneniyor (${run.rewrites + 1}/${cfg.maxDrafts}. taslak): ${alt ? `farklı yazar (${alt}), ` : ''}${noArticle ? '' : 'sorunlar yazım talimatına eklendi'}`);
  return { redo: 'write' };
}

/** the approval gate once nothing blocks: ready -> publish; a closed switch or a refusal is said in words */
async function approveOutcome(run, aid) {
  const cur0 = (await db.query('SELECT status FROM articles WHERE id = $1', [aid])).rows[0];
  if (cur0 && ['ready', 'published', 'scheduled'].includes(cur0.status)) { say(run, 'fix', true, 'Makale “Yayına hazır”'); return go('publish'); }          // the fix bot's last pass already approved it
  const ap = await autoApprove.approveIfClean(aid);
  if (ap.approved) { say(run, 'fix', true, 'Tüm kontroller temiz: makale “Yayına hazır” yapıldı'); return go('publish'); }
  if (ap.reason === 'manual') return stop('“Temiz geçen makaleyi kendiliğinden Yayına hazır yap” kapalı: Otomatik Üretim’i yeniden açın');
  if (ap.reason === 'changed') { const cur = (await db.query('SELECT status FROM articles WHERE id = $1', [aid])).rows[0]; if (cur && ['ready', 'published', 'scheduled'].includes(cur.status)) return go('publish'); }
  const why = (ap.problems && ap.problems[0]) || 'onay kapısı geçmedi';
  await discardArticle(run, why); return reject(`Onay kapısı: ${why}`);
}

/**
 * The draft after writing: nothing blocks it -> approve; otherwise the ADSENSE FIX BOT (services/adsenseBot.js) works it over in up to 4 targeted rewrites with all checks re-run each time, so the
 * line is not stopped by the AdSense check, by claims the sources do not carry, by a low quality score or by too few words. What is left after that: the owner's subject-level acceptance, one
 * fresh draft (see redo()), or the idea is dropped.
 */
async function stepFix(run, ctx, now) {
  const aid = run.articleId;
  const a0 = (await db.query('SELECT id, status FROM articles WHERE id = $1', [aid])).rows[0];
  if (!a0 || a0.status === 'archived') return reject('Makale bulunamadı ya da arşive alınmış');
  if (['ready', 'published', 'scheduled'].includes(a0.status)) return go('publish');
  const blocking = async () => (await articles.readiness(aid)).problems.filter((p) => p.blocking);
  let left = await blocking();
  if (!left.length) return approveOutcome(run, aid);
  const cfg = await config(run.projectId);
  say(run, 'fix', null, `Eksik var (${left.map((p) => p.message).join('; ')}); Düzeltme Botu devrede (en çok ${adsenseBot.ROUNDS} tur)`);
  const bot = await adsenseBot.clear(aid, { projectId: run.projectId, editSubject: cfg.acceptSubjectWarning, fetchImpl: ctx.fetchImpl, now });
  run.costUsd = Math.round((run.costUsd + bot.costUsd) * 1e6) / 1e6; run.unknownCost += bot.unknownCost;
  const r = bot.last;
  if (r && r.result === 'needs_person') {
    // only the AdSense class "inceleme gerekli" caused by the SUBJECT is left (the text was made neutral): the owner decided the line accepts it itself. "Yayınlanamaz" and every other person-only problem (a topic the site excludes, a duplicate, no sources) are never accepted.
    const art = (await db.query('SELECT adsense_risk FROM articles WHERE id = $1', [aid])).rows[0];
    const subjectOnly = (r.remaining || []).length > 0 && r.remaining.every((p) => p.code === 'adsense_risk') && !!art && art.adsense_risk === 'review';
    if (cfg.acceptSubjectWarning && subjectOnly) {
      const acc = await articles.acceptAdsense(aid, { accept: true, approve: true, note: 'Otomatik Üretim: sahibinin izniyle kabul edildi (konu kaynaklı hassas içerik uyarısı; metin nötrleştirildi)' });
      await audit.audit(null, { action: 'article.adsense_accept_auto', entity: 'article', entityId: aid, before: { adsenseRisk: 'review' }, after: { acceptedBy: 'pipeline', approved: acc.approved, reason: acc.reason } });
      if (acc.approved) { say(run, 'fix', true, 'Metin nötrleştirildi; konu kaynaklı AdSense uyarısı sahibin izniyle hat tarafından kabul edildi ve makale “Yayına hazır” yapıldı'); return go('publish'); }
      await discardArticle(run, acc.reason || 'onay kapısı geçmedi'); return reject(`AdSense uyarısı kabul edildi ama makale onaylanamadı: ${acc.reason}`);
    }
    // the idea itself (or the owner's choice to keep the subject-level warning for a person): no new draft can cure it; anything else (a "blocked" class from the TEXT ...) gets one fresh draft first
    const ideaProblem = (r.remaining || []).some((p) => fixer.PERSON.has(p.code)) || subjectOnly;
    if (!ideaProblem) { const again = await redo(run, r.message, '', now); if (again) return again; }
    await discardArticle(run, r.message); return reject(`Bir kişinin kararı gerekiyor, otomatik çözülemez: ${r.message}`);
  }
  if (r && r.result === 'skipped') { const again = await redo(run, r.message, '', now); if (again) return again; await discardArticle(run, r.message); return reject(r.message); }
  left = await blocking();
  if (!left.length) { say(run, 'fix', true, `Düzeltme Botu ${bot.rounds} turda eksikleri giderdi`); return approveOutcome(run, aid); }
  const why = `Düzeltme Botu ${bot.rounds} turdan sonra eksik kaldı: ${left.map((p) => p.message).join('; ')}`;
  const again = await redo(run, why, '', now); if (again) return again;
  await discardArticle(run, left[0].message); return reject(why);
}

async function stepPublish(run, ctx, now) {
  const site = await pickSite(run.projectId);
  if (!site) return stop('Yayın için etkin bir WordPress sitesi yok');
  const a = (await db.query('SELECT id, status, h1, word_count, quality_score FROM articles WHERE id = $1', [run.articleId])).rows[0];
  if (!a) return stop('Yayınlanacak makale bulunamadı');
  let pub = (await db.query('SELECT * FROM publications WHERE article_id = $1 AND site_id = $2', [a.id, site.id])).rows[0];
  if (pub && pub.status === 'published') { run.publicationId = pub.id; run.result = { title: a.h1, url: pub.wp_url, words: a.word_count, qualityScore: a.quality_score }; return go('cleanup'); }
  if (a.status === 'needs_review') { const ap = await autoApprove.approveIfClean(a.id); if (!ap.approved) return stop(`Makale “Yayına hazır” değil: ${(ap.problems && ap.problems[0]) || ap.reason}`); }
  if (pub && pub.status === 'sending') return retryLater('Yayın şu anda gönderiliyor');
  if (!pub || pub.status !== 'pending') {                                         // (a "pending" row was prepared before a crash: it only has to be sent)
    try { pub = await publishing.prepare(a.id, site.id, { mode: 'publish', manual: false, now }); }
    catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        if ((err.extra && err.extra.limit) || /günlük yayın limiti/.test(err.message)) return wait(tomorrow(now), err.message);
        if (/şu anda gönderiliyor/.test(err.message)) return retryLater(err.message);
        if (/Yayına hazır|hazır değil/.test(err.message)) return stop(`Makale onaylandıktan sonra yayına hazır görünmüyor: ${err.message}`);
      }
      throw err;
    }
  }
  const pubId = pub.id; run.publicationId = pubId;
  let sent;
  try { sent = await publishing.send(pubId, { request: ctx.wpRequest, fetchBinary: ctx.fetchBinary }); }
  catch (err) {
    if (err.retryable === false || err.fatal) return stop(`WordPress yayını başarısız: ${err.message}`);
    return retryLater(`WordPress yayını başarısız: ${err.message}`);
  }
  if (sent.status !== 'published') return stop(`WordPress yazıyı yayımlamadı (durum: ${sent.status}${sent.lastError ? `, ${sent.lastError}` : ''})`);
  run.result = { title: a.h1, url: sent.wpUrl, words: a.word_count, qualityScore: a.quality_score };
  say(run, 'publish', true, `Yayımlandı: ${sent.wpUrl || site.name}`);
  return go('cleanup');
}

// ── the clean-up: what the day's research left behind ─────────────────────────────────────────────────────────────────────────────────
/**
 * Removes the research of the cycle: every idea found from the news (except one on a person's short list or being written by somebody else, and ideas a person typed in), every
 * keyword the system found with its volume data and SERP analyses, and closes the leftover topics so the same events are not turned into ideas again. KEPT: the articles (with their own
 * copy of the sources), the news items and events (the news scan must not treat the same item as new), costs, logs, settings, niche suggestions, anything typed in by a person.
 * Irreversible; the content database has no backup of its own.
 */
async function cleanLeftovers(projectId, now) {
  return db.tx(async (c) => {
    const ideas = (await c.query(`DELETE FROM content_opportunities o USING topics t WHERE o.topic_id = t.id AND o.project_id = $1 AND t.origin = 'news' AND o.status NOT IN ('shortlisted', 'queued')`, [projectId])).rowCount;
    const closed = (await c.query(`UPDATE topics t SET status = 'used' WHERE t.project_id = $1 AND t.origin = 'news' AND t.status IN ('new', 'rejected')
      AND NOT EXISTS (SELECT 1 FROM content_opportunities o WHERE o.topic_id = t.id AND o.status IN ('shortlisted', 'queued'))`, [projectId])).rowCount;
    const kws = (await c.query(`DELETE FROM keywords k WHERE k.project_id = $1 AND k.origin <> 'manual' AND NOT EXISTS (SELECT 1 FROM content_opportunities o WHERE o.keyword_id = k.id)`, [projectId])).rowCount;
    const out = { usedIdeas: ideas, staleIdeas: 0, keywords: kws, nicheSuggestions: 0, nicheParts: { undecided: 0, later: 0, rejected: 0 }, closedTopics: closed };
    await c.query('INSERT INTO cleanup_log (project_id, trigger, counts, ran_at) VALUES ($1,$2,$3,$4)', [projectId, 'pipeline', JSON.stringify(out), now]);
    return out;
  });
}

async function stepCleanup(run, ctx, now) {
  let cleaned = null;
  try { cleaned = await cleanLeftovers(run.projectId, now); run.opportunityId = null; say(run, 'cleanup', true, `Araştırma artıkları silindi: ${cleaned.usedIdeas} fikir, ${cleaned.keywords} anahtar kelime (ve verileri), ${cleaned.closedTopics} konu kapatıldı`); }
  catch (err) { say(run, 'cleanup', false, `Temizlik yapılamadı (makale yayında, sonraki döngüde yeniden denenir): ${String(err.message).slice(0, 160)}`); }
  const cat = run.categoryId ? (await db.query('SELECT name_en FROM categories WHERE id = $1', [run.categoryId])).rows[0] : null;
  run.result = { ...(run.result || {}), categoryName: cat ? cat.name_en : null, attempts: run.attempt, cleanup: cleaned };
  return { done: true };
}

const STEP_FN = { idea: stepIdea, keyword: stepKeyword, serp: stepSerp, check: stepCheck, write: stepWrite, fix: stepFix, publish: stepPublish, cleanup: stepCleanup };
/** the steps in which a failure belongs to the IDEA (the next idea may work); the others are about the article or the services around it */
const IDEA_LEVEL = new Set(['idea', 'keyword', 'serp', 'check', 'write', 'fix']);

/**
 * Takes the idea (and what its research cost: the keywords the system found for it, their volumes and SERP analyses) out of the research pages AT ONCE, and closes its topic ("used": a topic left
 * "rejected" would be turned into a new idea row by the next re-scoring). Used for an idea that did not make it; the one that did is taken away by the clean-up after publishing.
 */
async function dropIdea(o) {
  await db.tx(async (c) => {
    await c.query("DELETE FROM keywords k WHERE k.topic_id = $1 AND k.origin <> 'manual' AND NOT EXISTS (SELECT 1 FROM content_opportunities x WHERE x.keyword_id = k.id AND x.id <> $2)", [o.topic_id, o.id]);
    await c.query('DELETE FROM content_opportunities WHERE id = $1', [o.id]);
    await c.query("UPDATE topics SET status = 'used' WHERE id = $1", [o.topic_id]);
  });
}

/** throws the current idea away: the idea and its research are deleted from the research pages, its draft (if any) is archived, and the cycle goes back to the first step with the next idea */
async function rejectIdea(run, reason, now) {
  say(run, run.step, false, `Fikir elendi: ${reason}`);
  if (run.opportunityId) { const o = await idea(run.opportunityId); if (o) await dropIdea(o); }
  run.opportunityId = null; run.articleId = null; run.publicationId = null; run.attempt += 1; run.rewrites = 0; run.hints = keepOut(run, now); moveTo(run, 'idea', now);
}

async function notifyStop(run, reason) {
  await notifications.create({ type: 'pipeline_stopped', severity: 'warning', title: 'Otomatik üretim durdu: sorun giderilince kendiliğinden devam eder', body: `${reason} (adım: ${LABEL[run.step]})`, data: { runId: run.id } });
}

/** applies what a step answered to the in-memory run; returns true when the cycle goes on in this job */
async function apply(run, out, now, resumedFromStop) {
  if (out.go) { if (!out.quiet) say(run, run.step, true, `${LABEL[run.step]}: tamam`); moveTo(run, out.go, now); return true; }
  if (out.redo) { moveTo(run, out.redo, now); return true; }                                              // a fresh draft of the SAME idea (see redo())
  if (out.reject) { await rejectIdea(run, out.reject, now); if (run.attempt > RUNAWAY) { run.status = 'stopped'; run.note = `${RUNAWAY} fikir denendi ve hiçbiri sonuçlanmadı; bir sorun olabilir, durumu inceleyin`; await notifyStop(run, run.note); return false; } return true; }
  if (out.wait) { run.status = 'waiting'; run.waitUntil = out.wait.until; run.note = out.wait.reason; say(run, run.step, null, `Bekleniyor: ${out.wait.reason}`); return false; }
  if (out.retry) {
    run.retries += 1;
    if (run.retries > MAX_RETRIES) { run.status = 'stopped'; run.note = `${out.retry} (${MAX_RETRIES} kez denendi)`; say(run, run.step, false, run.note); if (!resumedFromStop) await notifyStop(run, run.note); return false; }
    run.status = 'waiting'; run.waitUntil = inMinutes(now, RETRY_MIN); run.note = `${out.retry} — ${RETRY_MIN} dk sonra yeniden denenecek (${run.retries}/${MAX_RETRIES})`; say(run, run.step, null, run.note); return false;
  }
  if (out.stop) { const same = resumedFromStop && run.note === out.stop; run.status = 'stopped'; run.note = out.stop; if (!same) say(run, run.step, false, `Durdu: ${out.stop}`); if (!same) await notifyStop(run, out.stop); return false; }
  if (out.done) {
    run.status = 'done'; run.finishedAt = now; run.waitUntil = null; run.note = '';
    say(run, 'cleanup', true, 'Döngü tamamlandı');
    await notifications.create({ type: 'pipeline_published', severity: 'info', title: `Yeni makale yayımlandı: ${String((run.result && run.result.title) || '').slice(0, 100)}`,
      body: `${run.result && run.result.url ? `${run.result.url}\n` : ''}${run.result && run.result.categoryName ? `Kategori: ${run.result.categoryName}. ` : ''}${run.attempt} fikir denendi. Maliyet: ${run.costUsd ? `$${run.costUsd.toFixed(2)}` : 'bilinmiyor'}${run.unknownCost ? ` (+${run.unknownCost} fiyatı bilinmeyen çağrı)` : ''}.`, data: { runId: run.id, articleId: run.articleId } });
    return false;
  }
  return false;
}

/**
 * The job handler: works on the project's open cycle until it ends, has to wait, stops, or this job's time (JOB_MS) is used up (the next tick continues it).
 * @param ctx { now, fetchImpl, fetcher, newsFetch, gapMs, wpRequest, fetchBinary, budgetMs } (the seams of the tests)
 */
async function work(projectId, ctx = {}) {
  const now = ctx.now || new Date();
  const deadline = Date.now() + (ctx.budgetMs || JOB_MS);
  if ((await settings.get('bots')).value.paused) return { status: 'skipped', message: 'Botlar duraklatıldı' };
  if (!(await isOn(projectId))) return { status: 'skipped', message: 'Otomatik üretim kapalı' };
  const run = await openRun(projectId);
  if (!run) return { status: 'skipped', message: 'Açık bir üretim döngüsü yok' };
  if (run.status === 'waiting' && run.waitUntil && new Date(run.waitUntil) > now) return { status: 'skipped', message: run.note };
  const resumedFromStop = run.status === 'stopped';
  run.status = 'running'; run.waitUntil = null; await persist(run, now);
  let steps = 0;
  try {
  while (run.status === 'running' && Date.now() < deadline && steps < 60) {
    steps++;
    const stepNow = run.step;
    let out;
    try { out = await STEP_FN[stepNow](run, ctx, now); }
    catch (err) {
      const k = classify(err, now);
      if (k.unknown) {
        if (IDEA_LEVEL.has(stepNow) && (run.opportunityId || stepNow === 'idea')) out = stepNow === 'idea' ? stop(`Beklenmeyen hata: ${k.unknown}`) : reject(`Beklenmeyen hata: ${k.unknown}`);
        else if (stepNow === 'cleanup') out = { done: true };
        else out = stop(`Beklenmeyen hata: ${k.unknown}`);
      } else out = k;
    }
    const goOn = await apply(run, out, now, resumedFromStop);
    await persist(run, now);
    if (!goOn) break;
    if (await isOn(projectId) === false) break;
  }
  } catch (err) {                                                                         // not a step's own failure (those are answered above): the database itself, a bug. The cycle stops, once, with the reason.
    run.status = 'stopped'; run.note = `Beklenmeyen hata: ${String(err.message).slice(0, 200)}`;
    try { say(run, run.step, false, run.note); await persist(run, now); if (!resumedFromStop) await notifyStop(run, run.note); } catch { /* the database is gone: the next tick looks again */ }
  }
  const final = await get(run.id);
  return { status: final.status === 'done' ? 'ok' : (final.status === 'running' ? 'partial' : 'ok'), stats: { runId: final.id, step: final.step, state: final.status, attempt: final.attempt, costUsd: final.costUsd },
    message: final.status === 'done' ? `Makale yayımlandı: ${final.result && final.result.title}` : (final.note || `${LABEL[final.step]}`) };
}

// ── the clock: starting cycles, picking up waiting ones ───────────────────────────────────────────────────────────────────────────────────
/** @returns { enqueued: [{ bot, projectId, jobId }], started: [runId] } */
async function tick({ now = new Date() } = {}) {
  const out = { enqueued: [], started: [] };
  if ((await settings.get('bots')).value.paused) return out;
  const ps = (await db.query("SELECT id FROM content_projects WHERE status = 'active' ORDER BY created_at")).rows;
  for (const p of ps) {
    const cfg = await config(p.id);
    if (!cfg.enabled) continue;
    let run = await openRun(p.id);
    if (!run) {
      const last = await lastRun(p.id);
      if (last && now.getTime() < new Date(last.startedAt).getTime() + cfg.everyMinutes * 60000) continue;
      try { run = await create(p.id, 'schedule', now); out.started.push(run.id); } catch (err) { if (err.code === '23505') continue; throw err; }
    } else if (run.status === 'waiting' && run.waitUntil && new Date(run.waitUntil) > now) continue;
    else if (run.status === 'stopped' && now.getTime() - new Date(run.updatedAt).getTime() < STOP_RETRY_MIN * 60000) continue;
    const q = await queue.enqueue({ botKey: BOT, projectId: p.id, trigger: 'schedule', dedupeKey: `${BOT}:${p.id}`, runAfter: now, maxAttempts: 1 });
    if (!q.duplicate) out.enqueued.push({ bot: BOT, projectId: p.id, jobId: q.job.id });
  }
  return out;
}

/** "Şimdi başlat": a new cycle at once, or a waiting / stopped one is told to look again now */
async function start(projectId, { userId = null, now = new Date() } = {}) {
  const pid = V.uuid(projectId, 'Proje'); await projects.getProject(pid);
  if (!(await isOn(pid))) throw new HttpError(409, 'Önce Otomatik Üretim’i açın');
  let run = await openRun(pid);
  if (run && run.status === 'running') {
    const q = await queue.enqueue({ botKey: BOT, projectId: pid, trigger: 'manual', dedupeKey: `${BOT}:${pid}`, runAfter: now, maxAttempts: 1, userId });
    if (q.duplicate) throw new HttpError(409, 'Bir üretim döngüsü zaten sürüyor');
    return overview(pid);
  }
  if (run) { run.status = 'running'; run.waitUntil = null; run.retries = 0; run.note = ''; await persist(run, now); }
  else run = await create(pid, 'manual', now);
  const q = await queue.enqueue({ botKey: BOT, projectId: pid, trigger: 'manual', dedupeKey: `${BOT}:${pid}`, runAfter: now, maxAttempts: 1, userId });
  if (q.duplicate) throw new HttpError(409, 'Bir üretim döngüsü zaten sürüyor');
  return overview(pid);
}

/** gives up the open cycle (its idea and draft are left as they are for a person to see) */
async function cancel(projectId, { now = new Date() } = {}) {
  const run = await openRun(V.uuid(projectId, 'Proje'));
  if (!run) throw new HttpError(409, 'Açık bir üretim döngüsü yok');
  run.status = 'cancelled'; run.finishedAt = now; run.note = 'Elle bırakıldı'; say(run, run.step, false, 'Döngü elle bırakıldı');
  await persist(run, now);
  return overview(projectId);
}

// ── what the panel shows ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const seconds = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 1000) : null);

async function overview(projectId, { now = new Date() } = {}) {
  const pid = V.uuid(projectId, 'Proje'); await projects.getProject(pid);
  const cfg = await config(pid);
  const [pre, run, last, cats, lim, cleanedLast] = await Promise.all([prerequisites(pid), openRun(pid), lastRun(pid), activeCategories(pid), limits.status({ projectId: pid, now }),
    db.query("SELECT counts, ran_at FROM cleanup_log WHERE project_id = $1 AND trigger = 'pipeline' ORDER BY ran_at DESC LIMIT 1", [pid])]);
  const cur = run ? {
    ...run, stepLabel: LABEL[run.step],
    steps: STEPS.map((k, i) => ({ key: k, label: LABEL[k], state: i < STEPS.indexOf(run.step) ? 'done' : (i === STEPS.indexOf(run.step) ? (run.status === 'running' ? 'now' : run.status) : 'todo') })),
    categoryName: null, idea: null, article: null,
  } : null;
  if (cur) {
    const c = cats.find((x) => x.id === cur.categoryId); cur.categoryName = c ? c.name_en : null;
    if (cur.opportunityId) { const o = await idea(cur.opportunityId); if (o) cur.idea = { id: o.id, title: o.title, keyword: o.keyword || null, provisional: o.provisional_score, total: o.total_score }; }
    if (cur.articleId) { const a = (await db.query('SELECT id, h1, status, word_count, quality_score FROM articles WHERE id = $1', [cur.articleId])).rows[0]; if (a) cur.article = { id: a.id, title: a.h1, status: a.status, words: a.word_count, quality: a.quality_score }; }
  }
  const recent = (await db.query("SELECT * FROM pipeline_runs WHERE project_id = $1 AND status IN ('done', 'cancelled') ORDER BY started_at DESC LIMIT 8", [pid])).rows.map(shape).map((r) => ({
    id: r.id, status: r.status, title: r.result && r.result.title, url: r.result && r.result.url, categoryName: r.result && r.result.categoryName, attempts: r.attempt, costUsd: r.costUsd, unknownCost: r.unknownCost,
    startedAt: r.startedAt, finishedAt: r.finishedAt, seconds: seconds(r.startedAt, r.finishedAt), trigger: r.trigger }));
  let next = null;
  if (cfg.enabled && !run) {
    const at = last ? new Date(Math.max(new Date(last.startedAt).getTime() + cfg.everyMinutes * 60000, now.getTime())) : now;
    const after = await lastDoneCategory(pid); const nc = nextCategory(cats, after, []);
    next = { at, categoryName: nc ? nc.name_en : null };
  }
  const item = (t) => lim.items.find((i) => i.workType === t);
  const today = (await db.query("SELECT count(*)::int n, COALESCE(sum(cost_usd), 0) AS usd FROM pipeline_runs WHERE project_id = $1 AND status = 'done' AND finished_at >= $2", [pid, startOfLocalDay(dayKey(now, tz()), tz())])).rows[0];
  const cycles = Math.ceil(1440 / cfg.everyMinutes);
  const warnings = [];
  if ((await settings.get('bots')).value.paused) warnings.push({ kind: 'bad', text: 'Botlar duraklatılmış durumda; hiçbir otomatik iş (bu hat dahil) çalışmaz.', to: '/automation?tab=botlar' });
  if (cfg.enabled && cycles >= 4) warnings.push({ kind: 'warn', text: `Günde ${cycles} makale yeni bir alan adı için hızlı bir tempo: Google ve AdSense az sayıda iyi yazıyı çok sayıda yazıdan daha olumlu değerlendirir. Günde 1-2 önerilir.` });
  if (cfg.enabled && item('new_article').limit < cycles) warnings.push({ kind: 'warn', text: `Günlük yeni makale sınırı (${item('new_article').limit}) bu tempodan düşük; hat sınır dolunca ertesi güne bekler.` });
  return { projectId: pid, enabled: cfg.enabled, everyMinutes: cfg.everyMinutes, newsFallback: cfg.newsFallback, acceptSubjectWarning: cfg.acceptSubjectWarning, minWords: cfg.minWords, maxDrafts: cfg.maxDrafts, adsenseCheck: cfg.adsenseCheck, frequencies: FREQUENCIES.map(([minutes, label]) => ({ minutes, label })), cyclesPerDay: cycles, prerequisites: { ok: pre.ok, items: pre.items },
    current: cur, next, recent, today: { published: today.n, costUsd: Number(today.usd), articles: { done: item('new_article').done, limit: item('new_article').limit }, publishes: { done: item('publish').done, limit: item('publish').limit } },
    lastCleanup: cleanedLast.rows[0] ? { counts: cleanedLast.rows[0].counts, ranAt: cleanedLast.rows[0].ran_at } : null, warnings, steps: STEPS.map((k) => ({ key: k, label: LABEL[k] })),
    schedulerRunning: !!require('./scheduler').status().running, ownedBots: [...require('./scheduler').PIPELINE_OWNED] };
}

module.exports = { BOT, STEPS, LABEL, FREQUENCIES, JOB_MS, HARD, sane, apifyFreeLimit, config, isOn, prerequisites, setConfig, ensureRoom, nextCategory, tomorrow, classify, cleanLeftovers, tick, work, start, cancel, overview, get, openRun };
void bad;
