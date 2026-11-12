export const HELP = [
  {
    id: 'takip', icon: 'activity', title: 'Bildirim, log ve destek',
    intro: 'Neler olduğunu takip etme ve yardım alma.',
    topics: [
      {
        id: 'bildirim', title: 'Bildirimler',
        blocks: [
          { t: 'p', x: 'Sağ üstteki **zil** simgesi önemli olayları listeler: XML güncellemeleri, gönderim sonuçları, yeni sipariş ve sorular, BuyBox fiyat değişiklikleri, elle fiyatlı ürünün zarara düşmesi, abonelik ve kredi uyarıları, yönetici duyuruları. Bir bildirime tıklayınca ayrıntısı açılır.' },
        ],
      },
      {
        id: 'bildirim-whatsapp', title: 'WhatsApp bildirimleri',
        blocks: [
          { t: 'p', x: 'Aynı bildirimlerin önemli olanları **WhatsApp’tan** da gelir. Mesajlar [[Ayarlar]] → [[Profil Bilgileri]]’ndeki **telefon numaranıza** gider (05XX biçiminde yazabilirsiniz; sistem tamamlar). Hangi olayların WhatsApp’a gideceğini yönetim belirler; sizin ayrıca bir şey kurmanız gerekmez.' },
          { t: 'ul', x: [
            'Örnekler: yeni sipariş ve sipariş durumu, yeni müşteri sorusu, ürün gönderim sonucu, XML güncellendi / uzun süredir güncellenemiyor, elle fiyatlı ürün zarara düştü, BuyBox, abonelik bitiyor, kredi azaldı, destek talebi yanıtlandı.',
            'Numaranızı değiştirmezseniz veya boş bırakırsanız WhatsApp mesajı gelmez; zil bildirimleri yine çalışır.',
          ] },
        ],
      },
      {
        id: 'loglar', title: 'İşlem Logları',
        blocks: [
          { t: 'p', x: '{{/logs|İşlem Logları}} sayfasında iki sekme vardır: [[İşlem Logları]] (XML yenilemeleri, gönderimler, fiyat güncellemeleri gibi sistem işlemleri; işlem tipi, durum ve zaman) ve [[Trendyol API Logları]] (Trendyol’a giden istekler, uç nokta ve yanıt durumu). Bir işlem başarısız olduğunda önce buraya bakın; hata mesajı genellikle nedenini (eksik alan, hatalı API anahtarı, kategori sorunu) söyler. Eski kayıtlar belirli bir süre sonra otomatik temizlenir.' },
        ],
      },
      {
        id: 'destek', title: 'Destek talebi',
        blocks: [
          { t: 'steps', x: [
            'Sol menüden {{/support|Destek}} sayfasını açın ([[Destek Biletleri]]).',
            'Yeni talepte [[Konu]], kategori ve [[Öncelik]] seçin, [[Mesajınız]]’ı yazın; mümkünse hatalı ürünün barkodunu ve log mesajını ekleyin.',
            'Gönderdikten sonra yanıtlar aynı talepte görünür; durum değişince ve yanıt gelince bildirim alırsınız.',
          ] },
        ],
      },
    ],
  },
  {
    id: 'sorun', icon: 'help', title: 'Sorun giderme',
    intro: 'En sık karşılaşılan durumlar ve çözümleri.',
    topics: [
      {
        id: 'sorun-hazir', title: 'Ürün neden “hazır değil”?',
        blocks: [
          { t: 'p', x: 'Ürünler ve gönderim sayfalarında bir ürünün altında yazan nedenler ve çözümleri aşağıdadır (liste uygulamadaki gerçek ifadelerle üretilir):' },
          { t: 'live', x: 'issues' },
        ],
      },
      {
        id: 'sorun-sss', title: 'Sık sorulan sorular',
        blocks: [
          { t: 'qa', x: [
            ['Ürünleri gönderdim ama Trendyol’a hiçbiri gitmedi.', 'Gönderim özetindeki **Atlanan ürünlerin nedenleri**ne bakın. En sık neden [[Minimum Stok Eşiği]]’dir: bu sayıdan az stoklu ürünler hiç gönderilmez. Ardından “hazır değil” nedenlerini (kategori, fiyat şablonu, marka, zorunlu özellik) kontrol edin.'],
            ['Yeni eklenen XML ürünleri Trendyol’da görünmüyor.', 'Yeni ürünler otomatik gönderilmez. [[Pazaryerine Gönder]] sayfasında [[Gönderilmemiş]] filtresiyle seçip gönderin.'],
            ['Fiyatlar neden bu kadar yüksek/düşük çıkıyor?', 'Fiyatı yalnızca şablon belirler. Şablondaki kargo, komisyon, hizmet bedeli, kâr ve vergi ayarlarına ({{#sablon-vergi|Vergi}}) bakın; sağdaki panelde “Tek bir fiyatla dene” ile sonucu görürsünüz. “KDV mükellefiyim” kapalıysa fiyat gereğinden yüksek çıkar.'],
            ['Bir ürünün fiyatını elle değiştirdim, XML yenilenince geri döndü mü?', 'Hayır; elle fiyat kalıcıdır. Geri dönmesini istiyorsanız [[Şablon fiyatına döndür]]’ü kullanın.'],
            ['Kârlılıkta kargo neden “~” ile görünüyor?', 'Trendyol kargo faturası siparişten yaklaşık 3 hafta sonra kesilir. O zamana kadar tahmini tutar gösterilir; Sipariş Kayıtları’nda gördüğünüz tutarı satırı açıp [[Kargo tutarı]] kutusuna yazabilirsiniz.'],
            ['Komisyon “Trendyol’dan” yazıyor ama panelimdekinden farklı görünüyor.', 'Kesin komisyon, Trendyol ekstresindeki Satış satırından İndirim ve Kupon satırları düşülerek bulunur. [[Trendyol\'dan kesin verileri al]]’a basarak güncelleyin.'],
            ['Yapay zeka eşleştirme çalışmıyor.', 'Hata mesajı nedenini yazar. Yapay zeka servisi geçici kullanılamıyorsa işlem durur ve krediniz iade edilir; sürerse Destek’ten yazın. Kategori için kelime eşleştirmeli ücretsiz önerileri ve elle seçimi her zaman kullanabilirsiniz.'],
            ['XML’deki ürün sayısı birden düştü.', 'Kaynaktan kalkan ürünlerin stoğu 0 yapılır, ürünler silinmez. Liste bozuk görünüyorsa sistem hiçbir şeyi sıfırlamaz ve bunu bildirimde söyler ({{#xml-senkron|ayrıntı}}).'],
            ['Giriş yapamıyorum / oturumum düşüyor.', 'Tarayıcı çerezlerinin açık olduğundan emin olun. Şifrenizi [[Güvenlik & Şifre Değiştirme]]’den değiştirebilirsiniz. Sorun sürerse Destek’e yazın.'],
          ] },
        ],
      },
    ],
  },
  {
    id: 'sozluk', icon: 'book', title: 'Sözlük',
    intro: 'Rehberde geçen terimler.',
    topics: [
      {
        id: 'sozluk-liste', title: 'Terimler',
        blocks: [
          { t: 'table', head: ['Terim', 'Anlamı'], rows: [
            ['Alış fiyatı', 'Tedarikçiden ürünü kaç liraya aldığınız (sistemde KDV dahil tutulur).'],
            ['Barem', 'Kargo ücretinin sipariş tutarına göre basamaklı olması.'],
            ['BuyBox', 'Aynı ürünü satan satıcılar arasında “Sepete Ekle”yi kazanma sırası.'],
            ['Desi', 'Paketin hacimsel ağırlığı; kargo ücreti buna göre belirlenir.'],
            ['Elle fiyat', 'Şablon yerine sizin yazdığınız kalıcı satış fiyatı.'],
            ['Hakediş', 'Satış bedelinden komisyon ve kesintiler düşüldükten sonra Trendyol’un size ödediği tutar.'],
            ['Hazır', 'Ürünün tüm gönderim kurallarını geçtiği durum.'],
            ['Hizmet bedeli', 'Pazaryerinin sipariş başına aldığı sabit ücret (Trendyol’da şu an genellikle KDV dahil 13,19 ₺).'],
            ['Kaynak', 'Bir XML adresi ve ona ait ayarlar.'],
            ['Komisyon', 'Pazaryerinin satış fiyatından aldığı pay (KDV dahil fiyat üzerinden).'],
            ['Ödenecek KDV', 'Satıştan doğan KDV’den giderlerinizdeki KDV’nin düşülmesiyle bulunan, devlete ödeyeceğiniz tutar.'],
            ['Senkron', 'XML’in okunup ürünlerin güncellenmesi.'],
            ['Stopaj', 'E-ticaret satışlarında KDV hariç tutar üzerinden kesilen %1’lik peşin vergi.'],
            ['Şablon', 'Alış fiyatından satış fiyatını hesaplayan kurallar bütünü.'],
            ['Yaprak kategori', 'Altında başka kategori bulunmayan, ürün koyulabilen Trendyol kategorisi.'],
          ] },
        ],
      },
    ],
  },
];
