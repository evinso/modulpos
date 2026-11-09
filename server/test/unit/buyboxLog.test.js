const test = require('node:test');
const assert = require('node:assert/strict');
const { describeRun, describeSettingsChange, logRun } = require('../../src/services/buyboxLog');

const run = (o = {}) => ({ kind: 'auto', mode: 'equal', amount: 0, considered: 10, planned: 8, updated: 8, skipped: { notLower: 1, loss: 1, noProduct: 0 }, creditUsed: 0.8, ...o });

test('a successful run says how many prices were lowered, how and what was skipped', () => {
  const d = describeRun(run());
  assert.equal(d.status, 'ok');
  assert.match(d.note, /^Otomatik fiyat: 8 ürünün fiyatı düşürüldü \(BuyBox fiyatına eşit\)\./);
  assert.match(d.note, /1 ürün zaten BuyBox fiyatının altında\/eşit olduğu için, 1 ürün zarara düşeceği için atlandı\./);
  assert.match(d.note, /0,8 kredi kullanıldı\./);
});

test('undercut mode names the amount; the manual button says so', () => {
  const d = describeRun(run({ kind: 'manual', mode: 'undercut', amount: 1.5 }));
  assert.match(d.note, /^Elle fiyat güncelleme: .*BuyBox fiyatının 1,50 ₺ altı/);
});

test('nothing changed: status nothing and the reason is given', () => {
  const d = describeRun(run({ updated: 0, planned: 0, creditUsed: 0, skipped: { notLower: 0, loss: 3, noProduct: 0 } }));
  assert.equal(d.status, 'nothing');
  assert.match(d.note, /10 üründe fiyat değiştirilmedi\. 3 ürün zarara düşeceği için atlandı\./);
});

test('errors: nothing sent is an error, part sent is partial', () => {
  const e = describeRun(run({ updated: 0, error: 'Yetersiz kredi. Gerekli: 1, Mevcut: 0' }));
  assert.equal(e.status, 'error'); assert.match(e.note, /güncellenemedi\. Yetersiz kredi/);
  const p = describeRun(run({ updated: 3, error: 'Trendyol 500' }));
  assert.equal(p.status, 'partial'); assert.match(p.note, /8 üründen 3'sinin fiyatı düşürüldü/);
});

test('settings change: only real changes produce a note', () => {
  const off = { enabled: false, mode: 'equal', amount: 0 };
  assert.equal(describeSettingsChange(off, off), null);
  assert.equal(describeSettingsChange({ enabled: true, mode: 'equal', amount: 0 }, { enabled: true, mode: 'equal', amount: 5 }), null);   // amount means nothing in equal mode
  assert.equal(describeSettingsChange(off, { enabled: true, mode: 'equal', amount: 0 }), 'Otomatik fiyat ayarı açıldı: BuyBox fiyatına eşit.');
  assert.equal(describeSettingsChange({ enabled: true, mode: 'equal', amount: 0 }, { enabled: true, mode: 'undercut', amount: 2 }), 'Otomatik fiyat ayarı değiştirildi: BuyBox fiyatının 2,00 ₺ altı.');
  assert.equal(describeSettingsChange({ enabled: true, mode: 'undercut', amount: 2 }, { enabled: false, mode: 'undercut', amount: 2 }), 'Otomatik fiyat ayarı kapatıldı.');
});

test('logRun stores the note, caps the product list at 100 and prunes old notes', async () => {
  const created = []; const pruned = [];
  const db = { buyboxAutoLog: { create: async (a) => { created.push(a.data); }, deleteMany: async (a) => { pruned.push(a.where); } } };
  const changes = Array.from({ length: 150 }, (_, i) => ({ barcode: 'b' + i, title: 'T' + i, oldPrice: 100, newPrice: 90 }));
  await logRun({ connectionId: 'c1', kind: 'auto', mode: 'equal', amount: 0, considered: 150, planned: 150, updated: 150, skipped: {}, creditUsed: 15, changes }, db);
  assert.equal(created.length, 1);
  assert.equal(created[0].connectionId, 'c1'); assert.equal(created[0].kind, 'auto'); assert.equal(created[0].status, 'ok'); assert.equal(created[0].updated, 150);
  assert.equal(JSON.parse(created[0].items).length, 100);
  assert.equal(pruned.length, 1); assert.ok(pruned[0].createdAt.lt instanceof Date);
});

test('a settings note is stored as given (status info)', async () => {
  const created = [];
  const db = { buyboxAutoLog: { create: async (a) => { created.push(a.data); }, deleteMany: async () => {} } };
  await logRun({ connectionId: 'c1', kind: 'settings', note: 'Otomatik fiyat ayarı açıldı: BuyBox fiyatına eşit.', mode: 'equal', amount: 0 }, db);
  assert.equal(created[0].status, 'info'); assert.equal(created[0].note, 'Otomatik fiyat ayarı açıldı: BuyBox fiyatına eşit.'); assert.equal(created[0].items, null);
});

test('a failing database never breaks the caller', async () => {
  const db = { buyboxAutoLog: { create: async () => { throw new Error('table missing'); }, deleteMany: async () => {} } };
  const orig = console.error; console.error = () => {};
  try { await assert.doesNotReject(logRun({ connectionId: 'c1', kind: 'auto', updated: 1, planned: 1, considered: 1 }, db)); } finally { console.error = orig; }
});
