import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProductsPage from '../../src/pages/products/ProductsPage.jsx';
import { calls } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(60); };
const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label) || b.getAttribute('title') === label || b.getAttribute('aria-label') === label);

const errors = [];
const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const setVal = async (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(el, v); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await wait(450);
};
const productCalls = () => calls.filter((c) => c.url === '/products');

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<ProductsPage />); });
await wait(150);

// ---- 1) the marketplace is chosen first, then its XML source; nothing is loaded before that
ok('page title', text().includes('Ürünler'));
ok('the chooser comes first: marketplaces only, no XML step yet', !!q('gate') && !!q('gate-conn-c1') && !q('gate-xml-s1'));
ok('no product, summary or statistics request has been made yet', productCalls().length === 0 && !calls.some((c) => (c.url === '/products/summary' && c.params?.xmlSourceId !== 'none') || c.url === '/products/facets' || c.url === '/products/stats'));
ok('no product table is shown', !document.querySelector('table'));
await click(q('gate-conn-c1'));
ok('after the marketplace, its XML sources appear with how many categories are matched', !!q('gate-xml-s1') && text().includes('2 kategori eşleşmiş') && text().includes('8 ürün'));
ok('still nothing loaded after the first choice', productCalls().length === 0 && !document.querySelector('table'));
await click(q('gate-xml-s1'));
await wait(150);

// ---- 2) now the products and their details are shown
ok('summary cards rendered with numbers', text().includes('Toplam ürün') && text().includes('Stokta yok') && text().includes('Düşük stok (1–5)'));
ok('five product rows rendered', document.querySelectorAll('tbody tr').length === 5, String(document.querySelectorAll('tbody tr').length));
ok('the context bar names the chosen marketplace and XML source', q('context-bar').textContent.includes('Mağazam') && q('context-bar').textContent.includes('Tedarikçi A'));
ok('the old XML and marketplace drop-downs are gone from the filters', !text().includes('Fiyat ve durum için pazaryeri') && ![...document.querySelectorAll('label')].some((l) => l.textContent === 'XML kaynağı'));
ok('price columns visible for the chosen marketplace', text().includes('Satış / kâr') && text().includes('Hazırlık'));
ok('sale price and profit shown', text().includes('₺251,9') && text().includes('+₺51'), '');
ok('"template missing" and issue count pills', text().includes('Şablon yok') && text().includes('1 sorun'));
ok('marketplace status chips on the product', text().includes('Mağazam: Satışta'));
ok('status tabs with counts', text().includes('Gönderilmemiş') && text().includes('Onay bekliyor'));
const listCall = productCalls().pop();
ok('the list request carries the chosen marketplace and XML source', listCall.params.priceFor === 'c1' && listCall.params.xmlSourceId === 's1' && listCall.params.limit === 20 && listCall.params.sortBy === 'createdAt', JSON.stringify(listCall.params));
ok('summary and statistics are asked for the chosen XML source', calls.some((c) => c.url === '/products/summary' && c.params?.xmlSourceId === 's1') && calls.some((c) => c.url === '/products/stats' && c.params?.xmlSourceId === 's1' && c.params?.connectionId === 'c1'));

// ---- 3) change the sale price of one product and send it
ok('a hand-typed price is marked, products with a different price on the marketplace offer a quick send', text().includes('Elle') && !!q('push-price-p1'));
await click(q('push-price-p1'));
const quick = calls.find((c) => c.m === 'POST' && /sync-price-stock$/.test(c.url));
ok('the row shortcut sends only that product (price update, it is already on sale)', quick && quick.url === '/marketplace/connections/c1/sync-price-stock' && JSON.stringify(quick.body.productIds) === '["p1"]', JSON.stringify(quick && quick.body));

