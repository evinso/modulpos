import { useState, useEffect } from 'react';
import { Plus, Trash2, MessageSquare, Wifi, WifiOff, QrCode, RefreshCw, Send, LogOut, RotateCcw, X, Pencil, Bell } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';

const STATE_MAP = {
  authorized:    { label: 'Bağlı',      color: 'var(--success)',  bg: 'rgba(16,185,129,0.12)',  icon: <Wifi size={13} /> },
  notAuthorized: { label: 'Bağlı Değil', color: 'var(--danger)',  bg: 'rgba(239,68,68,0.12)',   icon: <WifiOff size={13} /> },
  blocked:       { label: 'Engellendi', color: 'var(--danger)',   bg: 'rgba(239,68,68,0.12)',   icon: <WifiOff size={13} /> },
  starting:      { label: 'Başlatılıyor', color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)', icon: <RefreshCw size={13} /> },
};

export default function WhatsappPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editConn, setEditConn] = useState(null);
  const [form, setForm] = useState({ name: '', instanceId: '' });
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState({});
  const [statuses, setStatuses] = useState({});
  const [statusLoading, setStatusLoading] = useState({});
  const [qrData, setQrData] = useState({}); // connId → { type, message }
  const [qrLoading, setQrLoading] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [sendModal, setSendModal] = useState(null); // connId
  const [sendForm, setSendForm] = useState({ phone: '', message: '' });
  const [sending, setSending] = useState(false);

  const [wahaSettings, setWahaSettings] = useState({
    waha_enabled: 'false', waha_session: 'default', waha_admin_phone: '', waha_events: '["new_user","subscription","subscription_expired","credit_topup","new_support_ticket","new_order"]', waha_otp_enabled: 'false',
  });
  const [wahaLoading, setWahaLoading] = useState(false);
  const [wahaTesting, setWahaTesting] = useState(false);

  useEffect(() => { fetchConnections(); loadWahaSettings(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/whatsapp/connections');
      setConnections(res.data);
      // Auto-check status for all
      res.data.forEach(c => checkStatus(c.id));
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const checkStatus = async (id) => {
    setStatusLoading(p => ({ ...p, [id]: true }));
    try {
      const res = await api.get(`/whatsapp/connections/${id}/status`);
      setStatuses(p => ({ ...p, [id]: res.data.stateInstance }));
    } catch {
      setStatuses(p => ({ ...p, [id]: 'error' }));
    } finally {
      setStatusLoading(p => ({ ...p, [id]: false }));
    }
  };

  const fetchQR = async (id) => {
    setQrLoading(p => ({ ...p, [id]: true }));
    setQrData(p => ({ ...p, [id]: null }));
    try {
      const res = await api.get(`/whatsapp/connections/${id}/qr`);
      setQrData(p => ({ ...p, [id]: res.data }));
    } catch { toast.error('QR kod alınamadı'); }
    finally { setQrLoading(p => ({ ...p, [id]: false })); }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editConn) {
        await api.put(`/whatsapp/connections/${editConn.id}`, form);
        toast.success('Bağlantı güncellendi');
      } else {
        await api.post('/whatsapp/connections', form);
        toast.success('Bağlantı eklendi');
      }
      setShowModal(false);
      setEditConn(null);
      setForm({ name: '', instanceId: '' });
      fetchConnections();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Kayıt hatası');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/whatsapp/connections/${deleteConfirm}`);
      toast.success('Bağlantı silindi');
      setDeleteConfirm(null);
      fetchConnections();
    } catch { toast.error('Silme hatası'); }
  };

  const handleLogout = async (id) => {
    try {
      await api.post(`/whatsapp/connections/${id}/logout`);
      toast.success('WhatsApp oturumu kapatıldı');
      checkStatus(id);
    } catch { toast.error('Oturum kapatma hatası'); }
  };

  const handleReboot = async (id) => {
    try {
      await api.post(`/whatsapp/connections/${id}/reboot`);
      toast.success('Instance yeniden başlatılıyor...');
      setTimeout(() => checkStatus(id), 5000);
    } catch { toast.error('Yeniden başlatma hatası'); }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      await api.post(`/whatsapp/connections/${sendModal}/send`, sendForm);
      toast.success('Mesaj gönderildi');
      setSendModal(null);
      setSendForm({ phone: '', message: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Mesaj gönderilemedi');
    } finally { setSending(false); }
  };

  const loadWahaSettings = async () => {
    try {
      const res = await api.get('/admin/system-settings?keys=waha_enabled,waha_session,waha_admin_phone,waha_events,waha_otp_enabled');
      setWahaSettings(s => ({
        ...s,
        waha_enabled: res.data.waha_enabled || 'false',
        waha_session: res.data.waha_session || 'default',
        waha_admin_phone: res.data.waha_admin_phone || '',
        waha_events: res.data.waha_events || s.waha_events,
        waha_otp_enabled: res.data.waha_otp_enabled || 'false',
      }));
    } catch {}
  };

  const handleSaveWahaSettings = async (e) => {
    e.preventDefault();
    setWahaLoading(true);
    try {
      await api.post('/admin/system-settings', wahaSettings);
      toast.success('Bildirim ayarları kaydedildi');
    } catch { toast.error('Kaydedilemedi'); }
    finally { setWahaLoading(false); }
  };

  const handleWahaTest = async () => {
    setWahaTesting(true);
    try {
      await api.post('/admin/whatsapp-test');
      toast.success('Test mesajı gönderildi');
    } catch (err) { toast.error(err.response?.data?.error || 'Gönderilemedi'); }
    finally { setWahaTesting(false); }
  };

  const toggleWahaEvent = (key) => {
    let current;
    try { current = JSON.parse(wahaSettings.waha_events || '[]'); } catch { current = []; }
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    setWahaSettings(s => ({ ...s, waha_events: JSON.stringify(next) }));
  };

  const openEdit = (c) => {
    setEditConn(c);
    setForm({ name: c.name, instanceId: c.instanceId });
    setShowModal(true);
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Bu sayfaya erişim yetkiniz yok.</div>;
  }

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>WhatsApp Entegrasyonu</h1>
          <p>WAHA üzerinden WhatsApp hesaplarınızı yönetin</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditConn(null); setForm({ name: '', instanceId: '' }); setShowModal(true); }}>
          <Plus size={16} /> Bağlantı Ekle
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <MessageSquare size={48} className="empty-icon" />
            <h3>Henüz WhatsApp bağlantısı yok</h3>
            <p>Yeni bağlantı ekleyip QR kodu tarayarak WhatsApp hesabınızı bağlayın.</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> Bağlantı Ekle
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {connections.map(c => {
            const state = statuses[c.id];
            const stateInfo = STATE_MAP[state] || { label: state || '—', color: 'var(--text-muted)', bg: 'var(--bg-tertiary)', icon: null };
            const isAuthorized = state === 'authorized';
            const qr = qrData[c.id];

            return (
              <div key={c.id} className="card" style={{ padding: 20 }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(37,211,102,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MessageSquare size={20} color="#25d366" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>#{c.instanceId}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openEdit(c)} className="btn btn-secondary btn-sm" title="Düzenle"><Pencil size={13} /></button>
                    <button onClick={() => setDeleteConfirm(c.id)} className="btn btn-danger btn-sm" title="Sil"><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 6, background: stateInfo.bg, color: stateInfo.color }}>
                    {stateInfo.icon} {stateInfo.label}
                  </span>
                  <button onClick={() => checkStatus(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }} title="Durumu yenile">
                    <RefreshCw size={13} className={statusLoading[c.id] ? 'spinning' : ''} />
                  </button>
                </div>

                {/* Session info */}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
                  Oturum: <code style={{ fontSize: 11, background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>{c.instanceId}</code>
                </div>

                {/* QR Code Section */}
                {!isAuthorized && (
                  <div style={{ marginBottom: 14 }}>
                    <button className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={() => fetchQR(c.id)} disabled={qrLoading[c.id]}>
                      <QrCode size={14} /> {qrLoading[c.id] ? 'QR Yükleniyor...' : 'QR Kodu Göster'}
                    </button>
                    {qr && (
                      <div style={{ marginTop: 10, textAlign: 'center' }}>
                        {qr.type === 'qrCode' ? (
                          <>
                            <img src={`data:image/png;base64,${qr.message}`} alt="QR Code" style={{ width: 180, height: 180, borderRadius: 8, border: '1px solid var(--border-color)' }} />
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>WhatsApp ile QR kodu tarayın</div>
                          </>
                        ) : qr.type === 'alreadyLogged' ? (
                          <div style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>✓ Zaten giriş yapılmış</div>
                        ) : (
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{qr.message}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => { setSendModal(c.id); setSendForm({ phone: '', message: '' }); }}>
                    <Send size={13} /> Test Mesajı
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleReboot(c.id)} title="Yeniden Başlat">
                    <RotateCcw size={13} />
                  </button>
                  {isAuthorized && (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleLogout(c.id)} title="Oturumu Kapat">
                      <LogOut size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bildirim Ayarları */}
      <div className="card" style={{ padding: 24, maxWidth: 560, marginTop: 24 }}>
        <h3 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={18} /> Bildirim Ayarları
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Mesajlar bağlı numaradan hem yöneticiye hem ilgili kullanıcıya gönderilir.
        </p>
        <form onSubmit={handleSaveWahaSettings} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Bildirimleri Etkinleştir</label>
            <button type="button"
              onClick={() => setWahaSettings(s => ({ ...s, waha_enabled: s.waha_enabled === 'true' ? 'false' : 'true' }))}
              style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', background: wahaSettings.waha_enabled === 'true' ? '#25d366' : 'var(--border)', transition: 'background 0.2s' }}
            >
              <span style={{ position: 'absolute', top: 3, left: wahaSettings.waha_enabled === 'true' ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </button>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">WAHA Oturum Adı</label>
            <input type="text" className="form-input" placeholder="default"
              value={wahaSettings.waha_session}
              onChange={e => setWahaSettings(s => ({ ...s, waha_session: e.target.value }))}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>Yukarıda oluşturduğunuz oturumun adıyla aynı olmalı</span>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Yönetici Telefon Numarası</label>
            <input type="text" className="form-input" placeholder="905XXXXXXXXX"
              value={wahaSettings.waha_admin_phone}
              onChange={e => setWahaSettings(s => ({ ...s, waha_admin_phone: e.target.value }))}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>Tüm sistem bildirimleri bu numaraya gönderilir. Ülke kodu dahil, + olmadan.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
              WhatsApp OTP Doğrulaması
              <span style={{ display: 'block', fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Telefon numarası kayıtlı kullanıcılar yeni cihazdan girişte WhatsApp kodu alır
              </span>
            </label>
            <button type="button"
              onClick={() => setWahaSettings(s => ({ ...s, waha_otp_enabled: s.waha_otp_enabled === 'true' ? 'false' : 'true' }))}
              style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', background: wahaSettings.waha_otp_enabled === 'true' ? '#25d366' : 'var(--border)', transition: 'background 0.2s', flexShrink: 0 }}
            >
              <span style={{ position: 'absolute', top: 3, left: wahaSettings.waha_otp_enabled === 'true' ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </button>
          </div>
          <div>
            <label className="form-label" style={{ marginBottom: 10 }}>Bildirim Olayları</label>
            {[
              { key: 'new_order',          label: '🛒 Yeni sipariş (admin + kullanıcı)' },
              { key: 'order_status',       label: '📦 Sipariş durumu değişti (admin + kullanıcı)' },
              { key: 'new_user',           label: '🆕 Yeni üye kaydı (admin)' },
              { key: 'subscription',       label: '💳 Abonelik güncellemesi (admin + kullanıcı)' },
              { key: 'subscription_expired', label: '⏰ Abonelik süresi doldu (admin + kullanıcı)' },
              { key: 'credit_topup',       label: '💰 Kredi yükleme (admin + kullanıcı)' },
              { key: 'payment_failed',     label: '❌ Ödeme başarısız (admin + kullanıcı)' },
              { key: 'new_support_ticket', label: '🎫 Yeni destek talebi (admin)' },
              { key: 'support_reply',      label: '💬 Destek yanıtlandı (kullanıcı)' },
              { key: 'xml_error',          label: '⚠️ XML senkron hatası (admin)' },
              { key: 'user_login',         label: '🔑 Yeni cihazdan giriş (admin)' },
              { key: 'product_sync',       label: '✅ XML senkronizasyon tamamlandı (admin)' },
              { key: 'trendyol_update',    label: '🟠 Trendyol stok/fiyat güncellendi (admin + kullanıcı)' },
              { key: 'new_marketplace',    label: '🔗 Yeni pazaryeri bağlandı (admin + kullanıcı)' },
              { key: 'low_credit',         label: '⚠️ Düşük kredi uyarısı (admin + kullanıcı)' },
            ].map(ev => {
              let events = [];
              try { events = JSON.parse(wahaSettings.waha_events || '[]'); } catch { events = []; }
              return (
                <label key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={events.includes(ev.key)} onChange={() => toggleWahaEvent(ev.key)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                  {ev.label}
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="btn btn-secondary" onClick={handleWahaTest} disabled={wahaTesting || wahaSettings.waha_enabled !== 'true'}>
              {wahaTesting ? 'Gönderiliyor...' : 'Test Gönder'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={wahaLoading}>
              {wahaLoading ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editConn ? 'Bağlantıyı Düzenle' : 'Yeni WhatsApp Bağlantısı'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="form-label">Bağlantı Adı</label>
                <input className="form-input" placeholder="ör. Müşteri Hattı" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Oturum Adı</label>
                <input className="form-input" placeholder="default" value={form.instanceId} onChange={e => setForm(p => ({ ...p, instanceId: e.target.value }))} required />
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚠️ WAHA ücretsiz sürümde oturum adı mutlaka <strong>default</strong> olmalıdır.</div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>İptal</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Send Test Message Modal */}
      {sendModal && (
        <div className="modal-overlay" onClick={() => setSendModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Test Mesajı Gönder</h3>
              <button onClick={() => setSendModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <form onSubmit={handleSendMessage} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="form-label">Telefon Numarası</label>
                <input className="form-input" placeholder="905XXXXXXXXX (ülke kodu ile)" value={sendForm.phone} onChange={e => setSendForm(p => ({ ...p, phone: e.target.value }))} required />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Başında + olmadan, ülke koduyla birlikte girin</div>
              </div>
              <div>
                <label className="form-label">Mesaj</label>
                <textarea className="form-input" rows={4} placeholder="Mesajınızı yazın..." value={sendForm.message} onChange={e => setSendForm(p => ({ ...p, message: e.target.value }))} required style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setSendModal(null)}>İptal</button>
                <button type="submit" className="btn btn-primary" disabled={sending}>
                  <Send size={14} /> {sending ? 'Gönderiliyor...' : 'Gönder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Bağlantıyı Sil</h3></div>
            <div style={{ padding: 24 }}>
              <p style={{ marginBottom: 20 }}>Bu WhatsApp bağlantısını silmek istediğinizden emin misiniz?</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>İptal</button>
                <button className="btn btn-danger" onClick={handleDelete}>Sil</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
