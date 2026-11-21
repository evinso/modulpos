const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/services/trendyolPage');

const U = 'https://www.trendyol.com/his-studio/geyik-figurlu-seramik-kupa-p-1075130175';

test('only trendyol.com product addresses are accepted', () => {
  assert.deepEqual(T.parseTrendyolUrl(`${U}?boutiqueId=61&merchantId=1&utm_source=x`), { url: U, contentId: '1075130175' }, 'tracking parameters are dropped');
  assert.equal(T.parseTrendyolUrl('https://m.trendyol.com/a/b-p-123456').contentId, '123456');
  assert.equal(T.parseTrendyolUrl('  https://trendyol.com/a/b-p-123456 ').url, 'https://trendyol.com/a/b-p-123456');
  for (const bad of ['', 'trendyol', 'http://www.trendyol.com/a-p-123456', 'https://evil.com/trendyol.com/a-p-123456', 'https://trendyol.com.evil.com/a-p-123456',
    'https://www.trendyol.com@evil.com/a-p-123456', 'https://user:pw@www.trendyol.com/a-p-123456', 'https://www.trendyol.com:8443/a-p-123456',
    'https://169.254.169.254/latest/meta-data', 'https://localhost/a-p-123456', 'file:///etc/passwd', 'javascript:alert(1)', 'https://www.trendyol.com/kupa-y-s12017', 'ftp://www.trendyol.com/a-p-123456']) {
    assert.ok(T.parseTrendyolUrl(bad).error, `refused: ${bad}`);
  }
});

const LD = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
test('schema.org Product block: title, description (HTML to text), brand, pictures, price', () => {
  const html = `<html><head><title>x</title>${LD({ '@context': 'https://schema.org', '@type': 'Product', name: 'HİS Studio Geyik Figürlü Kupa - Fiyatı, Yorumları', description: '<p>El yapımı &amp; boyalı</p><ul><li>200 ml</li><li>Seramik</li></ul>',
    image: ['https://cdn.dsmcdn.com/ty1/product/media/images/a_org_zoom.jpg', '/ty1/product/media/images/b_org_zoom.jpg', 'https://cdn.dsmcdn.com/not-an-image.html'], brand: { '@type': 'Brand', name: 'HİS Studio' },
    offers: { '@type': 'Offer', price: '299.90', priceCurrency: 'TRY' } })}</head></html>`;
  const r = T.extract(html);
  assert.equal(r.found, true);
  assert.equal(r.title, 'HİS Studio Geyik Figürlü Kupa', 'the " - Fiyatı, Yorumları" the site adds to titles is dropped');
  assert.equal(r.description, 'El yapımı & boyalı\n• 200 ml\n• Seramik');
  assert.equal(r.brand, 'HİS Studio'); assert.equal(r.price, 299.9);
  assert.deepEqual(r.images, ['https://cdn.dsmcdn.com/ty1/product/media/images/a_org_zoom.jpg', 'https://cdn.dsmcdn.com/ty1/product/media/images/b_org_zoom.jpg'], 'relative addresses completed, non-pictures left out');
  assert.equal(r.category, null); assert.deepEqual(r.attributes, []);
});

test('a Product inside an @graph or an array is found too', () => {
  const r = T.extract(LD({ '@graph': [{ '@type': 'WebSite', name: 'Trendyol' }, { '@type': ['Product'], name: 'Kupa', image: 'https://cdn.dsmcdn.com/x.jpg' }] }));
  assert.equal(r.title, 'Kupa'); assert.equal(r.images.length, 1);
  assert.equal(T.extract(LD([{ '@type': 'BreadcrumbList' }, { '@type': 'Product', name: 'B' }])).title, 'B');
});

test('state JSON: category, attributes, pictures, price (several shapes), and it wins over the schema block', () => {
  const state = { product: { name: 'Seramik Kupa 300 ml', brand: { name: 'Atölye' }, category: { id: 1234, name: 'Kupa', hierarchy: 'Ev & Yaşam/Mutfak/Kupa' },
    images: ['/ty9/product/media/images/1_org.jpg', { url: 'https://cdn.dsmcdn.com/ty9/product/media/images/2_org.jpg' }],
    contentDescriptions: [{ description: 'Birinci paragraf' }, { description: 'İkinci' }],
    attributes: [{ key: { name: 'Renk' }, value: { name: 'Beyaz' } }, { key: { name: 'Hacim' }, value: { name: '300 ml' } }, { key: { name: '' }, value: { name: 'x' } }],
    price: { sellingPrice: { value: 249.5 } } } };
  const html = `<script>window.__PRODUCT_DETAIL_APP_INITIAL_STATE__=${JSON.stringify(state)};window.other=1;</script>${LD({ '@type': 'Product', name: 'LD adı', brand: 'LD marka' })}`;
  const r = T.extract(html);
  assert.equal(r.title, 'Seramik Kupa 300 ml', 'the state beats the schema block'); assert.equal(r.brand, 'Atölye');
  assert.deepEqual(r.category, { id: '1234', name: 'Kupa', hierarchy: 'Ev & Yaşam/Mutfak/Kupa' });
  assert.deepEqual(r.attributes, [{ name: 'Renk', value: 'Beyaz' }, { name: 'Hacim', value: '300 ml' }]);
  assert.equal(r.description, 'Birinci paragraf\nİkinci'); assert.equal(r.price, 249.5);
  assert.deepEqual(r.images, ['https://cdn.dsmcdn.com/ty9/product/media/images/1_org.jpg', 'https://cdn.dsmcdn.com/ty9/product/media/images/2_org.jpg']);
});

