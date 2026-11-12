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
const pickSource = async (value) => { const sel = document.querySelector('select[aria-label="XML kaynağı"]'); await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; set.call(sel, value); sel.dispatchEvent(new window.Event('change', { bubbles: true })); }); await wait(250); };

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<TrendyolSendPage />); });
await wait(250);

// ── the XML source comes first: nothing is listed, nothing can be sent ──
ok('the page starts with the XML source question', !!document.querySelector('[data-testid="source-gate"]') && text().includes('Önce XML kaynağını seçin') && text().includes('Devam etmek için yukarıdan bir XML kaynağı seçin'));
ok('no product list was asked for, and no category mappings', !calls.some((c) => /product-list|category-mappings/.test(c.url)), JSON.stringify(calls.map((c) => c.url)));
ok('no list, stats or settings are shown', !text().includes('Ürünler (') && !text().includes('Gönderilebilir') && !text().includes('Filtredeki Tümünü Seç'));
ok('"Tümünü Gönder" and "Durumları Sorgula" cannot be pressed, and say why', btn('Tümünü Gönder').disabled && btn('Durumları Sorgula').disabled && btn('Tümünü Gönder').title === 'Önce bir XML kaynağı seçin');
ok('"Seçilenleri Gönder" cannot be pressed either', btn('Seçilenleri Gönder').disabled);
ok('the old "all suppliers" choice is gone, hand-added products are a choice of their own', !text().includes('Tüm Tedarikçiler') && [...document.querySelectorAll('select[aria-label="XML kaynağı"] option')].map((o) => o.value).join() === ',s1,none');

calls.length = 0;
await pickSource('s1');
ok('choosing a source loads the products of THAT source', calls.some((c) => /connections\/c1\/product-list$/.test(c.url) && c.params.xmlSourceId === 's1'), JSON.stringify(calls.filter((c) => /product-list/.test(c.url)).map((c) => c.params)));
ok('and the mappings of that source', calls.some((c) => /c1\/category-mappings$/.test(c.url) && c.params.xmlSourceId === 's1'));
ok('the hint is gone and the buttons work', !text().includes('Devam etmek için yukarıdan') && !btn('Tümünü Gönder').disabled && !btn('Durumları Sorgula').disabled);

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

// ── nothing passes the minimum stock: the run must not end silently ──
sendBehaviour.failAt150 = false; sendBehaviour.allBelowStock = true;
await click(btn('Kapat'));
await click(btn('Filtredeki Tümünü Seç'), 120);
await click(btn('Seçilenleri Gönder'));
const minInput = document.querySelector('.modal-body input[type="number"]');
await act(async () => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(minInput, '3'); minInput.dispatchEvent(new window.Event('input', { bubbles: true })); });
await click([...document.querySelectorAll('.modal-footer button')].find((b) => b.textContent.includes('Gönder')), 400);
ok('when every part is refused for low stock, a result is still shown (not silence)', text().includes('Hiçbir Ürün Gönderilmedi'));
ok('and it names the reason and the count', text().includes('Stoğu 3 adedin altında') && document.querySelector('.modal-body').textContent.includes('250'), document.querySelector('.modal-body')?.textContent.slice(0, 160));

// ── "Tümünü Gönder" works inside the chosen source and says which ──
sendBehaviour.allBelowStock = false;
await click(btn('Kapat'), 40);
await click(btn('Tümünü Gönder'), 60);
ok('the confirmation names the source', document.querySelector('.modal-body').textContent.includes('Tedarikçi A') && document.querySelector('.modal-body').textContent.includes('içindeki tüm gönderilebilir ürünler'), document.querySelector('.modal-body')?.textContent.slice(0, 120));
calls.length = 0;
await click([...document.querySelectorAll('.modal-footer button')].find((b) => b.textContent.includes('Gönder')), 300);
const allPost = calls.find((c) => c.m === 'POST' && /send-all-ready$/.test(c.url));
ok('the request carries the source, never "everything"', !!allPost && allPost.body.xmlSourceId === 's1', JSON.stringify(allPost && allPost.body));
await click(btn('Kapat'), 40);

// ── another source: the old selection is gone (it must never be sent into the wrong source) ──
await click(btn('Filtredeki Tümünü Seç'), 120);
ok('250 products are selected in the first source', text().includes('250 ürün seçili'));
calls.length = 0;
await pickSource('none');
ok('switching source clears the selection', !text().includes('ürün seçili') && text().includes('Seçilenleri Gönder (0)'));
ok('the new source is asked for (hand-added products = none)', calls.some((c) => /product-list$/.test(c.url) && c.params.xmlSourceId === 'none'));
ok('hand-added products have no XML categories to map, so no mapping request', !calls.some((c) => /category-mappings$/.test(c.url)));
await pickSource('');
ok('going back to "choose" hides the list again', text().includes('Devam etmek için yukarıdan bir XML kaynağı seçin') && !text().includes('Ürünler (') && btn('Tümünü Gönder').disabled);

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
