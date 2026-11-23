process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { fakeModels, PAGE } = require('./fakeModels');
const { startFakeWp } = require('./fakeWordPress');
const P = require('../../src/content/services/projects');
const N = require('../../src/content/services/news');
const O = require('../../src/content/services/opportunities');
const PR = require('../../src/content/services/providers');
const L = require('../../src/content/services/limits');
const S = require('../../src/content/services/settings');
const A = require('../../src/content/services/articles');
const SI = require('../../src/content/services/sites');
const SC = require('../../src/content/services/scheduler');
const AU = require('../../src/content/services/automation');
const LV = require('../../src/content/services/automationLive');
const { FetchError } = require('../../src/content/lib/safeFetch');

/**
 * THE WHOLE CHAIN, the way the owner will run it: "Tam otomatik" is chosen on the page, then ONLY the scheduler and the worker act:
 * an idea -> the writer (fake Claude + OpenAI) -> the mandatory checks -> automatic approval -> the publishing bot -> a post on the (fake) WordPress site.
 * Nobody calls a service by hand after the mode is applied. Every outside service is a fake; the database, the queue, the limits and HTTP to the fake site are real.
 */
const opts = { skip: H.skip };
const MON = new Date('2026-11-23T10:00:00Z');                       // Monday 13:00 in Istanbul: inside the writing (09-23) and publishing (09-21) hours
const plus = (d, min) => new Date(d.getTime() + min * 60000);
let wp;
test.before(async () => { if (!H.skip) { await H.freshDatabase(); wp = await startFakeWp(); } });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await wp.close(); wp = await startFakeWp(); } });
test.after(async () => { if (!H.skip) { await wp.close(); await H.close(); } });

