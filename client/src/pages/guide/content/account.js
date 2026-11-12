export const ACCOUNT = [
  {
    id: 'hesap', icon: 'wallet', title: 'Hesap, plan ve kredi',
    intro: 'Abonelik, kredi bakiyesi ve profil ayarları.',
    topics: [
      {
        id: 'abonelik', title: 'Abonelik ve deneme süresi',
        blocks: [
          { t: 'p', x: 'Yeni üyelere kısa bir **deneme süresi** tanınır. Süre bittikten sonra devam etmek için {{/credits|Abonelik & Kredi}} sayfasından (menüdeki adı [[Kredi & Bakiye]]) bir plan seçersiniz. Aylık ve yıllık ödeme seçenekleri vardır; yıllık plan tanımlıysa tasarruf tutarı kartta gösterilir.' },
          { t: 'p', x: 'Aboneliğiniz bitmeden **3 gün önce** ve bittiğinde bildirim alırsınız.' },
          { t: 'live', x: 'plans' },
        ],
      },
      {
        id: 'kredi', title: 'Kredi nedir, nerede harcanır?',
        blocks: [
          { t: 'p', x: 'Abonelikten ayrı olarak bazı işlemler **kredi** harcar. Bakiyenizi ve hareket geçmişinizi {{/credits|Abonelik & Kredi}} sayfasında görürsünüz; yüklemek için [[Kredi Yükle]] düğmesini kullanın. Krediyi harcayan işlemler ve **güncel birim fiyatları** aşağıdadır:' },
          { t: 'live', x: 'credits' },
          ],
      },
      {
        id: 'kredi-kural', title: 'Kredi nasıl kesilir, ne zaman iade edilir?',
        blocks: [
          { t: 'ul', x: [
            'Bakiye yetmiyorsa işlem **başlamaz**; ekranda “yetersiz kredi” uyarısı çıkar.',
            '**Yapay zeka eşleştirmesinde** yalnızca sonuç alınan kategori/ürünler için kredi kesilir; sonuç alınamayanların kredisi **iade edilir**. Yapay zeka servisi hiç yanıt vermezse tutarın tamamı iade edilir.',
            '**BuyBox kontrolünde** her 10 barkod bir Trendyol isteğidir ve bir kez ücretlendirilir; kontrol yarıda durdurulursa yalnızca yapılan kısım için kredi kesilir.',
            'Bakiye azaldığında **düşük kredi uyarısı** bildirimi gelir.',
          ] },
        ],
      },
      {
        id: 'ayarlar', title: 'Profil ve hesap ayarları',
        blocks: [
          { t: 'p', x: 'Sağ üstteki hesap menüsünden [[Ayarlar]]’ı açın. Bölümler:' },
          { t: 'ul', x: [
            '[[Profil Bilgileri]]: ad soyad, telefon numarası. **Telefon numaranız** WhatsApp bildirimlerinin gideceği numaradır ({{#bildirim-whatsapp|ayrıntı}}).',
            '[[Mağaza Bilgileri]]: mağaza adı ve iletişim bilgileri.',
            '[[Faturalandırma & Abonelik]]: fatura bilgileri ve ödeme geçmişi.',
            '[[Güvenlik & Şifre Değiştirme]]: şifre değişikliği.',
            '[[Oturum Geçmişi]]: hesabınıza girişlerin kaydı.',
          ] },
        ],
      },
    ],
  },
  {
    id: 'baglanti', icon: 'store', title: 'Pazaryeri bağlantıları',
    intro: 'Mağazanızı ModulPOS’a bağlama ve marka ayarı.',
    topics: [
      {
        id: 'trendyol-baglanti', title: 'Trendyol mağazası nasıl bağlanır?',
        blocks: [
          { t: 'steps', x: [
            'Sol menüden {{/marketplace|Pazaryerleri}} sayfasını açın ve [[Bağlantı Ekle]]’ye basın.',
            'Pazaryeri olarak **Trendyol**’u seçin.',
            '**Satıcı ID (Seller ID)**, **API Key** ve **API Secret** alanlarını doldurun. Bu bilgileri Trendyol Satıcı Paneli’nin entegrasyon / API bilgileri bölümünden alırsınız.',
            'İsterseniz [[Tedarikçi Adı]] alanına bağlantıya bir ad verin (birden fazla mağazanız varsa ayırt etmek için).',
            '[[Marka Stratejisi]]’ni seçin ({{#marka-stratejisi|aşağıda}}), kaydedin.',
            'Kartta [[Bağlantıyı Test Et]]’e basın; durum **Bağlı** olmalıdır.',
          ] },
          { t: 'note', tone: 'info', x: 'API bilgileriniz kaydedilirken **şifrelenir** ve ekranlarda bir daha gösterilmez. Bilgileri değiştirmek için kartın [[Düzenle]] düğmesini kullanın.' },
          { t: 'p', x: 'Kartta bağlantının durumu (**Bağlı / Bağlı Değil**), pazaryerindeki ürün sayınız ve sipariş sayınız görünür. Bağlantı kurulunca sol menüdeki **Trendyol** başlığı altındaki sayfalar kullanıma girer.' },
        ],
      },
      {
        id: 'marka-stratejisi', title: 'Marka stratejisi',
        blocks: [
          { t: 'p', x: 'Trendyol her ürün için kayıtlı bir **marka** ister. İki seçeneğiniz var:' },
          { t: 'table', head: ['Seçenek', 'Ne yapar'], rows: [
            ['XML’den gelen marka', 'Tedarikçinin marka adı Trendyol’da aranır. Bulunamazsa **Yedek Marka** kullanılır.'],
            ['Kendi markam', 'XML’deki marka yok sayılır; seçtiğiniz marka **her üründe** kullanılır.'],
          ] },
          { t: 'p', x: 'Markayı, Trendyol’da kayıtlı markalar içinden arama kutusuna en az 2 harf yazarak seçersiniz (aramanın çalışması için API bilgileri girilmiş olmalıdır). Ürünün markası yoksa ve yedek/kendi marka seçilmemişse ürün “Marka yok” nedeniyle gönderilmez.' },
        ],
      },
      {
        id: 'diger-pazaryerleri', title: 'Hepsiburada, Pazarama, Çiçeksepeti ve diğerleri',
        blocks: [
          { t: 'table', head: ['Pazaryeri', 'Bağlantı bilgileri', 'Menüdeki sayfalar'], rows: [
            ['Hepsiburada', 'Merchant ID, kullanıcı adı, şifre', 'Kategori Eşleştirme · Yeni Ürün Listele · BuyBox Sırası · Stok/Fiyat Güncelle · Müşteri Soruları · Ürün Güncelle'],
            ['Pazarama', 'Client ID, Client Secret', 'Kategori Eşleştirme · Ürün Gönder / Güncelle · Siparişler'],
            ['Çiçeksepeti', 'Supplier ID, API Key', 'Ürünler & Siparişler'],
          ] },
          { t: 'p', x: 'Sol menüde bir pazaryerinin yanında **Bakımda** yazıyorsa geçici olarak kapalıdır; **Yapım Aşamasında** yazanlar (Amazon, N11, Pttavm) henüz kullanıma açık değildir. Bu pazaryerleri için ürün gönderme ve güncelleme akışı Trendyol’dakine benzer: önce kategori eşleştirilir, sonra ürünler gönderilir.' },
        ],
      },
    ],
  },
];
