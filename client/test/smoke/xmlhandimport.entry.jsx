import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import XmlHandImportModal from '../../src/pages/products/XmlHandImportModal.jsx';
import { decodeXml } from '../../src/pages/products/xmlFile.js';
import { xmlImp } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const btn = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const errors = []; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
const type = async (el, v) => { await act(async () => { setter.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); };
const click = async (el, ms = 40) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); await wait(ms); };
const conn = { id: 'c1', marketplaceType: 'trendyol', config: JSON.stringify({ defaultBrandId: 5, defaultBrandName: 'Atölye Marka', brandStrategy: 'override' }) };

const item = (ref, over = {}) => ({ ref, sku: `TR-${ref}`, skuGenerated: false, barcode: `869100000${ref}`, title: `Seramik Kupa ${ref}`, descriptionLength: 40, descriptionPreview: 'Açıklama', imageCount: 2, firstImage: 'https://img.example.com/a.jpg', category: 'Ev / Mutfak', exists: null, ...over });
const mount = async (props = {}) => {
  document.getElementById('root').innerHTML = '';
  const calls = { done: [], closed: 0 };
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<MemoryRouter><XmlHandImportModal connection={conn} onClose={() => { calls.closed++; }} onDone={(n) => calls.done.push(n)} {...props} /></MemoryRouter>); });
  await wait(40); return { root, calls };
};

