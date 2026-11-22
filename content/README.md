# ModulPOS AI Content Intelligence

İngilizce niş içerik, SEO araştırması, AdSense uyumluluğu ve çoklu WordPress yayını için ModulPOS'tan **bağımsız** yönetim platformu.
Kod ModulPOS deposunda ayrı klasörlerdedir ve ModulPOS'un API'sinin **içinde** (ücretsiz Render planında) çalışır; veritabanı ayrıdır.

```
server/src/content/     Backend (Express router /api/content, kendi PostgreSQL bağlantısı, SQL göçleri, servisler)
server/test/content/    Entegrasyon testleri (gerçek PostgreSQL ister)
content/admin/          Yönetim paneli (Vite + React, statik site → https://content.modulpos.com)
content/render.content.yaml   Panel için ayrı Render statik site şeması (ana render.yaml'a EKLENMEDİ)
```

## Güvenlik ve ModulPOS'a etkisi

- Modül **kapalıdır**: `CONTENT_DATABASE_URL` tanımlı değilse hiçbir bağlantı kurulmaz, `/api/content` yalnızca `503 kapalı` döner, CORS listesine yeni adres eklenmez. ModulPOS bu hâliyle eskisi gibi çalışır.
- Açılınca bile ayrı bir PostgreSQL'e bağlanır (ModulPOS'un Supabase'ine ve Prisma istemcisine dokunmaz). Veritabanı ulaşılamazsa API çökmez; modül `503` verir ve artan aralıklarla yeniden dener.
- Kill switch: `CONTENT_DISABLED=1`.
- Kullanıcı yönetimi ModulPOS'tan ayrıdır (kendi `users` tablosu, roller: admin / editor / viewer).

## Kurulum (bir kez)

