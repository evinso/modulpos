const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../src/services/hostedImages');

// ── a tiny in-memory database with just the calls the service makes ────────────────────────────────────────
function world() {
  const uploads = []; const products = new Map(); const listed = new Set();   // listed: product ids that are on the marketplace (sent)
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const matches = (r, where = {}) => Object.entries(where).every(([k, w]) => {
    if (k === 'OR') return w.some((alt) => matches(r, alt));
    if (k === 'product') return listed.has(r.productId);          // product.marketplaceProducts.some(...)
    const v = r[k];
    if (w && typeof w === 'object' && !(w instanceof Date)) {
      if ('in' in w) return w.in.includes(v);
      if ('notIn' in w) return !w.notIn.includes(v);
      if ('not' in w) return v !== w.not;
      if ('lt' in w) return v < w.lt;
    }
    return v === w;
  });
  const prisma = {
    productImageUpload: {
      async count({ where }) { return uploads.filter((r) => matches(r, where)).length; },
      async aggregate({ where }) { return { _sum: { size: uploads.filter((r) => matches(r, where)).reduce((t, r) => t + r.size, 0) } }; },
      async create({ data }) { const r = { id: uuid(), productId: null, createdAt: new Date(), ...data }; uploads.push(r); return { id: r.id }; },
      async deleteMany({ where }) { const hit = uploads.filter((r) => matches(r, where)); hit.forEach((r) => uploads.splice(uploads.indexOf(r), 1)); return { count: hit.length }; },
      async updateMany({ where, data }) { const hit = uploads.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
      async findMany({ where, take }) { const seen = new Set(); return uploads.filter((r) => matches(r, where)).filter((r) => (seen.has(r.productId) ? false : seen.add(r.productId))).slice(0, take).map((r) => ({ productId: r.productId })); },
    },
    product: {
      async findMany({ where }) { return [...products.values()].filter((p) => where.id.in.includes(p.id)); },
      async update({ where, data }) { Object.assign(products.get(where.id), data); return products.get(where.id); },
    },
  };
  return { prisma, uploads, products, listed };
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(30, 3)]);
const b64 = (b) => b.toString('base64');
const OURS = (id, ext = 'jpg') => `https://api.modulpos.com/api/uploads/${id}.${ext}`;

