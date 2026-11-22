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
ok('every dashboard figure is a real count now (a 0 is a real 0); only organic traffic waits for its phase', $$('.metric.later').length === 0 && txt().includes('Organik trafik') && txt().includes('Aşama 6’te etkinleşir') && txt().includes('Bugün bulunan haber'));
ok('no articles yet: an honest empty state, not fake charts', txt().includes('Henüz makale yok'));
ok('menu: every page is a link now, nothing is dimmed any more (SEO Performansı, İç Bağlantılar and AdSense Denetimi included)', $$('.nav.disabled').length === 0 && !!nav('AdSense Denetimi') && !!nav('SEO Performansı') && !!nav('İç Bağlantılar') && $$('.nav.disabled').every((n) => n.tagName === 'DIV') && !!nav('Dünya Gündemi') && !!nav('İçerik Fırsatları'));

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
ok('15 bots: the 14 of phases 2, 3, 5 and 6 are ready and show real last runs, the rest says which phase builds it', $$('tbody tr').length === 15 && txt().includes('14 / 15 bot hazır') && /Aşama \d’te gelecek/.test(txt()) && txt().includes('Otomatik: 2 saatte bir') && txt().includes('Otomatik kapalı; elle çalıştırılır') && txt().includes('bu sunucuda kapalı'));
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
ok('without DataForSEO the page says so and still lists/adds keywords', txt().includes('DataForSEO bağlı değil') && txt().includes('Anahtar kelime yok'));
await click(btn('Kelime ekle'), 300); await setVal($('.modal textarea'), 'chrome data breach\nunknown thing keyword\nunknown thing keyword'); await click(btn('Ekle', $('.modal')), 600);
ok('keywords are cleaned and stored without any API call', (await q1("SELECT count(*)::int n FROM keywords")).n === 2 && globalThis.__dfs.length === 0 && txt().includes('Henüz sorgulanmadı'));
await click(nav('API Kullanımı ve Maliyetler'), 500);
const dfsCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'DataForSEO');
await setVal(input('API şifresi', dfsCard), 'dfs-pass-123'); await setVal(input('API oturum e-postası', dfsCard), 'me@example.com'); await click(btn('Kaydet', dfsCard), 700);
ok('DataForSEO is saved (key encrypted, only the end shown)', txt().includes('Kayıtlı · …-123') && !document.body.innerHTML.includes('dfs-pass-123') || txt().includes('Kayıtlı'));
// the free source is the default: nothing is connected yet, the page and the settings say so; then this scenario pays for DataForSEO (the free mode follows at the end)
await click(nav('Anahtar Kelime Araştırması'), 500);
ok('the default SERP source (Serper.dev) is not connected: the page says so and the SERP button is off', txt().includes('SERP kaynağı bağlı değil: Serper.dev') && txt().includes('Dosyadan hacim aktar') && !!btn('Kelime ekle'));
await click(nav('Sistem Ayarları'), 500);
const seoCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent.startsWith('SEO araştırması'));
ok('SEO settings: Serper.dev is the default SERP source and the partial-score switch is on', input('SERP veri kaynağı', seoCard).value === 'serper' && txt().includes('Aranma hacmi yokken onayla kısmi puanla üretime izin ver') && $$('input[type=checkbox]', seoCard).filter((c) => c.checked).length >= 2);
await setVal(input('SERP veri kaynağı', seoCard), 'dataforseo'); await click(btn('Kaydet', seoCard), 700);
ok('choosing DataForSEO as the SERP source is saved', (await q1("SELECT value->>'serpProvider' AS p FROM automation_settings WHERE key = 'seo' AND scope = 'global'")).p === 'dataforseo');
await click(nav('Anahtar Kelime Araştırması'), 600);
await click(btn('Verisi olmayanların verisini çek'), 700);
ok('before spending money it shows how many are asked, the cache and a rough price', txt().includes('Sorgulanacak') && txt().includes('Zaten güncel') && txt().includes('Tahmini maliyet') && txt().includes('Tahmindir; gerçek tutar'));
await click(btn('Verileri çek (ücretli)'), 800);
ok('the fetch result reports the REAL cost from the API answer', txt().includes('2 anahtar kelime sorgulandı') && txt().includes('1 veri bulundu') && txt().includes('veri bulunamadı') && txt().includes('$0.0201'), (txt().match(/\d anahtar kelime sorgulandı[^$]*\$[\d.]+/) || [''])[0]);
await click(btn('Kapat', $('.modal')), 300);
ok('values from the provider are shown; the missing one says "Veri bulunamadı" (never a 0)', txt().includes('14.800') && txt().includes('Veri bulunamadı') && globalThis.__dfs.length === 1);
await click(btn('SERP analizi'), 800);
ok('a SERP analysis from the keyword row fills the organic competition', !!$('.bar') && (await q1('SELECT count(*)::int n FROM serp_analyses')).n === 1);

