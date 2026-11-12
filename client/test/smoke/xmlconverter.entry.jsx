import { act } from 'react';
import { createRoot } from 'react-dom/client';
import XmlConverterPage from '../../src/pages/xml/XmlConverterPage.jsx';
import { ago, feedSummary, fmtDateTime } from '../../src/pages/xml/converterFeed.js';
import { calls, conv } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const click = async (el, ms = 80) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };
const setVal = async (el, v) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); await wait(20); };
const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));

// ── the wording helpers ──
const NOW = Date.parse('2026-11-12T10:00:00Z');
ok('ago: minutes, hours, yesterday, days', ago('2026-11-12T09:59:40Z', NOW) === 'az önce' && ago('2026-11-12T09:25:00Z', NOW) === '35 dk önce' && ago('2026-11-12T07:00:00Z', NOW) === '3 sa önce' && ago('2026-11-11T08:00:00Z', NOW) === 'dün' && ago('2026-11-08T08:00:00Z', NOW) === '4 gün önce');
ok('ago/fmt: garbage gives nothing instead of "Invalid Date"', ago('x', NOW) === '' && fmtDateTime('x') === '');
ok('summary: nothing recorded', feedSummary(null, NOW).kind === 'none');
ok('summary: converted but never pulled', feedSummary({ convertedAt: '2026-11-12T09:00:00Z', productCount: 5, servedAt: null }, NOW).kind === 'converted');
const good = feedSummary({ servedAt: '2026-11-12T07:00:00Z', servedOk: true, productCount: 4161, sourceModifiedAt: '2026-11-12T06:50:00Z' }, NOW);
ok('summary: pulled fine, with the supplier\'s own date', good.kind === 'ok' && good.ago === '3 sa önce' && good.count === 4161 && good.source.ago === '3 sa önce');
ok('summary: a failed pull is called failed and keeps the reason', feedSummary({ servedAt: '2026-11-12T07:00:00Z', servedOk: false, servedError: 'HTTP 503' }, NOW).kind === 'failed');

// ── the page ──
const hAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const A = 'https://tedarikci-a.example.invalid/export.xml';
const B = 'https://tedarikci-b.example.invalid/feed.xml';
const C = 'https://tedarikci-c.example.invalid/urunler.xml';
const entry = (u, n) => ({ originalUrl: u, proxyUrl: 'https://api.example.invalid/api/xml-converter/proxy?url=' + encodeURIComponent(u), productCount: n, date: hAgo(30) });
localStorage.setItem('xmlConverterHistory', JSON.stringify([entry(A, 3364), entry(B, 4161), entry(C, 10)]));
conv.feeds = {
  [A]: { productCount: 3364, convertedAt: hAgo(30), servedAt: hAgo(2), servedOk: true, servedError: null, sourceModifiedAt: hAgo(2.1) },
  [B]: { productCount: 4161, convertedAt: hAgo(30), servedAt: hAgo(0.5), servedOk: true, servedError: null, sourceModifiedAt: null },
  [C]: { productCount: 10, convertedAt: hAgo(30), servedAt: hAgo(5), servedOk: false, servedError: 'XML URL\'si HTTP 503 döndürdü', sourceModifiedAt: null },
};

const root = createRoot(document.getElementById('root'));
calls.length = 0;
await act(async () => { root.render(<XmlConverterPage />); });
await wait(150);

const status = calls.filter((c) => c.url === '/xml-converter/feeds/status');
ok('opening the page asks (once, free) for the update time of every converted address in the history', status.length === 1 && JSON.stringify(status[0].body.urls) === JSON.stringify([A, B, C]), JSON.stringify(status.map((c) => c.body)));
const boxes = () => [...document.querySelectorAll('[data-testid="converter-feed-status"]')];
ok('each history entry shows its status', boxes().length === 3);
ok('a pulled feed shows "Son güncelleme" with the time, how long ago and the product count', boxes()[0].textContent.includes('Son güncelleme') && boxes()[0].textContent.includes('2 sa önce') && boxes()[0].textContent.includes('3364 ürün'), boxes()[0].textContent);
ok('and the supplier\'s own file date when it sends one', boxes()[0].textContent.includes('Kaynak dosya tarihi') && !boxes()[0].textContent.includes('bildirmiyor'));
ok('a supplier that sends no date is said to send none (not silently left out)', boxes()[1].textContent.includes('Tedarikçi dosyanın tarihini bildirmiyor') && boxes()[1].textContent.includes('30 dk önce'), boxes()[1].textContent);
ok('a failed pull is shown as failed with the reason, not as an update', boxes()[2].textContent.includes('Başarısız') && boxes()[2].textContent.includes('HTTP 503') && !boxes()[2].textContent.includes('10 ürün'), boxes()[2].textContent);

// ── refresh: free, picks up a newer pull ──
conv.feeds[A] = { ...conv.feeds[A], servedAt: new Date().toISOString() };
calls.length = 0;
await click(btn('Güncelleme bilgilerini yenile'), 150);
ok('"Güncelleme bilgilerini yenile" asks again', calls.filter((c) => c.url === '/xml-converter/feeds/status').length === 1);
ok('and the new time is shown', boxes()[0].textContent.includes('az önce'), boxes()[0].textContent);
ok('it costs nothing (no preview call)', !calls.some((c) => c.url === '/xml-converter/preview'));

// ── a new conversion: the result and the address box show it, "not pulled yet" until a XML source pulls it ──
const D = 'https://yeni-tedarikci.example.invalid/x.xml';
conv.previewFeed = { productCount: 4161, convertedAt: new Date().toISOString(), servedAt: null, servedOk: null, servedError: null, sourceModifiedAt: null };
await setVal(document.querySelector('input.form-input'), D);
calls.length = 0;
await click(btn('Dönüştür ('), 200);
ok('converting sends the address to the preview', calls.some((c) => c.url === '/xml-converter/preview' && c.body.url === D));
const after = boxes().map((b) => b.textContent);
ok('the status appears in the result card and the history only (4 history entries + 1 result card)', boxes().length === 5, String(boxes().length));
ok('the result card says it has not been pulled by any XML source yet', after.some((t) => t.includes('Henüz çekilmedi') && t.includes('dönüştürüldü')), after.join(' | '));
ok('the page did not need a second request for it (the preview answer carries it)', calls.filter((c) => c.url === '/xml-converter/feeds/status').length === 0);
ok('the new conversion is listed in the history too', text().includes(D));

ok('no console errors', errors.length === 0, errors[0]);
console.log(fails ? `FAIL=${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
