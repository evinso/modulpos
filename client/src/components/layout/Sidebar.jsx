import { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, FileCode2, Store, ShoppingCart, Tags, MessageSquare, FolderTree, Send, ArrowLeftRight, Shield, Globe, Wallet, CreditCard, Activity, Truck, TrendingUp, ChevronDown, RefreshCw, BookOpen, Flower } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

const STATUS_BADGE = {
  active:      { label: 'Aktif',            color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  maintenance: { label: 'Bakımda',          color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  development: { label: 'Yapım Aşamasında', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
};

function MpBadge({ status }) {
  const s = STATUS_BADGE[status];
  if (!s) return null;
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap', letterSpacing: 0.3 }}>
      {s.label}
    </span>
  );
}

const TRENDYOL_ROUTES      = ['/category-mapping', '/trendyol-send', '/buybox', '/questions'];
const HEPSIBURADA_ROUTES   = ['/hepsiburada-send', '/hepsiburada-mapping', '/hepsiburada-create', '/hepsiburada-buybox', '/hepsiburada-questions', '/hepsiburada-update'];
const PAZARAMA_ROUTES      = ['/pazarama-send', '/pazarama-mapping', '/pazarama-orders'];
const CICEKSEPETI_ROUTES   = ['/ciceksepeti-send'];

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
  { to: '/hepsiburada-questions', icon: MessageSquare, label: 'Müşteri Soruları' },
  { to: '/hepsiburada-update', icon: RefreshCw, label: 'Ürün Güncelle' },
];

const pazaramaItems = [
  { to: '/pazarama-mapping', icon: FolderTree, label: 'Kategori Eşleştirme' },
  { to: '/pazarama-send',    icon: Send,        label: 'Ürün Gönder / Güncelle' },
  { to: '/pazarama-orders',  icon: ShoppingCart, label: 'Siparişler' },
];

const ciceksepetiItems = [
  { to: '/ciceksepeti-send', icon: ArrowLeftRight, label: 'Ürünler & Siparişler' },
];

export default function Sidebar({ isOpen }) {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const location = useLocation();

  const isTrendyolActive    = TRENDYOL_ROUTES.some(r => location.pathname.startsWith(r));
  const isHepsiburadaActive = HEPSIBURADA_ROUTES.some(r => location.pathname.startsWith(r));
  const isPazaramaActive    = PAZARAMA_ROUTES.some(r => location.pathname.startsWith(r));
  const isCiceksepetiActive = CICEKSEPETI_ROUTES.some(r => location.pathname.startsWith(r));
  const [trendyolOpen, setTrendyolOpen]           = useState(isTrendyolActive);
  const [hepsiburadaOpen, setHepsiburadaOpen]     = useState(isHepsiburadaActive);
  const [pazaramaOpen, setPazaramaOpen]           = useState(isPazaramaActive);
  const [ciceksepetiOpen, setCiceksepetiOpen]     = useState(isCiceksepetiActive);

  const [mpStatuses, setMpStatuses] = useState({});
  useEffect(() => {
    api.get('/marketplace/statuses').then(r => setMpStatuses(r.data)).catch(() => {});
  }, []);

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
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
          <NavLink to="/guide" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BookOpen size={18} className="icon" /><span>Kullanma Kılavuzu</span>
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
            <MpBadge status={mpStatuses.trendyol} />
            <ChevronDown
              size={14}
              style={{ transition: 'transform 0.2s', transform: trendyolOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
            />
          </button>

          {trendyolOpen && (
            <div style={{ marginLeft: 12, borderLeft: '2px solid var(--border-color)', paddingLeft: 8, marginBottom: 2 }}>
              {trendyolItems.map(item => {
                const disabled = mpStatuses.trendyol === 'maintenance';
                if (disabled) return (
                  <div key={item.to} className="nav-item" style={{ fontSize: 13, opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </div>
                );
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ fontSize: 13 }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </NavLink>
                );
              })}
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
            <MpBadge status={mpStatuses.hepsiburada} />
            <ChevronDown
              size={14}
              style={{ transition: 'transform 0.2s', transform: hepsiburadaOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
            />
          </button>

          {hepsiburadaOpen && (
            <div style={{ marginLeft: 12, borderLeft: '2px solid var(--border-color)', paddingLeft: 8, marginBottom: 2 }}>
              {hepsiburadaItems.map(item => {
                const disabled = mpStatuses.hepsiburada === 'maintenance';
                if (disabled) return (
                  <div key={item.to} className="nav-item" style={{ fontSize: 13, opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </div>
                );
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ fontSize: 13 }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}

          {/* Pazarama collapsible */}
          <button
            onClick={() => setPazaramaOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: isPazaramaActive ? 'rgba(21,101,192,0.10)' : 'transparent',
              color: isPazaramaActive ? '#1565c0' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: isPazaramaActive ? 600 : 400, marginTop: 2,
            }}
          >
            <Store size={18} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left' }}>Pazarama</span>
            <MpBadge status={mpStatuses.pazarama} />
            <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: pazaramaOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }} />
          </button>

          {pazaramaOpen && (
            <div style={{ marginLeft: 12, borderLeft: '2px solid var(--border-color)', paddingLeft: 8, marginBottom: 2 }}>
              {pazaramaItems.map(item => {
                const disabled = mpStatuses.pazarama === 'maintenance';
                if (disabled) return (
                  <div key={item.to} className="nav-item" style={{ fontSize: 13, opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </div>
                );
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ fontSize: 13 }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}

          {/* Çiçeksepeti collapsible */}
          <button
            onClick={() => setCiceksepetiOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: isCiceksepetiActive ? 'rgba(105,178,42,0.10)' : 'transparent',
              color: isCiceksepetiActive ? '#69b22a' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: isCiceksepetiActive ? 600 : 400, marginTop: 2,
            }}
          >
            <Store size={18} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left' }}>Çiçeksepeti</span>
            <MpBadge status={mpStatuses.ciceksepeti} />
            <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: ciceksepetiOpen ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }} />
          </button>

          {ciceksepetiOpen && (
            <div style={{ marginLeft: 12, borderLeft: '2px solid var(--border-color)', paddingLeft: 8, marginBottom: 2 }}>
              {ciceksepetiItems.map(item => {
                const disabled = mpStatuses.ciceksepeti === 'maintenance';
                if (disabled) return (
                  <div key={item.to} className="nav-item" style={{ fontSize: 13, opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </div>
                );
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} style={{ fontSize: 13 }}>
                    <item.icon size={16} className="icon" /><span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}

          {/* Diğer pazaryerleri */}
          {[
            { label: 'Amazon', key: 'amazon' },
            { label: 'N11',    key: 'n11' },
            { label: 'Pttavm', key: 'pttavm' },
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
              <MpBadge status={mpStatuses[mp.key] || 'development'} />
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
            <NavLink to="/whatsapp" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <MessageSquare size={18} className="icon" /><span>WhatsApp</span>
            </NavLink>
          </div>
        )}

      </nav>
    </aside>
  );
}
