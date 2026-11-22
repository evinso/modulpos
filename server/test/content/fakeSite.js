const http = require('node:http');

/**
 * A public WordPress site on 127.0.0.1 for the AdSense audit tests: a home page, pages, robots.txt, ads.txt, a sitemap and WordPress's public REST lists.
 * `fresh` = what a brand new WordPress install shows (sample post, sample page, default slogan, a DRAFT privacy page that the public cannot see);
 * `ready` = a finished site. Every switch can be changed per test: `start({ ...READY, noindex: true })`.
 */
const words = (n, seed = 'word') => Array.from({ length: n }, (_, i) => `${seed}${i % 37}`).join(' ');
const para = (n, seed) => `<p>${words(n, seed)}.</p>`;

const READY = {
  name: 'Tech Update Brief', description: 'Clear explanations of AI and digital technology news', lang: 'en-US', viewport: true, canonical: true, noindex: false, robotsBlocksAll: false, robotsBlocksAds: false, robotsMissing: false,
  sitemap: true, adsTxt: null, adsenseCode: null, cmp: 'complianz', rest: true,
  pages: [['about-us', 'About Us', 200], ['contact', 'Contact', 120], ['privacy-policy', 'Privacy Policy', 400, 'We use cookies. Third party vendors, including Google, use cookies to serve ads based on prior visits. You can opt out in Google Ads Settings.'], ['editorial-policy', 'Editorial Policy', 150]],
  posts: 14, postWords: 650, author: { name: 'Jane Doe', bio: 'Jane writes about consumer technology.' }, duplicateTitle: false, brokenLink: false, mixed: false, slowMs: 0, ads: 0, httpRedirects: true, homeStatus: 200,
};
const FRESH = {
  ...READY, name: 'My Blog', description: 'Just another WordPress site', cmp: null, adsTxt: null,
  pages: [['sample-page', 'Sample Page', 60]], posts: 1, postWords: 30, author: { name: 'admin', bio: '' }, firstPostTitle: 'Hello world!', sitemap: true, httpRedirects: false,
};

