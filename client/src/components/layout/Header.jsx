import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Bell, LogOut } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const pageTitles = {
  '/dashboard': 'Dashboard',
  '/products': 'Ürün Yönetimi',
  '/xml-sources': 'XML Kaynakları',
  '/marketplace': 'Pazaryeri Bağlantıları',
  '/orders': 'Sipariş Yönetimi',
  '/pricing': 'Fiyatlandırma Kuralları',
};

export default function Header() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const title = pageTitles[location.pathname] || 'Panel';

  useEffect(() => {
    document.title = `Modül Pos / ${title}`;
  }, [title]);

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
        <button className="header-icon-btn">
          <Bell size={16} />
          <span className="notification-dot"></span>
        </button>
        <div className="user-menu">
          <div className="user-avatar">
            {user?.name?.charAt(0)?.toLocaleUpperCase('tr-TR') || 'U'}
          </div>
          <div className="user-info">
            <span className="user-name">{user?.name || 'Kullanıcı'}</span>
            <span className="user-role">{user?.role === 'owner' ? 'Mağaza Sahibi' : user?.role}</span>
          </div>
        </div>
        <button className="header-icon-btn" onClick={logout} title="Çıkış Yap">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
