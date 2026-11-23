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
const SI = require('../../src/content/services/sites');
const PB = require('../../src/content/services/publishing');
const SC = require('../../src/content/services/scheduler');
const W = require('../../src/content/services/writer');
const R = require('../../src/content/services/runs');
const IM = require('../../src/content/services/images');
const AU = require('../../src/content/services/automation');
const stock = require('../../src/content/services/stockPhotos');
const { FetchError } = require('../../src/content/lib/safeFetch');

/**
 * FREE cover photos (Pixabay): the request in the documented shape, the 24-hour cache, every refusal in words, the tag filter, "never the same photo twice", the search words of the
 * writer, a person's own choice, the stored copy with its credit, the upload to WordPress and the Otomasyon Modu option. Pixabay and the models are fakes; the database is real.
 */
const opts = { skip: H.skip };
const NOW = new Date('2026-11-23T10:00:00Z');
const KEY = '12345678-abcdef0123456789abcdef012';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF pixabay photo bytes '.repeat(80)), Buffer.from([0xff, 0xd9])]);
let wp;
test.before(async () => { if (!H.skip) { await H.freshDatabase(); wp = await startFakeWp(); } });
test.beforeEach(async () => { if (!H.skip) { await H.clean(); await wp.close(); wp = await startFakeWp(); stock.clearCache(); stock.useDownload(null); } });
test.after(async () => { if (!H.skip) { stock.useDownload(null); await wp.close(); await H.close(); } });

const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hit = (id, tags, o = {}) => ({ id, pageURL: `https://pixabay.com/photos/x-${id}/`, type: 'photo', tags, previewURL: `https://cdn.pixabay.com/photo/p${id}_150.jpg`, webformatURL: `https://pixabay.com/get/w${id}_640.jpg`, largeImageURL: `https://pixabay.com/get/l${id}_1280.jpg`,
  imageWidth: 4000, imageHeight: 2667, user: 'Jane Doe', user_id: 77, ...o });
const HITS = () => [hit(102, 'office, people, man, laptop'), hit(103, 'laptop, logo, brand'), hit(104, 'robot, ai generated, future'), hit(105, 'laptop, desk', { imageWidth: 800, imageHeight: 533 }), hit(107, 'laptop', { largeImageURL: 'https://evil.example/x.jpg' }), hit(101, 'laptop, computer, desk, technology'), hit(106, 'keyboard, technology, office')];

/** Pixabay's search in the documented shape: GET https://pixabay.com/api/?key=…&q=… (or &id=…) -> { total, totalHits, hits[] }; remembers every call */
function fakePixabay() {
  const calls = []; const st = { hits: HITS(), byQuery: {}, fail: null, throwNetwork: false };
  const fetchImpl = async (url) => {
    const u = new URL(String(url)); if (`${u.origin}${u.pathname}` !== 'https://pixabay.com/api/') throw new Error(`unexpected url ${url}`);
    if (st.throwNetwork) throw new Error('socket hang up');
    calls.push({ key: u.searchParams.get('key'), q: u.searchParams.get('q'), id: u.searchParams.get('id'), params: Object.fromEntries(u.searchParams) });
    if (st.fail) return json(st.fail.status, st.fail.body);
    const id = u.searchParams.get('id'); const q = u.searchParams.get('q'); const hits = id ? st.hits.filter((h) => String(h.id) === id) : (st.byQuery[q] || st.hits);
    return json(200, { total: hits.length, totalHits: hits.length, hits });
  };
  return { fetchImpl, calls, st };
}
const asked = []; const downloads = () => asked;
const useFakeDownload = (bytes = JPEG) => { asked.length = 0; stock.useDownload(async (url) => { asked.push(url); return { buffer: bytes, contentType: 'image/jpeg', url }; }); };
const setup = async () => (await P.seedDefault()).projectId;
const connectPx = async () => PR.save('pixabay', { secret: KEY });
const connectAi = async () => PR.save('openai', { secret: 'sk-test-key-0123456789abcdef', extra: { model: 'gpt-test', imageModel: 'gpt-image-2' } });
let seq = 0;
async function article(pid, o = {}) {
  seq++; const cats = await P.listCategories(pid);
  return A.create({ projectId: pid, h1: o.h1 || `Router setup guide ${seq}`, seoTitle: `Router setup guide ${seq}: what to know`, metaDescription: 'A practical walk-through of setting up a home router, with the settings that matter most.', focusKeyword: o.focus || `router setup ${seq}`,
    categoryId: cats[0].id, contentHtml: `<h2>Start</h2><p>${'Plain, useful sentence about home networking basics for curious readers. '.repeat(40)}</p>`, articleType: 'evergreen_guide', tags: o.tags || [] });
}
const turnOn = async (pid, extra = {}) => S.set('images', { ...(await S.get('images', pid)).value, auto: true, ...extra }, { scope: 'global' });

