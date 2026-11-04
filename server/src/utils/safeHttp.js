const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

/** True for loopback, private, link-local, CGNAT, metadata and other non-public addresses. */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true;
}

function ssrfError(host) {
  const err = new Error(`Bu adrese erişim izni yok: ${host}`);
  err.code = 'ESSRF';
  err.status = 400;
  return err;
}

// DNS lookup that refuses non-public addresses. Runs on every connection, so it
// also covers redirects and DNS-rebinding between a check and the request.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (list.some(isPrivateIp)) return callback(ssrfError(hostname));
    callback(null, address, family);
  });
}

const httpAgent = new http.Agent({ lookup: guardedLookup });
const httpsAgent = new https.Agent({ lookup: guardedLookup });

/**
 * Axios options that make a request SSRF-safe. Usage:
 *   axios.get(url, { ...safeAxiosOptions(url), timeout: 30000 })
 * Throws for non-http(s) URLs and IP-literal hosts that are private.
 */
function safeAxiosOptions(url) {
  let u;
  try { u = new URL(url); } catch { const e = new Error('Geçersiz URL'); e.status = 400; throw e; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const e = new Error('Yalnızca http/https adreslerine izin verilir'); e.status = 400; throw e;
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || (net.isIP(host) && isPrivateIp(host))) throw ssrfError(host);
  return { httpAgent, httpsAgent, maxRedirects: 5 };
}

module.exports = { safeAxiosOptions, isPrivateIp };
