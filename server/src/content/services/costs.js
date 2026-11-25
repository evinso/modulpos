const db = require('../db');
const V = require('../lib/validate');
const { env } = require('../env');
const { startOfDay, startOfMonth, dayKey } = require('../lib/time');
const settings = require('./settings');

/**
 * Cost analysis and the "80% of a budget" warning (phase 7). Everything is derived from what the providers REPORTED (api_usage): a call without a price is counted as "unknown" and
 * never added as 0, and every suggestion says which numbers it rests on and what it cannot know (above all: whether a cheaper model writes or checks as well; that is measured by
 * the blind comparison and by reading the drafts, not by this page).
 */
const MICROS = 1e6;
const LLM = ['openai', 'anthropic', 'gemini', 'groq'];
const usd = (v) => `$${Number(v).toFixed(2)}`;

async function analysis({ days = 30, now = new Date(), tz = env().defaultTimezone } = {}) {
  const d = Math.min(90, Math.max(7, days | 0 || 30));
  const dayStart = startOfDay(now, tz); const since = new Date(dayStart.getTime() - (d - 1) * 86400000); const monthStart = startOfMonth(now, tz);
  const ops = (await db.query(`SELECT provider, operation, COALESCE(sum(cost_micros), 0)::bigint micros, COALESCE(sum(requests), 0)::int requests, count(*) FILTER (WHERE cost_micros IS NULL AND result = 'ok')::int unknown,
      count(*) FILTER (WHERE result = 'error')::int errors, count(*) FILTER (WHERE result = 'blocked_budget')::int blocked, count(*)::int calls
    FROM api_usage WHERE created_at >= $1 GROUP BY provider, operation ORDER BY 3 DESC, provider, operation`, [since])).rows
    .map((r) => ({ provider: r.provider, operation: r.operation, costUsd: Number(r.micros) / MICROS, requests: r.requests, unknownCalls: r.unknown, errors: r.errors, blocked: r.blocked, calls: r.calls }));
  const known = ops.reduce((s, o) => s + o.costUsd, 0); const unknown = ops.reduce((s, o) => s + o.unknownCalls, 0);
  const byProvider = [...ops.reduce((m, o) => { const x = m.get(o.provider) || { provider: o.provider, costUsd: 0, requests: 0, unknownCalls: 0, errors: 0, blocked: 0, calls: 0 }; for (const k of ['costUsd', 'requests', 'unknownCalls', 'errors', 'blocked', 'calls']) x[k] += o[k]; return m.set(o.provider, x); }, new Map()).values()].sort((a, b) => b.costUsd - a.costUsd);
  const dailyRows = (await db.query("SELECT (created_at AT TIME ZONE $2)::date AS day, COALESCE(sum(cost_micros), 0)::bigint micros, count(*) FILTER (WHERE cost_micros IS NULL AND result = 'ok')::int unknown FROM api_usage WHERE created_at >= $1 AND result <> 'blocked_budget' GROUP BY 1 ORDER BY 1", [since, tz])).rows;
  const daily = dailyRows.map((r) => ({ day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day), costUsd: Number(r.micros) / MICROS, unknownCalls: r.unknown }));
  const monthRow = (await db.query("SELECT COALESCE(sum(cost_micros), 0)::bigint micros, count(*) FILTER (WHERE cost_micros IS NULL AND result = 'ok')::int unknown FROM api_usage WHERE created_at >= $1 AND result <> 'blocked_budget'", [monthStart])).rows[0];
  const monthKnown = Number(monthRow.micros) / MICROS;

  // what one written article cost (the run's own sum: the writer call and its checks)
  const runs = (await db.query("SELECT stats FROM automation_runs WHERE bot_key = 'article_writer' AND status IN ('ok', 'partial') AND started_at >= $1", [since])).rows.map((r) => r.stats || {});
  const priced = runs.filter((s) => Number(s.unknownCost || 0) === 0 && s.costUsd !== undefined).map((s) => Number(s.costUsd));
  const perArticle = { runs: runs.length, pricedRuns: priced.length, unknownRuns: runs.length - priced.length, avgUsd: priced.length ? Math.round((priced.reduce((a, b) => a + b, 0) / priced.length) * 10000) / 10000 : null, minUsd: priced.length ? Math.min(...priced) : null, maxUsd: priced.length ? Math.max(...priced) : null,
    note: 'Bir makalenin yazımı ve kontrolleri için yapılan çağrıların toplamı; fiyatı bilinmeyen çağrı içeren yazımlar ortalamaya katılmaz.' };

  // a month-end estimate only when there is enough to base it on (and it says what it is)
  const last7 = daily.slice(-7); const dayNo = Number(dayKey(now, tz).slice(8)); const dim = new Date(Date.UTC(Number(dayKey(now, tz).slice(0, 4)), Number(dayKey(now, tz).slice(5, 7)), 0)).getUTCDate();
  const forecast = last7.filter((x) => x.costUsd > 0).length >= 3 ? { monthEndUsd: Math.round((monthKnown + (last7.reduce((s, x) => s + x.costUsd, 0) / 7) * (dim - dayNo)) * 100) / 100, basis: 'Bu ayın şimdiye kadarki bilinen harcaması + son 7 günün günlük ortalamasının kalan günlerle çarpımı. Bir tahmindir; bilinmeyen maliyetler ve ani değişiklikler dahil değildir.' } : null;

  // budgets
  const plat = (await settings.get('budget')).value; const provs = await require('./providers').list();
  const todayStart = dayStart; const spentSince = async (provider, from) => { const r = await require('./providers').spent({ provider, since: from }); return { usd: r.micros / MICROS, unknown: r.unknown }; };
  const budgets = [];
  for (const p of provs) for (const [kind, lim, from] of [['günlük', p.dailyBudgetUsd, todayStart], ['aylık', p.monthlyBudgetUsd, monthStart]]) if (lim !== null && lim !== undefined) { const s = await spentSince(p.key, from); budgets.push({ label: `${p.label} ${kind} bütçesi`, limitUsd: lim, usedUsd: s.usd, pct: lim > 0 ? Math.round((s.usd / lim) * 100) : null, unknownCalls: s.unknown }); }
  for (const [kind, lim, from] of [['günlük', plat.dailyTotalUsd, todayStart], ['aylık', plat.monthlyTotalUsd, monthStart]]) if (lim !== null && lim !== undefined) { const s = await spentSince(null, from); budgets.push({ label: `Platform ${kind} bütçesi`, limitUsd: lim, usedUsd: s.usd, pct: lim > 0 ? Math.round((s.usd / lim) * 100) : null, unknownCalls: s.unknown }); }

  // suggestions: each one names its numbers and what it cannot know
  const recs = [];
  const llmOps = ops.filter((o) => LLM.includes(o.provider)); const llmKnown = llmOps.reduce((s, o) => s + o.costUsd, 0);
  for (const p of provs.filter((x) => LLM.includes(x.key))) {
    const u = ops.filter((o) => o.provider === p.key).reduce((s, o) => s + o.unknownCalls, 0);
    if (u > 0 && !p.extra.inputPricePerM && !p.extra.outputPricePerM) recs.push({ code: 'prices_missing', severity: 'warn', title: `${p.label}: ${u} çağrının maliyeti bilinmiyor`, text: 'Fiyat yazılmadığı için bu çağrıların maliyeti hesaplanamıyor; bütçe koruması ve bu analiz o harcamayı göremez.', action: 'API Kullanımı ve Maliyetler → ' + p.label + ' → giriş/çıkış fiyatını (USD / 1 milyon token) sağlayıcının güncel fiyat sayfasından yazın.', evidence: { provider: p.key, unknownCalls: u }, cannotKnow: 'Gerçek tutarı bilemeyiz: yalnızca siz fiyatı yazınca hesaplanır.' });
  }
  const hasMonthlyBudget = provs.some((p) => p.monthlyBudgetUsd !== null && p.monthlyBudgetUsd !== undefined) || (plat.monthlyTotalUsd !== null && plat.monthlyTotalUsd !== undefined);
  if (monthKnown >= 1 && !hasMonthlyBudget) recs.push({ code: 'no_monthly_budget', severity: 'warn', title: 'Aylık bütçe sınırı yok', text: `Bu ay bilinen harcama ${usd(monthKnown)} ama hiçbir aylık bütçe tanımlı değil: beklenmedik bir artışı kendiliğinden durduracak bir sınır yok.`, action: 'API Kullanımı ve Maliyetler → Platform bütçesi ya da sağlayıcı kartında aylık bütçe yazın.', evidence: { monthKnownUsd: monthKnown }, cannotKnow: 'Doğru sınırı sizin harcama isteğiniz belirler.' });
  const checks = llmOps.filter((o) => ['fact_check', 'adsense_review'].includes(o.operation)).reduce((s, o) => s + o.costUsd, 0);
  if (llmKnown >= 0.5 && checks / llmKnown >= 0.5) recs.push({ code: 'checks_share', severity: 'info', title: `Kontroller yapay zekâ harcamasının %${Math.round((checks / llmKnown) * 100)}’i`, text: `Doğruluk ve AdSense incelemesi ${usd(checks)}, toplam bilinen model harcaması ${usd(llmKnown)}. Bu kontroller zorunludur ve kapatılamaz; ama kontrol modeli Ayarlar → Kalite’den ayrı (daha ucuz) bir sağlayıcıya verilebilir.`, action: 'Ayarlar → Makale kalitesi → Kontrol modeli.', evidence: { checksUsd: checks, modelUsd: llmKnown }, cannotKnow: 'Daha ucuz bir kontrol modelinin hataları aynı iyilikte yakalayıp yakalamadığı ÖLÇÜLMEDİ; değiştirirseniz ilk makaleleri kendiniz okuyun.' });
  const rep = (await db.query("SELECT k.keyword, count(*)::int n FROM serp_analyses s JOIN keywords k ON k.id = s.keyword_id WHERE s.fetched_at >= $1 GROUP BY k.keyword HAVING count(*) > 1 ORDER BY 2 DESC, 1 LIMIT 10", [new Date(now.getTime() - 30 * 86400000)])).rows;
  if (rep.length >= 3) recs.push({ code: 'serp_repeats', severity: 'info', title: `${rep.length} anahtar kelime 30 günde birden çok kez SERP analizine girmiş`, text: 'Her SERP analizi bir Serper kredisi harcar. Aynı kelimeyi yeniden analiz etmeden önce eski sonucu kullanmak bunu keser.', action: 'SEO Rekabet Analizi: yalnızca analizi olmayan kelimeleri seçin; SERP botunun “çalışmada en çok” sayısını düşürün.', evidence: { examples: rep.slice(0, 5) }, cannotKnow: 'Yeniden analizin gerekçesi (rakipler değişti mi) bilinmez; bazıları bilerek tekrarlanmış olabilir.' });
  const blocked = ops.reduce((s, o) => s + o.blocked, 0);
  if (blocked > 0) recs.push({ code: 'budget_blocked', severity: 'info', title: `Bütçe ${blocked} çağrıyı durdurdu`, text: 'Bu bütçe korumasının çalıştığını gösterir. Beklenen buysa bir şey yapmayın; işler gereksiz yere bekliyorsa bütçeyi gözden geçirin.', evidence: { blocked }, cannotKnow: 'Durdurulan çağrıların ne kadar tutacağı bilinmez.' });
  for (const p of byProvider) if (p.errors >= 5 && p.calls > 0 && p.errors / p.calls >= 0.2) recs.push({ code: 'error_rate', severity: 'warn', title: `${p.provider}: çağrıların %${Math.round((p.errors / p.calls) * 100)}’i hata verdi`, text: `${p.calls} çağrının ${p.errors} tanesi hata verdi. Hatalı çağrılar bazı sağlayıcılarda yine de ücretlendirilir ve bizde fiyatı bilinmez olarak kalır.`, action: 'Panel → İşlem Geçmişi ve API Kullanımı → son çağrılar: hata nedenine bakın (anahtar, bakiye, model adı).', evidence: { calls: p.calls, errors: p.errors }, cannotKnow: 'Hatalı çağrıların faturaya yansıyıp yansımadığını yalnızca sağlayıcınızın paneli gösterir.' });
  const sched = await require('./scheduler').loadSchedules(); const lim = (await require('./limits').status({ now })).items.find((i) => i.workType === 'new_article');
  const paid = [...sched.values()].filter((s) => s.spends && s.enabled);
  if (paid.length) recs.push({ code: 'paid_bots_on', severity: 'info', title: `${paid.length} ücretli bot açık`, text: `${paid.map((s) => `${s.label} (${s.intervalMinutes % 60 === 0 ? `${s.intervalMinutes / 60} saatte bir` : `${s.intervalMinutes} dakikada bir`}${s.options && s.options.perRun ? `, çalışmada en çok ${s.options.perRun}` : ''})`).join('; ')}. Günlük makale üst sınırı ${lim.limit}: harcama bu sınırla çerçevelenir.`, action: 'Otomasyon ve Ayarlar → Botlar ve Günlük limitler.', evidence: { bots: paid.map((s) => s.botKey), dailyArticleLimit: lim.limit }, cannotKnow: 'Bir çalışmanın gerçek tutarı model ve içeriğe göre değişir; yukarıdaki makale başı ortalama geçmiş verinin özetidir.' });
  const expensive = byProvider[0];
  return { days: d, generatedAt: now.toISOString(), timezone: tz, totals: { knownUsd: known, unknownCalls: unknown, requests: ops.reduce((s, o) => s + o.requests, 0), monthKnownUsd: monthKnown, monthUnknownCalls: monthRow.unknown }, byProvider, byOperation: ops, daily, perArticle, forecast, budgets, recommendations: recs,
    biggest: expensive && expensive.costUsd > 0 ? { provider: expensive.provider, sharePct: known > 0 ? Math.round((expensive.costUsd / known) * 100) : null } : null,
    caveats: ['Yalnızca sağlayıcıların bildirdiği tutarlar toplanır; fiyatı olmayan çağrılar “bilinmiyor” diye sayılır ve toplama katılmaz.', 'Bu sayfa hangi modelin daha iyi yazdığını ya da kontrol ettiğini BİLEMEZ: onu “AI Makale Üretimi → Karşılaştır” testi ve taslakları okumanız gösterir.'] };
}

