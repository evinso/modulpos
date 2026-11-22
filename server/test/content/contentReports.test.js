process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const SI = require('../../src/content/services/sites');
const PR = require('../../src/content/services/providers');
const RP = require('../../src/content/services/reports');
const PF = require('../../src/content/services/portfolio');
const CO = require('../../src/content/services/costs');
const NT = require('../../src/content/services/notifications');
const SC = require('../../src/content/services/scheduler');
const S = require('../../src/content/services/settings');

/**
 * Phase 7b: the reports (what happened in whole local days, measured and stored), all sites side by side, and the cost analysis. The promise in every test: a number that was not
 * measured is "veri yok" / unknown, never 0, and a cost without a price is counted but never added as 0.
 */
const opts = { skip: H.skip };
const NOW = new Date('2026-11-23T08:00:00Z');                       // a Monday, 11:00 in Istanbul: the daily report is for Sunday 2026-11-22 = [2026-11-21T21:00Z, 2026-11-22T21:00Z)
const IN = (h) => new Date(Date.parse('2026-11-21T21:00:00Z') + h * 3600000);   // h hours after the start of the reported day
test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

const setup = async () => (await P.seedDefault()).projectId;
let seq = 0;
async function art(pid, o = {}) { seq++; let cats = await P.listCategories(pid); if (!cats.length) { await P.createCategory(pid, { name: 'Genel', nameEn: 'General' }); cats = await P.listCategories(pid); } const a = await A.create({ projectId: pid, h1: `Report article ${seq}`, seoTitle: 'x', metaDescription: 'm'.repeat(100), focusKeyword: `report focus ${seq} phrase`, categoryId: cats[0].id, contentHtml: `<h2>x</h2><p>${'word '.repeat(300)}</p>`, articleType: 'evergreen_guide' });
  await H.db().query('UPDATE articles SET status = $2, created_at = $3, created_by = $4, adsense_risk = $5 WHERE id = $1', [a.id, o.status || 'needs_review', o.at || IN(5), o.by || 'ai', o.risk || null]); return a; }
const usage = async (o) => { const id = await PR.recordUsage({ provider: 'anthropic', operation: 'article_write', requests: 1, costUsd: 0.1, result: 'ok', ...o }); if (o.at) await H.db().query('UPDATE api_usage SET created_at = $2 WHERE id = $1', [id, o.at]); return id; };

