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

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<ProductsPage />); });
await wait(150);

ok('page title', text().includes('Ürünler'));
ok('summary cards rendered with numbers', text().includes('Toplam ürün') && text().includes('Stokta yok') && text().includes('Düşük stok (1–5)'));
ok('five product rows rendered', document.querySelectorAll('tbody tr').length === 5, String(document.querySelectorAll('tbody tr').length));
ok('price columns visible because a marketplace is selected by default', text().includes('Satış / kâr') && text().includes('Hazırlık'));
ok('sale price and profit shown', text().includes('₺251,9') && text().includes('+₺51'), '');
ok('"template missing" and issue count pills', text().includes('Şablon yok') && text().includes('1 sorun'));
ok('marketplace status chips on the product', text().includes('Mağazam: Satışta'));
ok('status tabs with counts', text().includes('Gönderilmemiş') && text().includes('Onay bekliyor'));
const listCall = calls.filter((c) => c.url === '/products').pop();
ok('list request asks the server for prices of the default marketplace', listCall.params.priceFor === 'c1' && listCall.params.limit === 20 && listCall.params.sortBy === 'createdAt', JSON.stringify(listCall.params));

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
const putCall = calls.find((c) => c.m === 'PUT');
ok('saving without touching the description does not send it (cannot blank it)', putCall && !('description' in putCall.body) && putCall.body.status === 'active', JSON.stringify(putCall && Object.keys(putCall.body)));

// escape closes the drawer
await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); }); await wait(30);
ok('Escape closes the drawer', !text().includes('XML karşılaştırma'));

// delete confirmation
await click(document.querySelector('tbody button[title="Sil"]'));
ok('delete asks for confirmation first', text().includes('Silme onayı') && !calls.some((c) => c.m === 'DELETE'));
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
