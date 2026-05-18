import { useState } from 'react';
import {
  BookOpen, ChevronDown, Rocket, Store, FileCode2, Package,
  FolderTree, TrendingUp, ShoppingCart, Activity, MessageSquare, Wallet, CheckCircle
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'baslangic',
    icon: Rocket,
    title: '1. Başlarken',
    items: [
      {
        title: 'Platform nedir, ne işe yarar',
        content: (
          <div>
            <p>ModulPOS, birden fazla e-ticaret pazaryerini tek ekrandan yönetmenizi sağlayan bir entegrasyon platformudur.</p>
            <ul>
              <li>XML tedarikçi kaynaklarınızdan ürünleri otomatik çekersiniz.</li>
              <li>Çekilen ürünleri Trendyol, Hepsiburada gibi pazaryerlerine gönderirsiniz.</li>
              <li>Stok, fiyat ve sipariş takibini tek noktadan yönetirsiniz.</li>
              <li>Müşteri sorularını ve BuyBox sıralamasını izlersiniz.</li>
            </ul>
          </div>
        ),
      },
      {
        title: 'İlk giriş ve hesap kurulumu',
        content: (
          <div>
            <p>Hesabınızı oluşturduktan sonra yapmanız gereken adımlar sırasıyla şunlardır:</p>
            <ol>
              <li><strong>Mağaza bağlantısı kurun</strong> — Sol menüden <em>Entegrasyon → Pazaryerleri</em> sayfasına gidin ve kullandığınız pazaryerini bağlayın.</li>
              <li><strong>XML kaynağı ekleyin</strong> — Sol menüden <em>Entegrasyon → XML Kaynakları</em> sayfasına giderek tedarikçi XML adresinizi tanımlayın.</li>
              <li><strong>Kategori eşleştirin</strong> — Ürünlerinizi pazaryerine göndermeden önce kategorileri eşleştirmeniz gerekir.</li>
              <li><strong>Ürün gönderin</strong> — İlgili pazaryeri menüsünden ürünlerinizi listeleyin.</li>
            </ol>
          </div>
        ),
      },
      {
        title: 'Abonelik ve kredi sistemi',
        content: (
          <div>
            <p>Platform iki katmanlı bir ödeme modeli kullanır:</p>
            <ul>
              <li><strong>Abonelik planı:</strong> Aylık ya da yıllık plan seçerek maksimum ürün sayısı ve XML kaynak limiti belirlenir. Sol menüden <em>Yönetim → Fiyatlandırma</em> üzerinden plan seçebilirsiniz.</li>
              <li><strong>Kredi:</strong> Bazı işlemler (AI kategori eşleştirme gibi) kredi harcar. Sol menüden <em>Yönetim → Kredi &amp; Bakiye</em> sayfasından mevcut kredinizi görüp yükleyebilirsiniz.</li>
            </ul>
            <p>Yeni üyelere otomatik ücretsiz deneme süresi tanınır; bu sürede tüm özellikleri kullanabilirsiniz.</p>
          </div>
        ),
      },
    ],
  },
  {
    id: 'magaza',
    icon: Store,
    title: '2. Mağaza Bağlantısı',
    items: [
      {
        title: 'Trendyol mağazası nasıl bağlanır',
        content: (
          <div>
            <p>Sol menüden <em>Entegrasyon → Pazaryerleri</em> sayfasını açın ve Trendyol kartındaki <strong>Bağla</strong> butonuna tıklayın.</p>
            <ol>
              <li>Trendyol Satıcı Paneli'nde <em>Hesabım → Mağaza Bilgilerim</em> altında bulunan <strong>Satıcı ID</strong>'nizi girin.</li>
              <li>Trendyol Satıcı Paneli'nde <em>Entegrasyon → API Bilgileri</em> bölümünden aldığınız <strong>API Key</strong> ve <strong>API Secret</strong> bilgilerini girin.</li>
              <li><strong>Bağlantıyı Test Et</strong> butonuna tıklayarak bağlantının çalıştığını doğrulayın.</li>
              <li>Kaydedin.</li>
            </ol>
            <p style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(99,102,241,0.1)', borderRadius: 6, fontSize: 13 }}>
              <strong>Not:</strong> Webhook otomatik olarak Trendyol'a kaydedilir; ayrıca bir işlem yapmanıza gerek yoktur.
            </p>
          </div>
        ),
      },
      {
        title: 'Hepsiburada mağazası nasıl bağlanır',
        content: (
          <div>
            <p>Sol menüden <em>Entegrasyon → Pazaryerleri</em> sayfasını açın ve Hepsiburada kartındaki <strong>Bağla</strong> butonuna tıklayın.</p>
            <ol>
              <li>Hepsiburada Merchant ID'nizi girin (MPOP panelindeki satıcı kimliği).</li>
              <li>Hepsiburada kullanıcı adı ve şifrenizi girin (API erişimi için).</li>
              <li><strong>Bağlantıyı Test Et</strong> butonuna tıklayarak doğrulayın.</li>
              <li>Kaydedin.</li>
            </ol>
          </div>
        ),
      },
      {
        title: 'Bağlantı testi ve doğrulama',
        content: (
          <div>
            <p>Her bağlantı kartında üç durum göstergesi bulunur:</p>
            <ul>
              <li><strong style={{ color: '#10b981' }}>Yeşil (Bağlı):</strong> API kimlik bilgileri geçerli, bağlantı aktif.</li>
              <li><strong style={{ color: '#f59e0b' }}>Sarı (Uyarı):</strong> Bağlantı kurulmuş ancak bazı izinler eksik olabilir.</li>
              <li><strong style={{ color: '#ef4444' }}>Kırmızı (Hata):</strong> API bilgileri hatalı ya da süresi dolmuş; yeniden girin.</li>
            </ul>
            <p>Bağlantı sonrası sol menüdeki ilgili pazaryeri seçenekleri aktif hale gelir.</p>
          </div>
        ),
      },
    ],
  },
  {
    id: 'xml',
    icon: FileCode2,
    title: '3. XML Kaynakları',
    items: [
      {
        title: 'XML kaynağı nedir',
        content: (
          <div>
            <p>XML kaynağı, tedarikçinizin ürün verilerini (barkod, başlık, fiyat, stok, görsel vb.) paylaştığı bir internet adresidir. Platform bu adresi düzenli aralıklarla kontrol ederek ürün değişikliklerini otomatik yansıtır.</p>
          </div>
        ),
      },
      {
        title: 'Yeni XML kaynağı nasıl eklenir',
        content: (
          <div>
            <ol>
              <li>Sol menüden <em>Entegrasyon → XML Kaynakları</em> sayfasına gidin.</li>
              <li><strong>+ Yeni Kaynak Ekle</strong> butonuna tıklayın.</li>
              <li>Kaynak adı, XML URL'si ve senkronizasyon aralığı (saat cinsinden) girin.</li>
              <li>Gerekiyorsa kullanıcı adı ve şifre ile temel HTTP kimlik doğrulaması ekleyin.</li>
              <li><strong>Kaydet</strong> butonuna basın. Kayıt sonrası ilk senkronizasyon otomatik başlar.</li>
            </ol>
          </div>
        ),
      },
      {
        title: 'XML senkronizasyonu nasıl çalışır',
        content: (
          <div>
            <p>Kaynak eklendikten sonra:</p>
            <ul>
              <li>Sistem belirlediğiniz aralıkta XML'i indirir ve mevcut ürünlerle karşılaştırır.</li>
              <li>Yeni ürünler eklenir, fiyat/stok değişiklikleri güncellenir, kaldırılan ürünler pasife alınır.</li>
              <li>Tüm bu işlemlerin sonuçlarını <em>Yönetim → İşlem Logları</em> sayfasından takip edebilirsiniz.</li>
            </ul>
            <p>Manuel senkronizasyon için kaynak satırındaki <strong>Yenile</strong> butonunu kullanabilirsiniz.</p>
          </div>
        ),
      },
      {
        title: 'Desteklenen XML formatları',
        content: (
          <div>
            <p>Platform standart ve yaygın tedarikçi XML formatlarını destekler:</p>
            <ul>
              <li>Google Shopping (Merchant Center) formatı</li>
              <li>OpenCart / WooCommerce XML çıktısı</li>
              <li>Özel alan eşleştirmeli genel XML (XPath tabanlı)</li>
            </ul>
            <p>Tedarikçinizin formatı desteklenmiyorsa sol menüdeki <em>XML Dönüştürücü</em> aracıyla formatı dönüştürebilirsiniz.</p>
          </div>
        ),
      },
    ],
  },
  {
    id: 'urunler',
    icon: Package,
    title: '4. Ürün Yönetimi',
    items: [
      {
        title: 'Ürünler sayfasına genel bakış',
        content: (
          <div>
            <p>Sol menüden <em>Ana Menü → Ürünler</em> sayfası, tüm XML kaynaklarından çekilen ürünleri listeler.</p>
            <ul>
              <li>Her ürünün barkodu, başlığı, fiyatı, stok miktarı ve kaynağı görünür.</li>
              <li>Pazaryerlerine gönderilmiş ürünlerde ilgili pazaryeri ikonu görünür.</li>
            </ul>
          </div>
        ),
      },
      {
        title: 'Ürün filtreleme ve arama',
        content: (
          <div>
            <p>Sayfanın üstündeki arama ve filtre araçlarıyla ürün listenizi daraltabilirsiniz:</p>
            <ul>
              <li><strong>Arama:</strong> Barkod, ürün adı veya SKU ile arama yapabilirsiniz.</li>
              <li><strong>Kaynak filtresi:</strong> Belirli bir XML kaynağına ait ürünleri görüntüleyin.</li>
              <li><strong>Stok filtresi:</strong> Stoğu olan / tükenmiş ürünleri ayırın.</li>
              <li><strong>Pazaryeri filtresi:</strong> Trendyol'a gönderilmiş ya da henüz gönderilmemiş ürünleri listeleyin.</li>
            </ul>
          </div>
        ),
      },
      {
        title: 'Ürün düzenleme',
        content: (
          <div>
            <p>Herhangi bir ürün satırındaki düzenleme ikonuna tıklayarak ürünü manuel olarak güncelleyebilirsiniz:</p>
            <ul>
              <li>Başlık, açıklama ve görseller değiştirilebilir.</li>
              <li>Fiyata kâr marjı ya da sabit fark eklenebilir.</li>
              <li>Yapılan değişiklikler bir sonraki XML senkronizasyonunda üzerine yazılmaz; manuel değişiklikler korunur.</li>
            </ul>
          </div>
        ),
      },
    ],
  },
  {
    id: 'kategori',
    icon: FolderTree,
    title: '5. Kategori Eşleştirme',
    items: [
      {
        title: 'Kategori eşleştirme nedir, neden önemli',
        content: (
          <div>
            <p>Her pazaryeri kendi kategori ağacına sahiptir. Ürününüzü doğru kategoriyle eşleştirmezseniz pazaryeri ürünü kabul etmez ya da yanlış yerde listeler.</p>
            <p>Kategori eşleştirme sayfasında, XML'inizdeki kategori adlarını Trendyol veya Hepsiburada'nın kategori ağacındaki karşılıklarına bağlarsınız. Bu işlem bir kez yapılır; sonrasında tüm gönderiler bu eşleştirmeyi kullanır.</p>
          </div>
        ),
      },
      {
        title: 'Manuel eşleştirme nasıl yapılır',
        content: (
          <div>
            <ol>
              <li>Sol menüden <em>Trendyol → Kategori Eşleştirme</em> sayfasını açın.</li>
              <li>Listede eşleştirilmemiş (kırmızı) kategorilerinizi bulun.</li>
              <li>Satır sonundaki <strong>Eşleştir</strong> butonuna tıklayın.</li>
              <li>Açılan arama kutusuna Trendyol'daki karşılık kategori adını yazın ve seçin.</li>
              <li>Kaydedin. Kategori artık yeşil olarak işaretlenir.</li>
            </ol>
          </div>
        ),
      },
      {
        title: 'AI ile otomatik eşleştirme',
        content: (
          <div>
            <p>Eşleştirilmemiş tüm kategorileri tek seferde otomatik eşleştirmek için sayfanın üstündeki <strong>AI ile Otomatik Eşleştir</strong> butonunu kullanın.</p>
            <ul>
              <li>Bu özellik her kategori başına belirli miktarda kredi harcar.</li>
              <li>AI, kategori adını analiz ederek en uygun pazaryeri kategorisini seçer.</li>
              <li>Sonuçları gözden geçirerek hatalı eşleştirmeleri manuel olarak düzeltebilirsiniz.</li>
            </ul>
          </div>
        ),
      },
    ],
  },
  {
    id: 'trendyol',
    icon: Store,
    title: '6. Trendyol',
    items: [
      {
        title: 'Ürün gönderme',
        content: (
          <div>
            <ol>
              <li>Sol menüden <em>Trendyol → Pazaryerine Gönder</em> sayfasını açın.</li>
              <li>Göndermek istediğiniz ürünleri filtreleyin ve seçin (tek tek veya toplu seçim).</li>
              <li>Minimum stok eşiği ve kâr marjını belirleyin.</li>
              <li><strong>Gönder</strong> butonuna tıklayın. Trendyol, ürünleri inceleme sürecine alır.</li>
              <li>Onay durumunu <em>İşlem Logları</em> sayfasından takip edebilirsiniz.</li>
            </ol>
            <p style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(99,102,241,0.1)', borderRadius: 6, fontSize: 13 }}>
              <strong>Not:</strong> Kategorisi eşleştirilmemiş ürünler gönderim listesinde görünmez; önce kategori eşleştirmesini tamamlayın.
            </p>
          </div>
        ),
      },
      {
        title: 'BuyBox izleme',
        content: (
          <div>
            <p>Sol menüden <em>Trendyol → BuyBox İzleme</em> sayfasını açın.</p>
            <ul>
              <li>Listelediğiniz ürünlerin anlık BuyBox sıralamasını ve rakip satıcıların fiyatlarını görürsünüz.</li>
              <li>BuyBox'ı kazanmak için önerilen hedef fiyat gösterilir.</li>
              <li>Fiyat güncellemelerini doğrudan bu sayfadan yapabilirsiniz.</li>
            </ul>
          </div>
        ),
      },
      {
        title: 'Müşteri sorularını yanıtlama',
        content: (
          <div>
            <p>Sol menüden <em>Trendyol → Müşteri Soruları</em> sayfasını açın.</p>
            <ul>
              <li>Trendyol'dan gelen tüm ürün soruları burada listelenir.</li>
              <li>Yanıtlanmamış sorular kırmızıyla işaretlenir.</li>
              <li>Soruyu seçip yanıt yazın ve <strong>Gönder</strong>'e tıklayın; yanıt doğrudan Trendyol'a iletilir.</li>
              <li>Otomatik yanıt kuralları oluşturmak için <em>Sistem Yönetimi → Soru Kuralları (Admin)</em> sayfasını kullanın.</li>
            </ul>
          </div>
        ),
      },
    ],
  },
  {
    id: 'hepsiburada',
    icon: Store,
    title: '7. Hepsiburada',
    items: [
      {
        title: 'Genel kullanım',
        content: (
          <div>
            <p>Hepsiburada işlemleri sol menüdeki <em>Hepsiburada</em> altında gruplandırılmıştır:</p>
            <ul>
              <li><strong>Kategori Eşleştirme:</strong> Ürün kategorilerinizi Hepsiburada ağacıyla eşleştirin.</li>
              <li><strong>Yeni Ürün Listele:</strong> XML'den çekilen ürünleri Hepsiburada'ya ilk kez gönderin.</li>
              <li><strong>Stok / Fiyat Güncelle:</strong> Mevcut listelemelerde stok, fiyat, kargo ve ek bilgileri güncelleyin.</li>
              <li><strong>Ürün Güncelle:</strong> Ürün içeriğini (başlık, açıklama, görseller) Ticket API üzerinden güncelleyin.</li>
              <li><strong>BuyBox Sırası:</strong> Listelemelerin anlık BuyBox pozisyonunu takip edin.</li>
              <li><strong>Müşteri Soruları:</strong> Hepsiburada'dan gelen soruları görüntüleyin ve yanıtlayın.</li>
            </ul>
          </div>
        ),
      },
    ],
  },
  {
    id: 'siparisler',
    icon: ShoppingCart,
    title: '8. Siparişler',
    items: [
      {
        title: 'Sipariş takibi',
        content: (
          <div>
            <p>Sol menüden <em>Ana Menü → Siparişler</em> sayfası, tüm pazaryerlerinden gelen siparişleri tek listede gösterir.</p>
            <ul>
              <li>Sipariş numarası, müşteri adı, tutar, durum ve tarih bilgileri görünür.</li>
              <li>Sipariş durumları pazaryerinden otomatik güncellenir.</li>
              <li>Sipariş detayını açmak için satıra tıklayın; ürün kalemleri ve kargo bilgisi görüntülenir.</li>
            </ul>
          </div>
        ),
      },
      {
        title: 'Tedarikçi siparişleri',
        content: (
          <div>
            <p>Dropship modelinde çalışıyorsanız sol menüden <em>Ana Menü → Tedarikçi Siparişleri</em> sayfasını kullanın.</p>
            <ul>
              <li>Müşteri siparişleri tedarikçiye iletildikten sonra takip numarası bu sayfadan girilir.</li>
              <li>Durum güncellemesi yaparak siparişi ilerletebilirsiniz: <em>Beklemede → İşlemde → Kargoda → Teslim Edildi</em>.</li>
              <li>Kampanya kodu, kargo firması ve tedarikçi sipariş ID'si alanları da mevcuttur.</li>
            </ul>
          </div>
        ),
      },
    ],
  },
  {
    id: 'loglar',
    icon: Activity,
    title: '9. İşlem Logları',
    items: [
      {
        title: 'Loglar nasıl okunur',
        content: (
          <div>
            <p>Sol menüden <em>Yönetim → İşlem Logları</em> sayfası, platformun gerçekleştirdiği tüm otomatik ve manuel işlemleri listeler.</p>
            <ul>
              <li><strong>Tür:</strong> XML sync, ürün gönderimi, fiyat güncelleme, API isteği vb.</li>
              <li><strong>Durum:</strong> Başarılı (yeşil), Uyarı (sarı), Hata (kırmızı).</li>
              <li><strong>Detay:</strong> Log satırına tıklayarak tam istek/yanıt içeriğini görebilirsiniz.</li>
            </ul>
          </div>
        ),
      },
      {
        title: 'Hata ayıklama',
        content: (
          <div>
            <p>Bir işlem başarısız olduğunda şu adımları izleyin:</p>
            <ol>
              <li>Loglar sayfasında kırmızı satırı bulun ve detayını açın.</li>
              <li>Hata mesajını okuyun — genellikle eksik alan, hatalı API anahtarı ya da kategori eşleştirme sorunu olur.</li>
              <li>Sorunu giderdikten sonra ilgili işlemi tekrar başlatın.</li>
              <li>Sorun devam ederse <em>Destek</em> sayfasından bir bilet açın ve log detayını ekleyin.</li>
            </ol>
          </div>
        ),
      },
    ],
  },
  {
    id: 'destek',
    icon: MessageSquare,
    title: '10. Destek',
    items: [
      {
        title: 'Destek talebi oluşturma',
        content: (
          <div>
            <ol>
              <li>Sol menüden <em>Ana Menü → Destek</em> sayfasına gidin.</li>
              <li><strong>Yeni Talep Oluştur</strong> butonuna tıklayın.</li>
              <li>Konu, kategori ve öncelik seçin; sorununuzu açıkça yazın.</li>
              <li>Varsa ekran görüntüsü ya da log detayı ekleyin.</li>
              <li><strong>Gönder</strong>'e basın. Ekibimiz en kısa sürede yanıt verecektir.</li>
            </ol>
            <p style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(16,185,129,0.1)', borderRadius: 6, fontSize: 13 }}>
              <strong>İpucu:</strong> Acil sorunlar için öncelik alanını <em>Acil</em> olarak seçin; bu biletler önce incelenir.
            </p>
          </div>
        ),
      },
    ],
  },
];

