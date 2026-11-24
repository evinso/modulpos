import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProductsPage from '../../src/pages/products/ProductsPage.jsx';
import { MemoryRouter } from 'react-router-dom';
import toast from 'react-hot-toast';
import { calls, handCfg, uploads } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.FileReader = window.FileReader;   // the harness copies only a few browser globals; the form reads a chosen photo with FileReader
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
await act(async () => { root.render(<MemoryRouter><ProductsPage /></MemoryRouter>); });
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

// hand-priced products: row warning, tab, and giving them back to the template
ok('a hand-priced product that loses money is marked on its row (and only that one)', !!q('loss-p3') && !q('loss-p0') && !q('loss-p1'));
const manualTab = [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Elle fiyatlı'));
ok('the "Elle fiyatlı" tab appears (with its count) because there is a hand-priced product', !!manualTab && manualTab.textContent.includes('1'));
await click(manualTab);
last = calls.filter((c) => c.url === '/products').pop();
ok('the tab asks only for products with a hand-typed price on this marketplace', last.params.manualPriceConnectionId === 'c1' && !last.params.marketplaceStatus && !last.params.connectionId && !last.params.notSentConnectionId, JSON.stringify(last.params));
ok('the tab explains itself and offers to reset them all', !!q('manual-banner') && !!q('reset-all-manual') && text().includes('Elle fiyatlı ürünler'));
await click(q('reset-all-manual'));
ok('resetting asks first; nothing is sent to the marketplace unless asked', !!q('reset-dialog') && q('reset-send').checked === false && !calls.some((c) => c.url === '/products/reset-manual-prices'));
await click(q('reset-confirm'));
const resetAll = calls.find((c) => c.url === '/products/reset-manual-prices');
ok('"reset all" posts the marketplace and XML source and NO product list (the server decides which)', resetAll && resetAll.body.connectionId === 'c1' && resetAll.body.xmlSourceId === 's1' && !('productIds' in resetAll.body), JSON.stringify(resetAll && resetAll.body));
ok('the dialog closes and the list leaves the hand-priced tab', !q('reset-dialog') && !q('manual-banner'));
const sendsBefore = calls.filter((c) => c.m === 'POST' && /sync-price-stock$/.test(c.url)).length;
ok('without the checkbox nothing was sent to Trendyol', sendsBefore === updatesBefore + 1);

const picks = [...document.querySelectorAll('tbody button[aria-label="Seç"]')];
await click(picks[1]); await click(picks[3]);
ok('with a selection the bar offers "Şablon fiyatına döndür"', !!q('reset-selected-manual'));
await click(q('reset-selected-manual'));
await click(q('reset-send'));
await click(q('reset-confirm'));
const resetSel = calls.filter((c) => c.url === '/products/reset-manual-prices').pop();
ok('the selected ids are posted', resetSel.body.productIds.length === 2 && resetSel.body.productIds.includes('p1') && resetSel.body.productIds.includes('p3'), JSON.stringify(resetSel.body));
const sentAfter = calls.filter((c) => c.m === 'POST' && /sync-price-stock$/.test(c.url));
ok('with the checkbox ONLY the products that are on sale are sent, in the existing update route', sentAfter.length === sendsBefore + 1 && JSON.stringify(sentAfter.pop().body.productIds) === '["p1"]');
ok('the selection is cleared afterwards', !text().includes('ürün seçili'));

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

// ---- a product added by hand: its "price" is the NET amount to keep; images, brand and barcode are needed for the marketplace ----
const field = (label) => [...document.querySelectorAll('.modal .form-group')].find((g) => g.querySelector('label') && g.querySelector('label').textContent.startsWith(label));
const put = async (g, v) => {
  const el = g.tagName === 'TEXTAREA' || g.tagName === 'INPUT' || g.tagName === 'SELECT' ? g : g.querySelector('input:not([type="file"]), textarea, select');
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : (el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype);
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
  await wait(10);
};
await click(btn('Yeni ürün'));
ok('the new-product form says the price is the net amount to keep', !!q('hand-note') && field('Elime kalacak net tutar') && q('hand-note').textContent.includes('satıştan sonra size kalması gereken net tutardır'));
ok('a template exists for hand-added products (the shop has an unscoped one): no warning', !q('no-template-note'));
ok('the marketplace needs these: barcode, brand, description and pictures are required fields', field('Barkod').querySelector('input').required && field('Marka').querySelector('input').required && q('description').required && !!q('image-urls') && !!field('Görseller'));
await click(btn('İptal'));

handCfg.scoped = true;      // now every template is limited to one XML source: nothing would price a hand-added product
await click(btn('Yeni ürün'));
await wait(100);
ok('without a template for hand-added products the form says what to create and where', !!q('no-template-note') && q('no-template-note').textContent.includes('Elle eklenen ürünler') && !!q('no-template-note').querySelector('a[href="/pricing"]'));
await put(field('SKU'), 'EL-1'); await put(field('Barkod'), '8691234567890'); await put(field('Ürün adı'), 'El yapımı kupa');
await put(field('Elime kalacak net tutar'), '100'); await put(field('Marka'), 'Atölye'); await put(field('Stok'), '5'); await put(field('Açıklama'), 'Elde boyanmış seramik kupa');
const toasts = []; const realToastError = toast.error; toast.error = (m, o) => { toasts.push(String(m)); return realToastError(m, o); };
const saves = () => calls.filter((c) => c.m === 'POST' && c.url === '/products' && c.body && c.body.sku === 'EL-1');
await click(btn('Kaydet'));
ok('no picture: not saved, and it says why', saves().length === 0 && toasts.some((t) => t.includes('En az bir görsel')), toasts.join(' | '));

// a photo from this device: uploaded, its public address lands in the list, a thumbnail shows
const photo = document.querySelector('[data-testid="photo-input"]');
const sendFiles = async (files) => { Object.defineProperty(photo, 'files', { value: files, configurable: true }); await act(async () => { photo.dispatchEvent(new window.Event('change', { bubbles: true })); }); await wait(200); };
await sendFiles([new window.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], 'kupa.jpg', { type: 'image/jpeg' })]);
ok('a photo is uploaded as base64 and its address is added to the list', uploads.length === 1 && uploads[0].size > 0 && q('image-urls').value === 'https://api.modulpos.com/api/uploads/000000000-0000-4000-8000-000000000001.jpg'.replace('000000000-', '00000000-'), q('image-urls').value);
ok('a thumbnail is shown, the first one is marked as the main picture', document.querySelectorAll('[data-testid="thumb"]').length === 1 && q('thumbs').textContent.includes('Ana'));
await sendFiles([new window.File([new Uint8Array([1, 2, 3])], 'not-a-picture.pdf', { type: 'application/pdf' })]);
ok('a file that is not a JPG/PNG/WebP is refused with a sentence and nothing is uploaded', uploads.length === 1 && toasts.some((t) => t.includes('not-a-picture.pdf') && t.includes('JPG, PNG ya da WebP')), toasts.slice(-1)[0]);
await put(q('image-urls'), q('image-urls').value + '\nhttps://example.com/b.jpg\n');
ok('a typed link and the uploaded photo live in the same list', document.querySelectorAll('[data-testid="thumb"]').length === 2);

