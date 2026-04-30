import { useState, useEffect } from 'react';
import { Plus, TestTube, Trash2, Store, CheckCircle, XCircle, Plug } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

const marketplaceOptions = [
  { value: 'trendyol', label: 'Trendyol', color: '#f27a1a' },
  { value: 'hepsiburada', label: 'Hepsiburada', color: '#ff6000' },
  { value: 'n11', label: 'N11', color: '#7b2d8e' },
  { value: 'ciceksepeti', label: 'Çiçeksepeti', color: '#69b22a' },
];

export default function MarketplacePage() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [testing, setTesting] = useState(null);
  const [form, setForm] = useState({ marketplaceType: 'trendyol', sellerId: '', apiKey: '', apiSecret: '', supplierName: '' });

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      setConnections(res.data);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await api.post('/marketplace/connections', form);
      toast.success('Pazaryeri bağlantısı eklendi');
      setShowModal(false);
      setForm({ marketplaceType: 'trendyol', sellerId: '', apiKey: '', apiSecret: '', supplierName: '' });
      fetchConnections();
    } catch (err) { toast.error(err.response?.data?.error || 'Hata'); }
  };

  const handleTest = async (id) => {
    setTesting(id);
    try {
      const res = await api.post(`/marketplace/connections/${id}/test`);
      if (res.data.success) toast.success(res.data.message);
      else toast.error(res.data.message);
      fetchConnections();
    } catch (err) { toast.error('Bağlantı testi başarısız'); }
    finally { setTesting(null); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Bu bağlantıyı silmek istediğinize emin misiniz?')) return;
    try {
      await api.delete(`/marketplace/connections/${id}`);
      toast.success('Bağlantı silindi');
      fetchConnections();
    } catch { toast.error('Hata'); }
  };

  const getMarketplaceInfo = (type) => marketplaceOptions.find(m => m.value === type) || { label: type, color: '#666' };

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Pazaryeri Bağlantıları</h1><p>Pazaryeri API bilgilerinizi girerek entegrasyonu başlatın</p></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Bağlantı Ekle</button>
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : connections.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Store size={48} className="empty-icon" />
            <h3>Henüz pazaryeri bağlantısı yok</h3>
            <p>Trendyol, Hepsiburada veya diğer pazaryerlerine bağlanarak satışa başlayın</p>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plug size={16} /> İlk Bağlantıyı Kur</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-2">
          {connections.map((c) => {
            const info = getMarketplaceInfo(c.marketplaceType);
            return (
              <div key={c.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: `${info.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: info.color, fontWeight: 700, fontSize: 18 }}>
                      {info.label.charAt(0)}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{info.label}</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Satıcı ID: {c.sellerId || '-'}</p>
                    </div>
                  </div>
                  <span className={`badge ${c.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                    {c.status === 'active' ? <><CheckCircle size={12} /> Bağlı</> : <><XCircle size={12} /> Bağlı Değil</>}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span>📦 {c._count?.marketplaceProducts || 0} ürün</span>
                  <span>📋 {c._count?.orders || 0} sipariş</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleTest(c.id)} disabled={testing === c.id}>
                    <TestTube size={14} /> {testing === c.id ? 'Test ediliyor...' : 'Bağlantıyı Test Et'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c.id)}><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Pazaryeri Bağlantısı Ekle</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Pazaryeri *</label>
                  <select className="form-select" value={form.marketplaceType} onChange={e => setForm({...form, marketplaceType: e.target.value})}>
                    {marketplaceOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Satıcı ID (Seller ID) *</label><input className="form-input" value={form.sellerId} onChange={e => setForm({...form, sellerId: e.target.value})} required /></div>
                <div className="form-group"><label className="form-label">API Key *</label><input className="form-input" value={form.apiKey} onChange={e => setForm({...form, apiKey: e.target.value})} required /></div>
                <div className="form-group"><label className="form-label">API Secret *</label><input type="password" className="form-input" value={form.apiSecret} onChange={e => setForm({...form, apiSecret: e.target.value})} required /></div>
                <div className="form-group"><label className="form-label">Tedarikçi Adı</label><input className="form-input" value={form.supplierName} onChange={e => setForm({...form, supplierName: e.target.value})} /></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>İptal</button>
                <button type="submit" className="btn btn-primary">Bağlan</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
