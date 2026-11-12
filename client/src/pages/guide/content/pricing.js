export const PRICING = [
  {
    id: 'fiyat', icon: 'tags', title: 'Fiyat şablonları',
    intro: 'Alış fiyatından satış fiyatını ve net kârı hesaplayan tek motor.',
    topics: [
      {
        id: 'sablon-nasil', title: 'Fiyat şablonu nasıl çalışır?',
        blocks: [
          { t: 'p', x: 'Şablon, “şu giderlerim var, şu kadar **net kâr** istiyorum” demenizin yoludur. ModulPOS her ürünün alış fiyatından, bu kâr ve giderleri karşılayacak **satış fiyatını** hesaplar. Şablon olmadan ürün fiyatlanamaz ve gönderilemez.' },
          { t: 'p', x: 'Hesabı yapan tek bir motor vardır: ürün listesi, Trendyol’a gönderim ve otomatik güncellemeler hep **aynı fiyatı** kullanır. Şablonu değiştirdiğinizde fiyatlar bir sonraki yenilemede/güncellemede yeni hesaba göre çıkar.' },
          { t: 'steps', x: [
            '{{/pricing|Fiyat Şablonları}} sayfasında [[Şablon Ekle]]’ye basın.',
            'Şablon türünü, adını ve **nereye uygulanacağını** (pazaryeri, XML kaynağı) seçin.',
            'Giderlerinizi, vergi durumunuzu ve kârınızı girin.',
            'Sağdaki panelde **tüm ürünlerinizde** toplam kazancı, ortalama marjı ve zarar eden ürünleri anında görün; memnun kalınca [[Kaydet]].',
          ] },
        ],
      },
      {
        id: 'sablon-turleri', title: 'Tek kâr ve kademeli kâr',
        blocks: [
          { t: 'table', head: ['Tür', 'Ne zaman kullanılır'], rows: [
            ['Tek kâr', 'Tüm ürünlerde aynı kâr: alış fiyatının yüzdesi (**Yüzde (%)**) ya da ürün başına sabit tutar (**Tutar (₺)**).'],
            ['Kademeli kâr', 'Alış fiyatına göre farklı kâr: “100 ₺’ye kadar %40, 300 ₺’ye kadar %30, üstü %20” gibi. İstediğiniz kadar satır ekleyebilirsiniz; son satır “Üstü”dür.'],
          ] },
          { t: 'note', tone: 'tip', x: 'Ucuz ürünlerde yüzde kârı yüksek, pahalılarda düşük tutmak (kademeli kâr) fiyatları dengeli çıkarır. Sağdaki tablo, her fiyat bandında kaç ürün olduğunu ve ortalama kârı gösterir.' },
        ],
      },
      {
        id: 'sablon-maliyet', title: 'Maliyetlerim',
        blocks: [
          { t: 'table', head: ['Alan', 'Ne yazılır'], rows: [
            ['Kargo (₺, KDV dahil)', 'Sipariş başına ödediğiniz kargo (faturadaki KDV dahil tutar).'],
            ['Komisyon (%)', 'Pazaryerinin komisyonu. **KDV dahil satış fiyatı** üzerinden alınır (Trendyol böyle keser).'],
            ['Hizmet bedeli (₺, KDV dahil)', 'Pazaryerinin sipariş başına sabit ücreti (şu an genellikle 13,19 ₺, KDV dahil; Trendyol faturanızdaki tutarı yazın).'],
            ['Diğer gider (₺)', 'Paketleme, etiket vb. sipariş başı sabit giderler.'],
          ] },
          { t: 'note', tone: 'info', x: 'Satış fiyatı bu giderleri ve kârınızı karşılayacak şekilde hesaplanır. Bu yüzden ucuz ürünlerde bile fiyat, ürünün kendisinden çok daha yüksek çıkabilir: kargo ve komisyon sabit yük getirir.' },
        ],
      },
      {
        id: 'sablon-vergi', title: 'Vergi: KDV mükellefiyim ve stopaj',
        blocks: [
          { t: 'p', x: 'Şablonun **Vergi** bölümü kârınızı gerçeğe yaklaştırır. Üç ayar vardır:' },
          { t: 'ul', x: [
            '[[KDV mükellefiyim]]: Açıkken alış fiyatındaki, kargodaki, komisyondaki, hizmet bedelindeki ve diğer giderlerdeki **KDV, satıştan doğan KDV’den düşülür** (“Ödenecek KDV”). Kapalıyken bu KDV’ler saf gider sayılır; yani kâr olduğundan düşük hesaplanır ve satış fiyatı gereğinden yüksek çıkar.',
            '[[Alış fiyatındaki KDV (%)]]: Alış fiyatınızın içindeki KDV oranı (varsayılan %20). Faturasız/KDV’siz alışta 0 yazın.',
            '[[Stopaj (%)]]: E-ticaret stopajı; **KDV hariç** satış fiyatı üzerinden kesilir (%1). Gerçek bir nakit çıkışı olduğu için kârdan düşülür.',
          ] },
          { t: 'p', x: '**Formül:** Net kâr = satış fiyatı − komisyon − hizmet bedeli − diğer gider − kargo − alış maliyeti − stopaj − ödenecek KDV.' },
          { t: 'p', x: 'Ödenecek KDV = satıştan doğan KDV − (alıştan + kargodan + komisyondan + hizmet bedelinden + diğer giderlerden doğan KDV). Gider KDV’leri %20 kabul edilir.' },
          { t: 'note', tone: 'warn', x: 'Yeni oluşturduğunuz şablonlarda bu ayarlar **varsayılan olarak açıktır**. Daha önce kaydedilmiş şablonlar eski hesapla çalışmaya devam eder; ayarları açarsanız aynı kâr için **satış fiyatları düşer** ve bir sonraki otomatik güncellemede Trendyol’a yansır. Pencerede eski hesapla çalışan şablonlar için turuncu bir not görünür.' },
        ],
      },
      {
        id: 'sablon-ornek', title: 'Örnek hesap',
        blocks: [
          { t: 'p', x: 'KDV %20 olan bir ürün; alış 195 ₺ (KDV dahil), kargo 106 ₺, komisyon %22, hizmet bedeli 13,19 ₺, stopaj %1. **Satış fiyatı 586,90 ₺** olduğunda:' },
          { t: 'table', head: ['Kalem', 'Tutar'], rows: [
            ['Satış fiyatı', '586,90 ₺'],
            ['Komisyon (%22)', '− 129,12 ₺'],
            ['Hizmet bedeli', '− 13,19 ₺'],
            ['Stopaj (%1, KDV hariç fiyattan)', '− 4,89 ₺'],
            ['Ödenecek KDV', '− 23,93 ₺'],
            ['Kargo', '− 106,00 ₺'],
            ['Alış maliyeti', '− 195,00 ₺'],
            ['Net kâr', '114,77 ₺'],
          ] },
          { t: 'table', head: ['KDV dökümü', 'Tutar'], rows: [
            ['Satıştan oluşan KDV', '97,82 ₺'],
            ['Alıştan oluşan KDV', '32,50 ₺'],
            ['Kargodan oluşan KDV', '17,67 ₺'],
            ['Komisyondan oluşan KDV', '21,52 ₺'],
            ['Hizmet bedelinden oluşan KDV', '2,20 ₺'],
            ['Ödenecek KDV', '23,93 ₺'],
          ] },
          { t: 'p', x: 'Aynı döküm; şablondaki **Hesabı göster**, ürün detay panelinde ve fiyat penceresinde de görünür.' },
        ],
      },
      {
        id: 'sablon-kapsam', title: 'Şablon hangi ürüne uygulanır? (öncelik)',
        blocks: [
          { t: 'ul', x: [
            'Şablonun **Pazaryeri** ve **XML kaynağı** seçimi kapsamını belirler. “Hepsi” seçersiniz tüm pazaryerlerine/kaynaklara uygulanır.',
            'Birden fazla şablon bir ürüne uyuyorsa sırayla bakılır: önce **öncelik**, sonra **daha özel kapsam** (pazaryeri + kaynak belirtilmiş olan), eşitse **önce oluşturulan** kazanır.',
            'Şablon listesindeki anahtarla bir şablonu **açıp kapatabilirsiniz**. İki şablonu birbirinin yerine geçirirken önce yenisini açıp sonra eskisini kapatın; aksi halde bir an için şablonsuz ürünler kalabilir.',
            'Listede her şablon için uygulandığı **ürün sayısı, net marj ve toplam kazanç** görünür; zarar eden ürün varsa uyarı çıkar.',
          ] },
        ],
      },
      {
        id: 'sablon-deneme', title: 'Denemek ve doğrulamak',
        blocks: [
          { t: 'ul', x: [
            'Sağ paneldeki [[Tek bir fiyatla dene]] ile bir alış fiyatı yazıp o ürünün satış fiyatını ve net kazancını görürsünüz.',
            'Panel, şablonu **gerçek ürünlerinizin tamamında** çalıştırır: kaç ürüne uygulanır, toplam kazanç, ortalama fiyat, fiyat bandı başına sonuçlar ve en çok zarar eden ürünler.',
            '[[Fiyat sonu]] ile fiyatın sonunu .90, .99 ya da tam sayı yapabilirsiniz (ör. 129,90).',
          ] },
        ],
      },
      {
        id: 'sablon-eski', title: 'Eski tip şablonlar',
        blocks: [
          { t: 'p', x: 'Eskiden oluşturulmuş bazı kurallar (sipariş tutarına göre kademeli kargo, net marj, kategori/marka filtresi gibi) artık ekranda düzenlenemez, ama çalışmaya devam eder. Böyle bir şablonu düzenleyip kaydederseniz bu ayarlar **kaldırılır** ve fiyatlar değişebilir; pencerede bunu söyleyen bir uyarı ve sağda yeni halin sonucu görünür.' },
        ],
      },
    ],
  },
];
