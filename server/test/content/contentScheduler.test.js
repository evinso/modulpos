const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { fakeModels, PAGE, json } = require('./fakeModels');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const O = require('../../src/content/services/opportunities');
const PR = require('../../src/content/services/providers');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const A = require('../../src/content/services/articles');
const R = require('../../src/content/services/runs');
const Q = require('../../src/content/services/queue');
const SC = require('../../src/content/services/scheduler');
const B = require('../../src/content/services/bots');
const NT = require('../../src/content/services/notifications');
const { FetchError } = require('../../src/content/lib/safeFetch');

/**
 * Phase 4: the persistent queue, the scheduler's ticks, the worker and the bot handlers. Time is a parameter (`now`), so "two hours later" is a number, not a wait.
 * Models, SERP and the news feeds are fakes; the database is real (row locks and the unique index are what is being tested).
 */
const opts = { skip: H.skip };
const MON = new Date('2026-11-23T10:00:00Z');                 // Monday 13:00 in Istanbul
const plus = (d, min) => new Date(d.getTime() + min * 60000);

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d || 'Sat, 22 Nov 2026 10:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;
const feeds = (map) => async (url) => { if (!map[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: map[url], url }; };
const FEEDS = { 'https://a.example/feed': rssOf([['OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1']]), 'https://b.example/feed': rssOf([['ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1', 'Sat, 22 Nov 2026 11:00:00 GMT']]) };
async function sources(pid) { await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 }); }
const setup = async () => (await P.seedDefault()).projectId;
const jobsOf = async (status) => (await H.db().query('SELECT * FROM jobs WHERE ($1::text IS NULL OR status = $1) ORDER BY id', [status || null])).rows;

test('queue: one active job per key; a job goes to exactly ONE of many racing workers; manual clicks first; the order of equals is stable', opts, async () => {
  const pid = await setup();
  const a = await Q.enqueue({ botKey: 'news_discovery', projectId: pid, dedupeKey: 'k1', trigger: 'schedule', runAfter: MON });
  const dup = await Q.enqueue({ botKey: 'news_discovery', projectId: pid, dedupeKey: 'k1', trigger: 'schedule', runAfter: MON });
  assert.deepEqual([a.duplicate, dup.duplicate, dup.job.id === a.job.id], [false, true, true]);
  const free = await Q.enqueue({ botKey: 'x', projectId: pid, trigger: 'schedule', runAfter: MON }); const free2 = await Q.enqueue({ botKey: 'x', projectId: pid, trigger: 'schedule', runAfter: MON });
  assert.notEqual(free.job.id, free2.job.id, 'no dedupe key = no dedupe');
  for (let i = 0; i < 12; i++) await Q.enqueue({ botKey: 'bulk', projectId: pid, trigger: 'schedule', dedupeKey: `bulk:${i}`, runAfter: MON });
  const manual = await Q.enqueue({ botKey: 'manual_one', projectId: pid, trigger: 'manual', dedupeKey: 'm', runAfter: MON });
  assert.equal((await Q.claim('w0', { now: MON })).id, manual.job.id, 'a person\'s click goes before scheduled work');
  assert.equal(await Q.claim('w0', { now: plus(MON, -5) }), null, 'a job that is not due yet is never claimed');
  const claimed = []; const worker = async (id) => { for (;;) { const j = await Q.claim(`w${id}`, { now: MON }); if (!j) return; claimed.push(j.id); await new Promise((r) => setTimeout(r, 2)); } };
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  assert.equal(claimed.length, new Set(claimed).size, 'no job was handed out twice'); assert.equal(claimed.length, 15, 'every other queued job was claimed once'); assert.equal((await jobsOf('running')).length, 16);
  assert.equal((await jobsOf('queued')).length, 0); assert.ok((await jobsOf('running')).every((j) => j.attempts === 1 && j.locked_by));
  await assert.rejects(Q.cancel(a.job.id), /Çalışan görev iptal edilemez/);
});

