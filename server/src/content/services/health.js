const db = require('../db');
const safeFetch = require('../lib/safeFetch');
const { HttpError } = require('../lib/http');
const settings = require('./settings');
const articles = require('./articles');

/**
 * Content health: are the live articles still correct and reachable? Everything here is FREE (no model): link checks and a look at the news that came after the article.
 *  - a link is "broken" only when the page is gone (404/410) or the name does not exist; blocked / busy / timeout answers are "error" = unknown, never counted
 *  - "new developments" = recent, relevant, reasonably reliable headlines that mention the article's focus phrase and are not its own sources
 *  - an article that is merely old is NOT flagged for an update (a check does not force a change); it is flagged when there is evidence: a broken link or new developments
 *  - every article is looked at on its own timetable (the update intervals of the settings), limited by the daily "old article check" limit
 */
const LIVE = ['published', 'scheduled', 'ready', 'needs_update'];
const CLASS = { breaking_news_explainer: 'breaking', latest_update: 'currentTech', product_update: 'currentTech', consumer_alert: 'currentTech', how_to_guide: 'guides', comparison: 'comparisons', faq: 'evergreen', evergreen_guide: 'evergreen' };
const CLASS_LABEL = { breaking: 'Son dakika', currentTech: 'Güncel teknoloji', aiTools: 'AI araçları', guides: 'Rehber', comparisons: 'Karşılaştırma', evergreen: 'Evergreen' };
const MIN_RELIABILITY = 60;

/** which update interval applies to an article */
function classOf(articleType, categoryName = '') {
  const c = CLASS[articleType] || 'evergreen';
  if (/\bai\b|artificial/i.test(categoryName) && ['currentTech', 'guides'].includes(c)) return 'aiTools';
  return c;
}

const linksOf = (html) => [...new Set([...String(html || '').matchAll(/<a\s[^>]*href=["'](https?:\/\/[^"'\s]+)["']/gi)].map((m) => m[1]))];

async function mapLimit(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}

/** Checks the addresses an article uses (content links, then its sources) and keeps the newest answer of each. @returns { checked, broken: [{ url, note }], redirects, unknown } */
async function checkLinks(articleId, { probe = safeFetch.probe } = {}) {
  const a = (await db.query('SELECT id, content_html FROM articles WHERE id = $1', [articleId])).rows[0];
  if (!a) throw new HttpError(404, 'Makale bulunamadı');
  const content = linksOf(a.content_html).slice(0, 25);
  const srcs = (await db.query('SELECT url FROM article_sources WHERE article_id = $1 LIMIT 15', [articleId])).rows.map((r) => r.url).filter((u) => !content.includes(u));
  const items = [...content.map((url) => ({ url, kind: 'content' })), ...srcs.map((url) => ({ url, kind: 'source' }))];
  const res = await mapLimit(items, 3, async (it) => ({ ...it, r: await probe(it.url) }));
  await db.query('DELETE FROM link_checks WHERE article_id = $1 AND NOT (url = ANY($2))', [articleId, items.map((i) => i.url)]);
  for (const x of res) {
    await db.query(`INSERT INTO link_checks (article_id, url, kind, status, http_status, final_url, note, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
      ON CONFLICT (article_id, url) DO UPDATE SET kind = $3, status = $4, http_status = $5, final_url = $6, note = $7, checked_at = now()`, [articleId, x.url, x.kind, x.r.status, x.r.http, x.r.finalUrl, String(x.r.note || '').slice(0, 200)]);
  }
  return { checked: res.length, broken: res.filter((x) => x.r.status === 'broken').map((x) => ({ url: x.url, note: x.r.note, kind: x.kind })), redirects: res.filter((x) => x.r.status === 'redirect').length, unknown: res.filter((x) => x.r.status === 'error').length };
}

