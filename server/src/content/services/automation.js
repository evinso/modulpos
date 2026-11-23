const db = require('../db');
const V = require('../lib/validate');
const { bad, HttpError } = require('../lib/http');
const settings = require('./settings');
const limits = require('./limits');
const providers = require('./providers');
const llm = require('./llm');
const sites = require('./sites');
const scheduler = require('./scheduler');
const projects = require('./projects');
const telegram = require('./telegram');

/**
 * "Otomasyon Modu": ONE page that turns the platform's own switches into three understandable modes and a list of checkboxes.
 *
 * It has NO state of its own. Every checkbox is read from, and written to, the settings that already exist and that the other pages edit too
 * (bot schedules, publishing.*, quality.*, budget, daily limits), so this page can never disagree with Bot Yönetimi or Ayarlar:
 *   mode      = derived by comparing the checkboxes with what each mode would switch on (anything else is "Özel")
 *   checkbox  = a bot's schedule is enabled / publishing.autoPublish / publishing.mode / quality.manualApprovalNewArticles
 *
 * Honesty rules: an option whose prerequisite is missing (no model key, no tested WordPress site ...) is never switched on silently: a preset skips it and
 * says so, an explicit choice is refused with the reason. The two switches that remove the human from the loop (auto-approval, publishing live) need an
 * explicit confirmation. Auto-approval adds no rule of its own: see services/autoApprove.js (it uses articles.readiness(), the same gate a person's approval uses).
 */
const GROUPS = [
  { key: 'research', label: 'Araştırma' }, { key: 'writing', label: 'Yazım ve onay' }, { key: 'publishing', label: 'Yayın' }, { key: 'upkeep', label: 'Bakım, izleme ve raporlar' },
];

const OPTIONS = [
  { key: 'news', group: 'research', bot: 'news_discovery', label: 'Haber taraması', help: 'Dünya gündemini düzenli tarar, nişe uyanları seçer. Ücretsiz.' },
  { key: 'opportunities', group: 'research', bot: 'content_opportunity', label: 'Fırsat puanlama', help: 'Haberlerden ve verilerden içerik fırsatlarını puanlar. Ücretsiz.' },
  { key: 'niche', group: 'research', bot: 'niche_discovery', label: 'Niş önerileri', help: 'Yeni niş ve alt kategori önerir; kendiliğinden eklemez. Ücretsiz.' },
  { key: 'keywords', group: 'research', bot: 'keyword_research', spends: true, label: 'Anahtar kelime verisi (Apify)', help: 'Fikirlerin gerçek aranma hacmini sorar. Apify kredisi harcar; aylık kelime kotası ve günlük limit geçilmez.' },
  { key: 'serp', group: 'research', bot: 'seo_competition', spends: true, label: 'SERP rekabet analizi (Serper)', help: 'Fikirlerin Google rekabetini inceler. Serper kredisi harcar; günlük sorgu limiti geçilmez.' },
  { key: 'writer', group: 'writing', bot: 'article_writer', spends: true, label: 'Makale yazımı (yapay zekâ)', help: 'Uygun fikirden kaynaklı bir taslak yazar ve zorunlu kontrolleri (doğruluk, AdSense riski, tekrar, kalite) yapar. Model ücreti harcar; günlük makale limiti geçilmez.' },
  { key: 'images', group: 'writing', spends: true, label: 'Makaleye kapak görseli ekle (OpenAI görsel modeli)', help: 'Makale yazılınca, makaleye uygun bir kapak görseli çizilir ve WordPress’e öne çıkan görsel (açıklayıcı alt metinle) olarak gönderilir. Görsel başına OpenAI ücreti alınır; görselde yazı, logo ya da gerçek kişi olmaması istenir.' },
  { key: 'autoApprove', group: 'writing', risk: true, label: 'Temiz geçen makaleyi kendiliğinden “Yayına hazır” yap', help: 'Kapalıyken her taslağı siz onaylarsınız. Açıkken yalnızca tüm zorunlu kontrollerden ve en az kalite puanından geçen taslak onaylanır; geçemeyen “İnceleme bekliyor”da kalır.' },
  { key: 'publishing', group: 'publishing', bot: 'content_publishing', label: 'Hazır makaleleri WordPress’e gönder', help: 'Yalnızca “Yayına hazır” makaleleri, günlük yayın limitini aşmadan gönderir. Aşağıdaki seçenek kapalıysa taslak olarak gider.' },
  { key: 'publishLive', group: 'publishing', risk: true, label: 'Taslak yerine doğrudan yayımla', help: 'Açıkken gönderilen yazılar sitede herkese açık yayımlanır. Kapalıyken WordPress’te taslak olarak durur ve son kararı orada siz verirsiniz.' },
  { key: 'health', group: 'upkeep', bot: 'content_health', label: 'Eski makale kontrolü', help: 'Bozuk bağlantıları ve yeni gelişmeleri arar; kanıt varsa “güncelleme bekliyor” yapar. Ücretsiz.' },
  { key: 'refresh', group: 'upkeep', bot: 'content_refresh', spends: true, label: 'Kanıtlı güncellemeleri yapay zekâ ile hazırla', help: 'Güncelleme bekleyen makaleler için taslak hazırlar. Uygulama, Ayarlar’daki güncelleme onay politikasına bağlıdır. Model ücreti harcar.' },
  { key: 'links', group: 'upkeep', bot: 'internal_linking', label: 'İç bağlantı önerileri', help: 'Makaleler arası bağlantı önerir; ekleme her zaman sizin onayınızla. Ücretsiz.' },
  { key: 'gsc', group: 'upkeep', bot: 'seo_performance', label: 'Search Console verisini çek', help: 'Siteler için günlük performans verisini alır. Ücretsiz.' },
  { key: 'adsense', group: 'upkeep', bot: 'adsense_compliance', label: 'Haftalık AdSense site denetimi', help: 'Sitenin AdSense hazırlığını herkese açık sayfalardan denetler (onay değildir). Ücretsiz.' },
  { key: 'reports', group: 'upkeep', bot: 'reporting', label: 'Günlük ve haftalık rapor', help: 'Her sabah önceki günün, pazartesileri önceki haftanın raporunu üretir. Ücretsiz.' },
];
const KEYS = OPTIONS.map((o) => o.key);
const SEMI = ['news', 'opportunities', 'niche', 'keywords', 'serp', 'writer', 'images', 'publishing', 'health', 'links', 'gsc', 'adsense', 'reports'];
const FULL = [...SEMI, 'autoApprove', 'publishLive', 'refresh'];

