const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CONTENT_ENCRYPTION_KEY = 'a1'.repeat(32);
const crypto = require('../../src/content/lib/crypto');
const passwords = require('../../src/content/lib/passwords');
const tokens = require('../../src/content/lib/tokens');
const cookies = require('../../src/content/lib/cookies');
const V = require('../../src/content/lib/validate');
const H = require('../../src/content/lib/html');
const { toCsv, cell } = require('../../src/content/lib/csv');
const T = require('../../src/content/lib/time');

test('secrets: encrypted with the content key, readable back, unique every time, tampering detected, no key = error', () => {
  const a = crypto.encrypt('sk-test-123456'); const b = crypto.encrypt('sk-test-123456');
  assert.ok(a.startsWith('enc:v1:') && !a.includes('sk-test')); assert.notEqual(a, b);
  assert.equal(crypto.decrypt(a), 'sk-test-123456');
  assert.throws(() => crypto.decrypt(a.slice(0, -4) + 'AAAA'));
  assert.equal(crypto.last4('sk-test-123456'), '3456');
  const saved = process.env.CONTENT_ENCRYPTION_KEY; delete process.env.CONTENT_ENCRYPTION_KEY;
  assert.throws(() => crypto.encrypt('x'), /CONTENT_ENCRYPTION_KEY/);
  process.env.CONTENT_ENCRYPTION_KEY = 'short';
  assert.throws(() => crypto.encrypt('x'), /CONTENT_ENCRYPTION_KEY/, 'a malformed key is as good as none');
  process.env.CONTENT_ENCRYPTION_KEY = saved;
});

test('passwords: policy sentences, hashing and checking', async () => {
  assert.match(passwords.policyError('Kisa1!'), /12 karakter/);
  assert.match(passwords.policyError('password123'), /12 karakter|yaygın/);
  assert.match(passwords.policyError('modulpos12345'), /yaygın|üçünü/);
  assert.match(passwords.policyError('aaaaaaaaaaaaaaaa'), /tekrar/);
  assert.match(passwords.policyError('ozgurkilic-Strong9!', 'ozgurkilic@example.com'), /e-posta/);
  assert.match(passwords.policyError('onlylowercaseletters'), /en az üçünü/);
  assert.equal(passwords.policyError('Correct-Horse-9-Battery'), null);
  const h = await passwords.hash('Correct-Horse-9-Battery');
  assert.ok(h.startsWith('$2') && h !== 'Correct-Horse-9-Battery');
  assert.equal(await passwords.verify('Correct-Horse-9-Battery', h), true); assert.equal(await passwords.verify('wrong', h), false);
});

test('tokens and cookies', () => {
  const t = tokens.newToken(); assert.ok(t.length >= 40); assert.notEqual(t, tokens.newToken());
  assert.equal(tokens.sha256('a'), tokens.sha256('a')); assert.notEqual(tokens.sha256('a'), tokens.sha256('b'));
  assert.equal(tokens.safeEqual('abc', 'abc'), true); assert.equal(tokens.safeEqual('abc', 'abd'), false); assert.equal(tokens.safeEqual('abc', 'abcd'), false);
  assert.equal(cookies.readSession({ headers: { cookie: 'x=1; cp_session=tok%2Fen; y=2' } }), 'tok/en');
  assert.equal(cookies.readSession({ headers: { cookie: 'other=1' } }), null); assert.equal(cookies.readSession({ headers: {} }), null);
  assert.equal(cookies.readSession({ headers: { cookie: 'cp_session=%E0%A4%A' } }), null, 'a broken escape is not a session');
  const set = []; const res = { append: (k, v) => set.push([k, v]) };
  cookies.setSession(res, 'TOKEN', 3600); cookies.clearSession(res);
  assert.match(set[0][1], /^cp_session=TOKEN; Path=\/api\/content; HttpOnly; SameSite=Lax; Max-Age=3600/); assert.match(set[1][1], /Max-Age=0/);
});

test('validation: every check throws a 400 sentence that names the field', () => {
  assert.equal(V.str('  Merhaba  ', 'Ad', { required: true }), 'Merhaba');
  assert.throws(() => V.str('', 'Ad', { required: true }), /Ad zorunlu/);
  assert.throws(() => V.str('x'.repeat(11), 'Ad', { max: 10 }), /en fazla 10/);
  assert.throws(() => V.str(5, 'Ad'), /metin olmalı/);
  assert.equal(V.str('a\nb', 'Ad'), 'a b', 'line breaks are folded unless multiline');
  assert.equal(V.str('a\nb', 'Ad', { multiline: true }), 'a\nb');
  assert.equal(V.int('7', 'Sayı', { min: 0, max: 10 }), 7);
  assert.throws(() => V.int(11, 'Sayı', { min: 0, max: 10 }), /0 ile 10/); assert.throws(() => V.int(1.5, 'Sayı'), /tam sayı/);
  assert.equal(V.int(null, 'Sayı', { nullable: true }), null);
  assert.equal(V.oneOf('a', 'Tür', ['a', 'b']), 'a'); assert.throws(() => V.oneOf('c', 'Tür', ['a', 'b']), /şunlardan biri/);
  assert.deepEqual(V.strList([' A ', 'a', 'B'], 'Liste'), ['A', 'B'], 'trimmed, case-insensitive duplicates dropped');
  assert.throws(() => V.strList('x', 'Liste'), /liste olmalı/); assert.throws(() => V.strList([1], 'Liste'), /yalnızca metin/);
  assert.equal(V.uuid('4F1C2D3E-1111-4222-8333-444455556666', 'Id'), '4f1c2d3e-1111-4222-8333-444455556666'); assert.throws(() => V.uuid('not-a-uuid', 'Id'), /geçersiz/);
  assert.equal(V.email('Ali@Example.COM'), 'ali@example.com'); assert.throws(() => V.email('nope'), /geçerli/);
  assert.equal(V.bool(true, 'x'), true); assert.throws(() => V.bool('yes', 'x'), /true\/false/);
  try { V.str('', 'Ad', { required: true }); } catch (e) { assert.equal(e.status, 400); }
});