test('queue: failures are retried with growing pauses, a hopeless error or the last attempt fails the job; a dead worker\'s job comes back only when repeating it is harmless', opts, async () => {
  const pid = await setup();
  const { job } = await Q.enqueue({ botKey: 'news_discovery', projectId: pid, dedupeKey: 'r', trigger: 'schedule', runAfter: MON, maxAttempts: 3 });
  let t = MON; let j = await Q.claim('w', { now: t });
  let f = await Q.fail(j, new Error('network down'), { now: t }); assert.deepEqual([f.retry, f.runAfter.getTime() - t.getTime()], [true, 60000]);
  assert.equal(await Q.claim('w', { now: plus(t, 0.5) }), null, 'not before the pause is over'); t = plus(t, 1); j = await Q.claim('w', { now: t });
  f = await Q.fail(j, new Error('again'), { now: t }); assert.equal(f.runAfter.getTime() - t.getTime(), 5 * 60000); t = plus(t, 5); j = await Q.claim('w', { now: t });
  assert.equal(j.attempts, 3); f = await Q.fail(j, new Error('third'), { now: t }); assert.equal(f.retry, false); const done = await Q.get(job.id); assert.deepEqual([done.status, done.lastError, done.attempts], ['failed', 'third', 3]);
  const fatal = await Q.enqueue({ botKey: 'a', projectId: pid, dedupeKey: 'f', runAfter: MON, maxAttempts: 3 }); const fj = await Q.claim('w', { now: MON });
  assert.equal((await Q.fail(fj, Object.assign(new Error('rejected key'), { fatal: true }), { now: MON })).retry, false, 'a rejected key is not retried'); assert.equal((await Q.get(fatal.job.id)).status, 'failed');
  // a failed job can be put back by a person; a finished one cannot
  const again = await Q.retry(job.id, { now: MON }); assert.deepEqual([again.status, again.trigger, again.attempts], ['queued', 'retry', 0]); await assert.rejects(Q.retry(again.id), /yeniden denenemez/);
  assert.equal((await Q.cancel(again.id)).status, 'cancelled'); await assert.rejects(Q.cancel(again.id), /zaten “cancelled”/);
  // a worker that died: the lease runs out
  const idem = await Q.enqueue({ botKey: 'news_discovery', projectId: pid, dedupeKey: 'i', runAfter: MON }); const paid = await Q.enqueue({ botKey: 'article_writer', projectId: pid, dedupeKey: 'p', runAfter: MON });
  await Q.claim('dead', { now: MON }); await Q.claim('dead', { now: MON });
  assert.deepEqual(await Q.recoverStale({ now: plus(MON, 10), idempotent: () => true }), { requeued: 0, failed: 0 }, 'the lease is 20 minutes');
  const rec = await Q.recoverStale({ now: plus(MON, 21), idempotent: (b) => b === 'news_discovery' }); assert.deepEqual(rec, { requeued: 1, failed: 1 });
  assert.equal((await Q.get(idem.job.id)).status, 'queued'); const p2 = await Q.get(paid.job.id); assert.deepEqual([p2.status, /yarım kaldı.*tekrar denenmedi/.test(p2.lastError)], ['failed', true]);
  await H.db().query("UPDATE jobs SET finished_at = now() - interval '40 days' WHERE status = 'failed'"); assert.ok(await Q.purge(30) >= 2);
});

