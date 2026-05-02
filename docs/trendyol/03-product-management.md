# Trendyol API - Ürün Yönetimi

## 1. Ürün Yaratma (Create Products)
Tekli veya çoklu (batch) ürün gönderimi yapılır. Ürünler gönderilirken zorunlu alanlar (Barkod, Fiyat, Kategori ID, Marka ID, Görseller vb.) eksiksiz olmalıdır.

Endpoint (POST): `/suppliers/{sellerId}/v2/products`
*Not: İstek kuyruğa atılarak işlenir (Asenkron). Cevap olarak bir `batchRequestId` döner.*

## 2. Onaysız (Draft) Ürün Güncelleme
Henüz Trendyol ekipleri tarafından onaylanmamış veya reddedilmiş ürünlerin bilgilerini güncellemek için kullanılır.
- Yeni kategori ve kategori özellik değerleri eklenebileceği için güncellemeden önce güncel attributeler kontrol edilmelidir.

Endpoint (PUT): `/suppliers/{sellerId}/v2/products`

## 3. Onaylı Ürün Güncelleme
Trendyol'da onaylanmış ve yayında olan ürünlerin belirli bilgilerini (content, varyant, teslimat vb.) güncellemek için kullanılır. Onaylı ürünlerde kategori ve marka değiştirilemez!

## 4. Ürün Silme
Sistemden ürün silmek için kullanılan metoddur. Trendyol'da ürün silme işlemleri genellikle desteklenmez; bunun yerine ürünün stoğunun sıfırlanması veya arşive alınması önerilir. Gerçekten silinmesi gereken durumlarda özel izinler gerekebilir.

## 5. Ürün Arşivleme
Ürünleri yayından kaldırmak için arşive alınabilir veya arşivden çıkartılabilir.
Endpoint (POST): `/suppliers/{sellerId}/products/archive`
Payload örneği: `{"barcode": "12345", "archive": true}` (true ise arşivler, false ise arşivden çıkarır)
