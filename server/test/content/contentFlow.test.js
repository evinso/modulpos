const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const O = require('../../src/content/services/opportunities');
const S = require('../../src/content/services/settings');
const L = require('../../src/content/services/limits');
const CL = require('../../src/content/services/cleanup');
const FL = require('../../src/content/services/flow');

/**
 * What the system finds must become articles while the news is young, and what is not used must not pile up. Everything here is real PostgreSQL with controlled time stamps:
 * the fresh-news lane (no volume/SERP wait for a young multi-source event), the housekeeping rules (what goes, what never goes, nothing comes back) and the read-only flow picture.
 */
const opts = { skip: H.skip };
const NOW = new Date('2026-11-23T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000);
const daysAgo = (d) => hoursAgo(d * 24);
test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

let seq = 0;
/** an event (cluster) with an idea (topic) and its candidate keywords; `age` = hours since the event was last seen */
async function idea(pid, { age = 5, sources = 2, reliability = 80, relevance = 80, kws = ['new router firmware', 'router firmware update'], status = 'new', oppStatus = null, origin = 'news', cluster = true, created = null } = {}) {
  seq++; const db = H.db(); const cat = (await P.listCategories(pid))[0];
  let cid = null;
  if (cluster) cid = (await db.query(`INSERT INTO news_clusters (project_id, title, category_id, relevance, status, source_count, item_count, reliability, first_seen_at, last_seen_at, matched_terms) VALUES ($1,$2,$3,$4,'relevant',$5,$5,$6,$7,$7,'{router}') RETURNING id`, [pid, `Router firmware ${seq} released`, cat.id, relevance, sources, reliability, hoursAgo(age)])).rows[0].id;
  for (let i = 0; cid && i < sources; i++) await db.query("INSERT INTO news_items (project_id, cluster_id, url, url_hash, title, status, source_name, fetched_at, published_at, reliability) VALUES ($1,$2,$3,$3,$4,'relevant',$5,$6,$6,$7)", [pid, cid, `https://s${i}.example/${seq}`, `Router firmware ${seq} released`, `Outlet ${i}`, hoursAgo(age), reliability]);   // the event's reports (they make the "last 12 hours" count of the time wave)
  const t = (await db.query('INSERT INTO topics (project_id, cluster_id, category_id, title, origin, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [pid, cid, cat.id, `Router firmware ${seq} released`, origin, status, created || hoursAgo(age)])).rows[0].id;
  for (const k of kws) await db.query("INSERT INTO keywords (project_id, topic_id, category_id, keyword, origin) VALUES ($1,$2,$3,$4,'news') ON CONFLICT DO NOTHING", [pid, t, cat.id, `${k} ${seq}`]);
  if (oppStatus) await db.query("INSERT INTO content_opportunities (project_id, topic_id, category_id, title, status, eligible, updated_at) VALUES ($1,$2,$3,'x',$4,false,$5)", [pid, t, cat.id, oppStatus, hoursAgo(age)]);
  return { topicId: t, clusterId: cid };
}
const opp = async (topicId) => (await H.db().query('SELECT * FROM content_opportunities WHERE topic_id = $1', [topicId])).rows[0];

test('fresh-news lane: a young event with 2+ sources becomes eligible WITHOUT a volume number or a SERP analysis; an old one, a lone weak source, a low score and "lane off" do not; no approval step', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await S.set('scoring', { ...(await S.get('scoring', pid)).value }, { scope: 'global' });
  const young = await idea(pid, { age: 5, sources: 3, reliability: 90 }); const old = await idea(pid, { age: 60, sources: 3, reliability: 90 }); const lone = await idea(pid, { age: 5, sources: 1, reliability: 60 }); const official = await idea(pid, { age: 5, sources: 1, reliability: 92 });
  await O.refresh(pid, { now: NOW, generateKeywords: false });
  const y = await opp(young.topicId); assert.equal(y.eligible, true, y.ineligible_reason); assert.equal(y.explain.lane, true); assert.match(y.explain.note, /TAZE HABER HATTI/); assert.ok(y.provisional_score >= 60, `provisional ${y.provisional_score}`); assert.equal(y.total_score, null, 'no total: the volume part never existed');
  assert.equal((await opp(old.topicId)).eligible, false); assert.match((await opp(old.topicId)).ineligible_reason, /Aranma hacmi verisi yok|SERP|veri/i, 'older than the window: the normal rules (with their usual reasons)');
  const lo = await opp(lone.topicId); assert.equal(lo.eligible, false, 'one ordinary source is not a wave');
  const off = await opp(official.topicId); assert.equal(off.eligible, false, 'a single report is let into the lane (reliability 92) but its wave is weak: the score decides, and says so'); assert.match(off.ineligible_reason, /Taze haber puanı \d+, en az 60 gerekli/); assert.equal(off.explain.lane, true);
  // it is chosen for writing like any other eligible idea, and says why
  const pick = await O.selectForGeneration(pid, { count: 5, now: NOW }); assert.ok(pick.picks.some((p) => p.topicId === young.topicId && /Taze haber hattı/.test(p.why)), JSON.stringify(pick.picks.map((p) => p.why)));
  // lane off (0): the same event waits for data like before
  await S.set('seo', { ...(await S.get('seo', pid)).value, freshHours: 0 }, { scope: 'global' }); await O.refresh(pid, { now: NOW, generateKeywords: false });
  assert.equal((await opp(young.topicId)).eligible, false, 'lane off: back to the usual rules');
  await assert.rejects(S.set('seo', { ...(await S.get('seo', pid)).value, freshHours: 500 }, { scope: 'global' }), /Taze haber penceresi/);
});

test('housekeeping: used ideas go after 3 days, unused ones when their news is older than 10 days, the short list / queue / typed-in ideas / manual keywords never - and a removed idea does not come back', opts, async () => {
  const pid = (await P.seedDefault()).projectId; const db = H.db();
  const fresh = await idea(pid, { age: 24 }); const stale = await idea(pid, { age: 12 * 24 }); const kept = await idea(pid, { age: 20 * 24, oppStatus: 'shortlisted' }); const queued = await idea(pid, { age: 20 * 24, oppStatus: 'queued' });
  const typed = await idea(pid, { age: 30 * 24, origin: 'manual', cluster: false }); const usedNew = await idea(pid, { age: 24, status: 'used', oppStatus: 'written' }); const usedOld = await idea(pid, { age: 11 * 24, status: 'used', oppStatus: 'written' });
  await db.query("UPDATE content_opportunities SET updated_at = $2 WHERE topic_id = $1", [usedNew.topicId, hoursAgo(10)]); await db.query("UPDATE content_opportunities SET updated_at = $2 WHERE topic_id = $1", [usedOld.topicId, daysAgo(4)]);
  const man = (await db.query("INSERT INTO keywords (project_id, keyword, origin, created_at) VALUES ($1,'my own keyword','manual',$2) RETURNING id", [pid, daysAgo(200)])).rows[0].id;
  const preview = await CL.plan(pid, { now: NOW }); assert.deepEqual([preview.would.usedIdeas, preview.would.staleIdeas], [1, 2], 'the old written idea; the stale idea and the written one whose news is older than 10 days'); assert.equal(preview.auto, true);
  const topicsBefore = (await db.query('SELECT count(*)::int n FROM topics')).rows[0].n;
  assert.equal((await db.query('SELECT count(*)::int n FROM topics')).rows[0].n, topicsBefore, 'a preview removes nothing');
  const out = await CL.run(pid, { trigger: 'manual', now: NOW });
  assert.equal(out.removed.usedIdeas, 1); const still = async (t) => (await db.query('SELECT count(*)::int n FROM topics WHERE id = $1', [t.topicId])).rows[0].n === 1;
  assert.deepEqual([await still(fresh), await still(stale), await still(kept), await still(queued), await still(typed), await still(usedNew), await still(usedOld)], [true, false, true, true, true, true, false]);
  assert.equal((await opp(usedNew.topicId)).status, 'written', 'written 10 hours ago: still shown for a while'); assert.equal(await opp(usedOld.topicId), undefined, 'written 4 days ago and its news is old: gone'); assert.equal((await opp(kept.topicId)).status, 'shortlisted');
  assert.equal((await db.query('SELECT count(*)::int n FROM keywords WHERE id = $1', [man])).rows[0].n, 1, 'a typed-in keyword is never removed');
  assert.equal((await db.query('SELECT count(*)::int n FROM keywords WHERE topic_id = $1', [stale.topicId])).rows[0].n, 0, 'the removed idea\'s keywords went with it'); assert.equal((await db.query('SELECT count(*)::int n FROM keywords WHERE topic_id = $1', [fresh.topicId])).rows[0].n, 2);
  assert.equal((await CL.last(pid))[0].counts.staleIdeas, 2, 'the run is logged'); assert.equal((await CL.plan(pid, { now: NOW })).would.staleIdeas, 0, 'a second look finds nothing left');
  // nothing comes back: the event is still in the database but older than the 7 days an event may create an idea in
  const made = await O.createTopics(pid, { now: NOW, generateKeywords: false }); assert.equal(made.created, 0, 'no resurrection of a removed idea from its old event');
});

test('housekeeping: keywords of the system go when they belong to no idea (14 days, 45 when real data was fetched); typed-in ones, ones of a live idea and young ones stay; niche suggestions expire by their state', opts, async () => {
  const pid = (await P.seedDefault()).projectId; const db = H.db(); const live = await idea(pid, { age: 24, kws: ['live keyword'] });
  const kw = async (text, origin, ageDays, data) => { const id = (await db.query('INSERT INTO keywords (project_id, keyword, origin, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [pid, text, origin, daysAgo(ageDays)])).rows[0].id; if (data) await db.query('INSERT INTO keyword_metrics (keyword_id, found, search_volume) VALUES ($1, true, 500)', [id]); return id; };
  const a = await kw('old unresearched', 'suggestion', 20, false); const b = await kw('young unresearched', 'related', 5, false); const c = await kw('old researched', 'question', 30, true); const d = await kw('very old researched', 'suggestion', 60, true); const m = await kw('old manual', 'manual', 400, true);
  const exists = async (id) => (await db.query('SELECT count(*)::int n FROM keywords WHERE id = $1', [id])).rows[0].n === 1;
  await db.query("INSERT INTO niche_suggestions (project_id, label, status, created_at) VALUES ($1,'Young new','new',$2), ($1,'Old new','new',$3), ($1,'Old later','later',$4), ($1,'Fresh later','later',$5), ($1,'Old rejected','rejected',$6), ($1,'Accepted long ago','accepted',$7)", [pid, daysAgo(5), daysAgo(30), daysAgo(80), daysAgo(20), daysAgo(120), daysAgo(300)]);
  const out = await CL.run(pid, { now: NOW }); assert.equal(out.removed.keywords, 2); assert.deepEqual(out.removed.nicheParts, { undecided: 1, later: 1, rejected: 1 });
  assert.deepEqual([await exists(a), await exists(b), await exists(c), await exists(d), await exists(m)], [false, true, true, false, true]);
  assert.deepEqual((await db.query('SELECT label FROM niche_suggestions ORDER BY label')).rows.map((r) => r.label), ['Accepted long ago', 'Fresh later', 'Young new']);
  assert.equal((await db.query('SELECT count(*)::int n FROM keywords WHERE topic_id = $1', [live.topicId])).rows[0].n, 1, 'the keyword of a live idea stays');
});

test('housekeeping runs by itself about once a day per project, only when its switch is on, and a manual run does not need the switch', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await idea(pid, { age: 15 * 24 });
  await S.set('retention', { ...(await S.get('retention', pid)).value, auto: false }, { scope: 'global' }); CL.resetCheck(); assert.deepEqual(await CL.runDue({ now: NOW }), [], 'switched off: nothing runs');
  await S.set('retention', { ...(await S.get('retention', pid)).value, auto: true }, { scope: 'global' }); CL.resetCheck(); const r = await CL.runDue({ now: NOW }); assert.equal(r.length, 1); assert.equal(r[0].removed.staleIdeas, 1);
  CL.resetCheck(); assert.deepEqual(await CL.runDue({ now: new Date(NOW.getTime() + 3600000) }), [], 'it ran an hour ago: not again');
  CL.resetCheck(); assert.equal((await CL.runDue({ now: new Date(NOW.getTime() + 21 * 3600000) })).length, 1, 'a day later it runs again');
  await assert.rejects(S.set('retention', { ...(await S.get('retention', pid)).value, ideaDays: 5 }, { scope: 'global' }), /Kullanılmayan fikirler/, 'below 8 days an event could come back as a new idea');
});

test('the flow picture: what was found, how many ideas are eligible, WHY the others wait (counted), the waves by age, today\'s places and the housekeeping preview - read only', opts, async () => {
  const pid = (await P.seedDefault()).projectId; await S.set('seo', { ...(await S.get('seo', pid)).value, freshHours: 0 }, { scope: 'global' });
  await idea(pid, { age: 3 }); await idea(pid, { age: 20 }); await idea(pid, { age: 50 }); await idea(pid, { age: 100 }); await idea(pid, { age: 14 * 24 });
  await H.db().query("INSERT INTO news_items (project_id, url, url_hash, title, status, fetched_at, published_at) VALUES ($1,'https://a.example/1','h1','Router news','relevant',$2,$2), ($1,'https://a.example/2','h2','Other news','irrelevant',$2,$2)", [pid, hoursAgo(2)]);
  await O.refresh(pid, { now: NOW, generateKeywords: false });
  const f = await FL.overview(pid, { now: NOW });
  assert.deepEqual([f.found.newsLast24h, f.found.relevantLast24h, f.found.eventsLast7d, f.found.keywords], [6, 5, 4, 10], '2 typed rows + 2 reports each of the two ideas of the last 24 h; 4 events in 7 days'); assert.deepEqual(f.waves.map((w) => w.ideas), [1, 1, 1, 1, 1]);
  assert.equal(f.ideas.open, 5); assert.equal(f.ideas.eligible, 0); assert.ok(f.blockers.length >= 1 && f.blockers[0].count >= 1 && typeof f.blockers[0].reason === 'string', JSON.stringify(f.blockers));
  assert.deepEqual([f.today.limit, f.today.done, f.today.remaining], [3, 0, 3]); assert.equal(f.fresh.on, false); assert.equal(f.cleanup.would.staleIdeas, 1, 'the 14-day-old one would go');
  // switching the lane on makes the young multi-source ideas eligible and the picture says so
  await FL.save(pid, { freshHours: 36 }); await O.refresh(pid, { now: NOW, generateKeywords: false }); const g = await FL.overview(pid, { now: NOW });
  assert.deepEqual([g.fresh.on, g.fresh.hours, g.ideas.fromFreshLane], [true, 36, 1], 'only the 3-hour-old event: the 20-hour-old one is inside the window but its wave has already faded (no new reports in the last 12 hours), so its score stays below the bar');
  assert.deepEqual(g.waves.map((w) => w.eligible), [1, 0, 0, 0, 0]); await L.setProjectLimits(pid, { new_article: 1 }); assert.equal((await FL.overview(pid, { now: NOW })).today.limit, 1);
  await assert.rejects(FL.save(pid, { freshHours: 999 }), /Taze haber penceresi/); assert.equal((await FL.save(pid, { retention: { ideaDays: 20 } })).cleanup.rules.ideaDays, 20);
});

test('ideas are ready and places are left, yet nothing is written: WHY is told in words (a category\'s own daily limit), by the selection, by the flow picture and by the writer job; a full day says so too', opts, async () => {
  const pid = (await P.seedDefault()).projectId; const cat = (await P.listCategories(pid))[0];
  const a = await idea(pid, { age: 5, sources: 3, reliability: 90 }); const b = await idea(pid, { age: 6, sources: 3, reliability: 90 });
  await O.refresh(pid, { now: NOW, generateKeywords: false });
  assert.deepEqual([(await opp(a.topicId)).eligible, (await opp(b.topicId)).eligible], [true, true]);
  const open = await O.selectForGeneration(pid, { now: NOW });
  assert.deepEqual([open.picked, open.room], [2, 3], 'before the category limit: both are chosen');
  await L.setCategoryLimits(cat.id, { dailyMax: 1 }); assert.equal((await L.reserve({ workType: 'new_article', projectId: pid, categoryId: cat.id, now: NOW })).ok, true);       // one article of this category was written today
  const sel = await O.selectForGeneration(pid, { now: NOW });
  assert.deepEqual([sel.picked, sel.room], [0, 2], 'two places are left and two ideas are ready, but both are in the category whose own limit is used up');
  assert.deepEqual(sel.held, [{ category: cat.nameEn, count: 2, limit: 1 }]);
  assert.match(sel.note, /2 yer boş ama yazılamadı/); assert.ok(sel.note.includes(`“${cat.nameEn}” 2 fikir, sınır 1`)); assert.match(sel.note, /Kategori limitleri/);
  const fl = await FL.overview(pid, { now: NOW });
  assert.deepEqual([fl.today.remaining, fl.ideas.eligible], [2, 2]); assert.deepEqual(fl.today.held.byCategory, [{ category: cat.nameEn, count: 2, limit: 1 }]); assert.equal(fl.today.held.places, 2); assert.equal(fl.today.held.note, sel.note);
  await L.setCategoryLimits(cat.id, { dailyMax: null });
  assert.equal((await FL.overview(pid, { now: NOW })).today.held, null, 'no category limit: nothing is held back, nothing to explain');
  assert.equal((await O.selectForGeneration(pid, { now: NOW })).note, '');
  // a day whose places are all used: the note says so (it used to say "no suitable idea")
  await L.setProjectLimits(pid, { new_article: 1 });
  const full = await O.selectForGeneration(pid, { now: NOW });
  assert.deepEqual([full.picked, full.room], [0, 0]); assert.match(full.note, /Bugünkü yeni makale yeri doldu \(1 \/ 1\)/);
  assert.equal((await FL.overview(pid, { now: NOW })).today.held, null, 'no place left is not "held back"');
});
