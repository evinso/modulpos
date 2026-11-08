const test = require('node:test');
const assert = require('node:assert');
const { installQuietSignal, isSessionDump } = require('../../src/services/whatsapp/quietSignal');

function fakeConsole() {
  const out = [];
  const c = {};
  for (const n of ['info', 'warn', 'log', 'error']) c[n] = (...a) => out.push([n, ...a]);
  return { c, out };
}

test('session dumps are dropped, other output passes', () => {
  const { c, out } = fakeConsole();
  installQuietSignal(c);
  c.info('Closing session:', { privKey: Buffer.from('secret') });
  c.info('Opening session:', { a: 1 });
  c.info('Removing old closed session:', {});
  c.warn('Session already closed', {});
  c.warn('Session already open');
  c.log('Migrating session to:', 1);
  c.info('[CRON] something');
  c.warn('Closing open session in favor of incoming prekey bundle');
  c.error('Closing session: still an error, never hidden');
  assert.deepStrictEqual(out.map((o) => o[1]), [
    '[CRON] something', 'Closing open session in favor of incoming prekey bundle', 'Closing session: still an error, never hidden',
  ]);
});

test('isSessionDump ignores non-strings', () => {
  assert.strictEqual(isSessionDump([{ x: 1 }]), false);
  assert.strictEqual(isSessionDump([]), false);
  assert.strictEqual(isSessionDump(['Closing session:']), true);
});
