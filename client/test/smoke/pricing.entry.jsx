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

const numberInputs = () => [...document.querySelectorAll('input[type="number"]')];
const tab = async (k) => click(document.querySelector(`[data-testid="tab-${k}"]`));
ok('four menus are offered', ['general', 'costs', 'profit', 'rounding'].every((k) => document.querySelector(`[data-testid="tab-${k}"]`)));
ok('General menu explains the template and shows the scope', !!document.querySelector('[data-testid="pane-general"]') && text().includes('Bu şablon ne işe yarar'));
await setVal(document.querySelector('input[required]'), 'Deneme');

// Profit menu: only the chosen method's fields are shown
await tab('profit');
ok('profit menu offers three methods and explains net profit', ['profit-percent', 'profit-fixed', 'profit-tiered'].every((k) => document.querySelector(`[data-testid="${k}"]`)) && text().includes('net kârdır'));
ok('percent method shows only the rate field', text().includes('Kâr oranı (%)') && !text().includes('Ürün başına kâr (₺)') && !document.querySelector('[data-testid="profit-tiers"]'));
await click(document.querySelector('[data-testid="profit-fixed"]'));
ok('fixed method shows only the TL field', text().includes('Ürün başına kâr (₺)') && !text().includes('Kâr oranı (%)'));
await click(document.querySelector('[data-testid="profit-percent"]'));
await setVal(numberInputs().find((i) => i.closest('.form-group')?.textContent.includes('Kâr oranı')), '30');

// result panel works over the real products, no example price needed
const panel = document.querySelector('[data-testid="coverage-panel"]');
ok('result panel shows how many products it applies to and the total', panel.textContent.includes('4098') && panel.textContent.includes('285.400,50'), panel.querySelector('[data-testid="total-profit"]')?.textContent);
ok('bands table lists the auto bands', document.querySelectorAll('[data-testid="bands"] tbody tr').length === 3 && panel.textContent.includes('₺100 üstü'));
ok('losing products are announced and can be listed', panel.textContent.includes('2 üründe zarar'));
await click(document.querySelector('[data-testid="show-losers"]'));
ok('the worst products are listed', panel.textContent.includes('Zarar eden ürün'));

// Costs menu: shipping method cards
await tab('costs');
ok('costs menu explains costs and offers two shipping methods', text().includes('Giderler nedir') && !!document.querySelector('[data-testid="ship-single"]') && !!document.querySelector('[data-testid="ship-tiers"]'));
ok('single method shows the amount field, not the table', text().includes('Kargo ücreti (₺)') && !document.querySelector('[data-testid="shipping-tiers"]'));
await click(document.querySelector('[data-testid="ship-tiers"]'));
const sh = document.querySelector('[data-testid="shipping-tiers"]');
ok('barem method explains itself and opens a two-row table, last row "Üstü"', text().includes('Barem (kademeli kargo) nasıl çalışır') && !!sh && sh.querySelectorAll('input').length === 3 && sh.textContent.includes('Üstü'));
ok('the single amount field is gone while the table is used', !text().includes('Kargo ücreti (₺)'));
await click([...sh.querySelectorAll('button')].find((b) => b.textContent.includes('Satır ekle')));
ok('a third row can be added, then no more', sh.querySelectorAll('input').length === 5 && ![...sh.querySelectorAll('button')].some((b) => b.textContent.includes('Satır ekle')));
const ins = [...sh.querySelectorAll('input')];
await setVal(ins[0], '200'); await setVal(ins[1], '46'); await setVal(ins[2], '350'); await setVal(ins[3], '84'); await setVal(ins[4], '190');
ok('bands now show which shipping row applies', panel.querySelector('[data-testid="bands"] thead').textContent.includes('Kargo') && panel.textContent.includes('2. satır*'));

// incomplete table: nothing is sent, the menu is flagged, the user is told
await setVal(ins[3], '');
const cov2 = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('incomplete table is not sent (feature off), hint shown, menu flagged', cov2.body.conditions.shippingTiers.length === 0 && text().includes('Kademe tablosunu tamamlayınca') && document.querySelector('[data-testid="tab-costs"]').textContent.includes('●'));
await setVal(ins[3], '84');

// Profit menu: tiered method
await tab('profit');
await click(document.querySelector('[data-testid="profit-tiered"]'));
const pt = document.querySelector('[data-testid="profit-tiers"]');
ok('tiered profit explains itself, offers a unit choice and a table', !!pt && text().includes('Kademeli kâr nasıl çalışır') && !!document.querySelector('[data-testid="unit-fixed"]') && !text().includes('Kâr oranı (%) *'));
const pins = [...pt.querySelectorAll('input')];
await setVal(pins[0], '100'); await setVal(pins[1], '40'); await setVal(pins[2], '30');
const cov = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('coverage request carries both tables, last rows are "and above"', cov.body.conditions.shippingTiers.length === 3 && cov.body.conditions.profitTiers.length === 2 && cov.body.conditions.shippingTiers[2].upTo === null && cov.body.conditions.profitTiers[1].upTo === null, JSON.stringify(cov.body.conditions.profitTiers));
await click(document.querySelector('[data-testid="unit-fixed"]'));
ok('unit choice switches the table to TL', pt.textContent.includes('Kâr (₺)'));

// Rounding menu
await tab('rounding');
ok('rounding menu explains each option with an example', text().includes('Fiyat sonu nedir') && text().includes('129,37 ₺ → 129,90 ₺'));
await click(document.querySelector('[data-testid="round-ending:0.9"]'));
await wait(450);
const covR = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('rounding choice reaches the server', covR.body.conditions.roundingMode === 'ending' && covR.body.conditions.roundingEnding === 0.9);

// single price try-out
await click(document.querySelector('[data-testid="open-try"]'));
const tryInput = [...panel.querySelectorAll('input[type="number"]')].pop();
await setVal(tryInput, '100');
ok('single-price try-out shows the result and which shipping row it used', panel.querySelector('[data-testid="try-result"]')?.textContent.includes('314') && panel.textContent.includes('Uygulanan kargo: 2. satır'));

// back to a single shipping amount
await tab('costs');
await click(document.querySelector('[data-testid="ship-single"]'));
ok('choosing the single amount again removes the table', !document.querySelector('[data-testid="shipping-tiers"]') && text().includes('Kargo ücreti (₺)'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
