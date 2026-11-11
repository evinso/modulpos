import { act } from 'react';
import { createRoot } from 'react-dom/client';
import OrdersPage from '../../src/pages/orders/OrdersPage.jsx';
import { tl, approx } from '../../src/pages/orders/profitFormat.js';
import { calls, profitTax } from './apiStub.cjs';

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
ok('format: a value Trendyol has not confirmed starts with "~"; typed-in values do not', approx(42, 'estimate') === '~42,00 ₺' && approx(42, 'trendyol') === '42,00 ₺' && approx(42, 'manual') === '42,00 ₺');

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
ok('the supplier service fee gets its own column and card because some order has one', text().includes('Tedarikçi hizmeti') && rows()[0].textContent.includes('30,00 ₺') && rows()[1].textContent.includes('—'));
ok('summary cards: customer paid, commission, cargo, cost and net profit', text().includes('Müşterinin ödediği') && text().includes('1.281,76 ₺') && text().includes('Net kâr') && text().includes('-92,02 ₺'));
ok('it says how many orders are not in the profit total', text().includes('1 sipariş') && text().includes('kâr toplamına katılmadı'));

// ── open the order without a cost and type it ──
await click(rows()[1]);
ok('the detail shows the profit arithmetic', text().includes('Kâr hesabı') && text().includes('Satış KDV') && text().includes('Platform hizmet bedeli'));
const costInput = document.querySelector('input[aria-label="Birim alış maliyeti bc2"]');
ok('and an input for the purchase cost of that product', !!costInput);
calls.length = 0;
await setVal(costInput, '310');
await click([...costInput.parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Kaydet'), 120);   // the cost editor's own button (the detail also has a shipping editor)
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

// ── the tax model (VAT payer: the VAT inside costs comes back, stopaj): the owner's layout ──
// ── shipping fee typed in by hand (seller panel "Sipariş Kayıtları") ──
await click(rows()[0]);
ok('an order with Trendyol\'s invoice figure has no shipping editor (the invoice is final)', !document.querySelector('[data-testid="cargo-editor"]'));
await click(rows()[2]);
const ce = document.querySelector('[data-testid="cargo-editor"]');
ok('an order whose cargo invoice is not out yet has a place to type the shipping fee', !!ce && ce.textContent.includes('Sipariş Kayıtları'));
calls.length = 0;
await setVal(ce.querySelector('input[aria-label="Kargo tutarı"]'), '100');
await act(async () => { const sel = ce.querySelector('select[aria-label="Kargo tutarı KDV"]'); Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, 'exc'); sel.dispatchEvent(new window.Event('change', { bubbles: true })); }); await wait(20);
await click([...ce.querySelectorAll('button')].find((b) => b.textContent === 'Kaydet'), 120);
const pc2 = calls.find((c) => c.m === 'PUT' && c.url === '/orders/profit/cargo');
ok('saving sends the order and the VAT-inclusive amount ("KDV hariç" 100 -> 120)', !!pc2 && pc2.body.orderId === 'o3' && pc2.body.amount === 120, JSON.stringify(pc2 && pc2.body));
ok('the list is reloaded afterwards', calls.some((c) => c.m === 'GET' && c.url === '/orders/profit'));

ok('earlier method: no stopaj / VAT-to-pay columns', !text().includes('Ödenecek KDV'));
profitTax.on = true;
await click(btn('kesin verileri al'), 200);
const head = document.querySelector('thead').textContent;
ok('the table gets Stopaj and Ödenecek KDV columns', head.includes('Stopaj') && head.includes('Ödenecek KDV'));
const rr = () => [...document.querySelectorAll('[data-testid="profit-row"]')];
ok('order 1 shows stopaj 1,67 and VAT to pay (a credit here, -3,12)', rr()[0].textContent.includes('1,67 ₺') && rr()[0].textContent.includes('-3,12 ₺'), rr()[0].textContent);
ok('an order without a purchase cost shows no VAT to pay (nothing invented)', !rr()[1].textContent.includes('-3,12') && rr()[1].textContent.includes('maliyet gir'));
ok('summary cards: stopaj and VAT to pay', text().includes('Stopaj') && text().includes('10,69 ₺') && text().includes('Ödenecek KDV') && text().includes('-6,24 ₺'));
await click(rr()[0]);
const det = () => document.querySelector('[data-testid="profit-detail"]');
const dl = det() && det().textContent;
ok('the detail lists commission, fee, supplier fee, stopaj, VAT to pay, shipping, purchase and net profit', !!dl && ['Komisyon', 'Platform hizmet bedeli', 'Tedarikçi hizmet bedeli', 'Stopaj', 'Ödenecek KDV', 'Kargo', 'Alış maliyeti', 'Net kâr'].every((t) => dl.includes(t)), dl && dl.slice(0, 200));
ok('the separate "Satış KDV\'si" line is gone (it is inside the VAT to pay)', !dl.includes('Satış KDV'));
ok('a negative VAT to pay is shown as a credit', dl.includes('+ 3,12 ₺') && dl.includes('KDV alacağı'));
await click(det().querySelector('[data-testid="vat-toggle"]'), 40);
const vd2 = det().querySelector('[data-testid="vat-detail"]');
ok('the VAT breakdown names every source', !!vd2 && ['Satıştan oluşan KDV', 'Alıştan oluşan KDV', 'Kargodan oluşan KDV', 'Komisyondan oluşan KDV', 'Hizmet bedelinden oluşan KDV', 'giderlerinizden oluşan KDV düşülür'].every((t) => vd2.textContent.includes(t)));
await click(btn('Tahmin ayarları'));
const iv = document.querySelector('input[aria-label="KDV mükellefiyim"]');
ok('settings: VAT payer is on, purchase VAT 20, stopaj 1', !!iv && iv.checked === true && document.querySelector('input[aria-label="Alış maliyetindeki KDV"]').value === '20' && document.querySelector('input[aria-label="Stopaj"]').value === '1');
calls.length = 0;
await setVal(document.querySelector('input[aria-label="Stopaj"]'), '2');
await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Kaydet'), 120);
const ps2 = calls.find((c) => c.m === 'PUT' && c.url === '/orders/profit/settings');
ok('saving sends the tax options too', !!ps2 && ps2.body.inputVat === true && String(ps2.body.withholdingPct) === '2' && String(ps2.body.purchaseVatRate) === '20', JSON.stringify(ps2 && ps2.body));
profitTax.on = false;

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
