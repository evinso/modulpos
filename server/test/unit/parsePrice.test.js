const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrice } = require('../../src/utils/parsePrice');

const cases = {
  '1874.7': 1874.7, '1.874,7': 1874.7, '1,874.70': 1874.7, '1.874,70 TL': 1874.7, '₺1 874,70': 1874.7,
  '1874,7': 1874.7, '1.874': 1874, '12.50': 12.5, '0.125': 0.125, '1.234.567,89': 1234567.89,
  '1,234,567.89': 1234567.89, '150.00 TRY': 150, '99,9': 99.9, '': 0, abc: 0,
};
for (const [input, expected] of Object.entries(cases)) {
  test(`parsePrice(${JSON.stringify(input)}) = ${expected}`, () => {
    assert.ok(Math.abs(parsePrice(input) - expected) < 1e-9);
  });
}
