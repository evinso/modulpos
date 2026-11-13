import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import WhatsappBulkPage from '../../src/pages/whatsapp/bulk/WhatsappBulkPage.jsx';
import { durationText, estimateSeconds, decodeCsvBytes } from '../../src/pages/whatsapp/bulk/bulkHelpers.js';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../src/store/authStore.js';
import { calls, bulk } from './apiStub.cjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.FileReader = window.FileReader;   // the harness only copies a few browser globals; the page reads the chosen file with FileReader
const wait = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const click = async (el, ms = 80) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); await wait(ms); };
const btn = (label) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(label));
const byId = (id) => document.querySelector(`[data-testid="${id}"]`);
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); };

// React controlled inputs need the native setter + an input event
const setValue = async (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await wait(10);
};
// what Excel in Turkish Windows saves: Windows-1254 (the Turkish letters are single bytes, not UTF-8)
const CP1254 = { 'Ş': 0xDE, 'ş': 0xFE, 'İ': 0xDD, 'ı': 0xFD, 'Ğ': 0xD0, 'ğ': 0xF0, 'Ç': 0xC7, 'ç': 0xE7, 'Ö': 0xD6, 'ö': 0xF6, 'Ü': 0xDC, 'ü': 0xFC };
const toCp1254 = (s) => Uint8Array.from([...s].map((ch) => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : CP1254[ch] || 63)));
const chooseFile = async (bytes, name) => {
  const input = document.querySelector('[data-testid="csv-file"]');
  const file = new window.File([bytes], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await wait(250);
};

// ── helpers of the page ──
ok('duration text', durationText(7500) === '≈ 2 sa 5 dk' && durationText(2700) === '≈ 45 dk' && durationText(30) === '30 sn' && durationText(0) === '1 dakikadan az', [7500, 2700, 30].map(durationText).join(' | '));
ok('estimate: the first goes at once, the rest after the average pause', estimateSeconds(101, 12, 18) === 1500 && estimateSeconds(1, 12, 18) === 0 && estimateSeconds(0, 12, 18) === 0);
ok('a Turkish CSV in Windows-1254 is read correctly', decodeCsvBytes(toCp1254('Şehir;İzmir;çğıöü').buffer) === 'Şehir;İzmir;çğıöü' && decodeCsvBytes(new TextEncoder().encode('Şehir;İzmir').buffer) === 'Şehir;İzmir');

window.confirm = () => true;
const toasts = []; const realError = toast.error; toast.error = (m, o) => { toasts.push(String(m)); return realError(m, o); };   // no <Toaster/> here: record what would be shown

// ── a normal user gets nothing and asks for nothing ──
useAuthStore.setState({ user: { id: 'u0', role: 'owner' } });
let root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<MemoryRouter><WhatsappBulkPage /></MemoryRouter>); });
await wait(100);
ok('a normal user: nothing is drawn and nothing is requested', document.getElementById('root').textContent === '' && !calls.some((c) => c.url.startsWith('/whatsapp-bulk')));
await act(async () => { root.unmount(); });

// ── an admin ──
useAuthStore.setState({ user: { id: 'u1', role: 'admin' } });
root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<MemoryRouter><WhatsappBulkPage /></MemoryRouter>); });
await wait(150);
ok('empty list: the page explains how to start', text().includes('Henüz kampanya yok') && !!btn('Yeni kampanya'));
ok('the linked state and today\'s count are shown', byId('bulk-connection').textContent.includes('WhatsApp bağlı') && byId('overview-sent-today').textContent === '3');
ok('the warning about the shared number is there', byId('bulk-warning').textContent.includes('bildirimler de durur'));

// ── new campaign ──
await click(btn('Yeni kampanya'));
ok('the form opens with the default pause range and limit', document.querySelector('[aria-label="En az saniye"]').value === '12' && document.querySelector('[aria-label="En çok saniye"]').value === '20' && document.querySelector('[aria-label="Günlük sınır"]').value === '250');
ok('nothing can be saved yet and the reason is told', btn('Taslak olarak kaydet').disabled && byId('form-problem').textContent.includes('Kampanyaya bir ad verin'));

await setValue(document.querySelector('input[placeholder^="ör. Kasım"]'), 'Kasım duyurusu');
await setValue(document.querySelector('textarea[placeholder^="Merhaba"]'), 'Merhaba {ad}, hoş geldiniz!');
ok('still needs numbers', byId('form-problem').textContent.includes('Numara listesini'));

