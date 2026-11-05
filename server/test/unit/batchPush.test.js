const test = require('node:test');
const assert = require('node:assert/strict');
const { pushInBatches } = require('../../src/services/batchPush');

const list = (n) => Array.from({ length: n }, (_, i) => i);

test('up to one batch: a single request, exactly like before', async () => {
  const sent = [];
  const r = await pushInBatches(list(500), async (p) => { sent.push(p.length); return { batchRequestId: 'b' }; }, async () => {}, 500);
  assert.deepEqual(sent, [500]); assert.deepEqual(r, { sent: 500, failed: 0, error: null });
});

test('more than one batch: split in order, every item sent once, progress recorded per batch', async () => {
  const sent = [], recorded = [];
  const r = await pushInBatches(list(1203), async (p) => { sent.push([p[0], p.length]); return {}; }, async (start, p) => { recorded.push([start, p.length]); }, 500);
  assert.deepEqual(sent, [[0, 500], [500, 500], [1000, 203]]);
  assert.deepEqual(recorded, [[0, 500], [500, 500], [1000, 203]]);
  assert.equal(r.sent, 1203); assert.equal(r.failed, 0);
});

test('a failing batch stops the run, keeps the earlier progress and reports what is left', async () => {
  const recorded = []; let calls = 0;
  const boom = new Error('refused');
  const r = await pushInBatches(list(1200), async () => { calls++; if (calls === 2) throw boom; return {}; }, async (start, p) => { recorded.push([start, p.length]); }, 500);
  assert.deepEqual(recorded, [[0, 500]]);      // only the accepted batch was recorded
  assert.equal(r.sent, 500); assert.equal(r.failed, 700); assert.equal(r.error, boom); assert.equal(calls, 2);
});

test('a failure while recording also stops the run without throwing', async () => {
  const r = await pushInBatches(list(600), async () => ({}), async () => { throw new Error('db'); }, 500);
  assert.equal(r.sent, 0); assert.equal(r.failed, 600); assert.equal(r.error.message, 'db');
});

test('nothing to send', async () => {
  let called = false;
  const r = await pushInBatches([], async () => { called = true; }, async () => {});
  assert.equal(called, false); assert.deepEqual(r, { sent: 0, failed: 0, error: null });
});
