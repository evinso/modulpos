const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');

const opts = { skip: H.skip };
const NOON = new Date('2026-11-21T09:00:00Z');                       // 12:00 in Istanbul

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

async function site() {
  const { projectId } = await P.seedDefault();
  const cats = await P.listCategories(projectId);
  return { projectId, cats };
}

test('settings: defaults, validation, project override, mandatory checks cannot be switched off', opts, async () => {
  const all = await S.getAll();
  assert.equal(all.quality.value.factCheck, true); assert.equal(all.quality.isDefault, true);
  assert.equal(all.bots.value.paused, false);
  const q = await S.set('quality', { minScore: 90, factCheck: false, adsenseCheck: false, duplicateCheck: false });
  assert.deepEqual([q.factCheck, q.adsenseCheck, q.duplicateCheck], [true, true, true], 'forced on, whatever was sent');
  assert.equal((await S.get('quality')).value.minScore, 90);
  await assert.rejects(S.set('quality', { minScore: 10 }), /50 ile 100/);
  await assert.rejects(S.set('news', { intervalMinutes: 7 }), /şunlardan biri/);
  await assert.rejects(S.set('scoring', { trend: 50 }), /toplamı 100 olmalı/);
  await assert.rejects(S.set('publishing', { windowStart: '25:00' }), /SS:DD/);
  await assert.rejects(S.set('publishing', { timezone: 'Mars/Base' }), /Saat dilimi/);
  await assert.rejects(S.set('nope', {}), /Bilinmeyen ayar grubu/);
  await assert.rejects(S.set('budget', { dailyTotalUsd: -1 }), /0 ile 1.000.000/);
  const { projectId } = await site();
  await S.set('news', { intervalMinutes: 60 }, { scope: 'project', projectId });
  assert.equal((await S.get('news', projectId)).value.intervalMinutes, 60);
  assert.equal((await S.get('news', projectId)).overriddenForProject, true);
  assert.equal((await S.get('news')).value.intervalMinutes, 120, 'the global value is untouched');
  await assert.rejects(S.set('budget', { dailyTotalUsd: 5 }, { scope: 'project', projectId }), /yalnızca genel/);
  assert.equal((await S.get('budget', projectId)).value.dailyTotalUsd, null, 'a project override of a global-only group is ignored');
  assert.ok((await S.reset('news', { scope: 'project', projectId })) === 1);
  assert.equal((await S.get('news', projectId)).value.intervalMinutes, 120);
});

