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
const setVal = async (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await wait(450);
};
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<PricingPage />); });
await wait(150);

await click(btn('Şablon Ekle') || btn('Yeni') || [...document.querySelectorAll('button')].find((b) => /şablon/i.test(b.textContent)));
ok('template form opens', text().includes('Giderleriniz') && text().includes('Kârınız') && text().includes('Gelişmiş'));

// result panel works over the real products, no example price needed
await setVal(document.querySelector('input[required]'), 'Deneme'); // template name
const numberInputs = () => [...document.querySelectorAll('input[type="number"]')];
await setVal(numberInputs().find((i) => !i.disabled && i.closest('.form-group')?.textContent.includes('Kâr oranı')), '30');
const panel = document.querySelector('[data-testid="coverage-panel"]');
ok('result panel shows how many products it applies to and the total', panel.textContent.includes('4098') && panel.textContent.includes('285.400,50'), panel.querySelector('[data-testid="total-profit"]')?.textContent);
ok('bands table lists the auto bands', document.querySelectorAll('[data-testid="bands"] tbody tr').length === 3 && panel.textContent.includes('₺100 üstü'));
ok('losing products are announced and can be listed', panel.textContent.includes('2 üründe zarar'));
await click(document.querySelector('[data-testid="show-losers"]'));
ok('the worst products are listed', panel.textContent.includes('Zarar eden ürün'));

// advanced section is closed by default
ok('advanced options are hidden at first', !document.querySelector('[data-testid="open-shipping-tiers"]') && !document.querySelector('[data-testid="profit-tiers"]'));
await click(document.querySelector('[data-testid="toggle-advanced"]'));
ok('advanced section offers both tables', !!document.querySelector('[data-testid="open-shipping-tiers"]') && !!document.querySelector('[data-testid="open-profit-tiers"]'));

// shipping table
await click(document.querySelector('[data-testid="open-shipping-tiers"]'));
const sh = document.querySelector('[data-testid="shipping-tiers"]');
ok('shipping table opens with two rows, the last is "Üstü"', !!sh && sh.querySelectorAll('input').length === 3 && sh.textContent.includes('Üstü'));
await click([...sh.querySelectorAll('button')].find((b) => b.textContent.includes('Satır ekle')));
ok('a third row can be added, then no more', sh.querySelectorAll('input').length === 5 && ![...sh.querySelectorAll('button')].some((b) => b.textContent.includes('Satır ekle')));
const ins = [...sh.querySelectorAll('input')];
await setVal(ins[0], '200'); await setVal(ins[1], '46'); await setVal(ins[2], '350'); await setVal(ins[3], '84'); await setVal(ins[4], '190');
ok('single shipping field is disabled while the table is on', numberInputs().some((i) => i.disabled));
ok('bands now show which shipping row applies', panel.querySelector('[data-testid="bands"] thead').textContent.includes('Kargo') && panel.textContent.includes('2. satır*'));

// profit table
await click(document.querySelector('[data-testid="open-profit-tiers"]'));
const pt = document.querySelector('[data-testid="profit-tiers"]');
ok('profit table opens', !!pt);
const pins = [...pt.querySelectorAll('input')];
await setVal(pins[0], '100'); await setVal(pins[1], '40'); await setVal(pins[2], '30');
const cov = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('coverage request carries both tables', cov.body.conditions.shippingTiers.length === 3 && cov.body.conditions.profitTiers.length === 2, JSON.stringify(cov.body.conditions.shippingTiers));
ok('last row is sent as "and above" (upTo null)', cov.body.conditions.shippingTiers[2].upTo === null && cov.body.conditions.profitTiers[1].upTo === null);

// incomplete table: nothing is sent, user is told
await setVal(ins[3], '');
const cov2 = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('incomplete table is not sent (feature off) and a hint is shown', cov2.body.conditions.shippingTiers.length === 0 && text().includes('Kademe tablosunu tamamlayınca'));
await setVal(ins[3], '84');

// single price try-out
await click(document.querySelector('[data-testid="open-try"]'));
const tryInput = [...panel.querySelectorAll('input[type="number"]')].pop();
await setVal(tryInput, '100');
ok('single-price try-out shows the result and which shipping row it used', panel.querySelector('[data-testid="try-result"]')?.textContent.includes('314') && panel.textContent.includes('Uygulanan kargo: 2. satır'));

// closing the tables returns to single amounts
await click(btn('Tabloyu kapat, tek tutar kullan'));
ok('closing the shipping table brings the single field back', !document.querySelector('[data-testid="shipping-tiers"]'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
