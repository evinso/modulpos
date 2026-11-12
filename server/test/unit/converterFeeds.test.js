const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

// ── fakes: an in-memory XmlConverterFeed table and a supplier whose answer the tests choose ──
const rows = new Map();
let failWrites = false;
stub(src('config/database.js'), {
  xmlConverterFeed: {
    upsert: async ({ where, create, update }) => {
      if (failWrites) throw new Error('db down');
      const cur = rows.get(where.urlHash);
      if (cur) Object.assign(cur, update); else rows.set(where.urlHash, { ...create });
    },
    findMany: async ({ where }) => where.urlHash.in.filter((h) => rows.has(h)).map((h) => rows.get(h)),
  },
});
const supplier = { headers: {}, products: [], fail: null, calls: 0 };
stub(src('services/xml/xmlParser.js'), {
  streamProductObjects: async (url, { onHeaders, onProduct }) => {
    supplier.calls++;
    if (onHeaders) onHeaders(supplier.headers);
    for (const p of supplier.products) await onProduct(p);
    if (supplier.fail) throw new Error(supplier.fail);
  },
});
stub(src('middleware/auth.js'), { auth: (req, res, next) => { req.user = { id: 'u1' }; next(); } });
stub(src('routes/credits.js'), { getSetting: async () => '0', deductCredits: async () => {} });
stub(src('services/notificationService.js'), { createForUser: () => {} });

const feeds = require(src('services/xml/converterFeeds.js'));
const router = require(src('routes/xmlConverter.js'));

const app = express();
app.use(express.json());
app.use('/api/xml-converter', router);
let server; let base;
test.before(async () => {
  process.env.ALLOW_UNSIGNED_PROXY = '1';
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/xml-converter`;
});
test.after(() => server.close());
test.beforeEach(() => { rows.clear(); failWrites = false; Object.assign(supplier, { headers: {}, products: [], fail: null, calls: 0 }); });

const settle = () => new Promise((r) => setTimeout(r, 25));   // the note is written after the response has ended
const SUP = 'https://tedarikci.example.invalid/export.xml';
const row = (url = SUP) => rows.get(feeds.urlHash(url));
const prod = (i) => ({ barcode: `869${i}`, title: `Ürün ${i}`, price: '10.5', quantity: '3' });

test('the address is compared the way the converter uses it: https:// is added, spaces cut', () => {
  assert.equal(feeds.normalizeUrl(' tedarikci.example.invalid/x.xml '), 'https://tedarikci.example.invalid/x.xml');
  assert.equal(feeds.normalizeUrl('http://a.invalid/x'), 'http://a.invalid/x');
  assert.equal(feeds.normalizeUrl(''), '');
  assert.equal(feeds.urlHash('tedarikci.example.invalid/x.xml'), feeds.urlHash('https://tedarikci.example.invalid/x.xml'));
  assert.notEqual(feeds.urlHash('https://a.invalid/x'), feeds.urlHash('https://a.invalid/y'));
});

test('Last-Modified: a valid date is kept; missing, garbage and future dates are not shown as facts', () => {
  const now = Date.parse('2026-11-12T10:00:00Z');
  assert.equal(feeds.parseHttpDate('Thu, 12 Nov 2026 01:50:01 GMT', now).toISOString(), '2026-11-12T01:50:01.000Z');
  assert.equal(feeds.parseHttpDate(undefined, now), null);
  assert.equal(feeds.parseHttpDate('yarın', now), null);
  assert.equal(feeds.parseHttpDate('Mon, 01 Jan 2029 00:00:00 GMT', now), null, 'a supplier with a wrong clock');
});

test('the proxy output is the same converted XML as before, and the pull is noted', async () => {
  supplier.products = [prod(1), prod(2)];
  supplier.headers = { 'last-modified': 'Thu, 12 Nov 2026 01:50:01 GMT' };
  const r = await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}&sig=x`);
  const xml = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/xml/);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Urunler>\n'));
  assert.equal((xml.match(/<Urun>/g) || []).length, 2);
  assert.ok(xml.trimEnd().endsWith('</Urunler>'));
  assert.ok(!xml.includes('XmlConverterError'));
  await settle();
  const n = row();
  assert.equal(n.servedOk, true);
  assert.equal(n.productCount, 2);
  assert.equal(n.servedError, null);
  assert.equal(n.sourceModifiedAt.toISOString(), '2026-11-12T01:50:01.000Z');
  assert.ok(Date.now() - n.servedAt.getTime() < 5000, 'servedAt is "now"');
});