const MODES = {
  manual: { label: 'Elle', options: [], about: 'Hiçbir şey kendiliğinden çalışmaz. Her işi ilgili sayfadaki düğmeyle siz başlatırsınız.' },
  semi: { label: 'Yarı otomatik', options: SEMI, about: 'Araştırma, yazım ve kontroller kendiliğinden yürür. Onay sizde: makaleyi siz “Yayına hazır” yaparsınız; hazır olanlar WordPress’e yalnızca TASLAK olarak gider, hiçbir şey sitede kendiliğinden yayımlanmaz.' },
  full: { label: 'Tam otomatik', options: FULL, about: 'Baştan sona kendiliğinden: araştırma, yazım, kontroller, onay ve yayın. Kontrollerden geçen makale siz bakmadan sitede yayımlanır; geçemeyen taslak sizi bekler. Günlük limitler ve bütçe her zaman geçerlidir.' },
};
/** what "tam otomatik" cannot exist without: if these are not ready the mode is refused instead of pretending */
const ESSENTIAL_FULL = ['writer', 'publishing', 'publishLive'];

/** the values a new site starts well with (a new domain is better served by 2 good posts a day than by a flood) */
const RECOMMENDED = { dailyArticles: 2, dailyPublish: 2, writerFrom: '09:00', writerTo: '23:00', publishFrom: '09:00', publishTo: '21:00', weekends: false, minQuality: 85, dailyBudgetUsd: 3 };
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WRITER_INTERVAL = 180; const PUBLISH_INTERVAL = 60;

const minutes = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const windowMinutes = (from, to) => { const d = minutes(to) - minutes(from); return d > 0 ? d : d + 1440; };