test('the daily report counts exactly the whole local day: both edges, what is measured and what is not, costs with unknown calls kept apart, projects kept apart', opts, async () => {
  const pid = await setup(); const other = (await P.createProject({ name: 'Another project', niche: { mainNiche: 'Travel rules' } })).id;
  await art(pid, { at: IN(0) }); await art(pid, { at: IN(24 - 0.001) }); await art(pid, { at: IN(24), by: 'manual' }); await art(pid, { at: IN(-0.001) });                    // in, in, OUT (the end is exclusive), OUT
  await art(other, { at: IN(5) });                                                                                                                                    // another project's article is not counted
  const site = await SI.create(pid, { name: 'Blog', apiUrl: 'http://127.0.0.1:9', username: 'u', password: 'abcd efgh ijkl mnop' }); const a1 = await art(pid, { status: 'published', at: IN(-100), risk: 'review' });
  await H.db().query("INSERT INTO publications (project_id, article_id, site_id, mode, status, published_at, created_at, updated_at) VALUES ($1,$2,$3,'publish','published',$4,$4,$4)", [pid, a1.id, site.id, IN(7)]);
  const a2 = await art(pid, { status: 'ready', at: IN(-100) });
  await H.db().query("INSERT INTO publications (project_id, article_id, site_id, mode, status, created_at, updated_at, last_error) VALUES ($1,$2,$3,'publish','failed',$4,$4,'403')", [pid, a2.id, site.id, IN(8)]);
  await H.db().query("INSERT INTO refresh_proposals (project_id, article_id, kind, status, base_version, proposed, created_at, updated_at) VALUES ($1,$2,'minor','applied',1,'{}',$3,$3)", [pid, a1.id, IN(9)]);
  const q = require('../../src/content/services/queue'); for (const [bot, status, err] of [['news_discovery', 'done'], ['news_discovery', 'done'], ['content_health', 'skipped'], ['content_publishing', 'failed', 'WordPress said no']]) { const j = (await q.enqueue({ botKey: bot, projectId: pid, dedupeKey: `${bot}:${status}:${Math.random()}` })).job; await H.db().query('UPDATE jobs SET status = $2, finished_at = $3, last_error = $4 WHERE id = $1', [j.id, status, IN(10), err || null]); }
  await usage({ projectId: pid, costUsd: 0.25, at: IN(11) }); await usage({ projectId: pid, costUsd: null, provider: 'openai', operation: 'fact_check', at: IN(12) }); await usage({ projectId: null, costUsd: 0.05, at: IN(13), provider: 'serper', operation: 'serp_organic' });
  await usage({ projectId: other, costUsd: 9, at: IN(14) }); await usage({ projectId: pid, costUsd: 5, at: IN(30) });                                         // another project's money and a call after the day: not in this report
  await H.db().query("INSERT INTO news_items (project_id, source_id, title, url, url_hash, status, fetched_at) SELECT $1, s.id, 'n1', 'https://x/1', 'h1', 'relevant', $2 FROM news_sources s LIMIT 1", [pid, IN(3)]).catch(() => {});
  await NT.create({ type: 'publish_failed', severity: 'warning', title: 'WordPress yayını başarısız oldu' }); await H.db().query("UPDATE notifications SET created_at = $1", [IN(8)]); await NT.create({ type: 'update_proposed', severity: 'info', title: 'quiet' });
  const rep = await RP.generate(pid, 'daily', { now: NOW, userId: null });
  assert.deepEqual([rep.kind, rep.dayFrom, rep.dayTo, rep.timezone], ['daily', '2026-11-22', '2026-11-22', 'Europe/Istanbul']);
  const d = rep.data;
  assert.deepEqual([d.articles.created, d.articles.aiDrafts], [2, 2], 'two articles inside the day, edges: the first instant counts, the end instant does not'); assert.deepEqual([d.articles.now.published, d.articles.now.ready, d.articles.adsenseRisky.review], [1, 1, 1]);
  assert.deepEqual([d.publishing.wentPublic, d.publishing.failedSends, d.publishing.sends.published, d.publishing.sends.failed], [1, 1, 1, 1]); assert.deepEqual([d.updates.applied, d.updates.proposals.length], [1, 1]);
  assert.deepEqual([d.jobs.done, d.jobs.skipped, d.jobs.failed], [2, 1, 1]); assert.deepEqual([d.jobs.failures[0].bot, d.jobs.failures[0].error], ['content_publishing', 'WordPress said no']);
  assert.deepEqual([d.cost.project.costUsd, d.cost.project.unknownCalls, d.cost.project.requests], [0.25, 1, 2], 'the unknown call is COUNTED, not added as 0'); assert.deepEqual([d.cost.unattributed.costUsd, d.cost.unattributed.requests], [0.05, 1]);
  assert.deepEqual(d.notable.map((x) => x.title), ['WordPress yayını başarısız oldu'], 'only warnings and criticals of that day'); assert.deepEqual(d.seo.sites[0], { site: 'Blog', available: false, note: 'Search Console bağlı değil' });
  assert.equal(d.adsense.sites.length, 0);
  assert.match(rep.body, /📅 Günlük rapor — 22 Kas/); assert.match(rep.body, /Makaleler: 2 yeni taslak \(2 yapay zekâ\), 1 tanesi sitede yayına çıktı/); assert.match(rep.body, /Görevler: 2 tamam, 1 atlandı, 1 başarısız \(örn\. content_publishing: WordPress said no\)\. 1 WordPress gönderimi başarısız/);
  assert.match(rep.body, /Maliyet: \$0\.25 \(\+1 çağrının maliyeti bilinmiyor\) — anthropic \$0\.25; projeye bağlanamayan \$0\.05/); assert.match(rep.body, /SEO \(Blog\): veri yok — Search Console bağlı değil/); assert.match(rep.body, /Dikkat:\n• ⚠️ WordPress yayını başarısız oldu/);
  assert.ok(!/NaN|undefined|null/.test(rep.body), 'no leaking placeholders');
  // a quiet project: real zeros for things that can be counted, no invented sections
  const quiet = await RP.generate(other, 'daily', { now: NOW }); assert.deepEqual([quiet.data.articles.created, quiet.data.jobs.failed, quiet.data.cost.project.costUsd], [1, 0, 9], 'its own numbers'); assert.deepEqual(quiet.data.seo.sites, []);
});