test('HTML: scripts, handlers, styles and unsafe addresses never survive; the useful markup does', () => {
  const dirty = '<h1 onclick="x()">Title</h1><p style="color:red">Hi <script>alert(1)</script><b>bold</b> <a href="javascript:alert(1)">bad</a> <a href="https://example.com/a?b=1&c=2" target="_blank" onmouseover="x">good</a></p>'
    + '<img src="http://evil.example/a.png" onerror="x()"><img src="https://cdn.example.com/p.png" alt="ok"><iframe src="https://evil.example"></iframe><svg><script>1</script></svg>'
    + '<ul><li>one</li></ul><table><tr><th>A</th></tr><tr><td colspan="2">x</td></tr></table><div class="x">kept text</div><style>p{}</style>';
  const clean = H.sanitizeArticleHtml(dirty);
  assert.ok(!/script|onclick|onerror|onmouseover|style|iframe|svg|javascript:|evil\.example/i.test(clean), clean);
  assert.match(clean, /<h2>Title<\/h2>/, 'h1 becomes h2 (the title is separate)');
  assert.match(clean, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noopener">good<\/a>/);
  assert.match(clean, /<img src="https:\/\/cdn\.example\.com\/p\.png" alt="ok" \/>/);
  assert.match(clean, /<b>bold<\/b>/); assert.match(clean, /<td colspan="2">x<\/td>/); assert.match(clean, /kept text/);
  assert.equal(H.sanitizeArticleHtml(null), '');
});

test('HTML helpers: text, word count, slug, Markdown', () => {
  assert.equal(H.htmlToText('<p>Hello &amp; <b>world</b></p>\n<p>again</p>'), 'Hello & world again');
  assert.equal(H.wordCount('<p>One two</p><p>three</p>'), 3); assert.equal(H.wordCount(''), 0);
  assert.equal(H.slugify('What Changed in the Latest AI Tool Update?'), 'what-changed-in-the-latest-ai-tool-update');
  assert.equal(H.slugify('Güvenlik & Gizlilik: Şifre Çözümü İpuçları'), 'guvenlik-and-gizlilik-sifre-cozumu-ipuclari');
  assert.equal(H.slugify('  ---  '), ''); assert.ok(H.slugify('a'.repeat(200)).length <= 90);
  const md = H.htmlToMarkdown('<h2>Heading</h2><p>Text with <strong>bold</strong>, <em>italic</em>, <code>code</code> and <a href="https://x.test">a link</a>.</p>'
    + '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol><li>first</li><li>second</li></ol><blockquote><p>quoted</p></blockquote>'
    + '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x|y</td></tr></table><pre>line 1\nline 2</pre>');
  assert.match(md, /^## Heading\n\nText with \*\*bold\*\*, \*italic\*, `code` and \[a link\]\(https:\/\/x\.test\)\./);
  assert.match(md, /- one\n- two\n {2}- nested/); assert.match(md, /1\. first\n2\. second/); assert.match(md, /> quoted/);
  assert.match(md, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| x\\\|y \|/); assert.match(md, /```\nline 1\nline 2\n```/);
});

test('CSV: Excel-ready, quoted, and no formula injection', () => {
  assert.equal(cell('a,b'), '"a,b"'); assert.equal(cell('say "hi"'), '"say ""hi"""'); assert.equal(cell(['x', 'y']), '"x; y"', 'a list is joined with "; " and quoted (the semicolon is the separator of Turkish Excel)'); assert.equal(cell(null), '');
  for (const evil of ['=HYPERLINK("http://x")', '+1', '-2', '@SUM(1)']) assert.ok(cell(evil).includes("'" + evil.slice(0, 1)) || cell(evil).startsWith('"\''), evil);
  const csv = toCsv([{ t: 'İ̇ş', n: 2 }], [{ key: 't', label: 'Başlık' }, { key: 'n', label: 'Sayı' }]);
  assert.ok(csv.startsWith('﻿Başlık,Sayı\r\n') && csv.endsWith('\r\n'));
});

test('days are the days of the configured time zone', () => {
  const at = new Date('2026-11-13T21:30:00Z');                              // 00:30 on the 14th in Istanbul
  assert.equal(T.dayKey(at, 'Europe/Istanbul'), '2026-11-14'); assert.equal(T.dayKey(at, 'UTC'), '2026-11-13');
  assert.equal(T.monthKey(at, 'Europe/Istanbul'), '2026-11'); assert.equal(T.daysAgo(30, at, 'Europe/Istanbul'), '2026-10-15');
  assert.equal(T.isValidTimezone('Europe/Istanbul'), true); assert.equal(T.isValidTimezone('Mars/Base'), false);
});
