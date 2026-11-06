const test = require('node:test');
const assert = require('node:assert/strict');
const { planVanished, describeVanished } = require('../../src/services/xml/vanished');

const rows = (n, stock = 5, prefix = 'S') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, sku: `${prefix}${i}`, stock }));
const feedOf = (list) => new Set(list.map((r) => r.sku));

test('a product that is not in the feed any more is zeroed, the others are left alone', () => {
  const all = rows(10);
  const seen = feedOf(all.slice(2));                          // S0 and S1 vanished
  const plan = planVanished(all, seen, seen.size, 0);
  assert.deepEqual(plan.zero.map((r) => r.id), ['S0', 'S1']);
  assert.equal(plan.held, 0); assert.equal(plan.reason, null);
});

test('products that are already at 0 are not touched again (no log noise, no marketplace push)', () => {
  const all = [...rows(5), { id: 'old', sku: 'old', stock: 0 }];
  const plan = planVanished(all, feedOf(rows(5)), 5, 0);
  assert.deepEqual(plan.zero, []); assert.equal(plan.held, 0);
});

test('nothing vanished -> nothing to do', () => {
  const all = rows(8);
  const plan = planVanished(all, feedOf(all), all.length, 0);
  assert.deepEqual(plan, { zero: [], held: 0, reason: null });
});

test('an empty feed never empties the shop', () => {
  const all = rows(8);
  const plan = planVanished(all, new Set(), 0, 0);
  assert.deepEqual(plan.zero, []); assert.equal(plan.held, 8); assert.equal(plan.reason, 'empty');
});

test('feed rows that failed to read: we cannot tell what is missing -> hold', () => {
  const all = rows(10);
  const plan = planVanished(all, feedOf(all.slice(1)), 9, 1);
  assert.deepEqual(plan.zero, []); assert.equal(plan.held, 1); assert.equal(plan.reason, 'errors');
});

test('a few vanished products out of many are processed (up to 25 are always fine)', () => {
  const all = rows(60);
  const seen = feedOf(all.slice(25));                          // 25 vanished = 42%, still processed: not above the count limit
  const plan = planVanished(all, seen, seen.size, 0);
  assert.equal(plan.zero.length, 25); assert.equal(plan.reason, null);
});

test('more than 25 AND more than 10% of the live catalog vanished -> held back (wrong URL / cut-off download)', () => {
  const all = rows(100);
  const seen = feedOf(all.slice(40));                          // 40 of 100 gone
  const plan = planVanished(all, seen, seen.size, 0);
  assert.deepEqual(plan.zero, []); assert.equal(plan.held, 40); assert.equal(plan.reason, 'too_many');
});

test('many vanished but a small share of a big catalog is processed; just above 10% is held', () => {
  const all = rows(1000);
  let seen = feedOf(all.slice(100));                           // 100 of 1000 = exactly 10%: still processed
  let plan = planVanished(all, seen, seen.size, 0);
  assert.equal(plan.zero.length, 100); assert.equal(plan.reason, null);
  seen = feedOf(all.slice(101));                               // 101 of 1000: held
  plan = planVanished(all, seen, seen.size, 0);
  assert.deepEqual(plan.zero, []); assert.equal(plan.held, 101); assert.equal(plan.reason, 'too_many');
});

test('a feed cut off at 85% of the catalog is held (the stream parser accepts truncated XML without an error)', () => {
  const all = rows(4100);
  const seen = feedOf(all.slice(0, 3485));
  const plan = planVanished(all, seen, seen.size, 0);
  assert.equal(plan.reason, 'too_many'); assert.deepEqual(plan.zero, []);
});

test('normal churn on a real-sized catalog is processed (6 missing of 4100)', () => {
  const all = rows(4100);
  const seen = feedOf(all.slice(6));
  assert.equal(planVanished(all, seen, seen.size, 0).zero.length, 6);
});

test('long-gone products (already 0) do not make the guard drift: the share is measured on the live catalog', () => {
  const dead = rows(700, 0, 'dead');                           // vanished months ago, stock already 0
  const live = rows(300, 5, 'live');
  const seen = feedOf(live.slice(290));                        // the feed now returns only 10 products
  const plan = planVanished([...dead, ...live], seen, seen.size, 0);
  assert.deepEqual(plan.zero, []); assert.equal(plan.held, 290); assert.equal(plan.reason, 'too_many');

  const ok = planVanished([...dead, ...live], feedOf(live.slice(3)), 297, 0); // 3 really vanished
  assert.equal(ok.zero.length, 3);
});

test('a renamed product without id/barcode (title-derived SKU) is not treated as vanished', () => {
  const derived = { id: 'd', sku: 'xml-0123456789ab', stock: 4 };
  const plan = planVanished([derived, ...rows(3)], feedOf(rows(3)), 3, 0);
  assert.deepEqual(plan.zero, []);
});

test('duplicate rows with the same SKU count as present when that SKU is in the feed', () => {
  const dup = [{ id: 'a', sku: 'X', stock: 3 }, { id: 'b', sku: 'X', stock: 3 }, { id: 'c', sku: 'Y', stock: 2 }];
  const plan = planVanished(dup, new Set(['X']), 1, 0);
  assert.deepEqual(plan.zero.map((r) => r.id), ['c']);
});

test('stock may come as a string/NULL from old rows without crashing', () => {
  const plan = planVanished([{ id: 'n', sku: 'N', stock: null }, { id: 's', sku: 'S', stock: '3' }], new Set(['Z']), 1, 0);
  assert.deepEqual(plan.zero.map((r) => r.id), ['s']);
});

test('notification sentences', () => {
  assert.equal(describeVanished(0, 0, null), '');
  assert.match(describeVanished(4, 0, null), /4 ürün XML'den kalktığı için stoğu sıfırlandı/);
  assert.match(describeVanished(0, 80, 'too_many'), /80 ürün XML'de görünmüyor ama stokları sıfırlanmadı \(sayı çok fazla/);
  assert.match(describeVanished(0, 8, 'empty'), /XML boş geldi/);
  assert.match(describeVanished(0, 1, 'errors'), /okuma hatası/);
});
