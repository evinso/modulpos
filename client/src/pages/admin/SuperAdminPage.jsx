import { useState, useEffect } from 'react';
import api from '../../services/api';
import { 
  Users, Store, Package, ShoppingCart, CreditCard, Shield, Search, 
  MoreVertical, CheckCircle, XCircle, UserPlus, Mail, Calendar, 
  Trash2, Edit, Check, X, RefreshCcw, Settings, Tags, Plus, List
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

  const [pricingPlans, setPricingPlans] = useState([]);
  const [showPlanModal, setShowPlanModal] = useState(null); // { id, name, price, ... } or 'new'
  const [planForm, setPlanForm] = useState({ name: '', price: '', period: '', features: '', ctaText: 'Hemen Başla', isHighlighted: false, order: 0, isActive: true });

  const [footerSections, setFooterSections] = useState([]);
  const [showFooterModal, setShowFooterModal] = useState(null);
  const [footerForm, setFooterForm] = useState({ title: '', links: [{ label: '', url: '', isExternal: false }], order: 0, isActive: true });
  const [footerBrandSettings, setFooterBrandSettings] = useState({
    footer_company_name: 'ModulPOS Yazılım A.Ş.',
    footer_description: 'Tüm pazaryerlerinizi tek platformdan yönetin. E-ticaret operasyonlarınızı otomatikleştirin ve satışlarınızı artırın.',
    footer_address: 'Bilişim Vadisi, Teknoloji Blv. No:1, Gebze / Kocaeli',
    footer_email: 'info@modulpos.com',
    footer_phone: '0850 000 00 00'
  });

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
      } else if (activeTab === 'pricing') {
        const plansRes = await api.get('/admin/pricing-plans');
        setPricingPlans(plansRes.data);
      } else if (activeTab === 'footer') {
        const footerRes = await api.get('/admin/footer-sections');
        setFooterSections(footerRes.data);
        
        const settingsRes = await api.get('/admin/system-settings?keys=footer_description,footer_address,footer_email,footer_phone,footer_company_name');
        if (Object.keys(settingsRes.data).length > 0) {
          setFooterBrandSettings(prev => ({ ...prev, ...settingsRes.data }));
        }
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

  const handleSavePlan = async (e) => {
    e.preventDefault();
    try {
      const data = {
        ...planForm,
        features: planForm.features.split('\n').filter(f => f.trim())
      };

      if (showPlanModal === 'new') {
        await api.post('/admin/pricing-plans', data);
        toast.success('Yeni plan oluşturuldu');
      } else {
        await api.put(`/admin/pricing-plans/${showPlanModal.id}`, data);
        toast.success('Plan güncellendi');
      }
      setShowPlanModal(null);
      fetchData();
    } catch (error) {
      toast.error('Plan kaydedilemedi');
    }
  };

  const handleDeletePlan = async (id) => {
    if (!window.confirm('Bu planı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/admin/pricing-plans/${id}`);
      toast.success('Plan silindi');
      fetchData();
    } catch (error) {
      toast.error('Plan silinemedi');
    }
  };

  const handleSaveFooter = async (e) => {
    e.preventDefault();
    try {
      const data = {
        ...footerForm,
        links: footerForm.links.filter(l => l.label.trim())
      };

      if (showFooterModal === 'new') {
        await api.post('/admin/footer-sections', data);
        toast.success('Yeni bölüm eklendi');
      } else {
        await api.put(`/admin/footer-sections/${showFooterModal.id}`, data);
        toast.success('Bölüm güncellendi');
      }
      setShowFooterModal(null);
      fetchData();
    } catch (error) {
      toast.error('Bölüm kaydedilemedi');
    }
  };

  const handleDeleteFooter = async (id) => {
    if (!window.confirm('Bu bölümü silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/admin/footer-sections/${id}`);
      toast.success('Bölüm silindi');
      fetchData();
    } catch (error) {
      toast.error('Bölüm silinemedi');
    }
  };

  const handleSaveFooterBrand = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/system-settings', footerBrandSettings);
      toast.success('Footer marka bilgileri güncellendi');
      fetchData();
    } catch (error) {
      toast.error('Bilgiler kaydedilemedi');
    }
  };

  const addFooterLink = () => {
    setFooterForm({
      ...footerForm,
      links: [...footerForm.links, { label: '', url: '', isExternal: false }]
    });
  };

  const removeFooterLink = (index) => {
    setFooterForm({
      ...footerForm,
      links: footerForm.links.filter((_, i) => i !== index)
    });
  };

  const updateFooterLink = (index, field, value) => {
    const newLinks = [...footerForm.links];
    newLinks[index][field] = value;
    setFooterForm({ ...footerForm, links: newLinks });
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
        <button className={`admin-tab ${activeTab === 'auditLogs' ? 'active' : ''}`} onClick={() => setActiveTab('auditLogs')}>
          <Settings size={16} /> Sistem Logları
        </button>
        <button className={`admin-tab ${activeTab === 'pricing' ? 'active' : ''}`} onClick={() => setActiveTab('pricing')}>
          <Tags size={16} /> Fiyat Planları
        </button>
        <button className={`admin-tab ${activeTab === 'footer' ? 'active' : ''}`} onClick={() => setActiveTab('footer')}>
          <List size={16} /> Footer Yönetimi
        </button>
      </div>

      <div className="admin-content">
        <div className="table-container">
          <div className="table-header" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <h3 style={{ margin: 0, flex: 1, minWidth: 200 }}>
              {activeTab === 'users' ? 'Kullanıcı Yönetimi' :
               activeTab === 'stores' ? 'Tüm Mağazalar' :
               activeTab === 'auditLogs' ? 'Sistem Logları' :
               activeTab === 'pricing' ? 'Fiyat Planları' : 'Footer Yönetimi'}
            </h3>
            {activeTab === 'users' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', background: 'rgba(59,130,246,0.1)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)', color: 'var(--accent-primary)' }}>
                <input type="checkbox" checked={showOnlyPremium} onChange={e => setShowOnlyPremium(e.target.checked)} />
                Sadece Premium
              </label>
            )}
            {(activeTab === 'users' || activeTab === 'stores') && (
              <div className="header-search">
                <Search size={14} className="search-icon" />
                <input
                  type="text"
                  placeholder={activeTab === 'users' ? "Kullanıcı veya e-posta ara..." : "Mağaza veya sahip ara..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            )}
            {activeTab === 'pricing' && (
              <button className="btn btn-primary" onClick={() => {
                setPlanForm({ name: '', price: '', period: '', features: '', ctaText: 'Hemen Başla', isHighlighted: false, order: pricingPlans.length, isActive: true });
                setShowPlanModal('new');
              }}>
                <Plus size={16} /> Yeni Plan Ekle
              </button>
            )}
            {activeTab === 'footer' && (
              <button className="btn btn-primary" onClick={() => {
                setFooterForm({ title: '', links: [{ label: '', url: '', isExternal: false }], order: footerSections.length, isActive: true });
                setShowFooterModal('new');
              }}>
                <Plus size={16} /> Yeni Grup Ekle
              </button>
            )}
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
          ) : activeTab === 'pricing' ? (
            <div className="pricing-admin-view">
              <table>
                <thead>
                  <tr>
                    <th>Sıra</th>
                    <th>Plan Adı</th>
                    <th>Fiyat</th>
                    <th>Periyot</th>
                    <th>Özellikler</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {pricingPlans.map(plan => (
                    <tr key={plan.id}>
                      <td style={{ width: 60 }}>{plan.order}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{plan.name}</span>
                          {plan.isHighlighted && <span className="badge badge-info" style={{ fontSize: 10 }}>Öne Çıkan</span>}
                        </div>
                      </td>
                      <td><span className="font-semibold">{plan.price}</span></td>
                      <td><span className="text-muted text-xs">{plan.period}</span></td>
                      <td>
                        <div className="text-xs text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {JSON.parse(plan.features || '[]').join(', ')}
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${plan.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {plan.isActive ? 'Yayında' : 'Taslak'}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <button className="header-icon-btn" onClick={() => {
                            setPlanForm({
                              ...plan,
                              features: JSON.parse(plan.features || '[]').join('\n')
                            });
                            setShowPlanModal(plan);
                          }}>
                            <Edit size={16} />
                          </button>
                          <button className="header-icon-btn text-danger" onClick={() => handleDeletePlan(plan.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pricingPlans.length === 0 && (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: 20 }}>Henüz bir fiyat planı eklenmemiş.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === 'footer' ? (
            <div className="footer-admin-view">
              {/* Brand Settings Section */}
              <div className="card" style={{ marginBottom: 30, padding: 20 }}>
                <h4 style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={18} /> Footer Marka & İletişim Bilgileri
                </h4>
                <form onSubmit={handleSaveFooterBrand} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label>Firma Adı</label>
                    <input type="text" className="input" value={footerBrandSettings.footer_company_name} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_company_name: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label>Footer Açıklama Metni</label>
                    <textarea className="input" style={{ minHeight: 60 }} value={footerBrandSettings.footer_description} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_description: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label>Adres Bilgisi</label>
                    <input type="text" className="input" value={footerBrandSettings.footer_address} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_address: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>E-posta</label>
                    <input type="email" className="input" value={footerBrandSettings.footer_email} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_email: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Telefon</label>
                    <input type="text" className="input" value={footerBrandSettings.footer_phone} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_phone: e.target.value})} />
                  </div>
                  <div style={{ gridColumn: 'span 2', textAlign: 'right' }}>
                    <button type="submit" className="btn btn-primary">Bilgileri Güncelle</button>
                  </div>
                </form>
              </div>

              <h4 style={{ marginBottom: 16, marginTop: 8 }}>Footer Link Grupları</h4>
              <table>
                <thead>
                  <tr>
                    <th>Sıra</th>
                    <th>Bölüm Başlığı</th>
                    <th>Link Sayısı</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {footerSections.map(section => (
                    <tr key={section.id}>
                      <td style={{ width: 60 }}>{section.order}</td>
                      <td><span className="font-semibold">{section.title}</span></td>
                      <td><span className="badge badge-info">{JSON.parse(section.links || '[]').length} Link</span></td>
                      <td>
                        <span className={`badge ${section.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {section.isActive ? 'Yayında' : 'Taslak'}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <button className="header-icon-btn" onClick={() => {
                            setFooterForm({
                              ...section,
                              links: JSON.parse(section.links || '[]')
                            });
                            setShowFooterModal(section);
                          }}>
                            <Edit size={16} />
                          </button>
                          <button className="header-icon-btn text-danger" onClick={() => handleDeleteFooter(section.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {footerSections.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: 20 }}>Henüz bir footer bölümü eklenmemiş.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      {/* Footer Modal */}
      {showFooterModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 600, padding: 0 }}>
            <div className="table-header">
              <h3>{showFooterModal === 'new' ? 'Yeni Bölüm Ekle' : 'Bölümü Düzenle'}</h3>
              <button className="text-btn" onClick={() => setShowFooterModal(null)}>İptal</button>
            </div>
            <form onSubmit={handleSaveFooter} style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 15 }}>
                <div className="form-group">
                  <label>Bölüm Başlığı</label>
                  <input type="text" className="input" value={footerForm.title} onChange={e => setFooterForm({...footerForm, title: e.target.value})} placeholder="Örn: Yasal Sözleşmeler" required />
                </div>
                <div className="form-group">
                  <label>Sıralama</label>
                  <input type="number" className="input" value={footerForm.order} onChange={e => setFooterForm({...footerForm, order: e.target.value})} />
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label>Linkler</label>
                  <button type="button" className="text-btn" onClick={addFooterLink} style={{ fontSize: 12 }}>+ Link Ekle</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 250, overflowY: 'auto', paddingRight: 5 }}>
                  {footerForm.links.map((link, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 40px', gap: 10, alignItems: 'center', background: 'var(--bg-tertiary)', padding: 10, borderRadius: 8 }}>
                      <input type="text" className="input" value={link.label} onChange={e => updateFooterLink(idx, 'label', e.target.value)} placeholder="Etiket (Örn: Hakkımızda)" required />
                      <input type="text" className="input" value={link.url} onChange={e => updateFooterLink(idx, 'url', e.target.value)} placeholder="URL (Örn: /policy/hakkimizda)" required />
                      <button type="button" className="text-danger" onClick={() => removeFooterLink(idx)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 10 }}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={footerForm.isActive} onChange={e => setFooterForm({...footerForm, isActive: e.target.checked})} />
                  <span className="text-sm">Yayında</span>
                </label>
              </div>

              <div className="flex gap-3">
                <button type="button" className="btn btn-secondary flex-1" onClick={() => setShowFooterModal(null)}>Vazgeç</button>
                <button type="submit" className="btn btn-primary flex-1">Kaydet</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Plan Modal */}
      {showPlanModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, padding: 0 }}>
            <div className="table-header">
              <h3>{showPlanModal === 'new' ? 'Yeni Plan Ekle' : 'Planı Düzenle'}</h3>
              <button className="text-btn" onClick={() => setShowPlanModal(null)}>İptal</button>
            </div>
            <form onSubmit={handleSavePlan} style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                <div className="form-group">
                  <label>Plan Adı</label>
                  <input type="text" className="input" value={planForm.name} onChange={e => setPlanForm({...planForm, name: e.target.value})} placeholder="Örn: Profesyonel" required />
                </div>
                <div className="form-group">
                  <label>Fiyat Etiketi</label>
                  <input type="text" className="input" value={planForm.price} onChange={e => setPlanForm({...planForm, price: e.target.value})} placeholder="Örn: ₺499" required />
                </div>
                <div className="form-group">
                  <label>Periyot</label>
                  <input type="text" className="input" value={planForm.period} onChange={e => setPlanForm({...planForm, period: e.target.value})} placeholder="Örn: / ay" required />
                </div>
                <div className="form-group">
                  <label>Sıralama</label>
                  <input type="number" className="input" value={planForm.order} onChange={e => setPlanForm({...planForm, order: e.target.value})} />
                </div>
              </div>
              
              <div className="form-group">
                <label>Buton Metni</label>
                <input type="text" className="input" value={planForm.ctaText} onChange={e => setPlanForm({...planForm, ctaText: e.target.value})} placeholder="Örn: Hemen Başla" />
              </div>

              <div className="form-group">
                <label>Özellikler (Her satıra bir tane)</label>
                <textarea 
                  className="input" 
                  style={{ minHeight: 120, resize: 'vertical' }}
                  value={planForm.features} 
                  onChange={e => setPlanForm({...planForm, features: e.target.value})}
                  placeholder="10 XML Kaynağı&#10;10.000 Ürün&#10;Öncelikli Destek"
                />
              </div>

              <div className="flex gap-4" style={{ marginBottom: 20 }}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={planForm.isHighlighted} onChange={e => setPlanForm({...planForm, isHighlighted: e.target.checked})} />
                  <span className="text-sm">Öne Çıkan Plan (En Popüler)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={planForm.isActive} onChange={e => setPlanForm({...planForm, isActive: e.target.checked})} />
                  <span className="text-sm">Yayında</span>
                </label>
              </div>

              <div className="flex gap-3">
                <button type="button" className="btn btn-secondary flex-1" onClick={() => setShowPlanModal(null)}>Vazgeç</button>
                <button type="submit" className="btn btn-primary flex-1">Kaydet</button>
              </div>
            </form>
          </div>
        </div>
      )}

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
