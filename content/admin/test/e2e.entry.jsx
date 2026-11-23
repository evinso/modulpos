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
ok('every dashboard figure is a real count now (a 0 is a real 0); organic traffic says WHY it has no data (no site yet) and no card talks about a later phase', $$('.metric.later').length === 0 && txt().includes('Organik trafik') && txt().includes('Henüz bağlı bir web sitesi yok') && !/Aşama \d/.test(txt()) && txt().includes('Bugün bulunan haber'));
ok('no articles yet: an honest empty state, not fake charts', txt().includes('Henüz makale yok'));
ok('menu: every page is a link now, nothing is dimmed any more (SEO Performansı, İç Bağlantılar and AdSense Denetimi included)', $$('.side .nav').every((n) => n.tagName === 'A') && !/Aşama \d/.test($('.side').textContent) && !!nav('AdSense Denetimi') && !!nav('SEO Performansı') && !!nav('İç Bağlantılar') && !!nav('Dünya Gündemi') && !!nav('İçerik Fırsatları'));
ok('menu is grouped by the way the work flows: five headings in order, every page exactly once, "Otomasyon Modu" at the very top (then Dashboard) without a heading', JSON.stringify($$('.side .nav-sep').map((n) => n.textContent)) === JSON.stringify(['Strateji ve araştırma', 'İçerik', 'Yayın', 'Bakım ve performans', 'Otomasyon ve sistem']) && $$('.side a.nav').length === 26 && new Set($$('.side a.nav').map((a) => a.getAttribute('href'))).size === 26 && $$('.side a.nav')[0].textContent.includes('Otomasyon Modu') && $$('.side a.nav')[1].textContent.includes('Dashboard') && $$('.side .nav-group')[0].querySelector('.nav-sep') === null && $$('.side .nav-group').every((g) => g.querySelectorAll('a.nav').length > 0) && !!$('.side .nav-group[aria-label="Yayın"] a[href="/sites"]') && !!$('.side .nav-group[aria-label="Otomasyon ve sistem"] a[href="/bots"]'));

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
// the project's "Yeni makale" limit can never be empty: the page says so, the save button is off, the server refuses it, and nothing jumps back to a default behind the person's back
ok('the project card explains that the new-article limit cannot be empty and that the narrowest limit wins', !!aria('Yeni makale proje limiti') && txt().includes('boş bırakılamaz') && txt().includes('en dar sınır') && txt().includes('Genel günlük limitler'));
await setVal(aria('Yeni makale proje limiti'), '7'); await click(btn('Proje limitlerini kaydet'), 600);
ok('a typed project limit is saved and shown', (await q1('SELECT daily_article_limit AS n FROM niche_profiles')).n === 7 && aria('Yeni makale proje limiti').value === '7');
await setVal(aria('Yeni makale proje limiti'), '');
ok('an emptied box says why it cannot be saved and the save button is off', txt().includes('“Yeni makale” proje limiti boş bırakılamaz') && btn('Proje limitlerini kaydet').disabled === true);
let refused = null; try { await S.limits.setProjectLimits(p, { new_article: null }); } catch (e) { refused = e; }
ok('the server refuses an empty value too and keeps the number (it no longer turns into 3 silently)', !!refused && refused.status === 400 && /boş bırakılamaz/.test(refused.message) && (await q1('SELECT daily_article_limit AS n FROM niche_profiles')).n === 7);
await setVal(aria('Yeni makale proje limiti'), '3'); await click(btn('Proje limitlerini kaydet'), 600);
ok('back to 3 by typing it (the later scenarios expect the default)', (await q1('SELECT daily_article_limit AS n FROM niche_profiles')).n === 3);
await click(btn('Botları duraklat'), 300); await click(btn('Duraklat'), 600);
ok('"Botları duraklat" pauses all automatic work (and the limits obey it)', (await S.limits.reserve({ workType: 'serp_queries' })).reason === 'paused' && txt().includes('Botlar duraklatıldı'));
await click(btn('Devam ettir'), 600);

// ── api keys ───────────────────────────────────────────────────────────────────────────────────────
await click(nav('API Kullanımı ve Maliyetler'), 500);
ok('three providers are listed, none configured', $$('.card h2').filter((h) => ['OpenAI', 'Apify (Google anahtar kelime verisi)', 'Telegram'].includes(h.textContent)).length === 3 && txt().includes('Anahtar yok'));
const openai = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'OpenAI');
await setVal(input('API anahtarı', openai), 'sk-test-abcdefghijklmnop1234');
await click(btn('Kaydet', openai), 600);
ok('after saving only the last 4 characters are shown and the key is nowhere in the page', txt().includes('Kayıtlı · …1234') && !document.body.innerHTML.includes('abcdefghij'));
ok('the key is encrypted in the database', (await q1("SELECT encrypted_secret FROM api_providers WHERE key = 'openai'")).encrypted_secret.startsWith('enc:v1:'));
ok('cost tiles say "Bilinmiyor" never an invented number when empty (no calls yet)', txt().includes('Henüz harici API çağrısı yapılmadı'));

// ── bots, settings, logs, notifications ───────────────────────────────────────────────────────────
await click(nav('Bot Yönetimi'), 500);
ok('15 bots: every bot of the specification is ready now and shows its real last runs; none is "coming in a later phase"', $$('tbody tr').length === 15 && txt().includes('15 / 15 bot hazır') && !/Aşama \d’te gelecek/.test(txt()) && txt().includes('Otomatik: 2 saatte bir') && txt().includes('Otomatik kapalı; elle çalıştırılır') && txt().includes('bu sunucuda kapalı'));
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


// ── phase 2: news, trends, niche, keywords, SERP, opportunities (real server, real fetcher, real feeds from a local server) ───────────────
const pid = (await q1('SELECT id FROM content_projects')).id;
await click(nav('Dünya Gündemi'), 500);
ok('World News opens on events; says it only keeps headline, link and a short summary', txt().includes('Olaylar') && txt().includes('Şimdi tara') && txt().includes('Olay yok'));
await click(tab('Kaynaklar'), 400);
ok('sources tab offers the default list and adding one', !!btn('Varsayılan kaynakları ekle') && !!btn('Kaynak ekle') && txt().includes('Kaynak yok'));
await click(btn('Kaynak ekle'), 300);
await setVal(input('Ad'), 'TechCrunch'); await setVal(input('Yayın adresi'), `${globalThis.__feedBase}/tc.xml`); await setVal(input('Güvenilirlik'), '75');
ok('the form warns about terms of use and copyright', txt().includes('kullanım şartlarına ve telif haklarına uymak sizin sorumluluğunuzdadır'));
await click(btn('Kaydet', $('.modal')), 600);
await click(btn('Kaynak ekle'), 300); await setVal(input('Ad'), 'BleepingComputer'); await setVal(input('Yayın adresi'), `${globalThis.__feedBase}/bleep.xml`); await click(btn('Kaydet', $('.modal')), 600);
await click(btn('Kaynak ekle'), 300); await setVal(input('Ad'), 'Typo'); await setVal(input('Yayın adresi'), 'http://169.254.169.254/latest'); delete process.env.CONTENT_ALLOW_PRIVATE_FETCH; await click(btn('Kaydet', $('.modal')), 600); process.env.CONTENT_ALLOW_PRIVATE_FETCH = '1';
ok('a private (metadata) address is refused with the server\'s sentence and nothing is saved', txt().includes('iç ağ adresi') && (await q1('SELECT count(*)::int n FROM news_sources')).n === 2);
await click(btn('Vazgeç', $('.modal')), 200);
ok('both real sources are listed', txt().includes('TechCrunch') && txt().includes('BleepingComputer'));
await click($$('button[aria-label="Test et"]')[0], 600);
ok('"test" reads the source without saving: 6 headlines', txt().includes('Test: 6 haber okundu') && (await q1('SELECT count(*)::int n FROM news_items')).n === 0);
await click(btn('Şimdi tara'), 300);
ok('the scan starts in the background', txt().includes('Tarama sürüyor') || txt().includes('Tarama tamamlandı'));
for (let i = 0; i < 80 && !txt().includes('Tarama tamamlandı'); i++) await wait(150);
ok('the scan ends and says what it found (new headlines, relevant, events)', txt().includes('Tarama tamamlandı') && /\d+ yeni haber \(\d+ nişe uygun/.test(txt()), (txt().match(/\d+ yeni haber \([^)]*\)/) || [''])[0]);
const newItems = (await q1("SELECT count(*)::int n FROM news_items WHERE project_id = $1", [pid])).n; ok('headlines are in the database with their sources', newItems >= 10 && (await q1("SELECT count(DISTINCT source_name)::int n FROM news_items")).n === 2, `${newItems} headlines`);
await click(tab('Olaylar'), 500);
ok('events are listed with their category and the reason the filter gave', txt().includes('Vendor data breach') && txt().includes('Digital Privacy & Security') && txt().includes('“Digital Privacy & Security”: '));
await click(btn('İlgisiz yap'), 600);
ok('a person can overrule the filter: marked, saved, and kept', (await q1("SELECT count(*)::int n FROM news_clusters WHERE manual_override AND status = 'irrelevant'")).n === 1);
await click(btn('Yeniden değerlendir'), 700);
ok('"Yeniden değerlendir" runs the current filter again and says what changed, keeping the person\'s decision', txt().includes('Yeniden değerlendirildi') && /\d+ haberi yeni kurallarla tekrar süzüldü/.test(txt()) && (await q1("SELECT count(*)::int n FROM news_clusters WHERE manual_override AND status = 'irrelevant'")).n === 1);
await click(tab('Haberler'), 400); ok('the headline list shows each status and reason', txt().includes('Nişe uygun') && txt().includes('İlgisiz'));
await click(tab('Taramalar'), 400); ok('the run history shows the scan', txt().includes('elle') && /elle(ok|partial)/.test(txt()), txt().slice(txt().indexOf('Başlangıç'), txt().indexOf('Başlangıç') + 200));

await click(nav('Trend Analizi'), 600);
ok('trends: events ranked from real counts, daily chart, no invented keyword trends', txt().includes('En hızlı yükselen olaylar') && txt().includes('Haberi veren farklı kaynak') && txt().includes('Henüz arama geçmişi olan anahtar kelime yok'));

await click(nav('Niş Keşif Merkezi'), 500); await click(btn('Yeni öneri ara'), 700);
ok('niche discovery runs without inventing anything (an honest empty list)', txt().includes('Hiçbir öneri kendiliğinden siteye eklenmez') && (txt().includes('Öneri yok') || txt().includes('günde')));

