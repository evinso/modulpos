import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FileCode2, Store, Tags, ArrowRight, CheckCircle, Zap,
  FolderTree, Package, MessageSquare, TrendingUp, ShieldCheck,
  Bell, Menu, X
} from 'lucide-react';
import api from '../../services/api';
import './LandingPage.css';

const features = [
  { icon: <FileCode2 size={22} />, title: 'XML Otomatik İçe Aktarma', desc: 'Her formattaki tedarikçi XML\'ini sisteme bağlayın. Zamanlanmış senkronizasyon ile stok ve fiyatlar otomatik güncellenir.' },
  { icon: <Store size={22} />, title: 'Trendyol Toplu Gönderim', desc: 'Seçili ürünleri Trendyol\'a tek tıkla toplu gönderin. Eksik kategoriler ve hatalar anında raporlanır.' },
  { icon: <TrendingUp size={22} />, title: 'BuyBox İzleme', desc: 'Ürünlerinizin BuyBox durumunu anlık takip edin. Rekabet analizini otomatikleştirin, fırsatları kaçırmayın.' },
  { icon: <MessageSquare size={22} />, title: 'AI Müşteri Yanıtlama', desc: 'Trendyol ürün sorularını AI destekli otomatik yanıtlayın. Müşteri memnuniyetini artırın, zaman kazanın.' },
  { icon: <Tags size={22} />, title: 'Merkezi Fiyatlandırma', desc: 'Alış fiyatına göre otomatik satış fiyatı hesaplayın. Pazaryerine özel kâr marjı ve kargo kuralları tanımlayın.' },
  { icon: <FolderTree size={22} />, title: 'Kategori Eşleştirme', desc: 'Tedarikçi kategorilerinizi Trendyol kategorileriyle AI ile otomatik eşleştirin. Ürün gönderimi sorunsuz ve hızlı.' },
  { icon: <Package size={22} />, title: 'Sipariş Takibi', desc: 'Tüm siparişlerinizi tek panelden izleyin. Gerçek zamanlı durum güncellemeleri ve müşteri bilgileri bir arada.' },
  { icon: <Bell size={22} />, title: 'Zengin Bildirimler', desc: 'Stok, sipariş, fiyat değişimi gibi tüm olaylar için detaylı bildirimler. Tıklayın, anında inceleyin.' },
  { icon: <ShieldCheck size={22} />, title: 'Oturum Güvenliği', desc: 'Hesabınıza hangi IP\'den, hangi cihazdan giriş yapıldığını görün. Şüpheli oturumları tek tıkla sonlandırın.' },
];

const steps = [
  { n: '01', title: 'XML Kaynağı Ekle', desc: 'Tedarikçinizin XML linkini yapıştırın. Sistem otomatik analiz eder ve senkronizasyonu başlatır.' },
  { n: '02', title: 'Eşleştir ve Fiyatlandır', desc: 'Kategori eşleştirme yapın, kâr marjı ve kargo kurallarını tanımlayın.' },
  { n: '03', title: 'Pazaryerine Gönder', desc: 'Ürünleri Trendyol\'a toplu gönderin. Stok ve fiyat otomatik izlenmeye devam etsin.' },
];

const stats = [
  { value: '10.000+', label: 'Ürün Yönetimi' },
  { value: '%99.9', label: 'Uptime Garantisi' },
  { value: '2 dk', label: 'Kurulum Süresi' },
  { value: '7/24', label: 'Destek' },
];

const marketplaces = [
  { name: 'Trendyol',    color: '#f27a1a', letter: 'T', status: 'active' },
  { name: 'Hepsiburada', color: '#ff6000', letter: 'H', status: 'active' },
  { name: 'Pazarama',    color: '#1565c0', letter: 'P', status: 'development' },
  { name: 'Amazon',      color: '#ff9900', letter: 'A', status: 'development' },
  { name: 'N11',         color: '#7b2d8e', letter: 'N', status: 'development' },
  { name: 'Çiçeksepeti', color: '#69b22a', letter: 'Ç', status: 'development' },
  { name: 'Pttavm',      color: '#e30000', letter: 'P', status: 'development' },
];

