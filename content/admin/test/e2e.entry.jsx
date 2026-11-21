import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const S = globalThis.__srv;
const sleep = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
// waits at least `ms`, then until no request is in flight and no "Yükleniyor…" is on the screen (two quiet looks in a row)
const wait = async (ms = 60) => {
  await sleep(ms);
  let quiet = 0; const t0 = Date.now();
  while (quiet < 2 && Date.now() - t0 < 8000) { await sleep(40); quiet = (globalThis.__inflight || 0) === 0 && !document.body.textContent.includes('Yükleniyor…') ? quiet + 1 : 0; }
};
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  → ' + x : '')); if (!c) fails++; };
const errors = []; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 240)); };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const txt = () => document.body.textContent.replace(/\s+/g, ' ');
const click = async (el, ms = 120) => { if (!el) throw new Error('element not found to click. Page shows: ' + txt().slice(0, 600)); await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }); await wait(ms); };
const btn = (label, root = document) => $$('button, a.btn, a.nav', root).find((b) => b.textContent.replace(/\s+/g, ' ').trim().includes(label));
const tab = (label) => $$('button.tab').find((b) => b.textContent.trim() === label);
const nav = (label) => $$('a.nav').find((a) => a.textContent.includes(label));
const setVal = async (el, v) => {
  if (!el) throw new Error('input not found');
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  await act(async () => { el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};
const field = (label, root = document) => $$('.field', root).find((f) => f.querySelector('label') && f.querySelector('label').textContent.trim().startsWith(label));
const input = (label, root) => { const f = field(label, root); return f && f.querySelector('input, textarea, select'); };
const aria = (label) => $(`[aria-label="${label}"]`);
const q1 = async (sql, p = []) => (await S.db.query(sql, p)).rows[0];

const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); });
await wait(250);

// ── first setup and login ───────────────────────────────────────────────────────────────────────────
ok('a fresh install shows the first-administrator setup, not a login', txt().includes('İlk yönetici kurulumu'));
await setVal(input('Kurulum anahtarı'), 'wrong-token'); await setVal(input('Ad'), 'Smoke Admin'); await setVal(input('E-posta'), 'smoke@example.com'); await setVal(input('Şifre'), 'Correct-Horse-9-Battery');
await click(btn('Yöneticiyi oluştur'), 300);
ok('a wrong setup token is refused with the server\'s sentence', txt().includes('Kurulum anahtarı yanlış'));
await setVal(input('Kurulum anahtarı'), S.setupToken);
await click(btn('Yöneticiyi oluştur'), 400);
ok('the right token creates the administrator and offers the login', txt().includes('Kurulum tamamlandı') && !!btn('Giriş yap'), (await q1('SELECT count(*)::int n FROM users')).n + ' user(s)');
await click(btn('Giriş yap'), 500);
await wait(400);
ok('after login the dashboard is shown (menu, project selector, theme)', !!nav('Makale Arşivi') && txt().includes('Onay bekleyen') && !!$('select[aria-label="Proje"]'));
ok('the default project is selected: Global Tech Content Site, not connected', $('select[aria-label="Proje"]').value !== '' && txt().includes('Araştırma ve Arşiv Modu'));
ok('figures of later phases are marked, never shown as 0', txt().includes('Aşama 2’te etkinleşir') && $$('.metric.later').length === 4, `${$$('.metric.later').length} later-phase tiles`);
ok('no articles yet: an honest empty state, not fake charts', txt().includes('Henüz makale yok'));
ok('menu shows later phases dimmed and not clickable', $$('.nav.disabled').length >= 12 && $$('.nav.disabled').every((n) => n.tagName === 'DIV'));

