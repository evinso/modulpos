const test = require('node:test');
const assert = require('node:assert/strict');
const { parseList, cleanPhone, renderMessage, placeholdersOf, fold, MAX_ROWS } = require('../../src/services/whatsapp/bulkCsv');

const phones = (p) => p.rows.filter((r) => r.valid).map((r) => r.phone);

test('numbers typed the Turkish ways all become 905XXXXXXXXX', () => {
  for (const raw of ['0532 123 45 67', '532 123 45 67', '5321234567', '+90 532 123 45 67', '905321234567', '0090 532 123 4567', '(0532) 123-45-67', '0 (532) 123 45 67']) {
    assert.equal(cleanPhone(raw).phone, '905321234567', raw);
  }
});

test('what cannot be a WhatsApp number is refused with the reason', () => {
  assert.match(cleanPhone('').reason, /boş/);
  assert.match(cleanPhone('12345').reason, /kısa/);
  assert.match(cleanPhone('0212 123 45 67').reason, /Cep numarası değil/);            // landline
  assert.match(cleanPhone('90532123456').reason, /kısa/);
  assert.match(cleanPhone('9053212345678').reason, /uzun/);
  assert.match(cleanPhone('abc 5321234567').reason, /harf/);
  assert.match(cleanPhone('5,32E+11').reason, /Excel/);                                // Excel turned the number into 5.32E+11
  assert.match(cleanPhone('5.3212E+11').reason, /Excel/);
});

test('numbers of other countries are accepted with their country code', () => {
  assert.equal(cleanPhone('+49 170 1234567').phone, '491701234567');
  assert.equal(cleanPhone('+1 (415) 555-2671').phone, '14155552671');
  assert.match(cleanPhone('4155552671').reason, /Ülke kodu/);                          // 10 digits that are not Turkish: ambiguous
});

test('a plain list of numbers, one per line', () => {
  const p = parseList('0532 123 45 67\n0533 111 22 33\r\n\n0534 000 11 22\n');
  assert.equal(p.hasHeader, false);
  assert.deepEqual(phones(p), ['905321234567', '905331112233', '905340001122']);
  assert.equal(p.total, 3); assert.equal(p.valid, 3); assert.equal(p.invalid, 0);
});

test('a header row, semicolon separator (Excel in Turkish), name and other columns', () => {
  const p = parseList('﻿Ad Soyad;Telefon;Şehir\nAli Yılmaz;0532 123 45 67;Ankara\nAyşe Kaya;0533 111 22 33;İzmir\n');
  assert.equal(p.hasHeader, true); assert.equal(p.delimiter, ';');
  assert.equal(p.phoneColumn, 'Telefon'); assert.equal(p.nameColumn, 'Ad Soyad');
  assert.deepEqual(p.columns.map((c) => c.key), ['adsoyad', 'sehir']);
  assert.equal(p.rows[0].name, 'Ali Yılmaz');
  assert.equal(p.rows[0].vars.sehir, 'Ankara');
  assert.equal(p.rows[0].vars.ad, 'Ali Yılmaz', '{ad} always means the name');
});

test('comma and tab separators, quoted cells that hold the separator and line breaks', () => {
  const c = parseList('isim,gsm,not\n"Yılmaz, Ali",05321234567,"iki\nsatır"\nVeli,05331112233,x\n');
  assert.equal(c.delimiter, ','); assert.equal(c.total, 2);
  assert.equal(c.rows[0].name, 'Yılmaz, Ali'); assert.equal(c.rows[0].vars.not, 'iki\nsatır');
  const t = parseList('Ad\tTelefon\nAli\t05321234567\n');
  assert.equal(t.delimiter, '\t'); assert.deepEqual(phones(t), ['905321234567']);
  const q = parseList('Ad;Telefon\n"Ali ""Koç"""; 05321234567\n');
  assert.equal(q.rows[0].name, 'Ali "Koç"');
});