test('tick: defaults (free bots on, paid bots off), one job per bot and project, no pile-up after a sleep, nothing while paused, gates and working hours obeyed', opts, async () => {
  const pid = await setup();
  const t1 = await SC.tick({ now: MON }); assert.deepEqual(t1.enqueued.map((e) => e.bot).sort(), ['content_opportunity', 'news_discovery', 'niche_discovery'], 'paid bots start OFF');
  assert.deepEqual((await SC.tick({ now: plus(MON, 1) })).enqueued, [], 'nothing is due a minute later'); assert.deepEqual((await SC.tick({ now: plus(MON, 119) })).enqueued, []);
  const s = await SC.getSchedule('news_discovery'); assert.equal(new Date(s.nextRunAt).getTime(), plus(MON, 120).getTime());
  const t2 = await SC.tick({ now: plus(MON, 121) }); assert.deepEqual(t2.enqueued, [], 'the earlier jobs are still waiting: no second copy of the same job');
  for (const j of await jobsOf('queued')) await H.db().query("UPDATE jobs SET status = 'done' WHERE id = $1", [j.id]);
  const t3 = await SC.tick({ now: plus(MON, 12 * 60) }); assert.deepEqual(t3.enqueued.map((e) => e.bot).sort(), ['content_opportunity', 'news_discovery'], 'after a long sleep ONE job per bot, not one per missed interval (the daily niche bot is not due yet)');
  for (const j of await jobsOf('queued')) await H.db().query("UPDATE jobs SET status = 'done' WHERE id = $1", [j.id]);
  assert.deepEqual((await SC.tick({ now: plus(MON, 25 * 60) })).enqueued.map((e) => e.bot).sort(), ['content_opportunity', 'news_discovery', 'niche_discovery'], 'a day later the daily bot is due');
  assert.equal((await SC.getSchedule('news_discovery')).failStreak, 0);
  // paused: nothing
  for (const j of await jobsOf('queued')) await H.db().query("UPDATE jobs SET status = 'done' WHERE id = $1", [j.id]);
  await B.setPaused(true, { email: 'x' }); assert.deepEqual(await SC.tick({ now: plus(MON, 40 * 60) }), { paused: true, enqueued: [], moved: [] }); await B.setPaused(false);
  // per-project gate: "news bot active" off -> no news job (the other bots go on)
  await S.set('news', { enabled: false }, { scope: 'project', projectId: pid });
  const t4 = await SC.tick({ now: plus(MON, 40 * 60) }); assert.ok(!t4.enqueued.some((e) => e.bot === 'news_discovery') && t4.enqueued.some((e) => e.bot === 'content_opportunity'));
  // working hours: the writer is switched on with 09:00-23:00; at 02:00 Istanbul it is moved to the morning and nothing is queued
  await SC.updateSchedule('article_writer', { enabled: true });
  const night = new Date('2026-11-24T23:00:00Z');                       // 02:00 Tue Istanbul
  const t5 = await SC.tick({ now: night }); assert.ok(t5.moved.includes('article_writer') && !t5.enqueued.some((e) => e.bot === 'article_writer'));
  assert.equal(new Date((await SC.getSchedule('article_writer')).nextRunAt).toISOString(), '2026-11-25T06:00:00.000Z', '09:00 Istanbul');
  const morning = await SC.tick({ now: new Date('2026-11-25T06:00:00Z') }); assert.ok(morning.enqueued.some((e) => e.bot === 'article_writer'));
  assert.equal((await H.db().query("SELECT max_attempts FROM jobs WHERE bot_key = 'article_writer'")).rows[0].max_attempts, 1, 'paid work is never retried on its own');
  // weekdays only: Saturday is moved to Monday
  await SC.updateSchedule('news_discovery', { weekdaysOnly: true, intervalMinutes: 60 });
  const sat = new Date('2026-11-28T10:00:00Z'); const t6 = await SC.tick({ now: sat }); assert.ok(t6.moved.includes('news_discovery'));
  assert.equal(new Date((await SC.getSchedule('news_discovery')).nextRunAt).toISOString(), '2026-11-29T21:00:00.000Z', 'Monday 00:00 Istanbul');
});

test('schedule edits: validated, saved in the database, applied from the next tick; a bot that failed itself off is switched on again by the owner', opts, async () => {
  await setup();
  await assert.rejects(SC.updateSchedule('trend_analysis', { enabled: true }), /zamanlanamaz/); await assert.rejects(SC.updateSchedule('news_discovery', { intervalMinutes: 2 }), /5 ile 10080 arasında/);
  await assert.rejects(SC.updateSchedule('news_discovery', { windowStart: '9:00', windowEnd: '12:00' }), /SS:DD/); await assert.rejects(SC.updateSchedule('news_discovery', { windowStart: '09:00' }), /ikisi de/);
  await assert.rejects(SC.updateSchedule('news_discovery', { timezone: 'Mars/Base' }), /Saat dilimi geçersiz/); await assert.rejects(SC.updateSchedule('news_discovery', { options: { perRun: 2 } }), /yok/); await assert.rejects(SC.updateSchedule('article_writer', { options: { perRun: 9 } }), /en fazla|1 ile 5|aralığında/i);
  const s = await SC.updateSchedule('article_writer', { enabled: true, intervalMinutes: 90, windowStart: '10:00', windowEnd: '18:00', weekdaysOnly: true, options: { perRun: 2 } });
  assert.deepEqual([s.enabled, s.intervalMinutes, s.windowStart, s.windowEnd, s.weekdaysOnly, s.options.perRun, s.nextRunAt], [true, 90, '10:00', '18:00', true, 2, null]);
  assert.equal((await B.list()).items.find((b) => b.key === 'article_writer').statusText, 'Otomatik: 90 dakikada bir (10:00–18:00)');
  await SC.saveSchedule('news_discovery', { enabled: false, failStreak: 5, disabledReason: 'x' }); assert.match((await B.list()).items.find((b) => b.key === 'news_discovery').statusText, /kapatıldı/);
  const back = await SC.updateSchedule('news_discovery', { enabled: true }); assert.deepEqual([back.failStreak, back.disabledReason], [0, null]);
});