const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d || 'Sat, 22 Nov 2026 10:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;
const feeds = (map) => async (url) => { if (!map[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: map[url], url }; };
const FEEDS = { 'https://a.example/feed': rssOf([['OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1']]), 'https://b.example/feed': rssOf([['ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1', 'Sat, 22 Nov 2026 11:00:00 GMT']]) };
const pageFetcher = async (url) => { if (url === 'https://b.example/1') throw new FetchError('http', 'HTTP 403', { status: 403 }); return { body: PAGE() }; };
const probeOk = async () => ({ status: 'ok', http: 200, finalUrl: null, note: '' });                    // (the sources of the fake news are *.example: a real link check would call them broken)
const drain = async (now, ctx) => { let n = 0; const done = []; for (;;) { const j = await SC.workOnce({ now, ctx }); if (!j) return done; done.push(`${j.botKey}:${j.outcome}`); if (++n > 60) throw new Error('queue does not empty'); } };

test('the full chain: after "Tam otomatik" only the scheduler acts, and an idea ends as a published post - once, inside the limits, with every step visible on the live card', opts, async () => {
  const pid = (await P.seedDefault()).projectId;
  await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789', extra: { inputPricePerM: '3', outputPricePerM: '15' } });
  await PR.save('openai', { secret: 'sk-test-key-0123456789abcdef', extra: { model: 'gpt-test', inputPricePerM: '1', outputPricePerM: '4' } });
  const site = await SI.create(pid, { name: 'Tech Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); assert.equal((await SI.test(site.id)).ok, true);
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await N.runDiscovery(pid, { fetchImpl: feeds(FEEDS), now: MON, gapMs: 0 }); await O.refresh(pid, { now: MON });
  await H.db().query("UPDATE content_opportunities SET eligible = true, ineligible_reason = ''");          // (the real score needs search-volume data the fakes do not have)
  const idea = (await O.list(pid)).items[0];

  // the owner presses the buttons: first the question, then the yes
  await assert.rejects(AU.apply({ projectId: pid, mode: 'custom', options: { writer: true, autoApprove: true, publishing: true, publishLive: true } }), (e) => e.extra.requiresConfirmation === true);
  const r = await AU.apply({ projectId: pid, mode: 'custom', confirm: true, options: { news: false, opportunities: false, niche: false, writer: true, autoApprove: true, publishing: true, publishLive: true },
    values: { minQuality: 50, dailyArticles: 2, dailyPublish: 2 } });                                  // (news/opportunity bots off: a re-score would undo the forced eligibility above)
  assert.deepEqual(['writer', 'autoApprove', 'publishing', 'publishLive'].map((k) => r.options.find((o) => o.key === k).on), [true, true, true, true]);

  // from here on nobody calls a service: the scheduler queues, the worker works
  const m = fakeModels(); const ctx = { fetchImpl: m.fetchImpl, fetcher: pageFetcher, newsFetch: feeds(FEEDS), gapMs: 0, probe: probeOk };
  const t = await SC.tick({ now: MON }); assert.ok(['article_writer', 'content_publishing'].every((b) => t.enqueued.some((e) => e.bot === b)), JSON.stringify(t.enqueued.map((e) => e.bot)));
  const during = await LV.live(pid, { now: MON }); assert.ok(during.bots.find((b) => b.key === 'article_writer').state === 'queued' && during.summary.queued >= 2, 'the live card sees the queued work');
  const ran = await drain(MON, ctx); assert.ok(ran.includes('article_writer:done'), ran.join(' '));
  const art = (await H.db().query("SELECT id, status, created_by, quality_score, adsense_risk FROM articles")).rows;
  assert.equal(art.length, 1); assert.equal(art[0].created_by, 'ai'); assert.ok(art[0].quality_score >= 50 && art[0].adsense_risk === 'low', 'the mandatory checks ran and passed');
  assert.equal((await H.db().query("SELECT count(*)::int n FROM audit_logs WHERE action = 'article.auto_approve'")).rows[0].n, 1, 'the automation approved it, and said so in the audit log');

  // the publishing bot ran in the same pass (queued after the writer) and found the approved article only because it was approved by then: if not, the next tick does
  if (!ran.includes('content_publishing:done') || !wp.posts.size) { await SC.saveSchedule('content_publishing', { nextRunAt: null }); await SC.tick({ now: plus(MON, 70) }); await drain(plus(MON, 70), ctx); }
  await drain(plus(MON, 75), ctx);                                                                      // the per-article send job
  const posts = [...wp.posts.values()]; assert.equal(posts.length, 1, 'exactly one post on the site'); assert.equal(posts[0].status, 'publish', 'live, not a draft: the owner chose "doğrudan yayımla"');
  const pub = (await H.db().query('SELECT status, wp_post_id FROM publications')).rows; assert.deepEqual([pub.length, pub[0].status], [1, 'published']);
  assert.equal((await A.get(art[0].id)).status, 'published');
  assert.equal((await L.status({ projectId: pid, now: MON })).items.find((i) => i.workType === 'new_article').done, 1); assert.equal((await L.status({ projectId: pid, now: MON })).items.find((i) => i.workType === 'publish').done, 1);

  // later ticks change nothing: no second article for the same idea, no second post
  for (const min of [200, 400, 800]) { await H.db().query("UPDATE schedule_settings SET next_run_at = NULL"); await SC.tick({ now: plus(MON, min) }); await drain(plus(MON, min), ctx); }
  assert.deepEqual([(await H.db().query('SELECT count(*)::int n FROM articles')).rows[0].n, wp.posts.size, (await H.db().query('SELECT count(*)::int n FROM publications')).rows[0].n], [1, 1, 1], 'nothing is written or sent twice');
  assert.equal((await O.get(idea.id)).status, 'written');
  const live = await LV.live(pid, { now: plus(MON, 800) });
  assert.ok(live.events.some((e) => e.bot === 'article_writer' && e.outcome === 'ok') && live.events.some((e) => e.bot === 'content_publishing'), 'the writer and the publishing bot are in the feed of the live card');
  assert.equal(live.pipeline.needsReview, 0, 'nothing waits for a person: the draft was approved by the automation and is already on the site');
});

test('the same chain in "Yarı otomatik": the draft waits for a person, and WordPress gets nothing until the person approves - then only a DRAFT', opts, async () => {
  const pid = (await P.seedDefault()).projectId;
  await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789' }); await PR.save('openai', { secret: 'sk-test-key-0123456789abcdef', extra: { model: 'gpt-test' } });
  const site = await SI.create(pid, { name: 'Tech Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); assert.equal((await SI.test(site.id)).ok, true);
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await N.runDiscovery(pid, { fetchImpl: feeds(FEEDS), now: MON, gapMs: 0 }); await O.refresh(pid, { now: MON });
  await H.db().query("UPDATE content_opportunities SET eligible = true, ineligible_reason = ''");
  await AU.apply({ projectId: pid, mode: 'custom', options: { news: false, opportunities: false, niche: false, writer: true, publishing: true }, values: { minQuality: 50 } });
  const m = fakeModels(); const ctx = { fetchImpl: m.fetchImpl, fetcher: pageFetcher, newsFetch: feeds(FEEDS), gapMs: 0, probe: probeOk };
  await SC.tick({ now: MON }); await drain(MON, ctx);
  const a = (await H.db().query('SELECT id, status FROM articles')).rows[0]; assert.equal(a.status, 'needs_review', 'a person has to look at it'); assert.equal(wp.posts.size, 0, 'nothing reached WordPress');
  await SC.saveSchedule('content_publishing', { nextRunAt: null }); await SC.tick({ now: plus(MON, 70) }); await drain(plus(MON, 70), ctx); assert.equal(wp.posts.size, 0, 'an unapproved draft is never sent by the bot');
  await A.setStatus(a.id, 'ready');                                                                      // the person approves
  await SC.saveSchedule('content_publishing', { nextRunAt: null }); await SC.tick({ now: plus(MON, 140) }); await drain(plus(MON, 140), ctx); await drain(plus(MON, 145), ctx);
  assert.equal(wp.posts.size, 1); assert.equal([...wp.posts.values()][0].status, 'draft', '"Yarı otomatik" sends drafts: the last word is in WordPress');
});
