import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import XmlSourcesPage from '../../src/pages/xml/XmlSourcesPage.jsx';
import toast from 'react-hot-toast';
import { calls, xmlSrc } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const click = async (el, ms = 80) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const toasts = []; const realOk = toast.success; const realErr = toast.error;
toast.success = (m, o) => { toasts.push('ok:' + m); return realOk(m, o); }; toast.error = (m, o) => { toasts.push('err:' + m); return realErr(m, o); };
let confirmAnswer = true; const asked = [];
window.confirm = (m) => { asked.push(m); return confirmAnswer; };

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<XmlSourcesPage />); });
await wait(150);

ok('an active source shows "Aktif", can be made passive and can be pulled', q('source-status').textContent === 'Aktif' && q('toggle-active').textContent.includes('Pasif yap') && !q('sync-now').disabled && !q('paused-note'));

// ---- make it passive: asks first, saves, and nothing can be pulled any more ----
confirmAnswer = false;
await click(q('toggle-active'));
ok('answering "no" changes nothing', !calls.some((c) => c.m === 'PUT' && c.url === '/xml-sources/s1') && q('source-status').textContent === 'Aktif');
ok('the question says what passive means (nothing pulled, nothing updated, products stay as they are)', asked[0].includes('hiçbir şey çekilmez') && asked[0].includes('stokları sıfırlanmaz'), asked[0] && asked[0].slice(0, 120));
confirmAnswer = true;
await click(q('toggle-active'));
const put = calls.filter((c) => c.m === 'PUT' && c.url === '/xml-sources/s1').pop();
ok('"Pasif yap" saves status paused', put && put.body.status === 'paused', JSON.stringify(put && put.body));
ok('the card shows "Pasif", says nothing is pulled, and "Şimdi Çek" is switched off', q('source-status').textContent === 'Pasif' && !!q('paused-note') && q('paused-note').textContent.includes('çekilmiyor ve güncellenmiyor') && q('sync-now').disabled === true && q('toggle-active').textContent.includes('Aktif yap'));
const before = calls.filter((c) => c.m === 'POST' && /\/sync$/.test(c.url)).length;
await click(q('sync-now'));
ok('pressing "Şimdi Çek" on a passive source starts nothing', calls.filter((c) => c.m === 'POST' && /\/sync$/.test(c.url)).length === before);

// ---- make it active again ----
await click(q('toggle-active'));
const put2 = calls.filter((c) => c.m === 'PUT' && c.url === '/xml-sources/s1').pop();
ok('"Aktif yap" saves status active, without asking again', put2.body.status === 'active' && asked.length === 2, `asked ${asked.length} times`);
ok('the card is active again and can be pulled', q('source-status').textContent === 'Aktif' && !q('paused-note') && q('sync-now').disabled === false && q('toggle-active').textContent.includes('Pasif yap'));
ok('both changes were announced', toasts.some((t) => t.startsWith('ok:') && t.includes('pasif yapıldı')) && toasts.some((t) => t.startsWith('ok:') && t.includes('aktif')));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
xmlSrc.status = 'active';
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
