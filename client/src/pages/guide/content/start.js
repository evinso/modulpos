// Rehber içeriği. Biçim:  **kalın**   [[Ekrandaki düğme / menü / sekme adı]]   {{/yol|Bağlantı}}   {{#konu-no|Rehberde ilgili konu}}
// [[...]] içindeki her ad uygulamada gerçekten geçmek zorundadır (test/guide.test.mjs bunu denetler).

export const START = [
  {
    id: 'baslangic', icon: 'rocket', title: 'Hızlı başlangıç',
    intro: 'Hesap açıldıktan sonra ilk ürününüzü satışa çıkarmak için izleyeceğiniz yol.',
    topics: [
      {
        id: 'ne-yapar', title: 'ModulPOS ne yapar?',
        blocks: [
          { t: 'p', x: 'ModulPOS, tedarikçinizin **XML ürün listesini** okur, ürünleri **fiyat şablonunuza** göre fiyatlandırır, kategorilerini eşleştirir ve hazır olanları **Trendyol**’a gönderir. Sonrasında fiyat ve stok kendiliğinden güncel kalır; siparişleriniz, müşteri sorularınız ve kârınız aynı yerden izlenir.' },
          { t: 'ul', x: [
            'Tedarikçi ürünleri otomatik çekilir ve düzenli aralıklarla yenilenir.',
            'Her ürünün satış fiyatı tek bir hesap motorundan çıkar; liste, gönderim ve otomatik güncellemeler aynı sayıyı kullanır.',
            'Trendyol’a gitmeye hazır olmayan ürünün **nedeni** ürün listesinde yazar; hatalı ürün gönderilmez.',
            'Siparişlerde komisyon, kargo, KDV ve stopaj dahil **gerçek net kâr** hesaplanır.',
          ] },
          { t: 'note', tone: 'info', x: 'Rehberdeki ayrıntılı anlatım en çok **Trendyol** için hazırlanmıştır; Hepsiburada, Pazarama ve Çiçeksepeti için kendi menüleri vardır ({{#diger-pazaryerleri|ayrıntı}}).' },
        ],
      },
      {
        id: 'yedi-adim', title: 'Kurulum: 7 adım',
        blocks: [
          { t: 'steps', x: [
            '**Pazaryerini bağlayın.** {{/marketplace|Pazaryerleri}} sayfasında [[Bağlantı Ekle]]’ye basın, Trendyol bilgilerinizi girin ve [[Bağlantıyı Test Et]] ile doğrulayın. ({{#trendyol-baglanti|ayrıntı}})',
            '**XML kaynağınızı ekleyin.** {{/xml-sources|XML Kaynakları}} sayfasında [[XML Kaynağı Ekle]]; adres, alan eşleştirme ve KDV ayarlarını yapın, sonunda [[Ürünleri Çek]]’e basın. ({{#xml-ekleme|ayrıntı}})',
            '**Fiyat şablonu oluşturun.** {{/pricing|Fiyat Şablonları}} sayfasında [[Şablon Ekle]]; giderlerinizi, vergi durumunuzu ve kârınızı girin. Şablon yoksa ürünler gönderilemez. ({{#sablon-nasil|ayrıntı}})',
            '**Kategorileri eşleştirin.** {{/category-mapping|Kategori Eşleştirme}} sayfasında XML kategorilerinizi Trendyol kategorilerine bağlayın; karışık kategoriler için **ürün bazlı** kategori vardır. ({{#kategori-neden|ayrıntı}})',
            '**Ürünleri kontrol edin.** {{/products|Ürünler}} sayfasında pazaryerini ve XML kaynağını seçin; her ürünün fiyatını ve gönderilmeye hazır olup olmadığını görürsünüz. ({{#urunler-liste|ayrıntı}})',
            '**Trendyol’a gönderin.** [[Pazaryerine Gönder]] sayfasında (sayfa başlığı “Trendyol’a Gönder”) önce XML kaynağını seçin, sonra ürünleri seçip [[Seçilenleri Gönder]]’e basın. ({{#gonderim-nasil|ayrıntı}})',
            '**İzleyin.** {{/orders|Siparişler}} ve kârlılık, [[BuyBox İzleme]], [[Müşteri Soruları]] sayfalarını kullanın.',
          ] },
          { t: 'note', tone: 'tip', x: 'Takıldığınız yerde ürün listesindeki **“hazır değil” nedenine** bakın; çoğu sorun orada adıyla yazar ({{#sorun-hazir|nedenler tablosu}}).' },
        ],
      },
      {
        id: 'urun-yolu', title: 'Bir ürünün yolu',
        blocks: [
          { t: 'table', head: ['Aşama', 'Nerede', 'Ne olur'], rows: [
            ['1. Çekme', 'XML Kaynakları', 'Ürün tedarikçi listesinden gelir; alış fiyatı, stok, görsel ve kategori XML’den alınır.'],
            ['2. Fiyatlama', 'Fiyat Şablonları', 'Alış fiyatından satış fiyatı hesaplanır (giderler, vergiler ve kârınız dahil).'],
            ['3. Kategori', 'Kategori Eşleştirme', 'Ürün bir Trendyol kategorisine bağlanır; zorunlu özellikler (renk, menşei…) doldurulur.'],
            ['4. Doğrulama', 'Ürünler', 'Barkod, başlık, görsel, fiyat, marka gibi kurallar denetlenir; eksik varsa nedeni yazılır.'],
            ['5. Gönderim', 'Pazaryerine Gönder', 'Hazır ürünler 100’erli partiler halinde Trendyol’a iletilir.'],
            ['6. Güncel kalma', 'Otomatik', 'Her XML yenilemesinden sonra satıştaki ürünlerin fiyat ve stoğu Trendyol’da güncellenir.'],
          ] },
          { t: 'note', tone: 'warn', x: 'XML’e **sonradan eklenen yeni ürünler Trendyol’a kendiliğinden gönderilmez**; yalnızca zaten satışta olan ürünlerin fiyat/stoğu otomatik güncellenir. Yeni ürünleri [[Pazaryerine Gönder]] sayfasından siz gönderirsiniz.' },
        ],
      },
      {
        id: 'otomatik', title: 'Kendiliğinden olan işler',
        blocks: [
          { t: 'table', head: ['İş', 'Ne zaman'], rows: [
            ['Yeni siparişleri Trendyol’dan çekme', 'Yaklaşık her 5 dakikada'],
            ['XML kaynaklarını kontrol etme ve yenileme', 'Her 10 dakikada bir bakılır; kaynağın kendi aralığı (en az 5 dk) dolunca yenilenir'],
            ['Satıştaki ürünlerin fiyat ve stoğunu Trendyol’da güncelleme', 'Her XML yenilemesinden sonra'],
            ['Müşteri sorularını çekme (ve varsa otomatik yanıt)', 'Yaklaşık her 30 dakikada'],
            ['Gerçek komisyon ve kargo bilgisini Trendyol’dan okuma', 'Her gece 04:40 (isterseniz Kârlılık sekmesinden elle de alırsınız)'],
            ['Abonelik bitiş uyarıları', 'Her 6 saatte bir kontrol edilir'],
          ] },
          { t: 'p', x: 'Bu işlerin sonuçlarını {{/logs|İşlem Logları}} sayfasından ve sağ üstteki **zil** (bildirimler) simgesinden izleyebilirsiniz.' },
        ],
      },
    ],
  },
];
