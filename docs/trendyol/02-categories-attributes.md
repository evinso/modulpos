# Trendyol API - Kategoriler ve Özellikler

## 1. Kategori Listesi
Trendyol'a ürün göndermek için ürünlerin doğru **en alt seviye (leaf)** kategori ID'si ile eşleştirilmesi zorunludur.
- Sadece `subCategories` array'i boş olan (alt kategorisi bulunmayan) kategorilere ürün yüklenebilir. 
- Aksi halde ürün aktarımı başarısız olur.
- Kategori ağacı periyodik olarak güncellendiği için bu listenin haftalık güncellenmesi/kontrolü önerilir.

Endpoint (GET): `/product-categories`

## 2. Kategori Özellik Listesi (Attributes)
Kategori ID'sini belirledikten sonra o kategoriye ait özellikleri (örn: Renk, Beden, Materyal vb.) almak için kullanılır. 
- Ürün gönderirken bazı özellikler **Zorunlu (Required)** olabilir. Zorunlu özellikleri göndermezseniz ürün reddedilir.
- Döndürülen listede `required: true` alanı zorunluluğu belirtir.

Endpoint (GET): `/product-categories/{categoryId}/attributes`

## 3. Kategori Özellik Değerleri Listesi
Bir kategori özelliğinin alabileceği önceden belirlenmiş değerleri (örn: Kırmızı, Mavi, S, M, L) döndürür. Eğer `allowCustom: false` ise sadece API'nin döndürdüğü ID ve ad (valueId) kullanılmalıdır.

Endpoint (GET): Kategori özellik listesinden döner (genelde query parametresi veya spesifik URL üzerinden).

Önemli Not: Kategori ve özellik değerlerini sunucuda cache'lemek, API limitlerine takılmamak ve Cloudflare engellerini önlemek için iyi bir pratiktir.
