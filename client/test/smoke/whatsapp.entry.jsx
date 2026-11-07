import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WhatsappPage from '../../src/pages/whatsapp/WhatsappPage.jsx';
import { QR_TIMING } from '../../src/pages/whatsapp/qrTiming.js';
import { useAuthStore } from '../../src/store/authStore.js';
import { calls, wa } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(60); };
const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

// ── an admin opens the page while WAHA is not set up ──
useAuthStore.setState({ user: { id: 'u1', role: 'superadmin' } });
wa.status = { stateInstance: 'unreachable', message: 'WAHA sunucu adresi tanımlı değil. Ekleyin: WAHA_BASE_URL' };
wa.qr = { type: 'error', message: 'WAHA sunucu adresi tanımlı değil. Ekleyin: WAHA_BASE_URL' };
const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<WhatsappPage />); });
await wait(150);

ok('the card says WAHA cannot be reached and why', text().includes("WAHA'ya ulaşılamıyor") && document.querySelector('[data-testid="status-msg"]')?.textContent.includes('WAHA_BASE_URL'));
await click(btn('QR Kodu Göster'));
ok('"QR Kodu Göster" shows the reason instead of an empty box', document.querySelector('[data-testid="qr-msg"]')?.textContent.includes('WAHA_BASE_URL'));
const afterError = wa.qrCalls;
QR_TIMING.statusMs = 40; QR_TIMING.qrMs = 60; QR_TIMING.maxMs = 5000;
await wait(250);
ok('an error does not start the automatic renewal', wa.qrCalls === afterError, `${afterError} → ${wa.qrCalls}`);

// ── WAHA is there: the QR is renewed until it is scanned ──
wa.status = { stateInstance: 'notAuthorized' };
wa.qrCalls = 0;
wa.qr = (n) => (n === 1 ? { type: 'loading', message: 'Oturum başlatılıyor.' } : { type: 'qrCode', message: 'QR' + n, mimetype: 'image/png' });
QR_TIMING.qrMs = 400;
await click(btn('QR Kodu Göster'));
ok('while the session starts, a sentence is shown', document.querySelector('[data-testid="qr-msg"]')?.textContent.includes('başlatılıyor'));
await wait(450);
const img = () => document.querySelector('img[alt="QR Code"]');
ok('then the QR picture appears', !!img() && img().getAttribute('src').startsWith('data:image/png;base64,QR'), img() && img().getAttribute('src'));
const first = img() && img().getAttribute('src');
await wait(900);   // the renewal interval (400 ms) was fixed when the QR was opened
ok('the QR is renewed by itself', wa.qrCalls >= 4 && img() && img().getAttribute('src') !== first, `calls=${wa.qrCalls}`);

wa.status = { stateInstance: 'authorized' };
await wait(200);
ok('once linked, the QR disappears and the card shows it is connected', !img() && text().includes('Bağlı') && !text().includes('Bağlı Değil'));
const settled = wa.qrCalls;
await wait(250);
ok('and the renewal stops', wa.qrCalls === settled, `${settled} → ${wa.qrCalls}`);

// ── a normal user never gets the page's data ──
await act(async () => { root.unmount(); });
calls.length = 0;
useAuthStore.setState({ user: { id: 'u2', role: 'user' } });
const root2 = createRoot(document.getElementById('root'));
await act(async () => { root2.render(<WhatsappPage />); });
await wait(100);
ok('a normal user sees "no access" and nothing is requested', text().includes('erişim yetkiniz yok') && !calls.some((c) => c.url.startsWith('/whatsapp') || c.url.startsWith('/admin')), JSON.stringify(calls.map((c) => c.url)));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
