const test = require('node:test');
const assert = require('node:assert/strict');
const { pickAttributes, optionsFor, buildPrompt, BATCH, MAX_OPTIONS } = require('../../src/services/attributeAiPicker');

const def = (id, name, names) => ({ id, name, allowCustom: false, values: names.map((n, i) => ({ id: id * 100 + i, name: n })) });

test('short lists are shown whole, without the "Belirtilmemiş" placeholder', () => {
  const o = optionsFor(def(1, 'Cinsiyet', ['Kadın', 'Erkek', 'Belirtilmemiş']), 'Kemer', '');
  assert.deepEqual(o.map((x) => x.name), ['Kadın', 'Erkek']);
});

test('long lists show only the values that share a word with the text; none shared = the attribute is not asked', () => {
  const authors = Array.from({ length: MAX_OPTIONS + 40 }, (_, i) => `Zoltan${i} Quirk${i}`);
  authors.push('Orhan Pamuk');
  const d = def(2, 'Yazar', authors);
  const o = optionsFor(d, 'Kar Kitabı', 'Yazar: Orhan Pamuk. Roman.');
  assert.deepEqual(o.map((x) => x.name), ['Orhan Pamuk']);
  assert.equal(optionsFor(d, 'Defter', 'Çizgili defter'), null);
});

test('attributes about the seller, and attributes without a list, are not asked', () => {
  assert.equal(optionsFor(def(3, 'Menşei', ['TR']), 'x', ''), null);
  assert.equal(optionsFor({ id: 4, name: 'Renk', allowCustom: true, values: [] }, 'x', ''), null);
});

test('the prompt carries the title, a cut description, the numbered attributes and the "do not guess" rule', () => {
  const p = buildPrompt([{ key: '1', title: 'Kemer', description: 'a'.repeat(900), attrs: [{ id: '10', name: 'Renk', options: [{ name: 'Siyah' }, { name: 'Mavi' }] }] }]);
  assert.match(p, /#1\nÜrün: Kemer/);
  assert.match(p, /- \[10\] Renk: Siyah \| Mavi/);
  assert.ok(!p.includes('a'.repeat(501)), 'the description is cut');
  assert.match(p, /null yaz/);
});

test('products are sent in batches, and a fatal vendor error stops the rest', async () => {
  const products = Array.from({ length: BATCH * 3 }, (_, i) => ({ key: 'p' + i, title: 'Ürün ' + i, description: '', defs: [def(1, 'Cinsiyet', ['Kadın', 'Erkek'])] }));
  let calls = 0;
  const client = { messages: { create: async () => { calls++; throw Object.assign(new Error('Your credit balance is too low'), { status: 400 }); } } };
  const r = await pickAttributes({ client, products });
  assert.ok(calls >= 1 && calls <= 3, `stops early (${calls} calls)`);
  assert.equal(r.results.size, 0);
  assert.ok(r.failure && r.failure.fatal);
  assert.equal(r.asked.length, products.length);
});

test('answers are matched to the right product by position, and unknown products/attributes are ignored', async () => {
  const products = [
    { key: 'a', title: 'Kemer', description: '', defs: [def(1, 'Cinsiyet', ['Kadın', 'Erkek'])] },
    { key: 'b', title: 'Çanta', description: '', defs: [def(1, 'Cinsiyet', ['Kadın', 'Erkek'])] },
  ];
  const client = { messages: { create: async () => ({ content: [{ text: 'Tamam:\n{"picks": {"1": {"1": "Erkek", "99": "Kadın"}, "2": {"1": "Kadın"}, "7": {"1": "Kadın"}}}' }] }) } };
  const r = await pickAttributes({ client, products });
  assert.deepEqual(r.results.get('a'), { 1: { valueId: '101', valueName: 'Erkek' } });
  assert.deepEqual(r.results.get('b'), { 1: { valueId: '100', valueName: 'Kadın' } });
});
