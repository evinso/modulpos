export const XML = [
  {
    id: 'xml', icon: 'file', title: 'XML kaynakları',
    intro: 'Tedarikçi ürün listesini bağlama, alanları eşleştirme ve senkronizasyon.',
    topics: [
      {
        id: 'xml-nedir', title: 'XML kaynağı nedir?',
        blocks: [
          { t: 'p', x: 'XML kaynağı, tedarikçinizin ürünlerini (barkod, ad, alış fiyatı, stok, görsel, kategori…) paylaştığı bir internet adresidir. ModulPOS bu adresi düzenli aralıklarla okur, ürünleri oluşturur ve günceller. Bir mağazada istediğiniz kadar kaynak olabilir; her ürün hangi kaynaktan geldiğini bilir.' },
          { t: 'p', x: 'Kaynak kartında kaynağın adı, durumu (**Aktif / Hata / Bekliyor**), eşleştirme durumu (**Eşleştirildi / Eşleştirme Yok**), ürün sayısı, yenileme aralığı ve son yenileme zamanı görünür.' },
        ],
      },
      {
        id: 'xml-ekleme', title: 'Yeni XML kaynağı nasıl eklenir? (5 adım)',
        blocks: [
          { t: 'p', x: '{{/xml-sources|XML Kaynakları}} sayfasında [[XML Kaynağı Ekle]]’ye basın. Sihirbaz beş adımdır:' },
          { t: 'steps', x: [
            '**XML Kaynağı Ekle** — [[Kaynak Adı]], [[XML URL]] ve [[Senkronizasyon Aralığı (dakika)]] (en az 5). Sistem adresi okur, kaç ürün bulduğunu ve alanları gösterir.',
            '**Alan Eşleştirmesi** — XML’deki alanları ModulPOS alanlarına bağlarsınız ({{#xml-alanlar|ayrıntı}}). Bilinen formatlarda alanlar **kendiliğinden önerilir**; yalnızca kontrol edip düzeltirsiniz.',
            '**Ürün Ayarları** — barkod ön eki, alış fiyatı KDV’si ve ürün KDV’si ({{#xml-ayarlar|ayrıntı}}).',
            '**Önizleme & Kaydet** — eşleştirmenin ilk ürünlerde nasıl göründüğüne bakıp kaydedersiniz. Kategorileri Trendyol’a bağlamak ayrı bir adımdır ({{#kategori-neden|Kategori Eşleştirme}}).',
            '**Tamamlandı** — [[Ürünleri Çek]] ile ürünler ilk kez sisteme alınır. Büyük listeler arka planda çekilir, ilerlemeyi kartta görürsünüz.',
          ] },
          { t: 'note', tone: 'tip', x: 'Adres bir HTML sayfası döndürüyorsa (giriş sayfası, hata sayfası gibi) sistem “geçerli bir XML döndürmüyor” uyarısı verir. Adresin doğrudan XML dosyasına gittiğinden emin olun.' },
        ],
      },
      {
        id: 'xml-alanlar', title: 'Alan eşleştirme',
        blocks: [
          { t: 'table', head: ['ModulPOS alanı', 'Zorunlu mu?', 'Açıklama'], rows: [
            ['SKU / Ürün Kodu', 'Evet', 'Ürünün tedarikçideki benzersiz kodu.'],
            ['Barkod', 'Hayır', 'Trendyol’a giden barkod. Boşsa ürün gönderilemez (“Barkod hatalı”).'],
            ['Ürün Adı', 'Evet', 'Trendyol başlığı en çok 100 karakterdir.'],
            ['Açıklama', 'Hayır', 'Boşsa ürün “Açıklama yok” nedeniyle gönderilmez.'],
            ['Alış Fiyatı', 'Evet', 'Fiyat şablonunun hesabı bu fiyattan başlar.'],
            ['Stok Miktarı', 'Evet', 'Sayı ya da “stokta var / yok” gibi bir durum alanı olabilir.'],
            ['Marka', 'Hayır', 'Boşsa Marka Stratejisi’ndeki marka kullanılır.'],
            ['Kategori', 'Hayır', 'Kategori eşleştirmesinde kullanılır.'],
            ['Görsel URL', 'Hayır', 'En az bir geçerli (http/https) görsel gerekir.'],
          ] },
          { t: 'ul', x: [
            '**Birden fazla görsel:** Görsel için istediğiniz kadar alan ekleyebilirsiniz (ör. Resim1 … Resim5). Alan listesi **birçok üründen** derlenir: ilk üründe 2 görsel, sonrakilerde 5 görsel olsa da hepsi listede çıkar. Bir üründe olmayan görsel alanı hata vermez, o ürün için atlanır.',
            '**Kategori:** Birden fazla kategori düzeyi (ör. Ev > Mutfak > Kupa) tek yol olarak okunur.',
            '**Fiyat biçimi:** “1.874,70”, “1874.7”, “1.874,70 TRY” gibi yazımlar anlaşılır.',
            'Kaydettiğiniz eşleştirme her zaman önceliklidir; sistem yalnızca **boş bıraktığınız** alanlar için öneri yapar.',
            'Eşleştirmeyi sonradan değiştirmek için kaynak kartında [[Alan Eşleştir]]’e basın.',
          ] },
        ],
      },
      {
        id: 'xml-ayarlar', title: 'Ürün ayarları: barkod ve KDV',
        blocks: [
          { t: 'table', head: ['Alan', 'Ne işe yarar'], rows: [
            ['Barkod Ön Eki', 'Barkodların başına eklenir (ör. “TRY-” ise 12345 → TRY-12345). Aynı barkodu kullanan farklı tedarikçileri ayırmak için.'],
            ['Alış Fiyatı KDV Oranı', 'Tedarikçi fiyatları **KDV hariç** geliyorsa seçtiğiniz oran alış fiyatına otomatik eklenir. Fiyatlar KDV dahilse %0 bırakın. (Alış fiyatı sistemde hep KDV dahil tutulur.)'],
            ['Ürün KDV Oranı (Trendyol)', 'Satış KDV’si: %0, %1, %10 veya %20. Hem Trendyol’a gider hem fiyat hesabında kullanılır.'],
          ] },
          { t: 'note', tone: 'info', x: 'Tedarikçinizin sipariş sonrası ürün başına aldığı **hizmet bedeli** gibi giderler XML kaynağına değil, **fiyat şablonundaki [[Diğer gider (₺)]]** alanına yazılır; hem satış fiyatına eklenir hem de Kârlılık’ta düşülür ({{#sablon-maliyet|ayrıntı}}).' },
        ],
      },
      {
        id: 'xml-senkron', title: 'Senkronizasyon nasıl çalışır?',
        blocks: [
          { t: 'ul', x: [
            'Kaynak, seçtiğiniz aralıkta (en sık yaklaşık 10 dakikada bir bakılır) yeniden okunur; yeni ürünler eklenir, değişen alış fiyatı/stok/başlık güncellenir.',
            'Hemen yenilemek için kaynak kartında [[Şimdi Çek]]’e basın. Önceki yenilemeleri [[Geçmiş]] düğmesinde görürsünüz.',
            'Her yenilemeden sonra, bu kaynaktan **Trendyol’da satışta olan** ürünlerin fiyat ve stoğu otomatik güncellenir (yalnızca değişenler).',
            'Elle fiyat girdiğiniz bir ürünün alış fiyatı artarsa ve elle fiyatınız **zarara** düşerse bildirim alırsınız.',
            'XML’i değiştirmeden önce [[Önizle]] ile kaynağın ilk ürünlerine ve kategorilerine bakabilirsiniz.',
          ] },
          { t: 'p', x: '**Kaynaktan kalkan ürünler** silinmez: stokları **0** yapılır ve ürün XML’e geri dönerse stok geri gelir. Bu 0, Trendyol’a bir sonraki otomatik güncellemede gider.' },
          { t: 'note', tone: 'info', x: '**Bozuk liste koruması:** XML boş geliyorsa, okunamayan satırlar varsa ya da canlı ürünlerin %10’undan fazlası (ve 25’ten fazla ürün) bir anda kayboluyorsa sistem bunu **bozuk indirme** sayar; hiçbir ürünün stoğunu sıfırlamaz ve bildirimde bunu belirtir. Böylece tedarikçinin geçici bir hatası mağazanızı satışa kapatmaz.' },
        ],
      },
      {
        id: 'xml-ek', title: 'XML Dönüştürücü ve Hazır XML Market',
        blocks: [
          { t: 'ul', x: [
            '{{/xml-converter|XML Dönüştürücü}}: Sistemin okuyamadığı bir XML biçimini otomatik dönüştürüp kaynak olarak eklemenizi sağlar (kredi harcar).',
            '{{/global-xml-market|Hazır XML Market}}: Yönetimin hazırladığı tedarikçi listelerini tek tıkla kaynak olarak eklersiniz; alan eşleştirmesi ve kategori eşleştirmesi hazır gelir, adres gizlidir. Eklemek kredi harcayabilir. Bu tedarikçilerden **Tedarikçi Siparişleri** ile sipariş de verebilirsiniz ({{#tedarikci-siparis|ayrıntı}}).',
          ] },
        ],
      },
    ],
  },
];
