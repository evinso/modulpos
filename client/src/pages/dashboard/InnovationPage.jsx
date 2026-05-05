import React from 'react';
import { 
  Rocket, 
  ShoppingBag, 
  Zap, 
  MessageSquare, 
  BarChart3, 
  FileText, 
  Cpu, 
  Globe, 
  Smartphone,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Bot,
  Scale
} from 'lucide-react';

const InnovationPage = () => {
  const innovations = [
    {
      category: "Pazaryeri Genişleme",
      icon: <Globe className="text-blue-400" size={24} />,
      items: [
        { title: "Çoklu Kanal Entegrasyonu", description: "Hepsiburada, N11, Amazon, Pazarama ve Çiçeksepeti API entegrasyonları ile tek panelden tüm Türkiye'ye satış.", status: "Planlanıyor" },
        { title: "Yurtdışı Pazaryerleri", description: "Etsy, AliExpress ve Amazon Global entegrasyonları ile mikro ihracat desteği.", status: "Vizyon" }
      ]
    },
    {
      category: "Akıllı Otomasyon & AI",
      icon: <Bot className="text-purple-400" size={24} />,
      items: [
        { title: "AI Ürün Optimizasyonu", description: "Ürün açıklamalarını ve başlıklarını yapay zeka ile SEO uyumlu hale getirme ve otomatik kategori eşleştirme.", status: "Geliştirilebilir" },
        { title: "Buybox Takibi", description: "Rakiplerin fiyat değişimlerini saniyelik izleyerek otomatik en düşük fiyat (veya kârlı fiyat) belirleme.", status: "Kritik" }
      ]
    },
    {
      category: "Müşteri İlişkileri (CRM)",
      icon: <MessageSquare className="text-green-400" size={24} />,
      items: [
        { title: "Merkezi Soru-Cevap Paneli", description: "Tüm pazaryerlerinden gelen müşteri sorularını tek bir ekranda toplama ve yanıtlama.", status: "Yeni" },
        { title: "Akıllı Bot Yanıtları", description: "Kargo takibi, ürün özellikleri gibi sık sorulan sorulara AI ile anlık ve doğru cevaplar.", status: "Vizyon" }
      ]
    },
    {
      category: "Finans & Operasyon",
      icon: <BarChart3 className="text-orange-400" size={24} />,
      items: [
        { title: "E-Fatura Entegrasyonu", description: "Trendyol, Hepsiburada siparişleri için otomatik e-fatura/e-arşiv oluşturma (QNB, Paraşüt vb.).", status: "Kritik" },
        { title: "Net Karlılık Analizi", description: "Komisyon, kargo ve XML maliyetlerini düşerek her siparişteki gerçek kârı kuruşu kuruşuna görme.", status: "Geliştirilebilir" }
      ]
    },
    {
      category: "Kullanıcı Deneyimi",
      icon: <Smartphone className="text-pink-400" size={24} />,
      items: [
        { title: "Dahili E-Ticaret Mağazası", description: "Pazaryerlerinden bağımsız, kendi domaininizde çalışan modern bir e-ticaret storefront.", status: "Vizyon" },
        { title: "Mobil Yönetim Paneli", description: "Tüm stok ve fiyat güncellemelerini, sipariş takibini yapabileceğiniz yerli mobil uygulama.", status: "Planlanıyor" }
      ]
    }
  ];

  return (
    <div className="innovation-page" style={{ paddingBottom: '40px' }}>
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <Sparkles className="text-accent" size={24} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            İnovasyon & Yol Haritası
          </span>
        </div>
        <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '12px', background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Gelecek Vizyonu: ModulPOS'u Nereye Taşıyoruz?
        </h1>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '800px', fontSize: '16px', lineHeight: '1.6' }}>
          Pazarcan ve global rakipleri inceleyerek, ModulPOS kullanıcıları için en yüksek katma değeri sağlayacak özellikleri belirledik. 
          Bu liste, platformumuzun e-ticaret ekosistemindeki yerini güçlendirecek stratejik adımları içermektedir.
        </p>
      </div>

      <div className="innovation-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '24px' }}>
        {innovations.map((section, idx) => (
          <div key={idx} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
              <div style={{ padding: '10px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.1)' }}>
                {section.icon}
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: '700' }}>{section.category}</h3>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {section.items.map((item, iIdx) => (
                <div key={iIdx} style={{ position: 'relative', paddingLeft: '24px' }}>
                  <div style={{ position: 'absolute', left: 0, top: '6px' }}>
                    <CheckCircle2 size={16} color={item.status === 'Kritik' ? 'var(--danger)' : 'var(--accent-primary)'} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                    <h4 style={{ fontSize: '15px', fontWeight: '600' }}>{item.title}</h4>
                    <span className={`badge ${item.status === 'Kritik' ? 'badge-danger' : 'badge-primary'}`} style={{ fontSize: '10px' }}>
                      {item.status}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: '32px', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)', border: '1px solid var(--accent-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyCenter: 'center', flexShrink: 0 }}>
            <Rocket color="white" size={32} style={{ margin: 'auto' }} />
          </div>
          <div>
            <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Pazarcan'dan Daha İlerisi!</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              Pazarcan'ın sunduğu tüm özellikleri (XML, Fiyatlandırma, Kategori Eşleştirme) zaten temel olarak sunuyoruz. 
              Hedefimiz, bu özellikleri AI (Yapay Zeka) ve gelişmiş finansal analitiklerle birleştirerek kullanıcılarımıza sadece "yükleme" değil, "satış stratejisi" sunmaktır.
            </p>
          </div>
          <button className="btn btn-primary" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            Yol Haritasını Başlat <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default InnovationPage;
