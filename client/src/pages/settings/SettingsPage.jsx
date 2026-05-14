import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { User, Settings, Shield, CreditCard, Save, FileText, Download, ExternalLink, Monitor, Globe, Smartphone, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  const queryParams = new URLSearchParams(location.search);
  const initialTab = queryParams.get('tab') || 'profile';

  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(false);

  // Profile State
  const [profileData, setProfileData] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    email: user?.email || '',
  });

  // Security State
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Store State
  const [storeData, setStoreData] = useState({
    name: user?.stores?.[0]?.name || '',
    taxId: user?.stores?.[0]?.taxId || '',
    phone: user?.stores?.[0]?.phone || '',
    address: user?.stores?.[0]?.address || '',
    invoiceType: user?.stores?.[0]?.invoiceType || 'bireysel',
    companyTitle: user?.stores?.[0]?.companyTitle || '',
    taxOffice: user?.stores?.[0]?.taxOffice || '',
    city: user?.stores?.[0]?.city || '',
    district: user?.stores?.[0]?.district || '',
    postalCode: user?.stores?.[0]?.postalCode || '',
  });
  const [storeLoading, setStoreLoading] = useState(false);

  const [invoices, setInvoices] = useState([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (activeTab === 'billing') {
      setInvoicesLoading(true);
      api.get('/auth/invoices')
        .then(res => setInvoices(res.data))
        .catch(() => toast.error('Faturalar yüklenemedi'))
        .finally(() => setInvoicesLoading(false));
    }
    if (activeTab === 'sessions') {
      setSessionsLoading(true);
      api.get('/auth/sessions')
        .then(res => setSessions(res.data))
        .catch(() => toast.error('Oturumlar yüklenemedi'))
        .finally(() => setSessionsLoading(false));
    }
  }, [activeTab]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    navigate(`/settings?tab=${tab}`, { replace: true });
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.put('/auth/profile', {
        name: profileData.name,
        phone: profileData.phone,
      });
      setUser({ ...user, ...res.data });
      toast.success('Profil bilgileri güncellendi');
    } catch (error) {
      toast.error('Profil güncellenemedi');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      return toast.error('Yeni şifreler eşleşmiyor');
    }
    setLoading(true);
    try {
      await api.put('/auth/password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });
      toast.success('Şifreniz başarıyla güncellendi');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      toast.error(error.response?.data?.error || 'Şifre güncellenemedi');
    } finally {
      setLoading(false);
    }
  };

  const handleStoreUpdate = async (e) => {
    e.preventDefault();
    setStoreLoading(true);
    try {
      const [res] = await Promise.all([
        api.put('/auth/store', storeData),
        api.put('/auth/profile', { name: profileData.name, phone: profileData.phone }),
      ]);
      toast.success('Mağaza ayarları güncellendi');
      try {
        const updatedUser = { ...user, phone: profileData.phone };
        if (updatedUser.stores && updatedUser.stores.length > 0) {
          updatedUser.stores[0] = { ...updatedUser.stores[0], ...res.data };
        }
        setUser(updatedUser);
      } catch {}
    } catch (error) {
      toast.error('Mağaza güncellenemedi');
    } finally {
      setStoreLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Hesap Ayarları</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Kişisel bilgilerinizi ve hesap ayarlarınızı yönetin</p>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* Sidebar */}
        <div className="card" style={{ width: 250, padding: '16px 8px' }}>
          <button 
            className={`dropdown-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => handleTabChange('profile')}
            style={{ width: '100%', textAlign: 'left', marginBottom: 4, background: activeTab === 'profile' ? 'var(--bg-hover)' : 'transparent' }}
          >
            <User size={16} style={{ color: activeTab === 'profile' ? 'var(--accent-primary)' : 'inherit' }} /> Profil Bilgileri
          </button>
          
          <button 
            className={`dropdown-item ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => handleTabChange('security')}
            style={{ width: '100%', textAlign: 'left', marginBottom: 4, background: activeTab === 'security' ? 'var(--bg-hover)' : 'transparent' }}
          >
            <Shield size={16} style={{ color: activeTab === 'security' ? 'var(--accent-primary)' : 'inherit' }} /> Güvenlik & Şifre
          </button>

          <button 
            className={`dropdown-item ${activeTab === 'billing' ? 'active' : ''}`}
            onClick={() => handleTabChange('billing')}
            style={{ width: '100%', textAlign: 'left', marginBottom: 4, background: activeTab === 'billing' ? 'var(--bg-hover)' : 'transparent' }}
          >
            <CreditCard size={16} style={{ color: activeTab === 'billing' ? 'var(--accent-primary)' : 'inherit' }} /> Faturalandırma
          </button>

          <button
            className={`dropdown-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => handleTabChange('general')}
            style={{ width: '100%', textAlign: 'left', marginBottom: 4, background: activeTab === 'general' ? 'var(--bg-hover)' : 'transparent' }}
          >
            <Settings size={16} style={{ color: activeTab === 'general' ? 'var(--accent-primary)' : 'inherit' }} /> Genel Ayarlar
          </button>

          <button
            className={`dropdown-item ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => handleTabChange('sessions')}
            style={{ width: '100%', textAlign: 'left', background: activeTab === 'sessions' ? 'var(--bg-hover)' : 'transparent' }}
          >
            <Monitor size={16} style={{ color: activeTab === 'sessions' ? 'var(--accent-primary)' : 'inherit' }} /> Oturum Geçmişi
          </button>
        </div>

        {/* Content Area */}
        <div className="card" style={{ flex: 1, padding: 32 }}>
          {activeTab === 'profile' && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>Profil Bilgileri</h2>
              <form onSubmit={handleProfileUpdate}>
                <div className="grid grid-2" style={{ gap: 20, marginBottom: 20 }}>
                  <div>
                    <label className="form-label">Ad Soyad</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={profileData.name}
                      onChange={e => setProfileData({...profileData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">E-posta Adresi (Değiştirilemez)</label>
                    <input 
                      type="email" 
                      className="form-input" 
                      value={profileData.email}
                      disabled
                      style={{ opacity: 0.7, cursor: 'not-allowed' }}
                    />
                  </div>
                  <div>
                    <label className="form-label">Telefon Numarası</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={profileData.phone}
                      onChange={e => setProfileData({...profileData, phone: e.target.value})}
                      placeholder="05XX XXX XX XX"
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 32 }}>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    <Save size={16} /> {loading ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'security' && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>Güvenlik & Şifre Değiştirme</h2>
              <form onSubmit={handlePasswordUpdate}>
                <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div>
                    <label className="form-label">Mevcut Şifre</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      value={passwordData.currentPassword}
                      onChange={e => setPasswordData({...passwordData, currentPassword: e.target.value})}
                      required
                    />
                  </div>
                  <div style={{ width: '100%', height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
                  <div>
                    <label className="form-label">Yeni Şifre</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      value={passwordData.newPassword}
                      onChange={e => setPasswordData({...passwordData, newPassword: e.target.value})}
                      required
                      minLength={6}
                    />
                  </div>
                  <div>
                    <label className="form-label">Yeni Şifre (Tekrar)</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      value={passwordData.confirmPassword}
                      onChange={e => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                      required
                      minLength={6}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 32 }}>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    <Save size={16} /> {loading ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'billing' && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>Faturalandırma & Abonelik</h2>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Aktif Plan: <strong style={{ color: 'var(--text-primary)' }}>
                    {user?.subscriptions?.[0]?.plan === 'trial' ? 'Deneme Sürümü' : user?.subscriptions?.[0]?.plan === 'premium' ? 'Premium' : 'Aktif Abonelik Yok'}
                  </strong>
                  {user?.subscriptions?.[0]?.endDate && (
                    <span style={{ marginLeft: 8 }}>
                      — Bitiş: {new Date(user.subscriptions[0].endDate).toLocaleDateString('tr-TR')}
                    </span>
                  )}
                </div>
                <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => navigate('/credits')}>
                  Abonelik & Kredi Yönetimi
                </button>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={16} /> Faturalarım
                </h3>
                {invoicesLoading ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>Yükleniyor...</div>
                ) : invoices.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: 10 }}>
                    Henüz fatura bulunmuyor.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Başlık</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Tutar</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Dönem</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Tarih</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600 }}>İndir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map(inv => (
                          <tr key={inv.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500 }}>{inv.title}</td>
                            <td style={{ padding: '10px 12px' }}>₺{Number(inv.amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{inv.period || '—'}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{new Date(inv.createdAt).toLocaleDateString('tr-TR')}</td>
                            <td style={{ padding: '10px 12px' }}>
                              {inv.fileUrl ? (
                                <a href={inv.fileUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-primary)', textDecoration: 'none', fontSize: 12 }}>
                                  <Download size={14} /> İndir
                                  <ExternalLink size={11} />
                                </a>
                              ) : (
                                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>Genel Mağaza Ayarları</h2>
              {storeLoading ? (
                <div style={{ padding: 20, textAlign: 'center' }}>Yükleniyor...</div>
              ) : (
                <form onSubmit={handleStoreUpdate}>

                  {/* Mağaza Bilgileri */}
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>Mağaza Bilgileri</h3>
                  <div className="grid grid-2" style={{ gap: 20, marginBottom: 32 }}>
                    <div>
                      <label className="form-label">Mağaza Adı</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.name}
                        onChange={e => setStoreData({...storeData, name: e.target.value})}
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label">Mağaza Telefonu</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.phone}
                        onChange={e => setStoreData({...storeData, phone: e.target.value})}
                        placeholder="05XX XXX XX XX"
                      />
                    </div>
                    <div>
                      <label className="form-label">Yetkili Telefonu</label>
                      <input
                        type="text"
                        className="form-input"
                        value={profileData.phone}
                        onChange={e => setProfileData({...profileData, phone: e.target.value})}
                        placeholder="05XX XXX XX XX"
                      />
                    </div>
                  </div>

                  {/* Fatura Bilgileri */}
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>Fatura Bilgileri</h3>

                  <div className="grid grid-2" style={{ gap: 20, marginBottom: 20 }}>
                    <div>
                      <label className="form-label">Ad Soyad / Şirket Unvanı</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.companyTitle}
                        onChange={e => setStoreData({...storeData, companyTitle: e.target.value})}
                        placeholder="Ad soyad veya şirket unvanı"
                      />
                    </div>
                    <div>
                      <label className="form-label">TC Kimlik No / Vergi No</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.taxId}
                        onChange={e => setStoreData({...storeData, taxId: e.target.value})}
                        placeholder="TC kimlik no veya vergi numarası"
                      />
                    </div>
                    <div>
                      <label className="form-label">Vergi Dairesi</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.taxOffice}
                        onChange={e => setStoreData({...storeData, taxOffice: e.target.value})}
                        placeholder="Örn: Kadıköy VD"
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label className="form-label">Açık Adres</label>
                      <textarea
                        className="form-input"
                        rows={2}
                        value={storeData.address}
                        onChange={e => setStoreData({...storeData, address: e.target.value})}
                        placeholder="Mahalle, cadde, sokak, bina no, daire no"
                      />
                    </div>
                    <div>
                      <label className="form-label">İl</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.city}
                        onChange={e => setStoreData({...storeData, city: e.target.value})}
                        placeholder="Örn: İstanbul"
                      />
                    </div>
                    <div>
                      <label className="form-label">İlçe</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.district}
                        onChange={e => setStoreData({...storeData, district: e.target.value})}
                        placeholder="Örn: Kadıköy"
                      />
                    </div>
                    <div>
                      <label className="form-label">Posta Kodu</label>
                      <input
                        type="text"
                        className="form-input"
                        value={storeData.postalCode}
                        onChange={e => setStoreData({...storeData, postalCode: e.target.value})}
                        placeholder="Örn: 34710"
                        maxLength={5}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={storeLoading}>
                      <Save size={16} /> {storeLoading ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {activeTab === 'sessions' && (
            <SessionsTab
              sessions={sessions}
              loading={sessionsLoading}
              onTerminate={async (id) => {
                try {
                  await api.delete(`/auth/sessions/${id}`);
                  setSessions(prev => prev.map(s => s.id === id ? { ...s, isActive: false } : s));
                  toast.success('Oturum sonlandırıldı');
                } catch {
                  toast.error('Oturum sonlandırılamadı');
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sessions Tab Component ─────────────────────────────────────── */
function parseBrowser(ua = '') {
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';
  return 'Tarayıcı';
}

function parseOS(ua = '') {
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return '';
}

function isMobile(ua = '') {
  return /iPhone|iPad|Android|Mobile/.test(ua);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return 'Az önce';
  if (m < 60) return `${m} dk önce`;
  if (h < 24) return `${h} saat önce`;
  return `${d} gün önce`;
}

function SessionsTab({ sessions, loading, onTerminate }) {
  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Yükleniyor...</div>;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Oturum Geçmişi</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
          Hesabınıza yapılan girişler ve aktif oturumlar. Tanımadığınız bir oturumu sonlandırabilirsiniz.
        </p>
      </div>

      {sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Oturum kaydı bulunamadı</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessions.map(s => {
            const browser = parseBrowser(s.userAgent);
            const os = parseOS(s.userAgent);
            const mobile = isMobile(s.userAgent);
            return (
              <div key={s.id} style={{
                border: `1px solid ${s.isActive ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                borderRadius: 10, padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: 16,
                background: s.isCurrentSession ? 'rgba(99,102,241,0.04)' : 'transparent',
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: 'var(--bg-primary)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'var(--text-secondary)',
                }}>
                  {mobile ? <Smartphone size={18} /> : <Monitor size={18} />}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                      {browser}{os ? ` · ${os}` : ''}
                    </span>
                    {s.isCurrentSession && (
                      <span style={{ fontSize: 11, background: 'var(--accent-primary)', color: '#fff', borderRadius: 4, padding: '1px 6px' }}>
                        Bu Oturum
                      </span>
                    )}
                    {s.isActive && !s.isCurrentSession && (
                      <span style={{ fontSize: 11, background: 'rgba(34,197,94,0.15)', color: '#22c55e', borderRadius: 4, padding: '1px 6px' }}>
                        Aktif
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Globe size={11} /> {s.ip || 'IP bilinmiyor'}
                    </span>
                    <span>Giriş: {new Date(s.loginAt).toLocaleString('tr-TR')}</span>
                    <span>Son görülme: {timeAgo(s.lastSeenAt)}</span>
                    {s.actionCount > 0 && <span>{s.actionCount} işlem</span>}
                  </div>
                </div>

                {!s.isCurrentSession && s.isActive && (
                  <button
                    className="btn btn-ghost"
                    style={{ color: '#ef4444', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                    onClick={() => onTerminate(s.id)}
                  >
                    <Trash2 size={14} /> Sonlandır
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
