const db = require('../db');
const V = require('../lib/validate');
const { isValidTimezone } = require('../lib/time');
const { bad } = require('../lib/http');

/**
 * Automation settings, one JSON document per GROUP, for the whole platform ("global") and optionally overridden for one project ("project").
 * Everything is validated on the way in (ranges, allowed values) and merged over the defaults on the way out, so a missing row means "default".
 * The mandatory safety checks (fact check, AdSense risk check, duplicate check) are forced ON here: no screen and no request can switch them off.
 */
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const INTERVALS = [0, 30, 60, 120, 360, 720, 1440];              // minutes; 0 = manual only
const countries = (v, label) => V.strList(v, label, { maxItems: 12, maxLen: 2 }).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
const usd = (v, label) => (v === null || v === undefined || v === '' ? null : (() => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1000000) throw bad(`${label} 0 ile 1.000.000 arasında bir tutar (USD) olmalı`); return Math.round(n * 100) / 100; })());

const GROUPS = {
  news: {
    projectOverride: true,
    defaults: { enabled: true, intervalMinutes: 120, countries: ['US'], sources: [], maxAgeHours: 72, minRelevance: 35, maxItemsPerSource: 60 },
    validate: (v) => ({ enabled: V.bool(v.enabled, 'Haber tarama', true), intervalMinutes: V.oneOf(Number(v.intervalMinutes), 'Tarama sıklığı', INTERVALS, { fallback: 120 }), countries: countries(v.countries, 'Hedef ülkeler'), sources: V.strList(v.sources, 'Kaynaklar', { maxItems: 100, maxLen: 300 }),
      maxAgeHours: V.int(v.maxAgeHours, 'En eski haber (saat)', { min: 1, max: 720 }), minRelevance: V.int(v.minRelevance, 'Minimum nişe uygunluk puanı', { min: 0, max: 100 }), maxItemsPerSource: V.int(v.maxItemsPerSource, 'Kaynak başına en çok haber', { min: 5, max: 100 }) }),
  },
  seo: {
    projectOverride: true,
    defaults: { enabled: true, minVolume: 50, minOpportunityScore: 70, countries: ['US'], cacheDays: 30, serpDevice: 'desktop', serpProvider: 'serper', partialWithApproval: true },
    validate: (v) => ({ enabled: V.bool(v.enabled, 'SEO botu', true), minVolume: V.int(v.minVolume, 'Minimum aranma hacmi', { min: 0, max: 1000000 }), minOpportunityScore: V.int(v.minOpportunityScore, 'Minimum fırsat puanı', { min: 0, max: 100 }),
      countries: countries(v.countries, 'Hedef ülkeler'), cacheDays: V.int(v.cacheDays, 'API önbellek süresi (gün)', { min: 1, max: 180 }), serpDevice: V.oneOf(v.serpDevice, 'SERP cihazı', ['desktop', 'mobile'], { fallback: 'desktop' }),
      serpProvider: V.oneOf(v.serpProvider, 'SERP veri kaynağı', ['serper', 'dataforseo'], { fallback: 'serper' }), partialWithApproval: V.bool(v.partialWithApproval, 'Hacim verisi yokken onayla kısmi puan', true) }),
  },
  quality: {
    projectOverride: true,
    defaults: { minScore: 85, factCheck: true, adsenseCheck: true, duplicateCheck: true, lengthPref: 'standard', tone: 'Clear, neutral and practical American English', language: 'en-US', manualApprovalNewArticles: true },
    validate: (v) => ({
      minScore: V.int(v.minScore, 'Minimum kalite puanı', { min: 50, max: 100 }),
      factCheck: true, adsenseCheck: true, duplicateCheck: true,                                   // mandatory: forced on, whatever was sent
      lengthPref: V.oneOf(v.lengthPref, 'Makale uzunluğu', ['short', 'standard', 'long'], { fallback: 'standard' }),
      tone: V.str(v.tone, 'Yazım tonu', { max: 300 }), language: V.str(v.language || 'en-US', 'Varsayılan dil', { required: true, max: 10 }),
      manualApprovalNewArticles: V.bool(v.manualApprovalNewArticles, 'Yeni makaleler için manuel yayın onayı', true),
    }),
  },
  publishing: {
    projectOverride: true,
    defaults: { autoPublish: false, mode: 'draft', windowStart: '09:00', windowEnd: '21:00', timezone: 'Europe/Istanbul', weekends: false, siteId: null },
    validate: (v) => {
      const timezone = V.str(v.timezone || 'Europe/Istanbul', 'Saat dilimi', { max: 60 });
      if (!isValidTimezone(timezone)) throw bad('Saat dilimi geçersiz (ör. Europe/Istanbul)');
      const hm = (x, l) => { const s = V.str(x, l, { required: true, max: 5 }); if (!HM.test(s)) throw bad(`${l} SS:DD biçiminde olmalı (ör. 09:00)`); return s; };
      return { autoPublish: V.bool(v.autoPublish, 'WordPress otomatik yayın', false), mode: V.oneOf(v.mode, 'Yayın şekli', ['draft', 'publish'], { fallback: 'draft' }),
        windowStart: hm(v.windowStart || '09:00', 'Yayın saat aralığı başlangıcı'), windowEnd: hm(v.windowEnd || '21:00', 'Yayın saat aralığı bitişi'), timezone, weekends: V.bool(v.weekends, 'Hafta sonu yayınlama', false), siteId: v.siteId ? V.uuid(v.siteId, 'Site') : null };
    },
  },
  update: {
    projectOverride: true,
    defaults: { policy: 'low_risk_auto', intervalDays: { breaking: 1, currentTech: 7, aiTools: 10, guides: 21, comparisons: 30, evergreen: 75 } },
    validate: (v) => {
      const d = v.intervalDays || {};
      const day = (k, l, min, max) => V.int(d[k], `${l} (gün)`, { min, max });
      return { policy: V.oneOf(v.policy, 'Güncelleme onay politikası', ['manual', 'minor_auto', 'low_risk_auto'], { fallback: 'low_risk_auto' }),
        intervalDays: { breaking: day('breaking', 'Son dakika haberleri', 1, 7), currentTech: day('currentTech', 'Güncel teknoloji haberleri', 1, 60), aiTools: day('aiTools', 'AI araçları', 1, 90),
          guides: day('guides', 'Yazılım rehberleri', 1, 180), comparisons: day('comparisons', 'Karşılaştırmalar', 1, 180), evergreen: day('evergreen', 'Evergreen içerikler', 7, 365) } };
    },
  },
  scoring: {
    projectOverride: true,
    defaults: { trend: 30, competition: 25, demand: 20, relevance: 15, source: 10 },
    validate: (v) => {
      const w = { trend: V.int(v.trend, 'Trend yükselişi', { min: 0, max: 100 }), competition: V.int(v.competition, 'Organik rekabet fırsatı', { min: 0, max: 100 }), demand: V.int(v.demand, 'Aranma talebi', { min: 0, max: 100 }),
        relevance: V.int(v.relevance, 'Nişe uygunluk', { min: 0, max: 100 }), source: V.int(v.source, 'Kaynak güvenilirliği', { min: 0, max: 100 }) };
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      if (sum !== 100) throw bad(`Puanlama ağırlıklarının toplamı 100 olmalı (şu an ${sum})`);
      return w;
    },
  },
  budget: {
    projectOverride: false,
    defaults: { dailyTotalUsd: null, monthlyTotalUsd: null },
    validate: (v) => ({ dailyTotalUsd: usd(v.dailyTotalUsd, 'Günlük toplam bütçe'), monthlyTotalUsd: usd(v.monthlyTotalUsd, 'Aylık toplam bütçe') }),
  },
  bots: {
    projectOverride: false,
    defaults: { paused: false, pausedAt: null, pausedBy: null },
    validate: (v) => ({ paused: V.bool(v.paused, 'Botlar duraklatıldı', false), pausedAt: v.pausedAt || null, pausedBy: v.pausedBy || null }),
  },
  setup: {
    projectOverride: false,
    defaults: { completed: false, step: 1, archiveMode: true },
    validate: (v) => ({ completed: V.bool(v.completed, 'Kurulum tamamlandı', false), step: V.int(v.step, 'Adım', { min: 1, max: 16 }), archiveMode: V.bool(v.archiveMode, 'Arşiv modu', true) }),
  },
};