// a CSV file saved by Excel (Windows-1254, semicolons, header, a duplicate and a bad number)
const csv = 'Ad;Telefon;Şehir\nAyşe Yılmaz;0533 111 22 33;İzmir\nVeli;0532 000 11 22;Ankara\nAli;05331112233;Van\nHatalı;12345;Bursa\nExcel;5,32E+11;Muğla\nFatma;0534 222 33 44;Rize\nMehmet;0535 333 44 55;Sivas\n';
await chooseFile(toCp1254(csv), 'liste.csv');
const res = () => (byId('import-result') ? byId('import-result').textContent : '');
ok('the file is read and checked by itself: 4 good, 1 repeated, 2 refused', res().includes('4 geçerli numara') && res().includes('1 tekrar') && res().includes('2 geçersiz'), res().slice(0, 140));
ok('the number and name columns are found, the other column can be used in the message', res().includes('Numara sütunu: Telefon') && res().includes('Ad sütunu: Ad') && res().includes('{sehir}'));
ok('Turkish letters survived the file', res().includes('Ayşe Yılmaz') || text().includes('Ayşe Yılmaz'));
ok('refused rows are listed with the reason', byId('invalid-rows').textContent.includes('Satır 5') && byId('invalid-rows').textContent.includes('Satır 6') && byId('invalid-rows').textContent.includes('çok kısa') && byId('invalid-rows').textContent.includes('Excel numarayı bozmuş'));
ok('the estimate is shown', byId('estimate').textContent.includes('4 numara') && byId('estimate').textContent.includes('ortalama 16 sn') && byId('estimate').textContent.includes('48 sn'), byId('estimate') && byId('estimate').textContent);

// field chips insert at the cursor
await click(btn('{sehir}'), 30);
ok('a field button puts {sehir} into the message', document.querySelector('textarea[placeholder^="Merhaba"]').value.includes('{sehir}'));
await setValue(document.querySelector('textarea[placeholder^="Merhaba"]'), 'Merhaba {ad}, hoş geldiniz!');

// validation of the pause range
await setValue(document.querySelector('[aria-label="En az saniye"]'), '2');
ok('a pause below the floor is refused', btn('Taslak olarak kaydet').disabled && byId('form-problem').textContent.includes('en az 5'));
await setValue(document.querySelector('[aria-label="En az saniye"]'), '30');
ok('max smaller than min is refused', btn('Taslak olarak kaydet').disabled && byId('form-problem').textContent.includes('küçük olamaz'));
await setValue(document.querySelector('[aria-label="En az saniye"]'), '12.5');
ok('a pause that is not whole seconds is refused', btn('Taslak olarak kaydet').disabled && byId('form-problem').textContent.includes('tam saniye'), byId('form-problem') && byId('form-problem').textContent);
await setValue(document.querySelector('[aria-label="En az saniye"]'), '12');
await setValue(document.querySelector('[aria-label="En çok saniye"]'), '16');
ok('a valid form can be saved', !btn('Taslak olarak kaydet').disabled);

await click(btn('Taslak olarak kaydet'), 200);
const created = calls.filter((c) => c.m === 'POST' && c.url === '/whatsapp-bulk/campaigns').pop();
ok('only the good numbers, with name and fields, and the pause range are sent', created && created.body.recipients.length === 4 && created.body.recipients[0].phone === '905331112233' && created.body.recipients[0].name === 'Ayşe Yılmaz' && created.body.recipients[0].vars.sehir === 'İzmir'
  && created.body.minDelaySec === 12 && created.body.maxDelaySec === 16 && created.body.dailyLimit === 250 && created.body.name === 'Kasım duyurusu', JSON.stringify(created && created.body).slice(0, 200));
ok('it opens as a draft: nothing is sent yet, the finished messages can be checked', byId('campaign-status').textContent === 'Taslak' && byId('preview').textContent.includes('Merhaba Ayşe Yılmaz, hoş geldiniz!') && !calls.some((c) => c.url.endsWith('/start')));
ok('counts and the pause range are shown', byId('count-pending').textContent === '4' && text().includes('12–16 sn'));

// ── start, progress, pause ──
await click(btn('Başlat'), 200);
ok('Başlat asks the server to start', calls.some((c) => c.m === 'POST' && c.url === '/whatsapp-bulk/campaigns/k1/start'));
ok('it runs: status, countdown and the pause button', byId('campaign-status').textContent === 'Çalışıyor' && !!btn('Duraklat') && !btn('Sil') && !btn('Düzenle'), byId('campaign-status').textContent);
ok('a running campaign cannot be edited or deleted from the page', !btn('Sil') && !btn('Düzenle') && !btn('Numara ekle'));
await wait(4400);   // the page looks again every 4 seconds
ok('the page follows the progress by itself', byId('count-sent').textContent !== '0', `sent=${byId('count-sent').textContent}`);
ok('"next message in N seconds" is shown', /Sıradaki mesaj yaklaşık \d+ sn sonra/.test(byId('next-send') ? byId('next-send').textContent : ''), byId('next-send') && byId('next-send').textContent);

