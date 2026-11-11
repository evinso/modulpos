import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PricingPage from '../../src/pages/pricing/PricingPage.jsx';
import { calls } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(60); };
const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const setVal = async (el, v) => {
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => { setter.call(el, v); el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  await wait(450);
};
const lastCoverage = () => calls.filter((c) => c.url === '/pricing/coverage').pop();
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<PricingPage />); });
await wait(150);

// ---- list ----
ok('list shows both templates with their kind', text().includes('Genel fiyat') && text().includes('Tek kâr ₺30') && text().includes('Net marj %10'));

// ---- new template: ONE screen, two template types ----
await click(btn('Şablon Ekle'));
const form = q('template-form');
ok('one screen: both template types, costs, profit and rounding are all on it', !!form && !!q('mode-single') && !!q('mode-tiered') && !!q('cost-shipping') && !!q('cost-other') && !!q('cost-commission') && !!q('unit-percent_of_purchase') && !!q('profit-value') && !!q('rounding'));
ok('no tabs, no separate type-picker step', !document.querySelector('[role="tablist"]') && !q('kind-picker') && !q('tab-general'));
ok('the form carries no marketplace names or tariff wording', !/Trendyol|barem|Barem|Aras|hızlı/i.test(form.textContent), form.textContent.match(/Trendyol|barem|Barem|Aras|hızlı/i)?.[0]);
ok('tax options: a new template starts as a VAT payer with 20% inside the purchase price and 1% stopaj', q('input-vat').checked === true && q('purchase-vat').value === '20' && q('withholding').value === '1' && !!q('cost-service'));
ok('the result over all products is next to the form', !!q('coverage-panel'));
ok('starts as "Tek kâr" with a percent profit', q('mode-single').getAttribute('aria-pressed') === 'true' && text().includes('Kâr oranı (%)'));

// ---- single profit, percent ----
await setVal(document.querySelector('input[required]'), 'Deneme');
await setVal(q('cost-shipping'), '60'); await setVal(q('cost-other'), '10'); await setVal(q('cost-commission'), '23');
await setVal(q('profit-value'), '30');
let cov = lastCoverage();
ok('costs and the single profit reach the server', cov.body.value === 30 && cov.body.conditions.shippingCost === 60 && cov.body.conditions.packagingCost === 10 && cov.body.conditions.commissionPct === 23 && cov.body.conditions.profitMode === 'percent_of_purchase' && cov.body.conditions.profitTiers.length === 0 && cov.body.conditions.commissionBasis === 'gross', JSON.stringify(cov.body.conditions).slice(0, 200));
ok('no shipping table and no VAT option is ever sent', cov.body.conditions.shippingTiers.length === 0 && cov.body.conditions.shippingTiersExVat === undefined);
const panel = q('coverage-panel');
ok('result panel: product count, total and the price bands', panel.textContent.includes('4098') && panel.textContent.includes('285.400,50') && document.querySelectorAll('[data-testid="bands"] tbody tr').length === 3);
ok('losing products are announced and can be listed', panel.textContent.includes('2 üründe zarar'));
await click(q('show-losers'));
ok('the worst products are listed', q('coverage-panel').textContent.includes('Zarar eden ürün'));

// ---- percent <-> amount ----
await click(q('unit-fixed')); await wait(450);
cov = lastCoverage();
ok('"Tutar" switches the profit to TL', text().includes('Ürün başına kâr (₺)') && cov.body.conditions.profitMode === 'fixed');
await click(q('unit-percent_of_purchase'));

