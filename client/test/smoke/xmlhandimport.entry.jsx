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
ok('the write sends the token and the row numbers (not the data) with the owner\'s own choices: VAT 20, stock 0, the store brand, codes as in the XML', xmlImp.written.length === 1 && w.token === 'tok1' && JSON.stringify(w.refs) === '[0,2,3]' && w.options.vatRate === 20 && w.options.stock === 0 && w.options.brand === 'Atölye Marka' && w.options.codes.sku.mode === 'keep' && w.options.codes.barcode.mode === 'keep', JSON.stringify(w));
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

// ---- ONE rule for the stock codes and ONE for the barcodes: the server shows what they give, and the same rules are written ----
xmlImp.written.length = 0; xmlImp.read.length = 0; xmlImp.previews.length = 0; xmlImp.previewExists = {};
xmlImp.items = [item(0), item(1), item(2), item(3)];
({ root, calls } = await mount());
await click(btn('XML adresi')); await type(q('xml-url'), 'https://x.example/a.xml'); await click(q('xml-read'), 60);
ok('the rule card is there with both choices on "as in the XML", and no preview is asked while nothing changes', !!q('xml-codes') && q('xml-sku-mode').value === 'keep' && q('xml-barcode-mode').value === 'keep' && xmlImp.previews.length === 0);
const pick = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new window.Event('change', { bubbles: true })); }); };
await pick(q('xml-sku-mode'), 'affix');
ok('"text before/after" shows its two boxes (and only those)', !!document.querySelector('[aria-label="Başına yaz"]') && !!document.querySelector('[aria-label="Sonuna yaz"]') && !document.querySelector('[aria-label="İlk numara"]'));
await type(document.querySelector('[aria-label="Başına yaz"]'), 'BEN-'); await wait(700);
ok('after the person stops typing the server is asked once with the rule (not on every key)', xmlImp.previews.length === 1 && xmlImp.previews[0].token === 'tok1' && xmlImp.previews[0].codes.sku.mode === 'affix' && xmlImp.previews[0].codes.sku.prefix === 'BEN-' && xmlImp.previews[0].codes.barcode.mode === 'keep', JSON.stringify(xmlImp.previews));
ok('the table shows the NEW stock code with the XML\'s struck through under it', qa('xml-code-cell')[0].textContent.includes('BEN-TR-0') && qa('xml-code-cell')[0].querySelector('small[style*="line-through"]') && qa('xml-code-cell')[0].querySelector('small[style*="line-through"]').textContent === 'TR-0');
await pick(q('xml-barcode-mode'), 'generate');
ok('"own barcode" explains what it is for and what it costs (a new product on Trendyol, not a catalogue match)', document.body.textContent.includes('kullanım için üretilir') && document.body.textContent.includes('yeni bir ürün olarak açılır') && !!document.querySelector('[aria-label="Başı (rakam, ör. 200)"]'));
await wait(700);
ok('the generated barcodes are listed, one per row', xmlImp.previews.length === 2 && xmlImp.previews[1].codes.barcode.mode === 'generate' && qa('xml-code-cell')[1].textContent.includes('2000000000002') && qa('xml-code-cell')[0].textContent.includes('2000000000001'), qa('xml-code-cell')[1].textContent);
xmlImp.previewExists = { 1: 'sku' };
await pick(q('xml-sku-mode'), 'counter'); await wait(700);
ok('a row whose NEW code the store already has is flagged, cannot be ticked and is counted', qa('xml-row')[1].querySelector('input').disabled === true && q('xml-codes-conflicts').textContent.includes('1 ürünün yeni kodu mağazada zaten var') && q('xml-summary').textContent.includes('1 zaten ekli ya da aynı kodlu'));
ok('the choices stay: every addable row is ticked again with "all addable" and the button counts only those', (await click(btn('Eklenebilenlerin hepsini seç')), q('xml-import-go').textContent.includes('Seçili 3 ürünü ekle')));
xmlImp.previewFail = 'Stok kodu için bir baş ya da son ek yazın'; await pick(q('xml-sku-mode'), 'affix'); await type(document.querySelector('[aria-label="Başına yaz"]'), ''); await wait(700);
ok('a rule the server refuses is shown in its words and nothing can be written meanwhile', q('xml-codes-error').textContent.includes('baş ya da son ek yazın') && q('xml-import-go').disabled === true);
xmlImp.previewFail = null; await pick(q('xml-sku-mode'), 'counter'); await type(document.querySelector('[aria-label="Başına (ör. BEN-)"]'), 'BEN-'); await wait(700);
await click(q('xml-import-go'), 100);
const w2 = xmlImp.written[0];
ok('the write carries the SAME rules the preview showed (own numbering for the stock code, own EAN-13 for the barcode) and only the rows without a conflict', w2 && JSON.stringify(w2.refs) === '[0,2,3]' && w2.options.codes.sku.mode === 'counter' && w2.options.codes.sku.prefix === 'BEN-' && w2.options.codes.sku.start === 1 && w2.options.codes.sku.pad === 4 && w2.options.codes.barcode.mode === 'generate' && w2.options.codes.barcode.digits === '200', JSON.stringify(w2));
await act(async () => { root.unmount(); });

const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors or warnings', real.length === 0, real[0]);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
