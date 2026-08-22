# Trendyol API - Fiyat, Stok ve Toplu İşlemler (Batch)

## 1. Fiyat ve Stok Güncelleme
Ürünlerin tamamını güncellemek yerine, sadece Fiyat ve Stok bilgilerini hızlıca güncellemek için kullanılan çok kritik bir servistir.
- Tek istekte maksimum **1000 SKU/Barkod** güncellenebilir. (Tavsiye edilen batch gönderimi).
- Fiyat (`listPrice`, `salePrice`) ve stok (`quantity`) alanları güncellenir.
- Bu endpoint ile yapılan güncellemeler kuyruğa alınır ve `batchRequestId` döner.

Endpoint (POST): `/suppliers/{sellerId}/products/price-and-inventory`

## 2. Toplu İşlem Kontrolü (Batch Request Result)
Trendyol'da Ürün Yaratma ve Fiyat/Stok güncelleme işlemleri **Asenkron (Kuyruk)** yapısındadır.
İstek atıldığında anında ürünün güncellenip güncellenmediği belli olmaz, sistem size bir `batchRequestId` verir.
- Bu `batchRequestId` ile belirli aralıklarla (örn: 5-10 dk) sorgu atarak işlemin durumunu (SUCCESS, FAILED) ve hata detaylarını öğrenmeniz gerekir.

Endpoint (GET): `/suppliers/{sellerId}/products/batch-requests/{batchRequestId}`

*İyi pratik:* Bu endpointi sık sorgulamak API limitlerine (429) takılmaya sebep olur. Batch sonuçlarını arka planda yavaş bir periyotla kontrol eden bir Cron Job yazılmalıdır.
