import { act } from 'react';
import { createRoot } from 'react-dom/client';
import XmlSourcesPage from '../../src/pages/xml/XmlSourcesPage.jsx';
import { calls } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const setVal = async (el, v) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); await wait(20); };

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<XmlSourcesPage />); });
await wait(200);

const input = () => document.querySelector('input[aria-label="Hizmet bedeli Tedarikçi A"]');
ok('every XML source card has its own service-fee box', !!input());
ok('it shows the saved fee (30)', input() && input().value === '30');
ok('and explains that it only applies to this source', text().includes('Yalnızca bu XML kaynağının ürünleri için geçerlidir'));
const saveBtn = () => [...input().parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Kaydet');
ok('Save is disabled until the value changes', saveBtn().disabled === true);
await setVal(input(), '35,5'.replace(',', '.'));
ok('and enabled after a change', saveBtn().disabled === false);
calls.length = 0;
await act(async () => { saveBtn().dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(120);
const put = calls.find((c) => c.m === 'PUT' && c.url === '/xml-sources/s1');
ok('saving updates THIS source only', !!put && String(put.body.orderServiceFee) === '35.5', JSON.stringify(put && put.body));
ok('the list is reloaded afterwards', calls.some((c) => c.m === 'GET' && c.url === '/xml-sources'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