test('the first bytes decide what a file is: jpg, png and webp only', () => {
  assert.deepEqual(H.sniff(JPEG), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(H.sniff(PNG), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(H.sniff(WEBP), { mime: 'image/webp', ext: 'webp' });
  assert.equal(H.sniff(Buffer.from('GIF89a......................')), null);
  assert.equal(H.sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null, 'an SVG (can carry script) is refused');
  assert.equal(H.sniff(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(H.sniff(Buffer.alloc(5)), null);
});

test('base64 text, plain or as a data: address; garbage is refused', () => {
  assert.deepEqual(H.decodeBase64(b64(JPEG)), JPEG);
  assert.deepEqual(H.decodeBase64(`data:image/jpeg;base64,${b64(JPEG)}`), JPEG);
  assert.deepEqual(H.decodeBase64(b64(JPEG).replace(/(.{20})/g, '$1\n')), JPEG, 'line breaks inside are fine');
  assert.equal(H.decodeBase64('not base64 !!'), null);
  assert.equal(H.decodeBase64(''), null); assert.equal(H.decodeBase64(undefined), null);
});

test('save: stores the bytes and answers with a public address on the API host', async () => {
  const w = world();
  const r = await H.save(w.prisma, 'st1', b64(PNG), 'https://api.modulpos.com/');
  assert.equal(r.ext, 'png'); assert.equal(r.size, PNG.length);
  assert.equal(r.url, `https://api.modulpos.com/api/uploads/${r.id}.png`);
  assert.equal(w.uploads.length, 1); assert.equal(w.uploads[0].storeId, 'st1'); assert.equal(w.uploads[0].productId, null); assert.equal(w.uploads[0].mime, 'image/png');
  assert.deepEqual(H.hostedIn([r.url]), [{ id: r.id, ext: 'png' }]);
});

test('save: refuses what is not a picture, is too big, or would fill the store', async () => {
  const w = world();
  await assert.rejects(H.save(w.prisma, 's', b64(Buffer.from('<svg></svg>........')), 'https://x'), (e) => e.status === 400 && /JPG, PNG ya da WebP/.test(e.message));
  await assert.rejects(H.save(w.prisma, 's', '%%%', 'https://x'), (e) => e.status === 400 && /okunamadı/.test(e.message));
  await assert.rejects(H.save(w.prisma, 's', b64(Buffer.concat([JPEG, Buffer.alloc(H.MAX_BYTES)])), 'https://x'), (e) => e.status === 413 && /çok büyük/.test(e.message));
  for (let i = 0; i < H.MAX_UNUSED; i++) await H.save(w.prisma, 's', b64(JPEG), 'https://x');
  await assert.rejects(H.save(w.prisma, 's', b64(JPEG), 'https://x'), (e) => e.status === 429 && /Kullanılmamış/.test(e.message));
  const other = await H.save(w.prisma, 'other-store', b64(JPEG), 'https://x');
  assert.ok(other.id, 'another store has its own allowance');
  const big = world();
  big.uploads.push({ id: 'x', storeId: 's', productId: 'p', size: H.MAX_STORE_BYTES - 10, createdAt: new Date() });
  await assert.rejects(H.save(big.prisma, 's', b64(JPEG), 'https://x'), (e) => e.status === 429 && /alanı doldu/.test(e.message));
});

test('hostedIn: only our address shape counts, on any host, with a query string too', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(H.hostedIn([OURS(id), `http://localhost:3001/api/uploads/${id.toUpperCase()}.PNG?x=1`, 'https://cdn.dsmcdn.com/a.jpg', 'https://x/api/uploads/not-an-id.jpg', null, 42]),
    [{ id, ext: 'jpg' }, { id, ext: 'png' }]);
  assert.equal(H.isHosted(OURS(id)), true); assert.equal(H.isHosted('https://cdn.dsmcdn.com/a.jpg'), false);
});

test('attach: the product takes the uploads in its list, drops the ones it no longer lists, never takes another store\'s', async () => {
  const w = world();
  const a = await H.save(w.prisma, 'st1', b64(JPEG), 'https://h'); const b = await H.save(w.prisma, 'st1', b64(PNG), 'https://h');
  const foreign = await H.save(w.prisma, 'st2', b64(JPEG), 'https://h');
  await H.attach(w.prisma, 'st1', 'p1', [a.url, b.url, foreign.url, 'https://example.com/link.jpg']);
  const by = (id) => w.uploads.find((u) => u.id === id);
  assert.equal(by(a.id).productId, 'p1'); assert.equal(by(b.id).productId, 'p1');
  assert.equal(by(foreign.id).productId, null, 'another store\'s upload is not taken');
  await H.attach(w.prisma, 'st1', 'p1', [a.url]);                                  // the owner removed picture b from the product
  assert.equal(w.uploads.some((u) => u.id === b.id), false, 'a removed picture is deleted');
  assert.equal(by(a.id).productId, 'p1');
  const c = await H.save(w.prisma, 'st1', b64(JPEG), 'https://h');
  await H.attach(w.prisma, 'st1', 'p2', [a.url, c.url]);
  assert.equal(by(a.id).productId, 'p1', 'an upload of another product stays with that product'); assert.equal(by(c.id).productId, 'p2');
  await H.attach(w.prisma, 'st1', 'p2', []);
  assert.equal(w.uploads.some((u) => u.id === c.id), false, 'no pictures left: all of its uploads go');
});

test('purgeOrphans: only unused uploads older than a day', async () => {
  const w = world(); const now = Date.now();
  w.uploads.push({ id: 'old-free', productId: null, createdAt: new Date(now - H.ORPHAN_AFTER_MS - 1000) },
    { id: 'new-free', productId: null, createdAt: new Date(now - 1000) },
    { id: 'old-used', productId: 'p', createdAt: new Date(now - 5 * H.ORPHAN_AFTER_MS) });
  assert.equal(await H.purgeOrphans(w.prisma, now), 1);
  assert.deepEqual(w.uploads.map((u) => u.id), ['new-free', 'old-used']);
});

// ── after the marketplace has the pictures ───────────────────────────────────────────────────────────────────
const CDN = (n) => `https://cdn.dsmcdn.com/ty1/product/media/images/${n}.jpg`;
function sent(w, { barcode = '869100', ours = 2, links = 1 } = {}) {
  const mine = [];
  for (let i = 0; i < ours; i++) { const id = `aaaaaaaa-0000-4000-8000-00000000000${i}`; w.uploads.push({ id, storeId: 'st1', productId: 'p1', ext: 'jpg', size: 10, createdAt: new Date() }); mine.push(OURS(id)); }
  for (let i = 0; i < links; i++) mine.push(`https://example.com/link${i}.jpg`);
  w.products.set('p1', { id: 'p1', barcode, sku: 'EL-1', images: JSON.stringify(mine) });
  w.listed.add('p1');
  return mine;
}
const svc = (answers) => { const calls = []; return { calls, async getProducts(page, size, approved, codes) { calls.push({ approved, codes }); return { content: answers[approved ? 'approved' : 'pending'] || [] }; } }; };

test('release: the marketplace shows its own addresses for all pictures -> the product keeps those, our copies are deleted', async () => {
  const w = world(); sent(w);
  const service = svc({ approved: [{ barcode: '869100', images: [{ url: CDN(1) }, { url: CDN(2) }, { url: CDN(3) }] }] });
  const r = await H.releaseSent(w.prisma, { id: 'c1' }, service);
  assert.deepEqual(r, { checked: 1, released: 1, kept: 0 });
  assert.deepEqual(JSON.parse(w.products.get('p1').images), [CDN(1), CDN(2), CDN(3)]);
  assert.equal(w.uploads.length, 0, 'nothing of it stays on our server');
  assert.deepEqual(service.calls.map((c) => c.approved), [true, false], 'asked for approved and not-yet-approved products');
});

test('release: a product the marketplace has not downloaded yet keeps its uploads (still our addresses, fewer pictures, none, or not found)', async () => {
  for (const [label, answers] of [
    ['still our addresses', { pending: [{ barcode: '869100', images: [{ url: OURS('aaaaaaaa-0000-4000-8000-000000000000') }, { url: CDN(2) }, { url: CDN(3) }] }] }],
    ['fewer pictures than ours', { approved: [{ barcode: '869100', images: [{ url: CDN(1) }, { url: CDN(2) }] }] }],
    ['no pictures in the answer', { approved: [{ barcode: '869100' }] }],
    ['not found at all', {}],
  ]) {
    const w = world(); sent(w);
    const r = await H.releaseSent(w.prisma, { id: 'c1' }, svc(answers));
    assert.equal(r.released, 0, label); assert.equal(r.kept, 1, label);
    assert.equal(w.uploads.length, 2, `${label}: the uploads are still there`);
    assert.equal(JSON.parse(w.products.get('p1').images).length, 3, `${label}: the product is untouched`);
  }
});

test('release: the stock code is matched too, string addresses are understood, and at most 8 pictures are expected', async () => {
  const w = world(); sent(w, { ours: 2, links: 8 });                      // 10 pictures of ours; the marketplace keeps 8
  const eight = Array.from({ length: 8 }, (_, i) => CDN(i));
  const r = await H.releaseSent(w.prisma, { id: 'c1' }, svc({ pending: [{ stockCode: 'EL-1', images: eight }] }));
  assert.equal(r.released, 1);
  assert.deepEqual(JSON.parse(w.products.get('p1').images), eight);
});

test('release: products that are not on the marketplace (or have no uploads) are not even asked about', async () => {
  const w = world(); sent(w); w.listed.clear();                           // never sent / rejected
  const service = svc({ approved: [{ barcode: '869100', images: [{ url: CDN(1) }] }] });
  const r = await H.releaseSent(w.prisma, { id: 'c1' }, service);
  assert.deepEqual(r, { checked: 0, released: 0, kept: 0 });
  assert.equal(service.calls.length, 0, 'no marketplace call without a candidate'); assert.equal(w.uploads.length, 2);
});

test('releaseAll: one failing connection does not stop the others', async () => {
  const w = world(); sent(w);
  w.prisma.marketplaceConnection = { findMany: async () => [{ id: 'bad' }, { id: 'good' }] };
  const logs = [];
  const total = await H.releaseAll(w.prisma, (conn) => (conn.id === 'bad'
    ? { getProducts: async () => { throw new Error('unauthorized'); } }
    : svc({ approved: [{ barcode: '869100', images: [{ url: CDN(1) }, { url: CDN(2) }, { url: CDN(3) }] }] })), (m) => logs.push(m));
  assert.equal(total.released, 1);
  assert.ok(logs.some((m) => /unauthorized/.test(m)));
});
