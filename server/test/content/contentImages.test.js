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
const S = require('../../src/content/services/settings');
const A = require('../../src/content/services/articles');
const R = require('../../src/content/services/runs');
const SI = require('../../src/content/services/sites');
const PB = require('../../src/content/services/publishing');
const SC = require('../../src/content/services/scheduler');
const W = require('../../src/content/services/writer');
const IM = require('../../src/content/services/images');
const AA = require('../../src/content/services/autoApprove');
const { FetchError } = require('../../src/content/lib/safeFetch');
const MODELS = require('../../src/content/lib/imageModels');

/**
 * Cover pictures: the request to OpenAI in the documented shape, the model that is picked, every refusal in words, the budget guard, one picture per article, the writer's
 * scene and alt text, the gate in front of automatic approval and the upload to WordPress. OpenAI and WordPress are fakes; the database and the queue are real.
 */
const opts = { skip: H.skip };
const NOW = new Date('2026-11-23T10:00:00Z');
const KEY = 'sk-test-key-0123456789abcdef';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF fake picture bytes '.repeat(80)), Buffer.from([0xff, 0xd9])]);
let wp;
test.before(async () => { if (!H.skip) { await H.freshDatabase(); wp = await startFakeWp(); } });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await wp.close(); wp = await startFakeWp(); } });
test.after(async () => { if (!H.skip) { await wp.close(); await H.close(); } });