test('the Pixabay card: the key is checked against the documented pattern, the test is one free search, every answer is a sentence and the key is never in it', opts, async () => {
  await assert.rejects(PR.save('pixabay', { secret: 'bad key!' }), /geçersiz görünüyor|beklenen biçimde değil/);
  await connectPx(); const px = fakePixabay(); let seen;
  const ok = await PR.test('pixabay', { fetchImpl: async (url, o) => { seen = String(url); return px.fetchImpl(url, o); } });
  assert.equal(ok.ok, true); assert.match(ok.message, /Pixabay bağlantısı çalışıyor/); assert.ok(seen.startsWith('https://pixabay.com/api/?key=') && /per_page=3/.test(seen));
  const rejected = await PR.test('pixabay', { fetchImpl: async () => json(400, '[ERROR 400] Invalid or missing API key') }); assert.deepEqual([rejected.ok, /anahtarı reddedildi/.test(rejected.message), rejected.message.includes(KEY)], [false, true, false]);
  assert.match((await PR.test('pixabay', { fetchImpl: async () => json(429, 'API rate limit exceeded') })).message, /hız sınırına takıldı/);
  assert.match((await PR.test('pixabay', { fetchImpl: async () => { throw new Error('boom'); } })).message, /ulaşılamadı/);
  assert.equal((await PR.list()).find((p) => p.key === 'pixabay').paid, false, 'a free service: no budget, no "ücretli" label');
});

test('search: the documented request, one usage row of KNOWN cost 0, a 24-hour cache, and every failure in words with the key scrubbed', opts, async () => {
  const pid = await setup(); await connectPx(); const px = fakePixabay();
  await assert.rejects(stock.search({ query: 'a' }), /en az 2 harf/); const lonely = await stock.search({ query: '  laptop  desk!! ', projectId: pid, fetchImpl: px.fetchImpl, now: NOW });
  assert.deepEqual([px.calls.length, px.calls[0].key, px.calls[0].params.q, px.calls[0].params.image_type, px.calls[0].params.orientation, px.calls[0].params.safesearch, px.calls[0].params.min_width], [1, KEY, 'laptop desk', 'photo', 'horizontal', 'true', '1200'], 'keyword, photos only, landscape, safe, large enough');
  assert.equal(lonely.candidates.length, 7); assert.equal(lonely.cached, false);
  const u = (await H.db().query("SELECT provider, operation, result, cost_micros, requests FROM api_usage WHERE provider = 'pixabay'")).rows; assert.deepEqual(u.map((r) => [r.operation, r.result, Number(r.cost_micros), r.requests]), [['image_search', 'ok', 0, 1]], 'free = a known 0, not "unknown"');
  const again = await stock.search({ query: 'laptop desk', projectId: pid, fetchImpl: px.fetchImpl, now: new Date(NOW.getTime() + 23 * 3600000) }); assert.deepEqual([again.cached, px.calls.length], [true, 1], 'the same search within a day is answered from memory (Pixabay requires caching for 24 hours)');
  await stock.search({ query: 'laptop desk', projectId: pid, fetchImpl: px.fetchImpl, now: new Date(NOW.getTime() + 25 * 3600000) }); assert.equal(px.calls.length, 2, 'after a day it is asked again');
  px.st.fail = { status: 429, body: 'API rate limit exceeded' }; await assert.rejects(stock.search({ query: 'router', projectId: pid, fetchImpl: px.fetchImpl, now: NOW }), (e) => /dakikada 100 istek/.test(e.message));
  px.st.fail = { status: 400, body: '[ERROR 400] Invalid or missing API key' }; await assert.rejects(stock.search({ query: 'modem', projectId: pid, fetchImpl: px.fetchImpl, now: NOW }), (e) => e.status === 409 && /anahtarı reddedildi/.test(e.message));
  px.st.fail = { status: 500, body: `oops ${KEY}` }; await assert.rejects(stock.search({ query: 'cable', projectId: pid, fetchImpl: px.fetchImpl, now: NOW }), (e) => !e.message.includes(KEY) && /beklenmedik cevap/.test(e.message));
  px.st.fail = null; px.st.throwNetwork = true; await assert.rejects(stock.search({ query: 'cloud', projectId: pid, fetchImpl: px.fetchImpl, now: NOW }), /ulaşılamadı/);
  assert.equal((await H.db().query("SELECT count(*)::int n FROM api_usage WHERE provider = 'pixabay' AND result = 'error'")).rows[0].n, 4, 'every failed call is a usage row too');
  px.st.throwNetwork = false; const byId = await stock.search({ id: '106', fetchImpl: px.fetchImpl, now: NOW }); assert.deepEqual([px.calls.at(-1).id, byId.candidates.map((c) => c.id)], ['106', ['106']], 'one photo by its id');
});

