// "Kategori eşleştirme" tab: free suggestions for the XML categories that have no mapping yet
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import CategoryMappingPage from '../../src/pages/marketplaces/CategoryMappingPage.jsx';
import { calls } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const click = async (el, ms = 80) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };
const setVal = async (el, v, proto = window.HTMLInputElement.prototype) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(proto, 'value').set; set.call(el, v); el.dispatchEvent(new window.Event(proto === window.HTMLSelectElement.prototype ? 'change' : 'input', { bubbles: true })); }); await wait(20); };
const btn = (label, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const card = () => document.querySelector('[data-testid="category-suggestions"]');
const srows = () => [...document.querySelectorAll('[data-testid="suggestion-row"]')];

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<MemoryRouter><CategoryMappingPage /></MemoryRouter>); });
await wait(150);
ok('nothing is suggested before an XML source is chosen', !card() && !calls.some((c) => /category-suggestions/.test(c.url)));

calls.length = 0;
await setVal(document.querySelector('select[aria-label="XML kaynağı"]'), 's1', window.HTMLSelectElement.prototype);
await wait(200);
const req = calls.find((c) => /connections\/c1\/product-categories\/category-suggestions$/.test(c.url));
ok('choosing a source asks for the suggestions of that source (free, one call)', !!req && req.params.xmlSourceId === 's1' && calls.filter((c) => /category-suggestions/.test(c.url)).length === 1, JSON.stringify(req));
ok('the card says it is free and not AI', !!card() && card().textContent.includes('Önerilen eşleştirmeler') && card().textContent.includes('ücretsiz') && card().textContent.includes('yapay zeka değil'));
ok('only categories without a mapping are listed (Giyim is mapped), in the server\'s order (biggest first)', srows().map((r) => r.children[0].textContent).join('|') === 'Kolye|Ev ve Yaşam|Kutu', srows().map((r) => r.children[0].textContent).join('|'));
const row = (name) => srows().find((r) => r.children[0].textContent === name);
ok('the card counts them', card().textContent.includes('eşleşmeyen 3 kategori'));
ok('a suggestion shows the end of its path and how many titles back it', row('Kolye').textContent.includes('Kolye › Çelik Kolye') && row('Kolye').textContent.includes('%67'), row('Kolye').textContent);
ok('the full path is in the tooltip', row('Kolye').querySelector('[data-testid="cat-suggestion"]').title.includes('Aksesuar > Takı & Mücevher > Kolye > Çelik Kolye'));
ok('a mixed category says so and points to the per-product tab', row('Ev ve Yaşam').textContent.includes('Karışık kategori') && !!btn('Ürün bazlı kategori', row('Ev ve Yaşam')) && !row('Kolye').textContent.includes('Karışık'));
ok('a tiny category says its suggestion is weak', row('Kutu').textContent.includes('Az ürün (3)'));

// the pointer to the per-product tab works, and coming back keeps the suggestions
await click(btn('Ürün bazlı kategori', row('Ev ve Yaşam')), 200);
ok('the note\'s button opens the per-product tab', text().includes('Toplam ürün') && !card());
await click(btn('Kategori eşleştirme'), 200);
ok('and the mapping tab shows the suggestions again', !!card() && srows().length === 3);

// a click on a suggestion fills the form
calls.length = 0;
await click(row('Kolye').querySelector('[data-testid="cat-suggestion"]'), 200);
const localSelect = [...document.querySelectorAll('select')].find((sel) => [...sel.options].some((o) => o.value === 'Kolye'));
ok('the XML category is chosen in the form', !!localSelect && localSelect.value === 'Kolye', localSelect && localSelect.value);
ok('the Trendyol category is chosen with its full path', document.body.textContent.includes('Aksesuar > Takı & Mücevher > Kolye > Çelik Kolye') && document.querySelector('input[placeholder^="Trendyol\'da kategori ara"]').value === 'Çelik Kolye');
ok('its required attributes are fetched like for a hand-picked category', calls.some((c) => c.m === 'GET' && /connections\/c1\/categories\/1\/attributes$/.test(c.url)));
ok('nothing was saved by the click itself', !calls.some((c) => c.m === 'POST'));
ok('the save button is ready', !btn('Eşleştirmeyi Kaydet').disabled);

// saving: same call as a hand-made mapping, then the category leaves the suggestion list
calls.length = 0;
await click(btn('Eşleştirmeyi Kaydet'), 250);
const post = calls.find((c) => c.m === 'POST' && /category-mappings$/.test(c.url));
ok('saving sends the XML category and the chosen Trendyol category', !!post && post.body.xmlSourceId === 's1' && post.body.localCategory === 'Kolye' && String(post.body.marketplaceCategoryId) === '1' && post.body.marketplaceCategoryName === 'Aksesuar > Takı & Mücevher > Kolye > Çelik Kolye', JSON.stringify(post && post.body));
ok('the saved category leaves the list of suggestions', srows().length === 2 && !row('Kolye') && card().textContent.includes('eşleşmeyen 2 kategori'));
ok('the suggestions were not asked for again just because a mapping was saved', calls.filter((c) => /category-suggestions/.test(c.url)).length === 0);

// a failing suggestion service never breaks the page
console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
