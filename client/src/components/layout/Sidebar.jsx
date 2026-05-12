import { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, FileCode2, Store, ShoppingCart, Tags, MessageSquare, FolderTree, Send, ArrowLeftRight, Shield, Globe, Wallet, CreditCard, Activity, Truck, TrendingUp, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const TRENDYOL_ROUTES = ['/category-mapping', '/trendyol-send', '/buybox', '/questions'];

const generalItems = [
  { to: '/xml-sources', icon: FileCode2, label: 'XML Kaynakları' },
  { to: '/xml-converter', icon: ArrowLeftRight, label: 'XML Dönüştürücü' },
  { to: '/global-xml-market', icon: Store, label: 'Hazır XML Market', badge: 'Yeni' },
  { to: '/marketplace', icon: Store, label: 'Pazaryerleri' },
];

const trendyolItems = [
  { to: '/category-mapping', icon: FolderTree, label: 'Kategori Eşleştirme' },
  { to: '/trendyol-send', icon: Send, label: 'Pazaryerine Gönder' },
  { to: '/buybox', icon: TrendingUp, label: 'BuyBox İzleme' },
  { to: '/questions', icon: MessageSquare, label: 'Müşteri Soruları' },
];

const mainItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/products', icon: Package, label: 'Ürünler' },
  { to: '/orders', icon: ShoppingCart, label: 'Siparişler' },
  { to: '/dropship-orders', icon: Truck, label: 'Tedarikçi Siparişleri' },
];

const managementItems = [
  { to: '/pricing', icon: Tags, label: 'Fiyatlandırma' },
  { to: '/credits', icon: Wallet, label: 'Kredi & Bakiye' },
  { to: '/logs', icon: Activity, label: 'İşlem Logları' },
];

export default function Sidebar() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const location = useLocation();

  const isTrendyolActive = TRENDYOL_ROUTES.some(r => location.pathname.startsWith(r));
  const [trendyolOpen, setTrendyolOpen] = useState(isTrendyolActive);

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
          {mainItems.map(item => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <item.icon size={18} className="icon" />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <NavLink to="/support" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <MessageSquare size={18} className="icon" />
            <span>Destek</span>
          </NavLink>
        </div>

        {/* Entegrasyon */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Entegrasyon</div>
          {generalItems.map(item => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <item.icon size={18} className="icon" />
              <span>{item.label}</span>
              {item.badge && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, background: 'var(--accent-primary)', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>{item.badge}</span>}
            </NavLink>
          ))}

          {/* Trendyol collapsible group */}
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
                  <item.icon size={16} className="icon" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>

        {/* Yönetim */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Yönetim</div>
          {managementItems.map(item => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <item.icon size={18} className="icon" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* Sistem Yönetimi (admin only) */}
        {isAdmin && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Sistem Yönetimi</div>
            <NavLink to="/superadmin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Shield size={18} className="icon" />
              <span>Süper Admin</span>
            </NavLink>
            <NavLink to="/global-xml-admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Globe size={18} className="icon" />
              <span>Global XML (Admin)</span>
            </NavLink>
            <NavLink to="/credit-admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <CreditCard size={18} className="icon" />
              <span>Kredi Yönetimi</span>
            </NavLink>
            <NavLink to="/questions-admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <MessageSquare size={18} className="icon" />
              <span>Soru Kuralları (Admin)</span>
            </NavLink>
          </div>
        )}

      </nav>
    </aside>
  );
}