1. **Yeni ücretsiz Supabase projesi** oluşturun (ModulPOS'unkinden ayrı). Sonra SQL Editor'de bir kez şunu çalıştırın (şifreyi kendiniz seçin):

   ```sql
   create role content_app login nosuperuser nocreatedb nocreaterole noinherit password 'GÜÇLÜ-ŞİFRE';
   create schema content;
   grant usage, create on schema content to content_app;
   alter role content_app set search_path = content;
   ```

   **Neden ayrı şema ve rol?** Supabase projesinin REST API'si varsayılan olarak `public` şemasını herkese açık anahtarla (publishable/anon) erişilebilir yapar. İçerik tabloları `public`'e konursa o anahtarla okunup yazılabilirdi. `content` şeması REST API'ye açılmaz ve yalnızca `content_app` rolü erişir; `anon`/`authenticated` hiçbir hak almaz.
   Bağlantı adresi: *Connect → Session pooler* (port **5432**, kullanıcı `content_app.<proje-ref>`). Transaction pooler (6543) kullanmayın: oturum ayarı ve kilitler için oturum bağlantısı gerekir.
2. Render'da **modulpos-api** servisine ortam değişkenlerini ekleyin (`server/.env.example` sonunda açıklamalı):

   | Değişken | Değer |
   |---|---|
   | `CONTENT_DATABASE_URL` | `postgresql://content_app.<ref>:<şifre>@aws-0-<bölge>.pooler.supabase.com:5432/postgres` |
   | `CONTENT_DB_SCHEMA` | `content` |
   | `CONTENT_ENCRYPTION_KEY` | `openssl rand -hex 32` çıktısı (64 hane). **Kaybederseniz kayıtlı API anahtarları okunamaz; bir yere yedekleyin.** |
   | `CONTENT_SETUP_TOKEN` | `openssl rand -hex 24` (ilk yöneticiyi oluşturmak için tek kullanımlık; kurulumdan sonra silin) |
   | `CONTENT_ADMIN_ORIGINS` | `https://content.modulpos.com` |

   Kaydedince API yeniden başlar; göçler otomatik uygulanır ve varsayılan proje ("Global Tech Content Site", AI & Digital Technology Updates, 5 kategori %35/25/15/15/10, "Not Connected" / Araştırma ve Arşiv Modu) oluşturulur. Log'da `[Content] ready` görülür.
3. **Panel için statik site**: Render → New → Static Site → aynı depo, *Root Directory* `content/admin`, build `npm install && npm run build`, publish `dist`, `content/render.content.yaml`'daki başlıklar ve `VITE_CONTENT_API_BASE_URL=https://api.modulpos.com/api/content`. Sonra özel alan adı `content.modulpos.com` ve DNS'te CNAME.
4. https://content.modulpos.com adresini açın → **İlk yönetici kurulumu** ekranı çıkar: `CONTENT_SETUP_TOKEN`, ad, e-posta, şifre (en az 12 karakter). Sonra `CONTENT_SETUP_TOKEN`'ı Render'dan silin.
5. **API sayfasından** OpenAI / DataForSEO anahtarlarını girin (Aşama 2–3'ten itibaren kullanılır). Anahtarlar sohbet ya da depoya değil, yalnızca panele yazılır; sunucuda AES-256-GCM ile şifrelenir ve bir daha gösterilmez.

> Ücretsiz Supabase projeleri yaklaşık bir hafta hareketsizlikte durur. API her uyandığında ve 6 saatte bir veritabanına hafif bir sorgu atar; yine de uzun süre kullanmayacaksanız Supabase panelinden kontrol edin.

## Aşama durumu

| Aşama | İçerik | Durum |
|---|---|---|
| 1 Temel platform | Giriş (roller, oturum, kilit), Dashboard, veritabanı, Site Nişi ve İçerik Stratejisi, kategoriler (pay %100), kapsam dışı konular, **Günlük Çalışma Ayarları** (genel/proje/kategori limiti, yarışa dayanıklı), API yönetimi ve maliyet kaydı + bütçe koruması, Makale Arşivi (sürümler, durum makinesi, hazır olma kontrolü, toplu işlem, CSV/JSON/HTML/Markdown dışa aktarma), bildirimler, işlem geçmişi, sistem ayarları | **Tamam, test edildi** |
| 2 Haber ve SEO motoru | Haber kaynakları (RSS/Atom, Google Haberler, GDELT), gündem tarama, niş filtresi, olay kümeleme, trend, niş önerileri, DataForSEO istemcisi, anahtar kelime, SERP rekabet tahmini, fırsat puanı ve “bugün ne yazılırdı” seçimi | **Tamam. Haber tarafı gerçek kaynaklarla test edildi; DataForSEO tarafı gerçek hesapla DENENMEDİ** (anahtar yok) |
| 3 AI içerik üretimi | Kaynak araştırması, makale üretimi (Claude / OpenAI / Gemini), doğruluk kontrolü, AdSense/editoryal inceleme, kalite puanı, kontrol paneli | Yapıldı (sahte sağlayıcı yanıtlarıyla test edildi; gerçek model çağrısı HİÇ yapılmadı) |
| 4 Otomasyon | Zamanlayıcı, kalıcı görev kuyruğu, bot yönetimi, çalışma saatleri, hata/yeniden deneme | Yapılmadı |
| 5 WordPress | Çoklu site, kategori eşleme, yayın, zamanlama | Yapılmadı |
| 6 Güncelleme ve performans | Refresh motoru, içerik sağlığı, Search Console, iç bağlantı | Yapılmadı |
| 7 İleri modüller | AdSense site denetimi, Telegram, raporlar | Yapılmadı |

Henüz geliştirilmemiş aşamaların rakamları panelde "0" değil **"Aşama N'de etkinleşir"** olarak işaretlenir; sahte veri üretilmez.

## Aşama 2: haber ve SEO motoru (nasıl çalışır)

Hepsi elle çalıştırılır (ilgili sayfadaki düğmeler); otomatik zamanlama ve görev kuyruğu Aşama 4'te gelecek.

1. **Dünya Gündemi** (`/news`): projenin haber kaynakları (varsayılan 22: CISA, OpenAI, Google, Chrome sürümleri, Apple, Microsoft, Mozilla, Ars Technica, TechCrunch, Wired, BleepingComputer, Engadget, CNET, 9to5Mac ... ve 4 Google Haberler araması; GDELT kapalı gelir) okunur. Her haber için başlık, bağlantı, kaynak, tarih, ülke, dil ve **400 karakterlik özet** saklanır; **tam metin alınmaz**. Aynı bağlantı bir kez saklanır; aynı olayı anlatan farklı kaynaklar tek **olay**da toplanır (kaç kaynak haber yaptığı trend sinyalidir). Okuma güvenlidir (iç ağ adreslerine gidemez, 4 MB ve 15 sn sınırı, ETag ile koşullu istek, hata/istek sınırında geri çekilme). Kaynak eklemek yalnızca admin yetkisidir.
2. **Niş filtresi**: önce kapsam dışı konular (spor, magazin, siyaset, genel finans, sağlık teşhis/tedavi ...) elenir; sonra her kategorinin **kendi anahtar kelime listesine** göre puanlanır. Güçlü terim (ürün/şirket adı, "data breach", "price increase" gibi) başlıkta 40 puan; genel kelimeler (ai, app, update, privacy ...) tek başına geçiremez. Yapay zekâ kullanılmaz: kural tabanlıdır, **sınır durumlarda hata yapar**; sonuç neden verildiğini yazar, siz olayı elle “ilgili/ilgisiz” yapabilirsiniz (kararınız bir daha ezilmez) ve kategori anahtar kelime listelerini Strateji sayfasından düzeltebilirsiniz. Varsayılan listeler 490 gerçek başlık üzerinde ayarlandı (sürüm 3): fırsat/indirim, yatırım/halka arz, finans yayıncıları, podcast/özet yayınları, beta ve Insider sürüm notları, burç, kurumsal altyapı açıkları (VMware, Cisco, PHP ...) ve dava haberleri kapsam dışıdır; telefon/kulaklık gibi donanım adları artık güçlü terim değildir (yazılım güncellemesi değilse niş dışı). Gerçek veride başlıkların yaklaşık %35'i nişe uygun çıkar. Kapsam dışı eşleşmesi **başlığa ve yayıncıya** bakar, özete bakmaz. Listeleri değiştirince **Dünya Gündemi → Yeniden değerlendir** son 14 günün haberlerini yeni kurallarla tekrar süzer (elle verdiğiniz kararlar korunur). Canlı proje önceki varsayılandan yükseltilirken yalnızca **sizin düzenlemediğiniz** listeler değişir.
3. **Trend Analizi**: olay başına kaynak sayısı, son 12 saat haber sayısı ve tazelikten (0–100) hesaplanır. Arama trendi yalnızca DataForSEO aylık geçmişi alınmış kelimeler için görünür.
4. **Niş Keşif Merkezi**: nişe uymayan haber başlıklarında çok kaynakta tekrar eden kelime çiftlerini sayar; önerir, **asla kendiliğinden eklemez** (kabul: yeni kategori ya da mevcut kategoriye terim; reddet; sonra bak).
5. **Anahtar Kelime Araştırması** (DataForSEO Labs `keyword_overview`, `keyword_suggestions`, `related_keywords`): aranma hacmi, CPC, ücretli rekabet, niyet, aylık geçmiş, DataForSEO'nun kendi zorluk metriği. **Veri yoksa “Veri bulunamadı”**; hiçbir sayı uydurulmaz. Tek istekte 700 kelime, `seo.cacheDays` (30) kadar önbellek, günlük `seo_keywords` limiti, sağlayıcı/platform bütçe koruması çağrıdan **önce** kontrol edilir; ücret yanıttaki gerçek `cost` alanından kaydedilir. Onay penceresi önce “kaç kelime, ne kadar önbellekte, tahmini ücret” gösterir.
6. **SEO Rekabet Analizi** (DataForSEO SERP): ilk 10 sonuçtan büyük yayıncı / resmî kaynak / forum / bağımsız site oranlarıyla 0–100 **tahmini organik rekabet**; her etken ve ağırlık görünür. **Google'ın resmî zorluk metriği değildir** (ekranda yazar).
7. **İçerik Fırsatları**: her konu için Trend %30 + Rekabet fırsatı %25 + Aranma talebi %20 + Nişe uygunluk %15 + Kaynak güveni %10 (ağırlıklar Ayarlar'dan değişir). **Toplam puan yalnızca beş bileşenin hepsi gerçek veriye dayanıyorsa verilir**; eksikse neyin eksik olduğu yazılır ve fikir uygun sayılmaz. Niş dışı, reddedilmiş, kendi makalenizle kelime çakışan (kanibalizasyon) ya da minimum puanın (varsayılan 70; kategoriye özel verilebilir) altındaki fikir hiç uygun olmaz. “Bugün ne yazılırdı?” kuru denemesi boş yer, kategori günlük sınırı ve kategori hedef payına göre seçer; **kota doldurmak için zayıf konu eklemez**.

Günlük limit anahtarları: `news_items` (varsayılan 1000), `seo_keywords` (100), `serp_queries` (30); hepsi Günlük Çalışma Ayarları'ndan değişir.

**Gerekli API bilgisi:** haber tarafı hiçbir anahtar istemez. SERP için **Serper.dev API anahtarı** (ücretsiz başlangıç) ya da DataForSEO login + **API şifresi** (panel şifresi değil); ikisi de API Kullanımı sayfasına yazılır.

### Ücretsiz mod (DataForSEO olmadan, 2026-11-21)
DataForSEO hesabın doğrulanması için ön ödeme (50 $) istiyor; bu olmadan hiçbir ücretli uç nokta çalışmaz. Bu yüzden ücretli veri sağlayıcısı zorunlu değildir:
* **SERP rekabeti: Serper.dev** (`services/serper.js`; ayar `seo.serpProvider`, varsayılan `serper`; `dataforseo`ya geçilebilir). Serper'in kendi sayfasına göre 2.500 sorgu kartsız ücretsiz. Kredi dolar değildir: maliyet **“Bilinmiyor”** kaydedilir, kredi `units`a yazılır. Serper referans alan adı / zorluk vermez, bu yüzden otorite etkeni **dışarıda bırakılır** (uydurulmaz). Bağlantı testi ücretsiz bir uç nokta olmadığı için 1 gerçek sorgu (1 kredi) yapar. Her analiz hangi kaynaktan geldiğini saklar (`serp_analyses.provider`).
* **Aranma hacmi: dosyadan içe aktarma** (`lib/keywordFile.js`, `keywords.importMetrics`, `POST /keywords/import`, düğme “Dosyadan hacim aktar”): Google Ads Anahtar Kelime Planlayıcı / Keywords Everywhere / Excel çıktısı. Başlıktan sütun bulur (sekme/noktalı virgül/virgül, başlık öncesi başlık satırları, UTF-8/UTF-16/Windows-1254 sayfada çözülür), aylık sütunlardan (`Searches: Nov 2025`) trend hesaplar. **Yalnızca kesin sayı** alınır: aralık (“1K – 10K”, harcaması olmayan Google Ads hesaplarında böyle gelir), yuvarlak (“10K”) ve boş hacimler atlanır ve nedeniyle birlikte sayılır; tanınmayan başlıklı dosya veri sayılmaz. Satırlar `keyword_metrics.provider = 'csv'` ile EN YENİ veri olur, ücretli çağrı olmadığı için günlük `seo_keywords` limitine ve bütçeye dokunmaz. Tek seferde 2000 satır.
* **Kısmi puan** (ayar `seo.partialWithApproval`, varsayılan açık): yalnızca **aranma hacmi** eksik, diğer dört bileşen gerçekse (haber trendi, o fikrin en özel aday ifadesinin GERÇEK SERP analizi, nişe uygunluk, kaynak) fikir “kısmi puan” alır (dört bileşenin ağırlıklı ortalaması; toplam puan boş kalır). Fikir **ancak bir kişi “Kısa liste”ye aldığında** (onay) ve kısmi puan minimumu geçtiğinde uygun olur; kısa listeden çıkarmak onayı geri alır. Gerçek hacim gelince (dosya ya da API) aynı fikir normal tam puana döner. SERP analizi yapılmamış fikir hiç uygun olmaz. Ayar kapalıysa eski sıkı davranış: hacim yoksa uygun değil.

**Sunucu gereksinimi:** ek bir şey yok (aynı API süreci; dışarıya https çıkışı). Tarama arka planda çalışır; süreç yeniden başlarsa yarım kalan tarama “yarıda kaldı” diye kapatılır.

## Aşama 3: AI makale yazımı ve zorunlu kontroller (nasıl çalışır)

Başlangıç: **İçerik Fırsatları → uygun bir fikir → “Makale yaz”** (yalnızca yönetici; para harcar). Çalışma arka planda yürür (`automation_runs`, ilerleme adımı görünür); sayfadan ayrılınca sunucuda sürer.
1. **Yer ayırma**: günün `new_article` limitinden 1 yer (hepsi-ya-hiç, en dar limit söylenir), sağlayıcı bütçe koruması; aynı projede aynı anda tek yazım.
2. **Kaynak toplama** (`services/sources.js`): fikrin haber olayındaki en güvenilir ≤5 FARKLI yayıncı; sayfalar SSRF-korumalı okuyucuyla okunur, metin 5.000 karaktere kesilir; okunamazsa (ödeme duvarı vb.) başlık+özet kullanılır ve **`readOk=false`** diye işaretlenir. Bu üçüncü taraf metin yalnızca iç doğrulama önbelleğidir (`article_sources.excerpt`): yayınlanmaz, API'den tam dönmez (panel 300 karakterlik önizleme görür).
3. **Yazım** (`services/writer.js`, `services/llm.js`): seçili model tek bir JSON makale üretir. Kaynaklar modele **güvenilmeyen veri** olarak (`<source>` blokları, kapanış etiketi temizlenir) verilir; kurallar: kopyalama yok, uydurma sayı/alıntı/bağlantı yok, kaynağı adıyla an, tıklama tuzağı yok. Çıktı doğrulanır, HTML temizlenir (`lib/html.js`), odak kelime fikrin gerçek verili kelimesidir. Okunamayan JSON bir kez daha denenir, başka hata yeniden denenmez.
4. **Kontroller** (`services/checks.js`), tercihen yazandan FARKLI model (`quality.checkerProvider`, otomatik): **ücretsiz kurallar** (uzunluk, başlıklar, başlık/meta, odak kelime ve yoğunluğu, okunabilirlik, yapay zekâ kalıntıları, kaynaklardan **kelimesi kelimesine kopya yüzdesi**, kendi makalelerinize benzerlik) · **doğruluk kontrolü** (model iddiaları ve kanıt alıntısını listeler; kod, alıntının kaynakta GERÇEKTEN geçtiğini ve iddiadaki sayıların kaynakta olduğunu doğrular, yoksa “doğrulanamadı”; önemli iddia doğrulanamıyorsa damga basılmaz) · **AdSense/editoryal inceleme** (13 kategori; ölçülen kopya/yoğunluk/uzunluk modelin “geçti”sini ezer; yanıtlanmayan kategori geçti sayılmaz; sınıf: düşük / inceleme / yayınlanamaz) · **kalite puanı** = özgünlük 25 + doğruluk 25 + fayda 20 + SEO/okunabilirlik 15 + editoryal 15, **yalnızca beşi de gerçekten ölçüldüyse**.
5. Sonuç: makale `needs_review` (asla kendiliğinden `ready`/yayın), fikir `written`, konu `used`. Çalışmayan kontrol “Çalışmadı”dır, geçmiş sayılmaz; çalışma `partial` biter, makale kalır ve “Tüm kontroller” ile tamamlanır.
- **Düzenleme**: yapay zekâ makalesinin metni/H1'i değişince doğruluk damgası, AdSense sınıfı ve kalite puanı **geri çekilir** (eski metni anlatıyorlardı); ücretsiz kurallar yeni metinde yeniden çalışır, model kontrolleri “Tüm kontroller (yapay zekâ)” ile.
- **Sağlayıcılar** (API Kullanımı): Anthropic (resmî SDK; model boşsa `claude-sonnet-5-5`), OpenAI (Chat Completions) ve Gemini (generateContent); OpenAI/Gemini model adı elle yazılır (adlar sık değişir). Fiyatlar (USD/1M token) isteğe bağlı: girilirse maliyet token'dan hesaplanır, girilmezse **“Bilinmiyor”** (asla 0 değil); bütçe koruması çağrıdan ÖNCE çalışır ve fiyat yoksa tutarı 0 sayar.
- **Başarısızlık**: yazım başlamadan/anahtar reddedilince günün yeri geri verilir ve fikir eski durumuna döner; faturalanmış olabilecek hata (zaman aşımı, okunamayan cevap) yeri harcanmış sayar. Boot'ta yarım kalan işler kapatılır (`writer.closeStale`).
- **Doğrulanmayanlar**: hiçbir gerçek model çağrısı yapılmadı (anahtar yok); istemciler satıcıların belgelerindeki yanıt biçimlerine göre yazıldı ve sahte yanıtlarla test edildi (model adları, hata gövdeleri, token alanları ilk gerçek anahtarda küçük farklar gösterebilir). Doğruluk kontrolü yalnızca makalenin kaynaklarına karşıdır (web taranmaz); AdSense sınıfı bir risk tahminidir, onay/gelir garantisi değildir.

## Temel kararlar (neden böyle)

- **Ücretsiz plan**: ikinci bir sürekli açık servis ModulPOS'un 750 saatlik aylık hakkını tüketip ikisini de durdururdu. Bu yüzden ModulPOS API'sinin içinde çalışır. Zamanlayıcı/kuyruk (Aşama 4) API uyanıkken çalışır; GitHub keepalive (10 dk) bunu çoğu zaman uyanık tutar. Ağır/sürekli çalışma gerekirse ücretli ayrı servis önerilir.
- **Ayrı Prisma istemcisi yok**: ModulPOS derlemesini değiştirmemek için `pg` ile SQL göçleri (`server/src/content/migrations/NNNN_*.sql`, sağlama toplamı kontrollü, uygulanmış göç asla düzenlenmez) kullanılır.
- **Redis yok**: kuyruk PostgreSQL'de (`FOR UPDATE SKIP LOCKED`) olacak; yeniden başlatmada iş kaybolmaz.
- **Limitler**: `limits.reserve()` tek işlemde (transaction) genel → proje → kategori satırlarını sabit sırayla kilitler; 40 eşzamanlı istek 10 boş yere tam 10 onay verir (test edildi). "Gün", `CONTENT_TIMEZONE` (varsayılan Europe/Istanbul) gününe göredir.
- **Zorunlu kontroller** (doğruluk, AdSense riski, tekrar/kanibalizasyon) hiçbir ekran ve istekle kapatılamaz; makale "Yayına hazır" olmadan bunlar tamamlanmalıdır.

## Güvenlik özeti

bcrypt (maliyet 12) + şifre politikası · oturum belirteci yalnızca SHA-256 olarak saklanır, httpOnly + SameSite=Lax + (üretimde) Secure çerez, yalnızca `/api/content` yoluna · giriş denemesi IP+e-posta başına veritabanında sayılır (5/15 dk) ve 10 başarısızlıkta hesap 15 dk kilitlenir, bilinmeyen kullanıcı için aynı bcrypt süresi harcanır · ilk yönetici yalnızca tek kullanımlık sunucu anahtarıyla ve yalnızca hiç kullanıcı yokken · CSRF: özel başlık + Origin listesi · CORS yalnızca `CONTENT_ADMIN_ORIGINS` · API anahtarları şifreli, hiçbir yanıtta/günlükte yok · makale HTML'i izin listesiyle temizlenir (script/stil/olay işleyicisi yok), önizlemede ayrıca DOMPurify · CSV'de formül enjeksiyonu koruması · dışa aktarma `Content-Security-Policy: sandbox` · tüm SQL parametrelidir; sıralama/sütun adları sabit izin listesindendir · yetkisiz roller sunucuda engellenir (arayüz yalnızca gizler).

## Testler

```bash
cd server && npm test                       # ModulPOS + içerik birim testleri (veritabanı gerekmez)
cd server && CONTENT_TEST_DATABASE_URL=postgresql://…/content_test npm run test:content   # 73 entegrasyon testi, veritabanını SİLER (adı _test ile bitmeli)
cd server && CONTENT_TEST_DATABASE_URL=postgresql://…/content_test node scripts/content-live-news.js   # GERÇEK ağdan varsayılan kaynakları okur (CI'da yok)
cd content/admin && npm run build
cd content/admin && CONTENT_TEST_DATABASE_URL=… npm run test:smoke   # panel jsdom'da GERÇEK API + PostgreSQL'e karşı (kaynak ekleme, tarama, anahtar kelime, SERP, fırsat dahil)
```

CI (`.github/workflows/ci.yml`, iş `content`) bunları PostgreSQL servisiyle çalıştırır.

**Test EDİLEMEYENLER** (anahtar/hesap gerektirir): gerçek OpenAI, **DataForSEO**, **Serper.dev** (istemci satıcının herkese açık örnek yanıtından yazıldı; `credits` alanı, hata gövdeleri ve `date` biçimleri ilk gerçek anahtarla doğrulanmalı), Telegram, WordPress, Search Console çağrıları; DataForSEO istemcisi belgelerdeki alan adlarından yazıldı ve yalnızca belgeye göre elle kurulmuş sahte yanıtlarla (zarf, görev kodları, hata durumları) sınandı: ilk gerçek hesapta alan adı farkı çıkabilir (örn. `competition` tipi, ülke dışı konumlar). GDELT'in hız sınırı nedeniyle (5 sn'de 1 istek) gerçek yanıtı bu geliştirme ortamından alınamadı; biçimi belgeden kurulu bir örnekle sınandı. Panelin **görsel** görünümü (CSS, mobil yerleşim) tarayıcıda gözle doğrulanmadı: yalnızca derleme ve DOM davranışı test edildi.