await click(nav('Anahtar Kelime Araştırması'), 500);
ok('without Apify the page offers both ways (the free start and no payment at all) and still lists/adds keywords', txt().includes('Apify bağlı değil') && txt().includes('Ücretsiz başlangıç') && txt().includes('Hiç ödeme yok') && !txt().includes('DataForSEO') && txt().includes('Anahtar kelime yok'));
await click(btn('Kelime ekle'), 300); await setVal($('.modal textarea'), 'chrome data breach\nunknown thing keyword\nunknown thing keyword'); await click(btn('Ekle', $('.modal')), 600);
ok('keywords are cleaned and stored without any API call', (await q1("SELECT count(*)::int n FROM keywords")).n === 2 && globalThis.__apify.length === 0 && txt().includes('Henüz sorgulanmadı'));
await click(nav('API Kullanımı ve Maliyetler'), 500);
const apifyCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Apify (Google anahtar kelime verisi)');
ok('the Apify card explains the free start, that it is somebody else\'s actor, and that the price is unknown to us', !!apifyCard && apifyCard.textContent.includes('ÖNERİLEN ÜCRETSİZ BAŞLANGIÇ') && apifyCard.textContent.includes('Maliyeti biz bilemeyiz') && apifyCard.textContent.includes('Aylık en çok sorgulanacak anahtar kelime') && !apifyCard.textContent.includes('Günlük bütçe'));
await setVal(input('Apify API belirteci', apifyCard), 'apify_api_e2e_token_0123456789'); await click(btn('Kaydet', apifyCard), 700); await click(btn('Bağlantıyı test et', apifyCard), 800);
ok('Apify is saved (key encrypted, only the end shown); the free test reads the account, the usage and the actor', txt().includes('Kayıtlı · …6789') && !document.body.innerHTML.includes('apify_api_e2e_token_0123456789') && txt().includes('hesap: e2e-owner') && txt().includes('Bu ay kullanılan: $0.40 / $5.00') && globalThis.__apify.every((c) => c.method === 'GET'));
const serperCard0 = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Serper.dev');
await setVal(input('API anahtarı', serperCard0), 'serper-key-0123456789abcdef'); await click(btn('Kaydet', serperCard0), 700);
await click(nav('Anahtar Kelime Araştırması'), 500);
ok('Apify and Serper are connected: the SERP banner and the Apify banner are gone', !txt().includes('SERP kaynağı bağlı değil') && !txt().includes('Apify bağlı değil') && !!btn('Dosyadan hacim aktar') && !!btn('Kelime ekle'));
await click(nav('Sistem Ayarları'), 500);
const seoCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.startsWith('SEO araştırması'));
ok('SEO settings: there is no SERP-source choice any more (Serper.dev is the only one) and the partial-score switch is on', !input('SERP veri kaynağı', seoCard) && !input('SERP cihazı', seoCard) && txt().includes('Aranma hacmi yokken onayla kısmi puanla üretime izin ver') && $$('input[type=checkbox]', seoCard).filter((c) => c.checked).length >= 2);
await click(nav('Anahtar Kelime Araştırması'), 600);
await click(btn('Verisi olmayanların verisini çek'), 700);
ok('before spending anything it shows how many are asked, the cache, that the cost is unknown, and the monthly keyword cap', txt().includes('Sorgulanacak') && txt().includes('Zaten güncel') && txt().includes('Bilinmiyor') && txt().includes('Tutarı bilemeyiz') && txt().includes('Aylık güvenlik sınırı: 0/600'));
await click(btn('Verileri çek (Apify kredisi harcar)'), 800);
ok('the fetch result says how many answered and that the cost is unknown (never a made-up number)', txt().includes('2 anahtar kelimenin verisi alındı') && txt().includes('1 veri bulundu') && txt().includes('1 için veri yok') && txt().includes('Maliyet: Bilinmiyor'));
await click(btn('Kapat', $('.modal')), 300);
ok('values from the provider are shown; the missing one says "Veri bulunamadı" (never a 0)', txt().includes('14.800') && txt().includes('Veri bulunamadı') && globalThis.__apify.filter((c) => c.method === 'POST').length === 1);
await click(btn('SERP analizi'), 800);
ok('a SERP analysis from the keyword row fills the organic competition', !!$('.bar') && (await q1('SELECT count(*)::int n FROM serp_analyses')).n === 1);

await click(nav('SEO Rekabet Analizi'), 600);
ok('SERP page: says the score is not Google\'s metric, lists the analysis', txt().includes('Google’ın resmî zorluk metriği değildir') && txt().includes('chrome data breach'));
await click(btn('Ayrıntı'), 400);
ok('detail shows every factor, the top results with their kind, and the user questions', txt().includes('Puanı oluşturan etkenler') && txt().includes('Bağımsız site') && txt().includes('Is it real?') && txt().includes('Rekabet tahmini'));
await click(btn('Kapat') || aria('Kapat'), 300);

await click(nav('İçerik Fırsatları'), 500);
ok('opportunities start empty and explain the order of work', txt().includes('Henüz fikir yok') && txt().includes('Ağırlıklar: Trend %30'));
await click(btn('Yenile ve puanla'), 1500);
ok('relevant events became ideas; ideas without data say so instead of a score', txt().includes('Puan verilmedi') && (await q1('SELECT count(*)::int n FROM topics')).n >= 3 && (await q1('SELECT count(*)::int n FROM content_opportunities WHERE total_score IS NOT NULL')).n === 0, `topics ${(await q1('SELECT count(*)::int n FROM topics')).n}, page: ${txt().slice(txt().indexOf('Ağırlıklar'), txt().indexOf('Ağırlıklar') + 300)}`);
await click($('tbody tr'), 400);
ok('opening an idea shows each part, its weight and why it is not eligible', txt().includes('Neden yazıma alınmadı') && txt().includes('Toplam puan') && txt().includes('Anahtar kelime'));
await click(btn('Bugün ne yazılırdı?'), 700);
ok('the dry run says nothing is reserved and that weak ideas never pad the quota', txt().includes('kuru denemedir') && txt().includes('Bugün yazılacak yeterince nitelikli fikir yok'));
await click(btn('Kapat', $('.modal')) || aria('Kapat'), 300);

// ── FREE MODE: Serper.dev for the SERP, a pasted volume file, a partial score that only the shortlist turns into production ─────────────────────
await S.db.query('UPDATE niche_profiles SET min_opportunity_score = 10');
await click(nav('Sistem Ayarları'), 500);
const seoCard2 = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.startsWith('SEO araştırması'));
await click(nav('API Kullanımı ve Maliyetler'), 500);
const serperCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Serper.dev');
ok('the Serper.dev card explains the free start and the 1-credit test', !!serperCard && serperCard.textContent.includes('2.500 ücretsiz sorgu') && serperCard.textContent.includes('1 sorgu (1 kredi)'));
globalThis.__serper.length = 0;                                                      // (the earlier SERP analysis called Serper too: count from here)
await setVal(input('API anahtarı', serperCard), 'serper-key-0123456789abcdef'); await click(btn('Kaydet', serperCard), 700);
await click(btn('Bağlantıyı test et', serperCard), 800);
ok('the Serper key is saved (only the end shown) and the connection test works', txt().includes('Kayıtlı · …cdef') && txt().includes('Serper bağlantısı çalışıyor') && !document.body.innerHTML.includes('serper-key-0123456789abcdef') && globalThis.__serper.length === 1 && globalThis.__serper[0].key === 'serper-key-0123456789abcdef');

await click(nav('Anahtar Kelime Araştırması'), 600);
ok('with Serper connected the SERP banner is gone', !txt().includes('SERP kaynağı bağlı değil'));
const usageBeforeImport = (await q1('SELECT count(*)::int n FROM api_usage')).n;
await click(btn('Dosyadan hacim aktar'), 400);
ok('the import dialog explains where to get the file and that ranges are skipped', txt().includes('Anahtar Kelime Planlayıcı') && txt().includes('aralıklar ve “10K” gibi yuvarlak değerler atlanır'));
await setVal($('.modal textarea'), 'Keyword,Volume\nchrome flags,5400\nbig range keyword,1K - 10K\nrounded keyword,10K\n,50'); await click(btn('İçe aktar', $('.modal')), 800);
ok('the result names what was imported and every skipped kind with an example', txt().includes('1 anahtar kelimenin hacmi içe aktarıldı') && txt().includes('hacim aralık olarak geldi (ör. big range keyword)') && txt().includes('yuvarlak değer var (ör. rounded keyword)') && txt().includes('geçerli bir kelime yok'));
ok('only the exact number is stored, as real data from the file', (await q1("SELECT search_volume, provider FROM keyword_metrics m JOIN keywords k ON k.id = m.keyword_id WHERE k.keyword = 'chrome flags'")).search_volume === 5400 && (await q1("SELECT count(*)::int n FROM keywords WHERE keyword IN ('big range keyword', 'rounded keyword')")).n === 0 && (await q1('SELECT count(*)::int n FROM api_usage')).n === usageBeforeImport, 'an import calls no service: no usage row');
await click(btn('Kapat', $('.modal')), 300);
ok('the keyword table shows the volume with its source (file)', txt().includes('chrome flags') && txt().includes('5.400') && txt().includes('dosyadan'));

await click(nav('İçerik Fırsatları'), 600);
await click(btn('Yenile ve puanla'), 1500);
const serpBtn = $$('tbody button').find((b) => b.textContent.trim() === 'SERP');
ok('an idea without any volume offers the SERP check on its most specific candidate phrase', !!serpBtn);
await click(serpBtn, 1200);
ok('the SERP check ran on Serper (1 call, the key sent) and the idea now carries a PARTIAL score, not a total', globalThis.__serper.length === 2 && globalThis.__serper[1].key === 'serper-key-0123456789abcdef' && (await q1("SELECT count(*)::int n FROM content_opportunities WHERE (explain->>'partial') = 'true' AND total_score IS NULL AND provisional_score IS NOT NULL")).n === 1 && txt().includes('kısmi puan · hacim yok'));
await click($$('tbody tr').find((r) => r.textContent.includes('kısmi puan')), 400);
ok('opening it explains the partial score and that the person must approve', txt().includes('KISMİ PUAN') && txt().includes('“Kısa liste”ye alın') && txt().includes('dört bileşenin ortalaması'));
await click($$('tbody button').find((b) => b.textContent.trim() === 'Onayla (kısa liste)'), 800);
ok('the shortlist call is the approval: the idea becomes eligible, still without a total', (await q1("SELECT count(*)::int n FROM content_opportunities WHERE eligible AND total_score IS NULL AND status = 'shortlisted'")).n === 1 && txt().includes('uygun (onaylı)'));
await S.limits.setGlobalLimits({ new_article: 5 });                                  // the earlier limit scenario used today's single place up
await click(btn('Bugün ne yazılırdı?'), 800);
ok('the dry run lists it as a partial score chosen with the person\'s approval', $('.modal') && $('.modal').textContent.includes('kısmi') && $('.modal').textContent.includes('hacim verisi yok, sizin onayınızla'), $('.modal') && $('.modal').textContent.slice(0, 500));
await click(btn('Kapat', $('.modal')) || aria('Kapat'), 300);
await click(nav('SEO Rekabet Analizi'), 600);
ok('the SERP page shows the source of each analysis and says the cost is a credit amount, not a made-up dollar figure', txt().includes('Serper.dev') && txt().includes('Serper kredisi (tutar bilinmiyor)'));

