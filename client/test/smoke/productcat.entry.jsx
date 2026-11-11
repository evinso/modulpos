import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProductCategoriesPage from '../../src/pages/marketplaces/ProductCategoriesPage.jsx';
import { calls, pc } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const click = async (el, ms = 60) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };
const setVal = async (el, v, proto = window.HTMLInputElement.prototype) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(proto, 'value').set; set.call(el, v); el.dispatchEvent(new window.Event(proto === window.HTMLSelectElement.prototype ? 'change' : 'input', { bubbles: true })); }); await wait(350); };
const btn = (label, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(label));

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<ProductCategoriesPage />); });
await wait(150);

ok('nothing is loaded before an XML source is chosen', !calls.some((c) => /product-categories\/products/.test(c.url)) && text().includes('Devam etmek için bir XML kaynağı seçin'));
await setVal(document.querySelector('select[aria-label="XML kaynağı"]'), 's1', window.HTMLSelectElement.prototype);
await wait(150);

ok('overview numbers are shown', ['Ürüne özel kategori', 'Kategorisi olmayan'].every((t) => text().includes(t)) && document.querySelector('[data-testid="overview"]').textContent.includes('8'));
ok('the list asks for products without a category first', calls.some((c) => /product-categories\/products$/.test(c.url) && c.params.status === 'missing' && c.params.xmlSourceId === 's1'));
const rows = () => [...document.querySelectorAll('[data-testid="row"]')];
ok('three products are listed', rows().length === 3);
ok('free suggestions are buttons on the row', rows()[0].querySelectorAll('[data-testid="suggestion"]').length === 2);
ok('a product that has its own category shows where it came from', rows()[2].textContent.includes('Yapay zeka') && rows()[2].textContent.includes('Kupa'));
ok('XML category names are readable (&amp; fixed)', rows()[1].textContent.includes('Oyuncak & Kırtasiye'));
ok('attributes still missing are announced', text().includes('Zorunlu özellik girilmesi gereken kategoriler (1)') && text().includes('Renk'));

// 1) one click on a suggestion assigns it
calls.length = 0;
await click(rows()[0].querySelector('[data-testid="suggestion"]'), 150);
let put = calls.find((c) => c.m === 'PUT' && /product-categories$/.test(c.url));
ok('clicking a suggestion saves it for that product only', !!put && put.body.assignments.length === 1 && put.body.assignments[0].productId === 'q1' && put.body.assignments[0].categoryId === '10' && put.body.assignments[0].source === 'rule', JSON.stringify(put && put.body));

// 2) selection + free bulk step
const check = (i) => rows()[i].querySelector('input[type="checkbox"]');
await click(check(0)); await click(check(1));
ok('selecting rows shows the bulk bar', text().includes('2') && !!btn('ilk öneriyi uygula'));
calls.length = 0;
await click(btn('ilk öneriyi uygula'), 150);
const ap = calls.find((c) => /apply-suggestions$/.test(c.url));
ok('the free bulk step sends the selected ids', !!ap && ap.body.productIds.length === 2 && ap.body.productIds.includes('q1'), JSON.stringify(ap && ap.body));

// 3) select everything that matches the filter
await click(btn('hepsini seç'), 120);
ok('"select all filtered" asks the server for ids with the same filters', calls.some((c) => /product-categories\/ids$/.test(c.url) && c.params.status === 'missing'));
ok('and selects them', text().includes('3 ürün seçili') || text().includes('3') && text().includes('seçili'));

// 4) paid AI step: price shown, confirmation, progress/result
ok('the AI button shows the price per product', !!btn('Yapay zekayla eşleştir (0,05 kredi/ürün)'));
let asked = '';
window.confirm = (m) => { asked = m; return true; };
calls.length = 0;
await click(btn('Yapay zekayla eşleştir'), 200);
ok('the user is asked first, with the maximum cost and the refund rule', asked.includes('0,15 kredi') && asked.includes('iade'), asked.slice(0, 160));
const aiCall = calls.find((c) => /ai-match$/.test(c.url));
ok('AI call carries the selected ids', !!aiCall && aiCall.body.productIds.length === 3);
const result = () => document.querySelector('[data-testid="ai-result"]');
ok('result: 2 matched, 1 without result, credits used', !!result() && result().textContent.includes('2') && result().textContent.includes('1 ürün için sonuç yok') && result().textContent.includes('0,1 kredi'), result() && result().textContent);