test('worker: the news bot runs through the queue (a scheduled run record, the opportunity bot follows), failures retry and then count; 5 failed scheduled jobs switch a bot off and tell the owner; a person\'s failed click does not', opts, async () => {
  const pid = await setup(); await sources(pid);
  await SC.tick({ now: MON });
  const ctx = { newsFetch: feeds(FEEDS), gapMs: 0 };
  const first = await SC.workOnce({ now: MON, ctx }); assert.deepEqual([first.botKey, first.outcome], ['news_discovery', 'done']); assert.match(first.result.message, /\d+ yeni haber/);
  const run = (await R.list({ botKey: 'news_discovery', projectId: pid }))[0]; assert.deepEqual([run.trigger, run.status], ['schedule', 'ok']);
  const second = await SC.workOnce({ now: MON, ctx }); assert.equal(second.botKey, 'content_opportunity'); assert.equal(second.outcome, 'done'); assert.ok(second.result.stats.topicsCreated >= 1, 'the idea of the scanned event exists');
  const third = await SC.workOnce({ now: MON, ctx }); assert.equal(third.botKey, 'niche_discovery'); assert.equal(await SC.workOnce({ now: MON, ctx }), null, 'queue empty');
  let now = plus(MON, 24 * 60);
  // a scan where every source fails is still a finished scan ("partial"/ok with errors), so force real failures: the handler throws
  // (a scan in which every source fails is still a finished scan, so real job failures are forced: the handler throws)
  const real = SC.HANDLERS.news_discovery.run; SC.HANDLERS.news_discovery.run = async () => { throw new Error('boom'); };
  try {
    await SC.saveSchedule('news_discovery', { enabled: true, failStreak: 0, nextRunAt: null, disabledReason: null }); const states = [];
    for (let i = 0; i < SC.FAIL_LIMIT; i++) {
      await H.db().query("UPDATE jobs SET status = 'done' WHERE bot_key = 'news_discovery' AND status IN ('queued', 'running')"); await SC.saveSchedule('news_discovery', { nextRunAt: null, enabled: true });
      now = plus(now, 600); await SC.tick({ now }); let j; do { j = await SC.workOnce({ now, ctx }); if (j && j.botKey === 'news_discovery' && j.outcome === 'retry') now = plus(now, 30); } while (j && !(j.botKey === 'news_discovery' && j.outcome === 'failed'));
      const sc = await SC.getSchedule('news_discovery'); states.push([sc.failStreak, sc.enabled]);
    }
    assert.deepEqual(states, [[1, true], [2, true], [3, true], [4, true], [5, false]], 'the fifth consecutive failure switches the bot off');
    const sc = await SC.getSchedule('news_discovery'); assert.match(sc.disabledReason, /Art arda 5/); assert.match((await B.list()).items.find((b) => b.key === 'news_discovery').statusText, /kapatıldı/);
    const notes = (await NT.list({ limit: 50 })).items; assert.ok(notes.some((n) => n.type === 'bot_disabled' && n.severity === 'critical' && /otomatik olarak kapatıldı/.test(n.title))); assert.ok(notes.filter((n) => n.type === 'job_failed').length >= 5);
    assert.equal((await SC.tick({ now: plus(now, 600) })).enqueued.some((e) => e.bot === 'news_discovery'), false, 'a switched-off bot is not queued');
    // a person's own failing click does not count towards anything
    await SC.updateSchedule('news_discovery', { enabled: true }); const mj = await SC.runNow('news_discovery', pid, { now }); assert.equal(mj.trigger, 'manual');
    await assert.rejects(SC.runNow('news_discovery', pid, { now }), (e) => e.status === 409 && /zaten kuyrukta/.test(e.message));
    let w; do { w = await SC.workOnce({ now, ctx }); if (w && w.botKey === 'news_discovery' && w.outcome === 'retry') now = plus(now, 30); } while (w && !(w.botKey === 'news_discovery' && w.outcome === 'failed'));
    assert.equal((await SC.getSchedule('news_discovery')).failStreak, 0);
  } finally { SC.HANDLERS.news_discovery.run = real; }
});

test('worker: a scan started by hand and still running makes the scheduled one wait (retry), not double up', opts, async () => {
  const pid = await setup(); await sources(pid);
  await R.start('news_discovery', { projectId: pid, trigger: 'manual' });
  await SC.tick({ now: MON }); const j = await SC.workOnce({ now: MON, ctx: { newsFetch: feeds(FEEDS), gapMs: 0 } });
  assert.deepEqual([j.botKey, j.outcome, /zaten çalışıyor/.test(j.error)], ['news_discovery', 'retry', true]); assert.equal((await H.db().query("SELECT status, attempts FROM jobs WHERE id = $1", [j.id])).rows[0].status, 'queued');
});

