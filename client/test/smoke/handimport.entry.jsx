import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import toast from 'react-hot-toast';
import ProductFormModal from '../../src/pages/products/ProductFormModal.jsx';
import { calls, formCfg } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const toasts = []; const realOk = toast.success; const realErr = toast.error; const realToast = toast;
toast.success = (m, o) => { toasts.push('ok:' + m); return realOk(m, o); }; toast.error = (m, o) => { toasts.push('err:' + m); return realErr(m, o); };

const click = async (el, ms = 80) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };
const put = async (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : (el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype);
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  await wait(10);
};
const field = (label) => [...document.querySelectorAll('.modal .form-group')].find((g) => g.querySelector('label') && g.querySelector('label').textContent.startsWith(label));
const input = (label) => field(label).querySelector('input:not([type="file"]), textarea, select');
const conn = { id: 'c1', marketplaceType: 'trendyol', config: JSON.stringify({ defaultBrandId: 7, defaultBrandName: 'Atölye', brandStrategy: 'xml' }) };
const mount = async (props = {}) => {
  document.getElementById('root').innerHTML = '';
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<MemoryRouter><ProductFormModal product={undefined} connection={conn} onClose={() => {}} onSaved={() => {}} {...props} /></MemoryRouter>); });
  await wait(60);
  return root;
};
const pickCategory = async () => {
  await click(q('pick-category'));
  await put(document.querySelector('[aria-label="Kategori ara"]'), 'pense');
  await wait(400);
  await click(document.querySelector('[data-testid="picker-result"]'), 150);
};
const attrCalls = () => calls.filter((c) => c.m === 'POST' && /attribute-form$/.test(c.url));

// ═══ 1) choosing a category loads its required attributes in the form ═══
let root = await mount();
ok('before a category is chosen there is no attribute panel', !q('required-attributes'));
await put(input('SKU'), 'EL-1'); await put(input('Barkod'), '8691234567890'); await put(input('Ürün adı'), 'El yapımı Seramik Kupa');
await put(input('Elime kalacak net tutar'), '100'); await put(input('Stok'), '5'); await put(q('description'), 'Elde boyanmış kupa.');
await put(q('image-urls'), 'https://example.com/a.jpg');
await pickCategory();
ok('the attribute form was asked for with the chosen category, the title and the description', attrCalls().length === 1 && attrCalls()[0].body.categoryId === '10' && attrCalls()[0].body.title === 'El yapımı Seramik Kupa' && attrCalls()[0].body.description === 'Elde boyanmış kupa.', JSON.stringify(attrCalls()[0] && attrCalls()[0].body));
ok('the required attributes are shown right in the form, one row each', !!q('required-attributes') && qa('attr-row').length === 4 && ['Renk', 'Menşei', 'Garanti Süresi', 'Materyal'].every((n) => q('required-attributes').textContent.includes(n)));
ok('first answers are there and say where they came from (default answer, title)', q('required-attributes').textContent.includes('varsayılan cevap') && q('required-attributes').textContent.includes('başlıktan')
  && document.querySelector('select[aria-label="Menşei"]').value === '20' && document.querySelector('select[aria-label="Materyal"]').value === '40');
ok('the count says how many are filled', q('attr-count').textContent === '2 / 4 dolu', q('attr-count').textContent);

// the owner fills the rest: a value from the list, and free text where Trendyol allows it
await put(document.querySelector('select[aria-label="Renk"]'), '11');
ok('picking a value fills it', q('attr-count').textContent === '3 / 4 dolu');
await put(document.querySelector('input[aria-label="Garanti Süresi"]'), '2 Yıl');
ok('an attribute with free text takes typed text', q('attr-count').textContent === '4 / 4 dolu');
await put(document.querySelector('select[aria-label="Menşei"]'), '21');
ok('a default answer can be changed', document.querySelector('select[aria-label="Menşei"]').value === '21' && !q('required-attributes').textContent.includes('varsayılan cevap'));
// "write my own value" where the list allows free text
await put(document.querySelector('select[aria-label="Materyal"]'), '__custom__');
ok('"Başka (kendim yazacağım)" turns the row into a text box, "Listeden seç" brings the list back', !!document.querySelector('input[aria-label="Materyal"]') && !!q('attr-back'));
await put(document.querySelector('input[aria-label="Materyal"]'), 'Stoneware');
ok('the own text counts as filled', q('attr-count').textContent === '4 / 4 dolu');