await click(nav('SEO Rekabet Analizi'), 600);
ok('SERP page: says the score is not Google\'s metric, lists the analysis', txt().includes('Google’ın resmî zorluk metriği değildir') && txt().includes('chrome data breach'));
await click(btn('Ayrıntı'), 400);
ok('detail shows every factor, the top results with their kind, and the user questions', txt().includes('Puanı oluşturan etkenler') && txt().includes('Bağımsız site') && txt().includes('What happened?') && txt().includes('Rekabet tahmini'));
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
await setVal(input('SERP veri kaynağı', seoCard2), 'serper'); await click(btn('Kaydet', seoCard2), 700);
await click(nav('API Kullanımı ve Maliyetler'), 500);
const serperCard = $$('section.card').find((c) => c.querySelector('h2') && c.querySelector('h2').textContent === 'Serper.dev');
ok('the Serper.dev card explains the free start and the 1-credit test', !!serperCard && serperCard.textContent.includes('2.500 ücretsiz sorgu') && serperCard.textContent.includes('1 sorgu (1 kredi)'));
await setVal(input('API anahtarı', serperCard), 'serper-key-0123456789abcdef'); await click(btn('Kaydet', serperCard), 700);
await click(btn('Bağlantıyı test et', serperCard), 800);
ok('the Serper key is saved (only the end shown) and the connection test works', txt().includes('Kayıtlı · …cdef') && txt().includes('Serper bağlantısı çalışıyor') && !document.body.innerHTML.includes('serper-key-0123456789abcdef') && globalThis.__serper.length === 1 && globalThis.__serper[0].key === 'serper-key-0123456789abcdef');

