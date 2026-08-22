# Trendyol API - Authorization ve Ortam Bilgileri

## 1. Kimlik Doğrulama (Authorization)
Trendyol API'si Basic Authentication kullanır. 
Satıcı (Seller) panelinde **Hesap Bilgilerim > Entegrasyon Bilgileri** altından alınan `Satıcı ID (supplierid)`, `API KEY` ve `API SECRET KEY` kullanılır.

**Header Yapısı:**
- `Authorization: Basic Base64(API_KEY:API_SECRET)`
- `User-Agent: {SellerId} - SelfIntegration` (Kendi entegrasyonumuz olduğu için `SelfIntegration` kullanılmalı. Aksi takdirde 403 hatası alınır.)

*Not: API key bilgileri gizli tutulmalı, asla açık platformlarda (GitHub vb.) paylaşılmamalıdır.*

## 2. Ortamlar (Environments)
Trendyol API'si için iki farklı ortam bulunur: Canlı (Prod) ve Test (Stage). Test ortamı için Satıcı panelinden Test API bilgilerinin oluşturulması gereklidir. İki ortamın credential'ları (API Key vb.) birbirinden farklıdır ve birbirleri yerine kullanılamazlar.

**Prod Ortamı:**
- Base URL: `https://api.trendyol.com/sapigw`
- Orijinal canlı ürün ve sipariş verilerini işler.

**Stage Ortamı (Test):**
- Base URL: `https://stageapi.trendyol.com/stagesapigw`
- Geliştirme aşamasında test amaçlı kullanılır.

## Önemli Notlar
- IP kısıtlamaları veya WAF (Cloudflare) engellerine takılmamak için doğru User-Agent gönderimi hayati önem taşır.
- Yanlış veya eşleşmeyen key/secret kullanımı 401 veya 403 Forbidden hatalarına neden olacaktır.
