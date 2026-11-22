const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../src/content/lib/siteAudit');
const { parseCommand } = require('../../src/content/services/telegram');

// the pure parts of the AdSense site audit and of the Telegram commands: no network, no database

test('parseHtml: language, viewport, canonical, noindex, links by zone, AdSense numbers, consent tools, mixed content', () => {
  const html = `<!doctype html><html lang="en-US"><head><title>My Site</title><meta name="viewport" content="width=device-width"><meta name='robots' content='noindex,follow'>
    <link rel="canonical" href="https://x.example/"><meta name="google-adsense-account" content="ca-pub-1234567890123456"><meta name="generator" content="WordPress 6.8">
    <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9999999999999999"></script><script src="/x/complianz/cmplz.js"></script></head>
    <body><header><nav><a href="/">Home</a><a href="/about-us/">About Us</a></nav></header><main><a href="/post-1/">Post</a> <a href="https://other.example/x">Out</a> <a href="mailto:a@b.c">Mail</a> <a href="#top">Top</a></main>
    <ins class="adsbygoogle" data-ad-client="ca-pub-9999999999999999"></ins><img src="http://cdn.example/a.jpg"><footer><a href="/privacy-policy/">Privacy Policy</a></footer></body></html>`;
  const p = L.parseHtml(html, 'https://x.example/');
  assert.deepEqual([p.lang, p.title, p.viewport, p.canonical, p.robotsMeta, p.generator], ['en-US', 'My Site', true, 'https://x.example/', 'noindex,follow', 'WordPress 6.8']);
  assert.deepEqual(p.adsenseClients.sort(), ['1234567890123456', '9999999999999999']); assert.equal(p.adUnits, 1); assert.deepEqual(p.cmp, ['Complianz']); assert.equal(p.mixedContent, 1); assert.equal(p.navCount, 1);
  assert.deepEqual(p.links.map((l) => [l.text, l.zone, l.internal]), [['Home', 'header', true], ['About Us', 'header', true], ['Post', 'body', true], ['Out', 'body', false], ['Privacy Policy', 'footer', true]], 'mail and anchor links are not pages');
  assert.equal(L.pickLink(p.links, 'about').href, 'https://x.example/about-us/'); assert.equal(L.pickLink(p.links, 'privacy').zone, 'footer'); assert.equal(L.pickLink(p.links, 'contact'), null);
  const bare = L.parseHtml('<html><body>hi</body></html>', 'https://x.example/'); assert.deepEqual([bare.lang, bare.viewport, bare.canonical, bare.links.length, bare.cmp, bare.adsenseClients], [null, false, null, 0, [], []]);
});

test('parseRobots: a closed site, a blocked ads crawler, the sitemap lines, no file', () => {
  assert.deepEqual(L.parseRobots(null), { exists: false, blocksAll: false, blocksAdsCrawler: false, sitemaps: [] });
  const wp = L.parseRobots('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nSitemap: https://x.example/wp-sitemap.xml\n');
  assert.deepEqual([wp.exists, wp.blocksAll, wp.blocksAdsCrawler, wp.sitemaps], [true, false, false, ['https://x.example/wp-sitemap.xml']]);
  assert.equal(L.parseRobots('User-agent: *\nDisallow: /\n').blocksAll, true); assert.equal(L.parseRobots('User-agent: *\nDisallow: /\nAllow: /\n').blocksAll, false, 'Allow: / reopens it');
  assert.deepEqual([L.parseRobots('User-agent: Mediapartners-Google\nDisallow: /\nUser-agent: *\nDisallow:\n').blocksAdsCrawler, L.parseRobots('User-agent: Googlebot\nDisallow: /\nUser-agent: *\nDisallow:\n').blocksAll], [true, true]);
  assert.equal(L.parseRobots('# a comment\nUser-agent: *\nDisallow: /private/ # not all\n').blocksAll, false);
});