test('the tag filter: a photo whose tags name a person, a logo/brand or "ai generated", a small file or an address outside Pixabay is never chosen automatically - and says why', opts, async () => {
  await connectPx(); const px = fakePixabay(); const out = await stock.search({ query: 'laptop', fetchImpl: px.fetchImpl, now: NOW });
  const by = Object.fromEntries(out.candidates.map((c) => [c.id, c.problem]));
  assert.equal(by['101'], null); assert.equal(by['106'], null); assert.match(by['102'], /kişi/); assert.match(by['103'], /logo, marka/); assert.match(by['104'], /yapay zekâ/); assert.match(by['105'], /küçük \(800 px\)/); assert.match(by['107'], /Pixabay’a ait değil/);
  const c = out.candidates.find((x) => x.id === '101'); assert.deepEqual([c.savedWidth, c.savedHeight, c.user, c.userId], [1280, 853, 'Jane Doe', '77'], 'the stored size is the service\'s documented 1280 px long side');
  assert.equal(stock.altFor(c), 'Photo of laptop, computer, desk', 'the alt text says what the first tags name'); assert.equal(stock.altFor({ ...c, kind: 'illustration', tags: '' }), 'Illustration');
});

test('which service: "auto" prefers the FREE photo when its key exists, otherwise OpenAI; an explicit choice never falls back to the other; nothing falls back to a paid service on failure', opts, async () => {
  const pid = await setup(); const src = async () => (await IM.resolveSource(pid)).source;
  assert.equal(await src(), null); await connectAi(); assert.equal(await src(), 'openai'); await connectPx(); assert.equal(await src(), 'stock', 'both keys: the free one');
  await S.set('images', { ...(await S.get('images', pid)).value, source: 'openai' }, { scope: 'global' }); assert.equal(await src(), 'openai'); await S.set('images', { ...(await S.get('images', pid)).value, source: 'stock' }, { scope: 'global' }); assert.equal(await src(), 'stock');
  await PR.save('pixabay', { clearSecret: true }); assert.equal(await src(), null, '"only free" without a Pixabay key: nothing - OpenAI is NOT used instead'); await assert.rejects(S.set('images', { ...(await S.get('images', pid)).value, source: 'dall-e' }, { scope: 'global' }), /Görsel kaynağı/);
});

