const test = require('node:test');
const assert = require('node:assert/strict');
const { diffWords } = require('../../src/content/lib/diff');

test('word diff: what was removed, what was added, what stayed; identical texts have no change; unrelated long texts are answered coarsely, never slowly', () => {
  const d = diffWords('The price is 20 dollars a month for all users', 'The price is 22 dollars a month for new users only');
  assert.deepEqual(d.runs, [{ t: 'eq', text: 'The price is' }, { t: 'del', text: '20' }, { t: 'ins', text: '22' }, { t: 'eq', text: 'dollars a month for' }, { t: 'del', text: 'all' }, { t: 'ins', text: 'new' }, { t: 'eq', text: 'users' }, { t: 'ins', text: 'only' }]);
  assert.deepEqual([d.added, d.removed, d.unchanged, d.coarse, d.changedShare], [3, 2, 8, false, 23.8]);
  const same = diffWords('a b c', 'a  b\n c'); assert.deepEqual([same.runs.length, same.changedShare, same.added], [1, 0, 0]);
  assert.deepEqual(diffWords('', 'new text here').runs, [{ t: 'ins', text: 'new text here' }]); assert.deepEqual(diffWords('old text', '').runs, [{ t: 'del', text: 'old text' }]); assert.equal(diffWords('', '').changedShare, 0);
  const t0 = Date.now(); const big = diffWords(Array.from({ length: 3000 }, (_, i) => `x${i}`).join(' '), Array.from({ length: 3000 }, (_, i) => `y${i}`).join(' ')); assert.deepEqual([big.coarse, big.added, big.removed], [true, 3000, 3000]); assert.ok(Date.now() - t0 < 8000, 'bounded work');
  const para = Array.from({ length: 400 }, (_, i) => `word${i}`); const edited = [...para]; edited[200] = 'changed'; edited.splice(300, 0, 'inserted'); const e = diffWords(para.join(' '), edited.join(' ')); assert.deepEqual([e.added, e.removed, e.coarse], [2, 1, false], 'a few edits in a long text stay precise');
});
