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

  const [subModalUser, setSubModalUser] = useState(null);
  const [subEndDate, setSubEndDate] = useState('');
  const [subPlan, setSubPlan] = useState('premium');
  const [showOnlyPremium, setShowOnlyPremium] = useState(false);

  const [auditLogs, setAuditLogs] = useState([]);
  const [quotaModalUser, setQuotaModalUser] = useState(null);
  const [quotaData, setQuotaData] = useState({ maxProducts: 5000, maxXmlSources: 3 });

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
      } else if (activeTab === 'stores') {
        const storesRes = await api.get('/admin/stores');
        setStores(storesRes.data);
      } else if (activeTab === 'auditLogs') {
        const logsRes = await api.get('/admin/audit-logs');
        setAuditLogs(logsRes.data);
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

  const [deleteModalUser, setDeleteModalUser] = useState(null);

  const handleDeleteUser = (user) => {
    setDeleteModalUser(user);
  };

  const confirmDeleteUser = async () => {
    if (!deleteModalUser) return;
    setActionLoading(deleteModalUser.id);
    try {
      await api.delete(`/admin/users/${deleteModalUser.id}`);
      toast.success('Kullanıcı başarıyla silindi');
      setDeleteModalUser(null);
      fetchData();
    } catch (error) {
      toast.error('Kullanıcı silinirken bir hata oluştu');
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

  const handleExtendSubscription = async () => {
    if (!subModalUser || !subEndDate) return;
    
    setActionLoading(subModalUser.id);
    try {
      await api.post(`/admin/users/${subModalUser.id}/subscription`, { 
        endDate: new Date(subEndDate).toISOString(),
        plan: subPlan
      });
      toast.success(`Abonelik başarıyla güncellendi`);
      setSubModalUser(null);
      fetchData();
    } catch (error) {
      toast.error('Süre güncellenemedi');
    } finally {
      setActionLoading(null);
    }
  };

  const openSubModal = (user) => {
    setSubModalUser(user);
    if (user.subscriptions?.[0]?.endDate) {
      // Format for datetime-local input
      const date = new Date(user.subscriptions[0].endDate);
      const tzoffset = (new Date()).getTimezoneOffset() * 60000;
      const localISOTime = (new Date(date - tzoffset)).toISOString().slice(0,16);
      setSubEndDate(localISOTime);
      setSubPlan(user.subscriptions[0].plan);
    } else {
      setSubEndDate('');
      setSubPlan('premium');
    }
  };

  const openQuotaModal = (user) => {
    setQuotaModalUser(user);
    setQuotaData({
      maxProducts: user.maxProducts || 5000,
      maxXmlSources: user.maxXmlSources || 3
    });
  };

  const handleUpdateQuota = async () => {
    if (!quotaModalUser) return;
    setActionLoading(quotaModalUser.id);
    try {
      await api.put(`/admin/users/${quotaModalUser.id}/quotas`, quotaData);
      toast.success('Kotalar başarıyla güncellendi');
      setQuotaModalUser(null);
      fetchData();
    } catch (error) {
      toast.error('Kota güncellenemedi');
    } finally {
      setActionLoading(null);
    }
  };

  let filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (showOnlyPremium) {
    filteredUsers = filteredUsers.filter(u => {
      if (!u.subscriptions || u.subscriptions.length === 0) return false;
      const endDate = new Date(u.subscriptions[0].endDate);
      return endDate > new Date(); // Active premium
    });
  }

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
        <button 
          className={`admin-tab ${activeTab === 'auditLogs' ? 'active' : ''}`}
          onClick={() => setActiveTab('auditLogs')}
        >
          <Shield size={16} /> Sistem Logları
        </button>
      </div>

      <div className="admin-content">
        <div className="table-container">
          <div className="table-header" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <h3 style={{ margin: 0, flex: 1, minWidth: 200 }}>{activeTab === 'users' ? 'Kullanıcı Yönetimi' : 'Tüm Mağazalar'}</h3>
            {activeTab === 'users' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', background: 'rgba(59,130,246,0.1)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)', color: 'var(--accent-primary)' }}>
                <input type="checkbox" checked={showOnlyPremium} onChange={e => setShowOnlyPremium(e.target.checked)} />
                Sadece Premium
              </label>
            )}
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
                  <th>Abonelik Bitiş</th>
                  <th>Durum</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => {
                  const sub = user.subscriptions?.[0];
                  const isExpired = sub && new Date(sub.endDate) < new Date();
                  return (
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
                        {sub ? (
                          <>
                            <span className={`text-xs font-semibold block uppercase ${isExpired ? 'text-danger' : 'text-success'}`}>
                              {sub.plan} {isExpired ? '(SÜRESİ BİTTİ)' : ''}
                            </span>
                            <span className={`text-xs ${isExpired ? 'text-danger' : 'text-muted'}`}>
                              Bitiş: {new Date(sub.endDate).toLocaleString('tr-TR')}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted text-xs">Abonelik yok</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <button 
                        className={`badge ${!isExpired && user.isActive ? 'badge-success' : 'badge-danger'} clickable`}
                        onClick={() => handleToggleStatus(user.id)}
                        disabled={actionLoading === user.id}
                      >
                        {isExpired ? 'Pasif (Süresi Bitti)' : (user.isActive ? 'Aktif' : 'Pasif')}
                      </button>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 8px', fontSize: 12, height: 'auto' }}
                          title="Müşteri Kotalarını Düzenle"
                          onClick={() => openQuotaModal(user)}
                          disabled={actionLoading === user.id}
                        >
                          <Settings size={14} style={{ marginRight: 4 }} /> Kota
                        </button>
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 8px', fontSize: 12, height: 'auto' }}
                          title="Abonelik Tarihi Düzenle"
                          onClick={() => openSubModal(user)}
                          disabled={actionLoading === user.id}
                        >
                          <Calendar size={14} style={{ marginRight: 4 }} /> Aktivasyon
                        </button>
                        <button 
                          className="header-icon-btn text-danger"
                          title="Kullanıcıyı Sil"
                          onClick={() => handleDeleteUser(user)}
                          disabled={actionLoading === user.id}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          ) : activeTab === 'stores' ? (
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
          ) : activeTab === 'auditLogs' ? (
            <table>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Kullanıcı</th>
                  <th>İşlem</th>
                  <th>Detay</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 13 }}>{new Date(log.createdAt).toLocaleString('tr-TR')}</td>
                    <td>
                      {log.user ? (
                        <div className="user-meta">
                          <div className="user-name">{log.user.name}</div>
                          <div className="user-email" style={{ fontSize: 11 }}>{log.user.email}</div>
                        </div>
                      ) : (
                        <span className="text-muted">Sistem</span>
                      )}
                    </td>
                    <td><span className="badge badge-primary" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>{log.action}</span></td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-secondary)' }} title={log.details}>
                      {log.details}
                    </td>
                    <td>
                      <span className={`badge ${log.level === 'ERROR' ? 'badge-danger' : log.level === 'WARNING' ? 'badge-warning' : 'badge-info'}`}>
                        {log.level}
                      </span>
                    </td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: 20 }}>Henüz bir sistem aktivitesi bulunmuyor.</td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      {/* Quota Modal */}
      {quotaModalUser && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 0 }}>
            <div className="table-header">
              <h3>Müşteri Kotalarını Düzenle</h3>
              <button className="text-btn" onClick={() => setQuotaModalUser(null)}>Kapat</button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                <strong>{quotaModalUser.name}</strong> adlı kullanıcının sistem sınırlarını buradan değiştirebilirsiniz. Değişiklikler anında yansır ve Audit Log kayıtlarına düşer.
              </p>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Maksimum Ürün Sayısı</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={quotaData.maxProducts}
                  onChange={e => setQuotaData({...quotaData, maxProducts: parseInt(e.target.value) || 0})}
                  min="0"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label">Maksimum XML Kaynağı</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={quotaData.maxXmlSources}
                  onChange={e => setQuotaData({...quotaData, maxXmlSources: parseInt(e.target.value) || 0})}
                  min="0"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setQuotaModalUser(null)}>İptal</button>
                <button className="btn btn-primary" onClick={handleUpdateQuota} disabled={actionLoading === quotaModalUser.id}>
                  {actionLoading === quotaModalUser.id ? 'Kaydediliyor...' : 'Kotaları Kaydet'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {deleteModalUser && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 0 }}>
            <div className="table-header">
              <h3>Kullanıcı Silme Onayı</h3>
              <button className="text-btn" onClick={() => setDeleteModalUser(null)}>Kapat</button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
                <strong>{deleteModalUser.name} ({deleteModalUser.email})</strong> kullanıcısını ve ona ait tüm mağaza, ürün ve XML verilerini silmek istediğinize emin misiniz? <br/><br/>
                <span style={{ color: 'var(--danger)', fontWeight: 500 }}>Bu işlem kesinlikle geri alınamaz!</span>
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setDeleteModalUser(null)}>İptal</button>
                <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: 'white' }} onClick={confirmDeleteUser} disabled={actionLoading === deleteModalUser.id}>
                  {actionLoading === deleteModalUser.id ? 'Siliniyor...' : 'Evet, Sil'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Modal */}
      {subModalUser && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 0 }}>
            <div className="table-header">
              <h3>Aktivasyon / Abonelik Düzenle</h3>
              <button className="text-btn" onClick={() => setSubModalUser(null)}>Kapat</button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                <strong>{subModalUser.name} ({subModalUser.email})</strong> kullanıcısının abonelik bitiş tarihini ve planını doğrudan ayarlayabilirsiniz. Bitiş tarihi gelecekte olan kullanıcılar otomatik olarak "Aktif" duruma geçer.
              </p>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Abonelik Bitiş Tarihi ve Saati</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={subEndDate}
                  onChange={e => setSubEndDate(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Plan Türü</label>
                <select
                  className="form-input"
                  value={subPlan}
                  onChange={e => setSubPlan(e.target.value)}
                >
                  <option value="trial">Deneme Süresi</option>
                  <option value="premium">Premium</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setSubModalUser(null)}>İptal</button>
                <button className="btn btn-primary" onClick={handleExtendSubscription} disabled={actionLoading === subModalUser.id}>
                  {actionLoading === subModalUser.id ? 'Kaydediliyor...' : 'Tarihi Güncelle'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
