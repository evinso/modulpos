import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import BuyboxPage from '../../src/pages/marketplaces/BuyboxPage.jsx';
import { matchesQuery } from '../../src/pages/marketplaces/buyboxSearch.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

// the pure matcher
ok('matcher: empty query matches everything', matchesQuery({ title: 'A' }, '   '));
ok('matcher: Turkish capitals fold (İNCİ finds inci)', matchesQuery({ title: 'Gümüş Kolye İNCİ' }, 'inci'));
ok('matcher: every word must be present', matchesQuery({ title: 'Altın Yüzük Taşlı', barcode: '1' }, 'yüzük taşlı') && !matchesQuery({ title: 'Altın Yüzük' }, 'yüzük kolye'));
ok('matcher: barcode and sku are searched', matchesQuery({ title: 'x', barcode: '869002' }, '8690') && matchesQuery({ title: 'x', sku: 'YZK-2' }, 'yzk'));

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<BuyboxPage />); });
await wait(200);
const rows = () => [...document.querySelectorAll('tbody tr')].filter((r) => r.querySelectorAll('td').length > 1);
const input = () => document.querySelector('input[aria-label="Ürün ara"]');
const type = async (v) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(input(), v); input().dispatchEvent(new window.Event('input', { bubbles: true })); }); await wait(30); };

ok('the three recorded products are listed', rows().length === 3, String(rows().length));
ok('a search box is there', !!input());
await type('yüzük');
ok('searching by name narrows the list', rows().length === 1 && text().includes('Altın Yüzük') && text().includes('1 / 3 ürün'), String(rows().length));
await type('869003');
ok('searching by barcode works', rows().length === 1 && text().includes('Çelik Bileklik'));
await type('klY-1');
ok('searching by SKU ignores case', rows().length === 1 && text().includes('Gümüş Kolye'));
await type('yok böyle bir şey');
ok('no match: a clear message, not an empty table', rows().length === 0 && text().includes('ile eşleşen ürün yok'));
await type('');
ok('clearing the box brings everything back', rows().length === 3 && text().includes('3 ürün kayıtlı'));
ok('the automatic price panel shows it is active', text().includes('Otomatik Fiyat Ayarı') && text().includes('Aktif'));

// ── "Tümünü kontrol et" is sent in windows, never as one long request ──
const { calls } = await import('./apiStub.cjs').then((m) => m.default || m);
const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent.includes('Tümünü')));
await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; set.call(sel, '0'); sel.dispatchEvent(new window.Event('change', { bubbles: true })); });
calls.length = 0;
const check = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('BuyBox Kontrol Et'));
await act(async () => { check.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
await wait(300);
const posts = calls.filter((c) => c.m === 'POST' && /buybox-check$/.test(c.url));
ok('check-all makes 3 windowed requests for 450 products', posts.length === 3 && posts.map((c) => c.body.offset).join() === '0,200,400', JSON.stringify(posts.map((c) => c.body)));
ok('every window is at most 200 products', posts.every((c) => c.body.batchSize === 200));
ok('the summary adds the windows up (450 checked)', text().includes('Bu seferki: 450'));
ok('the button is usable again afterwards', !!document.querySelector('button.btn-primary') && !document.querySelector('button.btn-primary').disabled);

// ── the "Otomatik Fiyat Kayıtları" tab ──
const tabBtn = () => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes('Otomatik Fiyat Kayıtları'));
ok('the tab is there', !!tabBtn());
await act(async () => { tabBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(60);
const logRowsEl = () => [...document.querySelectorAll('[data-testid="log-row"]')];
ok('three notes are listed, newest first', logRowsEl().length === 3 && logRowsEl()[0].textContent.includes('2 ürünün fiyatı düşürüldü'));
ok('each note shows kind and result', logRowsEl()[0].textContent.includes('Otomatik') && logRowsEl()[0].textContent.includes('Güncellendi') && logRowsEl()[1].textContent.includes('Ayar') && logRowsEl()[2].textContent.includes('Hata'));
ok('the status table is hidden on this tab', !text().includes('BuyBox Sırası'));
const show = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ürünleri göster'));
await act(async () => { show.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(30);
ok('the products of a note can be opened with old and new price', text().includes('Gümüş Yüzük') && text().includes('120.00₺') && text().includes('110.50₺'));
await act(async () => { [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.includes('BuyBox Durumu')).dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(30);
ok('back on the first tab the status table is shown again', text().includes('BuyBox Sırası') && !!input());

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
