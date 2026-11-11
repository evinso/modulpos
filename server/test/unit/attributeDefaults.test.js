const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// attributeDefaults.js pulls in the database module; a stand-in keeps this test free of any connection
const f = require.resolve(path.join(__dirname, '../../src/config/database.js'));
require.cache[f] = { id: f, filename: f, loaded: true, exports: {} };
const AD = require('../../src/services/attributeDefaults');

const def = (id, name, values = [], allowCustom = false) => ({ id: String(id), name, allowCustom, values: values.map((n, i) => ({ id: String(100 * id + i), name: n })) });
const MENSEI = def(1192, 'Menşei', ['CN', 'TR', 'DE']);
const RENK = def(47, 'Renk', [], true);
const WEB = def(348, 'Web Color', ['Siyah', 'Çok Renkli']);
const MATERYAL = def(14, 'Materyal', ['Plastik', 'Belirtilmemiş']);
const CINSIYET = def(9, 'Cinsiyet', ['Kadın / Kız', 'Unisex', 'Erkek']);
const compiled = (rules, fb) => AD.compile({ rules, fallback: fb || { enabled: false, value: '' } });
const RULES = [{ name: 'Menşei', value: 'TR' }, { name: 'Renk, Web Color', value: 'Çok Renkli' }];
const FB = { enabled: true, value: 'Belirtilmemiş' };
const parse = (j) => JSON.parse(j);

test('parseDefaults: empty config, saved config, junk rows dropped', () => {
  assert.deepEqual(AD.parseDefaults(null), { rules: [], fallback: { enabled: false, value: '' }, saved: false });
  const d = AD.parseDefaults(JSON.stringify({ attributeDefaults: { rules: [{ name: ' Menşei ', value: 'TR' }, { name: '', value: 'x' }, { name: 'a' }], fallback: { enabled: true, value: 'Belirtilmemiş' } } }));
  assert.deepEqual(d.rules, [{ name: 'Menşei', value: 'TR' }]);
  assert.equal(d.fallback.enabled, true);
  assert.equal(d.saved, true);
  assert.equal(AD.parseDefaults({ attributeDefaults: { fallback: { enabled: true, value: ' ' } } }).fallback.enabled, false, 'fallback without a value is off');
});

test('rules match attribute names regardless of Turkish letters/case and accept comma separated aliases', () => {
  const c = compiled(RULES);
  assert.equal(c.valueFor('MENŞEİ'), 'TR');
  assert.equal(c.valueFor('mensei'), 'TR');
  assert.equal(c.valueFor('Web Color'), 'Çok Renkli');
  assert.equal(c.valueFor('Renk'), 'Çok Renkli');
  assert.equal(c.valueFor('Materyal'), null, 'no rule and no fallback');
  assert.equal(compiled(RULES, FB).valueFor('Materyal'), 'Belirtilmemiş');
});

test('values are taken from Trendyol\'s list (with its id), free text only where the attribute allows it', () => {
  assert.deepEqual(AD.resolveValue(MENSEI, 'tr'), { valueId: String(119200 + 1), valueName: 'TR' });
  assert.deepEqual(AD.resolveValue(RENK, 'Çok Renkli'), { valueId: '', valueName: 'Çok Renkli' });
  assert.equal(AD.resolveValue(CINSIYET, 'Belirtilmemiş'), null, 'not in the list and no free text: cannot be used');
  assert.equal(AD.resolveValue(WEB, 'Çok Renkli').valueName, 'Çok Renkli');
});

test('alternatives with "|" are tried in order', () => {
  assert.equal(AD.resolveValue(def(5, 'Tip', ['Diğer', 'Düz']), 'Belirtilmemiş | Diğer').valueName, 'Diğer');
  assert.equal(AD.resolveValue(def(5, 'Tip', ['Belirtilmemiş', 'Diğer']), 'Belirtilmemiş | Diğer').valueName, 'Belirtilmemiş');
  assert.equal(AD.resolveValue(RENK, 'Belirtilmemiş | Diğer').valueName, 'Belirtilmemiş', 'free text uses the first alternative');
});

test('the owner\'s case: Menşei TR, colours "Çok Renkli", everything else "Belirtilmemiş"; what cannot be filled is reported', () => {
  const r = AD.computeAttributes([MENSEI, RENK, WEB, MATERYAL, CINSIYET], null, null, compiled(RULES, FB));
  const o = parse(r.json);
  assert.equal(o['1192'].valueName, 'TR');
  assert.equal(o['47'].valueName, 'Çok Renkli');
  assert.equal(o['348'].valueName, 'Çok Renkli');
  assert.equal(o['14'].valueName, 'Belirtilmemiş');
  assert.equal(o['9'], undefined);
  assert.deepEqual(r.unresolved, ['Cinsiyet']);
  assert.equal(r.auto, 4);
  assert.ok(Object.values(o).every((v) => v.auto === true));
});

test('values typed by hand are never replaced; automatic ones follow the rules', () => {
  const existing = JSON.stringify({
    1192: { name: 'Menşei', valueId: '119202', valueName: 'DE' },                       // typed by hand
    14: { name: 'Materyal', valueId: '1400', valueName: 'Plastik', auto: true },        // earlier automatic answer
  });
  const r = AD.computeAttributes([MENSEI, MATERYAL], existing, null, compiled(RULES, FB));
  const o = parse(r.json);
  assert.equal(o['1192'].valueName, 'DE');
  assert.equal(o['1192'].auto, undefined);
  assert.equal(o['14'].valueName, 'Belirtilmemiş', 'the automatic value is refreshed');
  // rule removed -> the automatic value goes away, the manual one stays
  const r2 = AD.computeAttributes([MENSEI, MATERYAL], r.json, null, compiled([]));
  const o2 = parse(r2.json);
  assert.equal(o2['1192'].valueName, 'DE');
  assert.equal(o2['14'], undefined);
  assert.deepEqual(r2.unresolved, ['Materyal']);
});

test('values of a category mapping of the same Trendyol category count as typed by hand', () => {
  const mapping = JSON.stringify({ 1192: { name: 'Menşei', valueId: '119200', valueName: 'CN' } });
  const o = parse(AD.computeAttributes([MENSEI], null, mapping, compiled(RULES)).json);
  assert.equal(o['1192'].valueName, 'CN');
  assert.equal(o['1192'].auto, undefined);
});

test('optional attributes typed by hand are kept; nothing to store gives null', () => {
  const existing = JSON.stringify({ 77: { name: 'Opsiyonel', valueId: '1', valueName: 'x' } });
  assert.ok(parse(AD.computeAttributes([MENSEI], existing, null, compiled(RULES)).json)['77']);
  assert.equal(AD.computeAttributes([CINSIYET], null, null, compiled(RULES)).json, null);
});