test('Search Console and AdSense in the report: only what is stored; a connected site reports its last 7 FINAL days, a site without data says so', opts, async () => {
  const pid = await setup(); const s1 = await SI.create(pid, { name: 'Connected', apiUrl: 'http://127.0.0.1:9', username: 'u', password: 'abcd efgh ijkl mnop', gscProperty: 'sc-domain:a.example' }); await SI.create(pid, { name: 'No data yet', apiUrl: 'http://127.0.0.2:9', username: 'u', password: 'abcd efgh ijkl mnop', gscProperty: 'sc-domain:b.example' });
  await H.db().query("UPDATE wp_sites SET gsc_synced_at = now() WHERE id = $1", [s1.id]);
  for (let i = 0; i < 14; i++) await H.db().query("INSERT INTO gsc_daily (site_id, day, page, clicks, impressions, position) VALUES ($1, ('2026-11-20'::date - $2::int), 'https://a.example/p/', $3, 100, 4)", [s1.id, i, i < 7 ? 10 : 5]);
  await H.db().query("INSERT INTO adsense_audits (project_id, url, status, verdict, reachable, summary, started_at) VALUES ($1,'https://a.example','done','not_ready',true,$2,$3)", [pid, JSON.stringify({ requiredMissing: ['privacy', 'ssl'], warning: 4 }), IN(1)]);
  const rep = await RP.generate(pid, 'daily', { now: NOW }); const seo = rep.data.seo.sites;
  assert.deepEqual(seo[0], { site: 'Connected', available: true, through: '2026-11-20', clicks: 70, impressions: 700, clicksChangePct: 100, impressionsChangePct: 0, position: 4 }); assert.equal(seo[1].available, false); assert.match(seo[1].note, /henüz çekilmedi/);
  assert.match(rep.body, /SEO \(Connected, 20 Kas gününe kadar son 7 gün\): 70 tıklama \(\+100%\), 700 gösterim/); assert.match(rep.body, /SEO \(No data yet\): veri yok/); assert.match(rep.body, /AdSense site denetimi: a\.example — eksikler var \(2 zorunlu eksik\)/);
});