test('a supplier that sends no date: the old supplier date is cleared, not kept', async () => {
  supplier.products = [prod(1)];
  supplier.headers = { 'last-modified': 'Thu, 12 Nov 2026 01:50:01 GMT' };
  await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}`).then((r) => r.text()); await settle();
  assert.ok(row().sourceModifiedAt);
  supplier.headers = {};
  await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}`).then((r) => r.text()); await settle();
  assert.equal(row().sourceModifiedAt, null);
});

test('a supplier error: the error is in the XML as before, noted as failed, the last good count stays', async () => {
  supplier.products = [prod(1), prod(2), prod(3)];
  await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}`).then((r) => r.text()); await settle();
  assert.equal(row().productCount, 3);
  supplier.products = [prod(1)];
  supplier.fail = 'XML URL\'si HTTP 503 döndürdü';
  const xml = await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}`).then((r) => r.text()); await settle();
  assert.match(xml, /<XmlConverterError><message>XML URL&apos;si HTTP 503 döndürdü<\/message><\/XmlConverterError>\s*<\/Urunler>$/);
  assert.equal(row().servedOk, false);
  assert.match(row().servedError, /503/);
  assert.equal(row().productCount, 3, 'a failed pull does not overwrite the last known count');
});

test('an empty feed is not "ok"', async () => {
  supplier.products = [];
  await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}`).then((r) => r.text()); await settle();
  assert.equal(row().servedOk, false);
  assert.equal(row().servedError, 'Kaynakta ürün bulunamadı');
  assert.equal(row().productCount, 0);
});

test('a database that cannot be written never breaks the proxy', async () => {
  failWrites = true;
  supplier.products = [prod(1)];
  const r = await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}`);
  const xml = await r.text(); await settle();
  assert.equal(r.status, 200);
  assert.equal((xml.match(/<Urun>/g) || []).length, 1);
  assert.ok(xml.trimEnd().endsWith('</Urunler>'));
});

test('"Dönüştür" notes the conversion and the answer carries the status', async () => {
  supplier.products = [prod(1), prod(2)];
  supplier.headers = { 'last-modified': 'Thu, 12 Nov 2026 01:50:01 GMT' };
  const r = await fetch(`${base}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'tedarikci.example.invalid/export.xml' }) });
  const d = await r.json();
  assert.equal(d.success, true);
  assert.equal(d.totalProducts, 2);
  assert.ok(d.feed && d.feed.convertedAt, 'status of the address is in the answer');
  assert.equal(d.feed.productCount, 2);
  assert.equal(d.feed.servedAt, null, 'nobody has pulled the proxy yet');
  assert.equal(new Date(d.feed.sourceModifiedAt).toISOString(), '2026-11-12T01:50:01.000Z');
  // the address typed without https:// and the one in the proxy link are the same row
  assert.ok(row('https://tedarikci.example.invalid/export.xml'));
  await fetch(`${base}/proxy?url=${encodeURIComponent('https://tedarikci.example.invalid/export.xml')}`).then((x) => x.text()); await settle();
  assert.equal(rows.size, 1);
  assert.ok(row().servedAt && row().convertedAt, 'one row has both times');
});

test('the status route answers per address as typed, null for unknown ones, and only for the addresses sent', async () => {
  supplier.products = [prod(1)];
  await fetch(`${base}/proxy?url=${encodeURIComponent(SUP)}`).then((x) => x.text()); await settle();
  rows.set(feeds.urlHash('https://baska-tedarikci.example.invalid/a.xml'), { urlHash: 'x', productCount: 9, servedAt: new Date(), servedOk: true });
  const r = await fetch(`${base}/feeds/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: [SUP, 'tedarikci.example.invalid/export.xml', 'https://yok.example.invalid/z.xml', '', 5, SUP] }) });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(d.feeds).sort(), ['https://tedarikci.example.invalid/export.xml', 'https://yok.example.invalid/z.xml', 'tedarikci.example.invalid/export.xml']);
  assert.equal(d.feeds[SUP].productCount, 1);
  assert.equal(d.feeds['tedarikci.example.invalid/export.xml'].productCount, 1, 'same row as the https:// form');
  assert.equal(d.feeds['https://yok.example.invalid/z.xml'], null);
  assert.ok(!JSON.stringify(d).includes('urlHash'), 'no internals in the answer');
  const empty = await fetch(`${base}/feeds/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json());
  assert.deepEqual(empty, { feeds: {} });
});

test('the status route looks up at most 50 addresses', async () => {
  const urls = Array.from({ length: 80 }, (_, i) => `https://t${i}.example.invalid/x.xml`);
  const d = await fetch(`${base}/feeds/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) }).then((x) => x.json());
  assert.equal(Object.keys(d.feeds).length, 50);
});