// ── what is connected (prerequisites) ───────────────────────────────────────────────────────────
async function gather(projectId) {
  const [vendors, openai, apify, serper, gscProv, siteList, niche] = await Promise.all([
    llm.available(), providers.get('openai'), providers.get('apify'), providers.get('serper'), providers.get('searchconsole'), sites.list(projectId),
    db.query('SELECT main_niche FROM niche_profiles WHERE project_id = $1', [projectId]),
  ]);
  const readyVendors = vendors.filter((v) => v.ready);
  const okSites = siteList.filter((s) => s.status === 'active' && s.lastTestOk === true);
  return { vendors, readyVendors, openai, apify, serper, gscProv, siteList, okSites, gscSites: siteList.filter((s) => s.status === 'active' && s.gscProperty), nicheSet: !!(niche.rows[0] && niche.rows[0].main_niche) };
}

/** what stops an option from being switched on: [{ text, to }] (empty = ready) */
function missingFor(key, g) {
  const need = [];
  const model = { text: 'Bağlı bir yapay zekâ sağlayıcısı (anahtar + model adı)', to: '/api-usage' };
  const site = { text: 'Bağlantı testi geçmiş, etkin bir WordPress sitesi', to: '/sites' };
  if (key === 'writer' || key === 'refresh') { if (!g.readyVendors.length) need.push(model); }
  if (key === 'images' && !g.openai.configured) need.push({ text: 'OpenAI anahtarı (görsel çizimi için)', to: '/api-usage' });
  if (key === 'keywords' && !g.apify.configured) need.push({ text: 'Apify anahtarı (anahtar kelime hacmi için)', to: '/api-usage' });
  if (key === 'serp' && !g.serper.configured) need.push({ text: 'Serper anahtarı (SERP rekabeti için)', to: '/api-usage' });
  if ((key === 'publishing' || key === 'publishLive') && !g.okSites.length) need.push(site);
  if (key === 'gsc') { if (!g.gscProv.configured) need.push({ text: 'Search Console servis hesabı anahtarı', to: '/api-usage' }); if (!g.gscSites.length) need.push({ text: 'Search Console adresi yazılmış bir WordPress sitesi', to: '/sites' }); }
  return need;
}

// ── reading the current state ───────────────────────────────────────────────────────────────────
async function readOn(projectId) {
  const sch = await scheduler.loadSchedules();
  const pub = (await settings.get('publishing', projectId)).value; const q = (await settings.get('quality', projectId)).value;
  const on = {};
  for (const o of OPTIONS) if (o.bot) on[o.key] = !!sch.get(o.bot).enabled;
  on.publishing = on.publishing && !!pub.autoPublish && !!pub.siteId;
  on.publishLive = pub.mode === 'publish';
  on.autoApprove = q.manualApprovalNewArticles === false;
  const im = (await settings.get('images', projectId)).value; on.images = !!im.auto;
  return { on, sch, pub, q, im };
}

async function readValues(projectId, st) {
  const lim = await limits.status({ projectId });
  const item = (t) => lim.items.find((i) => i.workType === t);
  const w = st.sch.get('article_writer'); const budget = (await settings.get('budget')).value;
  return { dailyArticles: item('new_article').project ? item('new_article').project.limit : item('new_article').limit, dailyPublish: item('publish').project ? item('publish').project.limit : item('publish').limit,
    writerFrom: w.windowStart || RECOMMENDED.writerFrom, writerTo: w.windowEnd || RECOMMENDED.writerTo, publishFrom: st.pub.windowStart, publishTo: st.pub.windowEnd, weekends: !!st.pub.weekends,
    minQuality: st.q.minScore, dailyBudgetUsd: budget.dailyTotalUsd };
}

function intended(mode, g) { return Object.fromEntries(KEYS.map((k) => [k, MODES[mode].options.includes(k) && missingFor(k, g).length === 0])); }
const same = (a, b) => KEYS.every((k) => !!a[k] === !!b[k]);
function fullApplicable(g) { return ESSENTIAL_FULL.every((k) => missingFor(k, g).length === 0); }

function detectMode(on, g) {
  if (KEYS.every((k) => !on[k])) return 'manual';
  if (fullApplicable(g) && same(on, intended('full', g))) return 'full';
  if (on.writer && same(on, intended('semi', g))) return 'semi';          // "yarı otomatik" without the article writer would only be research: that is "Özel"
  return 'custom';
}