test('making reports: weekly = the 7 days before today, one per period (remaking replaces it), the notification only for a NEW report, Mondays only for the weekly one, old ones are dropped', opts, async () => {
  const pid = await setup(); await S.set('telegram', { notify: { report: false } });
  const w = await RP.generate(pid, 'weekly', { now: NOW }); assert.deepEqual([w.kind, w.dayFrom, w.dayTo], ['weekly', '2026-11-16', '2026-11-22']); assert.match(w.body, /🗓 Haftalık rapor — 16 Kas – 22 Kas/);
  await art(pid, { at: IN(-24 * 3) });                                                                          // inside the week, outside the day
  const d = await RP.generate(pid, 'daily', { now: NOW, announce: true }); assert.equal(d.data.articles.created, 0); const w2 = await RP.generate(pid, 'weekly', { now: NOW }); assert.equal(w2.data.articles.created, 1); assert.equal(w2.id, w.id, 'the same period: the report is replaced, not duplicated');
  assert.equal((await H.db().query('SELECT count(*)::int n FROM reports')).rows[0].n, 2);
  const n1 = (await NT.list({})).items.filter((x) => x.type === 'report_ready'); assert.equal(n1.length, 1); assert.match(n1[0].title, /Günlük rapor hazır/);
  await RP.generate(pid, 'daily', { now: NOW, announce: true }); assert.equal((await NT.list({})).items.filter((x) => x.type === 'report_ready').length, 1, 'a remake is not announced again');
  await assert.rejects(RP.generate(pid, 'monthly', { now: NOW }), /Rapor türü/);
  // the scheduled pass
  await H.db().query('DELETE FROM reports'); await H.db().query("DELETE FROM notifications");
  const mon = await RP.generateDue(pid, { now: NOW }); assert.deepEqual(mon.made.map((r) => r.kind).sort(), ['daily', 'weekly']); assert.equal((await NT.list({})).items.filter((x) => x.type === 'report_ready').length, 2);
  assert.deepEqual((await RP.generateDue(pid, { now: NOW })).skipped, ['daily: zaten var', 'weekly: zaten var']);
  const tue = new Date(NOW.getTime() + 86400000); const t = await RP.generateDue(pid, { now: tue }); assert.deepEqual([t.made.map((r) => r.kind), t.skipped], [['daily'], ['weekly: bugün pazartesi değil']]);
  // old reports are dropped, recent ones stay
  await H.db().query("UPDATE reports SET period_start = period_start - interval '120 days' WHERE kind = 'daily' AND day_to = '2026-11-22'"); await RP.generate(pid, 'daily', { now: tue });
  assert.equal((await H.db().query("SELECT count(*)::int n FROM reports WHERE kind = 'daily'")).rows[0].n, 1, 'a daily report older than 100 days is removed');
  const list = await RP.list(pid, { kind: 'weekly' }); assert.deepEqual([list.length, list[0].data], [1, undefined], 'the list is light: no data blob'); assert.ok((await RP.get(list[0].id)).body.length > 50); await assert.rejects(RP.get('00000000-0000-0000-0000-000000000001'), /bulunamadı/);
  assert.equal((await RP.latest(pid, 'weekly')).kind, 'weekly'); assert.equal(await RP.latest('00000000-0000-0000-0000-000000000001'), null);
});

test('the reporting bot: the scheduled pass makes what is due and skips the rest; a person\'s "run now" remakes the daily report quietly', opts, async () => {
  const pid = await setup(); const q = require('../../src/content/services/queue');
  const ctx = { now: NOW };
  await q.enqueue({ botKey: 'reporting', projectId: pid, trigger: 'schedule', dedupeKey: `reporting:${pid}`, runAfter: NOW }); let j = await SC.workOnce({ now: NOW, ctx }); assert.deepEqual([j.botKey, j.outcome, /günlük ve haftalık rapor hazırlandı/.test(j.result.message)], ['reporting', 'done', true]);
  await q.enqueue({ botKey: 'reporting', projectId: pid, trigger: 'schedule', dedupeKey: `reporting:${pid}`, runAfter: NOW }); j = await SC.workOnce({ now: NOW, ctx }); assert.equal(j.outcome, 'skipped'); assert.match(j.result.message, /zaten var/);
  const before = (await NT.list({})).items.filter((x) => x.type === 'report_ready').length;
  await q.enqueue({ botKey: 'reporting', projectId: pid, trigger: 'manual', dedupeKey: `reporting:${pid}`, runAfter: NOW }); j = await SC.workOnce({ now: NOW, ctx }); assert.deepEqual([j.outcome, j.result.stats.kind], ['done', 'daily']); assert.equal((await NT.list({})).items.filter((x) => x.type === 'report_ready').length, before);
  assert.equal(SC.DEFAULTS.reporting.enabled, true); assert.deepEqual([SC.DEFAULTS.reporting.windowStart, SC.DEFAULTS.reporting.windowEnd, SC.DEFAULTS.reporting.spends], ['06:00', '12:00', false]);
});