// ── PHASE 3: the AI writer and the mandatory checks (the model vendors are a fake that answers in their documented shapes) ──────────────────
await S.db.query("UPDATE news_items SET url = $1 || '/page.html?i=' || id::text", [globalThis.__feedBase]);
await click(nav('API Kullanımı ve Maliyetler'), 500);
const claudeCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.startsWith('Anthropic'));
ok('the Claude card exists, says its model defaults and that prices are optional', !!claudeCard && claudeCard.textContent.includes('claude-sonnet-5-5') && claudeCard.textContent.includes('isteğe bağlı'));
await setVal(input('API anahtarı', claudeCard), 'sk-ant-e2e-key-0123456789'); await setVal(input('Giriş fiyatı', claudeCard), '3'); await setVal(input('Çıkış fiyatı', claudeCard), '15'); await click(btn('Kaydet', claudeCard), 700);
ok('the Claude key is saved encrypted (only the end shown) with its prices', txt().includes('Kayıtlı · …6789') && !document.body.innerHTML.includes('sk-ant-e2e-key') && (await q1("SELECT extra->>'inputPricePerM' AS p FROM api_providers WHERE key = 'anthropic'")).p === '3');

await click(nav('İçerik Fırsatları'), 700);
const writeBtn = $$('tbody button').find((b) => b.textContent.includes('Makale yaz'));
ok('an eligible idea (here the shortlisted partial one) offers "Makale yaz"; ideas that are not eligible do not', !!writeBtn && $$('tbody button').filter((b) => b.textContent.includes('Makale yaz')).length === (await q1("SELECT count(*)::int n FROM content_opportunities WHERE eligible AND status IN ('new', 'shortlisted')")).n);
await click(writeBtn, 700);
ok('the dialog names the writer vendor and model, says nothing is published automatically and what it costs', txt().includes('Anthropic (Claude) — claude-sonnet-5-5') && txt().includes('asla kendiliğinden yayımlanmaz') && txt().includes('3 model isteği') && txt().includes('günlük makale limitinden 1 yer'));
await click(btn('Makaleyi yaz', $('.modal')), 400);
for (let i = 0; i < 80; i += 1) { if ((await q1("SELECT status FROM automation_runs WHERE bot_key = 'article_writer' ORDER BY id DESC LIMIT 1")).status !== 'running') break; await new Promise((r) => setTimeout(r, 250)); }
await wait(2800);
const aiArt = await q1("SELECT * FROM articles WHERE created_by = 'ai'");
ok('the draft exists, written by the model, waiting for a person: sources, stamp, AdSense class and quality score are filled', !!aiArt && aiArt.status === 'needs_review' && aiArt.fact_checked_at !== null && aiArt.adsense_risk === 'low' && aiArt.quality_score > 0 && aiArt.word_count >= 300 && aiArt.manual_edited === false && (await q1('SELECT count(*)::int n FROM article_sources WHERE article_id = $1', [aiArt.id])).n >= 1, JSON.stringify(aiArt ? { status: aiArt.status, q: aiArt.quality_score } : await q1("SELECT status, error, stats FROM automation_runs WHERE bot_key = 'article_writer' ORDER BY id DESC LIMIT 1")));
ok('three model calls were made (write, fact check, review) and each is a usage row with the cost computed from the typed prices', globalThis.__models.calls.length === 3 && (await q1("SELECT count(*)::int n, bool_and(cost_micros IS NOT NULL) AS priced FROM api_usage WHERE provider = 'anthropic' AND result = 'ok'")).n === 3 && (await q1("SELECT bool_and(cost_micros IS NOT NULL) AS priced FROM api_usage WHERE provider = 'anthropic'")).priced === true);
ok('the idea is now "written" and links to its article; the banner is gone', txt().includes('Makaleyi aç') && !txt().includes('Makale yazılıyor:') && (await q1("SELECT count(*)::int n FROM content_opportunities WHERE status = 'written' AND article_id IS NOT NULL")).n === 1);

await click(btn('Makaleyi aç'), 900);
ok('the editor shows the checks: quality score with its five weighted parts, the AdSense class with its disclaimer, the claims with their verified quotes', txt().includes('Kontroller ve kalite') && txt().includes('Özgünlük ve ek değer') && txt().includes('(%25)') && txt().includes('AdSense risk tahmini') && txt().includes('garanti etmez') && txt().includes('Destekleniyor') && txt().includes('Yazan: anthropic'));
ok('the rules list names what was measured (copy overlap, keyword density, length)', txt().includes('Kaynaklardan kelimesi kelimesine kopya') && txt().includes('Anahtar kelime yoğunluğu') && txt().includes('13 kategori'));
ok('the readiness card has no missing mandatory check for the fact check and the AdSense class', !txt().includes('Doğruluk kontrolü yapılmadı') && !txt().includes('AdSense risk kontrolü yapılmadı'));
const callsBefore = globalThis.__models.calls.length;
await click(btn('Ücretsiz kontroller'), 900);
ok('the free checks call no model', globalThis.__models.calls.length === callsBefore && (await q1("SELECT count(*)::int n FROM article_checks WHERE kind = 'rules'")).n === 2);
const body = $$('textarea.mono')[0]; await setVal(body, body.value + '<p>One more sentence added by an editor.</p>'); await click(btn('Kaydet'), 900);
ok('editing the text withdraws the stamp, the AdSense class and the score (they described the old text)', (await q1('SELECT fact_checked_at, quality_score, adsense_risk, manual_edited FROM articles WHERE id = $1', [aiArt.id])).fact_checked_at === null && (await q1('SELECT quality_score FROM articles WHERE id = $1', [aiArt.id])).quality_score === null && (await q1('SELECT adsense_risk FROM articles WHERE id = $1', [aiArt.id])).adsense_risk === null && txt().includes('eski metne ait'));
await click(btn('Tüm kontroller (yapay zekâ)'), 500);
ok('running the model checks asks first and says it spends the service\'s credit', txt().includes('Tüm kontroller yapay zekâ ile çalıştırılsın mı?') && txt().includes('2 istek'));
await click(btn('Çalıştır', $('.modal')), 1500);
ok('the checks ran again on the new text: stamp, AdSense class and score are back, nothing stale is left', globalThis.__models.calls.length === callsBefore + 2 && (await q1('SELECT fact_checked_at, adsense_risk, quality_score FROM articles WHERE id = $1', [aiArt.id])).quality_score > 0 && !txt().includes('eski metne ait'));

await click(nav('AI Makale Üretimi'), 700);
ok('the writer page lists the vendors (who writes, who checks) and the history of the run with its cost and a link to the article', txt().includes('Yapay zekâ sağlayıcıları') && txt().includes('Anthropic (Claude)') && txt().includes('yazar') && txt().includes('kontrol') && txt().includes('yazan modelin kendisi yapar') && txt().includes('Yazım geçmişi') && txt().includes('3 kaynak') === false && /\$0\.\d+/.test(txt()) && !!btn('Makale'));

// ── PHASE 4: bot management, schedule editor, persistent queue ───────────────────────────────────────────────────────────
await click(nav('Bot Yönetimi'), 700);
ok('the bots page shows the schedule of each bot, that paid bots start off, and the scheduler state', txt().includes('kalıcı görev kuyruğu') && txt().includes('Otomatik: 2 saatte bir') && txt().includes('para harcar') && $$('button').filter((b) => b.textContent.includes('Şimdi çalıştır')).length === 13);
const wrow = $$('tbody tr').find((r) => r.textContent.includes('AI Article Writer'));
await click($$('button', wrow).find((b) => b.textContent.includes('Zamanlama')), 500);
ok('the schedule dialog warns that this bot spends money and keeps the limits', txt().includes('Bu bot para harcar') && txt().includes('Makaleler yine kendiliğinden yayımlanmaz') && txt().includes('yalnızca BİR kez'));
await setVal(input('Her çalışmada en fazla', $('.modal')), '2'); await setVal(input('Ne sıklıkla', $('.modal')), '240'); await click($$('input[type=checkbox]', $('.modal'))[0], 100); await click(btn('Kaydet', $('.modal')), 700);
const sched = await q1("SELECT enabled, interval_minutes, window_start, window_end, options FROM schedule_settings WHERE bot_key = 'article_writer'");
ok('the schedule is saved in the database (on, every 4 hours, 09:00-23:00, 2 per run) and the page says so', sched.enabled === true && sched.interval_minutes === 240 && sched.window_start === '09:00' && sched.options.perRun === 2 && txt().includes('Otomatik: 4 saatte bir (09:00–23:00)'));
const nrow = $$('tbody tr').find((r) => r.textContent.includes('News Discovery Bot'));
await click($$('button', nrow).find((b) => b.textContent.includes('Şimdi çalıştır')), 700);
ok('"run now" queues a manual job (nothing runs it here: the loops are off in tests) and the page shows it waiting', (await q1("SELECT status, trigger FROM jobs WHERE bot_key = 'news_discovery'")).status === 'queued' && txt().includes('1 sırada'));
await click(tab('Görev kuyruğu'), 700);
ok('the queue tab lists the job with its source, state and a cancel button', txt().includes('news_discovery') && txt().includes('elle') && txt().includes('Sırada') && !!btn('İptal'));
await click(btn('İptal'), 700);
ok('cancelling works and the job is not run later', (await q1("SELECT status FROM jobs WHERE bot_key = 'news_discovery'")).status === 'cancelled' && txt().includes('İptal') && !!btn('Yeniden dene'));
await click(btn('Yeniden dene'), 700);
ok('a cancelled job can be queued again by the owner', (await q1("SELECT status, trigger FROM jobs WHERE bot_key = 'news_discovery' ORDER BY id DESC LIMIT 1")).trigger === 'retry');

// ── PHASE 5: WordPress sites, category mapping, sending, planning, calendar (a fake WordPress over real HTTP) ─────────────────────────────
const WP = globalThis.__wp; const drainQueue = async () => { for (let i = 0; i < 40; i += 1) { if (!(await S.scheduler.workOnce({ ctx: {} }))) return; } };
await click(nav('Web Sitelerim'), 600);
ok('without a site the page explains the archive mode and offers to add one', txt().includes('Henüz WordPress sitesi bağlı değil') && txt().includes('Araştırma ve Arşiv Modu') && !!btn('Site ekle'));
await click(btn('Site ekle'), 400);
ok('the add dialog tells how to create an application password and that it is stored encrypted', txt().includes('Uygulama Şifreleri') && txt().includes('şifreli saklanır'));
await setVal(input('Site adı', $('.modal')), 'E2E Blog'); await setVal(input('WordPress adresi', $('.modal')), WP.url); await setVal(input('Kullanıcı adı', $('.modal')), 'editor'); await setVal(input('Uygulama şifresi', $('.modal')), 'abcd efgh ijkl mnop');
await click(btn('Kaydet', $('.modal')), 1500);
ok('the site is saved, tested at once and shown with its result; the password is nowhere in the page', txt().includes('E2E Blog') && txt().includes('bağlantı çalışıyor') && txt().includes('Fake Tech Blog') && txt().includes('şifre …mnop') && !document.body.innerHTML.includes('abcd efgh'));
ok('the first working site connects the project', (await q1('SELECT mode, domain FROM content_projects')).mode === 'connected' && (await q1("SELECT encrypted_password FROM wp_sites")).encrypted_password.startsWith('enc:v1:'));
await click(btn('Kategori eşleştirme'), 800);
ok('the mapping dialog lists our categories next to the site\'s with a SUGGESTION for the same name', txt().includes('Bizim kategori') && txt().includes('öneri: “AI Tools & Updates”'));
const crow = $$('.modal tbody tr').find((r) => r.textContent.includes('AI Tools')); await click($$('button', crow).find((b) => b.textContent.includes('Sitede oluştur')), 800);
ok('"create on the site" makes the category on the site and maps it', WP.categories.some((c) => c.name === 'AI Tools & Updates' && c.id > 100) && (await q1('SELECT count(*)::int n FROM wp_category_map')).n === 1);
await click(btn('Kapat', $('.modal')), 300);

