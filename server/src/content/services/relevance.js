const db = require('../db');
const { matchTerms } = require('../lib/text');
const { matchExcluded } = require('./projects');

/**
 * Is a headline inside this project's niche? Fixed, readable rules over the project's OWN data (categories' keywords, excluded topics), no AI:
 *  1. a phrase from the excluded-topics list (project-wide or of the category) -> "excluded"
 *  2. every category scores the headline from its keywords: a STRONG term (product / company / specific phrase) in the headline counts 40 (two: 80),
 *     in the short summary 15; a WEAK, generic term ("ai", "app", "update", "privacy" ...) counts only 12 / 5. One strong term in the headline is enough,
 *     generic words alone are not: "Afraid of AI? You're never too old to learn" does not become content for an AI-tools site.
 *  3. an official source (reliability >= 85) that matches at least one strong term gets +10 (company announcements are usually on topic)
 *  4. relevance = the best category's score; >= minRelevance (news setting, default 35) -> "relevant"
 * The result always says WHICH terms matched, so a person can see why and fix the keyword lists. Borderline cases are for the AI step of phase 3.
 */
const WEAK_TERMS = new Set(['ai', 'artificial intelligence', 'machine learning', 'tech', 'technology', 'digital', 'software', 'app', 'apps', 'online', 'internet', 'cyber', 'data', 'update', 'updates',
  'fix', 'guide', 'tips', 'feature', 'features', 'security', 'privacy', 'free', 'price', 'pricing', 'new', 'tracking', 'password', 'passwords', 'reset', 'enable', 'disable', 'cancel', 'tier', 'beta',
  'leak', 'leaked', 'premium', 'bundle', 'explained', 'what is', 'turn on', 'turn off', 'recover', 'beginner', 'checklist', 'outage', 'setup guide', 'worth it', 'a month', 'per month', 'discontinue',
  'how to', 'how do i', 'rolling out', 'rolls out', 'now available', 'scam', 'scams', 'shutting down', 'discontinued', 'cheat sheet', 'hijack', 'hijacked', 'stable channel', 'sunset']);
const OFFICIAL = 85;

/** Reads what the filter needs for one project: categories with their keyword lists and the excluded topics. */
async function loadContext(projectId) {
  const cats = (await db.query("SELECT id, name, name_en, related_keywords, excluded_topics, priority FROM categories WHERE project_id = $1 AND status = 'active' ORDER BY priority, name_en", [projectId])).rows;
  const ex = (await db.query('SELECT topic, category_id FROM excluded_topics WHERE project_id = $1 AND is_active', [projectId])).rows;
  return {
    categories: cats.map((c) => ({ id: c.id, name: c.name_en, keywords: c.related_keywords || [], excluded: c.excluded_topics || [] })),
    excludedAll: ex.filter((x) => !x.category_id).map((x) => x.topic),
    excludedByCategory: ex.filter((x) => x.category_id),
  };
}

function scoreCategory(cat, title, summary) {
  const strong = []; const weak = [];
  let t = 0; let s = 0; let wt = 0; let ws = 0;
  const inTitle = matchTerms(title, cat.keywords); const inSummary = matchTerms(summary, cat.keywords);
  for (const k of inTitle) { if (WEAK_TERMS.has(k.toLowerCase())) { wt++; weak.push(k); } else { t++; strong.push(k); } }
  for (const k of inSummary) {
    if (inTitle.includes(k)) continue;
    if (WEAK_TERMS.has(k.toLowerCase())) { ws++; weak.push(k); } else { s++; strong.push(k); }
  }
  const score = Math.min(100, 40 * Math.min(2, t) + 15 * Math.min(3, s) + 12 * Math.min(2, wt) + 5 * Math.min(2, ws));
  return { score, strong: [...new Set(strong)], weak: [...new Set(weak)] };
}

/**
 * @param item { title, summary, reliability, sourceName }  (sourceName = the name of the feed the owner chose, e.g. "Google Chrome Releases"; used like the summary. Never a publisher of an aggregator feed.)
 * @param ctx  loadContext() result  @param opts { minRelevance }
 * @returns { status: 'relevant' | 'irrelevant' | 'excluded', relevance, categoryId, matched, reason }
 */
function classify(item, ctx, { minRelevance = 35 } = {}) {
  const title = item.title || ''; const summary = item.summary || '';
  const context = `${summary} . ${item.sourceName || ''}`;        // the feed's own name tells what an untitled-by-brand headline is about
  const text = `${title} . ${context}`;
  const ex = matchExcluded(text, ctx.excludedAll);
  if (ex.length) return { status: 'excluded', relevance: 0, categoryId: null, matched: [], reason: `Kapsam dışı konu: ${ex.join(', ')}` };
  let best = null;
  for (const cat of ctx.categories) {
    const r = scoreCategory(cat, title, context);
    if (!best || r.score > best.score) best = { ...r, cat };
  }
  if (best && best.score > 0) {
    const catEx = [...best.cat.excluded, ...ctx.excludedByCategory.filter((x) => x.category_id === best.cat.id).map((x) => x.topic)];
    const hit = matchExcluded(text, catEx);
    if (hit.length) return { status: 'excluded', relevance: 0, categoryId: best.cat.id, matched: [], reason: `“${best.cat.name}” kategorisinde kapsam dışı: ${hit.join(', ')}` };
  }
  if (!best || best.score === 0) return { status: 'irrelevant', relevance: 0, categoryId: null, matched: [], reason: 'Nişe uygun terim bulunamadı' };
  let relevance = best.score;
  if ((item.reliability || 0) >= OFFICIAL && best.strong.length) relevance = Math.min(100, relevance + 10);
  const matched = [...best.strong, ...best.weak];
  if (relevance >= minRelevance) return { status: 'relevant', relevance, categoryId: best.cat.id, matched, reason: `“${best.cat.name}”: ${matched.slice(0, 6).join(', ')}` };
  return { status: 'irrelevant', relevance, categoryId: best.cat.id, matched, reason: best.strong.length ? `Yetersiz eşleşme (${relevance}/${minRelevance}): ${matched.slice(0, 5).join(', ')}` : `Yalnızca genel terimler eşleşti (${matched.slice(0, 4).join(', ')}): ${relevance}/${minRelevance}` };
}

module.exports = { classify, loadContext, WEAK_TERMS };