async function start(o = {}) {
  const c = { ...READY, ...o }; const hits = []; let origin = '';
  // everything below is computed per request from `c`: a test can change `site.config` and the SAME address answers differently (an audit "since last time")
  const getPosts = () => Array.from({ length: c.posts }, (_, i) => ({ id: i + 1, slug: `post-${i + 1}`, title: c.duplicateTitle && i < 2 ? 'Same title' : (i === 0 && c.firstPostTitle) ? c.firstPostTitle : `Post number ${i + 1} about technology`, date: '2026-11-01T10:00:00', words: c.postWords }));
  const getPages = () => c.pages.map(([slug, title, w, text]) => ({ slug, title, words: w, text }));
  const page = (title, body) => {
    const pages = getPages();
    const nav = `<nav><ul><li><a href="/">Home</a></li><li><a href="/category/ai/">AI</a></li><li><a href="/category/gadgets/">Gadgets</a></li>${pages.some((p) => p.slug === 'about-us') ? '<li><a href="/about-us/">About Us</a></li>' : ''}</ul></nav>`;
    const footer = `<footer>${pages.some((p) => p.slug === 'privacy-policy') ? '<a href="/privacy-policy/">Privacy Policy</a>' : ''} ${pages.some((p) => p.slug === 'contact') ? '<a href="/contact/">Contact</a>' : ''}${c.brokenLink ? ' <a href="/gone-page/">Old news</a>' : ''}</footer>`;
    const adsCode = c.adsenseCode ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-${c.adsenseCode}" crossorigin="anonymous"></script>` : '';
    const cmpCode = c.cmp === 'complianz' ? '<script src="/wp-content/plugins/complianz-gdpr/assets/cmplz.js"></script>' : '';
    const adUnits = Array.from({ length: c.ads }, () => '<ins class="adsbygoogle" data-ad-client="ca-pub-1"></ins>').join('');
    return `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8"><title>${title}</title>${c.viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}${c.canonical ? `<link rel="canonical" href="${origin}/">` : ''}${c.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}<meta name="generator" content="WordPress 6.8">${adsCode}${cmpCode}</head><body><header>${nav}</header>${body}${c.mixed ? '<img src="http://cdn.example.net/a.jpg">' : ''}${adUnits}${footer}</body></html>`;
  };
  const send = (res, status, type, body, headers = {}) => { res.writeHead(status, { 'Content-Type': type, ...headers }); res.end(body); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname; hits.push(req.method + ' ' + req.url); const posts = getPosts(); const pages = getPages();
    if (c.slowMs) await new Promise((r) => setTimeout(r, c.slowMs));
    if (p === '/' || p === '') return c.homeStatus === 200 ? send(res, 200, 'text/html', page(c.name, `<main><h1>${c.name}</h1>${posts.slice(0, 5).map((x) => `<article><a href="/${x.slug}/">${x.title}</a></article>`).join('')}</main>`)) : send(res, c.homeStatus, 'text/html', 'maintenance');
    if (p === '/robots.txt') return c.robotsMissing ? send(res, 404, 'text/plain', 'nf') : send(res, 200, 'text/plain', `User-agent: *\n${c.robotsBlocksAll ? 'Disallow: /' : 'Disallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php'}\n${c.robotsBlocksAds ? 'User-agent: Mediapartners-Google\nDisallow: /\n' : ''}${c.sitemap ? `Sitemap: ${origin}/wp-sitemap.xml\n` : ''}`);
    if (p === '/wp-sitemap.xml') return c.sitemap ? send(res, 200, 'application/xml', `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/wp-sitemap-posts-post-1.xml</loc></sitemap></sitemapindex>`) : send(res, 404, 'text/plain', 'nf');
    if (p === '/ads.txt') return c.adsTxt ? send(res, 200, 'text/plain', c.adsTxt) : send(res, 404, 'text/plain', 'nf');
    if (p === '/wp-json/' || p === '/wp-json') return c.rest ? send(res, 200, 'application/json', JSON.stringify({ name: c.name, description: c.description, url: origin })) : send(res, 401, 'application/json', '{"code":"rest_disabled"}');
    if (p === '/wp-json/wp/v2/pages') return send(res, 200, 'application/json', JSON.stringify(pages.map((x, i) => ({ id: i + 1, slug: x.slug, title: { rendered: x.title }, link: `${origin}/${x.slug}/`, status: 'publish', content: { rendered: x.text ? `<p>${x.text}</p>${para(x.words, 'pg')}` : para(x.words, 'pg') } }))));
    if (p === '/wp-json/wp/v2/posts') return send(res, 200, 'application/json', JSON.stringify(posts.slice(0, 15).map((x) => ({ id: x.id, slug: x.slug, title: { rendered: x.title }, link: `${origin}/${x.slug}/`, date: x.date, content: { rendered: para(x.words, 'p') }, _embedded: { author: [{ name: c.author.name, description: c.author.bio, link: `${origin}/author/x/` }] } }))), { 'X-WP-Total': String(c.posts) });
    for (const x of pages) if (p === `/${x.slug}/`) return send(res, 200, 'text/html', page(x.title, `<main><h1>${x.title}</h1>${x.text ? `<p>${x.text}</p>` : ''}${para(x.words, 'pg')}</main>`));
    for (const x of posts) if (p === `/${x.slug}/`) return send(res, 200, 'text/html', page(x.title, `<main><h1>${x.title}</h1>${para(x.words, 'p')}</main>`));
    if (p.startsWith('/category/')) return send(res, 200, 'text/html', page('Category', '<main>cat</main>'));
    return send(res, 404, 'text/html', page('Not found', '<main>Not found</main>'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin, hits, config: c, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { start, READY, FRESH };