// send the article of the writer scenario as a DRAFT from its editor
const aiId = (await q1("SELECT id FROM articles WHERE created_by = 'ai'")).id;
await S.db.query("UPDATE articles SET status = 'ready' WHERE id = $1", [aiId]);
const aiH1 = (await q1('SELECT h1 FROM articles WHERE id = $1', [aiId])).h1;
await click(nav('Makale Arşivi'), 500); await click($$('tbody tr').find((r) => r.textContent.includes(aiH1)), 900);
ok('the editor has a WordPress card with the send form (draft by default)', txt().includes('WordPress') && txt().includes('Taslak olarak') && !!btn('Gönder'));
await click(btn('Gönder'), 900); await drainQueue(); await wait(3200);
const dpub = await q1('SELECT status, wp_post_id, mode FROM publications');
ok('the send went through the queue: a draft post exists on the site and the card says so with a link', dpub.status === 'draft' && WP.posts.size === 1 && [...WP.posts.values()][0].status === 'draft' && txt().includes('Taslak (sitede)') && txt().includes('yazıyı aç'), JSON.stringify(dpub));
ok('the article itself stays in the archive state a person gave it (a draft on the site is not publishing)', (await q1('SELECT status FROM articles WHERE id = $1', [aiId])).status === 'ready');

// the person publishes the draft IN WORDPRESS: the card has a read-only "read it back" button (the bot's hourly pass does the same when it is on)
ok('while the post is a draft on the site the card offers to read its state back', !!btn('Durumu WordPress’ten oku') && txt().includes('Hiçbir şey gönderilmez, yalnızca okunur'));
const wpWrites = () => WP.requests.filter((r) => r.method !== 'GET').length; const w0 = wpWrites();
await click(btn('Durumu WordPress’ten oku'), 900);
ok('read while still a draft there: nothing changes', (await q1('SELECT status FROM publications')).status === 'draft' && (await q1('SELECT status FROM articles WHERE id = $1', [aiId])).status === 'ready');
const wpPostId = (await q1('SELECT wp_post_id FROM publications')).wp_post_id; WP.goLive(Number(wpPostId));
await click(btn('Durumu WordPress’ten oku'), 1200);
ok('after the person published it in WordPress the read-back makes publication and article "published", sends nothing, and the card says "Yayında"', (await q1('SELECT status FROM publications')).status === 'published' && (await q1('SELECT status FROM articles WHERE id = $1', [aiId])).status === 'published' && wpWrites() === w0 && txt().includes('Yayında') && !btn('Durumu WordPress’ten oku'));
// (put it back the way the following steps expect it)
WP.posts.get(Number(wpPostId)).status = 'draft'; await S.db.query("UPDATE publications SET status = 'draft', published_at = NULL, synced_at = NULL WHERE article_id = $1", [aiId]); await S.db.query("UPDATE articles SET status = 'ready' WHERE id = $1", [aiId]);

// many articles: plan, then send as a spread over days
const mk = async (n) => { const out = []; for (let i = 0; i < n; i += 1) { const a = await S.articles.create({ projectId: pid, h1: `E2E router guide ${i}`, seoTitle: `E2E router guide ${i}`, metaDescription: 'm'.repeat(100), focusKeyword: `e2e router ${i}`, categoryId: (await q1('SELECT id FROM categories LIMIT 1')).id, contentHtml: `<h2>Hi</h2><p>${'Plain words for the reader. '.repeat(80)}</p>`, articleType: 'evergreen_guide' }); await S.db.query("UPDATE articles SET status = 'ready', fact_checked_at = now(), adsense_risk = 'low', quality_score = $2 WHERE id = $1", [a.id, 90 - i]); out.push(a); } return out; };
const made = await mk(3);
await click(nav('Toplu Yayınlama'), 800);
ok('the bulk page lists ready articles not yet sent to the site and explains the rules', txt().includes('E2E router guide 0') && txt().includes('“Yayına hazır” olması şarttır'));
await setVal(input('Nasıl'), 'spread'); await wait(600);
await click($$('input[type=checkbox]').find((c) => c.getAttribute('aria-label') === 'Hepsini seç'), 200); await click(btn('Planı göster'), 900);
ok('the plan is a dry run: each article with its day and time, nothing sent, no place of the day taken', txt().includes('kuru denemedir') && txt().includes('3 makale planlandı') && WP.posts.size === 1 && (await q1("SELECT count(*)::int n FROM publications")).n === 1);
await click(btn('3 makaleyi gönder'), 900); await drainQueue(); await wait(100); await click(btn('Yenile'), 900);
ok('the batch ran: three scheduled posts on the site (status "future"), listed in the history as scheduled', WP.posts.size === 4 && [...WP.posts.values()].filter((p) => p.status === 'future').length === 3 && txt().includes('Zamanlandı') && (await q1("SELECT count(*)::int n FROM publications WHERE status = 'scheduled'")).n === 3);
ok('the places of the days were taken by the scheduled posts (the limit of each day is respected)', (await q1("SELECT coalesce(sum(used), 0)::int n FROM daily_work_usage WHERE work_type = 'publish' AND scope = 'global'")).n === 3);

await click(nav('İçerik Takvimi'), 800);
ok('the calendar shows the scheduled posts on their days with their state', txt().includes('E2E router guide 0') && txt().includes('Zamanlandı') && txt().includes('3 yayın') || (txt().includes('E2E router guide 0') && txt().includes('Zamanlandı')));
await click(nav('Bot Yönetimi'), 700);
ok('the WordPress bot is listed (auto-publish is off by default)', txt().includes('Content Publishing Bot') && txt().includes('Otomatik kapalı; elle çalıştırılır') && $$('button').filter((b) => b.textContent.includes('Şimdi çalıştır')).length === 13);
void made;

// ── PHASE 6a: content health, update drafts (refresh engine), version comparison ────────────────────────────────────────────────────
await S.settings.set('update', { policy: 'manual' });
const hid = (await S.articles.create({ projectId: pid, h1: 'E2E pricing explainer', seoTitle: 'E2E pricing explainer', metaDescription: 'm'.repeat(100), focusKeyword: 'e2e pricing explainer', categoryId: (await q1('SELECT id FROM categories LIMIT 1')).id,
  contentHtml: `<h2>Price</h2><p>${'The plan costs 20 dollars a month and renews each month for every subscriber. '.repeat(30)}</p><p>See <a href="${globalThis.__feedBase}/gone-page">the old announcement</a>.</p>`, articleType: 'latest_update' })).id;
await S.db.query("UPDATE articles SET status = 'ready', fact_checked_at = now(), adsense_risk = 'low', quality_score = 90 WHERE id = $1", [hid]);
await S.db.query("INSERT INTO article_sources (article_id, url, title, publisher, excerpt, reliability, read_ok, position) VALUES ($1, $2, 'Report', 'Outlet', $3, 80, true, 1)", [hid, `${globalThis.__feedBase}/page.html`, 'OpenAI said on Tuesday that ChatGPT Plus will cost 22 dollars a month starting in January 2027, up from 20 dollars. The company said higher compute costs were behind the increase. Existing subscribers keep the current price through December.']);
await click(nav('İçerik Sağlığı'), 800);
ok('the health page shows counts and the article list; performance says it is not connected instead of inventing numbers', txt().includes('Güncelleme bekleyen') && txt().includes('E2E pricing explainer') && txt().includes('Search Console bağlı değil') && txt().includes('hiç kontrol edilmedi'));
const hrow = () => $$('tbody tr').find((r) => r.textContent.includes('E2E pricing explainer'));
await click($$('button', hrow()).find((b) => b.textContent.includes('Şimdi kontrol et')), 1500);
ok('checking it finds the broken link: the reason is written, the article now waits for an update', txt().includes('1 bağlantı bozuk') && txt().includes('Güncelleme bekliyor') && (await q1('SELECT status FROM articles WHERE id = $1', [hid])).status === 'needs_update');
await click($$('button', hrow()).find((b) => b.textContent.includes('Taslak hazırla')), 700); await drainQueue(); await wait(300);
const prop = await q1("SELECT id, kind, status FROM refresh_proposals WHERE article_id = $1", [hid]);
ok('a draft was prepared through the queue (the article itself is untouched until approval)', !!prop && prop.status === 'proposed' && (await q1('SELECT current_version v FROM articles WHERE id = $1', [hid])).v === 1, JSON.stringify(prop));
await click(nav('Güncelleme Merkezi'), 800);
ok('the update center lists it with its kind and a reason; a manual policy never applied it by itself', txt().includes('E2E pricing explainer') && txt().includes('Onay bekliyor') && txt().includes('Küçük güncelleme'));
await click(btn('Ayrıntı'), 900);
ok('the detail shows what changes word by word, the checks of the proposed text and the cost', !!$('.modal .diff ins') && txt().includes('Önerilen metnin kontrolleri') && txt().includes('Update: the plan details') && txt().includes('maliyet'));
await click(btn('Onayla ve uygula', $('.modal')), 1500);
ok('approving makes version 2 of the SAME article (same address), the broken link is gone, the list says applied', (await q1('SELECT current_version v, content_html h, slug FROM articles WHERE id = $1', [hid])).v === 2 && !(await q1('SELECT content_html h FROM articles WHERE id = $1', [hid])).h.includes('gone-page') && (await q1("SELECT status FROM refresh_proposals WHERE article_id = $1", [hid])).status === 'applied');
await click(tab('Uygulanan'), 800); ok('the applied tab shows it', txt().includes('E2E pricing explainer') && txt().includes('Uygulandı'));
await click(nav('Makale Arşivi'), 600); await click($$('tbody tr').find((r) => r.textContent.includes('E2E pricing explainer')), 900);
await click(btn('Farkı göster'), 900);
ok('the version comparison of the editor shows removed and added words', !!$('.modal .diff del') || !!$('.modal .diff ins'));
await click(btn('Kapat', $('.modal')) || aria('Kapat'), 300);

// ── PHASE 6b: Search Console performance, internal links ───────────────────────────────────────────────────────────────────────────
await click(nav('Web Sitelerim'), 700);
ok('the site card says Search Console is not connected yet', txt().includes('Search Console bağlı değil') && !btn('Search Console verisini çek'));
await click($$('button.btn').find((b) => b.textContent.trim() === 'Ayarlar'), 400);
ok('the settings dialog has the Search Console property field with a hint for both property kinds', !!input('Search Console sitesi', $('.modal')) && txt().includes('sc-domain:siteniz.com'));
await setVal(input('Search Console sitesi', $('.modal')), 'blog.example'); await click(btn('Kaydet', $('.modal')), 600);
ok('a wrong property form is refused by the server and the dialog stays open', !!$('.modal') && (await q1('SELECT gsc_property FROM wp_sites')).gsc_property === null);
await setVal(input('Search Console sitesi', $('.modal')), 'sc-domain:e2e.example'); await click(btn('Kaydet', $('.modal')), 900);
ok('the property is saved and the card says the data was not fetched yet, with the fetch button', (await q1('SELECT gsc_property FROM wp_sites')).gsc_property === 'sc-domain:e2e.example' && txt().includes('Search Console: henüz çekilmedi') && !!btn('Search Console verisini çek'));

