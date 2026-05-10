import { useState, useEffect } from 'react';
import api from '../../services/api';
import {
  Users, Store, Package, ShoppingCart, CreditCard, Shield, Search,
  MoreVertical, CheckCircle, XCircle, UserPlus, Mail, Calendar,
  Trash2, Edit, Check, X, RefreshCcw, Settings, Tags, Plus, List, Sliders, FileText, Truck,
  MessageSquare, Send
} from 'lucide-react';
import toast from 'react-hot-toast';
import { legalContent } from '../legal/legalContent';
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
  const [planForm, setPlanForm] = useState({ name: '', price: '', yearlyPrice: '', period: '/ ay', features: '', ctaText: 'Hemen Başla', isHighlighted: false, order: 0, isActive: true, maxProducts: 1000, maxXmlSources: 1 });

  const [footerSections, setFooterSections] = useState([]);
  const [showFooterModal, setShowFooterModal] = useState(null);
  const [footerForm, setFooterForm] = useState({ title: '', links: [{ label: '', url: '', isExternal: false }], order: 0, isActive: true });
  const [footerBrandSettings, setFooterBrandSettings] = useState({
    footer_company_name: 'EVİNSO Bilişim Yazılım Ve Danışmanlık',
    footer_description: 'Tüm pazaryerlerinizi tek platformdan yönetin. E-ticaret operasyonlarınızı otomatikleştirin ve satışlarınızı artırın.',
    footer_address: 'Bilişim Vadisi, Teknoloji Blv. No:1, Gebze / Kocaeli',
    footer_email: 'info@modulpos.com',
    footer_phone: '0850 000 00 00',
    footer_copyright: `© ${new Date().getFullYear()} ModulPOS. Tüm hakları saklıdır.`
  });

  const [generalSettings, setGeneralSettings] = useState({ trial_days: '3' });

  const [dropshipOrders, setDropshipOrders] = useState([]);
  const [dropshipStatusFilter, setDropshipStatusFilter] = useState('');
  const [dropshipEditModal, setDropshipEditModal] = useState(null);
  const [dropshipEditForm, setDropshipEditForm] = useState({ status: '', campaignCode: '', trackingNumber: '', cargoCompany: '', supplierOrderId: '', notes: '' });
  const [dropshipEditSaving, setDropshipEditSaving] = useState(false);

  const [invoiceModalUser, setInvoiceModalUser] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState({ title: '', amount: '', period: '', notes: '', fileUrl: '' });
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const [supportTickets, setSupportTickets] = useState([]);
  const [supportStatusFilter, setSupportStatusFilter] = useState('');
  const [supportDetailModal, setSupportDetailModal] = useState(null);
  const [supportDetailLoading, setSupportDetailLoading] = useState(false);
  const [supportReplyText, setSupportReplyText] = useState('');
  const [supportReplying, setSupportReplying] = useState(false);
  const [supportStatusSaving, setSupportStatusSaving] = useState(false);

  const [policyPages, setPolicyPages] = useState([]);
  const [policyEditSlug, setPolicyEditSlug] = useState(null);
  const [policyForm, setPolicyForm] = useState({ title: '', content: '' });
  const [policySaving, setPolicySaving] = useState(false);

  const POLICY_LABELS = {
    'mesafeli-satis-sozlesmesi': 'Mesafeli Satış Sözleşmesi',
    'iptal-ve-iade-kosullari': 'İptal ve İade Koşulları',
    'gizlilik-ve-guvenlik-politikasi': 'Gizlilik ve Güvenlik Politikası',
    'teslimat-kosullari': 'Teslimat Koşulları',
    'kullanim-sartlari': 'Kullanım Şartları',
    'hakkimizda': 'Hakkımızda',
    'iletisim': 'İletişim',
  };

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

        const settingsRes = await api.get('/admin/system-settings?keys=footer_description,footer_address,footer_email,footer_phone,footer_company_name,footer_copyright');
        if (Object.keys(settingsRes.data).length > 0) {
          setFooterBrandSettings(prev => ({ ...prev, ...settingsRes.data }));
        }
      } else if (activeTab === 'dropship') {
        const params = dropshipStatusFilter ? `?status=${dropshipStatusFilter}` : '';
        const res = await api.get(`/admin/dropship-orders${params}`);
        setDropshipOrders(res.data);
      } else if (activeTab === 'support') {
        const params = supportStatusFilter ? `?status=${supportStatusFilter}` : '';
        const res = await api.get(`/admin/support-tickets${params}`);
        setSupportTickets(res.data);
      } else if (activeTab === 'settings') {
        const settingsRes = await api.get('/admin/system-settings?keys=trial_days');
        setGeneralSettings({ trial_days: settingsRes.data.trial_days || '3' });
      } else if (activeTab === 'policies') {
        const res = await api.get('/admin/policy-pages');
        setPolicyPages(res.data);
      }
    } catch (error) {
      console.error('Admin verileri yüklenemedi:', error);
      toast.error('Veriler yüklenirken hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGeneralSettings = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/system-settings', { trial_days: generalSettings.trial_days });
      toast.success('Genel ayarlar kaydedildi');
    } catch {
      toast.error('Ayarlar kaydedilemedi');
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

  const handleSeedDefaultPlans = async () => {
    if (!window.confirm('Varsayılan 3 plan (Başlangıç, Profesyonel, Kurumsal) oluşturulsun mu? Fiyatları sonradan düzenleyebilirsiniz.')) return;
    try {
      const res = await api.post('/admin/pricing-plans/seed-defaults');
      toast.success(res.data.message);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Planlar oluşturulamadı');
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

  const handleSeedDefaultFooter = async () => {
    if (!window.confirm('Varsayılan 3 footer bölümü (Ürün, Yasal Sözleşmeler, Kurumsal) oluşturulsun mu?')) return;
    try {
      const res = await api.post('/admin/footer-sections/seed-defaults');
      toast.success(res.data.message);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Varsayılanlar yüklenemedi');
    }
  };

  const handleEditPolicy = (page) => {
    setPolicyForm({
      title: page.title || legalContent[page.slug]?.title || POLICY_LABELS[page.slug] || '',
      content: page.content || legalContent[page.slug]?.content || ''
    });
    setPolicyEditSlug(page.slug);
  };

  const handleSavePolicy = async (e) => {
    e.preventDefault();
    setPolicySaving(true);
    try {
      await api.put(`/admin/policy-pages/${policyEditSlug}`, policyForm);
      toast.success('Sayfa kaydedildi');
      setPolicyEditSlug(null);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Kayıt başarısız');
    } finally {
      setPolicySaving(false);
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

  const openDropshipEditModal = (order) => {
    setDropshipEditForm({
      status: order.status || 'ordered',
      campaignCode: order.campaignCode || '',
      trackingNumber: order.trackingNumber || '',
      cargoCompany: order.cargoCompany || '',
      supplierOrderId: order.supplierOrderId || '',
      notes: order.notes || ''
    });
    setDropshipEditModal(order);
  };

  const handleDropshipEditSave = async (e) => {
    e.preventDefault();
    setDropshipEditSaving(true);
    try {
      const updated = await api.put(`/admin/dropship-orders/${dropshipEditModal.id}`, dropshipEditForm);
      toast.success('Sipariş güncellendi');
      setDropshipOrders(prev => prev.map(o =>
        o.id === dropshipEditModal.id ? { ...o, ...updated.data } : o
      ));
      setDropshipEditModal(null);
    } catch {
      toast.error('Güncelleme başarısız');
    } finally {
      setDropshipEditSaving(false);
    }
  };

  const openSupportDetail = async (ticket) => {
    setSupportDetailLoading(true);
    setSupportDetailModal({ ...ticket, messages: [] });
    setSupportReplyText('');
    try {
      const res = await api.get(`/admin/support-tickets/${ticket.id}`);
      setSupportDetailModal(res.data);
    } catch {
      toast.error('Bilet detayı yüklenemedi');
      setSupportDetailModal(null);
    } finally {
      setSupportDetailLoading(false);
    }
  };

  const handleSupportReply = async (e) => {
    e.preventDefault();
    if (!supportReplyText.trim()) return;
    setSupportReplying(true);
    try {
      const res = await api.post(`/admin/support-tickets/${supportDetailModal.id}/reply`, { message: supportReplyText.trim() });
      setSupportDetailModal(prev => ({ ...prev, status: 'in_progress', messages: [...prev.messages, res.data] }));
      setSupportTickets(prev => prev.map(t =>
        t.id === supportDetailModal.id ? { ...t, status: 'in_progress', updatedAt: new Date().toISOString() } : t
      ));
      setSupportReplyText('');
      toast.success('Yanıt gönderildi');
    } catch {
      toast.error('Yanıt gönderilemedi');
    } finally {
      setSupportReplying(false);
    }
  };

  const handleSupportStatusChange = async (ticketId, newStatus) => {
    setSupportStatusSaving(true);
    try {
      await api.put(`/admin/support-tickets/${ticketId}`, { status: newStatus });
      setSupportTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: newStatus } : t));
      if (supportDetailModal?.id === ticketId) setSupportDetailModal(prev => ({ ...prev, status: newStatus }));
      toast.success('Durum güncellendi');
    } catch {
      toast.error('Güncelleme başarısız');
    } finally {
      setSupportStatusSaving(false);
    }
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    if (!invoiceModalUser) return;
    setInvoiceLoading(true);
    try {
      await api.post(`/admin/invoices/${invoiceModalUser.id}`, {
        ...invoiceForm,
        amount: parseFloat(invoiceForm.amount)
      });
      toast.success('Fatura başarıyla oluşturuldu');
      setInvoiceModalUser(null);
      setInvoiceForm({ title: '', amount: '', period: '', notes: '', fileUrl: '' });
    } catch (error) {
      toast.error(error.response?.data?.error || 'Fatura oluşturulamadı');
    } finally {
      setInvoiceLoading(false);
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
        <button className={`admin-tab ${activeTab === 'dropship' ? 'active' : ''}`} onClick={() => setActiveTab('dropship')}>
          <Truck size={16} /> Tedarikçi Siparişleri
        </button>
        <button className={`admin-tab ${activeTab === 'support' ? 'active' : ''}`} onClick={() => setActiveTab('support')}>
          <MessageSquare size={16} /> Destek Biletleri
        </button>
        <button className={`admin-tab ${activeTab === 'policies' ? 'active' : ''}`} onClick={() => setActiveTab('policies')}>
          <FileText size={16} /> Yasal Sayfalar
        </button>
        <button className={`admin-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <Sliders size={16} /> Genel Ayarlar
        </button>
      </div>

      <div className="admin-content" style={{ overflowX: 'auto' }}>
        <div className="table-container" style={{ overflowX: 'auto', minWidth: activeTab === 'dropship' ? 1100 : undefined }}>
          <div className="table-header" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <h3 style={{ margin: 0, flex: 1, minWidth: 200 }}>
              {activeTab === 'users' ? 'Kullanıcı Yönetimi' :
               activeTab === 'stores' ? 'Tüm Mağazalar' :
               activeTab === 'auditLogs' ? 'Sistem Logları' :
               activeTab === 'pricing' ? 'Fiyat Planları' :
               activeTab === 'footer' ? 'Footer Yönetimi' :
               activeTab === 'dropship' ? 'Tedarikçi Siparişleri' :
               activeTab === 'support' ? 'Destek Biletleri' : 'Genel Ayarlar'}
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
            {activeTab === 'dropship' && (
              <select
                className="form-input"
                style={{ width: 'auto', minWidth: 160 }}
                value={dropshipStatusFilter}
                onChange={e => { setDropshipStatusFilter(e.target.value); fetchData(); }}
              >
                <option value="">Tüm Durumlar</option>
                <option value="pending">Bekliyor</option>
                <option value="ordered">Sipariş Verildi</option>
                <option value="shipped">Kargoda</option>
                <option value="delivered">Teslim Edildi</option>
                <option value="cancelled">İptal</option>
              </select>
            )}
            {activeTab === 'support' && (
              <select
                className="form-input"
                style={{ width: 'auto', minWidth: 160 }}
                value={supportStatusFilter}
                onChange={e => { setSupportStatusFilter(e.target.value); fetchData(); }}
              >
                <option value="">Tüm Durumlar</option>
                <option value="open">Açık</option>
                <option value="in_progress">İşlemde</option>
                <option value="resolved">Çözüldü</option>
                <option value="closed">Kapalı</option>
              </select>
            )}
            {activeTab === 'pricing' && (
              <div className="flex gap-2">
                {pricingPlans.length === 0 && (
                  <button className="btn btn-secondary" onClick={handleSeedDefaultPlans}>
                    Varsayılanları Yükle
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => {
                  setPlanForm({ name: '', price: '', yearlyPrice: '', period: '/ ay', features: '', ctaText: 'Hemen Başla', isHighlighted: false, order: pricingPlans.length, isActive: true });
                  setShowPlanModal('new');
                }}>
                  <Plus size={16} /> Yeni Plan Ekle
                </button>
              </div>
            )}
            {activeTab === 'footer' && (
              <div className="flex gap-2">
                {footerSections.length === 0 && (
                  <button className="btn btn-secondary" onClick={handleSeedDefaultFooter}>
                    Varsayılanları Yükle
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => {
                  setFooterForm({ title: '', links: [{ label: '', url: '', isExternal: false }], order: footerSections.length, isActive: true });
                  setShowFooterModal('new');
                }}>
                  <Plus size={16} /> Yeni Grup Ekle
                </button>
              </div>
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
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 12, height: 'auto' }}
                          title="Fatura Oluştur"
                          onClick={() => {
                            setInvoiceForm({ title: '', amount: '', period: '', notes: '', fileUrl: '' });
                            setInvoiceModalUser(user);
                          }}
                          disabled={actionLoading === user.id}
                        >
                          <FileText size={14} style={{ marginRight: 4 }} /> Fatura
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
                    <th style={{ width: 44 }}>#</th>
                    <th>Plan Adı</th>
                    <th>Aylık Fiyat</th>
                    <th>Yıllık Fiyat</th>
                    <th>Ürün Limiti</th>
                    <th>XML Kaynak</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {pricingPlans.map(plan => (
                    <tr key={plan.id}>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{plan.order}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 600 }}>{plan.name}</span>
                          {plan.isHighlighted && <span className="badge badge-info" style={{ fontSize: 10 }}>Öne Çıkan</span>}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{plan.price}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 3 }}>{plan.period}</span>
                      </td>
                      <td>
                        {plan.yearlyPrice ? (
                          <div>
                            <span style={{ fontWeight: 700, color: 'var(--success)' }}>{plan.yearlyPrice}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 3 }}>/yıl</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          {plan.maxProducts >= 999999 ? 'Sınırsız' : (plan.maxProducts || 1000).toLocaleString('tr-TR')}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          {plan.maxXmlSources >= 999 ? 'Sınırsız' : (plan.maxXmlSources || 1)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${plan.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {plan.isActive ? 'Yayında' : 'Taslak'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="header-icon-btn" onClick={() => {
                            setPlanForm({
                              ...plan,
                              yearlyPrice: plan.yearlyPrice || '',
                              features: JSON.parse(plan.features || '[]').join('\n'),
                              maxProducts: plan.maxProducts ?? 1000,
                              maxXmlSources: plan.maxXmlSources ?? 1
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
                      <td colSpan="8" style={{ textAlign: 'center', padding: 20 }}>Henüz bir fiyat planı eklenmemiş.</td>
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
                    <label className="form-label">Firma Adı</label>
                    <input type="text" className="form-input" value={footerBrandSettings.footer_company_name} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_company_name: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Footer Açıklama Metni</label>
                    <textarea className="form-textarea" style={{ minHeight: 60 }} value={footerBrandSettings.footer_description} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_description: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Adres Bilgisi</label>
                    <input type="text" className="form-input" value={footerBrandSettings.footer_address} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_address: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">E-posta</label>
                    <input type="email" className="form-input" value={footerBrandSettings.footer_email} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_email: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Telefon</label>
                    <input type="text" className="form-input" value={footerBrandSettings.footer_phone} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_phone: e.target.value})} />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label">Telif Hakkı Metni (© satırı)</label>
                    <input type="text" className="form-input" value={footerBrandSettings.footer_copyright} onChange={e => setFooterBrandSettings({...footerBrandSettings, footer_copyright: e.target.value})} />
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
          ) : activeTab === 'dropship' ? (
            (() => {
              const DS = {
                pending:   { label: 'Bekliyor',        cls: 'badge-warning' },
                ordered:   { label: 'Sipariş Verildi', cls: 'badge-info' },
                shipped:   { label: 'Kargoda',         cls: 'badge-primary' },
                delivered: { label: 'Teslim Edildi',   cls: 'badge-success' },
                cancelled: { label: 'İptal',           cls: 'badge-danger' },
              };
              return (
                <table style={{ minWidth: 1200, tableLayout: 'auto' }}>
                  <thead>
                    <tr>
                      <th style={{ whiteSpace: 'nowrap' }}>Kullanıcı</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Ürün</th>
                      <th style={{ whiteSpace: 'nowrap' }}>XML Kaynağı</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Kampanya Kodu</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Ödenen (₺)</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Miktar</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Müşteri</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Durum</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Takip No</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Tarih</th>
                      <th style={{ whiteSpace: 'nowrap' }}>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dropshipOrders.map(order => {
                      const st = DS[order.status] || DS.pending;
                      const xmlSource = order.product?.xmlSource?.name || order.supplierName || '—';
                      return (
                        <tr key={order.id}>
                          <td>
                            <div className="user-name" style={{ fontSize: 13 }}>{order.user?.name}</div>
                            <div className="user-email">{order.user?.email}</div>
                          </td>
                          <td style={{ maxWidth: 180 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {order.productName}
                            </div>
                            {order.productCode && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{order.productCode}</div>}
                          </td>
                          <td>
                            <span className="badge badge-info" style={{ fontSize: 11 }}>{xmlSource}</span>
                          </td>
                          <td style={{ fontSize: 13, fontWeight: 500 }}>
                            {order.campaignCode || <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                          </td>
                          <td style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-primary)' }}>
                            {order.creditAmount > 0
                              ? `₺${Number(order.creditAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
                              : '—'}
                          </td>
                          <td style={{ fontSize: 13 }}>{order.quantity} adet</td>
                          <td style={{ fontSize: 12 }}>
                            <div>{order.customerName || '—'}</div>
                            {order.customerPhone && <div style={{ color: 'var(--text-secondary)' }}>{order.customerPhone}</div>}
                          </td>
                          <td>
                            <span className={`badge ${st.cls}`} style={{ padding: '4px 8px' }}>
                              {st.label}
                            </span>
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {order.trackingNumber
                              ? <><div style={{ fontWeight: 500 }}>{order.trackingNumber}</div><div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{order.cargoCompany}</div></>
                              : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {new Date(order.createdAt).toLocaleDateString('tr-TR')}
                          </td>
                          <td>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 12, height: 'auto' }}
                              onClick={() => openDropshipEditModal(order)}
                            >
                              <Edit size={13} style={{ marginRight: 4 }} /> Düzenle
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {dropshipOrders.length === 0 && (
                      <tr>
                        <td colSpan="11" style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                          Henüz tedarikçi siparişi bulunmuyor.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              );
            })()
          ) : activeTab === 'policies' ? (
            <div style={{ padding: '8px 0' }}>
              {policyEditSlug ? (
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileText size={18} /> {POLICY_LABELS[policyEditSlug]}
                    </h4>
                    <button className="btn btn-ghost" onClick={() => setPolicyEditSlug(null)}>
                      <X size={16} /> Geri
                    </button>
                  </div>
                  <form onSubmit={handleSavePolicy} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="form-group">
                      <label className="form-label">Sayfa Başlığı</label>
                      <input
                        type="text"
                        className="form-input"
                        value={policyForm.title}
                        onChange={e => setPolicyForm({ ...policyForm, title: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">İçerik (HTML)</label>
                      <textarea
                        className="form-textarea"
                        style={{ minHeight: 420, fontFamily: 'monospace', fontSize: 13 }}
                        value={policyForm.content}
                        onChange={e => setPolicyForm({ ...policyForm, content: e.target.value })}
                        required
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                        HTML etiketleri kullanabilirsiniz: &lt;h3&gt;, &lt;p&gt;, &lt;ul&gt;, &lt;li&gt;, &lt;strong&gt; vb.
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost" onClick={() => setPolicyEditSlug(null)}>İptal</button>
                      <button type="submit" className="btn btn-primary" disabled={policySaving}>
                        {policySaving ? 'Kaydediliyor...' : 'Kaydet'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="card" style={{ padding: 24 }}>
                  <h4 style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={18} /> Yasal Sayfalar
                  </h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Sayfa</th>
                        <th>URL</th>
                        <th>Durum</th>
                        <th>İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policyPages.map(page => (
                        <tr key={page.slug}>
                          <td><span className="font-semibold">{POLICY_LABELS[page.slug] || page.slug}</span></td>
                          <td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/policy/{page.slug}</span></td>
                          <td>
                            <span className={`badge ${page.content ? 'badge-success' : 'badge-warning'}`}>
                              {page.content ? 'Düzenlenmiş' : 'Varsayılan'}
                            </span>
                          </td>
                          <td>
                            <button className="header-icon-btn" onClick={() => handleEditPolicy(page)}>
                              <Edit size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === 'settings' ? (
            <div style={{ padding: '8px 0' }}>
              <div className="card" style={{ padding: 24, maxWidth: 560 }}>
                <h4 style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sliders size={18} /> Üyelik &amp; Deneme Süresi
                </h4>
                <form onSubmit={handleSaveGeneralSettings}>
                  <div className="form-group">
                    <label className="form-label">Ücretsiz Deneme Süresi (Gün)</label>
                    <input
                      type="number"
                      className="form-input"
                      style={{ maxWidth: 160 }}
                      min="0"
                      max="365"
                      value={generalSettings.trial_days}
                      onChange={e => setGeneralSettings({ ...generalSettings, trial_days: e.target.value })}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 6 }}>
                      Yeni üye olan kullanıcılara otomatik verilen ücretsiz deneme süresi. 0 girersen deneme verilmez.
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <button type="submit" className="btn btn-primary">Kaydet</button>
                  </div>
                </form>
              </div>
            </div>
          ) : activeTab === 'support' ? (() => {
            const ST = {
              open:        { label: 'Açık',      cls: 'badge-info' },
              in_progress: { label: 'İşlemde',   cls: 'badge-warning' },
              resolved:    { label: 'Çözüldü',   cls: 'badge-success' },
              closed:      { label: 'Kapalı',    cls: 'badge-danger' },
            };
            const PR = {
              low:    { label: 'Düşük',   cls: 'badge-info' },
              normal: { label: 'Normal',  cls: '' },
              high:   { label: 'Yüksek', cls: 'badge-warning' },
              urgent: { label: 'Acil',   cls: 'badge-danger' },
            };
            return (
              <table>
                <thead>
                  <tr>
                    <th>Kullanıcı</th>
                    <th>Konu</th>
                    <th>Kategori</th>
                    <th>Öncelik</th>
                    <th>Durum</th>
                    <th>Mesajlar</th>
                    <th>Tarih</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {supportTickets.map(ticket => {
                    const pr = PR[ticket.priority] || PR.normal;
                    return (
                      <tr key={ticket.id}>
                        <td>
                          <div className="user-name" style={{ fontSize: 13 }}>{ticket.user?.name}</div>
                          <div className="user-email">{ticket.user?.email}</div>
                        </td>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 13 }}>
                          {ticket.subject}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ticket.category}</td>
                        <td><span className={`badge ${pr.cls}`}>{pr.label}</span></td>
                        <td>
                          <select
                            className="admin-select"
                            value={ticket.status}
                            onChange={e => handleSupportStatusChange(ticket.id, e.target.value)}
                            disabled={supportStatusSaving}
                          >
                            {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                          {ticket._count?.messages || 0}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {new Date(ticket.updatedAt).toLocaleDateString('tr-TR')}
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: 12, height: 'auto' }}
                            onClick={() => openSupportDetail(ticket)}
                          >
                            <MessageSquare size={13} style={{ marginRight: 4 }} /> Görüntüle
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {supportTickets.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                        Henüz destek bileti bulunmuyor.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            );
          })() : null}
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
                  <label className="form-label">Bölüm Başlığı</label>
                  <input type="text" className="form-input" value={footerForm.title} onChange={e => setFooterForm({...footerForm, title: e.target.value})} placeholder="Örn: Yasal Sözleşmeler" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Sıralama</label>
                  <input type="number" className="form-input" value={footerForm.order} onChange={e => setFooterForm({...footerForm, order: e.target.value})} />
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>Linkler</label>
                  <button type="button" className="text-btn" onClick={addFooterLink} style={{ fontSize: 12 }}>+ Link Ekle</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 250, overflowY: 'auto', paddingRight: 5 }}>
                  {footerForm.links.map((link, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 40px', gap: 10, alignItems: 'center', background: 'var(--bg-tertiary)', padding: 10, borderRadius: 8 }}>
                      <input type="text" className="form-input" value={link.label} onChange={e => updateFooterLink(idx, 'label', e.target.value)} placeholder="Etiket (Örn: Hakkımızda)" required />
                      <input type="text" className="form-input" value={link.url} onChange={e => updateFooterLink(idx, 'url', e.target.value)} placeholder="URL (Örn: /policy/hakkimizda)" required />
                      <button type="button" className="text-danger" onClick={() => removeFooterLink(idx)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={footerForm.isActive} onChange={e => setFooterForm({...footerForm, isActive: e.target.checked})} />
                  Yayında
                </label>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowFooterModal(null)}>Vazgeç</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Kaydet</button>
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
                  <label className="form-label">Plan Adı</label>
                  <input type="text" className="form-input" value={planForm.name} onChange={e => setPlanForm({...planForm, name: e.target.value})} placeholder="Örn: Profesyonel" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Aylık Fiyat</label>
                  <input type="text" className="form-input" value={planForm.price} onChange={e => setPlanForm({...planForm, price: e.target.value})} placeholder="Örn: ₺499" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Yıllık Fiyat <span style={{fontSize:11,color:'var(--text-muted)'}}>(opsiyonel)</span></label>
                  <input type="text" className="form-input" value={planForm.yearlyPrice} onChange={e => setPlanForm({...planForm, yearlyPrice: e.target.value})} placeholder="Örn: ₺4990" />
                </div>
                <div className="form-group">
                  <label className="form-label">Maks. Ürün Limiti</label>
                  <input type="number" className="form-input" value={planForm.maxProducts} onChange={e => setPlanForm({...planForm, maxProducts: parseInt(e.target.value) || 0})} placeholder="Örn: 1000" min="0" />
                </div>
                <div className="form-group">
                  <label className="form-label">Maks. XML Kaynak Limiti</label>
                  <input type="number" className="form-input" value={planForm.maxXmlSources} onChange={e => setPlanForm({...planForm, maxXmlSources: parseInt(e.target.value) || 0})} placeholder="Örn: 1" min="0" />
                </div>
                <div className="form-group">
                  <label className="form-label">Sıralama</label>
                  <input type="number" className="form-input" value={planForm.order} onChange={e => setPlanForm({...planForm, order: e.target.value})} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Buton Metni</label>
                <input type="text" className="form-input" value={planForm.ctaText} onChange={e => setPlanForm({...planForm, ctaText: e.target.value})} placeholder="Örn: Hemen Başla" />
              </div>

              <div className="form-group">
                <label className="form-label">Özellikler (Her satıra bir tane)</label>
                <textarea
                  className="form-textarea"
                  style={{ minHeight: 120, resize: 'vertical' }}
                  value={planForm.features}
                  onChange={e => setPlanForm({...planForm, features: e.target.value})}
                  placeholder="10 XML Kaynağı&#10;10.000 Ürün&#10;Öncelikli Destek"
                />
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={planForm.isHighlighted} onChange={e => setPlanForm({...planForm, isHighlighted: e.target.checked})} />
                  Öne Çıkan Plan (En Popüler)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={planForm.isActive} onChange={e => setPlanForm({...planForm, isActive: e.target.checked})} />
                  Yayında
                </label>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPlanModal(null)}>Vazgeç</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Kaydet</button>
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

      {/* Invoice Modal */}
      {invoiceModalUser && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 0 }}>
            <div className="table-header">
              <h3><FileText size={16} style={{ marginRight: 8 }} />Fatura Oluştur</h3>
              <button className="text-btn" onClick={() => setInvoiceModalUser(null)}>Kapat</button>
            </div>
            <form onSubmit={handleCreateInvoice} style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                <strong>{invoiceModalUser.name}</strong> ({invoiceModalUser.email}) için fatura oluşturulacak.
              </p>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Başlık</label>
                <input
                  type="text"
                  className="form-input"
                  value={invoiceForm.title}
                  onChange={e => setInvoiceForm({ ...invoiceForm, title: e.target.value })}
                  placeholder="Örn: Aylık Abonelik - Mayıs 2026"
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div className="form-group">
                  <label className="form-label">Tutar (₺)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={invoiceForm.amount}
                    onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                    placeholder="499"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Dönem (İsteğe Bağlı)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={invoiceForm.period}
                    onChange={e => setInvoiceForm({ ...invoiceForm, period: e.target.value })}
                    placeholder="Mayıs 2026"
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Notlar (İsteğe Bağlı)</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={invoiceForm.notes}
                  onChange={e => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                  placeholder="Ek açıklamalar..."
                />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Fatura URL (İsteğe Bağlı)</label>
                <input
                  type="url"
                  className="form-input"
                  value={invoiceForm.fileUrl}
                  onChange={e => setInvoiceForm({ ...invoiceForm, fileUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setInvoiceModalUser(null)}>Vazgeç</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={invoiceLoading}>
                  {invoiceLoading ? 'Oluşturuluyor...' : 'Fatura Oluştur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dropship Edit Modal */}
      {dropshipEditModal && (() => {
        const DS = {
          pending:   'Bekliyor',
          ordered:   'Sipariş Verildi',
          shipped:   'Kargoda',
          delivered: 'Teslim Edildi',
          cancelled: 'İptal',
        };
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" style={{ width: '100%', maxWidth: 500, padding: 0, maxHeight: '90vh', overflowY: 'auto' }}>
              <div className="table-header">
                <h3><Truck size={16} style={{ marginRight: 8 }} />Siparişi Düzenle</h3>
                <button className="text-btn" onClick={() => setDropshipEditModal(null)}>Kapat</button>
              </div>
              <form onSubmit={handleDropshipEditSave} style={{ padding: 20 }}>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{dropshipEditModal.productName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {dropshipEditModal.user?.name} · {dropshipEditModal.user?.email}
                    {dropshipEditModal.creditAmount > 0 && ` · ₺${Number(dropshipEditModal.creditAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Sipariş Durumu</label>
                    <select className="form-input" value={dropshipEditForm.status}
                      onChange={e => setDropshipEditForm({ ...dropshipEditForm, status: e.target.value })}>
                      {Object.entries(DS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Kampanya / Kargo Kodu</label>
                    <input type="text" className="form-input" value={dropshipEditForm.campaignCode}
                      onChange={e => setDropshipEditForm({ ...dropshipEditForm, campaignCode: e.target.value })}
                      placeholder="Trendyol kampanya kodu" />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Kargo Firması</label>
                    <input type="text" className="form-input" value={dropshipEditForm.cargoCompany}
                      onChange={e => setDropshipEditForm({ ...dropshipEditForm, cargoCompany: e.target.value })}
                      placeholder="Yurtiçi, Aras, MNG..." />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Takip Numarası</label>
                    <input type="text" className="form-input" value={dropshipEditForm.trackingNumber}
                      onChange={e => setDropshipEditForm({ ...dropshipEditForm, trackingNumber: e.target.value })}
                      placeholder="Kargo takip kodu" />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">Tedarikçi Sipariş No</label>
                  <input type="text" className="form-input" value={dropshipEditForm.supplierOrderId}
                    onChange={e => setDropshipEditForm({ ...dropshipEditForm, supplierOrderId: e.target.value })}
                    placeholder="Tedarikçinin verdiği sipariş numarası" />
                </div>

                <div className="form-group" style={{ marginBottom: 20 }}>
                  <label className="form-label">Notlar</label>
                  <textarea className="form-input" rows={2} value={dropshipEditForm.notes}
                    onChange={e => setDropshipEditForm({ ...dropshipEditForm, notes: e.target.value })}
                    placeholder="Ek açıklamalar..." />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setDropshipEditModal(null)}>Vazgeç</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={dropshipEditSaving}>
                    {dropshipEditSaving ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

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
      {/* Support Ticket Detail Modal */}
      {supportDetailModal && (() => {
        const ST = {
          open:        'Açık',
          in_progress: 'İşlemde',
          resolved:    'Çözüldü',
          closed:      'Kapalı',
        };
        const ST_CLS = {
          open: 'badge-info', in_progress: 'badge-warning', resolved: 'badge-success', closed: 'badge-danger'
        };
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div className="card" style={{ width: '100%', maxWidth: 620, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

              {/* Header */}
              <div className="table-header" style={{ flexShrink: 0 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{supportDetailModal.subject}</h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {supportDetailModal.user?.name} · {supportDetailModal.user?.email}
                  </div>
                </div>
                <button className="header-icon-btn" onClick={() => { setSupportDetailModal(null); setSupportReplyText(''); }}>
                  <X size={18} />
                </button>
              </div>

              {/* Status bar */}
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                <span className={`badge ${ST_CLS[supportDetailModal.status] || 'badge-info'}`}>
                  {ST[supportDetailModal.status] || supportDetailModal.status}
                </span>
                <select
                  className="form-input"
                  style={{ width: 'auto', fontSize: 12, height: 28, padding: '2px 8px' }}
                  value={supportDetailModal.status}
                  onChange={e => handleSupportStatusChange(supportDetailModal.id, e.target.value)}
                  disabled={supportStatusSaving}
                >
                  {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {new Date(supportDetailModal.createdAt).toLocaleString('tr-TR')}
                </span>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {supportDetailLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
                ) : supportDetailModal.messages?.map(msg => (
                  <div key={msg.id} style={{ alignSelf: msg.isAdmin ? 'flex-start' : 'flex-end', maxWidth: '80%' }}>
                    <div style={{
                      background: msg.isAdmin ? 'var(--bg-tertiary)' : 'var(--accent-primary)',
                      color: msg.isAdmin ? 'var(--text-primary)' : '#fff',
                      borderRadius: msg.isAdmin ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                      padding: '10px 14px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap'
                    }}>
                      {msg.message}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, textAlign: msg.isAdmin ? 'left' : 'right' }}>
                      {msg.senderName} · {new Date(msg.createdAt).toLocaleString('tr-TR')}
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
                {supportDetailModal.status === 'closed' ? (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '6px 0' }}>
                    Bu bilet kapalıdır.
                  </p>
                ) : (
                  <form onSubmit={handleSupportReply} style={{ display: 'flex', gap: 10 }}>
                    <textarea
                      className="form-input"
                      rows={2}
                      style={{ flex: 1, resize: 'none', fontSize: 13 }}
                      placeholder="Yanıtınızı yazın... (Ctrl+Enter ile gönder)"
                      value={supportReplyText}
                      onChange={e => setSupportReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSupportReply(e); }}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary"
                      style={{ alignSelf: 'flex-end', padding: '8px 16px' }}
                      disabled={supportReplying || !supportReplyText.trim()}
                    >
                      {supportReplying ? '...' : <Send size={16} />}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