test('all sites side by side: ranked by clicks among the sites that HAVE data, "not connected" is not 0, cost per article is unknown when any call had no price', opts, async () => {
  const pid = await setup(); const p2 = (await P.createProject({ name: 'Travel project', niche: { mainNiche: 'Travel rules' } })).id;
  const mk = async (project, name, url, clicks, o = {}) => { const s = await SI.create(project, { name, apiUrl: url, username: 'u', password: 'abcd efgh ijkl mnop', gscProperty: o.noGsc ? undefined : `sc-domain:${name.toLowerCase()}.example` });
    if (clicks !== null) { await H.db().query('UPDATE wp_sites SET gsc_synced_at = now() WHERE id = $1', [s.id]); for (let i = 0; i < 56; i++) await H.db().query("INSERT INTO gsc_daily (site_id, day, page, clicks, impressions, position) VALUES ($1, ('2026-11-20'::date - $2::int), $3, $4, 50, 5)", [s.id, i, `https://${name.toLowerCase()}.example/top/`, i < 28 ? clicks : Math.max(1, clicks - 1)]); } return s; };
  await mk(pid, 'Alpha', 'http://127.0.0.1:9', 3); const beta = await mk(p2, 'Beta', 'http://127.0.0.2:9', 10); await mk(p2, 'Gamma', 'http://127.0.0.3:9', null, { noGsc: true });
  const a1 = await art(pid, { status: 'published', at: new Date(NOW.getTime() - 5 * 86400000) }); await H.db().query("INSERT INTO publications (project_id, article_id, site_id, mode, status, published_at) SELECT $1, $2, s.id, 'publish', 'published', $3 FROM wp_sites s WHERE s.name = 'Alpha'", [pid, a1.id, new Date(NOW.getTime() - 3 * 86400000)]);
  await usage({ projectId: pid, costUsd: 0.4, at: new Date(NOW.getTime() - 86400000) }); await usage({ projectId: p2, costUsd: 1, at: new Date(NOW.getTime() - 86400000) }); await usage({ projectId: p2, costUsd: null, provider: 'openai', at: new Date(NOW.getTime() - 86400000) });
  await art(p2, { status: 'published', at: new Date(NOW.getTime() - 2 * 86400000) });
  await H.db().query("INSERT INTO adsense_audits (project_id, url, status, verdict, reachable, summary, started_at) VALUES ($1,'http://127.0.0.2:9','done','almost',true,$2,$3)", [p2, JSON.stringify({ requiredMissing: [], warning: 2 }), NOW]);
  const o = await PF.overview({ days: 28, now: NOW });
  assert.deepEqual(o.projects.map((p) => p.name), ['Travel project', 'Global Tech Content Site'], 'the project of the site with the most clicks comes first');
  const travel = o.projects[0]; assert.deepEqual(travel.sites.map((s) => [s.name, s.seo.connected, s.seo.clicks]), [['Beta', true, 280], ['Gamma', false, undefined]], 'unconnected goes last and has NO clicks field');
  assert.equal(travel.sites[1].seo.note, 'Search Console bağlı değil'); assert.deepEqual([travel.sites[0].seo.previousClicks, travel.sites[0].seo.clicksChangePct, travel.sites[0].seo.topPage.page], [252, 11.1, 'https://beta.example/top/']);
  assert.deepEqual([travel.sites[0].adsense.verdict, travel.sites[0].adsense.warnings], ['almost', 2]); assert.equal(travel.sites[1].adsense, null);
  assert.deepEqual([travel.cost.usd, travel.cost.unknownCalls, travel.cost.perAiArticleUsd], [1, 1, null]); assert.match(travel.cost.perArticleNote, /maliyeti bilinmiyor|yapay zekâ taslağı yok/);
  const alpha = o.projects[1]; assert.deepEqual([alpha.sites[0].published, alpha.sites[0].publishedInPeriod, alpha.cost.usd, alpha.cost.perAiArticleUsd, alpha.articles.aiDrafts], [1, 1, 0.4, 0.4, 1]);
  assert.deepEqual([o.totals.sites, o.totals.connected, o.totals.clicks], [3, 2, 364], 'totals only add what is measured'); assert.equal(o.notes.length, 3); await assert.rejects(PF.overview({ days: 5 }), /Dönem/);
  void beta;
});

