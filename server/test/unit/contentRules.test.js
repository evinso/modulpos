const test = require('node:test');
const assert = require('node:assert/strict');
const { ContentRuleSet } = require('../../src/services/contentRules');

const R = (o) => ({ isActive: true, field: 'both', matchType: 'word', caseSensitive: false, action: 'replace', replacement: '', ...o });
const rs = new ContentRuleSet([
  R({ pattern: 'orijinal', replacement: 'kaliteli' }),
  R({ pattern: 'ışık', replacement: 'lamba' }),
  R({ pattern: 'İstanbul', action: 'remove', field: 'title' }),
  R({ pattern: 'garantili', action: 'block' }),
  R({ pattern: 'çelik', matchType: 'contains', replacement: 'metal' }),
]);

test('case-insensitive Turkish replace', () => assert.equal(rs.processText('ORİJİNAL kolye', 'title').text, 'kaliteli kolye'));
test('dotless i', () => assert.equal(rs.processText('Işık demeti', 'description').text, 'lamba demeti'));
test('whole word only', () => assert.equal(rs.processText('orijinalite harika', 'title').text, 'orijinalite harika'));
test('remove tidies spaces', () => assert.equal(rs.processText('İstanbul çelik kolye', 'title').text, 'metal kolye'));
test('field scoping', () => assert.equal(rs.processText('İstanbul malı', 'description').text, 'İstanbul malı'));
test('block flags but keeps text', () => {
  assert.deepEqual(rs.findBlocked({ title: 'GARANTİLİ ürün', description: '' }), ['garantili']);
  assert.equal(rs.processText('garantili ürün', 'title').text, 'garantili ürün');
});
test('case sensitive rule', () => assert.equal(new ContentRuleSet([R({ pattern: 'Test', replacement: 'x', caseSensitive: true })]).processText('test Test', 'title').text, 'test x'));