// ── strategy ───────────────────────────────────────────────────────────────────────────────────────
await click(nav('Site Nişi ve İçerik Stratejisi'), 400);
ok('strategy page loads the niche of the project from the database', input('Ana niş').value === 'AI & Digital Technology Updates' && input('Hedef ülkeler').value === 'US, GB, CA, AU');
await setVal(input('Ana niş'), 'Fitness');
await click(btn('Stratejiyi kaydet'), 500);
ok('changing the main niche asks first and shows the server\'s warning', txt().includes('Ana nişi değiştirmek istiyor musunuz?') && txt().includes('SEO stratejinizi etkileyebilir'));
await click(btn('Evet, değiştir'), 600);
const niche = await q1('SELECT main_niche, version FROM niche_profiles');
ok('after confirming, the niche is saved (version raised)', niche.main_niche === 'Fitness' && niche.version === 2, JSON.stringify(niche));
await setVal(input('Ana niş'), 'AI & Digital Technology Updates'); await click(btn('Stratejiyi kaydet'), 300); await click(btn('Evet, değiştir'), 500);
await click(tab('Kategoriler'), 400);
ok('categories show the seeded 35/25/15/15/10 and a total of %100', $$('tbody tr input[type=number]').map((i) => i.value).join(',') === '35,25,15,15,10' && txt().includes('Toplam: %100'));
const first = $$('tbody tr input[type=number]')[0];
await setVal(first, '30');
ok('a total that is not 100 is flagged and cannot be saved', txt().includes('toplam %100 olmalı') && btn('Payları kaydet').disabled === true);
await click(btn('Eşit dağıt'));
ok('"Eşit dağıt" gives 20 each and the save becomes possible', $$('tbody tr input[type=number]').every((i) => i.value === '20') && btn('Payları kaydet').disabled === false);
await click(btn('Payları kaydet'), 500);
ok('saved shares are really in the database (20 x 5)', (await S.db.query('SELECT target_share_pct FROM categories ORDER BY priority')).rows.map((r) => r.target_share_pct).join(',') === '20,20,20,20,20');
await click(tab('Hariç tutulan konular'), 400);
await setVal($('textarea[placeholder^="Örn."]'), 'Premier League football match tonight'); await click(btn('Kontrol et'), 300);
ok('the topic tester uses the same filter as the bots', txt().includes('Kapsam dışı: football match'));

// ── articles ───────────────────────────────────────────────────────────────────────────────────────
await click(nav('Makale Arşivi'), 400);
ok('empty archive offers adding an article', txt().includes('Henüz makale yok'));
await click(btn('Yeni makale ekle'), 400);
await setVal(input('Ana başlık (H1)'), 'Smoke test: a new AI tool explained');
await setVal($('textarea[placeholder^="<h2>"]'), '<h2>Intro</h2><p>Hello <script>alert(1)</script>world</p>');
await click(btn('Makaleyi oluştur'), 700);
const art = await q1('SELECT * FROM articles');
ok('the article is created, HTML sanitised by the server, slug made from the title', !!art && art.slug === 'smoke-test-a-new-ai-tool-explained' && !art.content_html.includes('script') && art.status === 'needs_review');
ok('the editor opens on the new article with its readiness list', txt().includes('Onay bekliyor') && txt().includes('Doğruluk kontrolü yapılmadı (zorunlu)') && txt().includes('Eksikler var'));
await click(btn('Doğrulandı olarak işaretle'), 500);
ok('fact check can be stamped by a person', !!(await q1('SELECT fact_checked_at FROM articles')).fact_checked_at);
await setVal(input('Ana başlık (H1)'), 'Smoke test: edited title');
ok('an unsaved change is shown', txt().includes('Kaydedilmemiş değişiklik'));
await setVal($('input[placeholder^="Değişiklik notu"]'), 'Başlık düzeltildi');
await click(btn('Kaydet'), 700);
const vers = (await S.db.query('SELECT version, reason FROM article_versions ORDER BY version')).rows;
ok('saving creates version 2 with the note, and re-opens the fact check', vers.length === 2 && vers[1].reason === 'Başlık düzeltildi' && (await q1('SELECT fact_checked_at FROM articles')).fact_checked_at === null, JSON.stringify(vers));
ok('version history lists both versions', txt().includes('v2') && txt().includes('Başlık düzeltildi') && txt().includes('İlk sürüm'));
await click(btn('Arşive dön'), 400);
ok('the list shows the article with its status and unchecked AdSense risk', txt().includes('Smoke test: edited title') && txt().includes('Onay bekliyor') && txt().includes('kontrol edilmedi'));
await click($('tbody input[type=checkbox]'));
ok('selecting shows the bulk bar', txt().includes('1 makale seçili'));
const sel = aria('Dışa aktar'); await setVal(sel, 'csv'); await wait(300);
ok('export downloads a csv file named by date', (globalThis.__downloads || []).some((d) => /^articles-\d{4}-\d{2}-\d{2}\.csv$/.test(d)), String(globalThis.__downloads));
await click(btn('Arşivle'), 600);
ok('bulk archive archives it in the database', (await q1('SELECT status FROM articles')).status === 'archived');