test('automatic cover: the first usable photo is downloaded (Pixabay\'s host only), stored with its credit, cost 0; the next article gets ANOTHER photo; no usable photo = a told failure, never a throw', opts, async () => {
  const pid = await setup(); await connectPx(); const px = fakePixabay(); useFakeDownload(); const a = await article(pid, { focus: 'router setup' }); const b = await article(pid, { focus: 'router setup' });
  assert.deepEqual(await IM.autoForArticle(a.id, pid, { query: 'laptop desk' }, { fetchImpl: px.fetchImpl, now: NOW }), { status: 'off' }, 'images.auto is off by default'); assert.equal(px.calls.length, 0);
  await turnOn(pid);
  const ok = await IM.autoForArticle(a.id, pid, { query: 'laptop desk' }, { fetchImpl: px.fetchImpl, now: NOW }); assert.deepEqual([ok.status, ok.source, ok.billed, ok.costUsd], ['ok', 'stock', false, 0]);
  const m = await IM.forArticle(a.id); assert.deepEqual([m.provider, m.sourceId, m.creditName, m.creditUrl, m.sourceUrl, m.alt, m.prompt, m.costUsd, m.mime, m.width, m.height], ['pixabay', '101', 'Jane Doe', 'https://pixabay.com/users/Jane%20Doe-77/', 'https://pixabay.com/photos/x-101/', 'Photo of laptop, computer, desk', 'laptop desk', 0, 'image/jpeg', 1280, 853]);
  assert.deepEqual(downloads(), ['https://pixabay.com/get/l101_1280.jpg'], 'only the chosen file, only from pixabay.com'); assert.deepEqual((await IM.file(a.id)).buffer, JPEG);
  const second = await IM.autoForArticle(b.id, pid, { query: 'laptop desk' }, { fetchImpl: px.fetchImpl, now: NOW }); assert.equal(second.status, 'ok'); assert.equal((await IM.forArticle(b.id)).sourceId, '106', 'the same photo is never the cover of two articles of a project');
  const c = await article(pid, { focus: 'router setup' }); const none = await IM.autoForArticle(c.id, pid, { query: 'laptop desk' }, { fetchImpl: px.fetchImpl, now: NOW });
  assert.equal(none.status, 'failed'); assert.match(none.error, /Uygun ücretsiz fotoğraf bulunamadı \(aranan: laptop desk · router setup · AI Digital Technology Updates\)/); assert.equal(await IM.forArticle(c.id), null);
  px.st.fail = { status: 429, body: 'x' }; const d = await article(pid); assert.match((await IM.autoForArticle(d.id, pid, {}, { fetchImpl: px.fetchImpl, now: new Date(NOW.getTime() + 2 * 86400000) })).error, /dakikada 100 istek/);
  assert.equal((await H.db().query("SELECT count(*)::int n FROM article_images")).rows[0].n, 2); assert.equal((await H.db().query("SELECT count(*)::int n FROM api_usage WHERE provider = 'openai'")).rows[0].n, 0, 'nothing was drawn or paid for');
});

test('the search words: the writer\'s own suggestion first, then the focus keyword, the first tags and the niche - at most three tries, each one a cached request', opts, async () => {
  const pid = await setup(); await connectPx(); const px = fakePixabay(); useFakeDownload(); await turnOn(pid);
  px.st.byQuery = { 'cable management': [], 'router firmware update': [], 'router wifi': [] }; const a = await article(pid, { focus: 'router firmware update', tags: ['router', 'wifi', 'security'] });
  const ok = await IM.autoForArticle(a.id, pid, { query: 'cable management' }, { fetchImpl: px.fetchImpl, now: NOW }); assert.equal(ok.status, 'failed'); assert.deepEqual(px.calls.map((c) => c.q), ['cable management', 'router firmware update', 'router wifi'], 'the writer\'s words, the focus keyword, the first two tags');
  const b = await article(pid, { focus: 'wifi extender' }); px.calls.length = 0; const ok2 = await IM.autoForArticle(b.id, pid, { query: 'cable management' }, { fetchImpl: px.fetchImpl, now: NOW }); assert.equal(ok2.status, 'ok'); assert.deepEqual(px.calls.map((c) => c.q), ['wifi extender'], 'the writer\'s words found nothing a minute ago: that answer comes from the 24-hour cache (no request), the focus keyword is the one asked');
});