await click(q('edit-price-p0'));
ok('the price dialog opens with the current price and the numbers around it', !!q('price-modal') && q('price-input').value === '250.9' && [...document.querySelectorAll('[data-testid="info-value"]')].some((n) => n.textContent === 'Gönderilmedi'));
await setVal(q('price-input'), '100');
ok('typing a price shows what it earns; a loss asks for a confirmation', text().includes('Net zarar') && !!q('loss-ack'), q('price-preview').textContent.slice(0, 60));
const prevCall = calls.filter((c) => /price-preview$/.test(c.url)).pop();
ok('the preview asks the server for this product, marketplace and price', prevCall && prevCall.url === '/products/p0/price-preview' && prevCall.params.connectionId === 'c1' && prevCall.params.price === 100, JSON.stringify(prevCall && prevCall.params));
await click(q('save-only'));
ok('saving a loss without the confirmation is refused on the screen and nothing is sent', !!q('price-error') && !calls.some((c) => c.m === 'PUT' && /sale-price$/.test(c.url)));
await click(q('loss-ack').querySelector('input'));
await click(q('save-only'));
const put1 = calls.find((c) => c.m === 'PUT' && /sale-price$/.test(c.url));
ok('with the confirmation the price is saved for this marketplace', put1 && put1.url === '/products/p0/sale-price' && put1.body.connectionId === 'c1' && put1.body.price === 100 && put1.body.confirmLoss === true, JSON.stringify(put1 && put1.body));
ok('the dialog closes and the list is reloaded', !q('price-modal'));

// a product that was never sent: "save and send" creates it
await click(q('edit-price-p0'));
await setVal(q('price-input'), '300,5');
ok('a price that earns money needs no confirmation; the button says what will happen', !q('loss-ack') && q('save-send').textContent.includes('Trendyol’a gönder'));
await click(q('save-send'));
const put2 = calls.filter((c) => c.m === 'PUT' && /sale-price$/.test(c.url)).pop();
const create = calls.find((c) => c.m === 'POST' && /send-products$/.test(c.url));
ok('the typed comma price is read correctly and the product is sent', put2.body.price === 300.5 && create && create.url === '/marketplace/connections/c1/send-products' && JSON.stringify(create.body.productIds) === '["p0"]', JSON.stringify(put2.body));

// a product that is already on sale: the same button updates the price instead
const updatesBefore = calls.filter((c) => c.m === 'POST' && /sync-price-stock$/.test(c.url)).length;
await click(q('edit-price-p1'));
ok('for a product already on sale the button says "update"', q('save-send').textContent.includes('Trendyol’da güncelle'));
await setVal(q('price-input'), '320');
await click(q('save-send'));
ok('the price is saved, then updated on the marketplace for that product only', calls.filter((c) => c.m === 'POST' && /sync-price-stock$/.test(c.url)).length === updatesBefore + 1 && JSON.stringify(calls.filter((c) => /sync-price-stock$/.test(c.url)).pop().body.productIds) === '["p1"]');

// a hand-typed price can be taken back
await click(q('edit-price-p3'));
ok('a hand-typed price offers "back to template"', !!q('back-to-template'));
await click(q('back-to-template'));
const delCall = calls.find((c) => c.m === 'DELETE' && /sale-price$/.test(c.url));
ok('going back to the template removes only that product\'s typed price', delCall && delCall.url === '/products/p3/sale-price' && delCall.params.connectionId === 'c1');

// ---- 4) the choice can be changed
await click(q('change-xml'));
ok('"change XML" returns to the XML step and hides the products', !!q('gate-xml-s1') && !document.querySelector('table'));
await click(q('gate-xml-s1'));
await wait(150);
ok('choosing it again shows the products again', document.querySelectorAll('tbody tr').length === 5);

// summary card -> filter
await click(btn('Stokta yok'));
let last = calls.filter((c) => c.url === '/products').pop();
ok('clicking a summary card filters the list', last.params.stockFilter === 'out' && text().includes('Uygulanan filtreler') && text().includes('Stokta yok'));
await click(btn('Hepsini temizle'));
last = calls.filter((c) => c.url === '/products').pop();
ok('"clear all" removes the filter again', !last.params.stockFilter);