const GROUP_KEYS = Object.keys(GROUPS);
const clone = (o) => JSON.parse(JSON.stringify(o));

function assertGroup(group) { if (!GROUPS[group]) throw bad(`Bilinmeyen ayar grubu: ${group}`); return GROUPS[group]; }

/** Validates and normalises one group; unknown keys are dropped, missing ones take the default. */
function validateGroup(group, value) {
  const g = assertGroup(group);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw bad('Ayar değeri bir nesne olmalı');
  return g.validate({ ...clone(g.defaults), ...value });
}

async function rows(scope, projectId) {
  const r = await db.query('SELECT key, value, updated_at FROM automation_settings WHERE scope = $1 AND project_id IS NOT DISTINCT FROM $2', [scope, projectId || null]);
  return new Map(r.rows.map((x) => [x.key, x]));
}

/** The settings in force: defaults < global row < (project row). */
async function get(group, projectId = null) {
  const g = assertGroup(group);
  const glob = (await rows('global', null)).get(group);
  const proj = projectId && g.projectOverride ? (await rows('project', projectId)).get(group) : null;
  return { value: validateGroup(group, { ...clone(g.defaults), ...(glob ? glob.value : {}), ...(proj ? proj.value : {}) }), isDefault: !glob && !proj, overriddenForProject: !!proj };
}

async function getAll(projectId = null) {
  const out = {};
  for (const k of GROUP_KEYS) { const r = await get(k, projectId); out[k] = { ...r, projectOverride: GROUPS[k].projectOverride }; }
  return out;
}

async function set(group, value, { scope = 'global', projectId = null, userId = null } = {}) {
  const g = assertGroup(group);
  if (scope === 'project' && !g.projectOverride) throw bad('Bu ayar yalnızca genel olarak yönetilir');
  if (scope === 'project' && !projectId) throw bad('Proje seçilmedi');
  const clean = validateGroup(group, value);
  await db.query(`INSERT INTO automation_settings (scope, project_id, key, value, updated_by) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [scope, scope === 'project' ? projectId : null, group, JSON.stringify(clean), userId]);
  return clean;
}

/** Back to the defaults: removes the saved row(s) of one group (or of every group). */
async function reset(group = null, { scope = 'global', projectId = null } = {}) {
  if (group) assertGroup(group);
  const r = await db.query(`DELETE FROM automation_settings WHERE scope = $1 AND project_id IS NOT DISTINCT FROM $2 ${group ? 'AND key = $3' : "AND key <> 'setup' AND key <> 'bots'"}`, group ? [scope, projectId || null, group] : [scope, projectId || null]);
  return r.rowCount;
}

module.exports = { GROUPS, GROUP_KEYS, validateGroup, get, getAll, set, reset, INTERVALS };