// 5) AI problem is shown, not hidden
await click(check(0)); await click(check(1));
pc.aiError = 'AI servisinin (Anthropic) hesap bakiyesi bitmiş. console.anthropic.com → Plans & Billing bölümünden kredi yükleyip tekrar deneyin.';
await click(btn('Yapay zekayla eşleştir'), 200);
ok('a billing problem is shown with its real reason', result() && result().textContent.includes('Plans & Billing'), result() && result().textContent);
pc.aiError = null;

// 6) manual picker for a single product
calls.length = 0;
await click(rows()[1].querySelector('button[type="button"]:not([data-testid])'), 60);
ok('the picker opens', !!document.querySelector('[role="dialog"]'));
await setVal(document.querySelector('input[aria-label="Kategori ara"]'), 'pense');
ok('typing searches the Trendyol tree', calls.some((c) => /product-categories\/search$/.test(c.url) && c.params.q === 'pense'));
await click(document.querySelector('[data-testid="picker-result"]'), 150);
put = calls.find((c) => c.m === 'PUT' && /product-categories$/.test(c.url));
ok('picking saves it as a manual choice for that product', !!put && put.body.assignments[0].productId === 'q2' && put.body.assignments[0].source === 'manual', JSON.stringify(put && put.body));
ok('the picker closes', !document.querySelector('[role="dialog"]'));

// 6b) default answers for required attributes, set once for everything
const panel = () => document.querySelector('[data-testid="attr-defaults"]');
ok('the defaults panel is there, open and says it is not saved yet', !!panel() && panel().textContent.includes('Henüz kaydedilmedi'));
const val = (label) => panel().querySelector(`input[aria-label="${label}"]`);
ok('the suggested rules are prefilled (Menşei -> TR, colours -> Çok Renkli)', val('Kural 1 özellik adı').value === 'Menşei' && val('Kural 1 değer').value === 'TR' && val('Kural 2 özellik adı').value === 'Renk, Web Color' && val('Kural 2 değer').value === 'Çok Renkli');
ok('and "everything else" -> Belirtilmemiş is on', val('Diğer tüm zorunlu özellikler').checked === true && val('Diğer özellikler için değer').value === 'Belirtilmemiş');
const ex = [...panel().querySelectorAll('[data-testid="attr-example"]')];
ok('attributes still empty are offered with Trendyol\'s own example values', ex.some((b) => b.textContent === 'Unisex') && !ex.some((b) => b.textContent === 'Beyaz'), ex.map((b) => b.textContent).join(','));
await click(ex.find((b) => b.textContent === 'Unisex'));
ok('clicking an example adds a rule for that attribute', val('Kural 3 özellik adı') && val('Kural 3 özellik adı').value === 'Cinsiyet' && val('Kural 3 değer').value === 'Unisex');
calls.length = 0;
await click(btn('Kaydet ve tüm ürünlere uygula', panel()), 150);
const sd = calls.find((c) => c.m === 'PUT' && /attribute-defaults$/.test(c.url));
ok('saving sends all rules and the "everything else" answer', !!sd && sd.body.rules.length === 3 && sd.body.rules[2].value === 'Unisex' && sd.body.fallback.enabled === true && sd.body.fallback.value === 'Belirtilmemiş', JSON.stringify(sd && sd.body));
const rs = document.querySelector('[data-testid="attr-defaults-result"]');
ok('the result says how many products got answers and what stayed empty', !!rs && rs.textContent.includes('12 ürüne uygulandı') && rs.textContent.includes('Cinsiyet (2)'), rs && rs.textContent);

// 7) required attributes are typed once per category
await click(btn('Özellikleri gir'), 120);
const sel = document.querySelector('select[aria-label="Renk değeri"]');
ok('the required attribute offers Trendyol values', !!sel && sel.textContent.includes('Beyaz'));
calls.length = 0;
await click(btn('Kaydet (4 ürüne uygulanır)'), 80);
ok('saving without a value is refused', !calls.some((c) => c.m === 'PUT' && /attributes$/.test(c.url)));
await setVal(sel, '91', window.HTMLSelectElement.prototype);
await click(btn('Kaydet (4 ürüne uygulanır)'), 150);
const at = calls.find((c) => c.m === 'PUT' && /attributes$/.test(c.url));
ok('saving sends the value for the whole category', !!at && at.body.categoryId === '555' && at.body.attributes['5'].valueId === '91', JSON.stringify(at && at.body));

// 8) removing an own category
calls.length = 0;
await click(rows()[2].querySelectorAll('button')[rows()[2].querySelectorAll('button').length - 1], 150);
const rm = calls.find((c) => c.m === 'DELETE' && /product-categories$/.test(c.url));
ok('"Kaldır" gives the product back to the category mapping', !!rm && rm.body.productIds[0] === 'q3', JSON.stringify(rm && rm.body));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