await click(nav('SEO Performansı'), 800);
ok('without data the performance page says so (no invented numbers) and explains the 4 setup steps', txt().includes('Search Console bağlı değil') && txt().includes('servis hesabı') && txt().includes('henüz çekilmedi') && !txt().includes('Ortalama tıklama oranı'));

await click(nav('API Kullanımı ve Maliyetler'), 500);
const gscCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Google Search Console');
ok('the Search Console card asks for the service-account JSON and says how to get it', !!gscCard && gscCard.textContent.includes('Servis hesabı anahtarı (JSON)') && gscCard.textContent.includes('Kısıtlı'));
await setVal(input('Servis hesabı anahtarı', gscCard), 'this is not json'); await click(btn('Kaydet', gscCard), 600);
ok('a key that is not the JSON file is refused and nothing is saved', (await q1("SELECT count(*)::int n FROM api_providers WHERE key = 'searchconsole' AND encrypted_secret IS NOT NULL")).n === 0);
await setVal(input('Servis hesabı anahtarı', gscCard), JSON.stringify(globalThis.__gkey.json)); await click(btn('Kaydet', gscCard), 700);
await click(btn('Bağlantıyı test et', gscCard), 900);
ok('the key is saved (only its end shown), the real signed token request is accepted and the account sees the site; the key is nowhere in the page', txt().includes('Search Console bağlantısı çalışıyor') && txt().includes('sc-domain:e2e.example') && !document.body.innerHTML.includes('PRIVATE KEY') && globalThis.__google.st.tokens === 1);

// the AI article's post gets a public address so the page of Google's report can be matched to the article
const gArt = await q1("SELECT p.id pid, p.article_id aid, a.h1 FROM publications p JOIN articles a ON a.id = p.article_id WHERE p.mode = 'draft' ORDER BY p.created_at LIMIT 1");
await S.db.query("UPDATE publications SET status = 'published', wp_url = 'https://e2e.example/my-router-post/' WHERE id = $1", [gArt.pid]);
await click(nav('Web Sitelerim'), 700); await click(btn('Search Console verisini çek'), 1500);
ok('fetching stores 90 days of daily rows from the (signed) request; the card shows when', (await q1('SELECT count(*)::int n FROM gsc_daily')).n === 180 && txt().includes('Search Console: veri') && globalThis.__google.queries().length === 5);
await click(nav('SEO Performansı'), 1000);
ok('the numbers are those of the report: 28 days x (4 + 1) clicks of the two pages = 140, with the previous period for comparison', txt().includes('Ortalama tıklama oranı') && txt().includes('Ortalama sıra') && txt().includes('önceki 140') && txt().includes('Tıklama') && txt().includes('Gösterim'));
ok('the page of our own article is shown by the article title (a link), the foreign page by its address; countries and devices are there', txt().includes(gArt.h1) && txt().includes('https://e2e.example/not-ours/') && txt().includes('ABD') && txt().includes('Mobil') && txt().includes('e2e wifi router'));
await click(tab('Son 7 gün'), 900);
ok('the 7-day view recomputes from the stored days (7 x 5 = 35 clicks)', txt().includes('Son 7 gün') && txt().includes('önceki 35'));
ok('the opportunities card says what it is: signs only, and that seasonality cannot be judged', txt().includes('Fırsatlar ve işaretler') && txt().includes('Mevsimsellik'));
await click(nav('Dashboard'), 1200);
const gscClicks = (await q1("SELECT sum(clicks)::int n FROM gsc_daily WHERE day > (now() AT TIME ZONE 'UTC')::date - 30")).n;
ok('the dashboard shows organic traffic from the stored Search Console days: a chart, the totals of the shown period, the newest day, and no phase wording', gscClicks > 0 && txt().includes(`${gscClicks.toLocaleString('tr-TR')} tıklama`) && txt().includes('Search Console 2-3 gün geriden gelir') && !txt().includes('Henüz bağlı bir web sitesi yok') && !/Aşama \d/.test(txt()));
await click(nav('İçerik Sağlığı'), 900);
ok('the health page now shows the clicks of each article (and no longer says "not connected")', txt().includes('Tıklama (28 gün)') && txt().includes('Tıklaması belirgin düşen') && !txt().includes('Search Console bağlı değil'));

// internal links: a source article that already says the target's focus phrase
const catId = (await q1('SELECT id FROM categories LIMIT 1')).id; const linkBody = (extra) => `<h2>Intro</h2><p>${'Plain words for the reader and nothing else. '.repeat(70)}${extra}</p>`;
const tgt = await S.articles.create({ projectId: pid, h1: 'E2E quantum guide', seoTitle: 'E2E quantum guide', metaDescription: 'm'.repeat(100), focusKeyword: 'quantum widget handbook', categoryId: catId, contentHtml: linkBody(''), articleType: 'evergreen_guide' });
const src = await S.articles.create({ projectId: pid, h1: 'E2E link source', seoTitle: 'E2E link source', metaDescription: 'm'.repeat(100), focusKeyword: 'link source topic', categoryId: catId, contentHtml: linkBody(' Readers who want more should open the Quantum Widget Handbook today.'), articleType: 'evergreen_guide' });
await S.db.query("UPDATE articles SET status = 'ready', fact_checked_at = now(), adsense_risk = 'low', quality_score = 90 WHERE id = ANY($1)", [[tgt.id, src.id]]);
await click(nav('İç Bağlantılar'), 700);
await click(btn('Yeni öneri ara'), 1000);
ok('the search finds the one place where a source article already says the target\'s phrase: the anchor keeps the written case, the sentence is shown with the words marked', txt().includes('E2E link source') && txt().includes('E2E quantum guide') && txt().includes('“Quantum Widget Handbook”') && !!$$('mark').find((m) => m.textContent === 'Quantum Widget Handbook'));
ok('the target is not public yet: the suggestion is a draft and cannot be applied', txt().includes('Taslak') && $$('button').filter((b) => b.textContent.includes('Bağlantıyı ekle')).every((b) => b.disabled));
await S.db.query("INSERT INTO publications (project_id, article_id, site_id, mode, status, wp_post_id, wp_url, article_version) SELECT $1, $2, s.id, 'publish', 'published', 777, 'https://e2e.example/quantum-widget-handbook/', 1 FROM wp_sites s LIMIT 1", [pid, tgt.id]);
await click(tab('Eskiyen'), 400); await click(tab('Bekleyen'), 900);
const lcard = $$('section.card').find((c) => c.textContent.includes('E2E link source') && c.textContent.includes('Quantum Widget Handbook'));
ok('once the target has a public address the draft label is gone and the button is on', !!lcard && !lcard.textContent.includes('Taslak') && !!$$('button', lcard).find((b) => b.textContent.includes('Bağlantıyı ekle') && !b.disabled) && lcard.textContent.includes('https://e2e.example/quantum-widget-handbook/'));
await click($$('button', lcard).find((b) => b.textContent.includes('Bağlantıyı ekle')), 500);
ok('the dialog explains what happens (new version, text unchanged, checks stay)', !!$('.dialog, .modal') && txt().includes('kontroller geçerli kalır'));
await click(btn('Bağlantıyı ekle', $('.modal, .dialog')), 1400);
const after = await q1('SELECT current_version v, content_html h, fact_checked_at, quality_score, adsense_risk FROM articles WHERE id = $1', [src.id]);
ok('the link is in the article as version 2, only those words changed, and the checks of the article stayed', after.v === 2 && /<a href="https:\/\/e2e\.example\/quantum-widget-handbook\/"[^>]*>Quantum Widget Handbook<\/a>/.test(after.h) && after.fact_checked_at !== null && after.quality_score === 90 && after.adsense_risk === 'low');
await click(tab('Uygulanan'), 800);
ok('the applied tab lists it with its version', txt().includes('E2E link source') && txt().includes('sürümünde uygulandı'));

// ── PHASE 7a: AdSense site audit ────────────────────────────────────────────────────────────────────────────────────────────────────
const SITE = globalThis.__site;
await click(nav('AdSense Denetimi'), 800);
ok('the audit page says what it reads, that it is free and read-only, and that the result is not an approval; nothing was audited yet', txt().includes('herkese açık sayfalarını') && txt().includes('Sonuç bir onay değildir') && txt().includes('Henüz denetim yapılmadı') && !!btn('Denetle'));
await setVal(input('Site adresi'), SITE.url); await click(btn('Denetle'), 500); await drainQueue(); await wait(3600);
ok('the audit of a brand new WordPress install ran through the queue: "Eksikler var", the address, the count of missing required items', txt().includes('Eksikler var') && txt().includes(SITE.url) && txt().includes('Zorunlu eksikler: 3') && (await q1("SELECT count(*)::int n FROM adsense_audits WHERE status = 'done'")).n === 1);
await click(btn('Ayrıntı'), 900);
ok('the detail groups the checks, names the draft privacy page of WordPress, and the manual items say they cannot be decided automatically', !!$('.modal') && txt().includes('Gerekli sayfalar') && txt().includes('Teknik durum') && txt().includes('taslağı oluşturur') && txt().includes('Elle kontrol (otomatik denetim karar veremez)') && txt().includes('tahmin etmez') && txt().includes('AdSense onayını garanti etmez'));
await click($$('button', $('.modal')).find((b) => b.textContent.includes('Nasıl düzeltilir?')), 300);
ok('"how to fix" opens the advice of an item', txt().includes('Ayarlar → Gizlilik') || txt().includes('Hosting panelinden') || txt().includes('gerçek bir'));
await click(btn('Kapat', $('.modal')), 300);
// the owner publishes the pages: the SAME address is audited again and the change is shown
Object.assign(SITE.config, { pages: [...globalThis.__fakeSite.READY.pages], posts: 14, postWords: 650, author: { name: 'Jane Doe', bio: 'Jane writes about technology.' }, description: 'AI news explained', firstPostTitle: null, cmp: 'complianz' });
await click(btn('Yeniden denetle'), 500); await drainQueue(); await wait(3600);
ok('the second audit of the same address says how many items changed since the first', txt().includes('öncekine göre') && (await q1("SELECT count(*)::int n FROM adsense_audits WHERE status = 'done'")).n === 2);
await click(btn('Ayrıntı'), 900);
ok('the detail lists what got better (privacy policy: Eksik → Geçti)', txt().includes('Önceki denetimden bu yana değişenler') && /Gizlilik Politikası[^:]*: Eksik → Geçti/.test(txt()));
await click(btn('Kapat', $('.modal')), 300);
// the publisher number lives in the site's settings (admin), validated
await click(nav('Web Sitelerim'), 700); await click($$('button.btn').find((b) => b.textContent.trim() === 'Ayarlar'), 400);
ok('the site settings have the AdSense publisher number field with its explanation', !!input('AdSense yayıncı numarası', $('.modal')) && txt().includes('pub-1234567890123456'));
await setVal(input('AdSense yayıncı numarası', $('.modal')), 'abc'); await click(btn('Kaydet', $('.modal')), 600);
ok('a wrong form is refused and nothing is saved', !!$('.modal') && (await q1('SELECT adsense_pub_id FROM wp_sites')).adsense_pub_id === null);
await setVal(input('AdSense yayıncı numarası', $('.modal')), 'ca-pub-1234567890123456'); await click(btn('Kaydet', $('.modal')), 900);
ok('the number is saved as pub-… (ca- dropped)', (await q1('SELECT adsense_pub_id FROM wp_sites')).adsense_pub_id === 'pub-1234567890123456');
await click(nav('Bot Yönetimi'), 700);
ok('the AdSense bot is scheduled weekly and says what it does', txt().includes('AdSense Compliance Bot') && txt().includes('haftada bir WordPress sitelerinin AdSense hazırlığını') && txt().includes('Otomatik: 7 günde bir'));

