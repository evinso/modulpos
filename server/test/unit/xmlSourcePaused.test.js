const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// A passive XML source is never pulled or updated: the shared sync entry (manual button AND schedule) refuses it before anything is read or written.
const src = (p) => path.join(__dirname, '../../src', p);
const stub = (file, exports) => { const f = require.resolve(file); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const calls = [];
const state = { source: null, activeQuery: null };
const note = (name) => (...a) => { calls.push([name, ...a]); throw new Error(`${name} must not be called for a passive source`); };
stub(src('config/database.js'), {
  xmlSource: {
    findUnique: async () => state.source,
    findMany: async (args) => { state.activeQuery = args; return []; },
    update: note('xmlSource.update'), updateMany: note('xmlSource.updateMany'),
  },
  syncLog: { findMany: note('syncLog.findMany'), findFirst: note('syncLog.findFirst'), create: note('syncLog.create'), update: note('syncLog.update'), updateMany: note('syncLog.updateMany') },
  product: { findMany: note('product.findMany'), createMany: note('product.createMany'), updateMany: note('product.updateMany') },
});
const { startXmlSync } = require(src('services/xml/syncService'));

test('a passive source is refused by the sync entry with a clear 409 and nothing is read or written', async () => {
  state.source = { id: 's1', storeId: 'st1', name: 'Tedarikçi', status: 'paused', url: 'https://example.invalid/x.xml' };
  for (const trigger of ['manual', 'cron']) {
    await assert.rejects(startXmlSync('s1', { trigger }), (e) => e.code === 'SOURCE_PAUSED' && e.status === 409 && /pasif/.test(e.message) && /Aktif yap/.test(e.message));
  }
  assert.deepEqual(calls, [], 'no sync log, no product, no source row was touched');
});

test('an unknown source is still a 404 (the passive check does not hide it)', async () => {
  state.source = null;
  await assert.rejects(startXmlSync('nope'), (e) => e.status === 404);
});
