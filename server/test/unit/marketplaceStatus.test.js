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