// the Trendyol category is chosen in the same form
ok('the form has a Trendyol category field (required for a new product) and nothing is chosen yet', !!q('trendyol-category') && q('chosen-category').textContent === 'Henüz seçilmedi' && q('trendyol-category').textContent.includes('Trendyol kategorisi *'));
await click(btn('Kaydet'));
ok('no category: not saved, and it says why', saves().length === 0 && toasts.some((t) => t.includes('Trendyol kategorisini seçin')), toasts.slice(-1)[0]);
await click(q('pick-category'));
ok('the picker opens above the form', !!document.querySelector('[role="dialog"][aria-label="Trendyol kategorisi seç"]') && document.querySelector('[role="dialog"]').style.zIndex === '1200');
await setVal(document.querySelector('[aria-label="Kategori ara"]'), 'pense');
await wait(400);
ok('typing finds categories in the Trendyol tree', document.querySelectorAll('[data-testid="picker-result"]').length >= 1, text().slice(-120));
await click(document.querySelector('[data-testid="picker-result"]'));
ok('the chosen category is shown with its full path and the picker is closed', q('chosen-category').textContent.includes('Hırdavat > Manuel El Aletleri > Pense') && !document.querySelector('[role="dialog"]') && field('Kategori (kendi notunuz)').querySelector('input').value === 'Pense');
ok('the picker did not submit the product', saves().length === 0);

// remove the typed link again, then save
await click(document.querySelectorAll('[data-testid="remove-thumb"]')[1]);
ok('removing a thumbnail removes that address from the list', document.querySelectorAll('[data-testid="thumb"]').length === 1 && !q('image-urls').value.includes('example.com'));
await click(btn('Kaydet'));
await wait(150);
const created = saves().pop();
ok('saved: the net amount as the price and the uploaded photo address as the picture', created && created.body.price === 100 && created.body.brand === 'Atölye' && created.body.barcode === '8691234567890'
  && created.body.images.length === 1 && /\/api\/uploads\/[0-9a-f-]{36}\.jpg$/.test(created.body.images[0]), created && JSON.stringify(created.body).slice(0, 220));
const assign = calls.filter((c) => c.m === 'PUT' && c.url === '/marketplace/connections/c1/product-categories').pop();
ok('and the chosen Trendyol category is assigned to the new product in the same step', assign && assign.body.assignments.length === 1 && assign.body.assignments[0].productId === 'new1' && assign.body.assignments[0].categoryId === '10' && assign.body.assignments[0].source === 'manual', JSON.stringify(assign && assign.body));
handCfg.scoped = false;

// the template reads the number as a PURCHASE price (+ profit): the form must not call it "net amount"
handCfg.mode = 'profit';
await click(btn('Yeni ürün'));
await wait(100);
ok('with a "purchase + profit" template the form asks for the purchase price, not a net amount', !!field('Alış fiyatı') && !field('Elime kalacak net tutar') && q('hand-note').textContent.includes('ürünün alış fiyatıdır') && q('hand-note').textContent.includes('kâr ile birlikte') && !q('hand-note').textContent.includes('net tutardır'), q('hand-note') && q('hand-note').textContent.slice(0, 160));
ok('and its hint says the same', q('price-hint').textContent.includes('alış fiyatı') && !q('price-hint').textContent.includes('elinize geçmesini'));
await put(field('SKU'), 'EL-9'); await put(field('Barkod'), '869'); await put(field('Ürün adı'), 'Kupa'); await put(q('image-urls'), 'https://example.com/a.jpg'); await put(field('Alış fiyatı'), '0'); await put(field('Marka'), 'Atölye'); await put(field('Açıklama'), 'Kupa');   // an empty box is stopped by the browser itself (required), a 0 reaches our message
await click(btn('Kaydet'));
ok('with a 0 price it asks for the purchase price in words', toasts[toasts.length - 1] === 'Alış fiyatını yazın', toasts.slice(-2).join(' | '));
await click(btn('İptal'));
handCfg.mode = 'purchase';
await click(btn('Yeni ürün'));
await wait(100);
ok('"purchase" mode: purchase price too, no mention of the template profit', !!field('Alış fiyatı') && !q('hand-note').textContent.includes('kâr ile birlikte'));
await click(btn('İptal'));
handCfg.mode = null;

console.error = origErr;
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