export default function GuidePage() {
  const [openSection, setOpenSection] = useState('baslangic');
  const [openItem, setOpenItem] = useState(null);

  const toggleSection = (id) => {
    setOpenSection(prev => prev === id ? null : id);
    setOpenItem(null);
  };

  const toggleItem = (key) => {
    setOpenItem(prev => prev === key ? null : key);
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BookOpen size={20} style={{ color: 'var(--accent-primary)' }} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Kullanma Kılavuzu</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Platform kullanımı hakkında adım adım rehber</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SECTIONS.map(section => {
          const Icon = section.icon;
          const isOpen = openSection === section.id;
          return (
            <div key={section.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => toggleSection(section.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px', border: 'none', cursor: 'pointer',
                  background: isOpen ? 'rgba(99,102,241,0.08)' : 'transparent',
                  color: isOpen ? 'var(--accent-primary)' : 'var(--text-primary)',
                  borderBottom: isOpen ? '1px solid var(--border-color)' : 'none',
                  textAlign: 'left',
                }}
              >
                <Icon size={18} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{section.title}</span>
                <ChevronDown
                  size={16}
                  style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0, color: 'var(--text-secondary)' }}
                />
              </button>

              {isOpen && (
                <div style={{ padding: '8px 0' }}>
                  {section.items.map((item, idx) => {
                    const itemKey = `${section.id}-${idx}`;
                    const itemOpen = openItem === itemKey;
                    return (
                      <div key={itemKey} style={{ borderBottom: idx < section.items.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                        <button
                          onClick={() => toggleItem(itemKey)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                            padding: '11px 18px 11px 44px', border: 'none', cursor: 'pointer',
                            background: itemOpen ? 'rgba(99,102,241,0.05)' : 'transparent',
                            color: itemOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            textAlign: 'left',
                          }}
                        >
                          <CheckCircle size={14} style={{ flexShrink: 0, opacity: itemOpen ? 1 : 0.4 }} />
                          <span style={{ flex: 1, fontSize: 14, fontWeight: itemOpen ? 600 : 400 }}>{item.title}</span>
                          <ChevronDown
                            size={14}
                            style={{ transition: 'transform 0.2s', transform: itemOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
                          />
                        </button>
                        {itemOpen && (
                          <div style={{
                            padding: '4px 18px 16px 68px',
                            fontSize: 13.5,
                            lineHeight: 1.7,
                            color: 'var(--text-primary)',
                          }}>
                            <style>{`
                              .guide-content ul, .guide-content ol { padding-left: 18px; margin: 8px 0; }
                              .guide-content li { margin-bottom: 4px; }
                              .guide-content p { margin: 6px 0; }
                              .guide-content strong { color: var(--text-primary); }
                            `}</style>
                            <div className="guide-content">{item.content}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
