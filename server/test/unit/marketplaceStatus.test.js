const test = require('node:test');
const assert = require('node:assert/strict');
const { isAlreadyListedMessage, classifyBatchItem } = require('../../src/services/marketplaceStatus');

const DUP = 'Aynı barkodlu bir ürününüz bulunduğundan yeni ürün oluşturulamaz. Barkod: ozk-mlb-BYK3728';

test('the "same barcode already exists" answer is recognised, other answers are not', () => {
  assert.equal(isAlreadyListedMessage(DUP), true);
  assert.equal(isAlreadyListedMessage('  aynı barkodlu bir ürününüz bulunduğundan   yeni ürün oluşturulamaz.'), true);
  assert.equal(isAlreadyListedMessage('AYNI BARKODLU BİR ÜRÜNÜNÜZ BULUNDUĞUNDAN YENİ ÜRÜN OLUŞTURULAMAZ'), true);
  // a different product with a different barcode clashes: the barcode itself is NOT listed
  assert.equal(isAlreadyListedMessage('Aynı marka, categori, ürün kodu ve ürün özelliklerine sahip farklı barkodlu bir ürün zaten mevcut. Barkod: mlb'), false);
  assert.equal(isAlreadyListedMessage('Marka geçersiz'), false);
  assert.equal(isAlreadyListedMessage(null), false);
  assert.equal(isAlreadyListedMessage(undefined), false);
  assert.equal(isAlreadyListedMessage(''), false);
});

const cur = { status: 'pending', error: null };

test('create batch: success -> active', () => {
  assert.deepEqual(classifyBatchItem({ itemStatus: 'SUCCESS', isOnboarding: true, failureReasons: [], current: cur }), { status: 'active', error: null });
});
test('create batch: "already exists" failure -> active, no error text', () => {
  assert.deepEqual(classifyBatchItem({ itemStatus: 'FAILED', isOnboarding: true, failureReasons: [DUP], current: cur }), { status: 'active', error: null });
  assert.deepEqual(classifyBatchItem({ itemStatus: 'FAILED', isOnboarding: true, failureReasons: ['x', DUP], current: cur }), { status: 'active', error: null });
});
test('create batch: any other failure -> rejected with the marketplace reasons', () => {
  assert.deepEqual(classifyBatchItem({ itemStatus: 'FAILED', isOnboarding: true, failureReasons: ['Marka geçersiz', 'Görsel yok'], current: cur }), { status: 'rejected', error: 'Marka geçersiz, Görsel yok' });
  assert.deepEqual(classifyBatchItem({ itemStatus: 'FAILED', isOnboarding: true, failureReasons: [], current: cur }), { status: 'rejected', error: 'Trendyol tarafından reddedildi' });
});
test('update batches and unfinished items change nothing on success', () => {
  assert.deepEqual(classifyBatchItem({ itemStatus: 'SUCCESS', isOnboarding: false, failureReasons: [], current: cur }), { status: 'pending', error: null });
  assert.deepEqual(classifyBatchItem({ itemStatus: 'IN_PROGRESS', isOnboarding: true, failureReasons: [], current: { status: 'pending', error: 'x' } }), { status: 'pending', error: 'x' });
});

const { rejectReasonOf } = require('../../src/services/marketplaceStatus');

test('the marketplace\'s own rejection reason is kept, whichever field carries it', () => {
  assert.equal(rejectReasonOf({ rejectReason: 'Yasaklı Kelime: Çeyrek' }), 'Yasaklı Kelime: Çeyrek');
  assert.equal(rejectReasonOf({ rejectReasonDetails: [{ reason: 'Yasaklı Kelime' }, { description: 'Görsel hatalı' }] }), 'Yasaklı Kelime; Görsel hatalı');
  assert.equal(rejectReasonOf({ rejectReason: 'A', rejectReasonDetails: ['A', 'B'] }), 'A; B');
  assert.equal(rejectReasonOf({ rejectReason: '  ' }), null);
  assert.equal(rejectReasonOf({}), null);
  assert.equal(rejectReasonOf(null), null);
});

const { classifyRemoved, reviveRemoved } = require('../../src/services/marketplaceStatus');
const row = (id, barcode) => ({ id, product: { barcode, sku: 'S-' + id } });

test('removed listing: on sale again -> active', () => {
  assert.deepEqual(classifyRemoved('B1', [{ barcode: 'B1' }], []), { state: 'active' });
  assert.deepEqual(classifyRemoved('B1', [{ stockCode: 'B1' }], [{ barcode: 'B1', rejected: true }]), { state: 'active' });
});
test('removed listing: revised and waiting for review -> pending', () => {
  assert.deepEqual(classifyRemoved('B1', [], [{ barcode: 'B1', approved: false, rejected: false }]), { state: 'pending' });
  assert.deepEqual(classifyRemoved('B1', [], [{ barcode: 'B1' }]), { state: 'pending' });
});
test('removed listing: still flagged -> rejected, with the marketplace\'s reason', () => {
  assert.deepEqual(classifyRemoved('B1', [], [{ barcode: 'B1', rejected: true, rejectReason: 'Yasaklı Kelime' }]), { state: 'rejected', reason: 'Yasaklı Kelime' });
  assert.deepEqual(classifyRemoved('B1', [], [{ barcode: 'B1', rejected: true }]), { state: 'rejected', reason: null });
  assert.deepEqual(classifyRemoved('B1', [], [{ barcode: 'B1', rejectReasonDetails: [{ reason: 'Yasaklı Kelime' }] }]), { state: 'rejected', reason: 'Yasaklı Kelime' });
});
test('removed listing: other barcodes in the answer or no answer -> unknown', () => {
  assert.equal(classifyRemoved('B1', [{ barcode: 'B2' }], [{ barcode: 'B3' }]), null);
  assert.equal(classifyRemoved('B1', [], []), null);
  assert.equal(classifyRemoved('B1', null, undefined), null);
});

test('reviving: every row is looked up, results are applied, counts add up', async () => {
  const applied = [];
  const answers = { B1: { state: 'active' }, B2: { state: 'pending' }, B3: null, B4: { state: 'rejected', reason: 'x' } };
  const n = await reviveRemoved([row('a', 'B1'), row('b', 'B2'), row('c', 'B3'), row('d', 'B4')], async (code) => answers[code], async (mp, r) => { applied.push([mp.id, r.state]); });
  assert.deepEqual(n, { active: 1, pending: 1, reason: 1 });
  assert.deepEqual(applied, [['a', 'active'], ['b', 'pending'], ['d', 'rejected']]);
});
test('reviving stops quietly when the marketplace query fails and changes nothing', async () => {
  const applied = []; let calls = 0;
  const n = await reviveRemoved([row('a', 'B1'), row('b', 'B2')], async () => { calls++; throw new Error('426'); }, async (mp) => { applied.push(mp.id); });
  assert.deepEqual(n, { active: 0, pending: 0, reason: 0 }); assert.equal(calls, 1); assert.deepEqual(applied, []);
});
test('reviving looks at no more than the given number of listings and skips rows without a barcode', async () => {
  let calls = 0;
  const rows = [row('a', 'B1'), { id: 'x', product: {} }, row('c', 'B3'), row('d', 'B4')];
  await reviveRemoved(rows, async () => { calls++; return null; }, async () => {}, 2);
  assert.equal(calls, 1);
  calls = 0;
  await reviveRemoved(rows, async () => { calls++; return null; }, async () => {}, 3);
  assert.equal(calls, 2);
});
