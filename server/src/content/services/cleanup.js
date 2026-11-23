const db = require('../db');
const V = require('../lib/validate');
const settings = require('./settings');

/**
 * Found-but-unused research must not pile up. Every kind of finding has ONE life: found -> (used | queued | waiting) -> gone.
 *  - an idea whose article was written is removed after `writtenDays` (the article keeps its own copy of the sources);
 *  - an idea nobody used is removed once its news is older than `ideaDays` (it can never win a place again: the time wave has passed). `ideaDays` must stay above the 7 days an event may still
 *    create a new idea in (opportunities.createTopics), otherwise the same event would come back as a "new" idea; the setting's minimum is 8;
 *  - an idea on the SHORT LIST or being written is never removed (a person or the writer is on it); an idea a person typed in is never removed;
 *  - keywords found by the system (news / related / suggestion / question) that belong to no idea any more are removed after `keywordDays` (`researchedKeywordDays` when real data was fetched for them);
 *    a keyword a person typed in or imported ('manual') is never removed; the monthly Apify cap counts API usage rows, not keyword rows, so removing keywords cannot reopen the cap;
 *  - niche suggestions nobody decided are removed after `nicheDays` (they come back by themselves while the news keeps supporting them), "later" after 60 days, "rejected" after 90 days, accepted ones stay.
 * `plan()` only COUNTS (the panel shows it before anything is removed); `run()` removes exactly what plan() counts, in one transaction. Never touches articles, sites, settings or manual entries.
 */
const DAY = 86400000;
const iso = (d) => d.toISOString();

async function rules(projectId) { return (await settings.get('retention', projectId)).value; }

/** the ids each rule would remove */
async function select(projectId, cfg, now, c = db) {
  const cut = (days) => iso(new Date(now.getTime() - days * DAY));
  const written = (await c.query("SELECT id FROM content_opportunities WHERE project_id = $1 AND status = 'written' AND updated_at < $2", [projectId, cut(cfg.writtenDays)])).rows.map((r) => r.id);
  const topics = (await c.query(`SELECT t.id FROM topics t LEFT JOIN news_clusters nc ON nc.id = t.cluster_id LEFT JOIN content_opportunities o ON o.topic_id = t.id
    WHERE t.project_id = $1 AND t.origin = 'news' AND COALESCE(nc.last_seen_at, t.created_at) < $2 AND (o.id IS NULL OR o.status NOT IN ('shortlisted', 'queued'))`, [projectId, cut(cfg.ideaDays)])).rows.map((r) => r.id);
  const kw = (await c.query(`SELECT k.id FROM keywords k WHERE k.project_id = $1 AND k.origin <> 'manual' AND (k.topic_id IS NULL OR k.topic_id = ANY($4::uuid[])) AND NOT EXISTS (SELECT 1 FROM content_opportunities o WHERE o.keyword_id = k.id AND o.topic_id <> ALL($4::uuid[]))
    AND k.created_at < (CASE WHEN EXISTS (SELECT 1 FROM keyword_metrics m WHERE m.keyword_id = k.id AND m.found) THEN $2::timestamptz ELSE $3::timestamptz END)`, [projectId, cut(cfg.researchedKeywordDays), cut(cfg.keywordDays), topics])).rows.map((r) => r.id);
  const nicheNew = (await c.query("SELECT id FROM niche_suggestions WHERE project_id = $1 AND status = 'new' AND created_at < $2", [projectId, cut(cfg.nicheDays)])).rows.map((r) => r.id);
  const nicheLater = (await c.query("SELECT id FROM niche_suggestions WHERE project_id = $1 AND status = 'later' AND COALESCE(decided_at, created_at) < $2", [projectId, cut(60)])).rows.map((r) => r.id);
  const nicheRejected = (await c.query("SELECT id FROM niche_suggestions WHERE project_id = $1 AND status = 'rejected' AND COALESCE(decided_at, created_at) < $2", [projectId, cut(90)])).rows.map((r) => r.id);
  return { written, topics, keywords: kw, niche: [...nicheNew, ...nicheLater, ...nicheRejected], nicheParts: { undecided: nicheNew.length, later: nicheLater.length, rejected: nicheRejected.length } };
}

const counts = (sel) => ({ usedIdeas: sel.written.length, staleIdeas: sel.topics.length, keywords: sel.keywords.length, nicheSuggestions: sel.niche.length, nicheParts: sel.nicheParts });

/** what a run would remove right now (nothing is changed) */
async function plan(projectId, { now = new Date() } = {}) {
  const cfg = await rules(projectId); const sel = await select(projectId, cfg, now);
  return { auto: !!cfg.auto, rules: cfg, would: counts(sel) };
}

/** removes what plan() counts. @param o { trigger, now } @returns { removed } */
async function run(projectId, { trigger = 'schedule', now = new Date() } = {}) {
  const cfg = await rules(projectId);
  const removed = await db.tx(async (c) => {
    const sel = await select(projectId, cfg, now, c);
    if (sel.written.length) await c.query('DELETE FROM content_opportunities WHERE id = ANY($1::uuid[])', [sel.written]);
    if (sel.keywords.length) await c.query('DELETE FROM keywords WHERE id = ANY($1::uuid[])', [sel.keywords]);                       // metrics and SERP analyses go with them (ON DELETE CASCADE)
    if (sel.topics.length) await c.query('DELETE FROM topics WHERE id = ANY($1::uuid[])', [sel.topics]);                              // the idea (opportunity) goes with its topic; its keywords were already taken out above
    if (sel.niche.length) await c.query('DELETE FROM niche_suggestions WHERE id = ANY($1::uuid[])', [sel.niche]);
    const out = counts(sel);
    await c.query('INSERT INTO cleanup_log (project_id, trigger, counts, ran_at) VALUES ($1,$2,$3,$4)', [projectId, trigger, JSON.stringify(out), now]);
    await c.query("DELETE FROM cleanup_log WHERE project_id = $1 AND ran_at < $2", [projectId, iso(new Date(now.getTime() - 90 * DAY))]);
    return out;
  });
  return { removed, rules: cfg };
}

/** the last runs, newest first */
async function last(projectId, n = 1) {
  return (await db.query('SELECT trigger, counts, ran_at FROM cleanup_log WHERE project_id = $1 ORDER BY ran_at DESC LIMIT $2', [V.uuid(projectId, 'Proje'), n])).rows.map((r) => ({ trigger: r.trigger, counts: r.counts, ranAt: r.ran_at }));
}

/** the scheduled pass: every project whose switch is on and that has not been cleaned for ~20 hours */
let checkedAt = 0;
async function runDue({ now = new Date(), force = false } = {}) {
  if (!force && Date.now() - checkedAt < 3600000) return [];          // one look an hour is plenty (the database costs a round trip each)
  checkedAt = Date.now();
  const out = [];
  for (const p of (await db.query("SELECT id FROM content_projects WHERE status <> 'archived'")).rows) {
    try {
      const cfg = await rules(p.id); if (!cfg.auto) continue;
      const l = (await last(p.id, 1))[0]; if (l && now.getTime() - new Date(l.ranAt).getTime() < 20 * 3600000) continue;
      out.push({ projectId: p.id, ...(await run(p.id, { trigger: 'schedule', now })) });
    } catch (err) { console.error('[Content] cleanup failed:', err.message); }
  }
  return out;
}
const resetCheck = () => { checkedAt = 0; };

module.exports = { plan, run, last, runDue, rules, select, resetCheck };
