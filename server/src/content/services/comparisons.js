const crypto = require('node:crypto');
const db = require('../db');
const V = require('../lib/validate');
const H = require('../lib/html');
const T = require('../lib/textStats');
const { HttpError } = require('../lib/http');
const settings = require('./settings');
const limits = require('./limits');
const runs = require('./runs');
const llm = require('./llm');
const sources = require('./sources');
const checks = require('./checks');
const articles = require('./articles');
const writer = require('./writer');
const notifications = require('./notifications');

/**
 * The blind writer comparison (phase 7). The same idea, the same research material and the same instructions go to 2-3 ready vendors; the person reads the drafts as A / B / C
 * WITHOUT knowing which vendor wrote which (the letters are assigned in a random order), picks the best one or none, and only THEN the vendors, models and costs are shown.
 *  - nothing that could give a vendor away is returned before the decision: not the name, the model, the cost, the tokens, the time it took, nor the text of an error
 *  - the drafts are not articles: only the picked one becomes an article (then it gets the normal mandatory checks, with a checker that is another vendor when there is one)
 *  - it costs one call per vendor and takes ONE place of the day's new-article limit; picking nothing gives the place back (the calls were still paid for)
 *  - the tally of past decisions is YOUR preference, never a quality measurement, and says so
 */
const MIN = 2; const MAX = 3; const LABELS = ['A', 'B', 'C'];
const OPEN = ['running', 'ready', 'picking'];
const pending = new Map();
const MICROS = 1e6;

