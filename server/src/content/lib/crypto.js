const crypto = require('node:crypto');
const { env } = require('../env');

/**
 * API keys and other secrets are stored encrypted (AES-256-GCM) with CONTENT_ENCRYPTION_KEY (64 hex characters, its OWN key: not the ModulPOS one).
 * Format: enc:v1:<iv>:<tag>:<ciphertext> (base64). Without the key nothing can be stored or read: that is an error, never a silent plain-text fallback.
 */
const PREFIX = 'enc:v1:';

function key() {
  const k = env().encryptionKey;
  if (!k) throw Object.assign(new Error('CONTENT_ENCRYPTION_KEY tanımlı değil (64 onaltılık karakter). Anahtarlar bu olmadan saklanamaz.'), { status: 503 });
  return Buffer.from(k, 'hex');
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${PREFIX}${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(blob) {
  if (typeof blob !== 'string' || !blob.startsWith(PREFIX)) throw new Error('Şifreli değer okunamadı');
  const [iv, tag, ct] = blob.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** The last 4 characters, the only part of a secret the panel may ever show. */
const last4 = (s) => String(s || '').slice(-4);

module.exports = { encrypt, decrypt, last4, PREFIX };