// ---- tiered profit ----
await click(q('mode-tiered'));
const tbl = q('profit-tiers');
ok('"Kademeli kâr" shows the table (two rows, last is "Üstü") and hides the single value', !!tbl && tbl.querySelectorAll('input').length === 3 && tbl.textContent.includes('Üstü') && !q('profit-value'));
const addBtn = () => [...tbl.querySelectorAll('button')].find((b) => b.textContent.includes('Satır ekle'));
await click(addBtn());
ok('a third row can be added and gets the cursor', tbl.querySelectorAll('input').length === 5 && document.activeElement && document.activeElement.getAttribute('aria-label') === '2. satır üst sınır', document.activeElement && document.activeElement.getAttribute('aria-label'));
for (let i = 0; i < 9; i++) await click(addBtn());
ok('there is no row limit: 12 rows, the add button is still there and the rows are counted', tbl.querySelectorAll('input').length === 23 && !!addBtn() && tbl.textContent.includes('12 satır'), String(tbl.querySelectorAll('input').length));
ok('a long table scrolls inside its box instead of stretching the page', q('profit-tiers-rows').style.overflowY === 'auto' && q('profit-tiers-rows').style.maxHeight === '360px');
ok('the delete buttons are skipped by the Tab key (typing goes limit -> amount -> next row)', [...tbl.querySelectorAll('button[title="Satırı sil"]')].every((b) => b.tabIndex === -1));
for (let i = 0; i < 8; i++) await click(tbl.querySelector('button[title="Satırı sil"]'));
ok('rows can be deleted again (12 -> 4)', tbl.querySelectorAll('input').length === 7, String(tbl.querySelectorAll('input').length));
const four = [...tbl.querySelectorAll('input')];
for (const [k, v] of [[0, '100'], [1, '40'], [2, '200'], [3, '35'], [4, '300'], [5, '30'], [6, '20']]) await setVal(four[k], v);
cov = lastCoverage();
ok('a table with more than three rows is sent whole, in order, last row as "and above"', JSON.stringify(cov.body.conditions.profitTiers) === JSON.stringify([{ upTo: 100, value: 40 }, { upTo: 200, value: 35 }, { upTo: 300, value: 30 }, { upTo: null, value: 20 }]), JSON.stringify(cov.body.conditions.profitTiers));
for (let i = 0; i < 2; i++) await click(tbl.querySelector('button[title="Satırı sil"]'));
ok('rows can be deleted down to two (the last one, "Üstü", stays)', tbl.querySelectorAll('input').length === 3, String(tbl.querySelectorAll('input').length));
const ins = [...tbl.querySelectorAll('input')];
await setVal(ins[0], '100'); await setVal(ins[1], '40'); await setVal(ins[2], '30');
cov = lastCoverage();
ok('tiered profit is sent with the last row as "and above"', cov.body.conditions.profitTiers.length === 2 && cov.body.conditions.profitTiers[0].upTo === 100 && cov.body.conditions.profitTiers[1].upTo === null && cov.body.value === 0, JSON.stringify(cov.body.conditions.profitTiers));
const sentBefore = calls.filter((c) => c.url === '/pricing/coverage').length;
await setVal(ins[1], '');
ok('an incomplete table is not sent to the server and the user is told', calls.filter((c) => c.url === '/pricing/coverage').length === sentBefore && text().includes('Kademe tablosunu tamamlayınca'));
await setVal(ins[1], '40');
await click(q('unit-fixed')); await wait(450);
ok('amount works in the table too', q('profit-tiers').textContent.includes('Kâr (₺)') && lastCoverage().body.conditions.profitMode === 'fixed');
await click(q('unit-percent_of_purchase'));
await click(q('mode-single')); await wait(450);
cov = lastCoverage();
ok('back to "Tek kâr" drops the table and uses the single value again', cov.body.conditions.profitTiers.length === 0 && cov.body.value === 30 && !q('profit-tiers'));

// ---- rounding ----
await setVal(q('rounding'), 'ending:0.9');
cov = lastCoverage();
ok('price ending reaches the server', cov.body.conditions.roundingMode === 'ending' && cov.body.conditions.roundingEnding === 0.9);

