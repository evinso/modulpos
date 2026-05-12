import React, { useState, useEffect } from 'react';
import { Wallet, Settings, Users, Plus, Save, Search, CreditCard, ArrowUpRight, ArrowDownRight, Activity, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function CreditAdminPage() {
  const [activeTab, setActiveTab] = useState('settings');
  const [settings, setSettings] = useState({
    credit_xml_convert: '1',
    credit_xml_import_default: '5',
    credit_buybox_check: '1'
  });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Topup modal
  const [topupModal, setTopupModal] = useState(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupDesc, setTopupDesc] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);

  const [userSearch, setUserSearch] = useState('');

  // PayTR logs
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchUsers();
  }, []);

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await api.get('/credits/admin/paytr-logs');
      setLogs(res.data);
    } catch {
      toast.error('Loglar yüklenemedi');
    } finally {
      setLogsLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await api.get('/credits/admin/settings');
      setSettings(prev => ({ ...prev, ...res.data }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/credits/admin/users');
      setUsers(res.data);
    } catch (err) {
      toast.error('Kullanıcılar yüklenemedi');
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await api.put('/credits/admin/settings', { settings });
      toast.success('Kredi ayarları kaydedildi');
    } catch (err) {
      toast.error('Kaydetme hatası');
    } finally {
      setSaving(false);
    }
  };

  const handleTopup = async () => {
    if (!topupAmount || parseFloat(topupAmount) <= 0) {
      toast.error('Geçerli bir tutar girin');
      return;
    }
    setTopupLoading(true);
    try {
      await api.post('/credits/admin/topup', {
        userId: topupModal.id,
        amount: parseFloat(topupAmount),
        description: topupDesc || undefined
      });
      toast.success(`${topupAmount} kredi yüklendi: ${topupModal.name}`);
      setTopupModal(null);
      setTopupAmount('');
      setTopupDesc('');
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Yükleme hatası');
    } finally {
      setTopupLoading(false);
    }
  };

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-title">
        <h1>Kredi Yönetimi</h1>
        <p>İşlem ücretlerini belirleyin ve kullanıcılara kredi yükleyin</p>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button
          className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={16} /> Fiyatlandırma Ayarları
        </button>
        <button
          className={`btn ${activeTab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('users')}
        >
          <Users size={16} /> Kullanıcı Bakiyeleri
        </button>
        <button
          className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setActiveTab('logs'); fetchLogs(); }}
        >
          <Activity size={16} /> PayTR Bildirimleri
        </button>
      </div>

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="card" style={{ maxWidth: 600 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={18} style={{ color: 'var(--accent-primary)' }} />
            İşlem Ücretleri
          </h3>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">XML Dönüştürme Ücreti (Kredi)</label>
            <input
              type="number"
              className="form-input"
              min="0"
              step="0.5"
              value={settings.credit_xml_convert}
              onChange={e => setSettings({ ...settings, credit_xml_convert: e.target.value })}
              placeholder="1"
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
              Her XML dönüştürme/önizleme işlemi için kesilecek kredi. 0 = ücretsiz.
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">XML İçe Aktarma Varsayılan Ücreti (Kredi)</label>
            <input
              type="number"
              className="form-input"
              min="0"
              step="0.5"
              value={settings.credit_xml_import_default}
              onChange={e => setSettings({ ...settings, credit_xml_import_default: e.target.value })}
              placeholder="5"
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
              Hazır XML Market'ten eklenen XML'ler için varsayılan ücret. Tedarikçi başına özel fiyat Global XML Admin'den ayarlanabilir.
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">BuyBox Kontrol Ücreti (Kredi / 10 Barkod)</label>
            <input
              type="number"
              className="form-input"
              min="0"
              step="0.5"
              value={settings.credit_buybox_check}
              onChange={e => setSettings({ ...settings, credit_buybox_check: e.target.value })}
              placeholder="1"
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
              Her 10 barkod için (1 Trendyol API isteği) kesilecek kredi. 0 = ücretsiz.
            </span>
          </div>

          <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 40, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
            <Wallet size={18} style={{ color: 'var(--accent-primary)' }} />
            PayTR API Ayarları (Kredi Yükleme)
          </h3>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Mağaza Numarası (Merchant ID)</label>
            <input
              type="text"
              className="form-input"
              value={settings.paytr_merchant_id || ''}
              onChange={e => setSettings({ ...settings, paytr_merchant_id: e.target.value })}
              placeholder="XXXXXX"
            />
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Mağaza Parolası (Merchant Key)</label>
            <input
              type="password"
              className="form-input"
              value={settings.paytr_merchant_key || ''}
              onChange={e => setSettings({ ...settings, paytr_merchant_key: e.target.value })}
              placeholder="XXXXXXXXXXXXXXXX"
            />
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Mağaza Gizli Anahtarı (Merchant Salt)</label>
            <input
              type="password"
              className="form-input"
              value={settings.paytr_merchant_salt || ''}
              onChange={e => setSettings({ ...settings, paytr_merchant_salt: e.target.value })}
              placeholder="XXXXXXXXXXXXXXXX"
            />
          </div>

          <button className="btn btn-primary" onClick={handleSaveSettings} disabled={saving}>
            <Save size={16} /> {saving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
          </button>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="card">
          <div className="table-header">
            <h3><Wallet size={18} /> Kullanıcı Bakiyeleri</h3>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
              <input
                className="form-input"
                style={{ paddingLeft: 30, width: 240 }}
                placeholder="Kullanıcı ara..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>E-posta</th>
                  <th>Rol</th>
                  <th style={{ textAlign: 'right' }}>Bakiye</th>
                  <th style={{ textAlign: 'center' }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.name}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role === 'admin' || u.role === 'superadmin' ? 'badge-primary' : 'badge-secondary'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{
                        fontWeight: 600, fontSize: 15,
                        color: u.creditBalance > 0 ? 'var(--success)' : 'var(--text-muted)'
                      }}>
                        {u.creditBalance.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => setTopupModal(u)}
                      >
                        <Plus size={14} /> Kredi Yükle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PayTR Logs Tab */}
      {activeTab === 'logs' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-header">
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={18} /> PayTR Bildirimleri
            </h3>
            <button className="btn btn-secondary" onClick={fetchLogs} disabled={logsLoading}>
              <RefreshCw size={14} className={logsLoading ? 'spinning' : ''} />
            </button>
          </div>

          {logsLoading ? (
            <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          ) : logs.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
              Henüz PayTR bildirimi alınmamış.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    {['Durum', 'Kullanıcı', 'Tür', 'Tutar', 'Merchant OID', 'Hata', 'Tarih'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 14px' }}>
                        {log.status === 'success'
                          ? <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CheckCircle size={11} /> Başarılı</span>
                          : <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><XCircle size={11} /> Başarısız</span>}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13 }}>
                        <div style={{ fontWeight: 500 }}>{log.userEmail || '—'}</div>
                        {log.userId && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{log.userId.slice(0, 8)}…</div>}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span className={`badge ${log.type === 'subscription' ? 'badge-primary' : 'badge-info'}`}>
                          {log.type === 'subscription' ? 'Abonelik' : log.type === 'topup' ? 'Kredi Yükleme' : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>
                        ₺{Number(log.totalAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {log.merchantOid}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--danger)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.failReason || '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(log.createdAt).toLocaleString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Topup Modal */}
      {topupModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 0 }}>
            <div className="table-header">
              <h3>Kredi Yükle: {topupModal.name}</h3>
              <button className="text-btn" onClick={() => setTopupModal(null)}>Kapat</button>
            </div>
            <div style={{ padding: 20 }}>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Yüklenecek Kredi</label>
                <input
                  type="number"
                  className="form-input"
                  min="0.5"
                  step="0.5"
                  value={topupAmount}
                  onChange={e => setTopupAmount(e.target.value)}
                  placeholder="Örn: 50"
                  autoFocus
                />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Açıklama (opsiyonel)</label>
                <input
                  type="text"
                  className="form-input"
                  value={topupDesc}
                  onChange={e => setTopupDesc(e.target.value)}
                  placeholder="Örn: Başlangıç paketi"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn btn-secondary" onClick={() => setTopupModal(null)}>İptal</button>
                <button className="btn btn-primary" onClick={handleTopup} disabled={topupLoading}>
                  {topupLoading ? 'Yükleniyor...' : 'Kredi Yükle'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
