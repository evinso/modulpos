const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { env } = require('../env');

/**
 * Fetching addresses that a person typed in (RSS sources, ...) from our server is a classic SSRF risk. This is the ONLY way the content module reads
 * an address it did not write itself:
 *  - only http(s), no user:password in the address, only ports 80/443/8080/8443
 *  - the name is resolved at CONNECT time and every resulting address must be public (loopback, private, link-local, metadata, CGNAT ... are refused),
 *    so a redirect or a DNS answer that changes between a check and the request cannot reach the inside network
 *  - redirects are followed by hand (max 4), each one checked the same way
 *  - time limit, size limit (also for decompressed data), identifying User-Agent, conditional requests (ETag / Last-Modified)
 */
const UA = 'ModulPOSContentBot/0.1 (+https://content.modulpos.com; headline reader, respects rate limits)';

class FetchError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'FetchError'; this.code = code; Object.assign(this, extra); }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    // reserved ranges only: 192.0.0.0/24 (IETF) and the three documentation nets are NOT the whole of 192.0.x.x (192.0.64.0/18 is a public WordPress.com range)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return /^(fc|fd|fe[89ab]|ff)/.test(v);
  }
  return true;
}

const allowPrivate = () => env().allowPrivateFetch;      // tests only (never in production)

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!allowPrivate() && addresses.some((a) => isPrivateIp(a.address))) return callback(new FetchError('ssrf', 'Bu adrese erişim izni yok (iç ağ adresi)'));
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new FetchError('url', 'Adres geçerli değil'); }
  if (!/^https?:$/.test(u.protocol)) throw new FetchError('url', 'Yalnızca http ve https adreslerine izin verilir');
  if (u.username || u.password) throw new FetchError('url', 'Adreste kullanıcı adı/şifre olamaz');
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (!allowPrivate() && ![80, 443, 8080, 8443].includes(port)) throw new FetchError('url', 'Bu bağlantı noktasına izin verilmez');
  if (!allowPrivate() && net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, ''))) throw new FetchError('ssrf', 'Bu adrese erişim izni yok (iç ağ adresi)');
  return u;
}

function once(url, { timeoutMs, maxBytes, headers }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', lookup: guardedLookup, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5', 'Accept-Encoding': 'gzip, deflate, br', ...headers }, timeout: timeoutMs }, (res) => {
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = []; let size = 0; let finished = false;
      const fail = (e) => { if (!finished) { finished = true; req.destroy(); reject(e); } };
      stream.on('data', (c) => { size += c.length; if (size > maxBytes) return fail(new FetchError('too_large', `Yanıt ${Math.round(maxBytes / 1048576)} MB sınırını aşıyor`)); chunks.push(c); });
      stream.on('end', () => { if (!finished) { finished = true; resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); } });
      stream.on('error', (e) => fail(new FetchError('network', `Yanıt okunamadı: ${e.message}`)));
      res.on('error', (e) => fail(new FetchError('network', `Bağlantı koptu: ${e.message}`)));
    });
    req.on('timeout', () => { req.destroy(); reject(new FetchError('timeout', `Sunucu ${Math.round(timeoutMs / 1000)} saniyede cevap vermedi`)); });
    req.on('error', (e) => reject(e instanceof FetchError ? e : new FetchError('network', `Bağlanılamadı: ${e.code || e.message}`)));
    req.end();
  });
}

const retryAfterSeconds = (h) => { const v = h['retry-after']; if (!v) return null; const n = Number(v); if (Number.isFinite(n)) return Math.min(86400, Math.max(1, n)); const d = Date.parse(v); return Number.isNaN(d) ? null : Math.min(86400, Math.max(1, Math.round((d - Date.now()) / 1000))); };

/**
 * @returns { status, body, url (final), etag, lastModified, notModified }; throws FetchError(code: url | ssrf | timeout | too_large | network | redirect | http | rate_limited)
 */
async function fetchText(rawUrl, { timeoutMs = 15000, maxBytes = 4 * 1024 * 1024, etag, lastModified, headers = {} } = {}) {
  let url = checkUrl(rawUrl);
  const cond = { ...(etag ? { 'If-None-Match': etag } : {}), ...(lastModified ? { 'If-Modified-Since': lastModified } : {}) };
  for (let hop = 0; hop <= 4; hop++) {
    const res = await once(url, { timeoutMs, maxBytes, headers: { ...cond, ...headers } });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      if (hop === 4) throw new FetchError('redirect', 'Çok fazla yönlendirme');
      url = checkUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    if (res.status === 304) return { status: 304, body: '', url: url.toString(), etag, lastModified, notModified: true };
    if (res.status === 429 || res.status === 503) throw new FetchError('rate_limited', `Kaynak istek sınırı koydu (HTTP ${res.status})`, { status: res.status, retryAfterSec: retryAfterSeconds(res.headers) });
    if (res.status < 200 || res.status >= 300) throw new FetchError('http', `Kaynak HTTP ${res.status} döndürdü`, { status: res.status });
    return { status: res.status, body: res.body, url: url.toString(), etag: res.headers.etag || null, lastModified: res.headers['last-modified'] || null, notModified: false };
  }
  throw new FetchError('redirect', 'Çok fazla yönlendirme');
}

module.exports = { fetchText, FetchError, isPrivateIp, checkUrl, UA };
