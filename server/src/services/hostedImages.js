/**
 * Pictures the owner UPLOADED for a product added by hand (Ürünler > Yeni ürün).
 *
 * The free hosting has no disk, so a picture lives in table ProductImageUpload (bytes in the database) and is served from a public
 * address (routes/uploads.js, /api/uploads/<id>.<jpg|png|webp>) because the marketplace has to download it from there.
 * It is only a loan: once the marketplace has the picture on ITS OWN servers, ours is deleted (releaseSent) and the product keeps the
 * marketplace's addresses instead. Pictures that no product ever used are removed after a day (purgeOrphans).
 *
 * Nothing is deleted before the marketplace shows its own address for the product: a picture it has not downloaded yet must stay reachable.
 */

const MAX_BYTES = 3.5 * 1024 * 1024;           // one picture (the page shrinks photos before uploading)
const MAX_STORE_BYTES = 120 * 1024 * 1024;     // everything a store has on loan (the database is small)
const MAX_UNUSED = 40;                         // uploaded but not yet used by a saved product
const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;
const MARKETPLACE_MAX_IMAGES = 8;              // Trendyol keeps at most 8 pictures of a product

const PATH_RE = /\/api\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)(?:[?#].*)?$/i;

/** What the first bytes say the file is (never trust the name or the declared type). */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** Base64 text (plain or a data: URL) -> bytes, or null when it is not base64. */
function decodeBase64(text) {
  const s = String(text || '').replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
  if (!s || s.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  return Buffer.from(s, 'base64');
}

const hostedPath = (id, ext) => `/api/uploads/${id}.${ext}`;

/** The uploads a list of picture addresses points to: [{ id, ext }] (any host: only our path shape counts). */
function hostedIn(images) {
  const out = [];
  for (const u of Array.isArray(images) ? images : []) {
    const m = PATH_RE.exec(String(u || ''));
    if (m) out.push({ id: m[1].toLowerCase(), ext: m[2].toLowerCase() });
  }
  return out;
}
const isHosted = (url) => PATH_RE.test(String(url || ''));

const parseList = (text) => { try { const v = typeof text === 'string' ? JSON.parse(text) : text; return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };

/**
 * Stores one uploaded picture. @returns { id, ext, size, url } or throws an Error with `status` and a sentence for the owner.
 * `base` = the public address of this API ("https://api.modulpos.com").
 */
async function save(prisma, storeId, base64, base) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const buf = decodeBase64(base64);
  if (!buf) throw fail(400, 'Fotoğraf okunamadı');
  if (buf.length > MAX_BYTES) throw fail(413, `Fotoğraf çok büyük (en fazla ${Math.round(MAX_BYTES / 1024 / 1024 * 10) / 10} MB). Daha küçük bir fotoğraf seçin.`);
  const kind = sniff(buf);
  if (!kind) throw fail(400, 'Yalnızca JPG, PNG ya da WebP fotoğraf yüklenebilir');

  const [unused, total] = await Promise.all([
    prisma.productImageUpload.count({ where: { storeId, productId: null } }),
    prisma.productImageUpload.aggregate({ where: { storeId }, _sum: { size: true } }),
  ]);
  if (unused >= MAX_UNUSED) throw fail(429, 'Kullanılmamış çok fazla yüklenmiş fotoğraf var. Ürünü kaydedin ya da bir gün bekleyin, kullanılmayanlar kendiliğinden silinir.');
  if (((total._sum && total._sum.size) || 0) + buf.length > MAX_STORE_BYTES) throw fail(429, 'Sunucudaki geçici fotoğraf alanı doldu. Trendyol’a gönderilen ürünlerin fotoğrafları kabul edilince silinir; biraz sonra tekrar deneyin.');

  const row = await prisma.productImageUpload.create({ data: { storeId, mime: kind.mime, ext: kind.ext, size: buf.length, data: buf }, select: { id: true } });
  return { id: row.id, ext: kind.ext, size: buf.length, url: `${String(base).replace(/\/+$/, '')}${hostedPath(row.id, kind.ext)}` };
}

/**
 * A product was saved with these pictures: the uploads in the list now belong to it; uploads of this product that are no longer in the
 * list (the owner removed them) are deleted. An upload of another store is never taken.
 */
async function attach(prisma, storeId, productId, images) {
  const ids = hostedIn(images).map((x) => x.id);
  await prisma.productImageUpload.deleteMany({ where: { productId, id: { notIn: ids } } });
  if (ids.length) {
    await prisma.productImageUpload.updateMany({ where: { id: { in: ids }, storeId, OR: [{ productId: null }, { productId }] }, data: { productId } });
  }
}

/** Uploads no saved product ever used, older than a day. */
async function purgeOrphans(prisma, now = Date.now()) {
  const r = await prisma.productImageUpload.deleteMany({ where: { productId: null, createdAt: { lt: new Date(now - ORPHAN_AFTER_MS) } } });
  return r.count;
}

/** The addresses the marketplace shows for one of its products (strings, whatever shape the answer has). */
function marketplaceImages(tp) {
  const raw = tp && Array.isArray(tp.images) ? tp.images : [];
  return raw.map((i) => (typeof i === 'string' ? i : (i && (i.url || i.imageUrl || i.imageurl)) || '')).filter((u) => /^https?:\/\//i.test(u));
}

/**
 * For the products of this marketplace connection that are on the marketplace (sent: waiting or listed) and still carry pictures that
 * live on OUR server: ask the marketplace for them. When it shows its own addresses for ALL pictures (none of them ours), the product
 * keeps those addresses and our copies are deleted. Anything else is left alone and tried again next time.
 * @param service a TrendyolService (getProducts(page, size, approved, barcodes))
 * @returns { checked, released, kept }
 */
async function releaseSent(prisma, connection, service, { limit = 30, log = () => {} } = {}) {
  const rows = await prisma.productImageUpload.findMany({
    where: { productId: { not: null }, product: { marketplaceProducts: { some: { connectionId: connection.id, status: { in: ['pending', 'active'] } } } } },
    select: { productId: true }, distinct: ['productId'], take: limit,
  });
  const ids = rows.map((r) => r.productId);
  const out = { checked: ids.length, released: 0, kept: 0 };
  if (ids.length === 0) return out;

  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, barcode: true, sku: true, images: true } });
  const codes = [...new Set(products.map((p) => p.barcode || p.sku).filter(Boolean))];
  const found = new Map();
  for (const approved of [true, false]) {
    const res = await service.getProducts(0, 50, approved, codes);
    for (const tp of (res && res.content) || []) {
      for (const key of [tp.barcode, tp.stockCode]) if (key && !found.has(key)) found.set(key, tp);
    }
  }
  for (const p of products) {
    const tp = found.get(p.barcode) || found.get(p.sku);
    const theirs = marketplaceImages(tp);
    const own = parseList(p.images);
    const need = Math.min(own.length, MARKETPLACE_MAX_IMAGES);
    if (!tp || theirs.length === 0 || theirs.some(isHosted) || theirs.length < need) { out.kept++; continue; }   // not (fully) on the marketplace's servers yet
    await prisma.product.update({ where: { id: p.id }, data: { images: JSON.stringify(theirs) } });
    const gone = await prisma.productImageUpload.deleteMany({ where: { productId: p.id } });
    out.released++;
    log(`${p.barcode || p.sku}: ${gone.count} fotoğraf sunucudan silindi (Trendyol kendi adreslerini gösteriyor)`);
  }
  return out;
}

/** Every Trendyol connection of the shop: release what can be released (used by the schedule). */
async function releaseAll(prisma, makeService, log = () => {}) {
  const conns = await prisma.marketplaceConnection.findMany({ where: { marketplaceType: 'trendyol', status: 'active' } });
  const total = { checked: 0, released: 0, kept: 0 };
  for (const connection of conns) {
    try {
      const r = await releaseSent(prisma, connection, makeService(connection), { log });
      total.checked += r.checked; total.released += r.released; total.kept += r.kept;
    } catch (err) { log(`bağlantı ${String(connection.id).slice(0, 8)}: ${err && err.message}`); }
  }
  return total;
}

module.exports = {
  save, attach, purgeOrphans, releaseSent, releaseAll, hostedIn, isHosted, sniff, decodeBase64, marketplaceImages, hostedPath,
  MAX_BYTES, MAX_STORE_BYTES, MAX_UNUSED, ORPHAN_AFTER_MS, MARKETPLACE_MAX_IMAGES,
};