// ── daily work settings ───────────────────────────────────────────────────────────────────────────
await click(nav('Günlük Çalışma Ayarları'), 500);
ok('limits page shows today\'s numbers from the database and the three levels', txt().includes('Genel günlük limitler') && txt().includes('Proje limitleri') && txt().includes('Kategori limitleri') && !!aria('Yeni makale günlük limit'));
await setVal(aria('Yeni makale günlük limit'), '1');
await click(btn('Genel limitleri kaydet'), 500);
const p = (await S.db.query('SELECT id FROM content_projects')).rows[0].id;
const r1 = await S.limits.reserve({ workType: 'new_article', projectId: p }); const r2 = await S.limits.reserve({ workType: 'new_article', projectId: p });
ok('the saved limit of 1 is enforced at once (second reservation refused)', r1.ok === true && r2.ok === false && r2.scope === 'global', JSON.stringify(r2));
await setVal(aria('Yeni makale günlük limit'), '0');
ok('0 is shown as "Durduruldu"', txt().includes('Durduruldu'));
await setVal(aria('Yeni makale günlük limit'), '999');
ok('a value above the maximum is flagged and not accepted by the server', aria('Yeni makale günlük limit').getAttribute('aria-invalid') === 'true');
await click(btn('Genel limitleri kaydet'), 500);
ok('the server refuses it (limit stays 1)', (await q1("SELECT max_per_day FROM daily_work_limits WHERE scope = 'global' AND work_type = 'new_article'")).max_per_day === 1);
await click(btn('Botları duraklat'), 300); await click(btn('Duraklat'), 600);
ok('"Botları duraklat" pauses all automatic work (and the limits obey it)', (await S.limits.reserve({ workType: 'serp_queries' })).reason === 'paused' && txt().includes('Botlar duraklatıldı'));
await click(btn('Devam ettir'), 600);

// ── api keys ───────────────────────────────────────────────────────────────────────────────────────
await click(nav('API Kullanımı ve Maliyetler'), 500);
ok('three providers are listed, none configured', $$('.card h2').filter((h) => ['OpenAI', 'DataForSEO', 'Telegram'].includes(h.textContent)).length === 3 && txt().includes('Anahtar yok'));
const openai = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'OpenAI');
await setVal(input('API anahtarı', openai), 'sk-test-abcdefghijklmnop1234');
await click(btn('Kaydet', openai), 600);
ok('after saving only the last 4 characters are shown and the key is nowhere in the page', txt().includes('Kayıtlı · …1234') && !document.body.innerHTML.includes('abcdefghij'));
ok('the key is encrypted in the database', (await q1("SELECT encrypted_secret FROM api_providers WHERE key = 'openai'")).encrypted_secret.startsWith('enc:v1:'));
ok('cost tiles say "Bilinmiyor" never an invented number when empty (no calls yet)', txt().includes('Henüz harici API çağrısı yapılmadı'));

// ── bots, settings, logs, notifications ───────────────────────────────────────────────────────────
await click(nav('Bot Yönetimi'), 500);
ok('15 bots are listed, none pretends to have run', $$('tbody tr').length === 15 && txt().includes('Aşama 2’te gelecek') && txt().includes('0 / 15 bot hazır'));
await click(nav('Sistem Ayarları'), 500);
ok('automation settings load; the three mandatory checks are locked', txt().includes('Kalite ve zorunlu kontroller') && $$('.badge').filter((b) => b.textContent === 'kilitli').length === 3);
const scoring = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.startsWith('Fırsat puanlama'));
await setVal(input('Trend yükselişi', scoring), '50');
ok('scoring weights must total 100 (live sum, save disabled)', scoring.textContent.includes('100 olmalı') && btn('Kaydet', scoring).disabled === true);
await setVal(input('Trend yükselişi', scoring), '30');
await click(tab('Kullanıcılar'), 400);
ok('users tab lists the administrator', txt().includes('smoke@example.com') && txt().includes('siz'));
await click(tab('Sistem'), 500);
ok('system tab shows configuration status without any secret', txt().includes('tanımlı') && !txt().includes(process.env.CONTENT_ENCRYPTION_KEY) && !txt().includes(S.setupToken));
await S.notifications.create({ type: 'budget', severity: 'critical', title: 'Smoke bildirimi: bütçe doldu' });
await click(nav('Bildirimler'), 500);
ok('notifications show a new message and can mark it read', txt().includes('Smoke bildirimi: bütçe doldu'));
await click(btn('Okundu'), 500);
ok('marked read in the database', (await q1('SELECT read_at FROM notifications')).read_at !== null);
await click(nav('İşlem Geçmişi'), 500);
ok('history shows who changed what (strategy, shares, limits, provider)', ['niche.update', 'category.shares', 'limits.global', 'provider.save'].every((a) => txt().includes(a)));
ok('history never contains the API key', !txt().includes('abcdefghij'));

// ── logout ─────────────────────────────────────────────────────────────────────────────────────────
await click(aria('Çıkış'), 600);
ok('logout returns to the login form and ends the session', txt().includes('Giriş yap') && !nav('Makale Arşivi'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors or warnings', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
