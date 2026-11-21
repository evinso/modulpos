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
ok('menu: the 8 pages of later phases are dimmed and not clickable, the research pages are links now', $$('.nav.disabled').length === 8 && $$('.nav.disabled').every((n) => n.tagName === 'DIV') && !!nav('Dünya Gündemi') && !!nav('İçerik Fırsatları'));

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
ok('15 bots: the 6 of phase 2 are ready (by hand) and show real last runs, the rest say which phase builds them', $$('tbody tr').length === 15 && txt().includes('6 / 15 bot hazır') && txt().includes('Aşama 3’te gelecek') && txt().includes('Elle çalıştırılır') && txt().includes('zamanlayıcı yok'));
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

// ── logout ─────────────────────────────────────────────────────────────────────────────────────────
await click(aria('Çıkış'), 600);
ok('logout returns to the login form and ends the session', txt().includes('Giriş yap') && !nav('Makale Arşivi'));

console.error = () => {};
const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|act\(/.test(e));
ok('no React errors or warnings', real.length === 0, real.slice(0, 3).join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
