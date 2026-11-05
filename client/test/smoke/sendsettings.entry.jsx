import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SendSettingsPanel from '../../src/pages/marketplaces/SendSettingsPanel.jsx';
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
  await wait(30);
};
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<SendSettingsPanel connectionId="c1" onSaved={() => {}} />); });
await wait(120);

ok('the saved summary is shown on the closed panel', text().includes('2 kelime çıkarılır'));
await click(btn('Gönderim ayarları'));
const input = document.querySelector('[data-testid="remove-words"]');
ok('words to remove: the saved list is shown as comma separated text', !!input && input.value === 'Çeyrek, Reşat', input && input.value);
ok('the field explains what it does and that products stay unchanged', text().includes('ürününüz sistemde değişmez') && text().includes('yasaklı kelime'));

await setVal(input, 'Çeyrek, Reşat, Külçe');
await click(btn('Ayarları kaydet'));
const put = calls.find((c) => c.m === 'PUT' && c.url === '/marketplace/connections/c1/send-settings');
ok('saving sends the words', put && put.body.settings.removeWords === 'Çeyrek, Reşat, Külçe', put && JSON.stringify(put.body.settings.removeWords));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