// ── PHASE 7a: Telegram ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TGF = globalThis.__tg;
await click(nav('Bildirimler'), 800);
ok('without a bot the Telegram card explains how to start (BotFather, the id the bot tells)', txt().includes('Telegram bağlı değil') && txt().includes('@BotFather') && txt().includes('/start'));
await click(nav('API Kullanımı ve Maliyetler'), 600);
const tgCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Telegram');
ok('the provider card explains where the token and the chat id come from', !!tgCard && tgCard.textContent.includes('@BotFather') && tgCard.textContent.includes('Yetkili sohbet kimlikleri'));
await setVal(input('Bot token', tgCard), globalThis.__tgToken); await setVal(input('Yetkili sohbet kimlikleri', tgCard), '1001, 1002'); await click(btn('Kaydet', tgCard), 700);
await click(btn('Bağlantıyı test et', tgCard), 800);
ok('the token is saved (only its end shown), the test says which bot answered and how many chats are authorized, the token is nowhere on the page', txt().includes('@modulpos_test_bot') && txt().includes('2 yetkili sohbet') && !document.body.innerHTML.includes(globalThis.__tgToken));
await click(nav('Bildirimler'), 800);
ok('the Telegram card now shows the bot, the chats, and that commands are off until the webhook is set', txt().includes('@modulpos_test_bot') && txt().includes('2 yetkili sohbet') && txt().includes('webhook kurulu değil: komutlar çalışmaz'));
ok('the card diagnoses the silent bot at once: the token is right, and the webhook is NOT set (the reason a bot does not answer /start)', txt().includes('Belirteç doğru: bot @modulpos_test_bot') && txt().includes('Webhook KURULU DEĞİL') && txt().includes('bot hiç tepki vermiyor') && txt().includes('Ne yapmalı'));
globalThis.__tg.st.updates = [{ update_id: 71, message: { message_id: 1, date: 1700000000, chat: { id: 5551234, type: 'private', first_name: 'Özgür' }, from: { id: 5551234, is_bot: false }, text: '/start' } }];
await click(btn('Bota yazan sohbetleri bul'), 800);
ok('"find the chats that wrote to the bot" lists the owner\'s chat with its id and a one-click authorization', txt().includes('Bota yazan sohbetler') && txt().includes('Özgür') && txt().includes('kimlik 5551234') && !!btn('Yetkili yap'));
await click(btn('Yetkili yap'), 900);
ok('the chat is authorized by one click (it is in the saved list now, the diagnosis shows three chats)', (await q1("SELECT extra FROM api_providers WHERE key = 'telegram'")).extra.chatIds.split(',').includes('5551234') && txt().includes('3 yetkili sohbet'));
await click(btn('Test mesajı gönder'), 700);
ok('the test message reached every authorized chat', TGF.sent().filter((m) => m.text.includes('test mesajı')).length === 3);
await click(btn('Webhook’u kur'), 700);
ok('setting the webhook without an https address is refused in words (the test API is plain http)', txt().includes('https') && !(await q1("SELECT value FROM telegram_state WHERE key = 'webhook'")));
await setVal(input('API’nin herkese açık adresi'), 'https://api.example.com'); await click(btn('Webhook’u kur'), 800);
const hook = await q1("SELECT value FROM telegram_state WHERE key = 'webhook'");
ok('with an https address Telegram was given the webhook and the secret; the card says it is set', !!hook && hook.value.url === 'https://api.example.com/api/content/telegram/webhook' && TGF.st.webhook.secret === globalThis.__srv.telegram.webhookSecret(globalThis.__tgToken) && txt().includes('webhook kurulu') && !txt().includes('webhook kurulu değil'));
ok('with the webhook set the diagnosis passes on what Telegram last complained about, in words (the fake says a 503: the API did not answer)', txt().includes('Webhook kurulu: https://api.example.com/api/content/telegram/webhook') && txt().includes('Telegram son denemede şu hatayı aldı') && txt().includes('API o sırada yanıt vermedi'));
await click(btn('Telegram’ın gördüğü durum'), 700);
ok('Telegram\'s own view (pending updates, its last error) is shown', txt().includes('Bekleyen güncelleme: 2') && txt().includes('503 Service Unavailable'));
// an owner command through the webhook, and a stranger
const sentBefore = TGF.sent().length;
await globalThis.__srv.telegram.handleUpdate(globalThis.__tgUpdate(91, 1001, '/status')); await globalThis.__srv.telegram.handleUpdate(globalThis.__tgUpdate(92, 5555, '/status'));
ok('the owner\'s /status is answered from the real data; the stranger gets nothing', TGF.sent().length === sentBefore + 1 && /Makaleler:/.test(TGF.sent().pop().text));
// a notification is forwarded, and the switches decide
await globalThis.__srv.notifications.create({ type: 'publish_failed', severity: 'warning', title: 'E2E yayın hatası', body: 'detay' }); await globalThis.__srv.notifications.flush();
ok('a WordPress failure reaches both chats and the card shows the last delivery', TGF.sent().filter((m) => m.text.includes('E2E yayın hatası')).length === 3);
await click(nav('API Kullanımı ve Maliyetler'), 400); await click(nav('Bildirimler'), 800);
ok('the card shows the last delivery', txt().includes('Son gönderim') && txt().includes('3 sohbete gitti'));
const sw = $$('label.check').find((l) => l.textContent.includes('WordPress yayın hatası')); await click($('input', sw), 700);
ok('a switch is saved on the server', (await q1("SELECT value FROM automation_settings WHERE key = 'telegram' AND scope = 'global'")).value.notify.publishError === false);
await globalThis.__srv.notifications.create({ type: 'publish_failed', severity: 'warning', title: 'E2E ikinci hata' }); await globalThis.__srv.notifications.flush();
ok('and a switched-off kind no longer goes to Telegram (it stays in the panel)', !TGF.sent().some((m) => m.text.includes('E2E ikinci hata')) && txt().includes('Bildirimler'));
await click(btn('Webhook’u kaldır'), 700);
ok('removing the webhook tells Telegram and the card says commands are off again', TGF.st.webhook === null && txt().includes('webhook kurulu değil'));

// ── PHASE 7b: reports, all sites side by side, cost analysis ──────────────────────────────────────────────────────────────────────────
await click(nav('Raporlar'), 800);
ok('without a report the page explains when they are made and offers to make one now', txt().includes('Henüz günlük rapor yok') && txt().includes('ölçülür ve saklanır') && !!btn('Günlük raporu şimdi hazırla'));
await click(btn('Günlük raporu şimdi hazırla'), 1500);
ok('the daily report is made from the real data of yesterday and stored', (await q1("SELECT count(*)::int n FROM reports WHERE kind = 'daily'")).n === 1 && txt().includes('Makaleler') && txt().includes('Güncellemeler') && txt().includes('Görevler') && txt().includes('Araştırma') && txt().includes('Maliyet'));
ok('sections without data say so instead of showing zeros: Search Console and the audit state what exists', txt().includes('SEO performansı') && txt().includes('AdSense site denetimi') && txt().includes('hazırlandığı anda ölçülmüş'));
await click(btn('Düz metin'), 400);
ok('the plain text (what Telegram gets) is available and has no placeholder leaks', txt().includes('📅 Günlük rapor') && !/NaN|undefined/.test(txt()));
await click(tab('Haftalık'), 500); await click(btn('Haftalık raporu şimdi hazırla'), 1500);
ok('the weekly report covers 7 days and is listed under its own tab', (await q1("SELECT count(*)::int n FROM reports WHERE kind = 'weekly'")).n === 1 && txt().includes('Haftalık'));
// all sites
await click(nav('SEO Performansı'), 800); await click(tab('Tüm siteler'), 1000);
ok('all sites: the project, its sites with Search Console numbers or "veri yok", the cost per article and the honest notes', txt().includes('Tüm siteler') && txt().includes('E2E Blog') && txt().includes('140 → 140') && txt().includes('en çok:') && txt().includes('makale başına: Bilinmiyor') && txt().includes('0 tıklama değil'));
// cost analysis
await click(nav('API Kullanımı ve Maliyetler'), 900);
ok('the cost analysis shows totals, the per-article cost as "Bilinmiyor" until priced runs exist, and its caveats', txt().includes('Maliyet analizi ve öneriler') && txt().includes('Makale başına (yazım + kontroller)') && txt().includes('Ay sonu tahmini') && txt().includes('Karşılaştır'));
ok('every suggestion shown says what it cannot know', $$('.alert').filter((a) => a.textContent.includes('Ne yapılabilir') || a.textContent.includes('Bilemediğimiz')).every((a) => a.textContent.includes('Bilemediğimiz')));

