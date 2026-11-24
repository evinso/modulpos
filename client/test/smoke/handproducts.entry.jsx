import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import HandProductsPage from '../../src/pages/handproducts/HandProductsPage.jsx';
import { calls, hand } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const q = (id) => document.querySelector(`[data-testid="${id}"]`); const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const btn = (label, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const errors = []; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const toasts = []; const realOk = toast.success; const realErr = toast.error; toast.success = (m, o) => { toasts.push('ok:' + m); return realOk(m, o); }; toast.error = (m, o) => { toasts.push('err:' + m); return realErr(m, o); };
const setter = (el) => Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, 'value').set;
const type = async (el, v) => { await act(async () => { setter(el).call(el, v); el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); };
const click = async (el, ms = 40) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); await wait(ms); };
const blur = async (el, ms = 60) => { await act(async () => { el.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })); el.blur(); }); await wait(ms); };
const aria = (l) => document.querySelector(`[aria-label="${l}"]`);
let where = '';
const Where = () => { where = useLocation().pathname + useLocation().search; return null; };

const P = (i, over = {}) => ({ pricing: null, id: `h${i}`, sku: `EL-${i}`, barcode: `869000000000${i}`, title: `El yapımı ürün ${i}`, price: 0, stock: 0, brand: '', vatRate: 20, status: 'active', categoryText: '', imageCount: 2, firstImage: 'https://img.example.com/a.jpg', descriptionLength: 40, sent: false, trendyolCategory: null, ...over });
hand.items = [P(1), P(2, { price: 120, stock: 5, brand: 'Atölye', trendyolCategory: { id: '1', name: 'Ev > Mutfak > Kupa', source: 'manual' } }), P(3, { imageCount: 0, firstImage: null, sent: true, price: 90, stock: 2, brand: 'Atölye' })];
hand.summary = { total: 3, noPrice: 1, noStock: 1, noBrand: 1, noBarcode: 0, noImage: 1, sent: 1, noCategory: 2, template: { exists: false, active: false, id: null, name: null, netMode: null } };
const mount = async (path = '/hand-products') => { document.getElementById('root').innerHTML = ''; const root = createRoot(document.getElementById('root')); await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Where /><HandProductsPage /></MemoryRouter>); }); await wait(120); return root; };

let root = await mount();
ok('the page lists the hand-added products and asks the server for the Trendyol connection\'s categories', qa('hand-row').length === 3 && hand.gets.every((g) => g.connectionId === 'c1') && hand.gets.some((g) => g.limit === 50), JSON.stringify(hand.gets[0]));
ok('the steps say where each thing stands: 1 without picture, 1 without a net amount, stock/brand/barcode counts, 2 without a category, NO price template', qa('hand-step').length === 5 && q('hand-steps').textContent.includes('1 ürünün fotoğrafı yok') && q('hand-steps').textContent.includes('Alış fiyatı / net tutar: 2 / 3') && q('hand-steps').textContent.includes('1 stoksuz · 1 markasız · 0 barkodsuz') && q('hand-steps').textContent.includes('Trendyol kategorisi: 1 / 3') && q('hand-steps').textContent.includes('Yok: pazaryeri fiyatı hesaplanamaz'));
ok('the row shows what is missing in words (net amount not entered, no brand, no picture) and a category button only where none is set', qa('hand-row')[0].textContent.includes('girilmemiş') && document.body.textContent.includes('Alış fiyatı / net tutar (₺)') && qa('hand-row')[0].textContent.includes('marka yok') && qa('hand-row')[2].textContent.includes('foto yok') && !!btn('Kategori ata', qa('hand-row')[0]) && !btn('Kategori ata', qa('hand-row')[1]) && qa('hand-row')[1].textContent.includes('Kupa'));
ok('a product already sent to a marketplace cannot have its barcode typed over (the box is off and says why)', aria('EL-3 barkod').disabled === true && aria('EL-3 barkod').title.includes('yeni ürün olur') && aria('EL-1 barkod').disabled === false);

