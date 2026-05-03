import { useEffect, useState, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Search, Bell, LogOut, User, Settings, Shield, CreditCard, ChevronDown, Check, Clock, Info } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const pageTitles = {
  '/dashboard': 'Dashboard',
  '/products': 'Ürün Yönetimi',
  '/xml-sources': 'XML Kaynakları',
  '/xml-converter': 'XML Dönüştürücü',
  '/marketplace': 'Pazaryeri Bağlantıları',
  '/category-mapping': 'Kategori Eşleştirme',
  '/trendyol-send': 'Pazaryerine Gönder',
  '/orders': 'Sipariş Yönetimi',
  '/pricing': 'Fiyatlandırma Kuralları',
};

const dummyNotifications = [
  { id: 1, title: 'Entegrasyon Başarılı', desc: '1.240 ürün Trendyol\'a başarıyla gönderildi.', type: 'success', time: '5 dk önce' },
  { id: 2, title: 'Stok Uyarısı', desc: 'EB2239-KS kodlu ürünün stoğu kritik seviyede (4 adet).', type: 'warning', time: '1 saat önce' },
  { id: 3, title: 'Yeni Sipariş', desc: 'Trendyol üzerinden yeni bir siparişiniz var.', type: 'info', time: '2 saat önce' },
];

export default function Header() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const title = pageTitles[location.pathname] || 'Panel';

  const notificationRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    document.title = `ModulPOS / ${title}`;
  }, [title]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="header">
      <div className="header-left">
        <h2>{title}</h2>
      </div>
      <div className="header-right">
        <div className="header-search">
          <Search size={14} className="search-icon" />
          <input type="text" placeholder="Ürün, sipariş veya SKU ara..." />
        </div>

        {/* Notifications */}
        <div className="header-dropdown-wrapper" ref={notificationRef}>
          <button className="header-icon-btn" onClick={() => setShowNotifications(!showNotifications)}>
            <Bell size={16} />
            <span className="notification-dot"></span>
          </button>
          {showNotifications && (
            <div className="header-dropdown notifications-dropdown">
              <div className="dropdown-header">
                <h3>Bildirimler</h3>
                <button className="text-btn">Tümünü oku</button>
              </div>
              <div className="dropdown-body">
                {dummyNotifications.map(n => (
                  <div key={n.id} className="notification-item">
                    <div className={`notification-icon ${n.type}`}>
                      {n.type === 'success' && <Check size={14} />}
                      {n.type === 'warning' && <Clock size={14} />}
                      {n.type === 'info' && <Info size={14} />}
                    </div>
                    <div className="notification-content">
                      <div className="notification-title">{n.title}</div>
                      <div className="notification-desc">{n.desc}</div>
                      <div className="notification-time">{n.time}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="dropdown-footer">
                <button className="dropdown-footer-btn">Tüm bildirimleri gör</button>
              </div>
            </div>
          )}
        </div>

        {/* User Menu */}
        <div className="header-dropdown-wrapper" ref={userMenuRef}>
          <div className="user-menu" onClick={() => setShowUserMenu(!showUserMenu)}>
            <div className="user-avatar">
              {user?.name?.charAt(0)?.toLocaleUpperCase('tr-TR') || 'U'}
            </div>
            <div className="user-info">
              <span className="user-name">{user?.name || 'Kullanıcı'}</span>
              <span className="user-role">{user?.role === 'owner' ? 'Mağaza Sahibi' : user?.role}</span>
            </div>
            <ChevronDown size={14} className={`user-menu-chevron ${showUserMenu ? 'open' : ''}`} />
          </div>
          {showUserMenu && (
            <div className="header-dropdown user-dropdown">
              <div className="dropdown-header">
                <div className="user-avatar-large">
                  {user?.name?.charAt(0)?.toLocaleUpperCase('tr-TR') || 'U'}
                </div>
                <div className="user-details">
                  <div className="user-name-large">{user?.name}</div>
                  <div className="user-email">{user?.email || 'user@modulpos.com'}</div>
                </div>
              </div>
              <div className="dropdown-body">
                <div className="dropdown-section">
                  <Link to="/profile" className="dropdown-item">
                    <User size={14} /> Profil Bilgileri
                  </Link>
                  <Link to="/settings" className="dropdown-item">
                    <Settings size={14} /> Genel Ayarlar
                  </Link>
                </div>
                <div className="dropdown-section">
                  <Link to="/billing" className="dropdown-item">
                    <CreditCard size={14} /> Faturalandırma
                  </Link>
                  <Link to="/security" className="dropdown-item">
                    <Shield size={14} /> Güvenlik
                  </Link>
                </div>
                <div className="dropdown-section">
                  <button className="dropdown-item danger" onClick={logout}>
                    <LogOut size={14} /> Çıkış Yap
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
