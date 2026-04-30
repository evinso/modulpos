import { useState, useEffect, useMemo } from 'react';
import { ArrowRight, Search, Check, Trash2, ChevronRight, ChevronDown, Loader2, Link2, AlertCircle, FolderTree } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function CategoryMappingPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [localCategories, setLocalCategories] = useState([]);
  const [trendyolCategories, setTrendyolCategories] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catLoading, setCatLoading] = useState(false);

  // Mapping form state
  const [selectedLocal, setSelectedLocal] = useState('');
  const [catSearch, setCatSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState(new Set());
  const [selectedTrendyol, setSelectedTrendyol] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const trendyolConns = res.data.filter(c => c.marketplaceType === 'trendyol');
      setConnections(trendyolConns);
      if (trendyolConns.length > 0) {
        setSelectedConn(trendyolConns[0]);
        await loadData(trendyolConns[0].id);
      }
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const loadData = async (connId) => {
    setCatLoading(true);
    try {
      const [localRes, catRes, mapRes] = await Promise.all([
        api.get('/marketplace/local-categories'),
        api.get(`/marketplace/connections/${connId}/categories`),
        api.get(`/marketplace/connections/${connId}/category-mappings`)
      ]);
      setLocalCategories(localRes.data);
      setTrendyolCategories(catRes.data?.categories || catRes.data || []);
      setMappings(mapRes.data);
    } catch (err) {
      toast.error('Veriler yüklenemedi');
    } finally { setCatLoading(false); }
  };

  // Build flat searchable list from tree
  const flatCategories = useMemo(() => {
    const result = [];
    const flatten = (cats, path = '') => {
      if (!Array.isArray(cats)) return;
      for (const cat of cats) {
        const fullPath = path ? `${path} > ${cat.name}` : cat.name;
        result.push({ ...cat, fullPath });
        if (cat.subCategories?.length) {
          flatten(cat.subCategories, fullPath);
        }
      }
    };
    flatten(trendyolCategories);
    return result;
  }, [trendyolCategories]);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return [];
    const q = catSearch.toLowerCase();
    return flatCategories
      .filter(c => !c.subCategories?.length) // Only leaf categories
      .filter(c => c.fullPath.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [catSearch, flatCategories]);

  // Mapped lookup
  const mappedLookup = useMemo(() => {
    const map = {};
    for (const m of mappings) {
      map[m.localCategory] = m;
    }
    return map;
  }, [mappings]);

  const handleSaveMapping = async () => {
    if (!selectedLocal || !selectedTrendyol || !selectedConn) return;
    setSaving(true);
    try {
      await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
        localCategory: selectedLocal,
        marketplaceCategoryId: selectedTrendyol.id,
        marketplaceCategoryName: selectedTrendyol.fullPath || selectedTrendyol.name
      });
      toast.success('Kategori eşleştirmesi kaydedildi');
      setSelectedLocal('');
      setSelectedTrendyol(null);
      setCatSearch('');
      const mapRes = await api.get(`/marketplace/connections/${selectedConn.id}/category-mappings`);
      setMappings(mapRes.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Kaydetme hatası');
    } finally { setSaving(false); }
  };

  const handleDeleteMapping = async (id) => {
    try {
      await api.delete(`/marketplace/category-mappings/${id}`);
      toast.success('Eşleştirme silindi');
      setMappings(prev => prev.filter(m => m.id !== id));
    } catch { toast.error('Silme hatası'); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner"></div></div>;

  if (connections.length === 0) {
    return (
      <div>
        <div className="page-title"><h1>Kategori Eşleştirme</h1><p>Pazaryeri kategori eşleştirmesi için önce bir Trendyol bağlantısı ekleyin</p></div>
        <div className="card">
          <div className="empty-state">
            <AlertCircle size={48} className="empty-icon" />
            <h3>Trendyol bağlantısı bulunamadı</h3>
            <p>Pazaryeri sayfasından bir Trendyol bağlantısı oluşturun</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Kategori Eşleştirme</h1>
          <p>XML ürün kategorilerinizi Trendyol kategorileriyle eşleştirin</p>
        </div>
        {connections.length > 1 && (
          <select className="form-select" style={{ width: 220 }}
            value={selectedConn?.id}
            onChange={e => {
              const c = connections.find(c => c.id === e.target.value);
              setSelectedConn(c);
              loadData(c.id);
            }}
          >
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
          </select>
        )}
      </div>

      {/* New Mapping Form */}
      <div className="card" style={{ marginBottom: 20, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link2 size={18} style={{ color: 'var(--accent-primary)' }} />
          Yeni Eşleştirme
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Local Category */}
          <div>
            <label className="form-label">Yerel Kategori (XML)</label>
            <select
              className="form-select"
              value={selectedLocal}
              onChange={e => setSelectedLocal(e.target.value)}
            >
              <option value="">Kategori seçin...</option>
              {localCategories.map(cat => (
                <option key={cat} value={cat} style={{
                  color: mappedLookup[cat] ? 'var(--success)' : undefined
                }}>
                  {cat} {mappedLookup[cat] ? '✓' : ''}
                </option>
              ))}
            </select>
            {selectedLocal && mappedLookup[selectedLocal] && (
              <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', fontSize: 12 }}>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>Mevcut eşleştirme:</span>
                <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>{mappedLookup[selectedLocal].marketplaceCategoryName}</span>
              </div>
            )}
          </div>

          {/* Arrow */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 28 }}>
            <ArrowRight size={20} style={{ color: 'var(--accent-primary)' }} />
          </div>

          {/* Trendyol Category Search */}
          <div>
            <label className="form-label">Trendyol Kategorisi</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
              <input
                className="form-input"
                style={{ paddingLeft: 34 }}
                placeholder="Trendyol'da kategori ara..."
                value={catSearch}
                onChange={e => { setCatSearch(e.target.value); setSelectedTrendyol(null); }}
              />
            </div>

            {selectedTrendyol && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 8,
                background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                fontSize: 13, display: 'flex', alignItems: 'center', gap: 6
              }}>
                <Check size={14} style={{ color: 'var(--accent-primary)' }} />
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{selectedTrendyol.fullPath || selectedTrendyol.name}</span>
              </div>
            )}

            {catSearch.trim() && !selectedTrendyol && (
              <div style={{
                marginTop: 4, maxHeight: 250, overflowY: 'auto',
                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
              }}>
                {catLoading ? (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Loader2 size={18} className="spinning" />
                  </div>
                ) : filteredCategories.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Kategori bulunamadı
                  </div>
                ) : (
                  filteredCategories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => { setSelectedTrendyol(cat); setCatSearch(cat.name); }}
                      style={{
                        display: 'block', width: '100%', padding: '10px 14px',
                        background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)',
                        textAlign: 'left', cursor: 'pointer', transition: 'background 0.15s',
                        fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.06)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{ fontWeight: 500 }}>{cat.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{cat.fullPath}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={handleSaveMapping}
            disabled={!selectedLocal || !selectedTrendyol || saving}
          >
            {saving ? <Loader2 size={14} className="spinning" /> : <Check size={14} />}
            Eşleştirmeyi Kaydet
          </button>
        </div>
      </div>

      {/* Existing Mappings */}
      <div className="table-container">
        <div className="table-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderTree size={18} style={{ color: 'var(--accent-secondary)' }} />
            Eşleştirmeler ({mappings.length})
          </h3>
        </div>

        {mappings.length === 0 ? (
          <div className="empty-state">
            <FolderTree size={40} className="empty-icon" />
            <h3>Henüz eşleştirme yok</h3>
            <p>Yukarıdaki formdan yerel kategorilerinizi Trendyol kategorileriyle eşleştirin</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Yerel Kategori</th>
                <th></th>
                <th>Trendyol Kategorisi</th>
                <th style={{ width: 60 }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(m => (
                <tr key={m.id}>
                  <td>
                    <span className="badge badge-info" style={{ fontSize: 13, padding: '5px 12px' }}>{m.localCategory}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <ArrowRight size={16} style={{ color: 'var(--text-muted)' }} />
                  </td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{m.marketplaceCategoryName || m.marketplaceCategoryId}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {m.marketplaceCategoryId}</div>
                  </td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteMapping(m.id)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Unmapped categories warning */}
      {localCategories.length > 0 && (() => {
        const unmapped = localCategories.filter(c => !mappedLookup[c]);
        if (unmapped.length === 0) return null;
        return (
          <div style={{
            marginTop: 20, padding: 16, borderRadius: 'var(--radius)',
            background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--warning)' }}>
                Eşleştirilmemiş Kategoriler ({unmapped.length})
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {unmapped.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedLocal(c)}
                  className="badge badge-warning"
                  style={{ cursor: 'pointer', border: 'none', fontSize: 12, fontFamily: 'inherit' }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
