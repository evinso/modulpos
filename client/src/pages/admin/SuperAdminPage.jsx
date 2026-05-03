import { useState, useEffect } from 'react';
import api from '../../services/api';
import { Users, Store, Package, ShoppingCart, CreditCard, Shield, Search, MoreVertical, CheckCircle, XCircle } from 'lucide-react';
import './SuperAdminPage.css';

export default function SuperAdminPage() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, usersRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/users')
      ]);
      setStats(statsRes.data);
      setUsers(usersRes.data);
    } catch (error) {
      console.error('Admin verileri yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div className="admin-page">
      <div className="page-title">
        <h1>Süper Admin Paneli</h1>
        <p>Sistem genelindeki tüm kullanıcıları, mağazaları ve istatistikleri yönetin.</p>
      </div>

      {/* Global Stats */}
      <div className="grid grid-4 mb-8">
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon blue"><Users size={20} /></div>
          </div>
          <div className="stat-label">Toplam Kullanıcı</div>
          <div className="stat-value">{stats?.users || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon purple"><Store size={20} /></div>
          </div>
          <div className="stat-label">Toplam Mağaza</div>
          <div className="stat-value">{stats?.stores || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon green"><Package size={20} /></div>
          </div>
          <div className="stat-label">Toplam Ürün</div>
          <div className="stat-value">{stats?.products?.toLocaleString() || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon orange"><CreditCard size={20} /></div>
          </div>
          <div className="stat-label">Aktif Abonelik</div>
          <div className="stat-value">{stats?.subscriptions || 0}</div>
        </div>
      </div>

      {/* User Management */}
      <div className="table-container">
        <div className="table-header">
          <h3>Kullanıcı Yönetimi</h3>
          <div className="header-search">
            <Search size={14} className="search-icon" />
            <input 
              type="text" 
              placeholder="Kullanıcı veya e-posta ara..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Kullanıcı</th>
              <th>Rol</th>
              <th>Mağazalar</th>
              <th>Kayıt Tarihi</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id}>
                <td>
                  <div className="user-cell">
                    <div className="user-avatar-sm">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="user-meta">
                      <div className="user-name">{user.name}</div>
                      <div className="user-email">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`badge badge-${user.role === 'admin' || user.role === 'superadmin' ? 'primary' : 'info'}`}>
                    {user.role}
                  </span>
                </td>
                <td>
                  <div className="store-list">
                    {user.stores.length > 0 ? (
                      user.stores.map(s => (
                        <div key={s.id} className="store-tag" title={`${s._count.products} Ürün, ${s._count.orders} Sipariş`}>
                          {s.name}
                        </div>
                      ))
                    ) : (
                      <span className="text-muted text-xs">Mağaza yok</span>
                    )}
                  </div>
                </td>
                <td>{new Date(user.createdAt).toLocaleDateString('tr-TR')}</td>
                <td>
                  {user.isActive ? (
                    <span className="badge badge-success"><CheckCircle size={12} /> Aktif</span>
                  ) : (
                    <span className="badge badge-danger"><XCircle size={12} /> Pasif</span>
                  )}
                </td>
                <td>
                  <button className="header-icon-btn"><MoreVertical size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