// ── typing into a box saves it when you leave it ──
const before = calls.filter((c) => c.m === 'PUT').length;
await type(aria('EL-1 fiyat'), '150.5'); await blur(aria('EL-1 fiyat'));
const put1 = calls.filter((c) => c.m === 'PUT').slice(before);
ok('the price is saved on leaving the box: PUT /products/h1 { price: 150.5 }', put1.length === 1 && put1[0].url === '/products/h1' && put1[0].body.price === 150.5, JSON.stringify(put1));
await type(aria('EL-1 stok'), '-3'); await blur(aria('EL-1 stok'));
ok('an invalid stock is refused in words, nothing is sent and the old value comes back', toasts.some((t) => t.startsWith('err:Stok 0 veya daha büyük')) && calls.filter((c) => c.m === 'PUT').length === before + 1 && aria('EL-1 stok').value === '0');
await type(aria('EL-1 marka'), 'Atölye'); await blur(aria('EL-1 marka'));
await type(aria('EL-1 KDV'), '10');
ok('brand and VAT are saved the same way', calls.filter((c) => c.m === 'PUT').some((c) => c.body.brand === 'Atölye') && calls.filter((c) => c.m === 'PUT').some((c) => c.url === '/products/h1' && c.body.vatRate === 10));
await type(aria('EL-2 durum'), 'passive');
ok('the status is a choice that saves at once', calls.filter((c) => c.m === 'PUT').some((c) => c.url === '/products/h2' && c.body.status === 'passive'));

// ── filter, search ──
await type(aria('Filtre'), 'no_price'); await wait(120);
ok('a filter is sent to the server', hand.gets[hand.gets.length - 1].filter === 'no_price' && qa('hand-row').length === 1);
await type(aria('Filtre'), 'all'); await wait(120);

// ── choose many and change them at once ──
await click(aria('Sayfadakilerin hepsi'));
ok('choosing the page chooses every row and shows the bulk button', q('sel-count').textContent.includes('3') && !!q('open-bulk'));
hand.bulkRows = [{ id: 'h1', title: 'El yapımı ürün 1', before: { price: 150.5 }, after: { price: 200 } }, { id: 'h2', title: 'El yapımı ürün 2', before: { price: 120 }, after: { price: 200 } }];
hand.bulkProblems = [{ id: 'h3', title: 'El yapımı ürün 3', reason: 'Pazaryerine gönderilmiş: stok kodu ve barkod değiştirilemez (değişirse pazaryerinde yeni ürün olur): kodlar değişmedi' }];
await click(q('open-bulk'));
ok('nothing is chosen at first: preview and apply are off; the dialog says unticked parts are left alone', q('bulk-preview-go').disabled === true && q('bulk-apply').disabled === true && q('bulk-edit').textContent.includes('dokunulmaz'));
await click(q('bulk-edit').querySelector('input[type="checkbox"]'));
await type(aria('Fiyat değeri'), '200');
await click(q('bulk-preview-go'), 60);
const b0 = hand.bulks[0];
ok('the preview sends the chosen rows and ONLY the ticked part, as a dry run', b0.dryRun === true && JSON.stringify(b0.ids) === '["h1","h2","h3"]' && JSON.stringify(b0.patch) === '{"price":{"mode":"set","value":"200"}}', JSON.stringify(b0));
ok('it shows how many change, before → after and what cannot be changed and why', q('bulk-preview').textContent.includes('2 üründe değişiklik olacak') && qa('bulk-row').length === 2 && qa('bulk-row')[0].textContent.includes('150.5') && qa('bulk-row')[0].textContent.includes('200') && q('bulk-problems').textContent.includes('Pazaryerine gönderilmiş'));
await type(aria('Fiyat değeri'), '210');
ok('changing the form asks for a new preview (apply is off again)', q('bulk-apply').disabled === true && !q('bulk-preview'));
await click(q('bulk-preview-go'), 60); await click(q('bulk-apply'), 80);
const b2 = hand.bulks[hand.bulks.length - 1];
ok('apply sends the same change as a real write (dryRun false) and the selection is cleared and the list reloaded', b2.dryRun === false && b2.patch.price.value === '210' && toasts.some((t) => t === 'ok:2 ürün güncellendi') && !q('open-bulk') && !q('bulk-edit'));

// ── paste a price / stock list ──
await click(q('open-paste'));
hand.pasteItems = [{ line: 1, key: 'EL-1', price: 99, stock: 4, status: 'ok', note: '', product: { id: 'h1', title: 'El yapımı ürün 1', sku: 'EL-1', price: 150.5, stock: 0 } }, { line: 2, key: 'YOK-1', price: 5, stock: null, status: 'unmatched', note: 'Elle eklenen ürünlerde bu kodla ürün yok' }, { line: 3, key: 'X', price: null, stock: null, status: 'bad', note: 'Net tutar ya da stok yok', error: 'x' }];
ok('with no text the check is off; the dialog explains the columns and the separators', q('paste-check').disabled === true && q('paste-list').textContent.includes('stok kodu (SKU) ya da barkod') && q('paste-list').textContent.includes('sekme (Excel)'));
await type(q('paste-text'), 'SKU\tNet tutar\tStok\nEL-1\t99\t4'); await click(q('paste-check'), 60);
ok('the check sends the text as a dry run and shows every line with its status, the old values and the notes', hand.pastes[0].dryRun === true && hand.pastes[0].text.includes('EL-1') && qa('paste-row').length === 3 && q('paste-result').textContent.includes('1 güncellenecek') && q('paste-result').textContent.includes('1 üründe kod bulunamadı') && q('paste-result').textContent.includes('1 hatalı satır') && qa('paste-row')[0].textContent.includes('önce 150.5'));
await type(q('paste-text'), 'SKU\tNet tutar\tStok\nEL-1\t99\t5');
ok('changing the text asks for a new check', q('paste-apply').disabled === true && !q('paste-result'));
await click(q('paste-check'), 60); await click(q('paste-apply'), 80);
ok('apply writes (dryRun false), says how many, and closes', hand.pastes[hand.pastes.length - 1].dryRun === false && toasts.includes('ok:1 ürün güncellendi') && !q('paste-list'));

