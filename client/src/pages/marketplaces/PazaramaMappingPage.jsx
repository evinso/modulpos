import { useState, useEffect, useMemo } from 'react';
import { FolderTree, Search, ArrowRight, Check, Trash2, Loader2, Package } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

function flattenTree(nodes, depth = 0, result = []) {
  if (!Array.isArray(nodes)) return result;
  for (const node of nodes) {
    result.push({ ...node, _depth: depth });
    const children = node.subCategories || node.children || node.subCategory || [];
    if (children.length) flattenTree(children, depth + 1, result);
  }
  return result;
}

export default function PazaramaMappingPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [localCategories, setLocalCategories] = useState([]);
  const [pzCategories, setPzCategories] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catLoading, setCatLoading] = useState(false);

  const [selectedLocal, setSelectedLocal] = useState('');
  const [catSearch, setCatSearch] = useState('');
  const [selectedPz, setSelectedPz] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => { fetchConnections(); }, []);

  const fetchConnections = async () => {
    try {
      const res = await api.get('/marketplace/connections');
      const pz = res.data.filter(c => c.marketplaceType === 'pazarama');
      setConnections(pz);
      if (pz.length > 0) loadData(pz[0]);
    } catch { toast.error('Bağlantılar yüklenemedi'); }
    finally { setLoading(false); }
  };

  const loadData = async (conn) => {
    setSelectedConn(conn);
    setCatLoading(true);
    setPzCategories([]);
    setSelectedPz(null);
    try {
      const [localRes, catRes, mapRes] = await Promise.all([
        api.get('/marketplace/local-categories'),
        api.get(`/marketplace/connections/${conn.id}/categories`),
        api.get(`/marketplace/connections/${conn.id}/category-mappings`),
      ]);
      setLocalCategories(localRes.data);
      const raw = catRes.data;
      const nodes = raw?.data || raw?.categories || (Array.isArray(raw) ? raw : []);
      setPzCategories(flattenTree(nodes));
      setMappings(mapRes.data);
    } catch (err) {
      toast.error('Veriler yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setCatLoading(false); }
  };

  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return [];
    const q = catSearch.toLowerCase();
    return pzCategories.filter(c => {
      const name = c.name || c.categoryName || '';
      const id = String(c.id || c.categoryId || '');
      return name.toLowerCase().includes(q) || id.includes(q);
    }).slice(0, 50);
  }, [pzCategories, catSearch]);

  const handleSave = async () => {
    if (!selectedLocal || !selectedPz) return toast.error('Lütfen her iki kategoriyi seçin');
    setSaving(true);
    try {
      const localCat = localCategories.find(c => c === selectedLocal || c.id === selectedLocal);
      const res = await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
        localCategory: selectedLocal,
        marketplaceCategory: String(selectedPz.id || selectedPz.categoryId),
        marketplaceCategoryName: selectedPz.name || selectedPz.categoryName,
      });
      setMappings(prev => [...prev, res.data]);
      setSelectedLocal('');
      setSelectedPz(null);
      setCatSearch('');
      toast.success('Eşleştirme kaydedildi');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Kaydetme başarısız');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/marketplace/category-mappings/${id}`);
      setMappings(prev => prev.filter(m => m.id !== id));
      toast.success('Eşleştirme silindi');
    } catch { toast.error('Silme başarısız'); }
    finally { setDeletingId(null); }
  };

  if (loading) return <div className="loading-spinner"><div className="spinner" /></div>;

  if (connections.length === 0) return (
    <div className="page-title">
      <h1>Pazarama — Kategori Eşleştirme</h1>
      <div className="card" style={{ marginTop: 24, padding: 40, textAlign: 'center' }}>
        <Package size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
        <h3>Pazarama bağlantısı bulunamadı</h3>
        <p style={{ color: 'var(--text-muted)' }}>Pazaryerlerim sayfasından Pazarama hesabınızı ekleyin.</p>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Pazarama — Kategori Eşleştirme</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>XML kategorilerinizi Pazarama kategorileriyle eşleştirin</p>
        </div>
        {connections.length > 1 && (
          <select className="form-select" style={{ width: 'auto' }} value={selectedConn?.id}
            onChange={e => loadData(connections.find(c => c.id === e.target.value))}>
            {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.sellerId}</option>)}
          </select>
        )}
      </div>

      {/* Mapping Form */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderTree size={16} /> Yeni Eşleştirme
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'start' }}>
          {/* Local Category */}
          <div>
            <label className="form-label">XML / Yerel Kategori</label>
            <select className="form-select" value={selectedLocal} onChange={e => setSelectedLocal(e.target.value)}>
              <option value="">— Kategori seçin —</option>
              {localCategories.map((c, i) => (
                <option key={i} value={typeof c === 'string' ? c : c.id}>{typeof c === 'string' ? c : c.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
            <ArrowRight size={20} style={{ color: 'var(--text-muted)' }} />
          </div>

          {/* Pazarama Category */}
          <div>
            <label className="form-label">Pazarama Kategorisi</label>
            {catLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: '8px 0', fontSize: 13 }}>
                <Loader2 size={14} className="spinning" /> Kategoriler yükleniyor...
              </div>
            ) : (
              <>
                {selectedPz ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', fontSize: 13 }}>
                    <Check size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 500 }}>{selectedPz.name || selectedPz.categoryName}</span>
                    <button onClick={() => { setSelectedPz(null); setCatSearch(''); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                      ×
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative' }}>
                      <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input className="form-input" style={{ paddingLeft: 32 }} placeholder="Kategori adı veya ID ara..."
                        value={catSearch} onChange={e => setCatSearch(e.target.value)} />
                    </div>
                    {filteredCategories.length > 0 && (
                      <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                        {filteredCategories.map((c, i) => (
                          <button key={i} onClick={() => { setSelectedPz(c); setCatSearch(''); }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', padding: `6px ${12 + (c._depth || 0) * 12}px`,
                              border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
                              color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)',
                            }}>
                            {c._depth > 0 && <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>{'└─'.repeat(Math.min(c._depth, 2))}</span>}
                            {c.name || c.categoryName}
                            <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>#{c.id || c.categoryId}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {catSearch.length > 0 && filteredCategories.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Sonuç bulunamadı</div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !selectedLocal || !selectedPz}>
            {saving ? <Loader2 size={14} className="spinning" /> : <Check size={14} />}
            Eşleştirmeyi Kaydet
          </button>
        </div>
      </div>

      {/* Saved Mappings */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: 14 }}>
          Kayıtlı Eşleştirmeler ({mappings.length})
        </div>
        {mappings.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Henüz eşleştirme yapılmamış</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left' }}>XML Kategori</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', width: 40 }}>→</th>
                <th style={{ padding: '10px 14px', textAlign: 'left' }}>Pazarama Kategori</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 500 }}>{m.localCategory}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-muted)' }}>→</td>
                  <td style={{ padding: '10px 14px' }}>
                    <div>{m.marketplaceCategoryName || m.marketplaceCategory}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {m.marketplaceCategory}</div>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <button onClick={() => handleDelete(m.id)} disabled={deletingId === m.id}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'flex', alignItems: 'center' }}>
                      {deletingId === m.id ? <Loader2 size={15} className="spinning" /> : <Trash2 size={15} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
