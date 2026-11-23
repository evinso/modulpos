const db = require('../db');
const settings = require('./settings');
const articles = require('./articles');
const audit = require('./audit');

/**
 * Automatic approval of a freshly written AI article ("Otomasyon Modu" -> "Kontrollerden temiz geçen makaleyi kendiliğinden Yayına hazır yap").
 *
 * It is OFF unless the owner switched it on (setting quality.manualApprovalNewArticles = false; the default and every older project keep manual approval).
 * It adds NO rule of its own and relaxes none: the article must pass `articles.readiness()` exactly as a person's "Yayına hazır" would (fact check done and
 * not failed, AdSense risk "low", quality score present and >= the project's minimum, enough words, category, sources, no duplicate, no excluded topic).
 * Anything else stays "İnceleme bekliyor" with the reasons returned here, so the owner sees WHY it was not approved.
 * Only AI-written articles in "needs_review" are touched; a person's article or a later status is never moved.
 */
async function approveIfClean(articleId) {
  const a = (await db.query('SELECT id, project_id, status, created_by, quality_score, adsense_risk FROM articles WHERE id = $1', [articleId])).rows[0];
  if (!a || a.status !== 'needs_review' || a.created_by !== 'ai') return { approved: false, reason: 'not_applicable' };
  const q = (await settings.get('quality', a.project_id)).value;
  if (q.manualApprovalNewArticles !== false) return { approved: false, reason: 'manual' };
  const r = await articles.readiness(a.id);
  const blocking = r.problems.filter((p) => p.blocking).map((p) => p.message);
  if (blocking.length) return { approved: false, reason: 'blocked', problems: blocking };
  const done = await db.query("UPDATE articles SET status = 'ready', updated_at = now() WHERE id = $1 AND status = 'needs_review'", [a.id]);
  if (!done.rowCount) return { approved: false, reason: 'changed' };
  await audit.audit(null, { action: 'article.auto_approve', entity: 'article', entityId: a.id, before: { status: 'needs_review' }, after: { status: 'ready', by: 'automation', qualityScore: a.quality_score, adsenseRisk: a.adsense_risk, minScore: q.minScore } });
  return { approved: true, qualityScore: a.quality_score };
}

module.exports = { approveIfClean };