async function overview(projectId) {
  const pid = V.uuid(projectId, 'Proje'); await projects.getProject(pid);
  const g = await gather(pid); const st = await readOn(pid); const values = await readValues(pid, st);
  const botState = (await settings.get('bots')).value;
  const options = OPTIONS.map((o) => ({ key: o.key, group: o.group, label: o.label, help: o.help, spends: !!o.spends, risk: !!o.risk, on: !!st.on[o.key], missing: missingFor(o.key, g), ready: missingFor(o.key, g).length === 0 }));
  const mode = detectMode(st.on, g);
  const count = KEYS.filter((k) => st.on[k]).length;
  const summary = mode === 'custom' ? `${count} seçenek açık. Makale yazımı ${st.on.writer ? 'açık' : 'KAPALI'}; WordPress’e gönderim ${st.on.publishing ? (st.on.publishLive ? 'açık (doğrudan yayımlar)' : 'açık (taslak olarak)') : 'KAPALI'}; makaleleri ${st.on.autoApprove ? 'kontrolden geçen kendiliğinden onaylanır' : 'siz onaylarsınız'}.` : MODES[mode].about;
  const modes = Object.entries(MODES).map(([key, m]) => ({ key, label: m.label, about: m.about, applicable: key !== 'full' || fullApplicable(g),
    blockedBy: key === 'full' ? ESSENTIAL_FULL.flatMap((k) => missingFor(k, g)).filter((x, i, a) => a.findIndex((y) => y.text === x.text) === i) : [],
    skips: key === 'manual' ? [] : MODES[key].options.filter((k) => missingFor(k, g).length).map((k) => ({ key: k, label: OPTIONS.find((o) => o.key === k).label, missing: missingFor(k, g) })) }));
  const unpriced = g.readyVendors.filter((v) => !v.pricesKnown);
  const tgc = await telegram.credentials(); const tgReady = tgc.configured && tgc.chatIds.length > 0;
  const warnings = [];
  if (botState.paused) warnings.push({ kind: 'bad', text: 'Botlar duraklatılmış durumda; hiçbir otomatik iş çalışmaz.', to: '/limits' });
  if (!scheduler.status().running) warnings.push({ kind: 'warn', text: 'Zamanlayıcı bu sunucuda çalışmıyor (yalnızca canlı ortamda otomatik başlar). Ayarlar kaydedilir ama iş çalışması için zamanlayıcı gerekir.' });
  if (unpriced.length) warnings.push({ kind: 'warn', text: `${unpriced.map((v) => v.label).join(', ')} için fiyat girilmemiş: harcama “bilinmiyor” görünür ve günlük bütçe sınırı bunu sayamaz. Sizi asıl koruyan günlük makale limitidir (fiyatı API Kullanımı sayfasından girebilirsiniz).`, to: '/api-usage' });
  if (g.readyVendors.length === 1) warnings.push({ kind: 'info', text: 'Tek bir yapay zekâ sağlayıcısı bağlı: yazar ve denetçi aynı model olur. İkinci bir sağlayıcı daha bağımsız bir kontrol sağlar.', to: '/api-usage' });
  if (values.dailyBudgetUsd === null && (st.on.writer || st.on.refresh)) warnings.push({ kind: 'info', text: 'Günlük bütçe tanımlı değil.' });
  if (st.on.autoApprove && !st.on.writer) warnings.push({ kind: 'info', text: 'Otomatik onay açık ama makale yazımı kapalı: onaylanacak yeni makale gelmez.' });
  const backlog = (await db.query("SELECT count(*)::int n FROM articles a WHERE a.project_id = $1 AND a.status = 'ready' AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.article_id = a.id)", [pid])).rows[0].n;
  const checklist = [
    { key: 'niche', label: 'Proje nişi ve stratejisi', ok: g.nicheSet, detail: g.nicheSet ? 'Yazıldı' : 'Ana niş boş', to: '/strategy' },
    { key: 'model', label: 'Yapay zekâ sağlayıcısı', ok: g.readyVendors.length > 0, detail: g.readyVendors.length ? g.readyVendors.map((v) => `${v.label} (${v.model})`).join(', ') : 'Bağlı değil', to: '/api-usage' },
    { key: 'apify', label: 'Apify (anahtar kelime verisi)', ok: !!g.apify.configured, detail: g.apify.configured ? 'Bağlı' : 'Bağlı değil', to: '/api-usage' },
    { key: 'serper', label: 'Serper (SERP rekabeti)', ok: !!g.serper.configured, detail: g.serper.configured ? 'Bağlı' : 'Bağlı değil', to: '/api-usage' },
    { key: 'wordpress', label: 'WordPress sitesi', ok: g.okSites.length > 0, detail: g.okSites.length ? g.okSites.map((s) => s.name).join(', ') : (g.siteList.length ? 'Site var ama bağlantı testi geçmedi' : 'Site eklenmedi'), to: '/sites' },
    { key: 'gsc', label: 'Search Console', ok: !!g.gscProv.configured && g.gscSites.length > 0, detail: g.gscProv.configured ? (g.gscSites.length ? 'Bağlı' : 'Sitede Search Console adresi yok') : 'Bağlı değil', to: '/api-usage' },
    { key: 'telegram', label: 'Telegram bildirimleri', ok: tgReady, detail: tgReady ? 'Bağlı' : 'Bağlı değil (bildirimler yalnızca panelde görünür)', to: '/notifications' },
  ];
  return { projectId: pid, mode, summary, modeLabel: mode === 'custom' ? 'Özel' : MODES[mode].label, modes, groups: GROUPS, options, values, recommended: RECOMMENDED, max: { dailyArticles: limits.WORK_TYPES.new_article.max, dailyPublish: limits.WORK_TYPES.publish.max }, warnings, checklist, readyBacklog: backlog, paused: !!botState.paused,
    schedulerRunning: !!scheduler.status().running, thresholds: { minScore: st.q.minScore } };
}