test('adsTxtHas: the Google line for exactly this publisher, whatever the case, spaces or prefix', () => {
  const t = '# ads\nGoogle.com, PUB-1234567890123456 , direct, f08c47fec0942fa0\nexample.com, 55, RESELLER\n';
  assert.equal(L.adsTxtHas(t, 'pub-1234567890123456'), true); assert.equal(L.adsTxtHas(t, 'ca-pub-1234567890123456'), true); assert.equal(L.adsTxtHas(t, '1234567890123456'), true);
  assert.equal(L.adsTxtHas(t, 'pub-1111111111111111'), false); assert.equal(L.adsTxtHas('google.com, pub-1234567890123456, RESELLER', 'pub-1234567890123456'), false, 'DIRECT is what AdSense gives you'); assert.equal(L.adsTxtHas('', 'pub-1'), false); assert.equal(L.adsTxtHas(t, ''), false);
});

const HOME = (extra = '') => `<html lang="en-US"><head><title>T</title><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://x.example/">${extra}</head><body><header><nav><a href="/">Home</a><a href="/a/">A</a><a href="/b/">B</a></nav></header><footer><a href="/privacy/">Privacy Policy</a><a href="/about/">About</a><a href="/contact/">Contact</a></footer></body></html>`;
const SNAP = (o = {}) => ({ baseUrl: 'https://x.example', httpRedirect: true, home: { ok: true, status: 200, ms: 400, html: HOME(), finalUrl: 'https://x.example/', headers: {} }, robots: { status: 200, body: 'User-agent: *\nDisallow: /wp-admin/\n' }, sitemap: { found: true, url: 'https://x.example/wp-sitemap.xml', urlCount: 3 },
  rest: { ok: true, name: 'X', description: 'Real tagline', pages: [{ slug: 'privacy', title: 'Privacy Policy', link: 'https://x.example/privacy/', words: 300, text: 'We use cookies. Google, a third party vendor, serves ads.' }, { slug: 'about', title: 'About', link: 'https://x.example/about/', words: 200, text: 'x' }, { slug: 'contact', title: 'Contact', link: 'https://x.example/contact/', words: 90, text: 'x' }], posts: [], postsTotal: 0 }, linkProbes: [], ...o });
const st = (r) => Object.fromEntries(r.items.map((i) => [i.key, i.status]));

test('evaluate: every item has one of the five results; required items and manual items; the verdicts and what they say', () => {
  const r = L.evaluate(SNAP(), { language: 'en-US' });
  assert.ok(r.items.every((i) => L.STATUSES.includes(i.status) && i.detail && L.GROUPS[i.group]));
  assert.equal(new Set(r.items.map((i) => i.key)).size, r.items.length, 'no item twice');
  const s = st(r); assert.deepEqual([s.reachable, s.ssl, s.indexable, s.privacy, s.cookie_disclosure, s.about, s.contact, s.navigation, s.content_volume, s.canonical], ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'missing', 'passed']);
  assert.deepEqual(['manual_status', 'manual_content', 'manual_ads'].map((k) => s[k]), ['manual', 'manual', 'manual']);
  assert.equal(r.verdict, 'almost'); assert.match(r.verdictText, /uyarıları/);
  assert.ok(r.items.filter((i) => i.required).map((i) => i.key).includes('privacy') && !r.items.find((i) => i.key === 'about').required);
  // a secure site with posts and a consent tool, no ads yet: clean, and the text says it is not an approval
  const posts = Array.from({ length: 12 }, (_, i) => ({ slug: `p${i}`, title: `Post ${i} about things`, link: `https://x.example/p${i}/`, words: 700, author: { name: 'Jane', bio: 'Writes.' } }));
  const clean = L.evaluate(SNAP({ rest: { ...SNAP().rest, posts, postsTotal: 12, pages: [...SNAP().rest.pages, { slug: 'editorial-policy', title: 'Editorial Policy', link: 'https://x.example/e/', words: 200, text: 'x' }] }, home: { ...SNAP().home, html: HOME('<script src="/complianz/c.js"></script>') } }), { language: 'en-US' });
  assert.deepEqual([clean.verdict, clean.summary.missing, clean.summary.warning], ['checks_clean', 0, 0]); assert.match(clean.verdictText, /bu bir onay değildir ve AdSense onayını garanti etmez/);
  // not https, no privacy page: not ready, and the missing required items are named
  const bad = L.evaluate(SNAP({ baseUrl: 'http://x.example', httpRedirect: undefined, home: { ...SNAP().home, finalUrl: 'http://x.example/', html: HOME().replace(/<footer>[\s\S]*<\/footer>/, '') }, rest: { ...SNAP().rest, pages: [] }, fetchedPages: {} }), { language: 'en-US' });
  assert.equal(bad.verdict, 'not_ready'); assert.deepEqual(bad.summary.requiredMissing.sort(), ['cookie_disclosure', 'privacy', 'ssl']);
});