const shuffle = (arr, rng = (n) => crypto.randomInt(n)) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rng(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** the numbers that can be measured on a draft without a model (the same free rules the archive uses) */
function measure(fields, srcs, lengthPref) {
  const text = H.htmlToText(fields.contentHtml); const rd = T.readability(text); const ks = T.keywordStats(text, fields.focusKeyword);
  const rules = checks.ruleReport({ contentHtml: fields.contentHtml, seoTitle: fields.seoTitle, metaDescription: fields.metaDescription, h1: fields.h1, focusKeyword: fields.focusKeyword }, { sources: srcs, lengthPref });
  const copy = (rules.items || []).find((i) => i.key === 'copy');
  return { words: H.wordCount(fields.contentHtml), h2: (String(fields.contentHtml).match(/<h2\b/gi) || []).length, readability: rd.ease, avgSentenceWords: rd.avgSentenceWords, keywordCount: ks.count, keywordDensityPct: ks.densityPct, focusInFirst150: ks.inFirst150,
    seoTitleChars: String(fields.seoTitle || '').length, metaChars: String(fields.metaDescription || '').length, faq: (fields.faq || []).length, links: (String(fields.contentHtml).match(/<a\b/gi) || []).length,
    rules: { status: rules.status, problems: (rules.items || []).filter((i) => i.status !== 'ok').map((i) => ({ label: i.label, status: i.status, detail: i.detail })) }, copyOverlap: copy ? copy.detail : null };
}

const BLIND_GONE = 'Bu taslak yazılamadı (ayrıntı karardan sonra gösterilir)';

/** A comparison as the panel may see it NOW: blind until it is decided */
async function load(id, { reveal = null } = {}) {
  const c = (await db.query('SELECT * FROM writer_comparisons WHERE id = $1', [V.uuid(id, 'Karşılaştırma')])).rows[0];
  if (!c) throw new HttpError(404, 'Karşılaştırma bulunamadı');
  const rows = (await db.query('SELECT * FROM writer_comparison_entries WHERE comparison_id = $1 ORDER BY label', [c.id])).rows;
  const decided = ['picked', 'discarded', 'failed'].includes(c.status); const show = reveal === null ? decided : reveal;
  const idea = (await db.query('SELECT o.title, k.keyword FROM content_opportunities o LEFT JOIN keywords k ON k.id = o.keyword_id WHERE o.id = $1', [c.opportunity_id])).rows[0] || {};
  const entries = rows.map((r) => {
    const base = { label: r.label, ok: r.status === 'ok', fields: r.status === 'ok' ? { ...r.fields, contentHtml: H.sanitizeArticleHtml(r.fields.contentHtml) } : null, measured: r.measured, error: r.status === 'ok' ? null : (show ? r.error : BLIND_GONE) };
    return show ? { ...base, provider: r.provider, model: r.model, costUsd: r.cost_micros === null ? null : Number(r.cost_micros) / MICROS, inputTokens: r.input_tokens, outputTokens: r.output_tokens, durationMs: r.duration_ms } : base;
  });
  return { id: c.id, projectId: c.project_id, opportunityId: c.opportunity_id, idea: idea.keyword || idea.title || '', status: c.status, blind: !show, entries, pickedLabel: c.picked_label, pickedArticleId: c.picked_article_id, note: c.note,
    error: c.status === 'failed' ? (show ? c.error : null) : null, createdAt: c.created_at, decidedAt: c.decided_at, comparable: rows.filter((r) => r.status === 'ok').length >= 2,
    ...(show ? { providers: c.providers } : { askedCount: c.providers.length }) };
}

/**
 * Starts a comparison for one idea (admin; spends money: one call per vendor). Returns at once; the drafts are written in the background.
 * @param o { providers: ['anthropic','openai'] (optional), userId, fetchImpl, fetcher, now, background, rng }
 */
async function start(opportunityId, { providers: wanted = null, userId = null, fetchImpl, fetcher, now = new Date(), background = true, rng } = {}) {
  const o = await writer.loadIdea(V.uuid(opportunityId, 'Fırsat'));
  if (['queued', 'written'].includes(o.status)) throw new HttpError(409, o.status === 'queued' ? 'Bu fikir için makale ya da karşılaştırma şu anda yazılıyor' : 'Bu fikir için makale zaten yazıldı');
  if (o.article_id) { const ex = (await db.query("SELECT status FROM articles WHERE id = $1 AND status NOT IN ('failed', 'archived')", [o.article_id])).rows[0]; if (ex) throw new HttpError(409, 'Bu fikir için makale zaten var'); }
  if (!o.eligible) throw new HttpError(409, `Bu fikir üretime uygun değil: ${o.ineligible_reason || 'koşullar sağlanmıyor'}`);
  if (!o.keyword) throw new HttpError(409, 'Bu fikrin odak anahtar kelimesi yok');
  const all = await llm.available(); const ready = all.filter((x) => x.ready);
  let chosen;
  if (wanted) {
    if (!Array.isArray(wanted)) throw new HttpError(400, 'Sağlayıcılar bir liste olmalı');
    chosen = [...new Set(wanted.map(String))];
    for (const k of chosen) { const x = all.find((y) => y.key === k); if (!x) throw new HttpError(400, `Bilinmeyen sağlayıcı: ${k}`); if (!x.ready) throw new HttpError(409, `${x.label} kullanılamıyor: ${x.reason}`); }
  } else chosen = ready.map((x) => x.key).slice(0, MAX);
  if (chosen.length > MAX) throw new HttpError(400, `En çok ${MAX} sağlayıcı karşılaştırılabilir`);
  if (chosen.length < MIN) throw new HttpError(409, `Karşılaştırma için en az ${MIN} hazır yapay zekâ sağlayıcısı gerekir (şu an hazır: ${ready.length}). API Kullanımı sayfasında bir sağlayıcı daha ekleyip bağlantıyı test edin.`);
  const cfg = (await settings.get('quality', o.project_id)).value;
  await runs.guardOne(writer.BOT, o.project_id);
  const grant = await limits.reserve({ workType: 'new_article', projectId: o.project_id, categoryId: o.category_id, amount: 1, manual: true, now });
  if (!grant.ok) throw new HttpError(409, grant.message, { limit: true });
  const prev = o.status === 'queued' ? 'new' : o.status;
  let cmp;
  try {
    cmp = (await db.query(`INSERT INTO writer_comparisons (project_id, opportunity_id, providers, prev_status, reserved_day, reserved_category, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [o.project_id, o.id, chosen, prev, grant.day, o.category_id || null, userId])).rows[0];
  } catch (err) { await limits.release({ workType: 'new_article', projectId: o.project_id, categoryId: o.category_id, amount: 1, day: grant.day }); if (err.code === '23505') throw new HttpError(409, 'Bu fikir için açık bir karşılaştırma zaten var'); throw err; }
  const run = await runs.start(writer.BOT, { projectId: o.project_id, trigger: 'manual', userId });
  await db.query("UPDATE content_opportunities SET status = 'queued', updated_at = now() WHERE id = $1", [o.id]);
  const job = pipeline(o, cmp, run, { chosen, cfg, grant, fetchImpl, fetcher, now, rng }).finally(() => pending.delete(cmp.id));
  pending.set(cmp.id, job);
  if (!background) await job;
  return { id: cmp.id, runId: run.id, askedCount: chosen.length };
}

async function pipeline(o, cmp, run, { chosen, cfg, grant, fetchImpl, fetcher, now, rng }) {
  const stats = { compare: true, idea: o.title, keyword: o.keyword, asked: chosen.length, costUsd: 0, unknownCost: 0, calls: 0, ok: 0 };
  const add = (u) => { if (!u) return; stats.calls++; if (u.costUsd === null || u.costUsd === undefined) stats.unknownCost++; else stats.costUsd = Math.round((stats.costUsd + u.costUsd) * 1e6) / 1e6; };
  try {
    await runs.progress(run.id, { ...stats, step: 'sources' });
    const srcs = await sources.gatherForTopic(o.topic_id, { fetcher });
    if (!srcs.length) throw new HttpError(409, 'Bu fikrin okunabilir bir kaynağı yok (haber olayı bulunamadı)');
    const niche = (await db.query('SELECT n.*, p.site_name FROM niche_profiles n JOIN content_projects p ON p.id = n.project_id WHERE n.project_id = $1', [o.project_id])).rows[0] || {};
    const secondary = (await db.query('SELECT keyword FROM keywords WHERE topic_id = $1 AND keyword <> $2 ORDER BY created_at LIMIT 6', [o.topic_id, o.keyword])).rows.map((r) => r.keyword);
    const system = writer.SYSTEM({ siteName: niche.site_name || 'the site', niche: niche.main_niche || 'technology news', audience: niche.target_audience, tone: cfg.tone, language: cfg.language, length: cfg.lengthPref, types: articles.TYPES });
    const related = await require('./siteLinks').relatedFor(o.project_id, { focus: o.keyword, title: o.topic_title || o.title });
    const user = writer.userPrompt({ title: o.topic_title || o.title, keyword: o.keyword }, srcs, secondary, related);
    await db.query('UPDATE writer_comparisons SET sources = $2 WHERE id = $1', [cmp.id, JSON.stringify(srcs)]);
    const order = shuffle(chosen, rng);                                           // the letters go to the vendors in a RANDOM order
    const entries = [];
    for (let i = 0; i < order.length; i++) {
      const provider = order[i]; const label = LABELS[i]; const t0 = Date.now();
      await runs.progress(run.id, { ...stats, step: 'writing', done: i, of: order.length });
      let out = null; let error = null;
      for (let attempt = 0; ; attempt++) {
        try { out = await llm.complete({ provider, system, user, maxTokens: 9000, json: true, projectId: o.project_id, operation: 'article_write', fetchImpl, now }); add(out); error = null; break; }
        catch (err) { if (err.inputTokens !== undefined || err.maybeBilled) add(err); if (err.code === 'bad_json' && attempt === 0) continue; error = err; break; }
      }
      const ms = Date.now() - t0;
      if (!error) {
        try {
          const fields = writer.normalizeOutput(out.data, { types: articles.TYPES, focus: o.keyword });
          fields.contentHtml = writer.limitLinks(fields.contentHtml, srcs, related).html;
          entries.push({ label, provider, model: out.model, status: 'ok', fields, measured: measure(fields, srcs, cfg.lengthPref), input: out.inputTokens, output: out.outputTokens, cost: out.costUsd, ms, error: null }); stats.ok++; continue;
        } catch (err) { add(err); error = err; }
      }
      entries.push({ label, provider, model: (out && out.model) || (error && error.model) || null, status: 'error', fields: null, measured: null, input: error && error.inputTokens !== undefined ? error.inputTokens : null, output: error && error.outputTokens !== undefined ? error.outputTokens : null,
        cost: error && error.costUsd !== undefined ? error.costUsd : null, ms, error: String((error && error.message) || error).slice(0, 300) });
    }
    for (const e of entries) await db.query(`INSERT INTO writer_comparison_entries (comparison_id, label, provider, model, status, fields, measured, input_tokens, output_tokens, cost_micros, duration_ms, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [cmp.id, e.label, e.provider, e.model, e.status, e.fields === null ? null : JSON.stringify(e.fields), e.measured === null ? null : JSON.stringify(e.measured), e.input, e.output, e.cost === null || e.cost === undefined ? null : Math.round(e.cost * MICROS), e.ms, e.error]);
    if (stats.ok === 0) throw Object.assign(new Error(entries[0] && entries[0].error ? `Hiçbir sağlayıcı taslak veremedi: ${entries[0].error}` : 'Hiçbir sağlayıcı taslak veremedi'), { maybeBilled: stats.calls > 0 });
    await db.query("UPDATE writer_comparisons SET status = 'ready' WHERE id = $1", [cmp.id]);
    await runs.finish(run.id, { status: stats.ok === order.length ? 'ok' : 'partial', stats: { ...stats, step: 'done' }, error: stats.ok === order.length ? null : `${order.length - stats.ok} sağlayıcı taslak veremedi` });
  } catch (err) {
    const billed = err.maybeBilled === true || stats.calls > 0;
    if (!billed) await limits.release({ workType: 'new_article', projectId: o.project_id, categoryId: o.category_id, amount: 1, day: grant.day });
    await db.query("UPDATE content_opportunities SET status = $2, updated_at = now() WHERE id = $1 AND status = 'queued'", [o.id, cmp.prev_status]);
    await db.query("UPDATE writer_comparisons SET status = 'failed', error = $2, decided_at = now() WHERE id = $1", [cmp.id, String((err && err.message) || err).slice(0, 400)]);
    await runs.finish(run.id, { status: 'error', stats: { ...stats, code: err.code || null }, error: err.message || String(err) });
  }
}

/**
 * Takes one draft as the article (a person's decision). The vendors are shown after this. The article gets the normal mandatory checks in the background.
 * @returns { comparison (revealed), articleId, runId }
 */
async function pick(id, label, { userId = null, fetchImpl, now = new Date(), background = true } = {}) {
  const lab = V.oneOf(String(label || '').toUpperCase(), 'Taslak', LABELS);
  const claimed = (await db.query("UPDATE writer_comparisons SET status = 'picking' WHERE id = $1 AND status = 'ready' RETURNING *", [V.uuid(id, 'Karşılaştırma')])).rows[0];
  if (!claimed) { const ex = (await db.query('SELECT status FROM writer_comparisons WHERE id = $1', [id])).rows[0]; if (!ex) throw new HttpError(404, 'Karşılaştırma bulunamadı'); throw new HttpError(409, ex.status === 'running' ? 'Taslaklar hâlâ yazılıyor; bitmesini bekleyin' : 'Bu karşılaştırma için karar zaten verildi'); }
  const back = async () => db.query("UPDATE writer_comparisons SET status = 'ready' WHERE id = $1 AND status = 'picking'", [claimed.id]);
  let entry; let o; let who; let cfg;
  try {
    entry = (await db.query("SELECT * FROM writer_comparison_entries WHERE comparison_id = $1 AND label = $2", [claimed.id, lab])).rows[0];
    if (!entry || entry.status !== 'ok') throw new HttpError(400, `${lab} taslağı yok ya da yazılamamış`);
    o = await writer.loadIdea(claimed.opportunity_id);
    cfg = (await settings.get('quality', claimed.project_id)).value;
    who = await writer.pickProviders(cfg, entry.provider);                         // the checker is another ready vendor when there is one
  } catch (err) { await back(); throw err; }
  let article;
  try {
    article = await articles.createFromAi({ ...entry.fields, targetCountry: 'US', language: cfg.language }, { projectId: claimed.project_id, categoryId: o.category_id,
      generation: { provider: entry.provider, model: entry.model, inputTokens: entry.input_tokens, outputTokens: entry.output_tokens, costUsd: entry.cost_micros === null ? null : Number(entry.cost_micros) / MICROS, promptVersion: writer.PROMPT_VERSION, opportunityId: o.id, topicId: o.topic_id, checker: who.checker, independentChecker: who.independent, comparisonId: claimed.id, blindPick: lab }, sources: claimed.sources });
  } catch (err) { await back(); throw err; }
  await db.query("UPDATE writer_comparisons SET status = 'picked', picked_label = $2, picked_article_id = $3, decided_by = $4, decided_at = $5 WHERE id = $1", [claimed.id, lab, article.id, userId, now]);
  await db.query('UPDATE content_opportunities SET article_id = $2, updated_at = now() WHERE id = $1', [o.id, article.id]);
  const run = await runs.start(writer.BOT, { projectId: claimed.project_id, trigger: 'manual', userId });
  const job = finishPicked(o, article, run, { who, fetchImpl, now }).finally(() => pending.delete(`pick:${claimed.id}`));
  pending.set(`pick:${claimed.id}`, job);
  if (!background) await job;
  return { comparison: await load(claimed.id), articleId: article.id, runId: run.id };
}

async function finishPicked(o, article, run, { who, fetchImpl, now }) {
  const stats = { compare: 'pick', articleId: article.id, checker: who.checker, costUsd: 0, unknownCost: 0, calls: 0 };
  const add = (u) => { if (!u) return; stats.calls++; if (u.costUsd === null || u.costUsd === undefined) stats.unknownCost++; else stats.costUsd = Math.round((stats.costUsd + u.costUsd) * 1e6) / 1e6; };
  try {
    await runs.progress(run.id, { ...stats, step: 'checking' });
    const res = await checks.runAll(article.id, { mode: 'all', checkerProvider: who.checker, fetchImpl, now });
    for (const u of res.usage) add(u);
    await db.query("UPDATE articles SET status = 'needs_review', updated_at = now() WHERE id = $1 AND status = 'fact_checking'", [article.id]);
    await db.query("UPDATE content_opportunities SET status = 'written', updated_at = now() WHERE id = $1", [o.id]);
    await db.query("UPDATE topics SET status = 'used' WHERE id = $1", [o.topic_id]);
    await notifications.create({ type: 'article_ready', severity: 'info', title: `Yeni makale taslağı hazır: ${String(article.h1 || '').slice(0, 90)}`, body: `Karşılaştırmada seçtiğiniz taslak. Kalite ${res.applied.qualityScore === null ? 'ölçülemedi' : res.applied.qualityScore}, AdSense riski ${res.applied.adsenseRisk || 'ölçülemedi'}, doğruluk kontrolü ${res.applied.factChecked ? 'geçti' : 'geçmedi/yapılamadı'}. Onayınızı bekliyor; kendiliğinden yayımlanmaz.`, data: { articleId: article.id } });
    await runs.finish(run.id, { status: res.errors.length || res.applied.qualityScore === null ? 'partial' : 'ok', stats: { ...stats, step: 'done', errors: res.errors }, error: res.errors.length ? res.errors[0].message : null });
  } catch (err) {
    await db.query("UPDATE articles SET status = 'needs_review', updated_at = now() WHERE id = $1 AND status = 'fact_checking'", [article.id]);
    await db.query("UPDATE content_opportunities SET status = 'written', updated_at = now() WHERE id = $1", [o.id]);
    await db.query("UPDATE topics SET status = 'used' WHERE id = $1", [o.topic_id]);
    await runs.finish(run.id, { status: 'partial', stats: { ...stats, failedAt: 'checking' }, error: err.message || String(err) });
  }
}

/** None of the drafts: the vendors are shown, the idea goes back to what it was, the day's place is given back (the calls were still paid for) */
async function discard(id, { userId = null, note = '', now = new Date() } = {}) {
  const c = (await db.query("UPDATE writer_comparisons SET status = 'discarded', decided_by = $2, decided_at = $3, note = $4 WHERE id = $1 AND status = 'ready' RETURNING *", [V.uuid(id, 'Karşılaştırma'), userId, now, V.str(note, 'Not', { max: 500, multiline: true })])).rows[0];
  if (!c) { const ex = (await db.query('SELECT status FROM writer_comparisons WHERE id = $1', [id])).rows[0]; if (!ex) throw new HttpError(404, 'Karşılaştırma bulunamadı'); throw new HttpError(409, ex.status === 'running' ? 'Taslaklar hâlâ yazılıyor' : 'Bu karşılaştırma için karar zaten verildi'); }
  const o = (await db.query('SELECT category_id FROM content_opportunities WHERE id = $1', [c.opportunity_id])).rows[0];
  if (c.reserved_day) await limits.release({ workType: 'new_article', projectId: c.project_id, categoryId: o ? o.category_id : c.reserved_category, amount: 1, day: c.reserved_day });
  await db.query("UPDATE content_opportunities SET status = $2, updated_at = now() WHERE id = $1 AND status = 'queued'", [c.opportunity_id, c.prev_status]);
  return load(c.id);
}

async function list(projectId, { limit = 20 } = {}) {
  const rows = (await db.query(`SELECT c.id FROM writer_comparisons c WHERE c.project_id = $1 ORDER BY c.created_at DESC LIMIT ${Math.min(50, Math.max(1, limit | 0 || 20))}`, [V.uuid(projectId, 'Proje')])).rows;
  const out = []; for (const r of rows) { const c = await load(r.id); out.push({ ...c, entries: c.entries.map((e) => ({ label: e.label, ok: e.ok, ...(c.blind ? {} : { provider: e.provider, model: e.model, costUsd: e.costUsd }), words: e.measured ? e.measured.words : null })) }); }
  return out;
}

/** Your own decisions so far (decided comparisons only: nothing about an open one leaks). A preference, not a measurement of quality. */
async function stats(projectId = null) {
  const rows = (await db.query(`SELECT c.id, c.status, c.picked_label, e.provider, e.label, e.status AS estatus, e.cost_micros, (e.measured->>'words')::int AS words
    FROM writer_comparisons c JOIN writer_comparison_entries e ON e.comparison_id = c.id WHERE c.status IN ('picked', 'discarded') ${projectId ? 'AND c.project_id = $1' : ''}`, projectId ? [V.uuid(projectId, 'Proje')] : [])).rows;
  const by = new Map();
  for (const r of rows) {
    if (r.estatus !== 'ok') continue;
    const x = by.get(r.provider) || { provider: r.provider, shown: 0, picked: 0, costs: [], unknownCost: 0, words: [] };
    x.shown++; if (r.status === 'picked' && r.picked_label === r.label) x.picked++;
    if (r.cost_micros === null) x.unknownCost++; else x.costs.push(Number(r.cost_micros) / MICROS);
    if (r.words !== null) x.words.push(r.words); by.set(r.provider, x);
  }
  const decisions = new Set(rows.map((r) => r.id)).size; const picks = new Set(rows.filter((r) => r.status === 'picked').map((r) => r.id)).size;
  const providers = [...by.values()].map((x) => ({ provider: x.provider, shown: x.shown, picked: x.picked, pickRate: x.shown ? Math.round((x.picked / x.shown) * 100) : null, avgCostUsd: x.costs.length && !x.unknownCost ? Math.round((x.costs.reduce((a, b) => a + b, 0) / x.costs.length) * 10000) / 10000 : null,
    unknownCostDrafts: x.unknownCost, avgWords: x.words.length ? Math.round(x.words.reduce((a, b) => a + b, 0) / x.words.length) : null })).sort((a, b) => b.picked - a.picked || a.provider.localeCompare(b.provider));
  const lead = providers[0] && providers[0].picked > 0 && (providers.length === 1 || providers[0].picked > providers[1].picked) ? providers[0].provider : null;
  return { decisions, picks, none: decisions - picks, providers, leader: decisions >= 3 ? lead : null,
    note: decisions < 3 ? 'En az 3 karardan sonra bir eğilim gösterilir; şimdiki sayı kanıt sayılamaz.' : 'Bunlar YALNIZCA sizin seçimlerinizdir: bir kalite ölçümü değildir. Az sayıda karar rastlantı olabilir; seçtiğiniz taslakların doğruluk ve AdSense kontrolü sonuçlarına da bakın.' };
}

/** a comparison whose process died while writing: failed (its idea goes back to what it was; the day's place stays used because calls may have been billed) */
async function closeStale() {
  const rows = (await db.query("UPDATE writer_comparisons SET status = 'failed', error = 'Süreç yeniden başladığı için yarıda kaldı', decided_at = now() WHERE status = 'running' AND created_at < now() - interval '30 minutes' RETURNING *")).rows;
  for (const c of rows) await db.query("UPDATE content_opportunities SET status = $2, updated_at = now() WHERE id = $1 AND status = 'queued'", [c.opportunity_id, c.prev_status]);
  const picking = (await db.query("UPDATE writer_comparisons SET status = 'ready' WHERE status = 'picking' AND created_at < now() - interval '2 hours' AND picked_article_id IS NULL RETURNING id")).rowCount;
  return rows.length + picking;
}

const wait = (id) => pending.get(id) || Promise.resolve();

module.exports = { MIN, MAX, LABELS, shuffle, measure, load, start, pick, discard, list, stats, closeStale, wait };
