const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// attributeDefaults needs the database client only for its own queries: not used here
const f = require.resolve(path.join(__dirname, '../../src/config/database.js'));
require.cache[f] = { id: f, filename: f, loaded: true, exports: {} };
const AD = require('../../src/services/attributeDefaults');
const { buildForm, mergeFormValues, fromHint, MAX_VALUES } = require('../../src/services/attributeForm');

const def = (id, name, values, extra = {}) => ({ id: String(id), name, allowCustom: false, values: values.map((n, i) => ({ id: String(id * 100 + i), name: n })), ...extra });
const RENK = def(1, 'Renk', ['Beyaz', 'Siyah', 'Kırmızı', 'Çok Renkli']);
const MATERYAL = def(2, 'Materyal', ['Seramik', 'Porselen', 'Cam']);
const MENSEI = def(3, 'Menşei', ['TR', 'CN', 'DE']);
const HACIM = def(4, 'Hacim', ['200 ml', '300 ml', '350 ml']);
const SERBEST = def(5, 'Desen', ['Düz', 'Çiçekli'], { allowCustom: true });

test('hint: matched by attribute name and by value, never guessed', () => {
  assert.deepEqual(fromHint(RENK, [{ name: 'Renk', value: 'siyah' }]), { valueId: '101', valueName: 'Siyah' }, 'name and value compare without case / Turkish letters');
  assert.deepEqual(fromHint(RENK, [{ name: 'Web Rengi', value: 'Kırmızı' }]), null, 'a different attribute name is not taken');
  assert.deepEqual(fromHint(MATERYAL, [{ name: 'Ürün Materyali', value: 'Seramik' }]), { valueId: '200', valueName: 'Seramik' }, 'the name may contain the attribute name');
  assert.deepEqual(fromHint(MATERYAL, [{ name: 'Materyal', value: 'Seramik, Porselen' }]), null, 'two values in one hint: ambiguous, nothing');
  assert.deepEqual(fromHint(RENK, [{ name: 'Renk', value: 'Mor' }]), null, 'a value that is not in the list, no free text allowed');
  assert.deepEqual(fromHint(SERBEST, [{ name: 'Desen', value: 'Karo' }]), { valueId: '', valueName: 'Karo' }, 'free text only when Trendyol allows it for the attribute');
  assert.deepEqual(fromHint(HACIM, [{ name: 'Hacim', value: '300 ml' }]), { valueId: '401', valueName: '300 ml' });
  assert.equal(fromHint(RENK, []), null); assert.equal(fromHint(RENK, [{ name: 'Renk', value: ' ' }]), null);
  assert.equal(fromHint(RENK, [{ name: '', value: 'Siyah' }]), null);
});

test('buildForm: the page wins over the text, the text over the default answers, and nothing is invented', () => {
  const defaults = AD.compile({ rules: [{ name: 'Menşei', value: 'TR' }, { name: 'Renk, Web Color', value: 'Çok Renkli' }], fallback: { enabled: false, value: '' } });
  const form = buildForm([RENK, MATERYAL, MENSEI, HACIM], {
    title: 'El Yapımı Kırmızı Seramik Kupa', description: 'Hacim: 300 ml', hints: [{ name: 'Renk', value: 'Beyaz' }], defaults, resolveValue: AD.resolveValue,
  });
  const by = Object.fromEntries(form.map((x) => [x.name, x.answer]));
  assert.deepEqual(by.Renk, { valueId: '100', valueName: 'Beyaz', from: 'page' }, 'the page says Beyaz, although the title says Kırmızı');
  assert.deepEqual(by.Materyal, { valueId: '200', valueName: 'Seramik', from: 'title' });
  assert.deepEqual(by['Menşei'], { valueId: '300', valueName: 'TR', from: 'default' }, 'the default rule of the connection');
  assert.deepEqual(by.Hacim, { valueId: '401', valueName: '300 ml', from: 'description' }, 'read from the description (needs the attribute name next to the number)');
  const noInfo = buildForm([RENK], { title: 'Kupa', defaults, resolveValue: AD.resolveValue });
  assert.equal(noInfo[0].answer.from, 'default'); assert.equal(noInfo[0].answer.valueName, 'Çok Renkli');
  const empty = buildForm([MATERYAL], { title: 'Kupa' });
  assert.equal(empty[0].answer, null, 'no information, no rule: left empty for the owner');
});

test('buildForm: the values of every attribute come with it; a long list is cut and flagged, the answer stays in it', () => {
  const big = def(9, 'Yazar', Array.from({ length: MAX_VALUES + 50 }, (_, i) => `Yazar ${i}`));
  const form = buildForm([big, RENK], { hints: [{ name: 'Yazar', value: `Yazar ${MAX_VALUES + 10}` }] });
  assert.equal(form[0].values.length, MAX_VALUES + 1); assert.equal(form[0].truncated, true);
  assert.equal(form[0].values[0].name, `Yazar ${MAX_VALUES + 10}`, 'the chosen value is put in front even if it was beyond the cut');
  assert.equal(form[1].truncated, false); assert.equal(form[1].values.length, 4); assert.equal(form[1].allowCustom, false);
});

test('mergeFormValues: validated against the allowed values, marked as this product\'s own, other keys kept', () => {
  const current = JSON.stringify({ 7: { name: 'Boyut', valueId: '1', valueName: 'M' }, 1: { name: 'Renk', valueId: '100', valueName: 'Beyaz', auto: true } });
  const r = mergeFormValues([RENK, MATERYAL, SERBEST, HACIM], current, [
    { id: 1, valueId: '101' },                                   // Renk: Siyah (replaces the default answer)
    { id: 2, valueId: '999' },                                   // not in the list
    { id: 5, valueName: 'Karo' },                                // free text allowed
    { id: 4, valueName: 'çok büyük' },                           // free text NOT allowed for Hacim
    { id: 77, valueId: '1' },                                    // not a required attribute of the category: ignored
  ]);
  const o = JSON.parse(r.json);
  assert.deepEqual(o[1], { name: 'Renk', valueId: '101', valueName: 'Siyah', from: 'form' }, 'no auto flag any more: the default answers never replace it');
  assert.deepEqual(o[5], { name: 'Desen', valueId: '', valueName: 'Karo', from: 'form' });
  assert.deepEqual(o[7], { name: 'Boyut', valueId: '1', valueName: 'M' }, 'an unrelated entry is kept as it was');
  assert.equal(o[2], undefined); assert.equal(o[4], undefined);
  assert.equal(r.saved, 2); assert.deepEqual(r.skipped.sort(), ['Hacim', 'Materyal']);
  assert.equal(mergeFormValues([RENK], null, []).json, null);
  assert.equal(mergeFormValues([RENK], '{broken', [{ id: 1, valueId: '100' }]).saved, 1, 'a damaged stored JSON does not stop saving');
});
