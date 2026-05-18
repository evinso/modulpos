import { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, FileCode2, Store, ShoppingCart, Tags, MessageSquare, FolderTree, Send, ArrowLeftRight, Shield, Globe, Wallet, CreditCard, Activity, Truck, TrendingUp, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const TRENDYOL_ROUTES = ['/category-mapping', '/trendyol-send', '/buybox', '/questions'];
const HEPSIBURADA_ROUTES = ['/hepsiburada-send', '/hepsiburada-mapping', '/hepsiburada-create', '/hepsiburada-buybox'];

const trendyolItems = [
  { to: '/category-mapping', icon: FolderTree, label: 'Kategori Eşleştirme' },
  { to: '/trendyol-send', icon: Send, label: 'Pazaryerine Gönder' },
  { to: '/buybox', icon: TrendingUp, label: 'BuyBox İzleme' },
  { to: '/questions', icon: MessageSquare, label: 'Müşteri Soruları' },
];

const hepsiburadaItems = [
  { to: '/hepsiburada-mapping', icon: FolderTree, label: 'Kategori Eşleştirme' },
  { to: '/hepsiburada-create', icon: Send, label: 'Yeni Ürün Listele' },
  { to: '/hepsiburada-buybox', icon: TrendingUp, label: 'BuyBox Sırası' },
  { to: '/hepsiburada-send', icon: ArrowLeftRight, label: 'Stok/Fiyat Güncelle' },
];

export default function Sidebar() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const location = useLocation();

  const isTrendyolActive = TRENDYOL_ROUTES.some(r => location.pathname.startsWith(r));
  const isHepsiburadaActive = HEPSIBURADA_ROUTES.some(r => location.pathname.startsWith(r));
  const [trendyolOpen, setTrendyolOpen] = useState(isTrendyolActive);
  const [hepsiburadaOpen, setHepsiburadaOpen] = useState(isHepsiburadaActive);

  return (
    <aside className="sidebar">
      <Link to="/dashboard" className="sidebar-logo">
        <div className="logo-icon">M</div>
        <h1>ModulPOS</h1>
      </Link>
      <nav className="sidebar-nav">

        {/* Ana Menü */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Ana Menü</div>
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={18} className="icon" /><span>Dashboard</span>
          </NavLink>
          <NavLink to="/products" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Package size={18} className="icon" /><span>Ürünler</span>
          </NavLink>
          <NavLink to="/orders" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ShoppingCart size={18} className="icon" /><span>Siparişler</span>
          </NavLink>
          <NavLink to="/dropship-orders" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Truck size={18} className="icon" /><span>Tedarikçi Siparişleri</span>
          </NavLink>
          <NavLink to="/support" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <MessageSquare size={18} className="icon" /><span>Destek</span>
          </NavLink>
        </div>

        {/* Pazaryerleri */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Pazaryerleri</div>

          {/* Trendyol collapsible */}
          <button
            onClick={() => setTrendyolOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: isTrendyolActive ? 'rgba(99,102,241,0.10)' : 'transparent',
              color: isTrendyolActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: isTrendyolActive ? 600 : 400,
              marginTop: 2,
            }}
          >
            <Store size={18} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left' }}>Trendyol</span>
            <ChevronDown
              size={14}
              style={{ transition: 'transform 0.2s', transform: trendyolOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
            />
          </button>

          {trendyolOpen && (
            <div style={{ marginLeft: 12, borderLeft: '2px solid var(--border-color)', paddingLeft: 8, marginBottom: 2 }}>
              {trendyolItems.map(item => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ fontSize: 13 }}>
                  <item.icon size={16} className="icon" /><span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}

          {/* Hepsiburada collapsible */}
          <button
            onClick={() => setHepsiburadaOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: isHepsiburadaActive ? 'rgba(255,96,0,0.10)' : 'transparent',
              color: isHepsiburadaActive ? '#ff6000' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: isHepsiburadaActive ? 600 : 400,
              marginTop: 2,
            }}
          >
            <Store size={18} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left' }}>Hepsiburada</span>
            <ChevronDown
              size={14}
              style={{ transition: 'transform 0.2s', transform: hepsiburadaOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
            />
          </button>

          {hepsiburadaOpen && (
            <div style={{ marginLeft: 12, borderLeft: '2px solid var(--border-color)', paddingLeft: 8, marginBottom: 2 }}>
              {hepsiburadaItems.map(item => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ fontSize: 13 }}>
                  <item.icon size={16} className="icon" /><span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}

          {/* Yakında gelecek pazaryerleri */}
          {[
            { label: 'Amazon' },
            { label: 'N11' },
            { label: 'Çiçeksepeti' },
            { label: 'Pttavm' },
          ].map(mp => (
            <div
              key={mp.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 6, marginTop: 2,
                color: 'var(--text-muted)', fontSize: 13, cursor: 'default', opacity: 0.7,
              }}
            >
              <Store size={18} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{mp.label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>Yakında</span>
            </div>
          ))}
        </div>

        {/* Entegrasyon */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Entegrasyon</div>
          <NavLink to="/marketplace" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Store size={18} className="icon" /><span>Pazaryerleri</span>
          </NavLink>
          <NavLink to="/xml-sources" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <FileCode2 size={18} className="icon" /><span>XML Kaynakları</span>
          </NavLink>
          <NavLink to="/xml-converter" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ArrowLeftRight size={18} className="icon" /><span>XML Dönüştürücü</span>
          </NavLink>
          <NavLink to="/global-xml-market" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Store size={18} className="icon" />
            <span>Hazır XML Market</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, background: 'var(--accent-primary)', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>Yeni</span>
          </NavLink>
        </div>

        {/* Yönetim */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Yönetim</div>
          <NavLink to="/pricing" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Tags size={18} className="icon" /><span>Fiyatlandırma</span>
          </NavLink>
          <NavLink to="/credits" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Wallet size={18} className="icon" /><span>Kredi & Bakiye</span>
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Activity size={18} className="icon" /><span>İşlem Logları</span>
          </NavLink>
        </div>

        {/* Sistem Yönetimi (admin only) */}
        {isAdmin && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Sistem Yönetimi</div>
            <NavLink to="/superadmin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Shield size={18} className="icon" /><span>Süper Admin</span>
            </NavLink>
            <NavLink to="/global-xml-admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Globe size={18} className="icon" /><span>Global XML (Admin)</span>
            </NavLink>
            <NavLink to="/credit-admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <CreditCard size={18} className="icon" /><span>Kredi Yönetimi</span>
            </NavLink>
            <NavLink to="/questions-admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <MessageSquare size={18} className="icon" /><span>Soru Kuralları (Admin)</span>
            </NavLink>
          </div>
        )}

      </nav>
    </aside>
  );
}
