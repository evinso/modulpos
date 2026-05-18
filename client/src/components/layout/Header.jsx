import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Search, Bell, LogOut, User, Settings, Shield, CreditCard, ChevronDown, Check, Clock, Info, Menu } from 'lucide-react';
import NotificationDetailModal from '../NotificationDetailModal';

import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

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

export default function Header({ onMenuClick }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const title = pageTitles[location.pathname] || 'Panel';

  const notificationRef = useRef(null);
  const userMenuRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await api.get('/notifications?unreadOnly=false&limit=20');
      setNotifications(response.data);
    } catch {}
  }, []);

  useEffect(() => {
    document.title = `ModulPOS / ${title}`;
  }, [title]);

  // Initial load + SSE real-time updates
  useEffect(() => {
    fetchNotifications();

    const stored = localStorage.getItem('auth-storage');
    const token = stored ? JSON.parse(stored)?.state?.token : null;
    if (!token) return;

    const es = new EventSource(`${API_BASE}/notifications/stream?token=${encodeURIComponent(token)}`);

    es.onmessage = (e) => {
      try {
        const notification = JSON.parse(e.data);
        setNotifications(prev => {
          if (prev.find(n => n.id === notification.id)) return prev;
          return [notification, ...prev].slice(0, 20);
        });
      } catch {}
    };

    es.onerror = () => {
      es.close();
      // fallback: poll every 30s if SSE fails
      const fallback = setInterval(fetchNotifications, 30000);
      return () => clearInterval(fallback);
    };

    return () => es.close();
  }, [fetchNotifications]);

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

  const handleNotificationClick = async (n) => {
    setShowNotifications(false);
    setSelectedNotification(n);
    if (!n.isRead) handleMarkAsRead(n.id);
  };

  const handleNotificationNavigate = (link) => {
    setSelectedNotification(null);
    if (link.startsWith('http')) {
      window.open(link, '_blank');
    } else {
      navigate(link);
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

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    if (showUserMenu && user?.subscriptions?.[0]) {
      const timer = setInterval(() => setCurrentTime(new Date()), 1000);
      return () => clearInterval(timer);
    }
  }, [showUserMenu, user]);

  const getRemainingTime = (endDateStr) => {
    const diff = new Date(endDateStr) - new Date();
    if (diff <= 0) return 'Süresi Bitti';
    
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / 1000 / 60) % 60);
    const s = Math.floor((diff / 1000) % 60);

    let res = [];
    if (d > 0) res.push(`${d}g`);
    if (d > 0 || h > 0) res.push(`${h}s`);
    if (d > 0 || h > 0 || m > 0) res.push(`${m}d`);
    res.push(`${s}sn`);

    return res.join(' ') + ' kaldı';
  };

  return (
    <>
    <header className="header">
      <div className="header-left">
        <button className="hamburger-btn" onClick={onMenuClick} aria-label="Menüyü aç">
          <Menu size={22} />
        </button>
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
                      onClick={() => handleNotificationClick(n)}
                      style={{ cursor: 'pointer' }}
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
                  {user?.subscriptions?.[0] && (
                    <div className={`user-trial-badge ${new Date(user.subscriptions[0].endDate) < new Date() ? 'expired' : ''}`}>
                      {getRemainingTime(user.subscriptions[0].endDate)}
                    </div>
                  )}
                </div>
              </div>
              <div className="dropdown-body">
                <div className="dropdown-section">
                  <Link to="/settings?tab=profile" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                    <User size={14} /> Profil Bilgileri
                  </Link>
                  <Link to="/settings?tab=general" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                    <Settings size={14} /> Genel Ayarlar
                  </Link>
                </div>
                <div className="dropdown-section">
                  <Link to="/settings?tab=billing" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
                    <CreditCard size={14} /> Faturalandırma
                  </Link>
                  <Link to="/settings?tab=security" className="dropdown-item" onClick={() => setShowUserMenu(false)}>
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

    {/* Notification Detail Modal */}
    {selectedNotification && (
      <NotificationDetailModal
        notification={selectedNotification}
        onClose={() => setSelectedNotification(null)}
        onNavigate={handleNotificationNavigate}
      />
    )}
    </>
  );
}
