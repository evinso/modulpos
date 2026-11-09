import { act } from 'react';
import { createRoot } from 'react-dom/client';
import TrendyolSendPage from '../../src/pages/marketplaces/TrendyolSendPage.jsx';
import { calls, sendBehaviour } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };
const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));
const click = async (el, ms = 60) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<TrendyolSendPage />); });
await wait(250);

ok('the page lists the first 20 products and says there are 250', text().includes('Ürünler (250)'));
ok('"select all" offers the full filtered count, not just the page', !!btn('Filtredeki Tümünü Seç (250)'));

calls.length = 0;
await click(btn('Filtredeki Tümünü Seç'), 120);
ok('it asks the server for the ids with the same filters', calls.some((c) => /product-list\/ids$/.test(c.url)));
ok('all 250 are selected, across pages', text().includes('250 ürün seçili') && text().includes('Seçilenleri Gönder (250)'), text().match(/Seçilenleri Gönder \(\d+\)/)?.[0]);
await click(btn('Seçimi temizle'));
ok('the selection can be cleared', !text().includes('ürün seçili') && text().includes('Seçilenleri Gönder (0)'));

// ── send 250 selected: three parts of 100/100/50, with the same minimum stock ──
await click(btn('Filtredeki Tümünü Seç'), 120);
await click(btn('Seçilenleri Gönder'));
ok('the confirmation explains the parts', text().includes("100'lük partiler halinde gönderilir"));
calls.length = 0;
await click(btn('Gönder') && [...document.querySelectorAll('.modal-footer button')].find((b) => b.textContent.includes('Gönder')), 400);
const posts = calls.filter((c) => c.m === 'POST' && /send-products$/.test(c.url));
ok('250 products go out as 3 requests (100, 100, 50)', posts.length === 3 && posts.map((c) => c.body.productIds.length).join() === '100,100,50', posts.map((c) => c.body.productIds.length).join());
ok('every product is sent exactly once', new Set(posts.flatMap((c) => c.body.productIds)).size === 250);
ok('the result shows the total, not the last part', text().includes('Gönderim Tamamlandı') && document.querySelector('.modal-body').textContent.includes('250'));
await click(btn('Kapat'));

// ── Trendyol refuses part 2: the first part stays reported, the rest is not sent ──
sendBehaviour.failAt150 = true;
await click(btn('Filtredeki Tümünü Seç'), 120);
await click(btn('Seçilenleri Gönder'));
calls.length = 0;
await click([...document.querySelectorAll('.modal-footer button')].find((b) => b.textContent.includes('Gönder')), 400);
const posts2 = calls.filter((c) => c.m === 'POST' && /send-products$/.test(c.url));
ok('a refusal by Trendyol stops the run after the failing part', posts2.length === 2, String(posts2.length));
ok('what was already sent is still reported', text().includes('Gönderim Tamamlandı') && document.querySelector('.modal-body').textContent.includes('100'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
