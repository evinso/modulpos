import { act } from 'react';
import { createRoot } from 'react-dom/client';
import OrdersPage from '../../src/pages/orders/OrdersPage.jsx';
import { tl, approx } from '../../src/pages/orders/profitFormat.js';
import { calls } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const click = async (el, ms = 80) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };
const setVal = async (el, v) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); await wait(20); };
const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));

ok('format: Turkish thousands and decimals', tl(1234.5) === '1.234,50 ₺' && tl(null) === '—');
ok('format: a value Trendyol has not confirmed starts with "~"', approx(42, 'estimate') === '~42,00 ₺' && approx(42, 'trendyol') === '42,00 ₺');

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<OrdersPage />); });
await wait(150);
ok('the orders page has a profit tab', !!btn('Kârlılık'));
calls.length = 0;
await click(btn('Kârlılık'), 150);
ok('opening it asks for the last 30 days of Trendyol sales', calls.some((c) => c.url === '/orders/profit' && c.params && c.params.from && c.params.status === 'all'), JSON.stringify(calls[0]?.params));

const rows = () => [...document.querySelectorAll('[data-testid="profit-row"]')];
ok('three orders are listed', rows().length === 3);
const t0 = rows()[0].textContent;
ok('columns: list price, discounted sale, what the customer paid', ['200,00 ₺'].every((x) => t0.includes(x)) && rows()[1].textContent.includes('938,10 ₺') && rows()[1].textContent.includes('881,76 ₺'));
ok('a settled order shows Trendyol\'s commission and cargo without "~"', t0.includes('42,00 ₺') && !t0.includes('~42,00') && t0.includes('103,49 ₺') && !t0.includes('~103,49'));
ok('an unsettled order shows commission and cargo as estimates with "~"', rows()[1].textContent.includes('~141,08 ₺') && rows()[1].textContent.includes('~95,99 ₺'));
ok('the platform fee is always an estimate', t0.includes('~13,19 ₺'));
ok('a missing purchase cost is called out and no profit is invented', rows()[1].textContent.includes('maliyet gir') && rows()[1].textContent.includes('—'));
ok('summary cards: customer paid, commission, cargo, cost and net profit', text().includes('Müşterinin ödediği') && text().includes('1.281,76 ₺') && text().includes('Net kâr') && text().includes('-92,02 ₺'));
ok('it says how many orders are not in the profit total', text().includes('1 sipariş') && text().includes('kâr toplamına katılmadı'));

// ── open the order without a cost and type it ──
await click(rows()[1]);
ok('the detail shows the profit arithmetic', text().includes('Kâr hesabı') && text().includes('Satış KDV') && text().includes('Platform hizmet bedeli'));
const costInput = document.querySelector('input[aria-label="Birim alış maliyeti bc2"]');
ok('and an input for the purchase cost of that product', !!costInput);
calls.length = 0;
await setVal(costInput, '310');
await click(btn('Kaydet'), 120);
const put = calls.find((c) => c.m === 'PUT' && c.url === '/orders/profit/cost');
ok('saving sends the barcode and the unit cost', !!put && put.body.barcode === 'bc2' && String(put.body.unitCost) === '310', JSON.stringify(put && put.body));
ok('the list is reloaded afterwards', calls.some((c) => c.m === 'GET' && c.url === '/orders/profit'));

// ── estimate settings + refresh ──
await click(btn('Tahmin ayarları'));
const fee = document.querySelector('input[aria-label="Platform hizmet bedeli"]');
ok('estimate settings show the platform fee', !!fee && fee.value === '13.19');
calls.length = 0;
await setVal(fee, '14.5');
await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Kaydet'), 120);   // the settings panel comes before the table
const ps = calls.find((c) => c.m === 'PUT' && c.url === '/orders/profit/settings');
ok('they can be saved', !!ps && String(ps.body.serviceFee) === '14.5' && ps.body.cargoEstimate === null, JSON.stringify(ps && ps.body));
calls.length = 0;
await click(btn('kesin verileri al'), 150);
ok('"get the real figures from Trendyol" calls the refresh endpoint', calls.some((c) => c.m === 'POST' && c.url === '/orders/profit/refresh'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
