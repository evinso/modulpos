const crypto = require('crypto');
const prisma = require('../../config/database');

/**
 * "When was this converted XML last updated?" for the XML converter page.
 *
 * The converter is a live proxy: every pull of the proxy address reads the supplier's XML and converts it on the spot, nothing
 * is stored. So the only thing worth remembering is WHEN it was last produced and what came out. One row per supplier address
 * (table XmlConverterFeed, found by the hash of the address; the address itself is not stored). Recording never breaks the
 * conversion: every write here is best effort.
 */

/** The address the way the converter uses it (https:// is added when missing). */
function normalizeUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

const urlHash = (url) => crypto.createHash('sha256').update(normalizeUrl(url)).digest('hex');

/** A "Last-Modified" header as a Date; null when it is missing, unreadable or in the future (a wrong clock must not be shown as a fact). */
function parseHttpDate(value, now = Date.now()) {
  if (!value) return null;
  const d = new Date(String(Array.isArray(value) ? value[0] : value));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > now + 24 * 60 * 60 * 1000) return null;
  return d;
}

/** What the page gets for one row. */
function publicFeed(row) {
  if (!row) return null;
  return {
    productCount: row.productCount ?? null,
    convertedAt: row.convertedAt || null,
    servedAt: row.servedAt || null,
    servedOk: row.servedOk ?? null,
    servedError: row.servedError || null,
    sourceModifiedAt: row.sourceModifiedAt || null,
  };
}

/** Creates or updates the row of an address. Never throws. */
async function recordFeed(url, patch) {
  try {
    const hash = urlHash(url);
    if (!normalizeUrl(url)) return;
    await prisma.xmlConverterFeed.upsert({ where: { urlHash: hash }, create: { urlHash: hash, ...patch }, update: patch });
  } catch (e) {
    console.warn('[xml-converter] could not record the feed:', e.message);
  }
}

/** Notes the outcome of one production of the converted XML (proxy pull or download). */
function recordServed(url, { count = 0, modified = null, error = null } = {}) {
  const at = new Date();
  if (error) return recordFeed(url, { servedAt: at, servedOk: false, servedError: String(error).slice(0, 300) });
  if (count === 0) return recordFeed(url, { servedAt: at, servedOk: false, servedError: 'Kaynakta ürün bulunamadı', productCount: 0, sourceModifiedAt: modified });
  return recordFeed(url, { servedAt: at, servedOk: true, servedError: null, productCount: count, sourceModifiedAt: modified });
}

/** Notes a "Dönüştür" on the page (the preview has just read the whole feed). */
function recordConverted(url, { count, modified = null } = {}) {
  return recordFeed(url, { convertedAt: new Date(), productCount: count, sourceModifiedAt: modified });
}

/** { [address as sent]: public row or null } for up to `max` addresses. Only addresses the caller sends are looked up. */
async function statusFor(urls, max = 50) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u.trim()).map((u) => u.slice(0, 2000)))].slice(0, max);
  const out = {};
  if (list.length === 0) return out;
  const hashes = list.map(urlHash);
  const rows = await prisma.xmlConverterFeed.findMany({ where: { urlHash: { in: hashes } } });
  const byHash = new Map(rows.map((r) => [r.urlHash, r]));
  list.forEach((u, i) => { out[u] = publicFeed(byHash.get(hashes[i])); });
  return out;
}

module.exports = { normalizeUrl, urlHash, parseHttpDate, publicFeed, recordFeed, recordServed, recordConverted, statusFor };
