import { useEffect, useState, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Search, Bell, LogOut, User, Settings, Shield, CreditCard, ChevronDown, Check, Clock, Info } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

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

export default function Header() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const title = pageTitles[location.pathname] || 'Panel';

  const notificationRef = useRef(null);
  const userMenuRef = useRef(null);

  const fetchNotifications = async () => {
    try {
      const response = await api.get('/notifications?unreadOnly=false&limit=10');
      setNotifications(response.data);
    } catch (error) {
      console.error('Bildirimler yüklenemedi:', error);
    }
  };

  useEffect(() => {
    document.title = `ModulPOS / ${title}`;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // 1 dakikada bir kontrol et
    return () => clearInterval(interval);
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

  const handleMarkAsRead = async (id) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch (error) {
      console.error('Bildirim işaretlenemedi:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (error) {
      console.error('Tüm bildirimler işaretlenemedi:', error);
    }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Şimdi';
    if (diffMins < 60) return `${diffMins} dk önce`;
    if (diffHours < 24) return `${diffHours} saat önce`;
    return `${diffDays} gün önce`;
  };

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
            {unreadCount > 0 && <span className="notification-dot"></span>}
          </button>
          {showNotifications && (
            <div className="header-dropdown notifications-dropdown">
              <div className="dropdown-header">
                <h3>Bildirimler ({unreadCount})</h3>
                <button className="text-btn" onClick={handleMarkAllAsRead}>Tümünü oku</button>
              </div>
              <div className="dropdown-body">
                {notifications.length > 0 ? (
                  notifications.map(n => (
                    <div 
                      key={n.id} 
                      className={`notification-item ${n.isRead ? 'read' : 'unread'}`}
                      onClick={() => handleMarkAsRead(n.id)}
                    >
                      <div className={`notification-icon ${n.type}`}>
                        {n.type === 'success' && <Check size={14} />}
                        {n.type === 'warning' && <Clock size={14} />}
                        {n.type === 'info' && <Info size={14} />}
                        {n.type === 'error' && <Info size={14} />}
                      </div>
                      <div className="notification-content">
                        <div className="notification-title">{n.title}</div>
                        <div className="notification-desc">{n.message}</div>
                        <div className="notification-time">{formatDate(n.createdAt)}</div>
                      </div>
                      {!n.isRead && <div className="unread-dot" />}
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-sm text-gray-500">Henüz bildirim yok</div>
                )}
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
