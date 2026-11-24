const db = require('../db');
const V = require('../lib/validate');
const settings = require('./settings');
const limits = require('./limits');
const scheduler = require('./scheduler');
const projects = require('./projects');
const cleanup = require('./cleanup');
const opportunities = require('./opportunities');
const { env } = require('../env');

/**
 * "Bulgu akışı ve zaman dalgası": ONE read-only picture of how what the system FINDS becomes articles, and what happens to what it does not use:
 *   found (news today / events of 7 days / keywords)  ->  ideas  ->  (eligible | blocked, with the REASONS counted)  ->  today's places  ->  written
 * plus the "waves": open ideas by the age of their news (news is only worth writing while it is young), the fresh-news lane and the housekeeping that keeps nothing for ever.
 * Nothing here changes anything; the two switches of the panel card (fresh-news window, housekeeping rules) write the ordinary settings groups.
 */
const BUCKETS = [['h12', 'Son 12 saat', 0, 12], ['h36', '12 – 36 saat', 12, 36], ['d3', '1,5 – 3 gün', 36, 72], ['d7', '3 – 7 gün', 72, 168], ['older', '7 günden eski', 168, null]];

async function overview(projectId, { now = new Date(), tz = env().defaultTimezone } = {}) {
  const pid = V.uuid(projectId, 'Proje'); await projects.getProject(pid);
  const dayStart = new Date(now.getTime() - 24 * 3600000);
  const cases = BUCKETS.map(([k, , from, to], i) => `count(*) FILTER (WHERE age >= ${from} ${to === null ? '' : `AND age < ${to}`})::int AS t${i}, count(*) FILTER (WHERE eligible AND age >= ${from} ${to === null ? '' : `AND age < ${to}`})::int AS e${i}`).join(', ');
  const [news, events, kw, ideas, waves, blockers, lim, sch, seo, plan, last] = await Promise.all([
    db.query("SELECT count(*)::int AS fresh24, count(*) FILTER (WHERE status = 'relevant')::int AS relevant24 FROM news_items WHERE project_id = $1 AND coalesce(published_at, fetched_at) > $2", [pid, dayStart]),
    db.query("SELECT count(*)::int n FROM news_clusters WHERE project_id = $1 AND status = 'relevant' AND last_seen_at > $2::timestamptz - interval '7 days'", [pid, now]),
    db.query("SELECT count(*)::int n, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM keyword_metrics m WHERE m.keyword_id = k.id AND m.found))::int with_data FROM keywords k WHERE project_id = $1", [pid]),
    db.query("SELECT count(*)::int total, count(*) FILTER (WHERE eligible AND status IN ('new', 'shortlisted'))::int eligible, count(*) FILTER (WHERE status = 'shortlisted')::int shortlisted, count(*) FILTER (WHERE status = 'queued')::int queued, count(*) FILTER (WHERE status = 'written')::int written, count(*) FILTER (WHERE status = 'rejected')::int rejected, count(*) FILTER (WHERE (explain->>'lane') = 'true' AND eligible AND status IN ('new', 'shortlisted'))::int lane FROM content_opportunities WHERE project_id = $1", [pid]),
    db.query(`SELECT ${cases} FROM (SELECT o.eligible, EXTRACT(EPOCH FROM ($2::timestamptz - COALESCE(nc.last_seen_at, t.created_at))) / 3600 AS age FROM content_opportunities o JOIN topics t ON t.id = o.topic_id LEFT JOIN news_clusters nc ON nc.id = t.cluster_id WHERE o.project_id = $1 AND o.status IN ('new', 'shortlisted')) x`, [pid, now]),
    db.query(`SELECT regexp_replace(ineligible_reason, '[0-9]+', '#', 'g') AS reason, count(*)::int n, min(ineligible_reason) AS sample FROM content_opportunities WHERE project_id = $1 AND status IN ('new', 'shortlisted') AND NOT eligible AND ineligible_reason <> '' GROUP BY 1 ORDER BY n DESC LIMIT 6`, [pid]),
    limits.status({ projectId: pid, tz, now }), scheduler.loadSchedules(), settings.get('seo', pid), cleanup.plan(pid, { now }), cleanup.last(pid, 1),
  ]);
  const w = waves.rows[0]; const idea = ideas.rows[0];
  const item = lim.items.find((i) => i.workType === 'new_article'); const remaining = Math.max(0, Math.min(item.remaining, item.project ? item.project.remaining : item.remaining));
  const writer = sch.get('article_writer');
  const freshHours = seo.value.freshHours || 0;
  const open = BUCKETS.reduce((a, _, i) => a + w[`t${i}`], 0);
  // places left AND ideas ready, yet nothing would be written: say why (a category's own daily limit is the usual reason), instead of leaving "2 places" and "27 ready" side by side
  let held = null;
  if (remaining > 0 && idea.eligible > 0) {
    const sel = await opportunities.selectForGeneration(pid, { tz, now });
    if (sel.picked === 0) held = { places: remaining, ready: idea.eligible, note: sel.note, byCategory: sel.held };
  }
  return {
    now: now.toISOString(),
    found: { newsLast24h: news.rows[0].fresh24, relevantLast24h: news.rows[0].relevant24, eventsLast7d: events.rows[0].n, keywords: kw.rows[0].n, keywordsWithData: kw.rows[0].with_data },
    ideas: { open, eligible: idea.eligible, shortlisted: idea.shortlisted, queued: idea.queued, written: idea.written, rejected: idea.rejected, fromFreshLane: idea.lane },
    blockers: blockers.rows.map((r) => ({ reason: r.reason, count: r.n, example: r.sample })),
    waves: BUCKETS.map(([key, label], i) => ({ key, label, ideas: w[`t${i}`], eligible: w[`e${i}`] })),
    today: { limit: item.project ? Math.min(item.limit, item.project.limit) : item.limit, done: item.project ? item.project.done : item.done, remaining, held },
    writer: { enabled: !!writer.enabled, nextRunAt: writer.enabled ? writer.nextRunAt : null, perRun: (writer.options && writer.options.perRun) || 1, windowStart: writer.windowStart, windowEnd: writer.windowEnd },
    fresh: { hours: freshHours, on: freshHours > 0 },
    cleanup: { ...plan, last: last[0] || null },
  };
}

/** saves the two panel switches through the ordinary settings groups (project scope), then returns the picture */
async function save(projectId, body, { userId = null } = {}) {
  const pid = V.uuid(projectId, 'Proje'); await projects.getProject(pid);
  if (body.freshHours !== undefined) {
    const hours = V.int(body.freshHours, 'Taze haber penceresi (saat)', { min: 0, max: 168 }); const cur = await settings.get('seo', pid);
    await settings.set('seo', { ...cur.value, freshHours: hours }, { scope: 'project', projectId: pid, userId });
  }
  if (body.retention !== undefined) {
    if (body.retention === null || typeof body.retention !== 'object' || Array.isArray(body.retention)) throw require('../lib/http').bad('Temizlik ayarları bir nesne olmalı');
    const cur = await settings.get('retention', pid);
    await settings.set('retention', { ...cur.value, ...body.retention }, { scope: 'project', projectId: pid, userId });
  }
  return overview(pid);
}

module.exports = { overview, save, BUCKETS };
