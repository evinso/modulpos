export const MONEY = [
  {
    id: 'siparis', icon: 'cart', title: 'Siparişler ve kârlılık',
    intro: 'Siparişleri izleme, gerçek net kârı görme.',
    topics: [
      {
        id: 'siparis-liste', title: 'Siparişler',
        blocks: [
          { t: 'p', x: '{{/orders|Siparişler}} sayfasının iki sekmesi vardır: [[Siparişler]] (tüm pazaryerlerinden gelen siparişler) ve [[Kârlılık (Trendyol)]]. Siparişler Trendyol’dan yaklaşık her 5 dakikada otomatik çekilir; hemen almak için [[Siparişleri Çek]]’e basın. Sipariş durumları (yeni, hazırlanıyor, kargoda, teslim edildi, iptal, iade) pazaryerinden güncellenir; satıra tıklayınca müşteri, ürün kalemleri ve kargo bilgisi açılır.' },
          { t: 'p', x: 'Yeni sipariş ve durum değişikliklerinde bildirim alırsınız (telefon numaranız tanımlıysa ve yönetim bu olayı açtıysa WhatsApp’tan da).' },
        ],
      },
      {
        id: 'tedarikci-siparis', title: 'Tedarikçi Siparişleri',
        blocks: [
          { t: 'p', x: '{{/dropship-orders|Tedarikçi Siparişleri}} sayfası, [[Hazır XML Market]]’teki tedarikçilerden **sizin adınıza sipariş vermek** (dropship) içindir. Ürünü aratıp seçer, müşteri adı/telefon/adresini ve Trendyol kampanya / kargo kodunu girersiniz. Tedarikçinin tanımladığı bir **sipariş ücreti** (kredi) varsa kayıt öncesi gösterilir; bakiyeniz yetmiyorsa uyarı çıkar. Kargo firması, takip numarası ve tedarikçi sipariş numarası sonradan eklenir; durum ilerledikçe bildirim gelir.' },
        ],
      },
      {
        id: 'karlilik-nedir', title: 'Kârlılık sekmesi: ne gösterir?',
        blocks: [
          { t: 'p', x: 'Trendyol satışlarınız için, sipariş başına: **satış fiyatı**, indirimli satış, müşterinin ödediği, komisyon, hizmet bedeli, (varsa) tedarikçi hizmet bedeli, stopaj, ödenecek KDV, kargo, alış maliyeti ve **net kâr**. Üstteki kartlar seçili aralığın toplamlarını verir; tarih aralığı, durum ve sipariş no/müşteri araması ile daraltırsınız. İptal ve iade siparişler toplamlara katılmaz.' },
          { t: 'p', x: '**Net kâr** = indirimli satış − komisyon − hizmet bedeli − tedarikçi hizmet bedeli − kargo − alış maliyeti − stopaj − ödenecek KDV. Hesap, {{#sablon-vergi|fiyat şablonundaki vergi modeliyle}} aynıdır ve satırı açınca adım adım görürsünüz, **KDV dökümüyle** birlikte.' },
          { t: 'note', tone: 'info', x: 'Trendyol’un kendi indirimleri (örn. Trendyol kupon/indirim katkısı) size ödenir; müşteri daha az ödese de gelirinizden düşmez. Satıcı indirimi ve kuponlar ise gelirinizden düşer ve komisyon bu indirimli fiyat üzerinden hesaplanır.' },
        ],
      },
      {
        id: 'karlilik-kesin', title: 'Kesin ve tahmini rakamlar',
        blocks: [
          { t: 'p', x: 'Başında **~** olan tutarlar **tahmindir**; Trendyol henüz kesinleştirmemiştir. Rakamlar şöyle kesinleşir:' },
          { t: 'table', head: ['Kalem', 'Kesinleşme', 'O zamana kadar'], rows: [
            ['Komisyon', 'Teslimattan birkaç gün sonra Trendyol hesap ekstresine düşünce. Kesin komisyon = Satış satırı − İndirim − Kupon (komisyon indirimli fiyat üzerinden alınır).', 'Ürünün komisyon oranı × indirimli satış.'],
            ['Kargo', 'Trendyol’un **kargo faturası** kesilince (siparişten yaklaşık **3 hafta** sonra).', 'Faturası gelmiş siparişlerin ortalaması ya da [[Tahmini kargo (₺ / sipariş)]] ayarı; ya da sizin elle girdiğiniz tutar.'],
            ['Hizmet bedeli', 'Dönemsel faturayla gelir; sipariş bazında okunamaz.', 'Her zaman ayarınızdaki tutar (varsayılan 13,19 ₺).'],
            ['Stopaj', 'Hesap ekstresindeki “Stopaj” kayıtlarıyla doğrulanmıştır (KDV hariç satışın %1’i).', 'Ayardaki oran.'],
          ] },
          { t: 'ul', x: [
            '[[Trendyol\'dan kesin verileri al]] teslim edilmiş siparişlerin gerçek komisyon ve kargosunu okur; ayrıca **her gece 04:40**’ta kendiliğinden okunur.',
            'Bir siparişte kargo ücretini Trendyol Satıcı Paneli’nde (**Finans → Sipariş Kayıtları**) görüyorsanız, satırı açınca çıkan [[Kargo tutarı]] kutusuna yazın ve **KDV dahil / KDV hariç** seçin. Trendyol’un kargo faturası gelince gerçek tutar sizinkinin **yerine geçer**; isterseniz [[Kaldır]] ile siler, tahmine dönersiniz. (Bu bilgi Trendyol’un herkese açık veri arayüzünde olmadığı için otomatik okunamıyor.)',
          ] },
        ],
      },
      {
        id: 'karlilik-maliyet', title: 'Alış maliyeti ve tedarikçi hizmet bedeli',
        blocks: [
          { t: 'ul', x: [
            '**Alış maliyeti** (KDV dahil kabul edilir) üç yerden gelir, güçlüden zayıfa: önce sizin **elle girdiğiniz** birim maliyet, sonra **sipariş geldiği andaki** ürün maliyeti, sonra ürünün **şu anki** maliyeti. Böylece sonradan değişen XML fiyatı geçmiş siparişlerin kârını bozmaz.',
            'Ürün sistemde bulunamıyorsa kâr uydurulmaz: satırda **“maliyet gir”** yazar. Satırı açıp [[Birim ₺]] kutusuna birim alış maliyetini (KDV dahil) yazarsanız, aynı barkodlu tüm siparişlere uygulanır.',
            '**Tedarikçi hizmet bedeli:** XML kaynağındaki “Sipariş sonrası hizmet bedeli”, o kaynağın ürünleri için sipariş başına düşülür. Tutar, sipariş geldiği andaki değerle saklanır; sonradan değiştirmek eski siparişleri etkilemez. Bu bedelin **KDV’si düşülmez** (faturası bilinmediği için).',
            'Bir sipariş için maliyet veya kargo bilinmiyorsa o sipariş **kâr toplamına katılmaz**; ekranda kaç siparişin dışarıda kaldığı yazar.',
          ] },
        ],
      },
      {
        id: 'karlilik-ayar', title: 'Tahmin ayarları',
        blocks: [
          { t: 'p', x: '[[Tahmin ayarları]] düğmesi şunları açar:' },
          { t: 'table', head: ['Ayar', 'Açıklama'], rows: [
            ['Platform hizmet bedeli (₺ / sipariş)', 'Varsayılan 13,19 ₺ (faturanızdaki tutar).'],
            ['Tahmini kargo (₺ / sipariş)', 'Boş bırakırsanız kargo faturalarından okunan ortalama kullanılır.'],
            ['KDV mükellefiyim', 'Açıkken alış, kargo, komisyon ve hizmet bedelindeki KDV, ödenecek KDV’den düşülür. Varsayılan: açık.'],
            ['Alış maliyetindeki KDV (%)', 'Alış maliyetlerinizin içindeki KDV oranı (varsayılan %20). Alış fiyatlarınız KDV hariçse ve XML kaynağında alış KDV’si tanımlı değilse bu rakamı gözden geçirin.'],
            ['Stopaj (%)', 'KDV hariç satış üzerinden (varsayılan %1).'],
          ] },
        ],
      },
    ],
  },
];
