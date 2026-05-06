import { Link } from 'react-router-dom';
import { FileCode2, Store, Tags, ArrowRight, CheckCircle, Zap, ShieldCheck, BarChart3, RefreshCw, FolderTree, ArrowLeftRight, Package } from 'lucide-react';
import './LandingPage.css';

const features = [
  { icon: <FileCode2 size={24} />, title: 'XML Otomatik İçe Aktarma', desc: 'Her formattaki tedarikçi XML\'ini sisteme bağlayın. RSS, Google Shopping, özel formatlar — hepsi desteklenir.' },
  { icon: <Store size={24} />, title: 'Pazaryeri Entegrasyonu', desc: 'Ürünlerinizi pazaryerlerine tek tıkla gönderin. Stok ve fiyat güncellemeleri otomatik senkronize edilir.' },
  { icon: <Tags size={24} />, title: 'Merkezi Fiyatlandırma', desc: 'Alış fiyatına göre otomatik satış fiyatı hesaplama. Pazaryerine göre özel kâr marjı tanımlayın.' },
  { icon: <ArrowLeftRight size={24} />, title: 'XML Dönüştürücü', desc: 'Desteklenmeyen XML formatlarını anında dönüştürün. Proxy URL ile her senkronizasyonda güncel veri.' },
  { icon: <FolderTree size={24} />, title: 'Kategori Eşleştirme', desc: 'Tedarikçi kategorilerinizi pazaryeri kategorileriyle eşleştirin. Ürün gönderimi sorunsuz gerçekleşsin.' },
  { icon: <BarChart3 size={24} />, title: 'Sipariş Takibi', desc: 'Tüm pazaryerlerindeki siparişlerinizi tek panelden takip edin. Gerçek zamanlı durum güncellemeleri.' },
];

const steps = [
  { n: '01', title: 'XML Kaynağı Ekle', desc: 'Tedarikçinizin XML linkini yapıştırın, sistem otomatik analiz etsin.' },
  { n: '02', title: 'Alan Eşleştir', desc: 'XML alanlarını ürün alanlarıyla eşleştirin, fiyatlandırma kuralı tanımlayın.' },
  { n: '03', title: 'Pazaryerine Gönder', desc: 'Ürünleri pazaryerlerine gönderin, stok ve fiyatlar otomatik güncellensin.' },
];

const stats = [
  { value: '10.000+', label: 'Ürün Yönetimi' },
  { value: '%99.9', label: 'Uptime Garantisi' },
  { value: '2 dk', label: 'Kurulum Süresi' },
  { value: '7/24', label: 'Destek' },
];

