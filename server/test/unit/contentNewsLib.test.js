const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const T = require('../../src/content/lib/text');
const { parseFeed, parseGdelt, googleNewsUrl, gdeltUrl } = require('../../src/content/lib/feed');
const { fetchText, FetchError, isPrivateIp, checkUrl } = require('../../src/content/lib/safeFetch');
const R = require('../../src/content/services/relevance');
const P = require('../../src/content/services/projects');

const FX = path.join(__dirname, '../fixtures/content');
const fx = (n) => fs.readFileSync(path.join(FX, n), 'utf8');

test('text: same event across sources, different events apart, numbers and template headlines', () => {
  const S = T.signature;
  assert.equal(T.sameEvent(S('OpenAI unveils new reasoning model for ChatGPT subscribers'), S('ChatGPT gets a new reasoning model, OpenAI says')), true);
  assert.equal(T.sameEvent(S('Microsoft confirms Windows 11 update breaks printing'), S('Windows 11 update KB5034 breaks printing, Microsoft confirms')), true);
  assert.equal(T.sameEvent(S('OpenAI launches Sora app on Android'), S('OpenAI raises ChatGPT Plus price')), false, 'one subject, two events');
  assert.equal(T.sameEvent(S('Apple releases iOS 26.2 with new features'), S('Apple releases iOS 26.1 security update')), false, 'different version numbers');
  assert.equal(T.sameEvent(S('Chrome Dev for Android Update'), S('Chrome Dev for Desktop Update'), { sameSource: true }), false, 'a source repeating a template headline');
  assert.equal(T.sameEvent(S('Chrome Dev for Android Update'), S('Chrome Dev for Android Update'), { sameSource: true }), false, 'literally equal headlines of one source are different posts');
  assert.equal(T.sameEvent(S('A statement from LPM on artificial intelligence'), S('Technology + AI (artificial intelligence)')), false, 'generic shared words are not an event');
});

test('text: no real headline pair of nine different feeds is called the same event by mistake', () => {
  const all = [];
  for (const f of fs.readdirSync(FX).filter((x) => x.endsWith('.xml'))) for (const i of parseFeed(fx(f), 'https://x.test/').items) all.push({ f, sig: T.signature(i.title), t: i.title });
  assert.ok(all.length >= 70);
  const flagged = [];
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) if (T.sameEvent(all[a].sig, all[b].sig, { sameSource: all[a].f === all[b].f })) flagged.push([all[a].t, all[b].t]);
  assert.deepEqual(flagged, [], `unexpected same-event pairs: ${JSON.stringify(flagged)}`);
});

test('text: urls, publisher suffix, phrases and whole-word matching', () => {
  assert.equal(T.canonicalUrl('HTTPS://Example.com/a/b/?utm_source=x&b=2&a=1#frag'), 'https://example.com/a/b/?a=1&b=2');
  assert.equal(T.canonicalUrl('https://example.com/post/'), 'https://example.com/post');
  assert.equal(T.canonicalUrl('javascript:alert(1)'), ''); assert.equal(T.canonicalUrl('ftp://x.com/a'), '');
  assert.equal(T.urlHash('https://a.com/x?utm_campaign=1'), T.urlHash('https://a.com/x'), 'tracking parameters do not make a new article');
  assert.equal(T.stripPublisher('Anthropic: The ever more dizzying gamble of AI - Le Monde.fr'), 'Anthropic: The ever more dizzying gamble of AI');
  assert.equal(T.stripPublisher('Why this works - and why it matters for everyone who uses it'), 'Why this works - and why it matters for everyone who uses it', 'a long tail is part of the headline');
  assert.deepEqual(T.matchTerms('Said the AI was good for chatbots', ['ai', 'chatbot', 'said', 'sai']), ['ai', 'chatbot', 'said'], '"ai" is not found inside "said"; plural tolerated');
  assert.ok(T.phrases('Google rolls out Gemini 3 to Chrome users').includes('chrome users'));
  assert.equal(T.clip('word '.repeat(200), 40).endsWith('…'), true);
});