// ── validating the values ───────────────────────────────────────────────────────────────────────
function cleanValues(v, base) {
  const out = { ...base }; if (v === undefined || v === null) return out;
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('Değerler bir nesne olmalı');
  const time = (x, l) => { const s = V.str(x, l, { required: true, max: 5 }); if (!HM.test(s)) throw bad(`${l} SS:DD biçiminde olmalı (ör. 09:00)`); return s; };
  if (v.dailyArticles !== undefined) out.dailyArticles = V.int(v.dailyArticles, 'Günlük yeni makale', { min: 1, max: limits.WORK_TYPES.new_article.max });
  if (v.dailyPublish !== undefined) out.dailyPublish = V.int(v.dailyPublish, 'Günlük yayın', { min: 1, max: limits.WORK_TYPES.publish.max });
  if (v.writerFrom !== undefined) out.writerFrom = time(v.writerFrom, 'Yazım saatleri başlangıcı');
  if (v.writerTo !== undefined) out.writerTo = time(v.writerTo, 'Yazım saatleri bitişi');
  if (v.publishFrom !== undefined) out.publishFrom = time(v.publishFrom, 'Yayın saatleri başlangıcı');
  if (v.publishTo !== undefined) out.publishTo = time(v.publishTo, 'Yayın saatleri bitişi');
  if (v.weekends !== undefined) out.weekends = V.bool(v.weekends, 'Hafta sonu da çalış');
  if (v.minQuality !== undefined) out.minQuality = V.int(v.minQuality, 'En düşük kalite puanı', { min: 50, max: 100 });
  if (v.dailyBudgetUsd !== undefined) {
    if (v.dailyBudgetUsd === null || v.dailyBudgetUsd === '') out.dailyBudgetUsd = null;
    else { const n = Number(v.dailyBudgetUsd); if (!Number.isFinite(n) || n <= 0 || n > 10000) throw bad('Günlük bütçe 0’dan büyük bir tutar (USD) olmalı; sınır istemiyorsanız boş bırakın'); out.dailyBudgetUsd = Math.round(n * 100) / 100; }
  }
  if (out.writerFrom === out.writerTo) throw bad('Yazım saatlerinin başlangıcı ve bitişi aynı olamaz');
  if (out.publishFrom === out.publishTo) throw bad('Yayın saatlerinin başlangıcı ve bitişi aynı olamaz');
  return out;
}

