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
| 2 Haber ve SEO motoru | Haber kaynakları, gündem tarama, niş filtresi, trend, DataForSEO, anahtar kelime, SERP, fırsat puanı | Yapılmadı (menüde "Aşama 2" olarak soluk) |
| 3 AI içerik üretimi | Kaynak araştırması, makale üretimi, doğruluk/AdSense kontrolü, kalite puanı | Yapılmadı |
| 4 Otomasyon | Zamanlayıcı, kalıcı görev kuyruğu, bot yönetimi, çalışma saatleri, hata/yeniden deneme | Yapılmadı |
| 5 WordPress | Çoklu site, kategori eşleme, yayın, zamanlama | Yapılmadı |
| 6 Güncelleme ve performans | Refresh motoru, içerik sağlığı, Search Console, iç bağlantı | Yapılmadı |
| 7 İleri modüller | AdSense site denetimi, Telegram, raporlar | Yapılmadı |

Henüz geliştirilmemiş aşamaların rakamları panelde "0" değil **"Aşama N'de etkinleşir"** olarak işaretlenir; sahte veri üretilmez.

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
cd server && CONTENT_TEST_DATABASE_URL=postgresql://…/content_test npm run test:content   # 48 entegrasyon testi, veritabanını SİLER (adı _test ile bitmeli)
cd content/admin && npm run build
cd content/admin && CONTENT_TEST_DATABASE_URL=… npm run test:smoke   # panel jsdom'da GERÇEK API + PostgreSQL'e karşı (36 kontrol)
```

CI (`.github/workflows/ci.yml`, iş `content`) bunları PostgreSQL servisiyle çalıştırır.

**Test EDİLEMEYENLER** (anahtar/hesap gerektirir): gerçek OpenAI, DataForSEO, Telegram, WordPress, Search Console çağrıları; yalnızca sahte `fetch` ile istek biçimi ve hata cümleleri doğrulandı. Panelin **görsel** görünümü (CSS, mobil yerleşim) tarayıcıda gözle doğrulanmadı: yalnızca derleme ve DOM davranışı test edildi.