// ── PHASE 7c: the blind writer comparison ────────────────────────────────────────────────────────────────────────────────────────────
const lastModal = () => $$('.modal').at(-1);
await S.db.query("UPDATE daily_work_limits SET max_per_day = 10 WHERE work_type = 'new_article' AND scope = 'global'");      // (an earlier scenario of this run set the day's limit to 1)
await S.db.query('UPDATE niche_profiles SET daily_article_limit = 20'); await S.db.query('UPDATE categories SET daily_max = NULL');
await S.db.query("UPDATE content_opportunities SET status = 'new', article_id = NULL WHERE status = 'written'");          // the earlier scenario wrote this idea: make it free again for the comparison
await click(nav('AI Makale Üretimi'), 800); await click(tab('Karşılaştır (kör test)'), 600);
ok('with only one vendor ready the comparison explains that two are needed', txt().includes('En az 2 hazır sağlayıcı gerekir') && !btn('Kör karşılaştırmayı başlat'));
await S.providers.save('openai', { secret: 'sk-openai-e2e-key-0123456789abcdef', extra: { model: 'gpt-test' } });
await click(nav('Makale Arşivi'), 500); await click(nav('AI Makale Üretimi'), 800); await click(tab('Karşılaştır (kör test)'), 800);
ok('with two vendors the form offers the idea, both vendors (a vendor without prices says its cost will be unknown) and the start button', !!aria('Karşılaştırılacak fikir') && txt().includes('fiyat girilmemiş: maliyeti bilinmez') && !!btn('Kör karşılaştırmayı başlat') && txt().includes('hangisini kimin yazdığını bilmeden'));
await click(btn('Kör karşılaştırmayı başlat'), 500);
ok('starting asks first: it costs one article per vendor and takes ONE place of the day', txt().includes('2 sağlayıcıya yazdırılsın mı?') && txt().includes('TEK yer alınır'));
await click(btn('Başlat', lastModal()), 900);
const cmpId = (await q1('SELECT id FROM writer_comparisons ORDER BY created_at DESC LIMIT 1')).id; await globalThis.__srv.comparisons.wait(cmpId); await wait(3600);
ok('the drafts are ready and read blind: letters, the free numbers side by side, no vendor/model/cost anywhere', !!lastModal() && txt().includes('Kör okuma') && txt().includes('Taslak A') && txt().includes('Taslak B') && txt().includes('Ölçüm (modelsiz, ücretsiz)') && !txt().includes('Kim yazmış?') && !/claude-sonnet|gpt-test|\$\d/.test(lastModal().textContent));
ok('the drafts are not articles yet', (await q1("SELECT count(*)::int n FROM articles WHERE generation->>'comparisonId' IS NOT NULL")).n === 0 && (await q1("SELECT status FROM content_opportunities WHERE status = 'queued' LIMIT 1")) !== undefined);
await click(tab('Taslak B'), 400);
ok('the text of a draft can be read (title, meta, the article)', !!$('.prose', lastModal()) && $('.prose', lastModal()).textContent.length > 200);
await click($$('button', lastModal()).find((b) => b.textContent.includes('bunu seç')), 500);
ok('picking asks first and says that the checks will run and nothing is published', txt().includes('makale yapılsın mı?') && txt().includes('kendiliğinden yayımlanmaz'));
await click(btn('Bunu seç', lastModal()), 1200); await globalThis.__srv.comparisons.wait(`pick:${cmpId}`); await wait(800);
const picked = await q1("SELECT status, picked_label, picked_article_id FROM writer_comparisons WHERE id = $1", [cmpId]);
ok('the picked draft is now an article with its mandatory checks, and ONLY that one', picked.status === 'picked' && picked.picked_label === 'B' && (await q1("SELECT count(*)::int n FROM articles WHERE generation->>'comparisonId' = $1", [cmpId])).n === 1 && (await q1('SELECT status FROM articles WHERE id = $1', [picked.picked_article_id])).status === 'needs_review');
ok('after the decision the vendors are shown: provider, model, cost (unknown where no price), tokens, time; a link to the article', txt().includes('Kim yazmış?') && txt().includes('anthropic') && txt().includes('openai') && txt().includes('gpt-test') && txt().includes('Bilinmiyor') && txt().includes('seçildi') && !!btn('Seçilen makaleyi aç'));
await click(btn('Kapat', lastModal()), 300);
ok('the list shows the decision and the tally says it is only the owner\'s preference, with no trend yet', txt().includes('Seçildi') && txt().includes('Seçimleriniz (1 karar)') && txt().includes('En az 3 karardan sonra') && !txt().includes('şimdilik önde'));
// a second comparison, discarded: nothing becomes an article and the place comes back
await S.db.query("UPDATE content_opportunities SET status = 'new', article_id = NULL WHERE status = 'written'"); const placesBefore = (await q1("SELECT coalesce(sum(used), 0)::int n FROM daily_work_usage WHERE work_type = 'new_article' AND scope = 'global'")).n;
await click(nav('Makale Arşivi'), 500); await click(nav('AI Makale Üretimi'), 800); await click(tab('Karşılaştır (kör test)'), 800); await click(btn('Kör karşılaştırmayı başlat'), 500); await click(btn('Başlat', lastModal()), 900);
const cmp2 = (await q1("SELECT id FROM writer_comparisons WHERE status <> 'picked' ORDER BY created_at DESC LIMIT 1")).id; await globalThis.__srv.comparisons.wait(cmp2); await wait(3600);
await click(btn('Hiçbirini seçme', lastModal()), 500); await click(btn('Hiçbirini seçme', lastModal()), 900);
ok('discarding: no article, the idea is free again, the day\'s place is given back, the vendors are shown', (await q1('SELECT status FROM writer_comparisons WHERE id = $1', [cmp2])).status === 'discarded' && (await q1("SELECT count(*)::int n FROM articles WHERE generation->>'comparisonId' IS NOT NULL")).n === 1 && (await q1("SELECT coalesce(sum(used), 0)::int n FROM daily_work_usage WHERE work_type = 'new_article' AND scope = 'global'")).n === placesBefore && txt().includes('Kim yazmış?'));

// ── the owner's Gemini key: "the key is saved but not accepted" = no model chosen; the card now lists the models and picks one ────────────────
await click(nav('API Kullanımı ve Maliyetler'), 800);
const gCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Google (Gemini)');
await setVal(input('API anahtarı', gCard), 'AQ.Ab8RN6Kexample_key-with.dots0123456789'); await click(btn('Kaydet', gCard), 800);
ok('a Gemini key with dots is accepted, and the card says plainly that a model is still missing (that is why it was "not usable")', txt().includes('Anahtar kayıtlı ama model seçilmedi') && (await q1("SELECT secret_last4 FROM api_providers WHERE key = 'gemini'")).secret_last4 === '6789');
await click(btn('Bağlantıyı test et', gCard), 900);
ok('the connection test lists the models this key can write with (not the embedding one) and suggests a stable flash model', txt().includes('Bu anahtarla kullanabilen modeller'.replace('kullanabilen', 'kullanılabilen')) && txt().includes('Öneri: gemini-2.5-flash') && txt().includes('Gemini 2.5 Pro') && !txt().includes('embedding'));
await click(btn('Bunu kullan'), 900);
ok('one click saves the model; the vendor is ready for the writer', (await q1("SELECT extra FROM api_providers WHERE key = 'gemini'")).extra.model === 'gemini-2.5-flash' && !txt().includes('Anahtar kayıtlı ama model seçilmedi') && txt().includes('Seçili model: gemini-2.5-flash') && !txt().includes('bir MODEL seçmeniz gerekir'));
await S.providers.save('gemini', { clearSecret: true });
ok('there is no DataForSEO card and no login field any more (the Apify card only says honestly that its default actor resells that data)', !$$('section.card h2').some((h) => /DataForSEO/.test(h.textContent)) && !input('API oturum e-postası') && !btn('Öneri getir (DataForSEO)'));

// ── Otomasyon Modu: three modes + checkboxes over the settings that already exist ─────────────────────────────────────────────
const autoSched = async (bot) => { const r = await q1('SELECT enabled FROM schedule_settings WHERE bot_key = $1', [bot]); return { enabled: r ? r.enabled : false }; };   // no row = the bot's default, which for the paid ones is off
const boxFor = (label) => $$('label.check').find((l) => l.textContent.includes(label));
await click(nav('Otomasyon Modu'), 900);
ok('the page shows the current mode, three mode cards, the 16 options in 4 groups, the values and the checklist', txt().includes('Şu anki mod:') && ['Elle', 'Yarı otomatik', 'Tam otomatik'].every((m) => !!btn(`${m} modunu uygula`) || txt().includes(m)) && $$('label.check').length >= 16 + 1 && ['Araştırma', 'Yazım ve onay', 'Yayın', 'Bakım, izleme ve raporlar'].every((g) => txt().includes(g)) && txt().includes('Günlük yeni makale') && txt().includes('Başlamadan önce kontrol listesi'));
const liveRows = () => $$('table[aria-label="Botların anlık durumu"] tbody tr');
ok('the "Anlık durum" card lists all 13 bots with a state each, the day\'s numbers and the honest note that no scheduler runs on this test server', !!$$('section.card h2').find((h) => h.textContent === 'Anlık durum') && liveRows().length === 13 && liveRows().every((r) => /Çalışıyor|Sırada|Yeniden denenecek|Bekliyor|Duraklatıldı|Hatalar nedeniyle durdu|Kapalı/.test(r.textContent)) && txt().includes('Bugün yazılan') && txt().includes('Zamanlayıcı bu sunucuda çalışmıyor') && txt().includes('● canlı'));
const pid0 = (await q1('SELECT id FROM content_projects ORDER BY created_at LIMIT 1')).id;
await S.db.query("INSERT INTO jobs (bot_key, project_id, payload, trigger, dedupe_key, status, started_at, locked_by, locked_until, attempts) VALUES ('news_discovery', $1, '{}', 'schedule', 'e2e-live-1', 'running', now() - interval '42 seconds', 'e2e', now() + interval '10 minutes', 1)", [pid0]);
await S.db.query("INSERT INTO jobs (bot_key, project_id, payload, trigger, dedupe_key, status, started_at, finished_at, last_error, attempts, max_attempts) VALUES ('seo_performance', $1, '{}', 'schedule', 'e2e-live-2', 'failed', now() - interval '20 seconds', now() - interval '10 seconds', 'Search Console anahtarı reddedildi', 1, 1)", [pid0]);
await click(aria('Anlık durumu yenile'), 700);
const newsRow = liveRows().find((r) => r.textContent.includes('Haber tarama'));
ok('a job a worker is running shows as "Çalışıyor" with what it is doing and for how long, and the running bot is listed first', !!newsRow && newsRow.textContent.includes('Çalışıyor') && newsRow.textContent.includes('Haber kaynakları taranıyor') && /4[0-9] sn süredir/.test(newsRow.textContent) && liveRows()[0] === newsRow);
ok('a failed job shows its reason in the bot\'s last result and in the feed of the last events', liveRows().find((r) => r.textContent.includes('Search Console verisi')).textContent.includes('Search Console anahtarı reddedildi') && $$('table[aria-label="Son olaylar"] tr').some((r) => r.textContent.includes('Hata') && r.textContent.includes('Search Console anahtarı reddedildi')));
await S.db.query("DELETE FROM jobs WHERE dedupe_key LIKE 'e2e-live-%'");
await click(aria('Anlık durumu yenile'), 700);
ok('after the job is gone the bot is no longer "running" (the picture follows the queue, it keeps nothing of its own)', !liveRows().find((r) => r.textContent.includes('Haber tarama')).textContent.includes('Haber kaynakları taranıyor'));
await click(btn('Elle modunu uygula'), 1000);
ok('"Elle" switches every bot off through the real bot schedules (Bot Yönetimi shows the same) and the page says so', txt().includes('Şu anki mod: Elle') && (await autoSched('news_discovery')).enabled === false && (await q1("SELECT count(*)::int n FROM schedule_settings WHERE enabled")).n === 0 && txt().includes('Haber taraması: kapatıldı'));
await click(boxFor('Haber taraması').querySelector('input'), 150);
ok('ticking a box only changes the form until "Seçimi uygula" is pressed', (await autoSched('news_discovery')).enabled === false);
await click(btn('Seçimi uygula'), 1000);
ok('"Seçimi uygula" turns exactly that bot on; the mode reads "Özel"; the same switch is on in the database', (await autoSched('news_discovery')).enabled === true && txt().includes('Şu anki mod: Özel') && txt().includes('Haber taraması: açıldı'));
await click(boxFor('Taslak yerine doğrudan yayımla').querySelector('input'), 150);
ok('ticking "publish live" also ticks "send to WordPress" (it cannot exist without it)', boxFor('Hazır makaleleri WordPress’e gönder').querySelector('input').checked === true);
await click(boxFor('Hazır makaleleri WordPress’e gönder').querySelector('input'), 150);
ok('un-ticking "send to WordPress" un-ticks "publish live" with it', boxFor('Taslak yerine doğrudan yayımla').querySelector('input').checked === false);
ok('"Tam otomatik" is not offered while no WordPress site has passed its connection test, and the card says which one is missing', !!$$('.card').find((c) => c.textContent.includes('Tam otomatik') && c.textContent.includes('Bu mod için eksikler var') && c.textContent.includes('Bağlantı testi geçmiş')) && btn('Tam otomatik modunu uygula').disabled === true);
await click(nav('Web Sitelerim'), 700); await click(btn('Bağlantıyı test et'), 1200); await click(nav('Otomasyon Modu'), 900);
ok('after the real connection test the mode becomes available', (await q1('SELECT last_test_ok FROM wp_sites')).last_test_ok === true && btn('Tam otomatik modunu uygula').disabled === false);
await click(btn('Tam otomatik modunu uygula'), 700);
ok('"Tam otomatik" first asks, in words, because articles would go public without a person (and applies nothing yet)', !!$('.modal') && txt().includes('SİZ BAKMADAN') && (await autoSched('article_writer')).enabled !== true);
await click(btn('Vazgeç', $('.modal')), 500);
ok('declining changes nothing', (await autoSched('article_writer')).enabled !== true && !txt().includes('Şu anki mod: Tam otomatik'));
await click(btn('Tam otomatik modunu uygula'), 700); await click(btn('Evet, devam et', $('.modal')), 1500);
const qs2 = await q1("SELECT value FROM automation_settings WHERE key = 'quality'"); const ps2 = await q1("SELECT value FROM automation_settings WHERE key = 'publishing'");
ok('after the yes: automatic approval and live publishing are on, the writer and the WordPress bot run on schedule, and the page reads "Tam otomatik"', txt().includes('Şu anki mod: Tam otomatik') && qs2.value.manualApprovalNewArticles === false && ps2.value.mode === 'publish' && ps2.value.autoPublish === true && (await autoSched('article_writer')).enabled === true && (await autoSched('content_publishing')).enabled === true);
await click(nav('Bot Yönetimi'), 800);
ok('Bot Yönetimi shows the very same switches (the page has no state of its own)', txt().includes('Otomatik: 3 saatte bir') || txt().includes('3 saatte bir'));
await click(nav('Otomasyon Modu'), 800); await click(btn('Elle modunu uygula'), 1000);
ok('and "Elle" takes everything back: manual approval again, WordPress as draft, no bot scheduled', txt().includes('Şu anki mod: Elle') && (await q1("SELECT value FROM automation_settings WHERE key = 'quality'")).value.manualApprovalNewArticles === true && (await q1("SELECT value FROM automation_settings WHERE key = 'publishing'")).value.mode === 'draft' && (await q1("SELECT count(*)::int n FROM schedule_settings WHERE enabled")).n === 0);

