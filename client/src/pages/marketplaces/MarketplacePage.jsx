import { useState, useEffect } from 'react';
import { Plus, TestTube, Trash2, Store, CheckCircle, XCircle, Plug, Search, Loader2 } from 'lucide-react';
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
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ marketplaceType: 'trendyol', sellerId: '', apiKey: '', apiSecret: '', supplierName: '', defaultBrandId: '', defaultBrandName: '', brandStrategy: 'xml' });

  // Brand search state
  const [brandSearch, setBrandSearch] = useState('');
  const [brandResults, setBrandResults] = useState([]);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandSearchTimeout, setBrandSearchTimeout] = useState(null);

  useEffect(() => { fetchConnections(); }, []);

  // Brand search with debounce
  useEffect(() => {
    if (brandSearchTimeout) clearTimeout(brandSearchTimeout);
    if (!brandSearch.trim() || brandSearch.length < 2) {
      setBrandResults([]);
      return;
    }
    
    const timeout = setTimeout(async () => {
      setBrandLoading(true);
      try {
        // Need sellerId, apiKey, apiSecret to search brands
        if (!form.sellerId || !form.apiKey || !form.apiSecret) {
          toast.error('Marka araması için önce Satıcı ID, API Key ve Secret bilgilerini girin');
          setBrandLoading(false);
          return;
        }
        const res = await api.get('/marketplace/brands/search', {
          params: {
            name: brandSearch,
            sellerId: form.sellerId,
            apiKey: form.apiKey,
            apiSecret: form.apiSecret
          }
        });
        setBrandResults(res.data || []);
      } catch (err) {
        console.error('Marka arama hatası:', err);
        setBrandResults([]);
      } finally {
        setBrandLoading(false);
      }
    }, 500);
    
    setBrandSearchTimeout(timeout);
    return () => clearTimeout(timeout);
  }, [brandSearch]);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      setConnections(res.data);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (form.brandStrategy === 'override' && !form.defaultBrandId) {
      toast.error('Kendi markam stratejisinde bir marka seçmeniz zorunludur.');
      return;
    }
    try {
      await api.post('/marketplace/connections', form);
      toast.success('Pazaryeri bağlantısı eklendi');
      setShowModal(false);
      setForm({ marketplaceType: 'trendyol', sellerId: '', apiKey: '', apiSecret: '', supplierName: '', defaultBrandId: '', defaultBrandName: '', brandStrategy: 'xml' });
      setBrandSearch('');
      setBrandResults([]);
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

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await api.delete(`/marketplace/connections/${id}`);
      toast.success('Bağlantı silindi');
      fetchConnections();
    } catch { toast.error('Hata'); }
  };

  const selectBrand = (brand) => {
    setForm({ ...form, defaultBrandId: brand.id.toString(), defaultBrandName: brand.name });
    setBrandSearch(brand.name);
    setBrandResults([]);
  };

  const getMarketplaceInfo = (type) => marketplaceOptions.find(m => m.value === type) || { label: type, color: '#666' };

  const getConnectionBrand = (c) => {
    if (!c.config) return null;
    try {
      const config = JSON.parse(c.config);
      return config.defaultBrandName || null;
    } catch { return null; }
  };

  const getConnectionBrandStrategy = (c) => {
    if (!c.config) return 'xml';
    try {
      const config = JSON.parse(c.config);
      return config.brandStrategy || 'xml';
    } catch { return 'xml'; }
  };

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
            const brandName = getConnectionBrand(c);
            const brandStrategy = getConnectionBrandStrategy(c);
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
                  {brandName && <span>🏷️ {brandName}</span>}
                  <span>{brandStrategy === 'override' ? '🔒 Kendi markam' : '📦 XML markası'}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleTest(c.id)} disabled={testing === c.id}>
                    <TestTube size={14} /> {testing === c.id ? 'Test ediliyor...' : 'Bağlantıyı Test Et'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(c.id)}><Trash2 size={14} /> Sil</button>
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
                
                {/* Brand Strategy + Search */}
                {form.marketplaceType === 'trendyol' && (
                  <div className="form-group">
                    <label className="form-label">Marka Stratejisi</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, border: `1px solid ${form.brandStrategy === 'xml' ? 'var(--accent-primary)' : 'var(--border-color)'}`, background: form.brandStrategy === 'xml' ? 'rgba(99,102,241,0.06)' : 'transparent' }}>
                        <input type="radio" name="brandStrategy" value="xml" checked={form.brandStrategy === 'xml'} onChange={() => setForm({ ...form, brandStrategy: 'xml' })} style={{ marginTop: 2 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>XML'den gelen marka</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Tedarikçinin marka adı Trendyol'da aranır. Bulunamazsa aşağıdaki yedek marka kullanılır.</div>
                        </div>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, border: `1px solid ${form.brandStrategy === 'override' ? 'var(--accent-primary)' : 'var(--border-color)'}`, background: form.brandStrategy === 'override' ? 'rgba(99,102,241,0.06)' : 'transparent' }}>
                        <input type="radio" name="brandStrategy" value="override" checked={form.brandStrategy === 'override'} onChange={() => setForm({ ...form, brandStrategy: 'override' })} style={{ marginTop: 2 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Kendi markam</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>XML'deki marka yok sayılır, aşağıda seçilen marka her zaman kullanılır.</div>
                        </div>
                      </label>
                    </div>

                    <label className="form-label">
                      {form.brandStrategy === 'override' ? 'Marka *' : 'Yedek Marka (opsiyonel)'}
                    </label>
                    <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11, marginBottom: 8 }}>
                      Trendyol'da kayıtlı markalardan arayıp seçin. Aramanın çalışması için önce yukarıdaki API bilgilerini girin.
                    </small>
                    <div style={{ position: 'relative' }}>
                      <Search size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                      <input
                        className="form-input"
                        style={{ paddingLeft: 34 }}
                        placeholder="Marka adı yazın (en az 2 karakter)..."
                        value={brandSearch}
                        onChange={e => {
                          setBrandSearch(e.target.value);
                          if (form.defaultBrandId) {
                            setForm({ ...form, defaultBrandId: '', defaultBrandName: '' });
                          }
                        }}
                      />
                      {brandLoading && <Loader2 size={14} className="spinning" style={{ position: 'absolute', right: 12, top: 12, color: 'var(--text-muted)' }} />}
                    </div>

                    {/* Selected brand indicator */}
                    {form.defaultBrandId && (
                      <div style={{
                        marginTop: 8, padding: '8px 12px', borderRadius: 8,
                        background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                        fontSize: 13, display: 'flex', alignItems: 'center', gap: 6
                      }}>
                        <CheckCircle size={14} style={{ color: 'var(--success)' }} />
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>{form.defaultBrandName}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 'auto' }}>ID: {form.defaultBrandId}</span>
                      </div>
                    )}

                    {/* Brand results dropdown */}
                    {brandResults.length > 0 && !form.defaultBrandId && (
                      <div style={{
                        marginTop: 4, maxHeight: 200, overflowY: 'auto',
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
                      }}>
                        {brandResults.slice(0, 20).map(brand => (
                          <button
                            key={brand.id}
                            type="button"
                            onClick={() => selectBrand(brand)}
                            style={{
                              display: 'block', width: '100%', padding: '10px 14px',
                              background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)',
                              textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)',
                              transition: 'background 0.15s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.06)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <div style={{ fontWeight: 500 }}>{brand.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {brand.id}</div>
                          </button>
                        ))}
                      </div>
                    )}

                    {brandSearch.length >= 2 && !brandLoading && brandResults.length === 0 && !form.defaultBrandId && (
                      <div style={{ marginTop: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                        "{brandSearch}" ile eşleşen marka bulunamadı
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>İptal</button>
                <button type="submit" className="btn btn-primary">Bağlan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== DELETE CONFIRM MODAL ===== */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3>Bağlantıyı Sil</h3>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Bu pazaryeri bağlantısını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>İptal</button>
              <button className="btn btn-danger" onClick={handleDelete}>Evet, Sil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