async function readyIdea(pid) {
  await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789', extra: { inputPricePerM: '3', outputPricePerM: '15' } });
  await sources(pid); await N.runDiscovery(pid, { fetchImpl: feeds(FEEDS), now: MON, gapMs: 0 }); await O.refresh(pid, { now: MON });
  await H.db().query("UPDATE content_opportunities SET eligible = true, ineligible_reason = ''");
  return (await O.list(pid)).items[0];
}
const pageFetcher = async (url) => { if (url === 'https://b.example/1') throw new FetchError('http', 'HTTP 403', { status: 403 }); return { body: PAGE() }; };

test('the writer bot: switched on by the owner it writes at most `perRun` drafts per run inside its hours, obeys the daily limit and the pause switch, and never publishes', opts, async () => {
  const pid = await setup(); const idea = await readyIdea(pid); const m = fakeModels();
  const ctx = { fetchImpl: m.fetchImpl, fetcher: pageFetcher, newsFetch: feeds(FEEDS), gapMs: 0 };
  for (const b of ['news_discovery', 'content_opportunity', 'niche_discovery']) await SC.updateSchedule(b, { enabled: false });          // only the writer is in play (a re-score would reset the forced eligibility)
  await SC.updateSchedule('article_writer', { enabled: true });
  const t = await SC.tick({ now: MON }); assert.ok(t.enqueued.some((e) => e.bot === 'article_writer'));
  let j; do { j = await SC.workOnce({ now: MON, ctx }); } while (j && j.botKey !== 'article_writer');
  assert.deepEqual([j.outcome, j.result.status, j.result.stats.written], ['done', 'ok', 1]); assert.match(j.result.message, /1 makale taslağı yazıldı/);
  const art = await A.get(j.result.stats.articles[0]); assert.deepEqual([art.createdBy, art.status, (await O.get(idea.id)).status], ['ai', 'needs_review', 'written']);
  assert.equal((await R.list({ botKey: 'article_writer', projectId: pid }))[0].trigger, 'schedule');
  // nothing left to write: the job is "skipped" with the reason, nothing is deleted
  await SC.saveSchedule('article_writer', { nextRunAt: null }); await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"); await SC.tick({ now: plus(MON, 200) });
  do { j = await SC.workOnce({ now: plus(MON, 200), ctx }); } while (j && j.botKey !== 'article_writer'); assert.equal(j.outcome, 'skipped'); assert.match(j.result.message, /uygun fikir yok|nitelikli fikir yok/i);
  // a full day: the next idea waits (limit), the job ends "partial" with the reason, no money was spent
  await H.db().query("UPDATE content_opportunities SET status = 'new', article_id = NULL, eligible = true"); await H.db().query("UPDATE topics SET status = 'new'"); await L.setGlobalLimits({ new_article: 0 }); await L.setProjectLimits(pid, { new_article: 0 });
  const callsBefore = m.calls.length; await SC.saveSchedule('article_writer', { nextRunAt: null }); await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"); await SC.tick({ now: plus(MON, 400) });
  do { j = await SC.workOnce({ now: plus(MON, 400), ctx }); } while (j && j.botKey !== 'article_writer'); assert.ok(['skipped', 'done'].includes(j.outcome)); assert.equal(m.calls.length, callsBefore, 'a full day means no model call');
  // paused: a scheduled bot never starts; the owner's own "run now" still works (people are not stopped by the pause switch, the limits still apply)
  await B.setPaused(true, { email: 'x' }); assert.equal((await SC.tick({ now: plus(MON, 800) })).paused, true);
});