// saving: product, then the category, then the chosen attributes (this order)
await click([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Kaydet')), 200);
const idx = (m, re) => calls.findIndex((c) => c.m === m && re.test(c.url));
const iProd = idx('POST', /^\/products$/), iCat = idx('PUT', /product-categories$/), iAttr = idx('PUT', /product-attributes$/);
ok('saved in this order: the product, its Trendyol category, then its required attributes', iProd >= 0 && iCat > iProd && iAttr > iCat, [iProd, iCat, iAttr].join(' < '));
const sent = calls[iAttr] && calls[iAttr].body;
const by = (id) => sent && sent.attributes.find((a) => a.id === id);
ok('the chosen values are sent: list values by id, own text as text', sent && sent.productId === 'new1' && sent.categoryId === '10' && sent.attributes.length === 4
  && by('1').valueId === '11' && by('2').valueId === '21' && by('3').valueName === '2 Yıl' && by('3').valueId === '' && by('4').valueName === 'Stoneware' && by('4').valueId === '', JSON.stringify(sent));
await act(async () => { root.unmount(); });

// ═══ 2) Trendyol does not answer with the list: the product can still be saved ═══
formCfg.unavailable = true;
root = await mount();
await put(input('SKU'), 'EL-2'); await put(input('Barkod'), '869'); await put(input('Ürün adı'), 'Kupa'); await put(input('Elime kalacak net tutar'), '50'); await put(input('Marka'), 'Atölye');
await put(q('description'), 'x'); await put(q('image-urls'), 'https://example.com/a.jpg');
await pickCategory();
ok('an unreachable attribute list says so and does not block anything', !!q('attr-unavailable') && qa('attr-row').length === 0);
const before = calls.filter((c) => /product-attributes$/.test(c.url)).length;
await click([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Kaydet')), 200);
ok('the product and its category are saved, no attribute call is made', calls.some((c) => c.m === 'POST' && c.url === '/products' && c.body.sku === 'EL-2') && calls.filter((c) => /product-attributes$/.test(c.url)).length === before);
formCfg.unavailable = false;
await act(async () => { root.unmount(); });

// ═══ 3) Trendyol link: the fields are filled and stay editable ═══
root = await mount();
ok('the link card is on a new product form', !!q('trendyol-import') && q('trendyol-import').textContent.includes('Hepsini düzenleyebilirsiniz'));
await put(q('import-url'), 'https://www.trendyol.com/his-studio/geyik-p-1075130175');
await click(q('import-go'), 150);
const imp = calls.filter((c) => c.m === 'POST' && c.url === '/products/trendyol-import').pop();
ok('the link is sent to the server', imp && imp.body.url === 'https://www.trendyol.com/his-studio/geyik-p-1075130175' && !imp.body.source);
ok('title, description and pictures are in the form', input('Ürün adı').value.startsWith('HİS Studio Geyik') && q('description').value.includes('300 ml') && q('image-urls').value.split('\n').length === 2 && qa('thumb').length === 2);
ok('the brand of the store is kept, and the imported one is mentioned', input('Marka').value === 'Atölye' && !!q('brand-kept') && q('brand-kept').textContent.includes('HİS Studio'));
ok('the Trendyol price is shown only as information; the net amount stays empty', q('ref-price').textContent.includes('299,90') && input('Elime kalacak net tutar').value === '');
ok('the category of the page is chosen and its attributes load with what the page said', q('chosen-category').textContent.includes('Pense') && !q('category-guess')
  && attrCalls().pop().body.hints.length === 2 && attrCalls().pop().body.hints[0].name === 'Renk');
ok('an attribute the page answered says so', document.querySelector('select[aria-label="Renk"]').value === '10' && q('required-attributes').textContent.includes('Trendyol sayfasından'));
ok('the summary says what was brought', q('import-done').textContent.includes('2 görsel') && q('import-done').textContent.includes('2 özellik'));
await put(input('Ürün adı'), 'Kendi başlığım');
ok('everything stays editable', input('Ürün adı').value === 'Kendi başlığım');
await act(async () => { root.unmount(); });

// a guessed category is flagged
formCfg.categoryGuess = true;
root = await mount();
await put(q('import-url'), 'https://www.trendyol.com/a/b-p-123456'); await click(q('import-go'), 150);
ok('a category guessed from the name is flagged for checking', !!q('category-guess') && q('category-guess').textContent.includes('tahmin edildi'));
formCfg.categoryGuess = false;
await act(async () => { root.unmount(); });

// ═══ 4) Trendyol blocks the server: the page source is asked for, and read ═══
formCfg.importMode = 'blocked';
root = await mount();
await put(q('import-url'), 'https://www.trendyol.com/a/b-p-123456'); await click(q('import-go'), 150);
ok('a blocked link says so and asks for the page source with the steps', q('import-error').textContent.includes('engelliyor') && !!q('import-source') && q('import-source').textContent.includes('Ctrl+U'));
ok('nothing was filled in', input('Ürün adı').value === '');
await put(q('import-source-text'), '<html>...page source...</html>');
await click(q('import-source-go'), 150);
const imp2 = calls.filter((c) => c.m === 'POST' && c.url === '/products/trendyol-import').pop();
ok('the pasted source (and the link) are sent', imp2.body.source === '<html>...page source...</html>' && imp2.body.url === 'https://www.trendyol.com/a/b-p-123456');
ok('then the form is filled like before and the source box is gone', input('Ürün adı').value.startsWith('HİS Studio') && !q('import-source') && !!q('import-done'));
await act(async () => { root.unmount(); });

// ═══ 5) nothing found in the text: an error, no source box (the text was already the source) ═══
formCfg.importMode = 'notfound';
root = await mount();
await put(q('import-url'), 'https://www.trendyol.com/a/b-p-123456'); await click(q('import-go'), 150);
ok('a page without product data is reported', q('import-error').textContent.includes('ürün bilgisi bulunamadı') && !q('import-source'));
formCfg.importMode = 'ok';
await act(async () => { root.unmount(); });

// ═══ 6) not on the edit form ═══
root = await mount({ product: { id: 'h1', sku: 'EL-1', title: 'Kupa', price: 100, stock: 1, brand: 'Atölye', xmlSourceId: null, xmlPrice: 0, images: '[]' } });
ok('editing a product: no link card', !q('trendyol-import'));
await act(async () => { root.unmount(); });

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
