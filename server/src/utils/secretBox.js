const crypto = require('crypto');

// AES-256-GCM envelope for secrets stored in the database.
// Format: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>
// Values without the prefix are treated as legacy plaintext, so rollout is gradual.
const PREFIX = 'enc:v1:';

function keyFrom(name) {
  const hex = process.env[name] || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

const getKey = () => keyFrom('ENCRYPTION_KEY');
// During a rotation the old key stays available for reading: set ENCRYPTION_KEY_PREVIOUS, run
// scripts/rotateEncryptionKey.js, then remove it.
const getPreviousKey = () => keyFrom('ENCRYPTION_KEY_PREVIOUS');

function isEncrypted(v) {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '' || isEncrypted(plain)) return plain;
  const key = getKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('ENCRYPTION_KEY is not configured');
    return plain; // dev without a key: keep plaintext
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(value) {
  if (!isEncrypted(value)) return value; // legacy plaintext or empty
  const [iv, tag, ct] = value.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
  const tryKey = (key) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  };
  const key = getKey();
  if (!key) throw new Error('ENCRYPTION_KEY is required to read encrypted values');
  try {
    return tryKey(key);
  } catch (err) {
    const prev = getPreviousKey();
    if (!prev) throw err;
    return tryKey(prev); // value still encrypted with the previous key
  }
}

module.exports = { encrypt, decrypt, isEncrypted };
