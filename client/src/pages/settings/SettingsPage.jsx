import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { User, Settings, Shield, CreditCard, Save } from 'lucide-react';
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

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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
            style={{ width: '100%', textAlign: 'left', background: activeTab === 'general' ? 'var(--bg-hover)' : 'transparent' }}
          >
            <Settings size={16} style={{ color: activeTab === 'general' ? 'var(--accent-primary)' : 'inherit' }} /> Genel Ayarlar
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
              <div className="alert alert-info" style={{ marginBottom: 24 }}>
                Aboneliğiniz şu an <strong>{user?.subscriptions?.[0]?.plan === 'trial' ? 'Deneme Sürümü' : 'Premium'}</strong> planında.
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
                Bakiye ve kredi yükleme işlemleri için sol menüdeki <strong>Kredi Yönetimi</strong> sayfasına gidebilirsiniz. Kredi yönetimi üzerinden modülPOS hizmetlerini kesintisiz kullanabilirsiniz.
              </p>
              <button className="btn btn-primary" onClick={() => navigate('/credits')}>
                Kredi Yönetimine Git
              </button>
            </div>
          )}

          {activeTab === 'general' && (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>Genel Mağaza Ayarları</h2>
              <div className="alert alert-warning">
                Bu alandaki mağaza vergi, fatura ve adres ayarları yakında aktif edilecektir. 
              </div>
              <p style={{ color: 'var(--text-secondary)' }}>
                Tüm entegrasyonlar mevcut mağaza kimliğiniz üzerinden çalışmaktadır.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