test('cost analysis: totals with unknown calls apart, suggestions that name their numbers AND what they cannot know, a month-end estimate only with enough data, budgets in percent', opts, async () => {
  const pid = await setup(); const DAY = 86400000; const ago = (n, h = 3) => new Date(NOW.getTime() - n * DAY + h * 3600000 - 12 * 3600000);
  await PR.save('anthropic', { secret: 'sk-ant-test-0123456789abcdef' }); await PR.save('openai', { secret: 'sk-openai-test-0123456789abcdef' });
  for (let i = 1; i <= 8; i++) { await usage({ projectId: pid, costUsd: 0.2, operation: 'article_write', at: ago(i) }); await usage({ projectId: pid, costUsd: 0.25, operation: 'fact_check', at: ago(i, 4) }); await usage({ projectId: pid, costUsd: 0.2, operation: 'adsense_review', at: ago(i, 5) }); }
  for (let i = 0; i < 3; i++) await usage({ projectId: pid, costUsd: null, provider: 'openai', operation: 'article_write', at: ago(2) });
  for (let i = 0; i < 5; i++) await usage({ projectId: pid, costUsd: null, provider: 'openai', operation: 'article_write', result: 'error', requests: 1, at: ago(3) });
  await PR.recordUsage({ provider: 'serper', operation: 'serp_organic', requests: 1, costUsd: null, result: 'ok' });
  const kw = (await H.db().query("INSERT INTO keywords (project_id, keyword, country, language) VALUES ($1,'wifi 7 router','US','en'),($1,'ai phone','US','en'),($1,'mesh wifi','US','en') RETURNING id", [pid])).rows;
  for (const k of kw) for (let i = 0; i < 2; i++) await H.db().query("INSERT INTO serp_analyses (project_id, keyword_id, provider, fetched_at) VALUES ($1,$2,'serper',$3)", [pid, k.id, new Date(NOW.getTime() - (i + 1) * DAY)]);
  await H.db().query("INSERT INTO automation_runs (bot_key, project_id, status, stats, started_at) VALUES ('article_writer',$1,'ok','{\"costUsd\":0.65,\"unknownCost\":0}',$2), ('article_writer',$1,'ok','{\"costUsd\":0.75,\"unknownCost\":0}',$2), ('article_writer',$1,'partial','{\"costUsd\":0.4,\"unknownCost\":2}',$2)", [pid, ago(2)]);
  await PR.save('anthropic', { dailyBudgetUsd: 1, monthlyBudgetUsd: 50 });
  const a = await CO.analysis({ days: 30, now: NOW });
  assert.equal(a.totals.knownUsd, 8 * 0.65, 'only priced calls are added'); assert.equal(a.totals.unknownCalls, 3 + 1, 'the unpriced ones are counted (the 5 errors are errors, not unknown prices)');
  assert.equal(a.byProvider[0].provider, 'anthropic'); assert.deepEqual(a.byProvider.find((p) => p.provider === 'openai').errors, 5); assert.equal(a.biggest.provider, 'anthropic');
  assert.deepEqual([a.perArticle.runs, a.perArticle.pricedRuns, a.perArticle.unknownRuns, a.perArticle.avgUsd, a.perArticle.minUsd, a.perArticle.maxUsd], [3, 2, 1, 0.7, 0.65, 0.75]);
  const codes = a.recommendations.map((r) => r.code); assert.deepEqual(codes.sort(), ['checks_share', 'error_rate', 'prices_missing', 'serp_repeats']);
  for (const r of a.recommendations) assert.ok(r.title && r.text && r.cannotKnow && r.evidence, `${r.code} names its evidence and what it cannot know`);
  const checks = a.recommendations.find((r) => r.code === 'checks_share'); assert.match(checks.title, /%69/); assert.match(checks.cannotKnow, /ÖLÇÜLMEDİ/); assert.match(a.recommendations.find((r) => r.code === 'prices_missing').title, /OpenAI.*3 çağrının maliyeti bilinmiyor/); assert.deepEqual(a.recommendations.find((r) => r.code === 'serp_repeats').evidence.examples.length, 3);
  assert.ok(a.forecast && a.forecast.monthEndUsd > 5.2 && /tahmin/i.test(a.forecast.basis), 'enough days: an estimate that says what it is');
  const b = a.budgets.find((x) => x.label === 'Anthropic (Claude) aylık bütçesi'); assert.deepEqual([b.limitUsd, b.usedUsd, b.pct], [50, 5.2, 10]); assert.match(a.caveats[1], /Karşılaştır/);
  // too little data: no estimate, no suggestions that need data
  await H.clean(); const pid2 = await setup(); await usage({ projectId: pid2, costUsd: 0.1, at: ago(1) }); const few = await CO.analysis({ days: 30, now: NOW }); assert.deepEqual([few.forecast, few.recommendations.map((r) => r.code), few.perArticle.avgUsd], [null, [], null]);
  // a monthly budget exists: the "no limit" suggestion is not made; without one and with >= $1 spent it is
  for (let i = 1; i <= 6; i++) await usage({ projectId: pid2, costUsd: 0.3, at: ago(i, 6) });
  assert.ok((await CO.analysis({ days: 30, now: NOW })).recommendations.some((r) => r.code === 'no_monthly_budget')); await PR.save('anthropic', { monthlyBudgetUsd: 20 }); assert.ok(!(await CO.analysis({ days: 30, now: NOW })).recommendations.some((r) => r.code === 'no_monthly_budget'));
});