// ── the price template tab and the link that opens it ──
await click(q('tab-price'));
ok('the price tab says there is no template and links to the template screen with the hand-added scope', q('tab-price-body').textContent.includes('Henüz elle eklenen ürünler için bir şablonunuz yok') && q('open-template').getAttribute('href') === '/pricing?hand=1&mode=profit' && q('open-template').textContent.includes('Alış fiyatı + kâr şablonunu oluştur') && q('tab-price-body').textContent.includes('Elime kalacak net tutar') && where.includes('tab=price'));
hand.summary = { ...hand.summary, template: { exists: true, active: true, id: 't1', name: 'Elle eklenenler', netMode: 'profit' } };
await act(async () => { root.unmount(); }); root = await mount('/hand-products?tab=price');
ok('the tab is in the address (a link can open it) and, with a template, says it works', q('tab-price-body').textContent.includes('“Elle eklenenler” şablonu çalışıyor') && q('tab-price-body').textContent.includes('alış fiyatı olarak okunuyor') && q('open-template').textContent.includes('Şablonu aç') && q('open-template').getAttribute('href') === '/pricing?hand=1');
await click(q('tab-products'));
hand.items = [P(1, { price: 100, pricing: { salePrice: 1234.5, profit: 30.25, rule: 'Elle eklenenler', manual: false } }), P(2, { price: 80, pricing: { salePrice: 987, profit: -4.5, rule: 'Elle eklenenler', manual: false } }), P(3, { price: 50, pricing: { salePrice: null, profit: null, rule: null, manual: false } }), P(4, { price: 0, pricing: { salePrice: null, profit: null, rule: null, manual: false } })];
await act(async () => { root.unmount(); }); root = await mount('/hand-products');
ok('with a "purchase + profit" template everything is called "Alış fiyatı" (header, steps, hint), not "net tutar"', document.body.textContent.includes('Alış fiyatı (₺)') && q('hand-steps').textContent.includes('Alış fiyatı: 2 / 3') && !document.querySelector('th').textContent.includes('Net tutar') && document.body.textContent.includes('alış fiyatı, stok, marka, KDV'));
ok('the table shows the sale price the template makes of each purchase price and the profit (or the loss), and says why a row has none', qa('sale-price')[0].textContent.includes('1.234,50') && qa('sale-price')[0].textContent.includes('kâr ₺30,25') && qa('sale-price')[1].textContent.includes('zarar ₺4,50') && qa('sale-price')[2].textContent.includes('şablon yok') && qa('sale-price')[3].textContent.trim() === '—');
await click(aria('Sayfadakilerin hepsi')); await click(q('open-bulk'));
ok('the bulk change calls the first part "Alış fiyatı" and says what it means', q('bulk-edit').textContent.includes('Alış fiyatı (₺)'));
await click(q('bulk-edit').querySelector('input[type="checkbox"]'));
ok('its hint explains the profit is added by the template', q('bulk-edit').textContent.includes('şablondaki kâr eklenerek hesaplanır'));
await click(btn('Vazgeç', q('bulk-edit')));
await click(q('open-paste'));
ok('the paste dialog speaks of the purchase price too, and its example header uses it', q('paste-list').textContent.includes('alış fiyatı') && q('paste-text').getAttribute('placeholder').includes('Alış fiyatı'));
await click(btn('Vazgeç', q('paste-list')));
await act(async () => { root.unmount(); }); root = await mount('/hand-products?tab=price');
await click(q('tab-products'));
ok('back on the products tab the address is clean again', !where.includes('tab='));
await act(async () => { root.unmount(); });

root = await mount('/hand-products');
await click(btn('Göster', q('hand-steps')), 80);
ok('a "Göster" button of a step filters the table', hand.gets[hand.gets.length - 1].filter === 'no_image');
await act(async () => { root.unmount(); });

const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors or warnings', real.length === 0, real[0]);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