test('the number column is found by its header, else by what its cells look like', () => {
  const byHeader = parseList('Müşteri;Cep Telefonu;Sipariş No\nAli;05321234567;123456789012\n');
  assert.equal(byHeader.phoneColumn, 'Cep Telefonu', 'a 12-digit order number must not be mistaken for the phone');
  const byContent = parseList('Ali;05321234567;Ankara\nAyşe;05331112233;İzmir\n');
  assert.equal(byContent.hasHeader, false);
  assert.equal(byContent.phoneColumn, 'Sütun 2'); assert.equal(byContent.nameColumn, 'Sütun 1');
  assert.deepEqual(phones(byContent), ['905321234567', '905331112233']);
});

test('invalid and repeated numbers are reported, each number is kept once', () => {
  const p = parseList('Telefon\n05321234567\n+90 532 123 45 67\n12345\n05331112233\n');
  assert.equal(p.total, 4); assert.equal(p.valid, 2); assert.equal(p.duplicates, 1); assert.equal(p.invalid, 1);
  assert.equal(p.rows[1].duplicate, true); assert.match(p.rows[1].reason, /zaten var/);
  assert.match(p.rows[2].reason, /kısa/);
  assert.equal(p.rows[0].line, 2, 'line numbers count the header, like the file');
});

test('empty lines are ignored; an empty text gives nothing', () => {
  assert.equal(parseList('').total, 0);
  assert.equal(parseList('\n\n ; \n').total, 0);
});

test('more than the limit is reported, not silently cut', () => {
  const big = Array.from({ length: MAX_ROWS + 5 }, (_, i) => `0532${String(1000000 + i).slice(-7)}`).join('\n');
  const p = parseList(big);
  assert.equal(p.tooMany, MAX_ROWS + 5); assert.equal(p.rows.length, MAX_ROWS);
});

test('columns with the same name get different keys', () => {
  const p = parseList('Telefon;Not;Not\n05321234567;a;b\n');
  assert.deepEqual(p.columns.map((c) => c.key), ['not', 'not_']);
  assert.equal(p.rows[0].vars.not, 'a'); assert.equal(p.rows[0].vars.not_, 'b');
});

test('fold: Turkish letters and spaces', () => {
  assert.equal(fold('Ad Soyad'), 'adsoyad'); assert.equal(fold('İl'), 'il'); assert.equal(fold('ŞEHİR'), 'sehir'); assert.equal(fold('Sipariş_No'), 'siparisno');
});

test('message: {ad}, other columns, a replacement for empty cells, nothing left behind', () => {
  const r = { name: 'Ali', vars: { ad: 'Ali', sehir: 'Ankara' } };
  assert.equal(renderMessage('Merhaba {ad}, {sehir} için fırsat!', r), 'Merhaba Ali, Ankara için fırsat!');
  assert.equal(renderMessage('Merhaba {Ad} {İsim}', r), 'Merhaba Ali Ali', 'case and the Turkish İ do not matter; {isim} is the name too');
  const noName = { name: null, vars: {} };
  assert.equal(renderMessage('Merhaba {ad|değerli müşterimiz}, hoş geldiniz', noName), 'Merhaba değerli müşterimiz, hoş geldiniz');
  assert.equal(renderMessage('Merhaba {ad}, hoş geldiniz', noName), 'Merhaba, hoş geldiniz', 'an empty name leaves no " ," behind');
  assert.equal(renderMessage('Selam {sehir}!', noName), 'Selam!');
  assert.equal(renderMessage('Fiyat: {fiyat} TL', { name: null, vars: { fiyat: '99,90' } }), 'Fiyat: 99,90 TL');
  assert.equal(renderMessage('Satır 1\n\nSatır 2 {ad}', r), 'Satır 1\n\nSatır 2 Ali', 'line breaks are kept');
});

test('placeholdersOf lists the folded names a message uses', () => {
  assert.deepEqual(placeholdersOf('Merhaba {Ad}, {Şehir|orada} ve {ad} {  Sipariş No }').sort(), ['ad', 'sehir', 'siparisno']);
  assert.deepEqual(placeholdersOf('düz metin'), []);
});
