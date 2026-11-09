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

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