// ---- the file's own encoding is honoured ----
const win1254 = new Uint8Array([...Buffer.from('<?xml version="1.0" encoding="windows-1254"?><a>')].concat([0xde, 0xfd, 0xf0, 0xfc]).concat([...Buffer.from('</a>')]));
ok('a Windows-1254 file is decoded as Turkish letters (Şıöü), not as garbage', decodeXml(win1254.buffer).includes('<a>Şığü</a>'), decodeXml(win1254.buffer));
ok('a UTF-8 file with a BOM and a file without a declaration are read as UTF-8', decodeXml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<a>çğ</a>')]).buffer.slice(0)).includes('çğ') && decodeXml(Buffer.from('<a>Üü</a>').buffer.slice(0)).includes('Üü'));

// ---- the dialog ----
xmlImp.items = [item(0), item(1, { exists: 'sku' }), item(2, { imageCount: 0, firstImage: null }), item(3, { skuGenerated: true, barcode: '' })];
let { root, calls } = await mount();
ok('the dialog says what is taken from the XML and what is NOT (price, brand, stock), and that nothing is synced', q('xml-import').textContent.includes('fiyat, marka ve stok alınmaz') && q('xml-import').textContent.includes('XML eşitlemesi onlara dokunmaz'));
ok('nothing can be read before a file or an address is chosen', q('xml-read').disabled === true);
await click(btn('XML adresi'));
await type(q('xml-url'), 'tedarikci.com/urunler.xml');
ok('with an address the read button wakes up', q('xml-read').disabled === false);
await click(q('xml-read'), 80);
ok('the read posts the address (and no mapping the first time)', xmlImp.read.length === 1 && xmlImp.read[0].url === '/products/xml-import/read' && xmlImp.read[0].body.url === 'tedarikci.com/urunler.xml' && !xmlImp.read[0].body.mapping);
ok('the summary counts: 4 read, 3 addable, 1 already there, 1 without a picture, 1 without a code', /4\s*ürün okundu/.test(q('xml-summary').textContent) && q('xml-summary').textContent.includes('1 zaten ekli') && q('xml-summary').textContent.includes('1 ürünün fotoğrafı yok') && q('xml-summary').textContent.includes('1 ürünün kodu yok'));
ok('every row is listed; the one that exists cannot be ticked; the default choice is the addable ones WITH pictures (2)', qa('xml-row').length === 4 && qa('xml-row')[1].querySelector('input').disabled === true && q('xml-import-go').textContent.includes('Seçili 2 ürünü ekle'));
ok('the brand is the store\'s own ("Kendi markam": fixed), not the XML\'s', q('xml-brand').value === 'Atölye Marka' && q('xml-brand').readOnly === true);

// pick the one without a picture too, then write
await click(btn('Eklenebilenlerin hepsini seç'));
ok('"all addable" ticks 3 (the existing one never)', q('xml-import-go').textContent.includes('Seçili 3 ürünü ekle'));
await click(q('xml-import-go'), 80);
const w = xmlImp.written[0];
ok('the write sends the token and the row numbers (not the data) with the owner\'s own choices: VAT 20, stock 0, the store brand, the barcode', xmlImp.written.length === 1 && w.token === 'tok1' && JSON.stringify(w.refs) === '[0,2,3]' && w.options.vatRate === 20 && w.options.stock === 0 && w.options.brand === 'Atölye Marka' && w.options.useBarcode === true, JSON.stringify(w));
ok('the result says 3 products were added and tells the next steps (net amount, stock, category, price template)', q('xml-result').textContent.includes('3 ürün eklendi') && q('xml-result').textContent.includes('Elime kalacak net tutar') && q('xml-result').textContent.includes('Ürün bazlı kategori') && q('xml-result').textContent.includes('fiyat şablonu'));
await click(q('xml-done'));
ok('"Elle eklenen ürünlere git" reports how many were created (the page then shows the hand-added group)', JSON.stringify(calls.done) === '[3]');
await act(async () => { root.unmount(); });

// ---- failures, field choices, batches, a store without a brand ----
xmlImp.written.length = 0; xmlImp.read.length = 0; xmlImp.fail = { status: 422, error: 'XML içinde ürün bulunamadı.' };
({ root, calls } = await mount({ connection: { id: 'c1', marketplaceType: 'trendyol', config: '{}' } }));
await click(btn('XML adresi')); await type(q('xml-url'), 'https://x.example/a.xml'); await click(q('xml-read'), 60);
ok('a refusal of the server is shown in its words and nothing else changes', q('xml-error').textContent.includes('XML içinde ürün bulunamadı') && !q('xml-summary'));
xmlImp.fail = null; xmlImp.items = Array.from({ length: 450 }, (_, i) => item(i));
await click(q('xml-read'), 80);
ok('with no brand in the store settings the brand box is empty and EDITABLE, and nothing can be written without a brand', q('xml-brand').value === '' && q('xml-brand').readOnly === false && q('xml-import-go').disabled === true);
await type(q('xml-brand'), 'Kendi Markam'); await type(document.querySelector('input[type="number"]'), '4');
ok('typing a brand wakes the button: 450 chosen', q('xml-import-go').disabled === false && q('xml-import-go').textContent.includes('Seçili 450 ürünü ekle'));
await click(q('xml-import-go'), 150);
ok('450 products go in batches of 200 (200 + 200 + 50), in order, with the typed brand and stock', xmlImp.written.length === 3 && xmlImp.written.map((x) => x.refs.length).join() === '200,200,50' && xmlImp.written[0].refs[0] === 0 && xmlImp.written[2].refs[49] === 449 && xmlImp.written.every((x) => x.options.brand === 'Kendi Markam' && x.options.stock === 4));
ok('and the result counts all 450', q('xml-result').textContent.includes('450 ürün eklendi'));
await act(async () => { root.unmount(); });

xmlImp.written.length = 0; xmlImp.read.length = 0; xmlImp.items = [item(0), item(1)];
({ root, calls } = await mount());
await click(btn('XML adresi')); await type(q('xml-url'), 'https://x.example/a.xml'); await click(q('xml-read'), 60);
const sels = [...document.querySelectorAll('details select')]; const titleSel = sels[0];
await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(titleSel, 'URUNKODU'); titleSel.dispatchEvent(new window.Event('change', { bubbles: true })); });
await click(btn('Bu alanlarla yeniden oku'), 80);
ok('choosing another field and reading again sends the choice', xmlImp.read.length === 2 && xmlImp.read[1].body.mapping && xmlImp.read[1].body.mapping.title === 'URUNKODU', JSON.stringify(xmlImp.read[1] && xmlImp.read[1].body));
await act(async () => { root.unmount(); });

const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors or warnings', real.length === 0, real[0]);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
