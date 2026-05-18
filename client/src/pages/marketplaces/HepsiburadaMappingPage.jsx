import { useState, useEffect, useMemo } from 'react';
import { ArrowRight, Search, Check, Loader2, FolderTree, AlertCircle, X } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function HepsiburadaMappingPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [localCategories, setLocalCategories] = useState([]);
  const [hbCategories, setHbCategories] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catLoading, setCatLoading] = useState(false);

  const [selectedLocal, setSelectedLocal] = useState('');
  const [catSearch, setCatSearch] = useState('');
  const [selectedHb, setSelectedHb] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const hbConns = res.data.filter(c => c.marketplaceType === 'hepsiburada');
      setConnections(hbConns);
      if (hbConns.length > 0) loadData(hbConns[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const loadData = async (conn) => {
    setSelectedConn(conn);
    setCatLoading(true);
    try {
      const [localRes, catRes, mapRes] = await Promise.all([
        api.get('/marketplace/local-categories'),
        api.get(`/marketplace/connections/${conn.id}/categories`),
        api.get(`/marketplace/connections/${conn.id}/category-mappings`),
      ]);
      setLocalCategories(localRes.data);
      const cats = catRes.data?.categories || catRes.data?.data || (Array.isArray(catRes.data) ? catRes.data : []);
      setHbCategories(cats);
      setMappings(mapRes.data);
    } catch (err) {
      toast.error('Veriler yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setCatLoading(false); }
  };

  // Flatten tree for search
  const flatCategories = useMemo(() => {
    const result = [];
    const flatten = (cats, path = '') => {
      if (!Array.isArray(cats)) return;
      for (const cat of cats) {
        const id = cat.id || cat.categoryId;
        const name = cat.name || cat.categoryName;
        const fullPath = path ? `${path} > ${name}` : name;
        result.push({ id, name, fullPath });
        const children = cat.subCategories || cat.children || cat.subCategoryList || [];
        if (children.length) flatten(children, fullPath);
      }
    };
    flatten(hbCategories);
    return result;
  }, [hbCategories]);

  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return [];
    const q = catSearch.toLowerCase();
    return flatCategories.filter(c => c.fullPath.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 40);
  }, [catSearch, flatCategories]);

  const mappedLookup = useMemo(() => {
    const m = {};
    for (const mp of mappings) m[mp.localCategory] = mp;
    return m;
  }, [mappings]);

  const unmappedCategories = localCategories.filter(c => !mappedLookup[c]);
  const mappedCategories = localCategories.filter(c => mappedLookup[c]);

  const handleSave = async () => {
    if (!selectedLocal || !selectedHb || !selectedConn) return;
    setSaving(true);
    try {
      await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
        localCategory: selectedLocal,
        marketplaceCategoryId: String(selectedHb.id),
        marketplaceCategoryName: selectedHb.name,
        attributes: JSON.stringify([]),
      });
      toast.success(`"${selectedLocal}" → "${selectedHb.name}" eşlemesi kaydedildi`);
      const mapRes = await api.get(`/marketplace/connections/${selectedConn.id}/category-mappings`);
      setMappings(mapRes.data);
      setSelectedLocal('');
      setSelectedHb(null);
      setCatSearch('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Kayıt hatası');
    } finally { setSaving(false); }
  };

  const handleDelete = async (mappingId) => {
    setDeletingId(mappingId);
    try {
      await api.delete(`/marketplace/category-mappings/${mappingId}`);
      setMappings(prev => prev.filter(m => m.id !== mappingId));
      toast.success('Eşleme silindi');
    } catch {
      toast.error('Silme hatası');
    } finally { setDeletingId(null); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Hepsiburada — Kategori Eşleştirme</h1></div>
        <div className="card">
          <div className="empty-state">
            <FolderTree size={48} className="empty-icon" />
            <h3>Hepsiburada bağlantısı bulunamadı</h3>
            <p>Lütfen önce <a href="/marketplace" style={{ color: 'var(--accent-primary)' }}>Pazaryeri Bağlantıları</a> sayfasından Hepsiburada hesabınızı ekleyin.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Kategori Eşleştirme</h1>
          <p>Ürün kategorilerinizi Hepsiburada kategorileriyle eşleştirin</p>
        </div>
        {connections.length > 1 && (
          <select className="form-select" style={{ width: 220 }} value={selectedConn?.id || ''}
            onChange={e => loadData(connections.find(c => c.id === e.target.value))}>
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
          </select>
        )}
      </div>

      {catLoading ? (
        <div className="loading-spinner"><div className="spinner"></div></div>
      ) : (
        <div className="grid grid-2" style={{ gap: 20, alignItems: 'start' }}>

          {/* Left: mapping form */}
          <div>
            <div className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>Yeni Eşleme Ekle</h3>

              {/* Local category select */}
              <div className="form-group">
                <label className="form-label">Yerel Kategori</label>
                <select className="form-select" value={selectedLocal} onChange={e => setSelectedLocal(e.target.value)}>
                  <option value="">Kategori seçin...</option>
                  <optgroup label={`Eşleşmeyenler (${unmappedCategories.length})`}>
                    {unmappedCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                  {mappedCategories.length > 0 && (
                    <optgroup label={`Zaten eşleşmiş (${mappedCategories.length})`}>
                      {mappedCategories.map(c => <option key={c} value={c}>{c} ✓</option>)}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* HepsiBurada category search */}
              <div className="form-group">
                <label className="form-label">Hepsiburada Kategorisi</label>
                {hbCategories.length === 0 ? (
                  <div style={{ padding: '12px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid var(--warning)', borderRadius: 8, fontSize: 13, display: 'flex', gap: 8 }}>
                    <AlertCircle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <span>Kategoriler yüklenemedi. Hepsiburada MPOP API'nize erişim izni olduğundan emin olun.</span>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
                    <input
                      className="form-input"
                      style={{ paddingLeft: 32 }}
                      placeholder="Kategori adı yazın..."
                      value={catSearch}
                      onChange={e => { setCatSearch(e.target.value); setSelectedHb(null); }}
                    />
                  </div>
                )}

                {selectedHb && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.25)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check size={14} style={{ color: '#ff6000' }} />
                    <span style={{ color: '#ff6000', fontWeight: 600, flex: 1 }}>{selectedHb.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {selectedHb.id}</span>
                    <button type="button" onClick={() => { setSelectedHb(null); setCatSearch(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                      <X size={14} />
                    </button>
                  </div>
                )}

                {filteredCategories.length > 0 && !selectedHb && (
                  <div style={{ marginTop: 4, maxHeight: 250, overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                    {filteredCategories.map(cat => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => { setSelectedHb(cat); setCatSearch(cat.name); }}
                        style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)', textAlign: 'left', cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,96,0,0.06)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <div style={{ fontWeight: 500 }}>{cat.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{cat.fullPath}</div>
                      </button>
                    ))}
                  </div>
                )}

                {catSearch.length >= 2 && filteredCategories.length === 0 && !selectedHb && hbCategories.length > 0 && (
                  <div style={{ marginTop: 8, padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                    "{catSearch}" ile eşleşen kategori bulunamadı
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={!selectedLocal || !selectedHb || saving}
                onClick={handleSave}
              >
                {saving ? <><Loader2 size={14} className="spinning" /> Kaydediliyor...</> : <><ArrowRight size={14} /> Eşlemeyi Kaydet</>}
              </button>
            </div>
          </div>

          {/* Right: existing mappings */}
          <div>
            <div className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>Mevcut Eşlemeler ({mappings.length})</h3>
              {mappings.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>
                  Henüz eşleme yok
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mappings.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ flex: 1, fontWeight: 500 }}>{m.localCategory}</span>
                      <ArrowRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <span style={{ flex: 1, color: '#ff6000' }}>{m.marketplaceCategoryName || m.marketplaceCategoryId}</span>
                      <button
                        onClick={() => handleDelete(m.id)}
                        disabled={deletingId === m.id}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 4 }}
                        title="Sil"
                      >
                        {deletingId === m.id ? <Loader2 size={14} className="spinning" /> : <X size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {unmappedCategories.length > 0 && (
                <div style={{ marginTop: 16, padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', marginBottom: 6 }}>Eşleşmemiş Kategoriler ({unmappedCategories.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {unmappedCategories.map(c => (
                      <span
                        key={c}
                        onClick={() => setSelectedLocal(c)}
                        style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--warning)', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