test('writer: the prompt asks for the search words (w4), and the cover comes from Pixabay at no cost; the picture step is part of the run', opts, async () => {
  const pid = await setup(); await PR.save('anthropic', { secret: 'sk-ant-test-key-0123456789' }); await connectPx(); useFakeDownload(); await turnOn(pid);
  const m = fakeModels(); const px = fakePixabay(); const { sectionHtml } = require('./fakeModels');
  m.st.override.write = (user) => { const kw = (/FOCUS KEYWORD \(use exactly this phrase\): (.+)/.exec(user) || [])[1]; return { seoTitle: `${kw}: what changes`, h1: `${kw}: what you need to know`, slug: kw.replace(/ /g, '-'), metaDescription: `What is changing with ${kw}, what is known and what to do next about the new price.`, focusKeyword: kw, secondaryKeywords: [], excerpt: 'x', articleType: 'latest_update', contentHtml: sectionHtml(kw), faq: [], tags: [],
    image: { prompt: 'A scene', alt: 'An alt', query: 'laptop on desk' } }; };
  const fetchImpl = (url, o) => (/^https:\/\/pixabay\.com\/api\//.test(String(url)) ? px.fetchImpl(url, o) : m.fetchImpl(url, o));
  await N.createSource(pid, { name: 'Outlet A', kind: 'rss', url: 'https://a.example/feed', reliability: 80 }); await N.createSource(pid, { name: 'Outlet B', kind: 'rss', url: 'https://b.example/feed', reliability: 70 });
  const rss = (t, l, d) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>${t}</title><link>${l}</link><pubDate>${d}</pubDate></item></channel></rss>`;
  const feeds = { 'https://a.example/feed': rss('OpenAI raises ChatGPT Plus price for subscribers', 'https://a.example/1', 'Fri, 21 Nov 2026 10:00:00 GMT'), 'https://b.example/feed': rss('ChatGPT Plus price increase announced by OpenAI', 'https://b.example/1', 'Fri, 21 Nov 2026 11:00:00 GMT') };
  await N.runDiscovery(pid, { fetchImpl: async (url) => { if (!feeds[url]) throw new FetchError('http', 'HTTP 404', { status: 404 }); return { status: 200, body: feeds[url], url }; }, now: NOW, gapMs: 0 });
  await O.refresh(pid, { now: NOW }); await H.db().query("UPDATE content_opportunities SET eligible = true, ineligible_reason = ''"); const o = (await O.list(pid)).items[0];
  const out = await W.start(o.id, { fetchImpl, fetcher: async (url) => { if (url === 'https://b.example/1') throw new FetchError('http', 'HTTP 403', { status: 403 }); return { body: PAGE() }; }, now: NOW, background: false });
  const run = await R.get(out.run.id); const row = (await H.db().query('SELECT article_id FROM content_opportunities WHERE id = $1', [o.id])).rows[0];
  assert.match(m.byRole('write')[0].system, /"image":\{"prompt":"","alt":"","query":""\}/); assert.match(m.byRole('write')[0].system, /"image\.query" is 2-4 plain English words/);
  assert.deepEqual([run.stats.image, run.stats.step, px.calls[0].q], ['ok', 'done', 'laptop on desk']); const cover = await IM.forArticle(row.article_id); assert.deepEqual([cover.provider, cover.costUsd, cover.sourceId], ['pixabay', 0, '101']);
  assert.equal((await A.get(row.article_id)).generation.promptVersion, 'w4');
});

test('a person\'s own choice: a search shows candidates (nothing saved, flagged ones marked), choosing one looks it up again BY ID, downloads it and replaces the cover; a wrong address or a non-image file is refused', opts, async () => {
  const pid = await setup(); await connectPx(); const px = fakePixabay(); useFakeDownload(); const a = await article(pid);
  const found = await IM.searchForArticle(a.id, { query: 'laptop', fetchImpl: px.fetchImpl, now: NOW }); assert.equal(found.candidates.length, 7); assert.equal(await IM.forArticle(a.id), null, 'a search saves nothing');
  const m = await IM.stockForArticle(a.id, { photoId: '102', query: 'laptop', fetchImpl: px.fetchImpl, now: NOW }); assert.deepEqual([m.sourceId, m.provider, m.prompt], ['102', 'pixabay', 'laptop'], 'a person may take a photo the automatic filter would skip: it is their decision');
  assert.equal(px.calls.at(-1).id, '102', 'the photo is looked up again by its id: only what the service says about it is saved');
  const replaced = await IM.stockForArticle(a.id, { photoId: '106', fetchImpl: px.fetchImpl, now: NOW }); assert.equal((await H.db().query('SELECT count(*)::int n FROM article_images WHERE article_id = $1', [a.id])).rows[0].n, 1); assert.notEqual(replaced.id, m.id); assert.equal(replaced.prompt, 'fotoğraf 106');
  await assert.rejects(IM.stockForArticle(a.id, { photoId: '107', fetchImpl: px.fetchImpl, now: NOW }), /Pixabay’a ait değil/); assert.equal(downloads().every((u) => /^https:\/\/pixabay\.com\//.test(u)), true, 'a foreign address is never downloaded');
  await assert.rejects(IM.stockForArticle(a.id, { photoId: '999', fetchImpl: px.fetchImpl, now: NOW }), (e) => e.status === 404 && /bulunamadı/.test(e.message));
  useFakeDownload(Buffer.from('<html>not a picture at all, just text pretending to be a file</html>')); await assert.rejects(IM.stockForArticle(a.id, { photoId: '101', fetchImpl: px.fetchImpl, now: NOW }), /bir görsel dosyası değil/); assert.equal((await IM.forArticle(a.id)).sourceId, '106', 'the earlier cover is untouched');
});

test('WordPress: a stock cover is uploaded as the featured image with its alt text, exactly like a drawn one', opts, async () => {
  const pid = await setup(); await connectPx(); const px = fakePixabay(); useFakeDownload(); const a = await article(pid); await H.db().query("UPDATE articles SET status = 'needs_review', fact_checked_at = now(), adsense_risk = 'low' WHERE id = $1", [a.id]);
  await IM.stockForArticle(a.id, { photoId: '101', fetchImpl: px.fetchImpl, now: NOW });
  const site = await SI.create(pid, { name: 'Blog', apiUrl: wp.url, username: 'editor', password: 'abcd efgh ijkl mnop' }); await PB.submit(a.id, site.id, { mode: 'draft' }); for (let i = 0; i < 20; i++) if (!(await SC.workOnce({ ctx: {} }))) break;
  assert.equal(wp.media.length, 1); assert.deepEqual([wp.media[0].alt, wp.media[0].mime], ['Photo of laptop, computer, desk', 'image/jpeg']); assert.equal([...wp.posts.values()][0].featured_media, wp.media[0].id);
});

test('Otomasyon Modu: with a Pixabay key the cover option is ready and FREE; without any key it says which key is missing; switching it on says which service will be used', opts, async () => {
  const pid = await setup(); const opt = async () => (await AU.overview(pid)).options.find((o) => o.key === 'images');
  const none = await opt(); assert.deepEqual([none.ready, none.spends, none.label], [false, false, 'Makaleye kapak görseli ekle']); assert.match(none.missing[0].text, /Pixabay anahtarı .* ya da OpenAI anahtarı/);
  await connectAi(); const ai = await opt(); assert.deepEqual([ai.ready, ai.spends], [true, true], 'only OpenAI: it spends money and the option says so');
  await connectPx(); const free = await opt(); assert.deepEqual([free.ready, free.spends], [true, false], 'a Pixabay key: free');
  const r = await AU.apply({ projectId: pid, mode: 'custom', options: { images: true } }); assert.equal((await opt()).on, true); assert.ok(r.applied.changes.some((n) => /Pixabay’dan ücretsiz bir fotoğraf/.test(n)), JSON.stringify(r.applied.changes));
});
