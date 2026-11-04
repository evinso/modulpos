const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadinessContext, MappingIndex } = require('../../src/services/readiness');

const m = (id, cat) => ({ id, localCategory: cat, marketplaceCategoryId: id });
const ctx = (bySource, global = {}) => {
  const c = Object.create(ReadinessContext.prototype);
  c.indexes = new Map(Object.entries(bySource).map(([k, list]) => [k, new MappingIndex(Object.fromEntries(list.map((x) => [x.localCategory, x])))]));
  c.globalCatMap = global;
  return c;
};

test('a product uses the mapping of its own XML source', () => {
  const c = ctx({ A: [m('a1', 'Küpe')], B: [m('b1', 'Küpe')] });
  assert.equal(c.resolveMapping('Küpe', 'A').id, 'a1');
  assert.equal(c.resolveMapping('Küpe', 'B').id, 'b1');
});
test("another source's mapping never leaks in", () => {
  const c = ctx({ A: [m('a1', 'Küpe')] });
  assert.equal(c.resolveMapping('Küpe', 'B'), null);
});
test('legacy (source-less) mappings still apply as a fallback', () => {
  const c = ctx({ '': [m('old', 'Kolye')], A: [m('a1', 'Küpe')] });
  assert.equal(c.resolveMapping('Kolye', 'A').id, 'old');
  assert.equal(c.resolveMapping('Küpe', 'A').id, 'a1');
});
test('source mapping wins over the legacy one', () => {
  const c = ctx({ '': [m('old', 'Küpe')], A: [m('a1', 'Küpe')] });
  assert.equal(c.resolveMapping('Küpe', 'A').id, 'a1');
});
test('case-insensitive, path parts and last level of a path key', () => {
  const c = ctx({ A: [m('x', 'Kadın|Bayan Bileklik|'), m('y', 'Erkek Küpe')] });
  assert.equal(c.resolveMapping('bayan bileklik', 'A').id, 'x');        // leaf of the path key
  assert.equal(c.resolveMapping('erkek küpe', 'A').id, 'y');            // case-insensitive
  assert.equal(c.resolveMapping('Takı|Erkek Küpe|', 'A').id, 'y');      // product category is a path
  assert.equal(c.resolveMapping('Bilinmeyen', 'A'), null);
});
test('global provider mapping is used for its source', () => {
  const c = ctx({}, { G: { Elbise: { id: 'g1' } } });
  assert.equal(c.resolveMapping('Elbise', 'G').id, 'g1');
  assert.equal(c.resolveMapping('Elbise', 'H'), null);
});