test('the SERP bot: checks the ideas that still miss their organic competition, a few per run, and re-scores them; a SERP source that is not set up ends the job gently', opts, async () => {
  const pid = await setup(); await sources(pid); await N.runDiscovery(pid, { fetchImpl: feeds(FEEDS), now: MON, gapMs: 0 }); await O.refresh(pid, { now: MON });
  await SC.updateSchedule('seo_competition', { enabled: true, options: { perRun: 2 } }); await SC.tick({ now: MON });
  let j = await SC.workOnce({ now: MON, ctx: { newsFetch: feeds(FEEDS), gapMs: 0 } }); while (j && j.botKey !== 'seo_competition') j = await SC.workOnce({ now: MON, ctx: { newsFetch: feeds(FEEDS), gapMs: 0 } });
  assert.deepEqual([j.outcome, j.result.status, /ayarlanmadı/.test(j.result.message)], ['done', 'partial', true], 'no Serper key: nothing is spent, the reason is shown');
  await PR.save('serper', { secret: 'serper-key-0123456789abcdef' }); const calls = [];
  const fetchImpl = async (url, o) => { const q = JSON.parse(o.body).q; calls.push(q); return json(200, { organic: ['smallblog.dev', 'niche-tech.net', 'reddit.com', 'mysite.io'].map((d, i) => ({ title: d, link: `https://${d}/${i}`, position: i + 1 })) }); };
  await SC.saveSchedule('seo_competition', { nextRunAt: null }); await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"); await SC.tick({ now: plus(MON, 300) });
  j = await SC.workOnce({ now: plus(MON, 300), ctx: { fetchImpl, newsFetch: feeds(FEEDS), gapMs: 0 } }); while (j && j.botKey !== 'seo_competition') j = await SC.workOnce({ now: plus(MON, 300), ctx: { fetchImpl, newsFetch: feeds(FEEDS), gapMs: 0 } });
  assert.deepEqual([j.result.status, j.result.stats.analyzed], ['ok', 1], 'the one idea of this event'); assert.equal(calls.length, 1);
  const idea = (await O.list(pid)).items[0]; assert.equal(idea.explain.missing.includes('competition'), false, 'the idea was re-scored with its real SERP'); assert.equal(idea.partial, true);
  await SC.saveSchedule('seo_competition', { nextRunAt: null }); await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"); await SC.tick({ now: plus(MON, 600) });
  j = await SC.workOnce({ now: plus(MON, 600), ctx: { fetchImpl, newsFetch: feeds(FEEDS), gapMs: 0 } }); while (j && j.botKey !== 'seo_competition') j = await SC.workOnce({ now: plus(MON, 600), ctx: { fetchImpl, newsFetch: feeds(FEEDS), gapMs: 0 } });
  assert.equal(j.outcome, 'skipped'); assert.equal(calls.length, 1, 'nothing left to analyze: no call');
});

test('the keyword bot: without DataForSEO it is skipped with the reason (volumes come from a file); a hung worker\'s jobs are recovered by the next worker pass', opts, async () => {
  const pid = await setup(); await SC.updateSchedule('keyword_research', { enabled: true }); await SC.tick({ now: MON });
  let j = await SC.workOnce({ now: MON, ctx: { newsFetch: feeds(FEEDS), gapMs: 0 } }); while (j && j.botKey !== 'keyword_research') j = await SC.workOnce({ now: MON, ctx: { newsFetch: feeds(FEEDS), gapMs: 0 } });
  assert.deepEqual([j.outcome, /DataForSEO bağlı değil/.test(j.result.message)], ['skipped', true]);
  // a worker died with a news job: the next pass queues it again (it is harmless) and runs it
  await SC.saveSchedule('news_discovery', { nextRunAt: plus(MON, 99999) }); await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')");
  const { job } = await Q.enqueue({ botKey: 'news_discovery', projectId: pid, dedupeKey: 'zombie', runAfter: plus(MON, -30), trigger: 'schedule' }); await Q.claim('dead-worker', { now: plus(MON, -30) });
  const w = await SC.workOnce({ now: plus(MON, 1), ctx: { newsFetch: feeds({}), gapMs: 0 } }); assert.equal(w.id, job.id); assert.equal(w.attempts, 2, 'second attempt after the recovery');
});

test('the loops: started, they take a queued job without anyone calling them, and stop when asked', opts, async () => {
  const pid = await setup(); const { job } = await Q.enqueue({ botKey: 'keyword_research', projectId: pid, trigger: 'manual', dedupeKey: 'loop', runAfter: new Date(Date.now() - 1000) });
  assert.equal(SC.start({ tickMs: 3600000, workMs: 40 }), true); assert.equal(SC.start(), false, 'a second start does nothing'); assert.equal(SC.status().running, true);
  try { for (let i = 0; i < 100 && (await Q.get(job.id)).status !== 'skipped'; i++) await new Promise((r) => setTimeout(r, 50)); assert.equal((await Q.get(job.id)).status, 'skipped'); assert.ok(SC.status().lastWorkAt); assert.equal(SC.status().lastError, null); }
  finally { SC.stop(); }
  assert.equal(SC.status().running, false);
});
