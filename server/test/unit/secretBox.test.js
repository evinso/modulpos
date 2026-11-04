const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const load = () => { delete require.cache[require.resolve('../../src/utils/secretBox')]; return require('../../src/utils/secretBox'); };
const key = () => crypto.randomBytes(32).toString('hex');

test('encrypt/decrypt round trip and legacy plaintext passthrough', () => {
  process.env.ENCRYPTION_KEY = key();
  const sb = load();
  const c = sb.encrypt('secret-value');
  assert.ok(c.startsWith('enc:v1:')); assert.notEqual(c, 'secret-value');
  assert.equal(sb.decrypt(c), 'secret-value');
  assert.equal(sb.decrypt('plain'), 'plain');
  assert.equal(sb.encrypt(c), c); // already encrypted -> untouched
});
test('key rotation: previous key keeps old values readable', () => {
  const oldKey = key(), newKey = key();
  process.env.ENCRYPTION_KEY = oldKey; delete process.env.ENCRYPTION_KEY_PREVIOUS;
  const ct = load().encrypt('abc');
  process.env.ENCRYPTION_KEY = newKey;
  assert.throws(() => load().decrypt(ct));
  process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
  const sb = load();
  assert.equal(sb.decrypt(ct), 'abc');
  assert.equal(sb.decrypt(sb.encrypt(sb.decrypt(ct))), 'abc');
});
test('tampered ciphertext is rejected', () => {
  process.env.ENCRYPTION_KEY = key(); delete process.env.ENCRYPTION_KEY_PREVIOUS;
  const sb = load();
  const c = sb.encrypt('abc');
  const bad = c.slice(0, -4) + (c.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.throws(() => sb.decrypt(bad));
});