test('the 80% warning: once per budget and period, not before 80, not when full (that is "budget full"), and never while no budget exists', opts, async () => {
  await setup(); await PR.save('anthropic', { secret: 'sk-ant-test-0123456789abcdef', dailyBudgetUsd: 1 }); const warn = async () => (await NT.list({})).items.filter((n) => n.type === 'budget_warning');
  await usage({ costUsd: 0.5 }); await NT.flush(); assert.equal((await warn()).length, 0, '50%: nothing');
  await usage({ costUsd: 0.35 }); await NT.flush(); const w = await warn(); assert.equal(w.length, 1); assert.match(w[0].title, /Anthropic.*günlük bütçesi %85 doldu/s); assert.match(w[0].body, /\$0\.85 \/ \$1\.00/);
  await usage({ costUsd: 0.05 }); await NT.flush(); assert.equal((await warn()).length, 1, 'told once per budget and day');
  await usage({ costUsd: 0.2 }); await NT.flush(); assert.equal((await warn()).length, 1, 'over 100% is the "budget full" notice, not this one'); assert.equal((await PR.guard('anthropic', 0.1)).ok, false);
  await H.clean(); await setup(); const before = (await NT.list({})).total; await usage({ costUsd: 3 }); await NT.flush(); assert.equal((await NT.list({})).total, before, 'no budget: no warning');
  await PR.save('anthropic', { dailyBudgetUsd: 1 }); await S.set('budget', { dailyTotalUsd: 2, monthlyTotalUsd: null }); await H.db().query('DELETE FROM api_usage'); await usage({ costUsd: 0.9 }); await NT.flush(); assert.equal((await warn()).length, 1, 'the provider budget'); await usage({ costUsd: 0.1, provider: 'openai' }); await usage({ costUsd: 0.8, provider: 'openai' }); await NT.flush(); assert.ok((await warn()).some((n) => /Platform günlük bütçesi/.test(n.title)), 'the platform budget is watched too');
});