const navLinks = [
  { href: '#features', label: 'Özellikler' },
  { href: '#how', label: 'Nasıl Çalışır?' },
  { href: '#pricing', label: 'Fiyatlar' },
];

export default function LandingPage() {
  const [plans, setPlans] = useState([]);
  const [footerSections, setFooterSections] = useState([]);
  const [footerSettings, setFooterSettings] = useState({});
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetchPlans();
    fetchFooter();
  }, []);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const fetchPlans = async () => {
    try { const res = await api.get('/public/pricing-plans'); setPlans(res.data); } catch {}
  };
  const fetchFooter = async () => {
    try {
      const res = await api.get('/public/footer-sections');
      if (res.data.sections) setFooterSections(res.data.sections);
      if (res.data.settings) setFooterSettings(res.data.settings);
    } catch {}
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="lp-root">

      {/* ── NAV ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo" onClick={closeMenu}>
            <div className="lp-logo-icon">M</div>
            <span>ModulPOS</span>
          </Link>

          <div className="lp-nav-links">
            {navLinks.map(l => <a key={l.href} href={l.href}>{l.label}</a>)}
          </div>

          <div className="lp-nav-actions">
            <Link to="/login" className="lp-btn-ghost">Giriş Yap</Link>
            <Link to="/register" className="lp-btn-primary">Ücretsiz Başla</Link>
          </div>

          <button
            className="lp-hamburger"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menüyü aç/kapat"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {/* ── MOBILE DRAWER ── */}
      {menuOpen && <div className="lp-drawer-overlay" onClick={closeMenu} />}
      <div className={`lp-drawer ${menuOpen ? 'open' : ''}`}>
        <div className="lp-drawer-header">
          <Link to="/" className="lp-logo" onClick={closeMenu}>
            <div className="lp-logo-icon">M</div>
            <span>ModulPOS</span>
          </Link>
          <button className="lp-hamburger" onClick={closeMenu}><X size={22} /></button>
        </div>
        <div className="lp-drawer-links">
          {navLinks.map(l => (
            <a key={l.href} href={l.href} onClick={closeMenu}>{l.label}</a>
          ))}
        </div>
        <div className="lp-drawer-actions">
          <Link to="/login" className="lp-btn-ghost lp-btn-full" onClick={closeMenu}>Giriş Yap</Link>
          <Link to="/register" className="lp-btn-primary lp-btn-full" onClick={closeMenu}>Ücretsiz Başla <ArrowRight size={15} /></Link>
        </div>
      </div>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-grid-bg" />
        <div className="lp-glow lp-glow-1" />
        <div className="lp-glow lp-glow-2" />

        <div className="lp-hero-inner">
          <div className="lp-hero-badge">
            <Zap size={12} /> Türkiye'nin En Hızlı Pazaryeri Entegrasyon Platformu
          </div>
          <h1 className="lp-hero-title">
            Tüm Pazaryerlerinizi<br />
            <span className="lp-gradient-text">Tek Yerden Yönetin</span>
          </h1>
          <p className="lp-hero-desc">
            XML tedarikçi bağlantısından Trendyol satışına kadar tüm süreç otomatik.
            BuyBox izleme, AI müşteri yanıtlama ve zengin bildirimlerle rekabette öne geçin.
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

        {/* Mockup — hidden on mobile via CSS */}
        <div className="lp-mockup">
          <div className="lp-mockup-bar"><span /><span /><span /></div>
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

        {/* Mobilde mockup yerine mini stat kartları */}
        <div className="lp-hero-mobile-stats">
          {stats.map(s => (
            <div key={s.label} className="lp-hero-mobile-stat">
              <div className="lp-stat-value">{s.value}</div>
              <div className="lp-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="lp-stats">
        {stats.map(s => (
          <div key={s.label} className="lp-stat-item">
            <div className="lp-stat-value">{s.value}</div>
            <div className="lp-stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* ── MARKETPLACES ── */}
      <section className="lp-section lp-section-alt lp-mp-section">
        <div className="lp-section-inner">
          <div className="lp-section-header" style={{ marginBottom: 36 }}>
            <div className="lp-badge-label">Entegrasyonlar</div>
            <h2>Desteklenen <span className="lp-gradient-text">Pazaryerleri</span></h2>
            <p>Aktif entegrasyonlarla satışa başlayın, yeni platformlar çok yakında geliyor</p>
          </div>
          <div className="lp-mp-grid">
            {marketplaces.map((m) => (
              <div key={m.name} className={`lp-mp-card ${m.status === 'active' ? 'active' : ''}`}>
                <div className="lp-mp-icon" style={{ background: `${m.color}18`, border: `1.5px solid ${m.color}35`, color: m.color }}>
                  {m.letter}
                </div>
                <div className="lp-mp-name">{m.name}</div>
                {m.status === 'active'
                  ? <span className="lp-mp-badge active">Aktif</span>
                  : <span className="lp-mp-badge soon">Yapım Aşamasında</span>
                }
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="lp-section" id="features">
        <div className="lp-section-inner">
          <div className="lp-section-header">
            <div className="lp-badge-label">Özellikler</div>
            <h2>İhtiyacınız olan her şey <span className="lp-gradient-text">burada</span></h2>
            <p>Tedarikçi yönetiminden pazaryeri entegrasyonuna, BuyBox takibinden AI yanıtlamaya tek platform</p>
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

      {/* ── HOW IT WORKS ── */}
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
                <div className="lp-step-body">
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="lp-section" id="pricing">
        <div className="lp-section-inner">
          <div className="lp-section-header">
            <div className="lp-badge-label">Fiyatlar</div>
            <h2>Şeffaf ve <span className="lp-gradient-text">uygun fiyat</span></h2>
            <p>İhtiyacınıza göre plan seçin, istediğiniz zaman değiştirin</p>
          </div>

          <div className="lp-billing-toggle">
            <span className={billingCycle === 'monthly' ? 'active' : ''}>Aylık</span>
            <button
              onClick={() => setBillingCycle(c => c === 'monthly' ? 'yearly' : 'monthly')}
              className={`lp-toggle-btn ${billingCycle === 'yearly' ? 'on' : ''}`}
              aria-label="Yıllık/Aylık değiştir"
            >
              <span className="lp-toggle-knob" />
            </button>
            <span className={billingCycle === 'yearly' ? 'active' : ''}>
              Yıllık <em>%20 İndirim</em>
            </span>
          </div>

          <div className="lp-pricing-scroll">
            <div className="lp-pricing-grid">
              {(plans.length > 0 ? plans : [
                { name: 'Başlangıç', price: '₺—', yearlyPrice: '', features: ['1.000 Ürün Limiti', '1 XML Kaynağı', 'Trendyol Entegrasyonu', 'Temel Destek'], ctaText: 'Hemen Başla', isHighlighted: false },
                { name: 'Profesyonel', price: '₺—', yearlyPrice: '', features: ['10.000 Ürün Limiti', '5 XML Kaynağı', 'Trendyol Entegrasyonu', 'BuyBox İzleme', 'AI Müşteri Yanıtlama', 'Öncelikli Destek'], ctaText: 'Hemen Başla', isHighlighted: true },
                { name: 'Kurumsal', price: '₺—', yearlyPrice: '', features: ['Sınırsız Ürün', 'Sınırsız XML Kaynağı', 'Trendyol Entegrasyonu', 'BuyBox İzleme', 'AI Müşteri Yanıtlama', '7/24 Öncelikli Destek'], ctaText: 'Bize Ulaşın', isHighlighted: false },
              ]).map((plan, i) => {
                const showYearly = billingCycle === 'yearly' && plan.yearlyPrice;
                const displayPrice = showYearly ? plan.yearlyPrice : plan.price;
                const displayPeriod = showYearly ? '/ yıl' : '/ ay';
                return (
                  <div key={i} className={`lp-price-card ${plan.isHighlighted ? 'highlighted' : ''}`}>
                    {plan.isHighlighted && <div className="lp-popular-badge">En Popüler</div>}
                    <div className="lp-price-name">{plan.name}</div>
                    <div className="lp-price-amount">
                      <span className="lp-price-value">{displayPrice}</span>
                      <span className="lp-price-period">{displayPeriod}</span>
                    </div>
                    <ul className="lp-price-features">
                      {(Array.isArray(plan.features) ? plan.features : JSON.parse(plan.features || '[]')).map(f => (
                        <li key={f}><CheckCircle size={14} /> {f}</li>
                      ))}
                    </ul>
                    <Link to="/register" className={`lp-price-cta ${plan.isHighlighted ? 'primary' : 'ghost'}`}>
                      {plan.ctaText}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
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

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <Link to="/" className="lp-logo">
              <div className="lp-logo-icon">M</div>
              <span>ModulPOS</span>
            </Link>
            <p>{footerSettings.footer_description || 'Tüm pazaryerlerinizi tek platformdan yönetin. E-ticaret operasyonlarınızı otomatikleştirin ve satışlarınızı artırın.'}</p>
            <div className="lp-footer-contact">
              <strong>{footerSettings.footer_company_name || 'EVİNSO Bilişim Yazılım Ve Danışmanlık'}</strong><br />
              {footerSettings.footer_address || 'Bilişim Vadisi, Teknoloji Blv. No:1, Gebze / Kocaeli'}<br />
              {footerSettings.footer_email || 'info@modulpos.com'} | {footerSettings.footer_phone || '0850 000 00 00'}
            </div>
          </div>

          {(footerSections.length > 0 ? footerSections : [
            { title: 'Ürün', links: [{ label: 'Özellikler', url: '#features' }, { label: 'Fiyatlandırma', url: '#pricing' }, { label: 'Nasıl Çalışır?', url: '#how' }, { label: 'Ücretsiz Başla', url: '/register' }] },
            { title: 'Yasal Sözleşmeler', links: [{ label: 'Mesafeli Satış Sözleşmesi', url: '/policy/mesafeli-satis-sozlesmesi' }, { label: 'İptal ve İade Koşulları', url: '/policy/iptal-ve-iade-kosullari' }, { label: 'Gizlilik ve Güvenlik Politikası', url: '/policy/gizlilik-ve-guvenlik-politikasi' }, { label: 'Teslimat Koşulları', url: '/policy/teslimat-kosullari' }, { label: 'Kullanım Şartları', url: '/policy/kullanim-sartlari' }] },
            { title: 'Kurumsal', links: [{ label: 'Hakkımızda', url: '/policy/hakkimizda' }, { label: 'İletişim', url: '/policy/iletisim' }, { label: 'Kariyer', url: '#' }, { label: 'Destek Merkezi', url: '#' }] },
          ]).map((section, idx) => (
            <div key={idx} className="lp-footer-col">
              <h4>{section.title}</h4>
              <ul>
                {(Array.isArray(section.links) ? section.links : JSON.parse(section.links || '[]')).map((link, lIdx) => (
                  <li key={lIdx}>
                    {link.url.startsWith('#') ? <a href={link.url}>{link.label}</a> : <Link to={link.url}>{link.label}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="lp-footer-bottom">
          <p>{footerSettings.footer_copyright || `© ${new Date().getFullYear()} ModulPOS. Tüm hakları saklıdır.`}</p>
          <div className="lp-footer-payment-icons">
            <span className="lp-payment-label">Güvenli Ödeme:</span>
            <div className="lp-payment-methods">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></svg>
              <span>Visa</span><span className="lp-dot">•</span>
              <span>Mastercard</span><span className="lp-dot">•</span>
              <span>Troy</span>
              <div className="lp-divider-v" />
              <span className="lp-paytr">PAY<em>TR</em></span>
            </div>
            <div className="lp-ssl">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /></svg>
              <span>128 Bit SSL</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