test('evaluate: the privacy text must mention cookies AND advertising; a thin page is a warning; unreadable REST is "manual", never fine; the AdSense number switches the code checks on', () => {
  const pg = (text, words = 300) => SNAP({ rest: { ...SNAP().rest, pages: [{ slug: 'privacy', title: 'Privacy Policy', link: 'https://x.example/privacy/', words, text }] } });
  assert.equal(st(L.evaluate(pg('We store nothing.'), {})).cookie_disclosure, 'warning'); assert.equal(st(L.evaluate(pg('We use cookies for login only.'), {})).cookie_disclosure, 'warning');
  assert.equal(st(L.evaluate(pg('We use cookies and Google serves ads through third party vendors.'), {})).cookie_disclosure, 'passed'); assert.equal(st(L.evaluate(pg('cookies google', 40), {})).privacy, 'warning', 'under 150 words looks like a placeholder');
  const norest = L.evaluate(SNAP({ rest: { ok: false, pages: [], posts: [] } }), {}); assert.equal(st(norest).content_volume, 'manual'); assert.ok(!('authors' in st(norest)) && !('duplicates' in st(norest)));
  const noPub = st(L.evaluate(SNAP(), {})); assert.deepEqual([noPub.adsense_code, noPub.ads_txt], ['na', 'na']);
  const withPub = st(L.evaluate(SNAP(), { pubId: 'pub-1234567890123456' })); assert.deepEqual([withPub.adsense_code, withPub.ads_txt], ['missing', 'missing']);
  const ok = st(L.evaluate(SNAP({ adsTxt: { status: 200, body: 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0' }, home: { ...SNAP().home, html: HOME('<meta name="google-adsense-account" content="ca-pub-1234567890123456">') } }), { pubId: 'pub-1234567890123456' })); assert.deepEqual([ok.adsense_code, ok.ads_txt], ['passed', 'passed']);
  const unreachable = L.evaluate({ baseUrl: 'https://x.example', home: { ok: false, error: 'Bağlanılamadı' } }, {}); assert.deepEqual([unreachable.verdict, unreachable.items.length, unreachable.reachable], ['unreachable', 1, false]);
});

test('Telegram commands are parsed strictly: a slash, a name, an optional @bot, at most five words of arguments', () => {
  assert.deepEqual(parseCommand('/status'), { name: 'status', args: [] }); assert.deepEqual(parseCommand('/Generate@My_Bot onay'), { name: 'generate', args: ['onay'] }); assert.deepEqual(parseCommand('  /cost   today  please '), { name: 'cost', args: ['today', 'please'] });
  assert.equal(parseCommand('status'), null); assert.equal(parseCommand('hello /status'), null); assert.equal(parseCommand('/'), null); assert.equal(parseCommand('/123'), null); assert.equal(parseCommand(''), null); assert.equal(parseCommand(null), null);
  assert.equal(parseCommand('/a b c d e f g h').args.length, 5);
});
