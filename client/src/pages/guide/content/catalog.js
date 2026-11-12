export const CATALOG = [
  {
    id: 'urunler', icon: 'package', title: 'Ürünler',
    intro: 'Ürün listesi, fiyatlar, elle fiyat ve gönderim hazırlığı.',
    topics: [
      {
        id: 'urunler-liste', title: 'Ürünler sayfasına genel bakış',
        blocks: [
          { t: 'p', x: '{{/products|Ürünler}} sayfası önce **hangi pazaryeri** için, sonra **hangi XML kaynağı** için çalıştığınızı sorar (üstte [[Pazaryeri:]] ve [[XML:]] seçimleri, [[Değiştir]] ile değişir). Fiyatlar ve gönderim durumu seçtiğiniz pazaryerine göre gösterilir. Elle eklenen ürünler için ayrı bir seçenek vardır.' },
          { t: 'ul', x: [
            '**Arama:** ürün adı, SKU veya barkod.',
            '**Filtreler:** [[Kategori]], [[Marka]], [[Stok]] ([[Stokta var (6+)]], [[Düşük stok (1–5)]], [[Stokta yok]]), [[Durum]] ([[Aktif]] / [[Pasif]]), sıralama. Uygulanan filtreler üstte görünür, [[Hepsini temizle]] ile kaldırılır.',
            '**Pazaryeri durumu:** [[Satışta]], [[Onay bekliyor]], [[Reddedildi]], [[Kaldırıldı]] veya gönderilmemiş.',
            'Bir ürüne tıklayınca **detay paneli** açılır: XML’deki ham veriler, fiyat dökümü, pazaryeri durumları ve değişiklik geçmişi.',
          ] },
        ],
      },
      {
        id: 'urun-hazir', title: 'Ürün gönderilmeye hazır mı?',
        blocks: [
          { t: 'p', x: 'Listede her ürünün yanında **Hazır / hazır değil** göstergesi vardır (başlığın üstüne gelince “Pazaryerine gönderilmeye hazır mı?” yazar). Hazır değilse **nedenler** ürünün altında sayılır. Gönderim sayfası da aynı denetimi kullanır; hazır olmayan ürün hiçbir yoldan gönderilemez, böylece Trendyol’un reddedeceği ürünler başta elenir. Tüm nedenler ve çözümleri: {{#sorun-hazir|Sorun giderme}}.' },
        ],
      },
      {
        id: 'urun-fiyat', title: 'Elle fiyat girme',
        blocks: [
          { t: 'p', x: 'Normalde fiyatı şablon belirler. Bir ürün için farklı bir fiyat istiyorsanız fiyatın yanındaki kalem simgesine ([[Satış fiyatını elle gir]]) basıp **yeni satış fiyatını (KDV dahil)** yazarsınız.' },
          { t: 'ul', x: [
            'Pencere yazarken **net kazancınızı** (veya zararınızı) gösterir; zarar ediyorsanız “Bu fiyatta zarar ediyorum, yine de kaydet” kutusunu işaretlemeden kaydedemezsiniz.',
            'Elle girilen fiyat **kalıcıdır**: XML yenilemeleri ve otomatik güncellemeler onu bozmaz; liste, hazırlık denetimi, gönderim ve otomatik güncellemeler bu fiyatı kullanır.',
            'Pencerede [[Sadece kaydet]] ya da **Kaydet ve …** düğmesi vardır: ikincisi fiyatı kaydedip aynı anda Trendyol’a da iletir (ürün satıştaysa fiyatı günceller, hiç gönderilmemişse ürünü bu fiyatla gönderir; onay bekleyen ya da kaldırılmış ürünlerde yalnızca kaydeder).',
            'Şablona dönmek için ürünün penceresinde veya toplu çubukta [[Şablon fiyatına döndür]]’ü kullanın.',
            'Elle fiyatlı bir ürünün alış fiyatı artıp fiyatınız zarara düşerse **bildirim** alırsınız; listede de ürün zarar uyarısıyla işaretlenir.',
          ] },
          { t: 'note', tone: 'info', x: 'BuyBox’ta **otomatik fiyat** da fiyatı bu yolla (elle fiyat olarak) kaydeder; böylece şablon fiyatı geri yazmaz ({{#buybox-otomatik|ayrıntı}}).' },
        ],
      },
      {
        id: 'urun-toplu', title: 'Toplu işlemler',
        blocks: [
          { t: 'p', x: 'Satır başındaki kutularla ürünleri seçince (üstteki kutu sayfadakilerin hepsini seçer) bir çubuk açılır:' },
          { t: 'ul', x: [
            '[[Aktif yap]] / [[Pasif yap]]: ürünleri sistemde etkinleştirir veya kapatır.',
            'Seçili ürünlerin **fiyat ve stoğunu**, daha önce gönderildikleri pazaryerlerinde günceller.',
            '[[Şablon fiyatına döndür]]: elle fiyatları şablona bağlar (hiçbir şablonun kapsamadığı ürünler fiyatını korur).',
            '[[Sil]]: seçili ürünleri siler.',
          ] },
          { t: 'p', x: '[[Yeni ürün]] ile XML’de olmayan bir ürünü elle ekleyebilirsiniz; böyle ürünler için XML seçiminde “elle eklenenler” seçeneği kullanılır.' },
        ],
      },
    ],
  },
  {
    id: 'kategori', icon: 'folder', title: 'Kategori eşleştirme',
    intro: 'XML kategorilerini ve tek tek ürünleri Trendyol kategorilerine bağlama.',
    topics: [
      {
        id: 'kategori-neden', title: 'Neden gerekli?',
        blocks: [
          { t: 'p', x: 'Trendyol her ürün için kendi kategori ağacından bir **yaprak kategori** ister. Kategorisi eşleşmemiş ürün gönderilemez (“Kategori eşleşmesi yok”). Eşleştirme iki yolla yapılır ve **aynı sayfada** iki sekmedir:' },
          { t: 'table', head: ['Sekme', 'Ne zaman'], rows: [
            ['Kategori eşleştirme', 'XML kategorisi **tek bir türde ürün** içeriyorsa (ör. “Kupa Bardak”). Bir kez eşleştirirsiniz, o kategorideki tüm ürünler aynı Trendyol kategorisini alır.'],
            ['Ürün bazlı kategori', 'XML kategorisi **karışıksa** (ör. “Ev ve Yaşam” altında silikondan saklama kabına kadar yüzlerce çeşit). Her ürüne kendi Trendyol kategorisi verilir.'],
          ] },
          { t: 'note', tone: 'info', x: 'Bir ürüne **ürün bazlı** kategori verdiyseniz o, XML kategorisinin eşleştirmesinden **önce gelir**. Liste, hazırlık denetimi ve iki gönderim yolu hep aynı sonucu kullanır.' },
        ],
      },
      {
        id: 'kategori-xml', title: 'XML kategorisi eşleştirme',
        blocks: [
          { t: 'steps', x: [
            '{{/category-mapping|Kategori Eşleştirme}} sayfasını açın. Önce **XML kaynağını** seçin; kategoriler ve eşleştirmeler kaynağa özeldir (aynı adlı kategori başka kaynakta ayrıca eşleştirilir).',
            '[[Yeni Eşleştirme]] bölümünde soldan XML kategorisini, sağdaki arama kutusundan Trendyol kategorisini seçin.',
            'Trendyol bu kategori için **zorunlu özellik** istiyorsa (renk, menşei gibi) altında alanlar çıkar; doldurun.',
            '[[Eşleştirmeyi Kaydet]]. Kaydedilenler “Bu XML’in eşleştirmeleri” tablosunda listelenir, [[Sil]] ile kaldırılır.',
          ] },
          { t: 'p', x: '**Ücretsiz öneriler:** formun altındaki [[Önerilen eşleştirmeler]] kartı, eşleşmemiş her XML kategorisi için içindeki ürünlerin başlıklarından bulunan olası Trendyol kategorilerini gösterir (kelime eşleştirmesi, yapay zeka değil). Bir öneriye tıklayınca XML ve Trendyol kategorisi forma gelir; zorunlu özellikleri kontrol edip kaydedersiniz, kendiliğinden kayıt yapılmaz. Önerinin yanındaki yüzde, ürün başlıklarının kaçında o kategorinin ilk 3 öneri arasında çıktığını gösterir. “Karışık kategori” uyarısı, başlıkların farklı kategorilere işaret ettiği anlamına gelir (ör. “Ev ve Yaşam”): böyle bir kategoriyi tek bir Trendyol kategorisiyle eşleştirmek yerine [[Ürün bazlı kategori]] sekmesini kullanın. Çok az ürünü olan kategorilerde öneri zayıf olabilir.' },
          { t: 'p', x: '[[AI ile Otomatik Eşleştir]] eşleşmemiş tüm kategorileri tek seferde yapay zekayla eşleştirmeyi dener; kategori başına kredi harcar, sonucu elle düzeltebilirsiniz. Hazır XML Market’ten eklenen kaynaklarda kategori eşleştirmeleri merkezi yönetilir, sizin yapmanız gerekmez.' },
        ],
      },
      {
        id: 'kategori-urun', title: 'Ürün bazlı kategori',
        blocks: [
          { t: 'p', x: '[[Ürün bazlı kategori]] sekmesinde seçili XML kaynağının ürünleri listelenir. Üstte sayılar görünür: toplam ürün, ürüne özel kategorisi olanlar, kategori eşleştirmesiyle gidenler, **kategorisi olmayanlar**.' },
          { t: 'ul', x: [
            'Her ürünün yanında başlığına göre bulunan **3 ücretsiz öneri** çıkar; birine tıklamanız yeterlidir. Yeşil çerçeveli öneri, kategorinin tüm adının ürün başlığında geçtiği anlamına gelir.',
            'Öneri uygun değilse [[Ara…]] ile Trendyol kategori ağacında arayıp istediğinizi seçersiniz.',
            'Çok ürünü birden işlemek için kutularla seçin ya da **“Filtrelenen … ürünün hepsini seç”** düğmesiyle tümünü işaretleyin; sonra **aynı kategoriyi atayın**, **ilk öneriyi uygulayın** (ücretsiz) veya yapay zekaya bırakın.',
            'Filtreler: durum ([[Kategorisi olmayanlar]], ürüne özel olanlar, eşleştirmeyle gidenler, tümü), XML kategorisi ve ürün adı araması.',
            'Bir ürünün özel kategorisini [[Kaldır]] ile silerseniz ürün XML kategorisinin eşleştirmesine (varsa) geri döner.',
          ] },
          { t: 'note', tone: 'warn', x: 'Öneriler **kelime eşleştirmesiyle** bulunur ve her zaman doğru olmaz; özellikle çok kısa başlıklarda yanlış çıkabilir. Bu yüzden sistem hiçbir kategoriyi sormadan atamaz. [[Seçilenlere ilk öneriyi uygula (ücretsiz)]] tıklamadan önce uyarı gösterir; yanlış atamalar [[Kategorileri sıfırla]] ile geri alınır ({{#kategori-sifirla|ayrıntı}}).' },
        ],
      },
      {
        id: 'kategori-ai', title: 'Yapay zekayla ürün kategorisi',
        blocks: [
          { t: 'p', x: 'Ürünleri seçip [[Yapay zekayla eşleştir]]’e basın. Yapay zeka tüm Trendyol ağacında aramaz; ürünün başlığına göre bulunan **en iyi ~8 adayın arasından** seçer, yanıtı adaylara karşı doğrulanır. Hiçbir aday uymuyorsa “sonuç yok” der (yanlış kategori vermek yerine).' },
          { t: 'ul', x: [
            'Onay penceresi **en fazla kaç kredi** kesileceğini ve iade kuralını söyler.',
            '**Yalnızca sonuç alınan ürünler** için kredi kesilir; sonuçsuzların kredisi iade edilir. Sonuç en fazla 100’lük partiler halinde işlenir, ilerleme görünür, [[Durdur]] ile kesebilirsiniz.',
            'Yapay zeka servisi kullanılamıyorsa (ör. servis hesabında bakiye bitmişse) işlem **ilk istekte durur**, nedeni yazar ve krediniz iade edilir.',
          ] },
        ],
      },
      {
        id: 'kategori-ozellik', title: 'Zorunlu özellikler ve varsayılan cevaplar',
        blocks: [
          { t: 'p', x: 'Trendyol birçok kategoride **Renk**, **Menşei**, **Web Color**, **Materyal** gibi özellikleri zorunlu tutar. Ürün bazlı kategori sekmesinin altındaki kartta bunları yönetirsiniz.' },
          { t: 'p', x: '[[Varsayılan cevaplar]] ile her kategoride tek tek sormak yerine kurallar tanımlarsınız:' },
          { t: 'ul', x: [
            '**Özellik adı → değer** kuralı: ör. **Menşei → TR**, **Renk, Web Color → Çok Renkli** (virgülle birden fazla özellik adı yazılır).',
            '[[Yukarıdakiler dışında kalan tüm zorunlu özellikler]] için tek bir cevap: ör. **Belirtilmemiş**. Alternatif değerleri “|” ile yazarsanız sırayla denenir (ör. Belirtilmemiş | Diğer).',
            'Kuralları kaydedince ([[Kaydet ve tüm ürünlere uygula]]) seçili kategorilere uygulanır; sonradan atadığınız her kategoriye de otomatik uygulanır.',
          ] },
          { t: 'note', tone: 'warn', x: 'Bir değer yalnızca **Trendyol’un listesinde varsa** (ya da özellik serbest yazıya izin veriyorsa) kullanılır. Örneğin “Belirtilmemiş” birçok listede vardır ama hepsinde yok; Cinsiyet, Yaş Grubu, Garanti Süresi, Beden gibi özelliklerin çoğunda yoktur. Doldurulamayanlar sayfanın altındaki **“Zorunlu özellik girilmesi gereken kategoriler”** listesinde kalır; panel o özelliklerin Trendyol’daki gerçek örnek değerlerini çipler halinde gösterir, tıklayarak kural ekleyebilirsiniz.' },
          { t: 'ul', x: [
            'Elle girdiğiniz değerler hiçbir zaman otomatik değiştirilmez; otomatik yazılanlar kuralı değiştirince yenilenir.',
            'Kategorisi seçilmiş ürünlerin zorunlu özelliği eksikse ürün gönderilmez (“Zorunlu özellik eksik”). Özellikler kategoriye aittir: bir kez girin, o kategoriyi alan (ve bu değeri henüz almamış) tüm ürünlere uygulanır; ürüne göre değişenleri başlık ve açıklamadan seçtirebilirsiniz ({{#kategori-ozellik-otomatik|ayrıntı}}).',
          ] },
        ],
      },
      {
        id: 'kategori-ozellik-otomatik', title: 'Eksik özellikleri başlık ve açıklamadan seçtirme',
        blocks: [
          { t: 'p', x: 'Varsayılan cevaplar herkese aynı değeri verir. Ürüne göre değişen özellikler için (renk, cinsiyet, materyal, beden, garanti süresi…) [[Eksik zorunlu özellikleri ürün başlığı ve açıklamasından otomatik seç]] kartı her ürünün **kendi başlığına ve açıklamasına** bakar ve Trendyol’un izin verdiği değerler arasından seçer. Seçilen değer yalnızca o ürüne yazılır, kategorideki diğer ürünlere yayılmaz.' },
          { t: 'steps', x: [
            '[[Başlık ve açıklamadan seç (ücretsiz)]]: kelime eşleştirmesiyle çalışır. Değer metinde açıkça geçiyorsa seçer (ör. başlıkta “Siyah” → Renk: Siyah). Başlık bir değeri net söylüyorsa onu alır, birkaç farklı değer sayıyorsa seçmez; başlıkta yoksa açıklamaya bakar.',
            '[[Yapay zekayla tamamla]]: ücretsiz adımın dolduramadıklarını yapay zeka okur ve yine yalnızca izin verilen değerler arasından seçer. Onay penceresi en fazla kaç kredi kesileceğini söyler; yalnızca değer bulunan ürünler için kredi kesilir, sonuçsuzların kredisi iade edilir. Yapay zeka servisi kullanılamıyorsa işlem ilk istekte durur ve krediniz iade edilir.',
          ] },
          { t: 'ul', x: [
            '**Tahmin edilmez:** metinde yazmayan bir özellik boş kalır ve “Hâlâ boş” satırında adıyla listelenir; onu kategori başına elle girersiniz. Yanlış değer, ürünün Trendyol’da reddedilmesine yol açabilir.',
            'Rakam içeren değerler (ör. “5 Yıl”, “38 cm”) yalnızca özelliğin adı yanında yazıyorsa seçilir (“5 yıl garanti”, “genişlik 38 cm”); “3-6 yaş” ya da “2x38 cm” gibi aralık ve ölçülerden değer alınmaz. Menşei ve Marka gibi ürünün metninden anlaşılmayan özelliklere dokunulmaz.',
            'Varsayılan cevapla doldurulmuş bir özellik normalde değişmez. [[Varsayılan cevaplarla doldurulanları da güncelle]] kutusunu işaretlerseniz, **başlıkta** net bir değer varsa o yazılır (ör. “Çok Renkli” yerine başlıktaki “Siyah”); açıklamadan alınan değerler “Belirtilmemiş” gibi güvenli cevapların yerine yazılmaz.',
            'Bir ürüne kategori atadığınızda ücretsiz adım o ürün için kendiliğinden çalışır. Elle girdiğiniz değerler ve ürüne özel seçilen değerler, kategori için yazdığınız toplu değerle ezilmez.',
          ] },
          { t: 'note', tone: 'tip', x: 'Varsayılan cevaplar bölümüne ürüne göre değişen değerler yazmayın (ör. “Derinlik: 114 cm”, “Hacim: 6500 ml”): bu tür kurallar kategorideki tüm ürünlere aynı değeri yazar. Onları boş bırakın, bu adım her ürüne kendi metnine göre yazsın.' },
        ],
      },
      {
        id: 'kategori-sifirla', title: 'Kategorileri sıfırlama',
        blocks: [
          { t: 'p', x: 'XML kaynağını seçtiğinizde sayfada [[Kategorileri sıfırla]] düğmesi çıkar (iki sekmede de). Açılan pencere o kaynakta **tek tek atanmış kategorisi olan ürün sayısını** gösterir.' },
          { t: 'ul', x: [
            'Her zaman: bu kaynağın ürünlerine tek tek atanan **tüm kategoriler** (ve bunlara yazılan zorunlu özellik değerleri) silinir. Ürünler XML kategorisinin eşleştirmesine döner, yoksa “kategorisi olmayan” olur.',
            'İsterseniz [[Kategori eşleştirmelerini de sil]] kutusunu işaretleyerek o XML’in **kategori eşleştirmelerini** de silersiniz. Varsayılan olarak işaretsizdir.',
            'Trendyol’daki ürünlere **dokunulmaz**; yalnızca ModulPOS’taki atamalar silinir.',
          ] },
        ],
      },
    ],
  },
];