// ── applying ────────────────────────────────────────────────────────────────────────────────────
/**
 * @param body { projectId, mode: manual|semi|full|custom, options?: { key: bool } (custom), values?: {...}, confirm?: true }
 * @returns the new overview plus `applied: { mode, changes: [text], skipped: [{ key, label, missing }] }`
 */
async function apply(body, { userId = null } = {}) {
  const pid = V.uuid(body.projectId, 'Proje'); await projects.getProject(pid);
  const mode = V.oneOf(body.mode, 'Mod', ['manual', 'semi', 'full', 'custom']);
  const g = await gather(pid); const st = await readOn(pid); const curValues = await readValues(pid, st);
  const label = (k) => OPTIONS.find((o) => o.key === k).label;
  let target; const skipped = [];

  if (mode === 'custom') {
    const o = body.options;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad('Seçenekler gönderilmedi');
    for (const k of Object.keys(o)) { if (!KEYS.includes(k)) throw bad(`Bilinmeyen seçenek: ${k}`); if (typeof o[k] !== 'boolean') throw bad(`“${label(k)}” açık/kapalı (true/false) olmalı`); }
    target = Object.fromEntries(KEYS.map((k) => [k, o[k] !== undefined ? o[k] : !!st.on[k]]));
    if (target.publishLive && !target.publishing) throw bad('“Taslak yerine doğrudan yayımla” için “Hazır makaleleri WordPress’e gönder” de seçili olmalı');
    const problems = KEYS.filter((k) => target[k] && !st.on[k]).flatMap((k) => missingFor(k, g).map((m) => ({ option: k, message: `${label(k)}: ${m.text} gerekli` })));
    if (problems.length) throw new HttpError(409, `Seçilen bazı seçenekler açılamaz: ${problems.map((p) => p.message).join('; ')}`, { problems });
  } else {
    if (mode === 'full' && !fullApplicable(g)) {
      const problems = ESSENTIAL_FULL.flatMap((k) => missingFor(k, g).map((m) => ({ option: k, message: m.text }))).filter((x, i, a) => a.findIndex((y) => y.message === x.message) === i);
      throw new HttpError(409, `Tam otomatik mod için eksikler var: ${problems.map((p) => p.message).join('; ')}`, { problems });
    }
    target = {};
    for (const k of KEYS) {
      const want = MODES[mode].options.includes(k);
      if (want && missingFor(k, g).length && !st.on[k]) { target[k] = false; skipped.push({ key: k, label: label(k), missing: missingFor(k, g) }); } else target[k] = want;
    }
  }

  // the two switches that take the person out of the loop need an explicit yes
  const newlyRisky = ['autoApprove', 'publishLive'].filter((k) => target[k] && !st.on[k]);
  if (newlyRisky.length && body.confirm !== true) {
    const backlog = (await db.query("SELECT count(*)::int n FROM articles a WHERE a.project_id = $1 AND a.status = 'ready' AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.article_id = a.id)", [pid])).rows[0].n;
    throw new HttpError(409, `${newlyRisky.includes('publishLive') ? 'Bu ayarla kontrollerden geçen makaleler SİZ BAKMADAN sitede herkese açık yayımlanır' : 'Bu ayarla kontrollerden geçen makaleler SİZ BAKMADAN “Yayına hazır” olur'}${backlog && target.publishing ? `; şu an “Yayına hazır” durumunda ${backlog} makale de günlük yayın limiti kadar gönderilir` : ''}. Zorunlu kontroller, günlük limitler ve bütçe yine geçerlidir. Devam edilsin mi?`, { requiresConfirmation: true, options: newlyRisky, readyBacklog: backlog });
  }

  // values: a preset brings the recommended ones unless the person typed their own; "Elle" leaves every value alone
  const base = mode === 'semi' || mode === 'full' ? { ...curValues, ...RECOMMENDED, dailyBudgetUsd: curValues.dailyBudgetUsd !== null ? curValues.dailyBudgetUsd : RECOMMENDED.dailyBudgetUsd, minQuality: Math.max(curValues.minQuality, RECOMMENDED.minQuality) } : curValues;
  const values = mode === 'manual' ? curValues : cleanValues(body.values, base);
  const changes = [];
  const note = (t) => changes.push(t);

  // 1. limits (the platform limit is the upper bound: it is only raised, never lowered, so nothing a person set higher is cut)
  if (mode !== 'manual') {
    const gl = (await limits.status({ projectId: null })).items;
    const raise = {};
    if (values.dailyArticles !== curValues.dailyArticles) {
      await limits.setProjectLimits(pid, { new_article: values.dailyArticles }, { userId }); note(`Günlük yeni makale: ${curValues.dailyArticles} → ${values.dailyArticles}`);
      if (gl.find((i) => i.workType === 'new_article').limit < values.dailyArticles) raise.new_article = values.dailyArticles;       // only for a number THIS call sets: an older mismatch is the owner's, not touched here
    }
    if (values.dailyPublish !== curValues.dailyPublish) {
      await limits.setProjectLimits(pid, { publish: values.dailyPublish }, { userId }); note(`Günlük yayın: ${curValues.dailyPublish} → ${values.dailyPublish}`);
      if (gl.find((i) => i.workType === 'publish').limit < values.dailyPublish) raise.publish = values.dailyPublish;
    }
    if (Object.keys(raise).length) { await limits.setGlobalLimits(raise, { userId }); note(`Platform limiti yükseltildi (proje limitini engellemesin diye): ${Object.entries(raise).map(([k, v]) => `${k} ${v}`).join(', ')}`); }
  }

  // 2. quality and budget
  const qPatch = {};
  if (mode !== 'manual' && values.minQuality !== curValues.minQuality) { qPatch.minScore = values.minQuality; note(`En düşük kalite puanı: ${curValues.minQuality} → ${values.minQuality}`); }
  if (target.autoApprove !== st.on.autoApprove) { qPatch.manualApprovalNewArticles = !target.autoApprove; note(target.autoApprove ? 'Otomatik onay AÇILDI (temiz geçen makale kendiliğinden “Yayına hazır” olur)' : 'Otomatik onay kapatıldı (her makaleyi siz onaylarsınız)'); }
  if (Object.keys(qPatch).length) { const r = await settings.get('quality', pid); await settings.set('quality', { ...r.value, ...qPatch }, r.overriddenForProject ? { scope: 'project', projectId: pid, userId } : { scope: 'global', userId }); }
  if (target.images !== st.on.images) {
    const r = await settings.get('images', pid);
    await settings.set('images', { ...r.value, auto: target.images }, r.overriddenForProject ? { scope: 'project', projectId: pid, userId } : { scope: 'global', userId });
    note(target.images ? 'Makale kapak görseli AÇILDI (her yeni makale için bir görsel çizilir, görsel başına OpenAI ücreti alınır)' : 'Makale kapak görseli kapatıldı');
  }
  if (mode !== 'manual' && values.dailyBudgetUsd !== curValues.dailyBudgetUsd) { const b = (await settings.get('budget')).value; await settings.set('budget', { ...b, dailyTotalUsd: values.dailyBudgetUsd }, { userId }); note(`Günlük toplam bütçe: ${curValues.dailyBudgetUsd === null ? 'sınırsız' : `$${curValues.dailyBudgetUsd}`} → ${values.dailyBudgetUsd === null ? 'sınırsız' : `$${values.dailyBudgetUsd}`}`); }

  // 3. the per-project "bot is active" switches (a closed switch would silently stop the bot even when its schedule is on)
  const gateOpen = async (group) => { const r = await settings.get(group, pid); if (r.value.enabled === false) { await settings.set(group, { ...r.value, enabled: true }, { scope: 'project', projectId: pid, userId }); note(`Proje ayarlarında “${group === 'news' ? 'haber' : 'SEO'} botu” açıldı (kapalıydı, bot çalışamazdı)`); } };
  if ((target.news && !st.on.news)) await gateOpen('news');
  if ((target.keywords && !st.on.keywords) || (target.serp && !st.on.serp) || (target.opportunities && !st.on.opportunities) || (target.niche && !st.on.niche)) await gateOpen('seo');

  // 4. publishing settings (the site belongs to one project: always written for this project)
  const pubOn = target.publishing; const pubPatch = {};
  const chosenSite = g.siteList.find((s) => s.id === st.pub.siteId && s.status === 'active') || g.okSites[0] || null;      // the site already chosen stays (even while it waits for a new test); another one is picked only when there is none
  if (pubOn) { if (chosenSite && st.pub.siteId !== chosenSite.id) pubPatch.siteId = chosenSite.id; if (!st.pub.autoPublish) pubPatch.autoPublish = true; } else if (st.pub.autoPublish) pubPatch.autoPublish = false;
  const wantMode = target.publishLive ? 'publish' : 'draft'; if (st.pub.mode !== wantMode) pubPatch.mode = wantMode;
  if (mode !== 'manual') {
    if (values.publishFrom !== st.pub.windowStart) pubPatch.windowStart = values.publishFrom; if (values.publishTo !== st.pub.windowEnd) pubPatch.windowEnd = values.publishTo;
    if (values.weekends !== !!st.pub.weekends) pubPatch.weekends = values.weekends;
  }
  if (Object.keys(pubPatch).length) {
    await settings.set('publishing', { ...st.pub, ...pubPatch }, { scope: 'project', projectId: pid, userId });
    if ('autoPublish' in pubPatch || 'siteId' in pubPatch) note(pubOn ? `WordPress’e otomatik gönderim AÇILDI (site: ${chosenSite ? chosenSite.name : '—'}, ${wantMode === 'publish' ? 'doğrudan yayımlar' : 'taslak olarak gönderir'})` : 'WordPress’e otomatik gönderim kapatıldı');
    if ('mode' in pubPatch) note(target.publishLive ? 'Yayın şekli: doğrudan yayımla (herkese açık)' : 'Yayın şekli: WordPress’te taslak');
    if ('windowStart' in pubPatch || 'windowEnd' in pubPatch || 'weekends' in pubPatch) note(`Yayın saatleri ${values.publishFrom}–${values.publishTo}${values.weekends ? ', hafta sonu dahil' : ', hafta sonu yok'}`);
  }

  // 5. the bots (last, so a job never starts on half-applied settings)
  const wRuns = Math.max(1, Math.floor(windowMinutes(values.writerFrom, values.writerTo) / WRITER_INTERVAL));
  const pRuns = Math.max(1, Math.floor(windowMinutes(values.publishFrom, values.publishTo) / PUBLISH_INTERVAL));
  for (const o of OPTIONS) {
    if (!o.bot) continue;
    const cur = st.sch.get(o.bot); const patch = {};
    if (!!cur.enabled !== !!target[o.key]) patch.enabled = !!target[o.key];
    if (target[o.key] && mode !== 'manual') {
      if (o.key === 'writer') {
        const perRun = Math.max(1, Math.ceil(values.dailyArticles / wRuns));
        if (cur.windowStart !== values.writerFrom || cur.windowEnd !== values.writerTo) { patch.windowStart = values.writerFrom; patch.windowEnd = values.writerTo; }
        if (cur.intervalMinutes !== WRITER_INTERVAL) patch.intervalMinutes = WRITER_INTERVAL;
        if (cur.options.perRun !== perRun) patch.options = { perRun };
      }
      if (o.key === 'publishing') {
        const perRun = Math.max(2, Math.ceil(values.dailyPublish / pRuns));
        if (cur.windowStart !== values.publishFrom || cur.windowEnd !== values.publishTo) { patch.windowStart = values.publishFrom; patch.windowEnd = values.publishTo; }
        if (cur.intervalMinutes !== PUBLISH_INTERVAL) patch.intervalMinutes = PUBLISH_INTERVAL;
        if (cur.options.perRun !== perRun) patch.options = { perRun };
        if (!!cur.weekdaysOnly === !!values.weekends) patch.weekdaysOnly = !values.weekends;
      }
    }
    if (Object.keys(patch).length) {
      await scheduler.updateSchedule(o.bot, patch);
      if ('enabled' in patch) note(`${label(o.key)}: ${patch.enabled ? 'açıldı' : 'kapatıldı'}`);
    }
  }
  return { ...(await overview(pid)), applied: { mode, changes, skipped } };
}

module.exports = { OPTIONS, MODES, GROUPS, RECOMMENDED, ESSENTIAL_FULL, overview, apply, detectMode, missingFor };