test('feeds: every real fixture is read (RSS, Atom with CDATA and line breaks, Google News <source>), GDELT json, bad links dropped', () => {
  const expect = { 'techcrunch.rss.xml': 6, 'bleepingcomputer.rss.xml': 6, 'apple-newsroom.atom.xml': 6, 'chrome-releases.atom.xml': 5, 'cisa-advisories.rss.xml': 6, 'cnet.atom.xml': 6, 'google-blog.rss.xml': 6, 'github-changelog.rss.xml': 6, 'google-news.rss.xml': 30 };
  for (const [f, n] of Object.entries(expect)) {
    const r = parseFeed(fx(f), 'https://feed.test/x');
    assert.equal(r.items.length, n, f); assert.ok(r.title, `${f} has a title`);
    for (const i of r.items) { assert.ok(i.title && !/\n/.test(i.title), `${f}: title is one clean line`); assert.match(i.url, /^https?:\/\//); assert.ok(i.summary.length <= 401); assert.ok(i.publishedAt instanceof Date || i.publishedAt === null); }
  }
  const gn = parseFeed(fx('google-news.rss.xml'));
  assert.equal(gn.items[0].sourceName, 'The Guardian'); assert.ok(!/ - The Guardian$/.test(gn.items[0].title), 'the publisher is taken off the headline');
  const apple = parseFeed(fx('apple-newsroom.atom.xml')).items[0];
  assert.match(apple.title, /^Apple TV becomes the new U\.S\. home of F1 ACADEMY/); assert.equal(apple.publishedAt.toISOString(), '2026-11-19T15:59:07.903Z');
  const g = parseGdelt(fx('gdelt-artlist.json'));
  assert.equal(g.items.length, 2, 'javascript: link and empty title are dropped'); assert.equal(g.items[0].publishedAt.toISOString(), '2026-11-21T09:30:00.000Z'); assert.equal(g.items[0].country, 'US');
  assert.throws(() => parseFeed('<html><body>not a feed</body></html>'), /RSS\/Atom/);
  assert.throws(() => parseFeed(''), /RSS\/Atom/);
  const rel = parseFeed('<rss><channel><title>t</title><item><title>Relative</title><link>/a/b</link></item><item><title>Evil</title><link>javascript:alert(1)</link></item></channel></rss>', 'https://site.test/feed');
  assert.deepEqual(rel.items.map((i) => i.url), ['https://site.test/a/b'], 'relative links resolve, javascript: dropped');
  assert.equal(parseFeed(`<rss><channel><title>t</title>${'<item><title>x</title><link>https://a.test/1</link></item>'.repeat(300)}</channel></rss>`).items.length, 100, 'at most 100 headlines per read');
  assert.match(googleNewsUrl('"data breach" when:1d'), /^https:\/\/news\.google\.com\/rss\/search\?q=%22data%20breach%22%20when%3A1d&hl=en-US&gl=US&ceid=US:en$/);
  assert.match(gdeltUrl('chatgpt'), /query=chatgpt%20sourcelang%3Aenglish&mode=artlist&format=json/);
});

// ── the niche filter on REAL headlines ──────────────────────────────────────────────────────────────────────
const ctx = { categories: P.DEFAULT_CATEGORIES.map((c, i) => ({ id: `c${i}`, name: c.nameEn, keywords: c.keywords, excluded: c.excluded })), excludedAll: P.DEFAULT_EXCLUDED.map((x) => x[0]), excludedByCategory: [] };
const cls = (title, extra = {}) => R.classify({ title, summary: '', reliability: 60, ...extra }, ctx);

test('relevance: real headlines - on topic passes, generic "AI" talk and off-topic news does not', () => {
  for (const t of ['Hackers use autonomous AI tool Cairn to find zero-day, take over server', 'Vendor data breach exposes Chase, Visa, Mastercard customer info', 'Microsoft now automatically installs Windows 11 26H2 on unmanaged devices',
    'Google Is Killing the Nest App. Here’s What Comes Next', 'Meet the 2026 App Store Award finalists', 'CISA Adds Four Known Exploited Vulnerabilities to Catalog', 'Introducing Tool Retrieval in the Gemini API']) {
    assert.equal(cls(t).status, 'relevant', t);
  }
  for (const t of ['Afraid of AI? You’re never too old to learn something new', 'A statement from LPM on artificial intelligence', 'Technology + AI (artificial intelligence)', 'Welcome to the age of endless digital breakdowns',
    'Fluance’s Upgraded RT86 Could Be Turntable to Beat for $700', 'Ridge High School Students to Explore Artificial Intelligence Through New SHARE AI Club', 'Still tracking company passwords in spreadsheets? You’re flying blind.']) {
    assert.equal(cls(t).status, 'irrelevant', t);
  }
  assert.equal(cls('Emerging Agentic Artificial Intelligence Systems Transform Oncology Research and Discovery').status, 'excluded', 'health topics are out of scope');
  assert.equal(cls('Agentic AI Is Ushering In a New Era of Estate Planning').status, 'excluded');
  assert.equal(cls('Football match tonight: ChatGPT predicts the score').status, 'excluded', 'an excluded topic wins even when a strong term is present');
});

test('relevance: weak words alone never pass, the official-source boost needs a strong term, the feed name gives context', () => {
  const weak = cls('Premium bundle outage leaves users waiting'); assert.equal(weak.status, 'irrelevant'); assert.match(weak.reason, /genel terim/, 'only generic words matched (premium, bundle, outage)');
  assert.equal(cls('Why AI, data and privacy matter for technology in the digital age').status, 'irrelevant');
  assert.equal(cls('Why this new app update matters').status, 'relevant', '"app update" is a specific phrase, not a generic word');
  assert.equal(cls('Chrome Dev for Desktop Update', { reliability: 90 }).status, 'relevant');
  assert.equal(cls('Early Stable Update for Desktop', { reliability: 90 }).status, 'irrelevant', 'no brand in the headline, below the line');
  const withFeed = cls('Early Stable Update for Desktop', { reliability: 90, sourceName: 'Google Chrome Releases' });
  assert.ok(withFeed.relevance > cls('Early Stable Update for Desktop', { reliability: 90 }).relevance, 'the feed name (the owner chose it) adds context, but alone it stays below the line'); assert.equal(withFeed.status, 'irrelevant');
  const r = cls('OpenAI rolls out ChatGPT price increase for Plus subscribers'); assert.equal(r.status, 'relevant'); assert.ok(r.matched.includes('chatgpt'));
  const mn = R.classify({ title: 'Gemini gets a redesign', summary: '', reliability: 60 }, ctx, { minRelevance: 90 }); assert.equal(mn.status, 'irrelevant', 'the threshold is a setting');
  assert.equal(cls('').status, 'irrelevant');
});

// ── safeFetch ────────────────────────────────────────────────────────────────────────────────────────────────
async function serve(handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}
const withPrivate = async (fn) => { process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1'; try { return await fn(); } finally { delete process.env.CONTENT_ALLOW_PRIVATE_FETCH; } };
const code = async (p) => { try { await p; } catch (e) { return e.code; } return 'no error'; };

test('safeFetch: inside-network and odd addresses are refused before any request (SSRF)', async () => {
  for (const u of ['http://127.0.0.1/', 'http://127.1.2.3:80/x', 'http://10.0.0.5/', 'http://192.168.1.10/feed', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[fd00::1]/', 'http://0.0.0.0/', 'http://100.64.0.1/']) assert.equal(await code(fetchText(u)), 'ssrf', u);
  assert.equal(await code(fetchText('http://localhost:80/x')), 'ssrf', 'a NAME that resolves to loopback is refused at connect time');
  for (const u of ['ftp://example.com/a', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pass@example.com/', 'http://example.com:22/', 'not a url', '']) assert.equal(await code(fetchText(u)), 'url', u);
  assert.equal(isPrivateIp('192.0.66.145'), false, 'a public WordPress.com address (9to5Mac, CNET, ZDNet) is not blocked'); for (const ip of ['192.0.0.1', '192.0.2.5', '198.51.100.7', '203.0.113.9', '198.18.0.1', '255.255.255.255']) assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp('8.8.8.8'), false); assert.equal(isPrivateIp('::ffff:10.0.0.1'), true); assert.equal(isPrivateIp('2606:4700::1111'), false);
  assert.throws(() => checkUrl('http://10.1.1.1/'), (e) => e.code === 'ssrf');
});

test('safeFetch: reads text (also gzip), follows redirects by hand, honours ETag, reports rate limits and errors', async () => {
  await withPrivate(async () => {
    const hits = [];
    const s = await serve((req, res) => {
      hits.push(req.url);
      if (req.url === '/ok') { res.writeHead(200, { 'Content-Type': 'application/xml', ETag: '"v1"' }); return res.end('<rss/>'); }
      if (req.url === '/gz') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); return res.end(zlib.gzipSync('hello gzip')); }
      if (req.url === '/redir') { res.writeHead(302, { Location: '/ok' }); return res.end(); }
      if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
      if (req.url === '/bad-redirect') { res.writeHead(302, { Location: 'ftp://internal/secret' }); return res.end(); }
      if (req.url === '/etag') { if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304); return res.end(); } res.writeHead(200, { ETag: '"v1"' }); return res.end('x'); }
      if (req.url === '/429') { res.writeHead(429, { 'Retry-After': '120' }); return res.end('slow down'); }
      if (req.url === '/500') { res.writeHead(500); return res.end('boom'); }
      if (req.url === '/ua') { res.writeHead(200); return res.end(req.headers['user-agent']); }
      res.writeHead(404); res.end();
    });
    try {
      const ok = await fetchText(`${s.url}/ok`); assert.deepEqual([ok.status, ok.body, ok.etag], [200, '<rss/>', '"v1"']);
      assert.equal((await fetchText(`${s.url}/gz`)).body, 'hello gzip');
      assert.equal((await fetchText(`${s.url}/redir`)).body, '<rss/>');
      assert.equal(await code(fetchText(`${s.url}/loop`)), 'redirect');
      assert.equal(await code(fetchText(`${s.url}/bad-redirect`)), 'url', 'a redirect target is checked like a typed address');
      assert.equal((await fetchText(`${s.url}/etag`, { etag: '"v1"' })).notModified, true);
      const lim = await fetchText(`${s.url}/429`).catch((e) => e); assert.deepEqual([lim.code, lim.retryAfterSec], ['rate_limited', 120]);
      assert.equal(await code(fetchText(`${s.url}/500`)), 'http'); assert.equal(await code(fetchText(`${s.url}/404`)), 'http');
      assert.match((await fetchText(`${s.url}/ua`)).body, /^ModulPOSContentBot\/0\.1 \(\+https:\/\/content\.modulpos\.com/, 'identifies itself');
    } finally { await s.close(); }
  });
});

test('safeFetch: size limit (also for decompressed data) and time limit', async () => {
  await withPrivate(async () => {
    const s = await serve((req, res) => {
      if (req.url === '/big') { res.writeHead(200); return res.end('x'.repeat(200000)); }
      if (req.url === '/bomb') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); return res.end(zlib.gzipSync(Buffer.alloc(5 * 1024 * 1024, 0x61))); }
      if (req.url === '/hang') return undefined;                 // never answers
      res.writeHead(200); return res.end('ok');
    });
    try {
      assert.equal(await code(fetchText(`${s.url}/big`, { maxBytes: 50000 })), 'too_large');
      assert.equal(await code(fetchText(`${s.url}/bomb`, { maxBytes: 1024 * 1024 })), 'too_large', 'a small gzip file that unpacks to 5 MB');
      const t0 = Date.now(); assert.equal(await code(fetchText(`${s.url}/hang`, { timeoutMs: 300 })), 'timeout'); assert.ok(Date.now() - t0 < 3000);
      assert.equal((await fetchText(`${s.url}/other`)).body, 'ok');
    } finally { await s.close(); }
  });
  await withPrivate(async () => assert.equal(await code(fetchText('http://127.0.0.1:1/')), 'network', 'connection refused is a readable network error'));
});
