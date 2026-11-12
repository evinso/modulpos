export const SELLING = [
  {
    id: 'gonderim', icon: 'send', title: 'Trendyol’a gönderim',
    intro: 'Hazır ürünleri seçme, gönderme ve sonucu izleme.',
    topics: [
      {
        id: 'gonderim-ayar', title: 'Gönderim ayarları',
        blocks: [
          { t: 'p', x: '{{/trendyol-send|Pazaryerine Gönder}} sayfasındaki [[Gönderim ayarları]] paneli, Trendyol’a **giden veriyi** şekillendirir. Sistemdeki ürünleriniz değişmez; boş bıraktığınız alanlar uygulanmaz. Her pazaryerinin ayarı ayrıdır.' },
          { t: 'table', head: ['Ayar', 'Ne yapar'], rows: [
            ['En az stok', 'Bunun altındaki stok Trendyol’a **0** olarak gönderilir (satışa kapanır).'],
            ['En fazla stok', 'Stok bu değerle sınırlanır (ör. 50 yazarsanız 200 stoklu ürün 50 gider).'],
            ['Görseli olmayan ürünleri gönderme', 'İşaretliyse görselsiz ürünler elenir.'],
            ['Başlık başına ekle / sonuna ekle', 'Her başlığa ön ek / son ek ekler (Trendyol başlığı en çok 100 karakter olduğundan uzunluğa dikkat).'],
            ['Harf düzeni', 'Olduğu gibi · BÜYÜK HARF · küçük harf · Her Kelime Büyük.'],
            ['En fazla görsel', 'Ürün başına gidecek görsel sayısını sınırlar.'],
            ['Başlık ve açıklamadan çıkarılacak kelimeler', 'Trendyol “yasaklı kelime” diyerek ürünü reddettiyse o kelimeyi (virgülle) yazın; gönderirken başlık ve açıklamadan silinir. Yalnızca **yeni gönderimler** için geçerlidir; Trendyol’da zaten olan ürünü panelinden düzeltmelisiniz.'],
          ] },
        ],
      },
      {
        id: 'gonderim-nasil', title: 'Ürünleri nasıl gönderirim?',
        blocks: [
          { t: 'steps', x: [
            '[[Pazaryerine Gönder]] sayfasını açın (başlığı “Trendyol’a Gönder”). Birden fazla Trendyol bağlantınız varsa üstten seçin.',
            '**Önce XML kaynağını seçin** ([[Önce XML kaynağını seçin]] kutusu). Sayfa seçtiğiniz kaynağın içinde çalışır: kaynak seçilmeden ürün listelenmez, durum sorgulanamaz ve gönderim yapılamaz. Kaynağı değiştirirseniz yaptığınız ürün seçimi temizlenir; böylece bir kaynağın ürünleri yanlışlıkla başka kaynakla birlikte gitmez. XML kaynağı olmayan, elle eklediğiniz ürünler için [[Elle eklenen ürünler (XML kaynağı olmayanlar)]] seçeneği vardır.',
            'Filtreleyin: Trendyol durumu ([[Gönderilmemiş]], [[Bekliyor]], [[Aktif]], [[Reddedildi]], [[Kaldırıldı]]), kategori eşleşmesi, arama.',
            'Ürünleri kutularla seçin, [[Hazırları Seç]] ile yalnızca gönderilmeye hazır olanları işaretleyin ya da filtrenin tamamı için [[Filtredeki Tümünü Seç]]’i kullanın (sayfalar arası seçer; gönderilebilir ve Trendyol’a hiç gönderilmemiş olanları seçer).',
            '[[Seçilenleri Gönder]]’e basın; seçilen kaynaktaki gönderilebilir her ürünü tek seferde göndermek için [[Tümünü Gönder]]’i kullanın. Açılan onay penceresinde [[Minimum Stok Eşiği]]’ni yazabilirsiniz: bu sayıdan **az stoklu ürünler hiç gönderilmez**. (Gönderim ayarlarındaki “En az stok” ise ürünü 0 stokla gönderir; ikisi farklıdır.)',
            'Onaylayın. Çok sayıda ürün **100’lük partiler** halinde gider; ilerleme görünür, [[Durdur]] ile yarıda kesebilirsiniz (gönderilenler geri alınmaz).',
          ] },
          { t: 'note', tone: 'tip', x: 'Gönderimden sonra çıkan özette kaç ürünün gittiği, kaçının **atlandığı** ve [[Atlanan ürünlerin nedenleri]] yazar (ör. minimum stok altında, zaten Trendyol’da, hazır değil). Hazır olmayan ürün hiçbir zaman gönderilmez.' },
        ],
      },
      {
        id: 'gonderim-sonuc', title: 'Gönderimden sonra: durumlar',
        blocks: [
          { t: 'p', x: 'Trendyol ürünleri inceler. [[Durumları Sorgula]] ile güncel durumu alırsınız:' },
          { t: 'table', head: ['Durum', 'Anlamı'], rows: [
            ['Bekliyor / Onay bekliyor', 'Trendyol incelemesi sürüyor.'],
            ['Aktif / Satışta', 'Ürün Trendyol’da yayında.'],
            ['Reddedildi', 'Trendyol reddetti; neden ürünün üzerine gelince yazar. **Düzeltmeden tekrar gönderilmez**; ürünü değiştirdiğinizde yeniden gönderilebilir hale gelir.'],
            ['Kaldırıldı', 'Ürün Trendyol’da var ama satışta değil; bunu Trendyol panelinden düzeltmeniz gerekir.'],
          ] },
          { t: 'ul', x: [
            'Barkodu **Trendyol’da zaten kayıtlı** ürünler “zaten var” sayılır, tekrar gönderilmez.',
            'Aynı barkod birden çok üründe varsa yalnızca biri gider: önce **stokta olan**, sonra **ucuz olan**, sonra **eski olan**.',
          ] },
        ],
      },
      {
        id: 'gonderim-otomatik', title: 'Satıştaki ürünler nasıl güncel kalır?',
        blocks: [
          { t: 'ul', x: [
            'Bir kaynak yenilendikten sonra, o kaynaktan **Trendyol’da satışta olan** ürünlerin fiyat ve stoğu (gönderim ayarlarınız uygulanarak) otomatik güncellenir. Kaynaktan kalkan ürün 0 stokla gider.',
            'Fiyatı şablon belirler; elle fiyat girdiğiniz ürünlerde sizin fiyatınız gider.',
            'Yeni ürünler otomatik gönderilmez; gönderimi siz yaparsınız.',
            'Ürünler sayfasında seçili ürünler için fiyat/stok güncellemesini elle de başlatabilirsiniz.',
          ] },
        ],
      },
    ],
  },
  {
    id: 'buybox', icon: 'trend', title: 'BuyBox izleme',
    intro: 'Rakiplere göre sıranızı izleyin, fiyatı otomatik ayarlayın.',
    topics: [
      {
        id: 'buybox-nedir', title: 'BuyBox nedir?',
        blocks: [
          { t: 'p', x: 'Aynı ürünü birden çok satıcı satıyorsa Trendyol “Sepete Ekle” düğmesini **BuyBox**’ı kazanan satıcıya verir. {{/buybox|BuyBox İzleme}} sayfası ürünlerinizin sırasını gösterir.' },
          { t: 'table', head: ['Sütun', 'Anlamı'], rows: [
            ['BuyBox Sırası', 'Siz kaçıncı sıradasınız (1 = kazanıyorsunuz).'],
            ['BuyBox Fiyatı', 'Trendyol’un BuyBox olarak gösterdiği fiyat.'],
            ['Bizim Fiyatımız / Fark', 'Fiyatınız ve BuyBox fiyatıyla farkı.'],
            ['Çoklu Satıcı', 'Ürünü sizden başka satıcı da satıyor mu.'],
          ] },
          { t: 'note', tone: 'warn', x: 'Ürünü yalnızca siz satıyorsanız (**Çoklu Satıcı: Hayır**) ve 1. sıradaysanız, “BuyBox Fiyatı” **bir rakibin fiyatı değildir**; kendi fiyatınızdan farklı görünebilir. Bu satırlara bakıp fiyatınızı düşürmeyin.' },
        ],
      },
      {
        id: 'buybox-kontrol', title: 'Kontrol etmek',
        blocks: [
          { t: 'ul', x: [
            '[[Tümünü kontrol et]]: tüm ürünlerinizi sorgular. Çok ürün varsa 200’lük parçalar halinde ilerler, ilerleme görünür, [[Durdur]] ile kesebilirsiniz. İsterseniz [[20 ürün kontrol et]], [[50 ürün kontrol et]] ya da [[100 ürün kontrol et]] ile bir kısmını sorgularsınız (en eski kontrol edilenlerden başlar).',
            'Her **10 barkod** bir Trendyol isteğidir ve kredi harcar; ekranda tahmini maliyet yazar.',
            'Ürün araması ile listede istediğiniz ürünü bulursunuz. Listeyi [[BuyBox Sırasına Göre]], [[Fiyat Farkına Göre]] ya da [[En Eski Kontrol]]e göre sıralayabilirsiniz.',
          ] },
        ],
      },
      {
        id: 'buybox-otomatik', title: 'Otomatik fiyat',
        blocks: [
          { t: 'p', x: '[[Otomatik Fiyat Ayarı]] bölümünde [[Otomatik Mod]]’u açarsanız her kontrolden sonra, **1. sırada olmadığınız** ürünlerin fiyatı ayarlanır. [[Fiyat Modu]]:' },
          { t: 'ul', x: [
            '[[BuyBox fiyatına eşit ol]]: fiyatınız BuyBox fiyatına çekilir.',
            '[[BuyBox fiyatının altına in]]: BuyBox fiyatının [[Ne kadar altına in? (₺)]] kadar altına iner.',
          ] },
          { t: 'ul', x: [
            'Fiyatınız **zaten daha düşük veya eşitse** dokunulmaz (fiyat sarmalı oluşmasın diye 1. sıradaki ürünlere hiç işlem yapılmaz).',
            'Yeni fiyat şablondaki giderlerle **zarara düşüyorsa** o ürün atlanır.',
            'Yeni fiyat **elle fiyat** olarak kaydedilir, yani şablon onu bir sonraki güncellemede geri yazmaz; Trendyol’a da gönderilir. Ürün başına kredi harcar; güncellenemezse kredi iade edilir.',
            'Ürünün elle fiyatını kaldırmak için Ürünler sayfasında [[Şablon fiyatına döndür]]’ü kullanın.',
          ] },
        ],
      },
      {
        id: 'buybox-kayit', title: 'Otomatik fiyat kayıtları',
        blocks: [
          { t: 'p', x: '[[Otomatik Fiyat Kayıtları]] sekmesi, otomatik fiyatın ne zaman çalıştığını, kaç ürünün fiyatının değiştiğini (eski → yeni fiyatlarıyla), kaç ürünün neden atlandığını (zaten daha ucuz, zarara düşer) ve ayarda yaptığınız değişiklikleri not eder. Kayıtlar yaklaşık 6 ay saklanır; [[Kayıtları Temizle]] ile silebilirsiniz.' },
        ],
      },
    ],
  },
  {
    id: 'sorular', icon: 'message', title: 'Müşteri soruları',
    intro: 'Trendyol’dan gelen ürün sorularını yanıtlama.',
    topics: [
      {
        id: 'soru-yanit', title: 'Soruları görüntüleme ve yanıtlama',
        blocks: [
          { t: 'ul', x: [
            '{{/questions|Müşteri Soruları}} sayfasında sorular Trendyol’dan yaklaşık her 30 dakikada gelir; hemen almak için [[Trendyol\'dan Çek]]’e basın.',
            'Üstte sayılar: toplam, [[Bekleyen]] ve [[Yanıtlanan]]. Yeni soru gelince bildirim alırsınız.',
            'Bir soruyu açın ([[Soruyu Yanıtla]]), yanıtınızı yazın ve gönderin; yanıt doğrudan Trendyol’a iletilir.',
            'Yönetim, sık sorulan sorular için **otomatik yanıt kuralları** tanımlamış olabilir; otomatik verilen her yanıt kredi harcar.',
          ] },
        ],
      },
    ],
  },
];
