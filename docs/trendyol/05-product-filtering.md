# Trendyol API - Ürün Filtreleme (GET)

Ürünlerin durumlarını, onaylı/onaysız hallerini Trendyol panelinden çekmek için kullanılır. Senkronizasyon ve eşleştirme aşamalarında ürünlerin durumunu Trendyol'dan okumak için bu servisler kullanılır.

## 1. Temel Ürün Filtreleme
Sadece belirli bir barkod üzerinden arama yaparak ürün detaylarını ve onay durumunu getirir.
Endpoint: `/suppliers/{sellerId}/products?barcode={barcode}` (Örnek kullanım)

## 2. Onaysız Ürün Filtreleme (Draft Products)
Onay süreci devam eden veya Trendyol ekiplerince reddedilen ürünleri listeler.
- Reddedilen ürünlerin red sebepleri bu servis sayesinde kontrol edilir.
Endpoint: `/suppliers/{sellerId}/products?approved=false`

## 3. Onaylı Ürün Filtreleme
Yayında olan, aktif ürünleri getirir.
Pagination (Sayfalama) mekanizması kullanılır. İsteklerde `page`, `size` (veya V2 için `nextPageToken`) gönderilmelidir.
Maksimum data alabilmek için genelde `size=100` tavsiye edilir.

Endpoint: `/suppliers/{sellerId}/products?approved=true`

*Not: Ürün filteleme servisleri, sizin lokal veri tabanınızdaki verilerle Trendyol'daki verilerin tutarlılığını (Senkronizasyon) denetlemek için kullanılmalıdır.*
