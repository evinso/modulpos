const test = require('node:test');
const assert = require('node:assert/strict');
const { CategoryMatcher, flattenLeaves } = require('../../src/services/categoryMatcher');
const { matchProducts, buildPrompt } = require('../../src/services/categoryAiPicker');

const tree = [{ id: 1, name: 'Hırdavat', subCategories: [{ id: 10, name: 'Pense' }, { id: 11, name: 'Tornavida' }] }, { id: 2, name: 'Oyuncak', subCategories: [{ id: 20, name: 'Peluş Oyuncak' }] }];
const matcher = new CategoryMatcher(flattenLeaves(tree));
const fake = (fn) => ({ messages: { create: async (req) => ({ content: [{ text: fn(req) }] }) } });
const P = (id, title, category = '') => ({ id, title, category });

test('the AI only chooses among the candidates and the answer is checked', async () => {
  const client = fake(() => JSON.stringify({ picks: { 1: 10, 2: 999, 3: 0 } }));
  const { results, noCandidates } = await matchProducts({ client, matcher, products: [P('a', 'Çelik Pense'), P('b', 'Tornavida Seti'), P('c', 'Pense Tornavida')] });
  const by = Object.fromEntries(results.map((r) => [r.productId, r.categoryId]));
  assert.equal(by.a, 10);          // valid candidate
  assert.equal(by.b, null);        // 999 is not one of its candidates
  assert.equal(by.c, null);        // AI said none fits
  assert.equal(noCandidates, 0);
});

test('products without any candidate never reach the AI (and are not charged)', async () => {
  let calls = 0;
  const client = fake((req) => { calls++; return JSON.stringify({ picks: { 1: 20 } }); });
  const { results, noCandidates } = await matchProducts({ client, matcher, products: [P('x', 'Bambu Kesme Tahtası'), P('y', 'Peluş Oyuncak Ayı')] });
  assert.equal(noCandidates, 1);
  assert.equal(calls, 1);
  assert.equal(results.find((r) => r.productId === 'x').categoryId, null);
  assert.equal(results.find((r) => r.productId === 'y').categoryId, 20);
});

test('batches of 20; a fatal error stops the run at once and is reported', async () => {
  let calls = 0;
  const client = { messages: { create: async () => { calls++; throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }); } } };
  const products = Array.from({ length: 100 }, (_, i) => P('p' + i, 'Çelik Pense ' + i));
  const { results, failure, error } = await matchProducts({ client, matcher, products });
  assert.ok(calls <= 3, `stopped early, got ${calls} calls`);
  assert.equal(failure.kind, 'billing');
  assert.ok(error);
  assert.ok(results.every((r) => r.categoryId === null));
});

test('a temporary error loses only its batch', async () => {
  let n = 0;
  const client = { messages: { create: async () => { n++; if (n === 1) throw Object.assign(new Error('overloaded'), { status: 529 }); return { content: [{ text: JSON.stringify({ picks: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), 10])) }) }] }; } } };
  const products = Array.from({ length: 40 }, (_, i) => P('p' + i, 'Çelik Pense ' + i));
  const { results, failure } = await matchProducts({ client, matcher, products });
  assert.equal(failure.kind, 'overloaded');
  assert.equal(results.filter((r) => r.categoryId === 10).length, 20);
});

test('prompt carries title, XML category and candidate ids only', () => {
  const p = buildPrompt([{ key: '1', title: 'Çelik Pense', xmlCategory: 'Hırdavat', candidates: [{ id: 10, path: 'Hırdavat > Pense' }] }]);
  assert.match(p, /Çelik Pense/); assert.match(p, /10\|Hırdavat > Pense/); assert.match(p, /0 yaz/);
});
