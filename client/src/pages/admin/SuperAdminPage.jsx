import { useState, useEffect } from 'react';
import api from '../../services/api';
import { 
  Users, Store, Package, ShoppingCart, CreditCard, Shield, Search, 
  MoreVertical, CheckCircle, XCircle, UserPlus, Mail, Calendar, 
  Trash2, Edit, Check, X, RefreshCcw
} from 'lucide-react';
import toast from 'react-hot-toast';
import './SuperAdminPage.css';

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState('users');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const statsRes = await api.get('/admin/stats');
      setStats(statsRes.data);

      if (activeTab === 'users') {
        const usersRes = await api.get('/admin/users');
        setUsers(usersRes.data);
      } else {
        const storesRes = await api.get('/admin/stores');
        setStores(storesRes.data);
      }
    } catch (error) {
      console.error('Admin verileri yüklenemedi:', error);
      toast.error('Veriler yüklenirken hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    setActionLoading(userId);
    try {
      await api.post(`/admin/users/${userId}/role`, { role: newRole });
      toast.success('Kullanıcı rolü güncellendi');
      fetchData();
    } catch (error) {
      toast.error('Rol güncellenemedi');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (userId) => {
    setActionLoading(userId);
    try {
      await api.post(`/admin/users/${userId}/toggle-status`);
      toast.success('Durum güncellendi');
      fetchData();
    } catch (error) {
      toast.error('İşlem başarısız');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExtendSubscription = async (userId, days) => {
    setActionLoading(userId);
    try {
      await api.post(`/admin/users/${userId}/subscription`, { days });
      toast.success(`${days} gün süre eklendi`);
      fetchData();
    } catch (error) {
      toast.error('Süre uzatılamadı');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredStores = stores.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.user?.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading && !stats) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div className="admin-page">
      <div className="admin-header-flex">
        <div className="page-title">
          <h1>Süper Admin Paneli</h1>
          <p>Sistem genelindeki tüm kaynakları buradan yönetin.</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchData}>
          <RefreshCcw size={16} className={loading ? 'spinning' : ''} /> Yenile
        </button>
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

      {/* Tabs */}
      <div className="admin-tabs">
        <button 
          className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <Users size={16} /> Kullanıcılar
        </button>
        <button 
          className={`admin-tab ${activeTab === 'stores' ? 'active' : ''}`}
          onClick={() => setActiveTab('stores')}
        >
          <Store size={16} /> Mağazalar
        </button>
      </div>

      <div className="admin-content">
        <div className="table-container">
          <div className="table-header">
            <h3>{activeTab === 'users' ? 'Kullanıcı Yönetimi' : 'Tüm Mağazalar'}</h3>
            <div className="header-search">
              <Search size={14} className="search-icon" />
              <input 
                type="text" 
                placeholder={activeTab === 'users' ? "Kullanıcı veya e-posta ara..." : "Mağaza veya sahip ara..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {activeTab === 'users' ? (
            <table>
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>Rol</th>
                  <th>Mağazalar</th>
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
                      <select 
                        className="admin-select"
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value)}
                        disabled={actionLoading === user.id}
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="operator">Operator</option>
                      </select>
                    </td>
                    <td>
                      <div className="user-subscription-info">
                        {user.subscriptions?.[0] ? (
                          <>
                            <span className="text-xs font-semibold block uppercase">
                              {user.subscriptions[0].plan}
                            </span>
                            <span className={`text-xs ${new Date(user.subscriptions[0].endDate) < new Date() ? 'text-danger' : 'text-muted'}`}>
                              Bitiş: {new Date(user.subscriptions[0].endDate).toLocaleDateString('tr-TR')}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted text-xs">Abonelik yok</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <button 
                        className={`badge ${user.isActive ? 'badge-success' : 'badge-danger'} clickable`}
                        onClick={() => handleToggleStatus(user.id)}
                        disabled={actionLoading === user.id}
                      >
                        {user.isActive ? 'Aktif' : 'Pasif'}
                      </button>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button 
                          className="header-icon-btn" 
                          title="Süreyi 30 Gün Uzat"
                          onClick={() => handleExtendSubscription(user.id, 30)}
                          disabled={actionLoading === user.id}
                        >
                          <Calendar size={14} />
                        </button>
                        <button className="header-icon-btn text-danger"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mağaza Adı</th>
                  <th>Sahibi</th>
                  <th>Ürün Sayısı</th>
                  <th>XML Sayısı</th>
                  <th>Sipariş Sayısı</th>
                  <th>Kuruluş</th>
                </tr>
              </thead>
              <tbody>
                {filteredStores.map(store => (
                  <tr key={store.id}>
                    <td>
                      <div className="store-cell">
                        <Store size={16} className="text-muted" />
                        <span className="font-semibold">{store.name}</span>
                      </div>
                    </td>
                    <td>
                      <div className="user-email">{store.user?.email}</div>
                    </td>
                    <td><span className="badge badge-info">{store._count.products}</span></td>
                    <td><span className="badge badge-primary">{store._count.xmlSources}</span></td>
                    <td><span className="badge badge-success">{store._count.orders}</span></td>
                    <td>{new Date(store.createdAt).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