test('limits: defaults, global / project / category levels, 0 = stopped, null = no limit', opts, async () => {
  const { projectId, cats } = await site();
  const tz = 'Europe/Istanbul';
  const go = (extra = {}) => L.reserve({ workType: 'new_article', projectId, categoryId: cats[0].id, now: NOON, ...extra });
  // project limit 3 (niche), category limit 3 (AI Tools), global default 3 -> exactly 3 pass
  for (let i = 1; i <= 3; i++) { const r = await go(); assert.equal(r.ok, true); assert.equal(r.scopes.find((s) => s.scope === 'global').used, i); }
  const denied = await go();
  assert.equal(denied.ok, false); assert.equal(denied.reason, 'limit'); assert.match(denied.message, /günlük limit doldu \(3\/3/);
  // the next day (Istanbul) starts at 0
  const tomorrow = await go({ now: new Date('2026-11-21T21:30:00Z') });     // 00:30 on the 22nd in Istanbul
  assert.equal(tomorrow.ok, true); assert.equal(tomorrow.day, '2026-11-22');
  // raising the global and project limits does not lift the category's own limit (3, already used today)
  await L.setGlobalLimits({ new_article: 10 });
  await L.setProjectLimits(projectId, { new_article: 4 });
  const stillCat = await go();
  assert.deepEqual([stillCat.ok, stillCat.scope, stillCat.limit], [false, 'category', 3]);
  await L.setCategoryLimits(cats[0].id, { dailyMax: 5 });
  assert.equal((await go()).ok, true, 'raised category limit: the next one passes (project 4/4 now)');
  const full = await go();
  assert.deepEqual([full.ok, full.scope, full.limit], [false, 'project', 4]);
  assert.equal(tz, 'Europe/Istanbul');
});

test('limits: the narrowest level decides, and a refused request reserves nothing anywhere', opts, async () => {
  const { projectId, cats } = await site();                                    // seeded category limits: 3, 2, 1, none, none
  await L.setGlobalLimits({ new_article: 10 });
  await L.setProjectLimits(projectId, { new_article: 6 });
  await L.setCategoryLimits(cats[0].id, { dailyMax: 2 });
  const go = (cat) => L.reserve({ workType: 'new_article', projectId, categoryId: cat, now: NOON });
  assert.equal((await go(cats[0].id)).ok, true); assert.equal((await go(cats[0].id)).ok, true);
  const d = await go(cats[0].id);
  assert.deepEqual([d.ok, d.reason, d.scope, d.limit, d.used], [false, 'limit', 'category', 2, 2]);
  const st = await L.status({ projectId, now: NOON });
  const na = st.items.find((i) => i.workType === 'new_article');
  assert.equal(na.done, 2, 'the refused request did not touch the global counter'); assert.equal(na.project.done, 2);
  // 0 stops that category (project has room: 2/6), null removes its own limit
  await L.setCategoryLimits(cats[2].id, { dailyMax: 0 });
  const stopped = await go(cats[2].id);
  assert.deepEqual([stopped.ok, stopped.reason, stopped.scope], [false, 'stopped', 'category']);
  await L.setCategoryLimits(cats[2].id, { dailyMax: null });
  assert.equal((await go(cats[2].id)).ok, true); assert.equal((await go(cats[2].id)).ok, true, 'no category limit: only the upper levels count');
  // another category without a limit goes on until the project's 6 (2 + 2 so far)
  assert.equal((await go(cats[3].id)).ok, true); assert.equal((await go(cats[3].id)).ok, true);
  const p = await go(cats[3].id);
  assert.deepEqual([p.ok, p.scope, p.limit, p.used], [false, 'project', 6, 6]);
  assert.equal((await go(cats[0].id)).scope, 'project', 'the narrowest FULL level is reported, global first then project then category');
  // release gives units back, never below 0
  const r = await L.reserve({ workType: 'old_check', now: NOON });
  await L.release({ workType: 'old_check', day: r.day, amount: 5 });
  assert.equal((await L.status({ now: NOON })).items.find((i) => i.workType === 'old_check').done, 0);
});

test('limits: other kinds of work (publish, keywords...) use their own counters; amounts are checked as a whole', opts, async () => {
  const { projectId, cats } = await site();
  await L.setGlobalLimits({ seo_keywords: 100, publish: 3 });
  assert.equal((await L.reserve({ workType: 'seo_keywords', amount: 60, now: NOON })).ok, true);
  const no = await L.reserve({ workType: 'seo_keywords', amount: 50, now: NOON });
  assert.equal(no.ok, false); assert.equal(no.used, 60, 'all or nothing: 50 more would pass 100');
  assert.equal((await L.reserve({ workType: 'seo_keywords', amount: 40, now: NOON })).ok, true);
  await L.setCategoryLimits(cats[0].id, { publishMax: 1 });
  assert.equal((await L.reserve({ workType: 'publish', projectId, categoryId: cats[0].id, now: NOON })).ok, true);
  assert.equal((await L.reserve({ workType: 'publish', projectId, categoryId: cats[0].id, now: NOON })).scope, 'category');
  assert.equal((await L.reserve({ workType: 'publish', projectId, categoryId: cats[1].id, now: NOON })).ok, true);
  await assert.rejects(L.reserve({ workType: 'nonsense' }), /Bilinmeyen iş türü/);
  await assert.rejects(L.reserve({ workType: 'publish', amount: 0 }), /Miktar/);
  await assert.rejects(L.setGlobalLimits({ new_article: 999 }), /0 ile 50/);
  await assert.rejects(L.setGlobalLimits({ new_article: -1 }), /0 ile 50/);
});

test('limits: paused bots stop automatic work, not a person; the page data is read from the database', opts, async () => {
  const { projectId } = await site();
  await S.set('bots', { paused: true });
  const auto = await L.reserve({ workType: 'serp_queries', now: NOON });
  assert.deepEqual([auto.ok, auto.reason], [false, 'paused']);
  assert.equal((await L.reserve({ workType: 'serp_queries', manual: true, now: NOON })).ok, true, 'a person is not stopped by the switch, the limits still apply');
  await S.set('bots', { paused: false });
  await L.setGlobalLimits({ serp_queries: 77 }); await L.setProjectLimits(projectId, { new_article: 5, refresh: 1 });
  const page = await L.getLimits({ projectId });
  assert.equal(page.global.find((i) => i.workType === 'serp_queries').limit, 77);
  assert.equal(page.global.find((i) => i.workType === 'serp_queries').isDefault, false);
  assert.equal(page.global.find((i) => i.workType === 'new_article').isDefault, true);
  assert.equal(page.global.find((i) => i.workType === 'new_article').project.limit, 5);
  assert.equal(page.global.find((i) => i.workType === 'refresh').project.limit, 1);
  assert.equal(page.categories.length, 5);
  await L.setGlobalLimits({ serp_queries: null });
  assert.equal((await L.getLimits()).global.find((i) => i.workType === 'serp_queries').limit, 30, 'null = back to the default');
});

test('RACE: 40 simultaneous requests for 10 free places hand out exactly 10, at every level', opts, async () => {
  const { projectId, cats } = await site();
  await L.setGlobalLimits({ new_article: 10 });
  await L.setProjectLimits(projectId, { new_article: 10 });
  await L.setCategoryLimits(cats[0].id, { dailyMax: 10 });
  const results = await Promise.all(Array.from({ length: 40 }, () => L.reserve({ workType: 'new_article', projectId, categoryId: cats[0].id, now: NOON })));
  assert.equal(results.filter((r) => r.ok).length, 10);
  assert.equal(results.filter((r) => !r.ok && r.reason === 'limit').length, 30);
  const rows = (await H.db().query("SELECT scope, used FROM daily_work_usage WHERE work_type = 'new_article' ORDER BY scope")).rows;
  assert.deepEqual(rows, [{ scope: 'category', used: 10 }, { scope: 'global', used: 10 }, { scope: 'project', used: 10 }], 'one row per level, every counter exactly 10');
});

test('RACE: concurrent requests over two categories never pass the project limit and never dead-lock', opts, async () => {
  const { projectId, cats } = await site();
  await L.setGlobalLimits({ new_article: 50 });
  await L.setProjectLimits(projectId, { new_article: 7 });
  await L.setCategoryLimits(cats[0].id, { dailyMax: 5 }); await L.setCategoryLimits(cats[1].id, { dailyMax: 5 });
  const calls = Array.from({ length: 60 }, (_, i) => L.reserve({ workType: 'new_article', projectId, categoryId: cats[i % 2].id, now: NOON }));
  const results = await Promise.all(calls);
  assert.equal(results.filter((r) => r.ok).length, 7);
  const rows = (await H.db().query("SELECT scope, used FROM daily_work_usage WHERE work_type = 'new_article'")).rows;
  const by = (s) => rows.filter((r) => r.scope === s).map((r) => r.used).sort();
  assert.deepEqual(by('global'), [7]); assert.deepEqual(by('project'), [7]);
  const cat = by('category'); assert.equal(cat.length, 2); assert.equal(cat[0] + cat[1], 7); assert.ok(cat[0] <= 5 && cat[1] <= 5);
});

test('RACE: the very first requests of a new day (no usage row yet) cannot create duplicate counters', opts, async () => {
  await L.setGlobalLimits({ news_items: 25 });
  const results = await Promise.all(Array.from({ length: 30 }, () => L.reserve({ workType: 'news_items', now: new Date('2027-01-05T10:00:00Z') })));
  assert.equal(results.filter((r) => r.ok).length, 25);
  const rows = (await H.db().query("SELECT used FROM daily_work_usage WHERE work_type = 'news_items'")).rows;
  assert.deepEqual(rows, [{ used: 25 }]);
});