// ---- single price try-out ----
await click(q('open-try'));
const tryInput = [...q('coverage-panel').querySelectorAll('input[type="number"]')].pop();
await setVal(tryInput, '100');
ok('single-price try-out shows a result', !!q('try-result'));
await click(btn('Hesabı göster'));
const pb = q('profit-breakdown');
ok('the calculation lists the owner\'s items: commission, service fee, stopaj, VAT to pay, shipping, purchase, net profit', !!pb && ['Komisyon', 'Hizmet bedeli', 'Stopaj', 'Ödenecek KDV', 'Kargo', 'Alış maliyeti', 'Net kâr'].every((t) => pb.textContent.includes(t)), pb && pb.textContent);
ok('with the reference figures', pb.textContent.includes('−₺129,12') && pb.textContent.includes('−₺4,89') && pb.textContent.includes('−₺23,93') && pb.textContent.includes('₺114,77'));
await click(q('vat-toggle'));
const vd = q('vat-detail');
ok('the VAT breakdown shows where the VAT to pay comes from', !!vd && ['Satıştan oluşan KDV', 'Alıştan oluşan KDV', 'Kargodan oluşan KDV', 'Komisyondan oluşan KDV', 'Hizmet bedelinden oluşan KDV'].every((t) => vd.textContent.includes(t)) && vd.textContent.includes('₺97,82') && vd.textContent.includes('₺32,50') && vd.textContent.includes('giderlerinizden oluşan KDV düşülür'));

// ---- save ----
await click(btn('Kaydet'));
await wait(100);
const post = calls.find((c) => c.m === 'POST' && c.url === '/pricing');
ok('saving posts a plain template: name, costs, one profit, no tables', post && post.body.name === 'Deneme' && post.body.value === 30 && post.body.conditions.shippingCost === 60 && post.body.conditions.profitTiers.length === 0 && post.body.conditions.shippingTiers.length === 0 && post.body.applyTo === 'price_template', post && JSON.stringify(post.body).slice(0, 160));
ok('the new template sends the tax options', post.body.conditions.inputVat === true && post.body.conditions.purchaseVatRate === 20 && post.body.conditions.withholdingPct === 1 && post.body.conditions.serviceFee === 0, JSON.stringify([post.body.conditions.inputVat, post.body.conditions.purchaseVatRate, post.body.conditions.withholdingPct]));
ok('the dialog closes after saving', !q('template-form'));

// ---- editing a simple template ----
await click(q('edit-r1'));
ok('an existing template opens with its own values', document.querySelector('input[required]').value === 'Genel fiyat' && q('cost-shipping').value === '60' && q('cost-commission').value === '23' && q('profit-value').value === '30' && q('unit-fixed').style.border.includes('accent'));
ok('a plain template has no warning', !q('legacy-warning'));
ok('a template saved before the tax options keeps the earlier calculation and says so', q('input-vat').checked === false && q('withholding').value === '' && !!q('old-calc-note'));
await click(btn('İptal'));

// ---- editing an older template with settings this screen no longer offers ----
await click(q('edit-r2'));
ok('older settings are named in a warning', !!q('legacy-warning') && q('legacy-warning').textContent.includes('kademeli kargo') && q('legacy-warning').textContent.includes('net marj'));
ok('an old purchase-price limit is shown and can be removed', !!q('range-note') && q('range-note').textContent.includes('500'));
await click(btn('Sınırı kaldır'));
ok('limit removed', !q('range-note'));
await click(btn('Güncelle'));
await wait(100);
const put = calls.find((c) => c.m === 'PUT' && c.url === '/pricing/r2');
ok('saving an older template does NOT switch the tax options on by itself', put && put.body.conditions.inputVat === false && put.body.conditions.withholdingPct === 0 && put.body.conditions.serviceFee === 0);
ok('saving the older template drops what the screen does not offer', put && put.body.conditions.shippingTiers.length === 0 && put.body.conditions.minPurchasePrice === null && put.body.conditions.profitMode === 'percent_of_purchase', put && JSON.stringify(put.body.conditions).slice(0, 200));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
