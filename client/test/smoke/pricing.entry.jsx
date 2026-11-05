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
const kindBtn = (k) => document.querySelector(`[data-testid="kind-${k}"]`);

// 1) the pricing type is chosen FIRST; nothing else is shown yet
ok('a new template starts with the type picker only', !!document.querySelector('[data-testid="kind-picker"]') && !document.querySelector('[data-testid="tab-general"]') && !document.querySelector('[data-testid="coverage-panel"]') && !btn('Kaydet'));
ok('four pricing types are explained (what / when / example)', ['percent', 'fixed', 'tiered', 'barem'].every((k) => kindBtn(k)) && text().includes('Ne zaman?') && text().includes('Örnek:') && text().includes('Nasıl fiyatlandırmak istiyorsunuz'));

// 2) percent type: only its fields
await click(kindBtn('percent'));
ok('after choosing, the form with menus and the result panel appear', !!document.querySelector('[data-testid="tab-general"]') && !!document.querySelector('[data-testid="coverage-panel"]') && text().includes('Şablon türü: Yüzde kâr'));
await setVal(document.querySelector('input[required]'), 'Deneme');
await tab('costs');
ok('percent type: single shipping amount, no table', text().includes('Kargo ücreti (₺)') && !document.querySelector('[data-testid="shipping-tiers"]'));
await tab('profit');
ok('percent type: only the rate field', text().includes('Kâr oranı (%)') && !text().includes('Ürün başına kâr (₺)') && !document.querySelector('[data-testid="profit-tiers"]') && !document.querySelector('[data-testid="barem-profit-percent"]'));
await setVal(numberInputs().find((i) => i.closest('.form-group')?.textContent.includes('Kâr oranı')), '30');

// result panel works over the real products
const panel = document.querySelector('[data-testid="coverage-panel"]');
ok('result panel shows how many products it applies to and the total', panel.textContent.includes('4098') && panel.textContent.includes('285.400,50'), panel.querySelector('[data-testid="total-profit"]')?.textContent);
ok('bands table lists the auto bands', document.querySelectorAll('[data-testid="bands"] tbody tr').length === 3 && panel.textContent.includes('₺100 üstü'));
ok('losing products are announced and can be listed', panel.textContent.includes('2 üründe zarar'));
await click(document.querySelector('[data-testid="show-losers"]'));
ok('the worst products are listed', panel.textContent.includes('Zarar eden ürün'));

// 3) switch to the fixed type
await click(document.querySelector('[data-testid="change-kind"]'));
ok('"change type" returns to the picker', !!document.querySelector('[data-testid="kind-picker"]'));
await click(kindBtn('fixed'));
await tab('profit');
ok('fixed type: only the TL field', text().includes('Ürün başına kâr (₺)') && !text().includes('Kâr oranı (%)'));

// 4) barem type
await click(document.querySelector('[data-testid="change-kind"]'));
await click(kindBtn('barem'));
ok('barem type opens on the costs menu with its explanation and a two-row table', text().includes('Barem (kademeli kargo) nasıl çalışır') && !!document.querySelector('[data-testid="shipping-tiers"]'));
const sh = document.querySelector('[data-testid="shipping-tiers"]');
ok('last row is "Üstü"; single shipping field is not offered', sh.querySelectorAll('input').length === 3 && sh.textContent.includes('Üstü') && !text().includes('Kargo ücreti (₺)'));
await click([...sh.querySelectorAll('button')].find((b) => b.textContent.includes('Satır ekle')));
ok('a third row can be added, then no more', sh.querySelectorAll('input').length === 5 && ![...sh.querySelectorAll('button')].some((b) => b.textContent.includes('Satır ekle')));
const ins = [...sh.querySelectorAll('input')];
await setVal(ins[0], '200'); await setVal(ins[1], '46'); await setVal(ins[2], '350'); await setVal(ins[3], '84'); await setVal(ins[4], '190');
ok('bands now show which shipping row applies', panel.querySelector('[data-testid="bands"] thead').textContent.includes('Kargo') && panel.textContent.includes('2. satır*'));
await setVal(ins[3], '');
const cov2 = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('incomplete table is not sent, hint shown, menu flagged', cov2.body.conditions.shippingTiers.length === 0 && text().includes('Kademe tablosunu tamamlayınca') && document.querySelector('[data-testid="tab-costs"]').textContent.includes('●'));
await setVal(ins[3], '84');
await tab('profit');
ok('barem type: profit method choice (rate / TL / table) is offered inside it', ['barem-profit-percent', 'barem-profit-fixed', 'barem-profit-tiered'].every((k) => document.querySelector(`[data-testid="${k}"]`)));
await click(document.querySelector('[data-testid="barem-profit-tiered"]'));
const pt = document.querySelector('[data-testid="profit-tiers"]');
ok('table profit inside barem opens its explanation and table', !!pt && text().includes('Kademeli kâr nasıl çalışır'));
const pins = [...pt.querySelectorAll('input')];
await setVal(pins[0], '100'); await setVal(pins[1], '40'); await setVal(pins[2], '30');
const cov = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('request carries both tables, last rows are "and above"', cov.body.conditions.shippingTiers.length === 3 && cov.body.conditions.profitTiers.length === 2 && cov.body.conditions.shippingTiers[2].upTo === null && cov.body.conditions.profitTiers[1].upTo === null, JSON.stringify(cov.body.conditions.profitTiers));

// 5) tiered type on its own; switching away clears the other tables
await click(document.querySelector('[data-testid="change-kind"]'));
await click(kindBtn('tiered'));
await tab('profit');
ok('tiered type: explanation, unit choice and table; no shipping table', text().includes('Kademeli kâr nasıl çalışır') && !!document.querySelector('[data-testid="unit-fixed"]') && !!document.querySelector('[data-testid="profit-tiers"]'));
const covT = calls.filter((c) => c.url === '/pricing/coverage').pop();
await wait(450);
const covT2 = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('switching to tiered dropped the shipping table', covT2.body.conditions.shippingTiers.length === 0);
await click(document.querySelector('[data-testid="unit-fixed"]'));
ok('unit choice switches the table to TL', document.querySelector('[data-testid="profit-tiers"]').textContent.includes('Kâr (₺)'));

// 6) rounding menu
await tab('rounding');
ok('rounding menu explains each option with an example', text().includes('Fiyat sonu nedir') && text().includes('129,37 ₺ → 129,90 ₺'));
await click(document.querySelector('[data-testid="round-ending:0.9"]'));
await wait(450);
const covR = calls.filter((c) => c.url === '/pricing/coverage').pop();
ok('rounding choice reaches the server', covR.body.conditions.roundingMode === 'ending' && covR.body.conditions.roundingEnding === 0.9);

// 7) single price try-out
const panel2 = document.querySelector('[data-testid="coverage-panel"]');
await click(document.querySelector('[data-testid="open-try"]'));
const tryInput = [...panel2.querySelectorAll('input[type="number"]')].pop();
await setVal(tryInput, '100');
ok('single-price try-out shows a result', !!panel2.querySelector('[data-testid="try-result"]'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