/**
 * After a paid call: when a budget reached 80% (and is not full yet) tell the owner ONCE per budget and period. Never throws, never slows the call noticeably (it only looks when a budget exists).
 */
async function warnIfNearBudget(provider, { now = new Date(), tz = env().defaultTimezone } = {}) {
  try {
    const providers = require('./providers');
    const row = (await db.query('SELECT daily_budget_micros, monthly_budget_micros FROM api_providers WHERE key = $1', [provider])).rows[0] || {};
    const plat = (await settings.get('budget')).value;
    const dayStart = startOfDay(now, tz); const monthStart = startOfMonth(now, tz);
    const pl = (providers.PROVIDERS[provider] || {}).label || provider;
    const checks = [['günlük', row.daily_budget_micros, dayStart, provider, `${pl} günlük bütçesi`], ['aylık', row.monthly_budget_micros, monthStart, provider, `${pl} aylık bütçesi`],
      ['günlük', plat.dailyTotalUsd === null ? null : plat.dailyTotalUsd * MICROS, dayStart, null, 'Platform günlük bütçesi'], ['aylık', plat.monthlyTotalUsd === null ? null : plat.monthlyTotalUsd * MICROS, monthStart, null, 'Platform aylık bütçesi']];
    for (const [kind, limit, from, prov, label] of checks) {
      if (limit === null || limit === undefined || Number(limit) <= 0) continue;
      const s = await providers.spent({ provider: prov, since: from }); const pct = (s.micros / Number(limit)) * 100;
      if (pct < 80 || pct >= 100) continue;
      const seen = (await db.query("SELECT 1 FROM notifications WHERE type = 'budget_warning' AND data->>'budget' = $1 AND created_at >= $2 LIMIT 1", [label, from])).rows[0];
      if (!seen) await require('./notifications').create({ type: 'budget_warning', severity: 'warning', title: `${label} %${Math.floor(pct)} doldu`, body: `${usd(s.micros / MICROS)} / ${usd(Number(limit) / MICROS)}. Dolunca ücretli işlemler başlamaz.${s.unknown ? ` (${s.unknown} çağrının maliyeti bilinmiyor ve toplama katılmıyor.)` : ''}`, data: { budget: label, kind } });
    }
  } catch (err) { console.error('[Content] budget warning failed:', err.message); }
}

module.exports = { analysis, warnIfNearBudget, V };
