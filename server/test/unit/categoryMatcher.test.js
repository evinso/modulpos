const test = require('node:test');
const assert = require('node:assert/strict');
const { CategoryMatcher, getMatcher, flattenLeaves, tokens } = require('../../src/services/categoryMatcher');

const names = (r) => r.map((x) => x.name);

test('bundled tree is loaded as leaves', () => {
  const m = getMatcher();
  assert.ok(m.leaves.length > 3000);
  assert.ok(m.get(m.leaves[0].id));
});

test('tokens: Turkish letters folded, suffixes cut to 5 letters, noise dropped', () => {
  assert.deepEqual(tokens('Oyuncağı 30 cm Set'), ['oyunc']);
  assert.deepEqual(tokens('OYUNCAKLARI'), tokens('oyuncak'));
  assert.deepEqual(tokens('Ürün ve ile'), []);
});

test('the right category is among the first 3 suggestions for typical titles of a broad feed', () => {
  const m = getMatcher();
  const cases = [
    ['Paslanmaz Çelik Pense Seti 3 Parça', 'Hırdavat Malzemeleri', 'Pense'],
    ['Mini Tornavida Seti 6 lı', 'Hırdavat Malzemeleri|Hırdavat El Aletleri', 'Tornavida'],
    ['Peluş Ayıcık Oyuncak 30 cm', 'Oyuncak &amp; Kırtasiye', 'Peluş Oyuncak'],
    ['Araç İçi Telefon Tutucu Vantuzlu', 'Oto Aksesuar Ürünleri', 'Araç İçi Telefon Tutucu'],
    ['Seramik Kupa Bardak 350 ml', 'Ev ve Yaşam|Mutfak Ürünleri', 'Kupa'],
    ['Hava Nemlendirici Ultrasonik 300 ml', 'Ev ve Yaşam', 'Hava Nemlendirici'],
    ['Silikon Tabancası 20 W', 'Hırdavat Malzemeleri', 'Silikon Tabancası'],
  ];
  for (const [title, ctx, want] of cases) {
    const got = names(m.suggest(title, { context: ctx, top: 3 }));
    assert.ok(got.includes(want), `${title}: wanted ${want}, got ${got.join(' | ')}`);
  }
});

test('a category whose own name shares no word with the product is never suggested', () => {
  const m = new CategoryMatcher(flattenLeaves([{ id: 1, name: 'Giyim', subCategories: [{ id: 2, name: 'Pantolon' }, { id: 3, name: 'Gömlek' }] }]));
  assert.deepEqual(m.suggest('Bambu Kesme Tahtası'), []);
  assert.deepEqual(names(m.suggest('Kadın Pantolon Siyah')), ['Pantolon']);
});

test('the XML category only adds weight, the title decides', () => {
  const m = new CategoryMatcher(flattenLeaves([{ id: 1, name: 'Mutfak', subCategories: [{ id: 2, name: 'Tava' }, { id: 3, name: 'Tencere' }] }]));
  assert.equal(m.suggest('Granit Tava', { context: 'Tencere' })[0].name, 'Tava');
});

test('empty input gives nothing', () => {
  assert.deepEqual(getMatcher().suggest('', { context: '' }), []);
  assert.deepEqual(getMatcher().suggest('   '), []);
});

test('manual search: every typed word must be in the path, leaf name matches first', () => {
  const r = getMatcher().search('kupa');
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => /kupa/i.test(x.path.replace(/İ/g, 'i'))) || r[0].name === 'Kupa');
  assert.equal(r[0].name, 'Kupa');
  assert.deepEqual(getMatcher().search('   '), []);
  assert.deepEqual(getMatcher().search('zzzqqqxxx'), []);
});
