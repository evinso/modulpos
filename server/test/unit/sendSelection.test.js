const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFilters, pickSendable } = require('../../src/routes/marketplaceList');

const row = (id, ready, mpStatus = null, issues = []) => ({ id, ready, mpStatus, issues });
const rows = [
  row('a', true), row('b', true), row('c', false, null, [{ code: 'no_category_mapping' }]),
  row('d', true, 'active'), row('e', true, 'pending'), row('f', true, 'rejected'), row('g', false, 'passive'),
];
const ids = (r) => r.map((x) => x.id);

test('"never sent" filter keeps only products without a marketplace record', () => {
  assert.deepEqual(ids(applyFilters(rows, { mpStatus: 'not_sent' })), ['a', 'b', 'c']);
});

test('ready / blocked / issue / status filters combine', () => {
  assert.deepEqual(ids(applyFilters(rows, { readiness: 'ready', mpStatus: 'not_sent' })), ['a', 'b']);
  assert.deepEqual(ids(applyFilters(rows, { readiness: 'blocked' })), ['c', 'g']);
  assert.deepEqual(ids(applyFilters(rows, { issue: 'no_category_mapping' })), ['c']);
  assert.deepEqual(ids(applyFilters(rows, { mpStatus: 'rejected' })), ['f']);
  assert.equal(applyFilters(rows, {}).length, 7);
});

test('"select all" takes only what can be sent now: ready AND never sent', () => {
  // even with no status filter, products already on the marketplace (active/pending/rejected) are not selected
  assert.deepEqual(ids(pickSendable(applyFilters(rows, {}))), ['a', 'b']);
  assert.deepEqual(ids(pickSendable(applyFilters(rows, { mpStatus: 'not_sent' }))), ['a', 'b']);
  assert.deepEqual(ids(pickSendable(applyFilters(rows, { mpStatus: 'active' }))), []);
});