test('the state is cut out with balanced braces: braces and quotes inside strings do not confuse it', () => {
  const tricky = { product: { name: 'Kupa {özel} "tırnaklı" }', description: 'a } b { c \\ d' } };
  const html = `<script>var a=1;window.__PRODUCT_DETAIL_APP_INITIAL_STATE__ = ${JSON.stringify(tricky)}; var b={x:2};</script>`;
  assert.deepEqual(T.stateJson(html), tricky);
  assert.equal(T.stateJson('<script>window.__PRODUCT_DETAIL_APP_INITIAL_STATE__={broken</script>'), null);
  assert.equal(T.stateJson('<html>nothing</html>'), null);
});

test('only og: tags: still enough for a title, a text and a picture', () => {
  const html = '<meta property="og:title" content="Seramik &quot;Kupa&quot;"><meta property="og:description" content="Güzel bir kupa"><meta property="og:image" content="https://cdn.dsmcdn.com/p.jpg?v=1">';
  const r = T.extract(html);
  assert.equal(r.found, true); assert.equal(r.title, 'Seramik "Kupa"'); assert.equal(r.description, 'Güzel bir kupa'); assert.deepEqual(r.images, ['https://cdn.dsmcdn.com/p.jpg?v=1']);
});

test('nothing usable: found is false and nothing is invented', () => {
  for (const junk of ['', '   ', '<html><body>Merhaba</body></html>', null, undefined, 'x'.repeat(5000), '{"a":1}']) {
    const r = T.extract(junk);
    assert.equal(r.found, false); assert.equal(r.title, ''); assert.deepEqual(r.images, []); assert.equal(r.category, null);
  }
});

test('at most 12 distinct pictures; schema attributes (additionalProperty) are used when the state has none', () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://cdn.dsmcdn.com/i${i % 15}.jpg`);
  const r = T.extract(LD({ '@type': 'Product', name: 'K', image: many, additionalProperty: [{ '@type': 'PropertyValue', name: 'Renk', value: 'Siyah' }] }));
  assert.equal(r.images.length, 12); assert.equal(new Set(r.images).size, 12);
  assert.deepEqual(r.attributes, [{ name: 'Renk', value: 'Siyah' }]);
});

test('bot protection is recognised: by status and by a challenge page without product data', () => {
  assert.equal(T.looksBlocked(403, ''), true); assert.equal(T.looksBlocked(429, 'x'), true);
  assert.equal(T.looksBlocked(200, '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b"></script></html>'), true);
  assert.equal(T.looksBlocked(200, `<html>${LD({ '@type': 'Product', name: 'K' })} challenge-platform</html>`), false, 'a real page that merely mentions it');
  assert.equal(T.looksBlocked(200, '<html>ok</html>'), false);
});

test('fetchPage: the page, or a clear BLOCKED / FAILED', async () => {
  const ok = await T.fetchPage(U, { get: async (url, cfg) => { assert.equal(url, U); assert.ok(cfg.headers['User-Agent'] && cfg.timeout <= 15000 && cfg.maxContentLength <= 4_000_000); return { status: 200, data: '<html>page</html>' }; } });
  assert.equal(ok.html, '<html>page</html>');
  await assert.rejects(T.fetchPage(U, { get: async () => ({ status: 403, data: '' }) }), (e) => e.code === 'BLOCKED' && /engelledi/.test(e.message));
  await assert.rejects(T.fetchPage(U, { get: async () => ({ status: 200, data: '<title>Just a moment...</title>' }) }), (e) => e.code === 'BLOCKED');
  await assert.rejects(T.fetchPage(U, { get: async () => ({ status: 404, data: 'yok' }) }), (e) => e.code === 'FAILED' && /404/.test(e.message));
  await assert.rejects(T.fetchPage(U, { get: async () => { throw new Error('ENOTFOUND'); } }), (e) => e.code === 'FAILED' && /ulaşılamadı/.test(e.message));
  let cfg; await T.fetchPage(U, { get: async (u, c) => { cfg = c; return { status: 200, data: 'x' }; } });
  assert.doesNotThrow(() => cfg.beforeRedirect({ hostname: 'www.trendyol.com' }));
  assert.throws(() => cfg.beforeRedirect({ hostname: 'evil.example' }), /refused/, 'a redirect to another host is refused');
});