/** OpenAI's image API in the documented shape: GET /v1/models and POST /v1/images/generations (b64_json + usage); remembers every call */
function fakeImages() {
  const calls = []; const st = { models: ['gpt-4o', 'gpt-image-1', 'gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'gpt-image-1-mini', 'chatgpt-image-latest', 'dall-e-3'], fail: null, bytes: JPEG, throwNetwork: false, noData: false };
  const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, o = {}) => {
    const u = String(url);
    if (u === 'https://api.openai.com/v1/models') { calls.push({ kind: 'models' }); return json(200, { object: 'list', data: st.models.map((id) => ({ id, object: 'model' })) }); }
    if (u === 'https://api.openai.com/v1/images/generations') {
      if (st.throwNetwork) { const e = new Error('socket hang up'); throw e; }
      const body = JSON.parse(o.body); calls.push({ kind: 'image', body, auth: o.headers.Authorization });
      if (st.fail) return json(st.fail.status, st.fail.body);
      if (st.noData) return json(200, { created: 1, data: [], size: '1536x1024' });
      return json(200, { created: 1, size: body.size, quality: body.quality, output_format: 'jpeg', data: [{ b64_json: st.bytes.toString('base64') }], usage: { input_tokens: 120, output_tokens: 1500, total_tokens: 1620, input_tokens_details: { text_tokens: 120, image_tokens: 0 } } });
    }
    throw new Error(`unexpected url ${u}`);
  };
  return { fetchImpl, calls, st, images: () => calls.filter((c) => c.kind === 'image') };
}
/** one fetch for a test that runs the whole writer: chat models go to the model fake, the picture calls to the image fake */
const both = (m, im) => (url, o) => (/\/v1\/images\/|\/v1\/models$/.test(String(url)) ? im.fetchImpl(url, o) : m.fetchImpl(url, o));

const setup = async () => (await P.seedDefault()).projectId;
const connect = async (extra = {}) => PR.save('openai', { secret: KEY, extra: { model: 'gpt-test', ...extra } });
let seq = 0;
async function article(pid, o = {}) {
  seq++; const cats = await P.listCategories(pid);
  const a = await A.create({ projectId: pid, h1: o.h1 || `Router setup guide ${seq}`, seoTitle: `Router setup guide ${seq}: what to know`, metaDescription: 'A practical walk-through of setting up a home router, with the settings that matter most.', focusKeyword: `router setup ${seq}`,
    categoryId: cats[0].id, contentHtml: `<h2>Start</h2><p>${'Plain, useful sentence about home networking basics for curious readers. '.repeat(40)}</p>`, articleType: 'evergreen_guide' });
  return a;
}
const usageRows = async () => (await H.db().query("SELECT result, cost_micros, endpoint, operation FROM api_usage WHERE operation LIKE 'image%' ORDER BY id")).rows;

test('image models: the plain names are listed first, the newest plain name is the default (never a dated snapshot or an alias), nothing is hard-coded', opts, async () => {
  const ids = ['gpt-4o', 'gpt-image-1', 'gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'gpt-image-1-mini', 'chatgpt-image-latest', 'dall-e-3'];
  assert.equal(MODELS.pickImageModel(ids), 'gpt-image-2.5-sunburst'); assert.equal(MODELS.pickImageModel(['gpt-image-1', 'gpt-image-1-mini']), 'gpt-image-1', 'a "mini" only wins when it is the only one of its version'); assert.equal(MODELS.pickImageModel(['gpt-4o', 'dall-e-3']), null, 'no gpt-image name: no guess');
  const list = MODELS.imageModels(ids); assert.equal(list[0].id !== 'gpt-4o', true); assert.ok(list.find((m) => m.id === 'gpt-image-2.5-sunburst-2026-09-08').label.includes('sabit sürüm')); assert.ok(!list.some((m) => m.id === 'gpt-4o'));
  assert.ok(list.findIndex((m) => m.id === 'gpt-image-2.5-sunburst') < list.findIndex((m) => m.id === 'gpt-image-2.5-sunburst-2026-09-08'), 'snapshots come after the plain names');
});

test('generate: the documented request (model, 1536x1024, quality, jpeg, one picture), the key only in the header, bytes recognised by their first bytes, one usage row, cost unknown unless the owner typed a price', opts, async () => {
  const pid = await setup(); await connect(); const im = fakeImages();
  const a = await article(pid);
  const r = await IM.generateForArticle(a.id, { visual: 'A glowing price tag floating over an open laptop', alt: 'A glowing price tag above an open laptop', fetchImpl: im.fetchImpl, now: NOW });
  const call = im.images()[0]; assert.equal(call.body.model, 'gpt-image-2.5-sunburst', 'no model chosen: the newest plain gpt-image name of the account'); assert.deepEqual([call.body.size, call.body.quality, call.body.output_format, call.body.n], ['1536x1024', 'medium', 'jpeg', 1]);
  assert.equal(call.auth, `Bearer ${KEY}`); assert.ok(!JSON.stringify(call.body).includes(KEY));
  assert.match(call.body.prompt, /^A glowing price tag floating over an open laptop\nStyle: Clean modern editorial illustration/); assert.match(call.body.prompt, /Absolutely no text, letters, numbers, captions or watermarks/); assert.match(call.body.prompt, /No logos or brand marks.*no real people/s); assert.ok(call.body.prompt.includes(a.h1));
  assert.deepEqual([r.mime, r.width, r.height, r.byteSize, r.alt, r.model, r.costUsd, r.quality], ['image/jpeg', 1536, 1024, JPEG.length, 'A glowing price tag above an open laptop', 'gpt-image-2.5-sunburst', null, 'medium']);
  const f = await IM.file(a.id); assert.ok(f.buffer.equals(JPEG));
  assert.deepEqual((await usageRows()).map((u) => [u.result, u.cost_micros, u.endpoint]), [['ok', null, 'gpt-image-2.5-sunburst']], 'every call is a usage row; the cost is unknown (NULL), not 0');
  // a model the owner chose wins (no extra model list call); a typed price becomes the cost
  await connect({ imageModel: 'gpt-image-2', imagePriceUsd: '0.05' }); const im2 = fakeImages(); const b = await article(pid);
  const r2 = await IM.generateForArticle(b.id, { fetchImpl: im2.fetchImpl, now: NOW, quality: 'high' }); assert.equal(im2.calls.filter((c) => c.kind === 'models').length, 0); assert.deepEqual([im2.images()[0].body.model, im2.images()[0].body.quality, r2.costUsd, r2.alt], ['gpt-image-2', 'high', 0.05, b.h1]);
  assert.equal((await usageRows()).at(-1).cost_micros, '50000', 'cost = the price the owner typed for one picture'); assert.match(im2.images()[0].body.prompt, /^A concrete visual metaphor for: /, 'no scene from the writer: a plain one from the title');
  // one picture per article: a new one replaces the old one (new id)
  const again = await IM.generateForArticle(b.id, { fetchImpl: im2.fetchImpl, now: NOW }); assert.notEqual(again.id, r2.id); assert.equal((await H.db().query('SELECT count(*)::int n FROM article_images WHERE article_id = $1', [b.id])).rows[0].n, 1);
  assert.equal((await IM.setAlt(b.id, '  A router on a desk  ')).alt, 'A router on a desk'); await assert.rejects(IM.setAlt(b.id, ''), /Alt metin/); assert.equal(await IM.remove(b.id), true); assert.equal(await IM.forArticle(b.id), null); await assert.rejects(IM.setAlt(b.id, 'x'), /görseli yok/);
});

test('every refusal of OpenAI is told in words, with "no other picture can work" only where that is true; each is a usage row and the key never appears', opts, async () => {
  const pid = await setup(); await connect({ imageModel: 'gpt-image-2' }); const a = await article(pid); const im = fakeImages();
  const cases = [
    [{ status: 403, body: { error: { message: 'Your organization must be verified to use the model `gpt-image-2`. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization.', type: 'invalid_request_error', code: null } } }, 'verification', true, /kuruluş doğrulaması/],
    [{ status: 400, body: { error: { message: 'Your request was rejected by the safety system.', type: 'image_generation_user_error', code: 'moderation_blocked' } } }, 'refused', undefined, /güvenlik filtresiyle reddetti/],
    [{ status: 401, body: { error: { message: `Incorrect API key provided: ${KEY}`, type: 'invalid_request_error', code: 'invalid_api_key' } } }, 'auth', true, /reddedildi/],
    [{ status: 404, body: { error: { message: 'The model `gpt-image-1` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } } }, 'model', true, /kapatılmış.*listeden/s],
    [{ status: 429, body: { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } } }, 'funds', true, /yetersiz/],
    [{ status: 429, body: { error: { message: 'Rate limit reached for images per minute', type: 'requests', code: 'rate_limit_exceeded' } } }, 'rate_limit', undefined, /istek sınırına/],
    [{ status: 500, body: { error: { message: 'The server had an error' } } }, 'overloaded', undefined, /yoğun/],
  ];
  for (const [fail, code, fatal, re] of cases) {
    im.st.fail = fail; const err = await IM.generateForArticle(a.id, { fetchImpl: im.fetchImpl, now: NOW }).then(() => null, (e) => e);
    assert.ok(err, JSON.stringify(fail)); assert.equal(err.code, code, err.message); assert.equal(!!err.fatal, !!fatal, `${code}: fatal`); assert.match(err.message, re); assert.ok(!err.message.includes(KEY), 'the key never appears');
  }
  assert.equal((await usageRows()).filter((u) => u.result === 'error').length, cases.length); assert.equal(await IM.forArticle(a.id), null, 'a failed call stores nothing');
  im.st.fail = null; im.st.noData = true; await assert.rejects(IM.generateForArticle(a.id, { fetchImpl: im.fetchImpl, now: NOW }), (e) => e.code === 'empty' && e.maybeBilled === true);
  im.st.noData = false; im.st.bytes = Buffer.from('this is not a picture at all, just words'); await assert.rejects(IM.generateForArticle(a.id, { fetchImpl: im.fetchImpl, now: NOW }), (e) => e.code === 'bad_output' && /görsel dosyası değil/.test(e.message));
  im.st.bytes = JPEG; im.st.throwNetwork = true; await assert.rejects(IM.generateForArticle(a.id, { fetchImpl: im.fetchImpl, now: NOW }), (e) => e.code === 'network' && e.maybeBilled === true);
  // no model chosen and the account offers none: no guess
  await connect({ imageModel: '' }); const none = fakeImages(); none.st.models = ['gpt-4o']; await assert.rejects(IM.generateForArticle(a.id, { fetchImpl: none.fetchImpl, now: NOW }), (e) => e.status === 409 && /görsel modeli görünmüyor/.test(e.message));
});

test('the budget guard runs BEFORE the call: a full budget means no request at all', opts, async () => {
  const pid = await setup(); await connect({ imageModel: 'gpt-image-2', imagePriceUsd: '0.5' }); const a = await article(pid); const im = fakeImages();
  await S.set('budget', { dailyTotalUsd: 0.4, monthlyTotalUsd: null }, { scope: 'global' });
  await assert.rejects(IM.generateForArticle(a.id, { fetchImpl: im.fetchImpl, now: NOW }), (e) => e.code === 'budget' && /bütçesi doldu/.test(e.message)); assert.equal(im.calls.length, 0);
});

test('the automatic step: off unless switched on, never throws, says what happened', opts, async () => {
  const pid = await setup(); const a = await article(pid); const im = fakeImages();
  assert.deepEqual(await IM.autoForArticle(a.id, pid, {}, { fetchImpl: im.fetchImpl, now: NOW }), { status: 'off' }, 'images.auto is off by default'); await S.set('images', { ...(await S.get('images', pid)).value, auto: true }, { scope: 'global' });
  assert.deepEqual(await IM.autoForArticle(a.id, pid, {}, { fetchImpl: im.fetchImpl, now: NOW }), { status: 'off' }, 'on, but OpenAI is not connected: still nothing'); assert.equal(im.calls.length, 0);
  await connect({ imageModel: 'gpt-image-2' }); const ok = await IM.autoForArticle(a.id, pid, { prompt: 'A scene', alt: 'An alt' }, { fetchImpl: im.fetchImpl, now: NOW }); assert.equal(ok.status, 'ok'); assert.equal((await IM.forArticle(a.id)).alt, 'An alt');
  const b = await article(pid); im.st.fail = { status: 403, body: { error: { message: 'Your organization must be verified to use the model.' } } };
  const bad = await IM.autoForArticle(b.id, pid, {}, { fetchImpl: im.fetchImpl, now: NOW }); assert.equal(bad.status, 'failed'); assert.match(bad.error, /kuruluş doğrulaması/); assert.equal(await IM.forArticle(b.id), null);
});

const rssOf = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><pubDate>${d || 'Fri, 21 Nov 2026 10:00:00 GMT'}</pubDate></item>`).join('')}</channel></rss>`;
const feeds = (map) => async (url) => { if (!map[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: map[url], url }; };
const pageFetcher = async (url) => { if (url === 'https://b.example/1') throw new FetchError('http', 'HTTP 403', { status: 403 }); return { body: PAGE() }; };
async function idea(pid) {
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  await N.runDiscovery(pid, { fetchImpl: feeds({ 'https://a.example/feed': rssOf([['OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1']]), 'https://b.example/feed': rssOf([['ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1', 'Fri, 21 Nov 2026 11:00:00 GMT']]) }), now: NOW, gapMs: 0 });
  await O.refresh(pid, { now: NOW }); await H.db().query("UPDATE content_opportunities SET eligible = true, ineligible_reason = ''"); return (await O.list(pid)).items[0];
}
const pipeline = async (pid, m, im) => { const o = await idea(pid); const out = await W.start(o.id, { fetchImpl: both(m, im), fetcher: pageFetcher, now: NOW, background: false }); const row = (await H.db().query('SELECT article_id FROM content_opportunities WHERE id = $1', [o.id])).rows[0]; return { o, out, art: row.article_id ? await A.get(row.article_id) : null, run: await R.get(out.run.id) }; };
const withScene = (m) => { m.st.override.write = (user) => { const kw = (/FOCUS KEYWORD \(use exactly this phrase\): (.+)/.exec(user) || [])[1]; const { sectionHtml } = require('./fakeModels');
  return { seoTitle: `${kw}: what changes`, h1: `${kw}: what you need to know`, slug: kw.replace(/ /g, '-'), metaDescription: `What is changing with ${kw}, what is known and what to do next about the new price.`, focusKeyword: kw, secondaryKeywords: [], excerpt: 'x', articleType: 'latest_update', contentHtml: sectionHtml(kw), faq: [], tags: [],
    image: { prompt: 'A glowing price tag floating over an open laptop on a dark desk', alt: 'A glowing price tag floating above an open laptop' } }; }; };

test('writer: the picture is drawn right after the article is saved, from the writer\'s own scene and alt text, before any check or approval; a failed picture never fails the article', opts, async () => {
  const pid = await setup(); await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789' }); await connect({ imageModel: 'gpt-image-2' });
  await S.set('images', { ...(await S.get('images', pid)).value, auto: true }, { scope: 'global' });
  const m = fakeModels(); withScene(m); const im = fakeImages();
  const r = await pipeline(pid, m, im);
  assert.equal(r.run.stats.step, 'done'); assert.equal(r.run.stats.image, 'ok'); assert.ok(!r.run.stats.imageError); assert.match(m.byRole('write')[0].system, /"image":\{"prompt":"","alt":"","query":""\}/); assert.match(m.byRole('write')[0].system, /"image\.alt" is 8-16 words/);
  const cover = await IM.forArticle(r.art.id); assert.deepEqual([cover.alt, cover.model, cover.provider], ['A glowing price tag floating above an open laptop', 'gpt-image-2', 'openai']); assert.match(im.images()[0].body.prompt, /^A glowing price tag floating over an open laptop on a dark desk\nStyle:/);
  assert.equal(r.art.status, 'needs_review'); assert.deepEqual([r.run.stats.calls, r.run.stats.unknownCost], [4, 4], 'the picture is a call of its own (4 calls: write, fact check, review, picture); no prices were typed, so all four costs are unknown and counted as such, never as 0');
  assert.equal((await A.readiness(r.art.id)).problems.some((p) => p.code === 'no_image'), false);
  // the picture fails (OpenAI wants a verified organization): the article is there, checked, waiting - with the reason in the run
  await H.clean(); const pid2 = (await P.seedDefault()).projectId; await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789' }); await connect({ imageModel: 'gpt-image-2' }); await S.set('images', { ...(await S.get('images', pid2)).value, auto: true }, { scope: 'global' });
  const m2 = fakeModels(); const im2 = fakeImages(); im2.st.fail = { status: 403, body: { error: { message: 'Your organization must be verified to use the model `gpt-image-2`.' } } };
  const r2 = await pipeline(pid2, m2, im2);
  assert.equal(r2.art.status, 'needs_review'); assert.equal(r2.run.stats.image, 'failed'); assert.match(r2.run.stats.imageError, /kuruluş doğrulaması/); assert.equal(r2.run.stats.step, 'done'); assert.equal(await IM.forArticle(r2.art.id), null);
  assert.equal((await A.readiness(r2.art.id)).problems.find((p) => p.code === 'no_image').blocking, false, 'a missing picture is a hint, not a blocker, for a person');
});

test('automatic approval is held back while cover pictures are on and the picture is missing; a person can still approve; with the picture (or the rule off) it goes through', opts, async () => {
  const pid = await setup(); await connect({ imageModel: 'gpt-image-2' });
  await S.set('quality', { ...(await S.get('quality', pid)).value, manualApprovalNewArticles: false, minScore: 50 }, { scope: 'global' });
  const ready = async (a) => { await H.db().query("UPDATE articles SET status = 'needs_review', created_by = 'ai', fact_checked_at = now(), adsense_risk = 'low', quality_score = 90 WHERE id = $1", [a.id]); };
  const a = await article(pid); await ready(a); assert.equal((await AA.approveIfClean(a.id)).approved, true, 'pictures off: no extra gate');
  await S.set('images', { ...(await S.get('images', pid)).value, auto: true }, { scope: 'global' });
  const b = await article(pid); await ready(b); const held = await AA.approveIfClean(b.id); assert.deepEqual([held.approved, held.reason], [false, 'blocked']); assert.match(held.problems[0], /Kapak görseli yok/);
  assert.equal((await A.setStatus(b.id, 'ready')).status, 'ready', 'a person approves it anyway');
  const c = await article(pid); await ready(c); await IM.generateForArticle(c.id, { fetchImpl: fakeImages().fetchImpl, now: NOW }); assert.equal((await AA.approveIfClean(c.id)).approved, true);
  await S.set('images', { ...(await S.get('images', pid)).value, requireForAutoApprove: false }, { scope: 'global' }); const d = await article(pid); await ready(d); assert.equal((await AA.approveIfClean(d.id)).approved, true, 'the owner turned the rule off');
});

test('WordPress: the stored picture becomes the featured image with its alt text, is uploaded once (a second send reuses it), and a NEW picture is uploaded again', opts, async () => {
  const pid = await setup(); await connect({ imageModel: 'gpt-image-2' });
  const site = await SI.create(pid, { name: 'Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); assert.equal((await SI.test(site.id)).ok, true);
  const a = await article(pid); await H.db().query("UPDATE articles SET status = 'ready', fact_checked_at = now(), adsense_risk = 'low' WHERE id = $1", [a.id]);
  await IM.generateForArticle(a.id, { visual: 'A router on a desk', alt: 'A white router on a wooden desk', fetchImpl: fakeImages().fetchImpl, now: NOW });
  const drain = async () => { for (let i = 0; i < 20; i++) if (!(await SC.workOnce({ ctx: {} }))) return; };
  let pub = await PB.submit(a.id, site.id, { mode: 'draft' }); await drain();
  assert.equal(wp.media.length, 1); assert.deepEqual([wp.media[0].mime, wp.media[0].alt, /\.jpg$/.test(wp.media[0].filename), wp.media[0].bytes], ['image/jpeg', 'A white router on a wooden desk', true, JPEG.length]);
  const post = [...wp.posts.values()][0]; assert.equal(post.featured_media, wp.media[0].id);
  pub = await PB.get(pub.id); assert.ok(!pub.warnings.join(' ').includes('Kapak görseli aktarılamadı'), 'the picture went through without a warning');
  await A.update(a.id, { h1: `${a.h1} (edited)` }); await PB.submit(a.id, site.id, { mode: 'draft' }); await drain();
  assert.equal(wp.media.length, 1, 'the same picture is not uploaded twice');
  await IM.generateForArticle(a.id, { visual: 'Another scene', alt: 'A second picture', fetchImpl: fakeImages().fetchImpl, now: NOW }); await A.update(a.id, { h1: `${a.h1} (edited again)` }); await PB.submit(a.id, site.id, { mode: 'draft' }); await drain();
  assert.equal(wp.media.length, 2); assert.equal(wp.media[1].alt, 'A second picture'); assert.equal([...wp.posts.values()][0].featured_media, wp.media[1].id, 'the post points at the new picture');
});
