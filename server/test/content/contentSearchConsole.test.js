process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { makeKey, fakeGoogle } = require('./fakeGoogle');
const P = require('../../src/content/services/projects');
const A = require('../../src/content/services/articles');
const PR = require('../../src/content/services/providers');
const SI = require('../../src/content/services/sites');
const GSC = require('../../src/content/services/searchconsole');
const HL = require('../../src/content/services/health');
const SC = require('../../src/content/services/scheduler');
const PB = require('../../src/content/services/publishing');

/**
 * Phase 6b, Search Console: the service-account connection (the JWT is really signed and verified), what is read and stored, the numbers and the opportunities derived from them,
 * and the promise that nothing is estimated: no data = no numbers. Google is a fake behind an injected fetch.
 */
const opts = { skip: H.skip };
const NOW = new Date('2026-11-23T12:00:00Z');
const END = new Date(NOW.getTime() - 3 * 86400000);
const day = (back) => new Date(END.getTime() - back * 86400000).toISOString().slice(0, 10);
const KEY = makeKey();

test.before(async () => { if (!H.skip) await H.freshDatabase(); });
test.beforeEach(async () => { if (!H.skip) await H.clean(); });
test.after(async () => { if (!H.skip) await H.close(); });

const setup = async () => (await P.seedDefault()).projectId;
const google = (rows, o = {}) => fakeGoogle({ publicKey: KEY.publicKey, email: KEY.json.client_email, rows, ...o });
async function connect(pid, g, { property = 'sc-domain:example.com' } = {}) {
  await PR.save('searchconsole', { secret: JSON.stringify(KEY.json) });
  const s = await SI.create(pid, { name: 'Blog', apiUrl: 'http://127.0.0.1:9', username: 'u', password: 'p p p p', gscProperty: property }); void g; return s;
}
let seq = 0;
async function published(pid, siteId, url, title) {
  seq++; const cats = await P.listCategories(pid);
  const a = await A.create({ projectId: pid, h1: title || `Article ${seq}`, seoTitle: `Article ${seq}`, metaDescription: 'm'.repeat(100), focusKeyword: `focus phrase ${seq}`, categoryId: cats[0].id, contentHtml: `<h2>x</h2><p>${'word '.repeat(300)}</p>`, articleType: 'evergreen_guide' });
  await H.db().query("UPDATE articles SET status = 'published' WHERE id = $1", [a.id]);
  await H.db().query("INSERT INTO publications (project_id, article_id, site_id, mode, status, wp_post_id, wp_url) VALUES ($1,$2,$3,'publish','published',$4,$5)", [pid, a.id, siteId, 1000 + seq, url]);
  return a;
}
const PAGE = { a: 'https://example.com/post-a/', b: 'https://example.com/post-b/', c: 'https://example.com/post-c/' };
/** 90 days: page A steady (3 clicks of 100 impressions at position 3), page B drops from 5 to 2 clicks a day, page C grows from 2 to 5: the site as a whole stays level */
function dataset(body) {
  const dims = body.dimensions.join(',');
  if (dims === 'date,page') {
    const out = []; for (let back = 0; back < 90; back++) { const cur = back < 28; const d = day(back);
      out.push({ keys: [d, PAGE.a], clicks: 3, impressions: 100, ctr: 0.03, position: 3 }, { keys: [d, PAGE.b], clicks: cur ? 2 : 5, impressions: 80, ctr: 0.03, position: 8 }, { keys: [d, PAGE.c], clicks: cur ? 5 : 2, impressions: 60, ctr: 0.05, position: 5 }); }
    return out.filter((r) => r.keys[0] >= body.startDate && r.keys[0] <= body.endDate);
  }
  if (dims === 'query,page') {
    const cur = body.endDate === day(0);
    if (cur) return [{ keys: ['chatgpt plus alternatives', PAGE.a], clicks: 1, impressions: 120, ctr: 0.01, position: 14 }, { keys: ['chatgpt plus price', PAGE.a], clicks: 30, impressions: 900, ctr: 0.03, position: 3 }, { keys: ['too rare', PAGE.a], clicks: 0, impressions: 10, ctr: 0, position: 22 },
      ...['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((q, i) => ({ keys: [`new ${q}`, PAGE.c], clicks: 6 - i, impressions: 100 - i, ctr: 0.05, position: 5 }))];
    return ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((q, i) => ({ keys: [`old ${q}`, PAGE.c], clicks: 6 - i, impressions: 100 - i, ctr: 0.05, position: 5 }));
  }
  if (dims === 'country') return [{ keys: ['usa'], clicks: 300, impressions: 5000, ctr: 0.06, position: 5 }, { keys: ['gbr'], clicks: 40, impressions: 900, ctr: 0.04, position: 6 }];
  if (dims === 'device') return [{ keys: ['MOBILE'], clicks: 200, impressions: 3000, ctr: 0.06, position: 5 }, { keys: ['DESKTOP'], clicks: 140, impressions: 3000, ctr: 0.04, position: 5 }];
  return [];
}

test('the key and the connection test: a service-account JSON is checked, stored encrypted, and a wrong one is explained in words (the secret never appears)', opts, async () => {
  await setup(); const g = google(dataset);
  await assert.rejects(PR.save('searchconsole', { secret: 'not json' }), /geçerli bir JSON değil/); await assert.rejects(PR.save('searchconsole', { secret: '{"client_email":"a@b.c"}' }), /client_email ve private_key/);
  const saved = await PR.save('searchconsole', { secret: JSON.stringify(KEY.json, null, 2) }); assert.deepEqual([saved.configured, saved.secretLast4, saved.paid], [true, '5678', false]); assert.ok(!JSON.stringify(await PR.list()).includes('BEGIN PRIVATE KEY'));
  assert.equal((await H.db().query("SELECT encrypted_secret FROM api_providers WHERE key = 'searchconsole'")).rows[0].encrypted_secret.startsWith('enc:v1:'), true);
  const ok = await PR.test('searchconsole', { fetchImpl: g.fetchImpl }); assert.deepEqual([ok.ok, /svc-account@project-1.*1 siteye erişebiliyor.*sc-domain:example.com/.test(ok.message)], [true, true]);
  const none = google(dataset, { sites: [] }); assert.match((await PR.test('searchconsole', { fetchImpl: none.fetchImpl })).message, /0 siteye.*e-postayı kullanıcı olarak ekleyin/);
  const other = makeKey(); const bad = fakeGoogle({ publicKey: other.publicKey, email: KEY.json.client_email }); const r = await PR.test('searchconsole', { fetchImpl: bad.fetchImpl }); assert.deepEqual([r.ok, /reddetti.*Invalid JWT Signature/.test(r.message), r.message.includes('PRIVATE KEY')], [false, true, false]);
  g.st.apiStatus = 403; assert.match((await PR.test('searchconsole', { fetchImpl: g.fetchImpl })).message, /izin vermedi/);
  const claim = g.st.lastClaim; assert.deepEqual([claim.iss, claim.scope, claim.aud, claim.exp - claim.iat, g.st.lastHeader.alg], [KEY.json.client_email, 'https://www.googleapis.com/auth/webmasters.readonly', 'https://oauth2.googleapis.com/token', 3600, 'RS256']);
});

test('the client: the token is fetched once and reused; refusals become sentences; only FINAL data is asked for', opts, async () => {
  const g = google(dataset); const c = GSC.createClient({ keyJson: KEY.json, fetchImpl: g.fetchImpl, now: () => NOW });
  await c.listSites(); await c.listSites(); assert.equal(g.st.tokens, 1, 'one token for both calls');
  const rows = await c.query('sc-domain:example.com', { startDate: day(27), endDate: day(0), dimensions: ['date', 'page'] }); assert.equal(rows.length, 28 * 3); assert.equal(g.queries()[0].body.dataState, 'final');
  await assert.rejects(c.query('sc-domain:other.com', { startDate: day(1), endDate: day(0), dimensions: ['date'] }), (e) => e.code === 'no_site' && /Search Console sitesi/.test(e.message));
  g.st.apiStatus = 500; await assert.rejects(c.listSites(), (e) => e.code === 'server' && e.retryable === true); g.st.apiStatus = 429; await assert.rejects(c.listSites(), (e) => e.retryable === true);
  assert.throws(() => GSC.createClient({ keyJson: '{' }), /geçerli bir JSON değil/); assert.throws(() => GSC.createClient({ keyJson: { client_email: 'x' } }), /private_key olmalı/);
  const broken = GSC.createClient({ keyJson: { client_email: 'x@y.z', private_key: 'garbage' }, fetchImpl: g.fetchImpl }); await assert.rejects(broken.listSites(), /özel anahtarı okunamadı/);
});

test('sync: three days of lag are left out, the windows are 90 / 28 / 28 days, everything is stored (a second sync replaces, never duplicates), failures are written on the site', opts, async () => {
  const pid = await setup(); const g = google(dataset); const s = await connect(pid, g);
  const r = await GSC.sync(s.id, { fetchImpl: g.fetchImpl, now: NOW }); assert.deepEqual([r.through, r.rows, r.queries, r.countries, r.devices], [day(0), 270, 9 + 6, 2, 2]);
  const q = g.queries(); assert.deepEqual([q[0].body.startDate, q[0].body.endDate, q[0].body.dimensions, q[0].property], [day(89), day(0), ['date', 'page'], 'sc-domain:example.com']);
  assert.deepEqual([q[1].body.startDate, q[1].body.endDate, q[2].body.startDate, q[2].body.endDate], [day(27), day(0), day(55), day(28)], 'the newest 28 days and the 28 before');
  const n = async (t) => (await H.db().query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n; assert.deepEqual([await n('gsc_daily'), await n('gsc_queries'), await n('gsc_breakdowns')], [270, 15, 4]);
  await GSC.sync(s.id, { fetchImpl: g.fetchImpl, now: NOW }); assert.deepEqual([await n('gsc_daily'), await n('gsc_queries')], [270, 15], 'again: replaced, not doubled');
  const site = await SI.get(s.id); assert.deepEqual([site.gscSyncedAt !== null, site.gscError, site.gscProperty], [true, null, 'sc-domain:example.com']);
  g.st.apiStatus = 403; await assert.rejects(GSC.sync(s.id, { fetchImpl: g.fetchImpl, now: NOW }), (e) => e.status === 409 && /izin vermedi/.test(e.message)); assert.match((await SI.get(s.id)).gscError, /izin vermedi/); assert.equal(await n('gsc_daily'), 270, 'a failed read keeps the old numbers');
  await SI.update(s.id, { gscProperty: null }); await assert.rejects(GSC.sync(s.id, { fetchImpl: g.fetchImpl }), /Search Console sitesi yazılmamış/);
  await assert.rejects(SI.update(s.id, { gscProperty: 'example.com' }), /sc-domain:alanadi\.com/); assert.equal((await SI.update(s.id, { gscProperty: 'https://example.com/' })).gscProperty, 'https://example.com/');
  await H.db().query("DELETE FROM api_providers WHERE key = 'searchconsole'"); await SI.update(s.id, { gscProperty: 'sc-domain:example.com' }); await assert.rejects(GSC.sync(s.id, { fetchImpl: g.fetchImpl }), (e) => e.status === 409 && /henüz ayarlanmadı/.test(e.message));
});

test('performance: totals and the change against the period before, the position weighted by impressions, daily series, pages matched to their ARTICLES by address, queries, countries, devices; no data = no numbers', opts, async () => {
  const pid = await setup(); const g = google(dataset); const s = await connect(pid, g);
  const none = await GSC.performance(s.id, { days: 28, now: NOW }); assert.deepEqual([none.connected, /henüz çekilmedi/.test(none.note), none.current], [false, true, undefined], 'a property without data says so, it does not show zeros');
  const bare = await SI.create(pid, { name: 'Bare', apiUrl: 'http://127.0.0.1:8', username: 'u', password: 'p p p p' }); assert.match((await GSC.performance(bare.id, { now: NOW })).note, /Search Console bağlı değil.*uydurulmaz/);
  await GSC.sync(s.id, { fetchImpl: g.fetchImpl, now: NOW });
  const art = await published(pid, s.id, 'https://www.example.com/post-b', 'The B article'); await published(pid, s.id, 'https://example.com/other-post/', 'Other');
  const p = await GSC.performance(s.id, { days: 28, now: NOW });
  assert.deepEqual([p.connected, p.through, p.current.clicks, p.previous.clicks, p.current.impressions, p.change.clicksPct, p.change.impressionsPct], [true, day(0), 28 * 10, 28 * 10, 28 * 240, 0, 0]);
  assert.deepEqual([p.current.ctr, p.current.position], [Math.round((280 / 6720) * 10000) / 10000, Math.round(((3 * 100 + 8 * 80 + 5 * 60) / 240) * 10) / 10], 'CTR = clicks / impressions; position weighted by impressions'); assert.equal(p.series.length, 28);
  const pb = p.pages.find((x) => x.page === PAGE.b); assert.deepEqual([pb.clicks, pb.prevClicks, pb.clicksChangePct, pb.article && pb.article.title, pb.article && pb.article.articleId === art.id], [56, 140, -60, 'The B article', true], 'www and a trailing slash do not matter');
  assert.equal(p.pages.find((x) => x.page === PAGE.a).article, null); assert.deepEqual(p.queries[0], { query: 'chatgpt plus price', clicks: 30, impressions: 900, position: 3 });
  assert.deepEqual([p.countries[0].key, p.devices.length], ['usa', 2]); assert.ok(p.notes.some((n) => /2-3 gün geriden/.test(n)) && p.notes.some((n) => /mevsimsellik.*DEĞERLENDİRİLEMEZ/.test(n)));
  const w7 = await GSC.performance(s.id, { days: 7, now: NOW }); assert.deepEqual([w7.current.clicks, w7.previous.clicks], [70, 70]); const w90 = await GSC.performance(s.id, { days: 90, now: NOW }); assert.deepEqual([w90.current.clicks, w90.previous.clicks, w90.change.clicksPct], [900, 0, null], 'no earlier data: no percentage is invented');
  await assert.rejects(GSC.performance(s.id, { days: 14 }), /şunlardan biri|geçersiz/i);
});

test('opportunities: low CTR for the position, a click drop that is NOT the whole site, a drop that IS the whole site (demand: info only), new keyword ideas, a changed search intent - each says what it could not judge', opts, async () => {
  const pid = await setup(); const g = google(dataset); const s = await connect(pid, g); await GSC.sync(s.id, { fetchImpl: g.fetchImpl, now: NOW });
  const art = await published(pid, s.id, PAGE.b, 'The B article'); const o = await GSC.opportunities(s.id, { now: NOW }); const by = (k) => o.items.filter((i) => i.kind === k);
  assert.deepEqual([o.connected, by('low_ctr').length, by('click_drop').length, by('demand_drop').length, by('new_keyword').length, by('changed_intent').length], [true, 1, 1, 0, 1, 1]);
  assert.match(by('low_ctr')[0].text, /2800 gösterim.*%3\.0.*%10 civarı/); assert.equal(by('low_ctr')[0].page, PAGE.a);
  const drop = by('click_drop')[0]; assert.deepEqual([drop.severity, drop.article.articleId, /%60 düştü \(140 → 56\)/.test(drop.text), /Tek başına güncelleme gerekçesi değildir/.test(drop.text), /mevsimsellik değerlendirilemedi/.test(drop.text)], ['review', art.id, true, true, true]);
  assert.deepEqual([by('new_keyword')[0].query, by('new_keyword').some((x) => x.query === 'too rare')], ['chatgpt plus alternatives', false], 'a handful of impressions is not an opportunity');
  assert.match(by('changed_intent')[0].text, /ilk 6 aramanın yalnızca 0 tanesi/); assert.match(o.note, /hiçbiri makaleyi kendiliğinden değiştirmez/);
  // the whole site fell: the same page drop is "demand", information only
  const falling = (body) => dataset(body).map((r) => (body.dimensions[0] === 'date' && r.keys[0] >= day(27) ? { ...r, clicks: Math.max(1, Math.floor(r.clicks / 3)) } : r));
  const g2 = google(falling); await GSC.sync(s.id, { fetchImpl: g2.fetchImpl, now: NOW }); const o2 = await GSC.opportunities(s.id, { now: NOW });
  assert.ok(o2.items.filter((i) => i.kind === 'demand_drop').length >= 1 && o2.items.filter((i) => i.kind === 'click_drop').length === 0); assert.ok(o2.items.filter((i) => i.kind === 'demand_drop').every((i) => i.severity === 'info' && /genel talep/.test(i.text)));
  await H.db().query('DELETE FROM gsc_daily'); await H.db().query('UPDATE wp_sites SET gsc_synced_at = NULL'); assert.deepEqual((await GSC.opportunities(s.id)).items, []);
});

test('health: a drop raises the priority a little and is counted, but it is NEVER a reason to flag the article for an update; without Search Console the page says "not connected"', opts, async () => {
  const pid = await setup(); const g = google(dataset); const s = await connect(pid, g);
  const art = await published(pid, s.id, PAGE.b, 'The B article'); const quiet = await published(pid, s.id, 'https://example.com/quiet/', 'Quiet article');
  let o = await HL.overview(pid, { now: NOW }); assert.deepEqual([o.performance.connected, o.counts.performanceDrops, o.items.every((i) => i.performance === null)], [false, null, true]); assert.match(o.performance.note, /Search Console bağlı değil/);
  const base = o.items.find((i) => i.id === art.id).priority; await GSC.sync(s.id, { fetchImpl: g.fetchImpl, now: NOW });
  o = await HL.overview(pid, { now: NOW }); const it = o.items.find((i) => i.id === art.id);
  assert.deepEqual([o.performance.connected, o.counts.performanceDrops, it.performance.drop, it.performance.changePct, it.priority - base, o.items.find((i) => i.id === quiet.id).performance], [true, 1, true, -60, 10, null]);
  const as = await HL.assess(art.id, { now: NOW }); assert.deepEqual([as.needsUpdate, as.signals], [false, []], 'a traffic drop alone does not mean the article should change');
  assert.equal((await A.get(art.id)).status, 'published');
});

test('the Search Console bot: skipped without a site/property or without a key, reads every site otherwise, a failing read fails the job (retry only when Google was merely busy)', opts, async () => {
  const pid = await setup(); const g = google(dataset); await SC.updateSchedule('seo_performance', { enabled: true });
  const run = async (ctx) => { await H.db().query("UPDATE jobs SET status = 'done' WHERE status IN ('queued', 'running')"); await SC.saveSchedule('seo_performance', { nextRunAt: null }); await SC.tick({ now: NOW }); let j; do { j = await SC.workOnce({ now: NOW, ctx: { newsFetch: async () => ({ status: 200, body: '<rss version="2.0"><channel></channel></rss>', url: 'x' }), gapMs: 0, ...ctx } }); } while (j && j.botKey !== 'seo_performance'); return j; };
  let j = await run({ fetchImpl: g.fetchImpl }); assert.deepEqual([j.outcome, /yazılmış bir WordPress sitesi yok/.test(j.result.message)], ['skipped', true]);
  const s = await connect(pid, g); await H.db().query("DELETE FROM api_providers WHERE key = 'searchconsole'"); j = await run({ fetchImpl: g.fetchImpl }); assert.deepEqual([j.outcome, /bağlı değil/.test(j.result.message)], ['skipped', true]);
  await PR.save('searchconsole', { secret: JSON.stringify(KEY.json) }); j = await run({ fetchImpl: g.fetchImpl, now: NOW }); assert.deepEqual([j.outcome, j.result.stats.synced], ['done', 1]); assert.match(j.result.message, /1 siteden Search Console verisi/);
  g.st.apiStatus = 403; j = await run({ fetchImpl: g.fetchImpl }); assert.deepEqual([j.outcome, /izin vermedi/.test(j.error)], ['failed', true], 'a refusal is not retried: the owner has to fix the permission'); g.st.apiStatus = null; void s;
  g.st.apiStatus = 500; j = await run({ fetchImpl: g.fetchImpl }); assert.equal(j.outcome, 'retry', 'a busy Google is retried');
});