/** relevant recent headlines about the article's topic that appeared after `since` (and are not its own sources) */
async function developments(a, since) {
  const focus = String(a.focus_keyword || '').trim();
  if (focus.length < 3) return [];
  const like = `%${focus.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const own = (await db.query('SELECT url FROM article_sources WHERE article_id = $1', [a.id])).rows.map((r) => r.url);
  return (await db.query(`SELECT i.title, i.url, i.source_name, i.reliability, coalesce(i.published_at, i.fetched_at) AS at FROM news_items i
    WHERE i.project_id = $1 AND i.status = 'relevant' AND i.reliability >= $2 AND coalesce(i.published_at, i.fetched_at) > $3 AND i.title ILIKE $4 ESCAPE '\\' AND NOT (i.url = ANY($5))
    ORDER BY i.reliability DESC, at DESC LIMIT 8`, [a.project_id, MIN_RELIABILITY, since, like, own])).rows;
}

/** the free assessment of one article (reads, writes nothing) */
async function assess(articleId, { now = new Date() } = {}) {
  const a = (await db.query('SELECT a.*, c.name_en AS category_name FROM articles a LEFT JOIN categories c ON c.id = a.category_id WHERE a.id = $1', [articleId])).rows[0];
  if (!a) throw new HttpError(404, 'Makale bulunamadı');
  const cfg = (await settings.get('update', a.project_id)).value; const cls = classOf(a.article_type, a.category_name || ''); const interval = cfg.intervalDays[cls];
  const anchor = new Date(a.last_updated_at || a.created_at);
  const ageDays = Math.floor((now - anchor) / 86400000); const since = a.last_checked_at && new Date(a.last_checked_at) > anchor ? new Date(a.last_checked_at) : anchor;
  const broken = (await db.query("SELECT url, note, kind FROM link_checks WHERE article_id = $1 AND status = 'broken' ORDER BY url", [a.id])).rows;
  const dev = await developments(a, since);
  const open = (await db.query("SELECT id, kind FROM refresh_proposals WHERE article_id = $1 AND status = 'proposed'", [a.id])).rows[0] || null;
  const signals = [];
  if (broken.length) signals.push({ code: 'broken_links', text: `${broken.length} bağlantı bozuk: ${broken.slice(0, 3).map((b) => b.url).join(', ')}` });
  if (dev.length) signals.push({ code: 'developments', text: `Makaleden sonra konuyla ilgili ${dev.length} yeni haber çıktı (ör. “${dev[0].title.slice(0, 80)}”)` });
  const overdue = ageDays > interval;
  return { articleId: a.id, class: cls, classLabel: CLASS_LABEL[cls], intervalDays: interval, ageDays, overdue, overdueDays: overdue ? ageDays - interval : 0, brokenLinks: broken, developments: dev, signals, needsUpdate: signals.length > 0, openProposal: open, anchor, since };
}

/**
 * The scheduled look at one article: link check, assessment, timetable. Only EVIDENCE (a broken link, new developments) flags it "needs_update"; being old alone does not.
 * @returns { assessment, links, flagged }
 */
async function checkOne(articleId, { now = new Date(), probe } = {}) {
  const links = await checkLinks(articleId, { probe });
  const as = await assess(articleId, { now });
  const everyDays = Math.max(1, Math.min(14, Math.round(as.intervalDays / 3)));
  const health = { signals: as.signals, brokenLinks: as.brokenLinks.length, developments: as.developments.length, overdueDays: as.overdueDays, class: as.class, assessedAt: now.toISOString() };
  await db.query('UPDATE articles SET last_checked_at = $2, next_check_at = $3, health = $4, updated_at = updated_at WHERE id = $1', [articleId, now, new Date(now.getTime() + everyDays * 86400000), JSON.stringify(health)]);
  let flagged = false;
  if (as.needsUpdate) flagged = (await db.query("UPDATE articles SET status = 'needs_update' WHERE id = $1 AND status IN ('published', 'scheduled', 'ready')", [articleId])).rowCount > 0;
  return { assessment: as, links, flagged };
}

/** live articles that are due for a look, the most overdue first */
async function due(projectId, { now = new Date(), limit = 10 } = {}) {
  return (await db.query(`SELECT id FROM articles WHERE project_id = $1 AND status = ANY($2) AND (next_check_at IS NULL OR next_check_at <= $3) ORDER BY next_check_at NULLS FIRST, created_at LIMIT $4`, [projectId, LIVE, now, Math.min(500, limit)])).rows.map((r) => r.id);
}

const PRIORITY = { critical: 100, broken: 12, developments: 25, risk: { review: 15, blocked: 30 } };
/** a number to sort the "what to update first" list by (higher = sooner) */
function priority(row, assessmentHealth, proposal) {
  let p = 0; const h = assessmentHealth || {};
  if (proposal && proposal.kind === 'critical') p += PRIORITY.critical;
  p += Math.min(36, (h.brokenLinks || 0) * PRIORITY.broken); if (h.developments) p += PRIORITY.developments;
  p += (PRIORITY.risk[row.adsense_risk] || 0); p += Math.min(15, Math.floor((h.overdueDays || 0) / 10));                     // being old counts less than evidence
  if (row.status === 'needs_update') p += 10;
  return p;
}

/** the "İçerik Sağlığı" page: counts and the list of live articles in update order */
async function overview(projectId, { now = new Date() } = {}) {
  const rows = (await db.query(`SELECT a.id, a.h1, a.slug, a.status, a.article_type, a.quality_score, a.adsense_risk, a.last_updated_at, a.last_checked_at, a.next_check_at, a.created_at, a.health, a.current_version, c.name_en AS category_name,
      (SELECT p.wp_url FROM publications p WHERE p.article_id = a.id AND p.wp_url IS NOT NULL ORDER BY (p.status = 'published') DESC, p.updated_at DESC LIMIT 1) AS wp_url,
      (SELECT ch.status FROM article_checks ch WHERE ch.article_id = a.id AND ch.kind = 'rules' ORDER BY ch.id DESC LIMIT 1) AS seo_status,
      (SELECT count(*)::int FROM link_checks lc WHERE lc.article_id = a.id AND lc.status = 'broken') AS broken,
      (SELECT json_build_object('id', r.id, 'kind', r.kind, 'summary', r.summary) FROM refresh_proposals r WHERE r.article_id = a.id AND r.status = 'proposed' LIMIT 1) AS proposal
    FROM articles a LEFT JOIN categories c ON c.id = a.category_id WHERE a.project_id = $1 AND a.status = ANY($2) ORDER BY a.created_at DESC LIMIT 500`, [projectId, LIVE])).rows;
  const cfg = (await settings.get('update', projectId)).value;
  const items = rows.map((r) => {
    const cls = classOf(r.article_type, r.category_name || ''); const anchor = new Date(r.last_updated_at || r.created_at); const ageDays = Math.floor((now - anchor) / 86400000);
    const overdueDays = Math.max(0, ageDays - cfg.intervalDays[cls]); const h = { ...(r.health || {}), overdueDays };
    return { id: r.id, title: r.h1, status: r.status, class: cls, classLabel: CLASS_LABEL[cls], qualityScore: r.quality_score, adsenseRisk: r.adsense_risk, lastCheckedAt: r.last_checked_at, nextCheckAt: r.next_check_at, lastUpdatedAt: r.last_updated_at, createdAt: r.created_at,
      wpUrl: r.wp_url, seoStatus: r.seo_status, brokenLinks: r.broken, signals: (r.health && r.health.signals) || [], overdueDays, proposal: r.proposal, priority: priority(r, h, r.proposal), version: r.current_version };
  }).sort((x, y) => y.priority - x.priority || x.title.localeCompare(y.title));
  const d30 = new Date(now.getTime() - 30 * 86400000);
  const critical = (await db.query("SELECT count(*)::int n FROM refresh_proposals WHERE project_id = $1 AND status = 'proposed' AND kind = 'critical'", [projectId])).rows[0].n;
  const open = (await db.query("SELECT count(*)::int n FROM refresh_proposals WHERE project_id = $1 AND status = 'proposed'", [projectId])).rows[0].n;
  return {
    counts: { published: items.filter((i) => i.status === 'published').length, live: items.length, awaitingUpdate: items.filter((i) => i.status === 'needs_update').length, openProposals: open,
      updatedLast30: items.filter((i) => i.lastUpdatedAt && new Date(i.lastUpdatedAt) > d30).length, withBrokenLinks: items.filter((i) => i.brokenLinks > 0).length, outdated: items.filter((i) => i.overdueDays > 0).length,
      adsenseRisky: items.filter((i) => ['review', 'blocked'].includes(i.adsenseRisk)).length, criticalPending: critical, neverChecked: items.filter((i) => !i.lastCheckedAt).length },
    items, intervals: cfg.intervalDays, policy: cfg.policy, performance: { connected: false, note: 'Search Console bağlı değil: performans verisi yok (uydurulmaz)' },
  };
}

module.exports = { LIVE, CLASS_LABEL, classOf, linksOf, checkLinks, developments, assess, checkOne, due, priority, overview };