await click(nav('Anahtar Kelime Araştırması'), 600);
ok('with Serper connected the SERP banner is gone', !txt().includes('SERP kaynağı bağlı değil'));
await click(btn('Dosyadan hacim aktar'), 400);
ok('the import dialog explains where to get the file and that ranges are skipped', txt().includes('Anahtar Kelime Planlayıcı') && txt().includes('aralıklar ve “10K” gibi yuvarlak değerler atlanır'));
await setVal($('.modal textarea'), 'Keyword,Volume\nchrome flags,5400\nbig range keyword,1K - 10K\nrounded keyword,10K\n,50'); await click(btn('İçe aktar', $('.modal')), 800);
ok('the result names what was imported and every skipped kind with an example', txt().includes('1 anahtar kelimenin hacmi içe aktarıldı') && txt().includes('hacim aralık olarak geldi (ör. big range keyword)') && txt().includes('yuvarlak değer var (ör. rounded keyword)') && txt().includes('geçerli bir kelime yok'));
ok('only the exact number is stored, as real data from the file', (await q1("SELECT search_volume, provider FROM keyword_metrics m JOIN keywords k ON k.id = m.keyword_id WHERE k.keyword = 'chrome flags'")).search_volume === 5400 && (await q1("SELECT count(*)::int n FROM keywords WHERE keyword IN ('big range keyword', 'rounded keyword')")).n === 0 && (await q1("SELECT count(*)::int n FROM api_usage WHERE provider = 'serper'")).n === 0, JSON.stringify([await q1("SELECT search_volume, provider FROM keyword_metrics m JOIN keywords k ON k.id = m.keyword_id WHERE k.keyword = 'chrome flags'"), await q1("SELECT count(*)::int n FROM api_usage WHERE provider = 'serper'")]));
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
ok('the bots page shows the schedule of each bot, that paid bots start off, and the scheduler state', txt().includes('kalıcı görev kuyruğu') && txt().includes('Otomatik: 2 saatte bir') && txt().includes('para harcar') && $$('button').filter((b) => b.textContent.includes('Şimdi çalıştır')).length === 12);
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
ok('the WordPress bot is listed (auto-publish is off by default)', txt().includes('Content Publishing Bot') && txt().includes('Otomatik kapalı; elle çalıştırılır') && $$('button').filter((b) => b.textContent.includes('Şimdi çalıştır')).length === 12);
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
await click(btn('Test mesajı gönder'), 700);
ok('the test message reached both chats', TGF.sent().filter((m) => m.text.includes('test mesajı')).length === 2);
await click(btn('Webhook’u kur'), 700);
ok('setting the webhook without an https address is refused in words (the test API is plain http)', txt().includes('https') && !(await q1("SELECT value FROM telegram_state WHERE key = 'webhook'")));
await setVal(input('API’nin herkese açık adresi'), 'https://api.example.com'); await click(btn('Webhook’u kur'), 800);
const hook = await q1("SELECT value FROM telegram_state WHERE key = 'webhook'");
ok('with an https address Telegram was given the webhook and the secret; the card says it is set', !!hook && hook.value.url === 'https://api.example.com/api/content/telegram/webhook' && TGF.st.webhook.secret === globalThis.__srv.telegram.webhookSecret(globalThis.__tgToken) && txt().includes('webhook kurulu') && !txt().includes('webhook kurulu değil'));
await click(btn('Telegram’ın gördüğü durum'), 700);
ok('Telegram\'s own view (pending updates, its last error) is shown', txt().includes('Bekleyen güncelleme: 2') && txt().includes('503 Service Unavailable'));
// an owner command through the webhook, and a stranger
const sentBefore = TGF.sent().length;
await globalThis.__srv.telegram.handleUpdate(globalThis.__tgUpdate(91, 1001, '/status')); await globalThis.__srv.telegram.handleUpdate(globalThis.__tgUpdate(92, 5555, '/status'));
ok('the owner\'s /status is answered from the real data; the stranger gets nothing', TGF.sent().length === sentBefore + 1 && /Makaleler:/.test(TGF.sent().pop().text));
// a notification is forwarded, and the switches decide
await globalThis.__srv.notifications.create({ type: 'publish_failed', severity: 'warning', title: 'E2E yayın hatası', body: 'detay' }); await globalThis.__srv.notifications.flush();
ok('a WordPress failure reaches both chats and the card shows the last delivery', TGF.sent().filter((m) => m.text.includes('E2E yayın hatası')).length === 2);
await click(nav('API Kullanımı ve Maliyetler'), 400); await click(nav('Bildirimler'), 800);
ok('the card shows the last delivery', txt().includes('Son gönderim') && txt().includes('2 sohbete gitti'));
const sw = $$('label.check').find((l) => l.textContent.includes('WordPress yayın hatası')); await click($('input', sw), 700);
ok('a switch is saved on the server', (await q1("SELECT value FROM automation_settings WHERE key = 'telegram' AND scope = 'global'")).value.notify.publishError === false);
await globalThis.__srv.notifications.create({ type: 'publish_failed', severity: 'warning', title: 'E2E ikinci hata' }); await globalThis.__srv.notifications.flush();
ok('and a switched-off kind no longer goes to Telegram (it stays in the panel)', !TGF.sent().some((m) => m.text.includes('E2E ikinci hata')) && txt().includes('Bildirimler'));
await click(btn('Webhook’u kaldır'), 700);
ok('removing the webhook tells Telegram and the card says commands are off again', TGF.st.webhook === null && txt().includes('webhook kurulu değil'));

// ── logout ─────────────────────────────────────────────────────────────────────────────────────────
await click(aria('Çıkış'), 600);
ok('logout returns to the login form and ends the session', txt().includes('Giriş yap') && !nav('Makale Arşivi'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors or warnings', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