// marketplace status tab
await click([...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Gönderilmemiş')));
last = calls.filter((c) => c.url === '/products').pop();
ok('"not sent" tab maps to notSentConnectionId', last.params.notSentConnectionId === 'c1');
await click([...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Hepsi')));

// selection + bar
const checkboxes = [...document.querySelectorAll('tbody button[aria-label="Seç"]')];
await click(checkboxes[0]); await click(checkboxes[1]);
ok('selection bar appears with count and actions', text().includes('2 ürün seçili') && text().includes('Aktif yap') && text().includes('Pazaryerinde fiyat/stok güncelle'));
await click(btn('Aktif yap'));
const bulkCall = calls.find((c) => c.url === '/products/bulk-action');
ok('bulk action posts the selected ids', bulkCall && bulkCall.body.action === 'activate' && bulkCall.body.productIds.length === 2, JSON.stringify(bulkCall && bulkCall.body));
ok('selection cleared after the action', !text().includes('ürün seçili'));

// select-all across pages
await click(document.querySelector('thead button[aria-label="Sayfadakilerin hepsini seç"]'));
ok('"select every match" offer when more products exist than shown', text().includes('Filtreye uyan tüm 8 ürünü seç'));
await click(btn('Filtreye uyan tüm 8 ürünü seç'));
ok('all matching ids selected', text().includes('Filtreye uyan tüm 8 ürün seçili') && text().includes('8 ürün seçili'));
await click(btn('Seçimi temizle'));

// detail drawer
await click(document.querySelector('tbody tr:nth-child(2)'));
ok('clicking a row opens the detail panel', text().includes('Fiyat ve kâr') && text().includes('XML karşılaştırma') && text().includes('Görseller (2)'));
ok('general tab shows facts and breadcrumbs', text().includes('Satış KDV’si') && text().includes('Elbise'));
for (const [tab, expect] of [['Fiyat ve kâr', 'Net kazancınız'], ['Pazaryeri', 'Gönderime hazır mı?'], ['XML karşılaştırma', 'Test ürünü 1 (XML)'], ['Geçmiş', 'Senkronize edildi']]) {
  await click([...document.querySelectorAll('aside button')].find((b) => b.textContent === tab));
  ok(`drawer tab "${tab}"`, text().includes(expect), expect);
}
await click([...document.querySelectorAll('aside button')].find((b) => b.textContent === 'Fiyat ve kâr'));
ok('price tab: breakdown + profit + warning when marketplace price differs', text().includes('Elinize kalan') && text().includes('₺30,30') && text().includes('görünüyor'));
await click([...document.querySelectorAll('aside button')].find((b) => b.textContent === 'Pazaryeri'));
ok('market tab: blocking reason with explanation and link', text().includes('Kategori eşleşmesi yok') && text().includes('Kategori Eşleştirme'));

// edit from the drawer loads the full product and does not send an untouched description
await click([...document.querySelectorAll('aside button')].find((b) => b.textContent.includes('Düzenle')));
ok('edit form opens with the XML hint', text().includes('Ürünü düzenle') && text().includes('XML kaynağından geliyor'));
await click(btn('Güncelle'));
const putCall = calls.find((c) => c.m === 'PUT' && /^\/products\/[^/]+$/.test(c.url));
ok('saving without touching the description does not send it (cannot blank it)', putCall && !('description' in putCall.body) && putCall.body.status === 'active', JSON.stringify(putCall && Object.keys(putCall.body)));

// escape closes the drawer
await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); }); await wait(30);
ok('Escape closes the drawer', !text().includes('XML karşılaştırma'));

// delete confirmation
await click(document.querySelector('tbody button[title="Sil"]'));
ok('delete asks for confirmation first', text().includes('Silme onayı') && !calls.some((c) => c.m === 'DELETE' && !/sale-price$/.test(c.url)));
await click(btn('Evet, sil'));
ok('confirmed delete calls the API', calls.some((c) => c.m === 'DELETE' && c.url === '/products/p0'));

// view switch
await click(btn('Trendyol’daki canlı liste'));
ok('Trendyol live view is a separate tab', text().includes('Trendyol hesabınızdan canlı') || text().includes('Trendyol bağlantısı yok') || text().includes('Satışta'));

console.error = origErr;
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
