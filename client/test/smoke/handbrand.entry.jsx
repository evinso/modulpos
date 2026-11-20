import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ProductFormModal from '../../src/pages/products/ProductFormModal.jsx';
import { storeBrandOf } from '../../src/pages/products/storeBrand.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

const conn = (config, type = 'trendyol') => ({ id: 'c1', marketplaceType: type, config: config === undefined ? undefined : JSON.stringify(config) });

// ---- what the store settings say ----
ok('no connection, no config, broken config: no brand', storeBrandOf(null) === null && storeBrandOf(conn(undefined)) === null && storeBrandOf({ id: 'c', marketplaceType: 'trendyol', config: '{oops' }) === null);
ok('a connection without a brand: none', storeBrandOf(conn({ buyboxAutoAdjust: true })) === null && storeBrandOf(conn({ defaultBrandName: '  ' })) === null);
ok('"Kendi markam" and the fallback brand are told apart; the id is kept', JSON.stringify(storeBrandOf(conn({ defaultBrandId: 123, defaultBrandName: ' Atölye ', brandStrategy: 'override' }))) === JSON.stringify({ name: 'Atölye', id: '123', strategy: 'override' })
  && storeBrandOf(conn({ defaultBrandId: '9', defaultBrandName: 'Yedek' })).strategy === 'xml');
ok('only Trendyol connections carry a Trendyol brand', storeBrandOf(conn({ defaultBrandName: 'X' }, 'hepsiburada')) === null);

const mount = async (props) => {
  document.getElementById('root').innerHTML = '';
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<MemoryRouter><ProductFormModal onClose={() => {}} onSaved={() => {}} {...props} /></MemoryRouter>); });
  await wait(60);
  return root;
};
const brand = () => q('brand');

// ---- "Kendi markam": filled in and fixed ----
let root = await mount({ product: undefined, connection: conn({ defaultBrandId: 123, defaultBrandName: 'Atölye Marka', brandStrategy: 'override' }) });
ok('new product, "Kendi markam": the brand is filled in by itself and cannot be typed over', brand().value === 'Atölye Marka' && brand().readOnly === true);
ok('and the form says why, with a way to the store settings', q('brand-note').textContent.includes('“Kendi markam”') && q('brand-note').textContent.includes('otomatik seçildi') && !!q('brand-note').querySelector('a[href="/marketplace"]'));
await act(async () => { root.unmount(); });

// ---- fallback brand: filled in, can be changed ----
root = await mount({ product: undefined, connection: conn({ defaultBrandId: 9, defaultBrandName: 'Yedek Marka', brandStrategy: 'xml' }) });
ok('new product, fallback brand: filled in and editable', brand().value === 'Yedek Marka' && brand().readOnly === false);
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
await act(async () => { setter.call(brand(), 'Başka Marka'); brand().dispatchEvent(new window.Event('input', { bubbles: true })); });
ok('it can be changed', brand().value === 'Başka Marka');
ok('the note explains it is the store\'s fallback brand', q('brand-note').textContent.includes('yedek marka (Yedek Marka)') && q('brand-note').textContent.includes('değiştirebilirsiniz'));
await act(async () => { root.unmount(); });

// ---- nothing set: as before ----
root = await mount({ product: undefined, connection: conn({ buyboxAutoAdjust: true }) });
ok('no brand in the store settings: empty, editable, the old hint', brand().value === '' && brand().readOnly === false && !q('brand-note') && document.body.textContent.includes('Trendyol’daki marka adıyla yazın'));
await act(async () => { root.unmount(); });
root = await mount({ product: undefined, connection: null });
ok('no marketplace at all: empty', brand().value === '' && !q('brand-note'));
await act(async () => { root.unmount(); });

// ---- editing keeps the product's own brand ----
const hand = { id: 'h1', sku: 'EL-1', title: 'Kupa', price: 100, stock: 1, brand: 'Eski Marka', xmlSourceId: null, xmlPrice: 0, images: '[]' };
root = await mount({ product: hand, connection: conn({ defaultBrandId: 123, defaultBrandName: 'Atölye Marka', brandStrategy: 'override' }) });
ok('editing a product: its own brand is not replaced, the field is not locked, the note says what is used when sending', brand().value === 'Eski Marka' && brand().readOnly === false && q('brand-note').textContent.includes('her zaman bu markayla gönderilir') && !q('brand-note').textContent.includes('otomatik seçildi'));
await act(async () => { root.unmount(); });

// ---- an XML product is not a hand-added one: nothing about the store brand ----
root = await mount({ product: { ...hand, id: 'x1', xmlSourceId: 's1', xmlPrice: 50 }, connection: conn({ defaultBrandName: 'Atölye Marka', brandStrategy: 'override' }) });
ok('a product from an XML source: brand untouched, no store-brand note', brand().value === 'Eski Marka' && !q('brand-note'));
await act(async () => { root.unmount(); });

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|Warning: An update|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors/warnings while rendering', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