bulk.progressOnRead = false;
await click(btn('Duraklat'), 150);
ok('pausing works and offers to continue', byId('campaign-status').textContent === 'Duraklatıldı' && !!btn('Devam et') && !!btn('Düzenle'));

// ── one number failed meanwhile (the server wrote it); a later reload shows it ──
bulk.recipients[1].status = 'failed'; bulk.recipients[1].error = '••••0011 numarasında WhatsApp hesabı bulunamadı.';
bulk.recipients[0].status = 'sent';
const polled = calls.length; await wait(300);
ok('nothing is polled while the campaign is paused', calls.slice(polled).filter((c) => c.url.startsWith('/whatsapp-bulk/campaigns/k1')).length === 0);

// ── more numbers can be added to a campaign that is not running ──
await click(btn('Numara ekle'), 50);
await setValue(byId('recipient-text'), '0536 444 55 66');
await click(btn('Listeyi kontrol et'), 120);
await click(btn('Listeye ekle (1 numara)'), 150);
const added = calls.filter((c) => c.m === 'POST' && c.url.endsWith('/k1/recipients')).pop();
ok('added numbers go to the same campaign', added && added.body.recipients.length === 1 && added.body.recipients[0].phone === '905364445566');

// ── failed numbers can be queued again ──
ok('the failed number is shown with its reason', byId('count-failed').textContent === '1');
await click(btn('Başarısızları yeniden dene'), 150);
ok('failed numbers can be queued again', calls.some((c) => c.url.endsWith('/retry-failed')) && byId('count-failed').textContent === '0');

// ── status filter ──
const sel = document.querySelector('[aria-label="Duruma göre süz"]');
await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, 'sent'); sel.dispatchEvent(new window.Event('change', { bubbles: true })); });
await wait(100);
ok('the list can be filtered by state', calls.some((c) => c.url.endsWith('/recipients') && c.params && c.params.status === 'sent') && document.querySelectorAll('[data-testid="recipient-row"]').length === 1);

// ── a start the server refuses is told ──
bulk.startError = 'WhatsApp henüz bağlanmadı. WhatsApp sayfasında QR kodu okutup telefonu bağlayın.';
await click(btn('Devam et'), 150);
ok('a refused start shows the reason and the campaign stays paused', byId('campaign-status').textContent === 'Duraklatıldı' && toasts.some((t) => t.includes('henüz bağlanmadı')), toasts.join(' | '));
bulk.startError = null;

// ── the list, delete ──
await click(btn('Kampanyalar'), 150);
ok('the campaign is in the list with its numbers', byId('campaign-row') && byId('campaign-row').textContent.includes('Kasım duyurusu') && byId('campaign-row').textContent.includes('Duraklatıldı'));
await click(byId('campaign-row'), 150);
await click(btn('Sil'), 150);
ok('delete asks and removes the campaign', calls.some((c) => c.m === 'DELETE' && c.url === '/whatsapp-bulk/campaigns/k1') && text().includes('Henüz kampanya yok'));

// ── WhatsApp not linked ──
bulk.connection = { state: 'notAuthorized', message: 'Henüz bağlanmadı. “QR Kodu Göster” ile telefonunuzu bağlayın.' };
await act(async () => { root.unmount(); });
root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<MemoryRouter><WhatsappBulkPage /></MemoryRouter>); });
await wait(150);
ok('not linked: the page says so and points to the WhatsApp page', byId('bulk-connection').textContent.includes('WhatsApp bağlı değil') && !!document.querySelector('a[href="/whatsapp"]'));

// ── an Excel file is turned away with the way out ──
await click(btn('Yeni kampanya'));
await chooseFile(new Uint8Array([80, 75, 3, 4]), 'liste.xlsx');
ok('an .xlsx file is refused and CSV is explained', byId('import-error') && byId('import-error').textContent.includes('Farklı Kaydet'), byId('import-error') && byId('import-error').textContent);

// ── pasting numbers ──
await setValue(byId('recipient-text'), '0532 123 45 67\n0533 987 65 43\nabc');
await click(btn('Listeyi kontrol et'), 150);
ok('pasted numbers are checked too (no header, no name)', res().includes('2 geçerli numara') && res().includes('1 geçersiz') && res().includes('Başlık satırı yok') && res().includes('Ad sütunu bulunamadı'), res().slice(0, 160));

ok('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
