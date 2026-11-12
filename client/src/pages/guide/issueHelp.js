// "Ürün neden hazır değil?" nedenlerinin açıklaması. Anahtarlar, ürün listesindeki ISSUE_LABELS ile aynıdır
// (test/guide.test.mjs, her nedenin burada açıklandığını denetler).
export const ISSUE_HELP = {
  no_category_mapping: ['Ürünün XML kategorisi bir Trendyol kategorisine bağlı değil ve ürüne özel kategori de verilmemiş.', 'Kategori Eşleştirme sayfasında XML kategorisini eşleştirin ya da Ürün bazlı kategori sekmesinde ürüne bir kategori verin.'],
  bad_barcode: ['Barkod boş, 3 karakterden kısa, 40 karakterden uzun ya da boşluk / küme parantezi içeriyor.', 'XML kaynağında Barkod alanının doğru eşleştiğini kontrol edin (Alan Eşleştir). Tedarikçi barkod vermiyorsa ürün gönderilemez.'],
  duplicate_barcode: ['Aynı barkod başka bir üründe de var. Yalnızca biri gider: önce stokta olan, sonra ucuz olan, sonra eski olan.', 'Atlanan ürünün de gitmesini istiyorsanız barkodunu ayırın (Barkod Ön Eki) ya da diğer ürünü pasife alın.'],
  no_price_rule: ['Bu ürüne uyan, açık bir fiyat şablonu yok.', 'Fiyat Şablonları sayfasında bu pazaryerini ve XML kaynağını kapsayan bir şablon oluşturun ya da kapalı olanı açın.'],
  invalid_price: ['Hesaplanan satış fiyatı geçersiz (sıfır ya da hesaplanamadı).', 'Alış fiyatı 0 geliyor olabilir ya da komisyon + kâr oranı çok yüksektir. XML’de Alış Fiyatı eşleştirmesini ve şablonu kontrol edin.'],
  price_below_cost: ['Satış fiyatı alış fiyatının altında.', 'Elle girdiğiniz fiyatı yükseltin ya da Şablon fiyatına döndürün; alış fiyatı arttıysa şablonu gözden geçirin.'],
  title_empty: ['Ürünün başlığı boş.', 'XML’de Ürün Adı eşleştirmesini kontrol edin.'],
  title_too_long: ['Başlık, Trendyol’un sınırı olan 100 karakteri aşıyor (gönderim ayarlarındaki ön/son ek dahil).', 'Ürünü düzenleyip başlığı ya da gönderim ayarlarındaki ön/son eki kısaltın.'],
  no_description: ['Açıklama boş.', 'XML’de Açıklama alanını eşleştirin ya da ürünü düzenleyip açıklama yazın.'],
  description_too_long: ['Açıklama 30.000 karakteri aşıyor.', 'Açıklamayı kısaltın.'],
  no_image: ['Geçerli bir görsel adresi yok (boş ya da http/https ile başlamıyor).', 'XML’de Görsel URL alanını eşleştirin; kaynakta görsel yoksa ürünü düzenleyip ekleyin.'],
  bad_vat: ['KDV oranı Trendyol’un kabul ettiği 0, 1, 10, 20 değerlerinden biri değil.', 'XML kaynağında Ürün KDV Oranı’nı düzeltin.'],
  bad_stock: ['Stok negatif.', 'Tedarikçideki stok alanı bozuk olabilir; Stok Miktarı eşleştirmesini kontrol edin.'],
  rejected_by_marketplace: ['Trendyol bu ürünü reddetti; neden ürünün üzerine gelince yazar.', 'Nedeni giderin (ör. yasaklı kelimeyi Gönderim ayarlarına yazın). Düzeltilmeden tekrar gönderilmez.'],
  missing_attributes: ['Seçilen Trendyol kategorisinin zorunlu özelliklerinden biri (renk, menşei…) doldurulmamış.', 'Kategori Eşleştirme sayfasında özellikleri girin ya da Varsayılan cevaplar tanımlayın.'],
  no_brand: ['Üründe marka yok ve bağlantıda yedek/kendi marka seçilmemiş.', 'Pazaryerleri sayfasında bağlantıyı düzenleyip Marka Stratejisi’ne bir marka ekleyin.'],
  excluded_by_settings: ['Gönderim ayarlarındaki bir kurala takıldı (en az stok, görseli olmayanları gönderme gibi).', 'Gönderim ayarlarını gözden geçirin.'],
  already_listed: ['Barkod Trendyol’da zaten kayıtlı; tekrar gönderilmez.', 'Bir şey yapmanız gerekmez; fiyat ve stok otomatik güncellenir.'],
  off_sale: ['Ürün Trendyol’da var ama satışta değil (kaldırılmış ya da reddedilmiş).', 'Trendyol Satıcı Paneli’nden düzeltin.'],
};