export default function LandingPage() {
  return (
    <div className="lp-root">
      {/* NAV */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo">
            <div className="lp-logo-icon">M</div>
            <span>ModulPOS</span>
          </Link>
          <div className="lp-nav-links">
            <a href="#features">Özellikler</a>
            <a href="#how">Nasıl Çalışır?</a>
            <a href="#pricing">Fiyatlar</a>
          </div>
          <div className="lp-nav-actions">
            <Link to="/login" className="lp-btn-ghost">Giriş Yap</Link>
            <Link to="/register" className="lp-btn-primary">Ücretsiz Başla</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="lp-hero">
        <div className="lp-grid-bg" />
        <div className="lp-glow lp-glow-1" />
        <div className="lp-glow lp-glow-2" />
        <div className="lp-hero-inner">
          <div className="lp-hero-badge">
            <Zap size={13} /> Türkiye'nin En Hızlı Pazaryeri Entegrasyon Platformu
          </div>
          <h1 className="lp-hero-title">
            Tüm Pazaryerlerinizi<br />
            <span className="lp-gradient-text">Tek Yerden Yönetin</span>
          </h1>
          <p className="lp-hero-desc">
            XML tedarikçi bağlantısından pazaryeri satışına kadar tüm süreç otomatik.
            Ürün yönetimi, fiyatlandırma ve sipariş takibi artık çok kolay.
          </p>
          <div className="lp-hero-cta">
            <Link to="/register" className="lp-btn-primary lp-btn-lg">
              Ücretsiz Başla <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="lp-btn-ghost lp-btn-lg">
              Giriş Yap
            </Link>
          </div>
          <div className="lp-hero-checks">
            {['Kredi kartı gerekmez', 'Kurulum 2 dakika', '7/24 destek'].map(t => (
              <span key={t}><CheckCircle size={14} /> {t}</span>
            ))}
          </div>
        </div>

        {/* Dashboard mockup */}
        <div className="lp-mockup">
          <div className="lp-mockup-bar">
            <span /><span /><span />
          </div>
          <div className="lp-mockup-body">
            <div className="lp-mockup-sidebar">
              {['Dashboard', 'Ürünler', 'XML Kaynakları', 'Pazaryerleri', 'Fiyatlandırma'].map((item, i) => (
                <div key={item} className={`lp-mock-nav-item ${i === 1 ? 'active' : ''}`}>{item}</div>
              ))}
            </div>
            <div className="lp-mockup-content">
              <div className="lp-mock-header">
                <span className="lp-mock-title">Ürün Yönetimi</span>
                <span className="lp-mock-badge">4.667 ürün</span>
              </div>
              {[
                { sku: 'EB2239', name: 'Çizgi Desenli Bileklik', price: '₺99,9', sale: '₺149,85', stock: 234, status: 'Aktif' },
                { sku: 'ERK1415', name: 'Gold Bileklik Seti', price: '₺74,9', sale: '₺112,35', stock: 19, status: 'Aktif' },
                { sku: 'ERK1414', name: 'Renk Renk Bileklik', price: '₺114,9', sale: '₺172,35', stock: 115, status: 'Bekliyor' },
                { sku: 'ERK1413', name: 'Vintage Gümüş Bileklik', price: '₺79,9', sale: '₺119,85', stock: 117, status: 'Aktif' },
              ].map((row, i) => (
                <div key={i} className="lp-mock-row">
                  <span className="lp-mock-sku">{row.sku}</span>
                  <span className="lp-mock-name">{row.name}</span>
                  <span className="lp-mock-price">{row.price}</span>
                  <span className="lp-mock-sale">{row.sale}</span>
                  <span className="lp-mock-stock">{row.stock}</span>
                  <span className={`lp-mock-status ${row.status === 'Aktif' ? 'green' : 'yellow'}`}>{row.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="lp-stats">
        {stats.map(s => (
          <div key={s.label} className="lp-stat-item">
            <div className="lp-stat-value">{s.value}</div>
            <div className="lp-stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* FEATURES */}
      <section className="lp-section" id="features">
        <div className="lp-section-inner">
          <div className="lp-section-header">
            <div className="lp-badge-label">Özellikler</div>
            <h2>İhtiyacınız olan her şey <span className="lp-gradient-text">burada</span></h2>
            <p>Tek platformda tedarikçi yönetiminden pazaryeri entegrasyonuna kadar her şey</p>
          </div>
          <div className="lp-features-grid">
            {features.map((f, i) => (
              <div key={i} className="lp-feature-card">
                <div className="lp-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section lp-section-alt" id="how">
        <div className="lp-section-inner">
          <div className="lp-section-header">
            <div className="lp-badge-label">Nasıl Çalışır?</div>
            <h2>3 adımda <span className="lp-gradient-text">satışa başlayın</span></h2>
            <p>Dakikalar içinde kurulumu tamamlayın, tedarikçinizden pazaryerine köprü kurun</p>
          </div>
          <div className="lp-steps">
            {steps.map((s, i) => (
              <div key={i} className="lp-step">
                <div className="lp-step-num">{s.n}</div>
                <div className="lp-step-line" />
                <div className="lp-step-body">
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="lp-section" id="pricing">
        <div className="lp-section-inner">
          <div className="lp-section-header">
            <div className="lp-badge-label">Fiyatlar</div>
            <h2>Şeffaf ve <span className="lp-gradient-text">uygun fiyat</span></h2>
            <p>İhtiyacınıza göre plan seçin, istediğiniz zaman değiştirin</p>
          </div>
          <div className="lp-pricing-grid">
            {[
              {
                name: 'Başlangıç', price: 'Ücretsiz', period: 'sonsuza kadar',
                features: ['1 XML Kaynağı', '500 Ürün', '1 Pazaryeri', 'Temel destek'],
                cta: 'Ücretsiz Başla', highlight: false,
              },
              {
                name: 'Profesyonel', price: '₺499', period: '/ ay',
                features: ['10 XML Kaynağı', '10.000 Ürün', '3 Pazaryeri', 'Öncelikli destek', 'XML Dönüştürücü', 'Otomatik senkronizasyon'],
                cta: 'Hemen Başla', highlight: true,
              },
              {
                name: 'Kurumsal', price: 'Özel', period: 'fiyatlandırma',
                features: ['Sınırsız XML Kaynağı', 'Sınırsız Ürün', 'Sınırsız Pazaryeri', '7/24 destek', 'Özel entegrasyon', 'SLA garantisi'],
                cta: 'Bize Ulaşın', highlight: false,
              },
            ].map((plan, i) => (
              <div key={i} className={`lp-price-card ${plan.highlight ? 'highlighted' : ''}`}>
                {plan.highlight && <div className="lp-popular-badge">En Popüler</div>}
                <div className="lp-price-name">{plan.name}</div>
                <div className="lp-price-amount">
                  <span className="lp-price-value">{plan.price}</span>
                  <span className="lp-price-period">{plan.period}</span>
                </div>
                <ul className="lp-price-features">
                  {plan.features.map(f => (
                    <li key={f}><CheckCircle size={14} /> {f}</li>
                  ))}
                </ul>
                <Link to="/register" className={`lp-price-cta ${plan.highlight ? 'primary' : 'ghost'}`}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-cta">
        <div className="lp-glow lp-glow-cta" />
        <div className="lp-cta-inner">
          <h2>Hemen başlayın, <span className="lp-gradient-text">ücretsiz</span></h2>
          <p>Kredi kartı gerekmez. 2 dakikada kurulum. İstediğiniz zaman iptal.</p>
          <Link to="/register" className="lp-btn-primary lp-btn-lg">
            Ücretsiz Hesap Oluştur <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <Link to="/" className="lp-logo">
              <div className="lp-logo-icon">M</div>
              <span>ModulPOS</span>
            </Link>
            <p>
              Tüm pazaryerlerinizi tek platformdan yönetin. E-ticaret operasyonlarınızı otomatikleştirin ve satışlarınızı artırın.
            </p>
            <div style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
              <strong>ModulPOS Yazılım A.Ş.</strong><br/>
              Bilişim Vadisi, Teknoloji Blv. No:1<br/>
              Gebze / Kocaeli<br/>
              info@modulpos.com | 0850 000 00 00
            </div>
          </div>
          
          <div>
            <h4>Ürün</h4>
            <ul>
              <li><a href="#features">Özellikler</a></li>
              <li><a href="#pricing">Fiyatlandırma</a></li>
              <li><a href="#how">Nasıl Çalışır?</a></li>
              <li><Link to="/register">Ücretsiz Başla</Link></li>
            </ul>
          </div>

          <div>
            <h4>Yasal Sözleşmeler</h4>
            <ul>
              <li><a href="#">Mesafeli Satış Sözleşmesi</a></li>
              <li><a href="#">İptal ve İade Koşulları</a></li>
              <li><a href="#">Gizlilik ve Güvenlik Politikası</a></li>
              <li><a href="#">Teslimat Koşulları</a></li>
              <li><a href="#">Kullanım Şartları</a></li>
            </ul>
          </div>

          <div>
            <h4>Kurumsal</h4>
            <ul>
              <li><a href="#">Hakkımızda</a></li>
              <li><a href="#">İletişim</a></li>
              <li><a href="#">Kariyer</a></li>
              <li><a href="#">Destek Merkezi</a></li>
            </ul>
          </div>
        </div>
        
        <div className="lp-footer-bottom">
          <p>© {new Date().getFullYear()} ModulPOS. Tüm hakları saklıdır.</p>
          <div className="lp-footer-payment-icons" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginRight: '8px' }}>Güvenli Ödeme:</span>
            <img src="https://upload.wikimedia.org/wikipedia/commons/4/41/Visa_Logo.png" alt="Visa" style={{ height: 16, objectFit: 'contain' }} />
            <img src="https://upload.wikimedia.org/wikipedia/commons/b/b7/MasterCard_Logo.svg" alt="Mastercard" style={{ height: 20, objectFit: 'contain' }} />
            <img src="https://upload.wikimedia.org/wikipedia/commons/5/5f/Troy_logo.svg" alt="Troy" style={{ height: 20, objectFit: 'contain' }} />
            <span style={{ fontSize: 14, color: '#0f172a', fontWeight: 800, letterSpacing: '-0.5px', marginLeft: '4px' }}>PAY<span style={{ color: '#10b981' }}>TR</span></span>
            <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 8px' }}></div>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>128 Bit SSL ile Güvendesiniz.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