// ── cover pictures: settings, the model picker, the editor card, the alt text, the paid button, removal ────────────────────────────────────────
if (!URL.createObjectURL) { URL.createObjectURL = () => 'blob:e2e-picture'; URL.revokeObjectURL = () => {}; }
await click(nav('Sistem Ayarları'), 600);
ok('the settings page has the "Kapak görselleri" card with its switches (off by default: pictures cost money)', !!$$('section.card h2').find((h) => h.textContent === 'Kapak görselleri') && txt().includes('Yeni makaleye kapak görseli ekle') && txt().includes('Görsel kalitesi') && txt().includes('Görselsiz makale kendiliğinden'));
await click(nav('API Kullanımı ve Maliyetler'), 700);
const oaCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'OpenAI');
ok('the OpenAI card has the image model and the price per picture fields', !!input('Görsel modeli', oaCard) && !!input('Görsel başına fiyat', oaCard));
await click(btn('Bağlantıyı test et', oaCard), 900);
ok('the connection test lists the image models the key offers and names the one that is used when none is chosen', txt().includes('Kapak görseli için kullanılabilen modeller') && txt().includes('gpt-image-2.5-sunburst') && txt().includes('sabit sürüm'));
await click($$('button', oaCard).find((b) => b.textContent.trim() === 'Bunu sabitle'), 900);
ok('one click pins the image model', (await q1("SELECT extra FROM api_providers WHERE key = 'openai'")).extra.imageModel === 'gpt-image-2.5-sunburst');
await click(nav('Makale Arşivi'), 700); await click($$('tbody tr').find((r) => r.querySelector('strong.clip')), 900);                      // a row of the archive opens its article
ok('an article without a picture says so and offers to draw one (admin)', txt().includes('Kapak görseli') && txt().includes('Bu makalenin kapak görseli yok') && !!btn('Görsel çiz'));
await setVal($('textarea[placeholder^="ör. Karanlık"]'), 'A glowing price tag floating over an open laptop'); await click(btn('Görsel çiz'), 1200);
const pic = await q1('SELECT alt, model, provider, byte_size, prompt FROM article_images'); const artRow = await q1('SELECT h1 FROM articles WHERE id = (SELECT article_id FROM article_images)');
ok('drawing stores the picture (the request had the scene, no text/logo rules, the pinned model) and the card shows it with its alt text and where it came from', !!pic && pic.provider === 'openai' && pic.model === 'gpt-image-2.5-sunburst' && pic.byte_size > 100 && pic.prompt.startsWith('A glowing price tag floating over an open laptop') && pic.prompt.includes('Absolutely no text') && pic.alt === artRow.h1 && !!$('img[alt]') && txt().includes('gpt-image-2.5-sunburst') && !!input('Alt metin') && globalThis.__models.calls.some((c) => c.role === 'image' && c.body.size === '1536x1024' && c.body.output_format === 'jpeg'));
await setVal(input('Alt metin'), 'A glowing price tag above an open laptop'); await click(btn('Alt metni kaydet'), 700);
ok('the alt text is saved', (await q1('SELECT alt FROM article_images')).alt === 'A glowing price tag above an open laptop');
await click(btn('Yeni görsel çiz'), 500); ok('a second picture asks first (it replaces the first and costs again)', !!$('.modal') && txt().includes('DEĞİŞTİRİLİR')); await click(btn('Vazgeç', $('.modal')), 400);
ok('declining draws nothing', (await q1('SELECT count(*)::int n FROM article_images')).n === 1 && globalThis.__models.calls.filter((c) => c.role === 'image').length === 1);
await click($$('button').find((b) => b.textContent.trim() === 'Sil' && b.className.includes('danger')), 500); await click(btn('Sil', $('.modal')), 800);
ok('removing the picture deletes it', (await q1('SELECT count(*)::int n FROM article_images')).n === 0 && txt().includes('Bu makalenin kapak görseli yok'));

// ── FREE cover photos (Pixabay): the key card, the settings, the search on the editor card, a person's choice, the filter flag, the credit ────────────────────────
await click(nav('Sistem Ayarları'), 600);
ok('the cover settings now choose the source (automatic / only free / only OpenAI) and the free image type', txt().includes('Görsel kaynağı') && txt().includes('Ücretsiz görsel türü') && txt().includes('Yalnızca ücretsiz fotoğraf (Pixabay)'));
await click(nav('API Kullanımı ve Maliyetler'), 700);
const pxCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Pixabay (ücretsiz fotoğraflar)');
ok('the Pixabay card says it is free and where the key is', !!pxCard && pxCard.textContent.includes('ücretsiz hesap') && pxCard.textContent.includes('pixabay.com/api/docs') && !pxCard.textContent.includes('ücretli'));
await setVal(input('API anahtarı', pxCard), '12345678-abcdef0123456789abcdef012'); await click(btn('Kaydet', pxCard), 700); await click(btn('Bağlantıyı test et', pxCard), 900);
ok('the key is saved (encrypted) and the test is one free search', (await q1("SELECT encrypted_secret FROM api_providers WHERE key = 'pixabay'")).encrypted_secret.startsWith('enc:v1:') && txt().includes('Pixabay bağlantısı çalışıyor') && globalThis.__pixabay.length === 1);
await click(nav('Makale Arşivi'), 700); await click($$('tbody tr').find((r) => r.querySelector('strong.clip')), 900);
ok('the editor card offers the free photo search with the focus keyword already in the box', txt().includes('Ücretsiz fotoğraf bul (Pixabay)') && !!$$('button').find((b) => b.textContent.trim() === 'Ara') && !!$('input[aria-label="Fotoğraf arama sözcüğü"]') && $('input[aria-label="Fotoğraf arama sözcüğü"]').value.length > 2);
await setVal($('input[aria-label="Fotoğraf arama sözcüğü"]'), 'laptop on desk'); await click($$('button').find((b) => b.textContent.trim() === 'Ara'), 900);
ok('the search shows thumbnails, flags the one that names a person, and saves nothing yet', $$('.stock-pick').length === 3 && $$('.stock-pick').filter((b) => b.textContent.includes('dikkat')).length === 1 && globalThis.__pixabay.at(-1).q === 'laptop on desk' && globalThis.__pixabay.at(-1).type === 'photo' && (await q1('SELECT count(*)::int n FROM article_images')).n === 0 && txt().includes('Pixabay’dan gelir ve ücretsizdir'));
await click($$('.stock-pick')[0], 1300);
const sp = await q1('SELECT provider, source_id, credit_name, credit_url, alt, prompt, cost_micros, byte_size FROM article_images');
ok('choosing a photo downloads it to our own storage with its credit, at no cost, and makes it the cover', !!sp && sp.provider === 'pixabay' && sp.source_id === '201' && sp.credit_name === 'Jane Doe' && sp.credit_url.includes('/users/') && sp.alt === 'Photo of laptop, desk, technology' && sp.prompt === 'laptop on desk' && Number(sp.cost_micros) === 0 && sp.byte_size > 100 && globalThis.__pixabay.at(-1).id === '201');
ok('the card shows the photo with its credit and says it is free (no price, no drawing prompt)', txt().includes('Ücretsiz fotoğraf') && txt().includes('Jane Doe') && txt().includes('kaynak göstermeyi şart koşmaz') && txt().includes('Aranan kelime') && !txt().includes('Çizilen tarif'));
await click($$('button').find((b) => b.textContent.trim() === 'Sil' && b.className.includes('danger')), 500); await click(btn('Sil', $('.modal')), 800);
ok('removing it works for a free photo too', (await q1('SELECT count(*)::int n FROM article_images')).n === 0);
await click(nav('Otomasyon Modu'), 800);
const imgBox = $$('label.check').find((l) => l.textContent.includes('Makaleye kapak görseli ekle'));
ok('Otomasyon Modu: with a Pixabay key the cover option is free (no "ücretli" badge) and ready', !!imgBox && !imgBox.textContent.includes('ücretli') && !imgBox.querySelector('input').disabled);

// ── logout ─────────────────────────────────────────────────────────────────────────────────────────
await click(aria('Çıkış'), 600);
ok('logout returns to the login form and ends the session', txt().includes('Giriş yap') && !nav('Makale Arşivi'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors or warnings', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
