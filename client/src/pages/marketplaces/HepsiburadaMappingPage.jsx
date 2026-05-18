import { useState, useEffect, useMemo } from 'react';
import { ArrowRight, Search, Check, Loader2, FolderTree, AlertCircle, X, ChevronDown } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function HepsiburadaMappingPage() {
  const [connections, setConnections] = useState([]);
  const [selectedConn, setSelectedConn] = useState(null);
  const [localCategories, setLocalCategories] = useState([]);
  const [hbCategories, setHbCategories] = useState([]); // flat leaf list
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catLoading, setCatLoading] = useState(false);

  // Mapping form
  const [selectedLocal, setSelectedLocal] = useState('');
  const [catSearch, setCatSearch] = useState('');
  const [selectedHb, setSelectedHb] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Attribute state (loaded after HB category selected)
  const [attributes, setAttributes] = useState([]);
  const [attrLoading, setAttrLoading] = useState(false);
  // { [attributeId]: { name, type, required, values: [...] (for enum), selectedValue: '' } }
  const [attrState, setAttrState] = useState({});
  const [enumLoading, setEnumLoading] = useState({}); // attributeId → bool

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
    setHbCategories([]);
    setSelectedHb(null);
    setAttributes([]);
    setAttrState({});
    try {
      const [localRes, catRes, mapRes] = await Promise.all([
        api.get('/marketplace/local-categories'),
        api.get(`/marketplace/connections/${conn.id}/categories`),
        api.get(`/marketplace/connections/${conn.id}/category-mappings`),
      ]);
      setLocalCategories(localRes.data);
      // Flat leaf list (leaf=true ensures no tree nesting needed)
      const cats = catRes.data?.categories || catRes.data?.data || (Array.isArray(catRes.data) ? catRes.data : []);
      setHbCategories(cats);
      setMappings(mapRes.data);
    } catch (err) {
      toast.error('Veriler yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setCatLoading(false); }
  };

  // Filtered categories by search
  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return [];
    const q = catSearch.toLowerCase();
    return hbCategories
      .filter(c => {
        const name = c.name || c.categoryName || '';
        const id = String(c.id || c.categoryId || '');
        return name.toLowerCase().includes(q) || id.includes(q);
      })
      .slice(0, 50);
  }, [catSearch, hbCategories]);

  // Load attributes when HB category selected
  const handleSelectHbCategory = async (cat) => {
    setSelectedHb(cat);
    setCatSearch(cat.name || cat.categoryName || '');
    setAttributes([]);
    setAttrState({});

    setAttrLoading(true);
    try {
      const catId = cat.id || cat.categoryId;
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/categories/${catId}/attributes`);
      // Response may be { data: [...] } or plain array
      const attrs = res.data?.data || (Array.isArray(res.data) ? res.data : []);
      setAttributes(attrs);

      const initState = {};
      for (const a of attrs) {
        const id = a.id || a.attributeId;
        initState[id] = {
          name: a.name || a.attributeName || id,
          type: (a.type || '').toLowerCase(),
          required: !!a.required,
          values: [],
          selectedValue: '',
          selectedValueName: '',
        };
      }
      setAttrState(initState);

      // Auto-load enum values for all enum attributes
      for (const a of attrs) {
        const type = (a.type || '').toLowerCase();
        if (type === 'enum' || type === 'string_enum') {
          loadEnumValues(catId, a.id || a.attributeId);
        }
      }
    } catch (err) {
      toast.error('Özellikler yüklenemedi: ' + (err.response?.data?.error || err.message));
    } finally { setAttrLoading(false); }
  };

  const loadEnumValues = async (catId, attrId) => {
    setEnumLoading(prev => ({ ...prev, [attrId]: true }));
    try {
      const res = await api.get(`/marketplace/connections/${selectedConn.id}/hepsiburada-attribute-values/${catId}/${attrId}`);
      const values = res.data?.data || (Array.isArray(res.data) ? res.data : []);
      setAttrState(prev => ({
        ...prev,
        [attrId]: { ...prev[attrId], values },
      }));
    } catch {
      // silently ignore — non-critical
    } finally {
      setEnumLoading(prev => ({ ...prev, [attrId]: false }));
    }
  };

  const mappedLookup = useMemo(() => {
    const m = {};
    for (const mp of mappings) m[mp.localCategory] = mp;
    return m;
  }, [mappings]);

  const unmappedCategories = localCategories.filter(c => !mappedLookup[c]);
  const mappedCategories = localCategories.filter(c => mappedLookup[c]);

  const handleSave = async () => {
    if (!selectedLocal || !selectedHb || !selectedConn) return;

    // Validate required attributes
    const missingRequired = Object.entries(attrState).filter(([, s]) => s.required && !s.selectedValue);
    if (missingRequired.length > 0) {
      toast.error(`Zorunlu alanları doldurun: ${missingRequired.map(([, s]) => s.name).join(', ')}`);
      return;
    }

    // Build attributes array for storage
    const attributesPayload = Object.entries(attrState)
      .filter(([, s]) => s.selectedValue)
      .map(([id, s]) => ({
        attributeId: id,
        attributeName: s.name,
        type: s.type,
        value: s.selectedValue,
        valueName: s.selectedValueName || s.selectedValue,
      }));

    setSaving(true);
    try {
      const catId = selectedHb.id || selectedHb.categoryId;
      const catName = selectedHb.name || selectedHb.categoryName || String(catId);
      await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
        localCategory: selectedLocal,
        marketplaceCategoryId: String(catId),
        marketplaceCategoryName: catName,
        attributes: JSON.stringify(attributesPayload),
      });
      toast.success(`"${selectedLocal}" → "${catName}" eşlemesi kaydedildi`);
      const mapRes = await api.get(`/marketplace/connections/${selectedConn.id}/category-mappings`);
      setMappings(mapRes.data);
      // Reset form
      setSelectedLocal('');
      setSelectedHb(null);
      setCatSearch('');
      setAttributes([]);
      setAttrState({});
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
    } catch { toast.error('Silme hatası'); }
    finally { setDeletingId(null); }
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

  const hasRequiredAttrs = Object.values(attrState).some(s => s.required);
  const canSave = selectedLocal && selectedHb &&
    !Object.entries(attrState).some(([, s]) => s.required && !s.selectedValue);

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Hepsiburada — Kategori Eşleştirme</h1>
          <p>Ürün kategorilerinizi Hepsiburada yaprak kategorileriyle eşleştirin ve zorunlu özellikleri doldurun</p>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

          {/* ── Left: mapping form ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>Yeni Eşleme Ekle</h3>

              {/* Info: leaf categories */}
              <div style={{ background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
                <AlertCircle size={14} style={{ color: '#ff6000', flexShrink: 0, marginTop: 1 }} />
                <span>Sadece ürün oluşturulabilecek <strong>yaprak kategoriler</strong> listeleniyor (leaf=true, ACTIVE, available).</span>
              </div>

              {/* Local category */}
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

              {/* HB category search */}
              <div className="form-group">
                <label className="form-label">
                  Hepsiburada Kategorisi
                  {hbCategories.length > 0 && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>({hbCategories.length} kategori)</span>}
                </label>

                {hbCategories.length === 0 ? (
                  <div style={{ padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid var(--warning)', borderRadius: 6, fontSize: 12, display: 'flex', gap: 8 }}>
                    <AlertCircle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                    <span>Kategoriler yüklenemedi. MPOP API erişiminizi kontrol edin.</span>
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative' }}>
                      <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-muted)' }} />
                      <input
                        className="form-input"
                        style={{ paddingLeft: 32 }}
                        placeholder="Kategori adı veya ID yazın..."
                        value={catSearch}
                        onChange={e => {
                          setCatSearch(e.target.value);
                          if (selectedHb) { setSelectedHb(null); setAttributes([]); setAttrState({}); }
                        }}
                      />
                    </div>

                    {selectedHb && (
                      <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,96,0,0.08)', border: '1px solid rgba(255,96,0,0.3)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Check size={14} style={{ color: '#ff6000' }} />
                        <span style={{ color: '#ff6000', fontWeight: 600, flex: 1 }}>{selectedHb.name || selectedHb.categoryName}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {selectedHb.id || selectedHb.categoryId}</span>
                        <button type="button" onClick={() => { setSelectedHb(null); setCatSearch(''); setAttributes([]); setAttrState({}); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
                          <X size={14} />
                        </button>
                      </div>
                    )}

                    {filteredCategories.length > 0 && !selectedHb && (
                      <div style={{ marginTop: 4, maxHeight: 260, overflowY: 'auto', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                        {filteredCategories.map(cat => {
                          const id = cat.id || cat.categoryId;
                          const name = cat.name || cat.categoryName || '';
                          return (
                            <button key={id} type="button"
                              onClick={() => handleSelectHbCategory(cat)}
                              style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)', textAlign: 'left', cursor: 'pointer', fontSize: 13 }}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,96,0,0.06)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                              <div style={{ fontWeight: 500 }}>{name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {id}</div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {catSearch.length >= 2 && filteredCategories.length === 0 && !selectedHb && (
                      <div style={{ marginTop: 6, padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', borderRadius: 6 }}>
                        "{catSearch}" ile eşleşen kategori bulunamadı
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Attributes */}
              {attrLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', fontSize: 13, color: 'var(--text-muted)' }}>
                  <Loader2 size={14} className="spinning" /> Özellikler yükleniyor...
                </div>
              )}

              {!attrLoading && attributes.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Kategori Özellikleri {hasRequiredAttrs && <span style={{ color: 'var(--danger)' }}>— zorunlu alanları doldurun</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {attributes.map(a => {
                      const id = a.id || a.attributeId;
                      const state = attrState[id] || {};
                      const isEnum = state.type === 'enum' || state.type === 'string_enum';
                      const isRequired = state.required;

                      return (
                        <div key={id} className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: 12 }}>
                            {state.name}
                            {isRequired && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>}
                            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>({state.type})</span>
                          </label>

                          {isEnum ? (
                            enumLoading[id] ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                                <Loader2 size={12} className="spinning" /> Değerler yükleniyor...
                              </div>
                            ) : state.values.length > 0 ? (
                              <select className="form-select" style={{ fontSize: 13 }}
                                value={state.selectedValue}
                                onChange={e => {
                                  const opt = state.values.find(v => String(v.id || v.value || v) === e.target.value);
                                  const name = opt ? (opt.name || opt.label || e.target.value) : e.target.value;
                                  setAttrState(prev => ({
                                    ...prev,
                                    [id]: { ...prev[id], selectedValue: e.target.value, selectedValueName: name },
                                  }));
                                }}
                              >
                                <option value="">{isRequired ? 'Seçiniz...' : '— Boş bırak —'}</option>
                                {state.values.map(v => {
                                  const vId = String(v.id || v.value || v);
                                  const vName = v.name || v.label || vId;
                                  return <option key={vId} value={vId}>{vName}</option>;
                                })}
                              </select>
                            ) : (
                              <input className="form-input" style={{ fontSize: 13 }} placeholder="Değer girin..."
                                value={state.selectedValue}
                                onChange={e => setAttrState(prev => ({ ...prev, [id]: { ...prev[id], selectedValue: e.target.value, selectedValueName: e.target.value } }))} />
                            )
                          ) : (
                            <input className="form-input" style={{ fontSize: 13 }}
                              placeholder={isRequired ? 'Zorunlu alan...' : 'İsteğe bağlı...'}
                              value={state.selectedValue}
                              onChange={e => setAttrState(prev => ({ ...prev, [id]: { ...prev[id], selectedValue: e.target.value, selectedValueName: e.target.value } }))} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 16 }}
                disabled={!canSave || saving}
                onClick={handleSave}
              >
                {saving ? <><Loader2 size={14} className="spinning" /> Kaydediliyor...</> : <><ArrowRight size={14} /> Eşlemeyi Kaydet</>}
              </button>
            </div>
          </div>

          {/* ── Right: existing mappings ── */}
          <div>
            <div className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15 }}>Mevcut Eşlemeler ({mappings.length})</h3>

              {mappings.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>
                  Henüz eşleme yok
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mappings.map(m => {
                    let attrs = [];
                    try { attrs = m.attributes ? JSON.parse(m.attributes) : []; } catch {}
                    const requiredFilled = attrs.filter(a => a.value).length;
                    return (
                      <div key={m.id} style={{ padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 13 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, fontWeight: 500 }}>{m.localCategory}</span>
                          <ArrowRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <span style={{ flex: 1, color: '#ff6000', fontSize: 12 }}>{m.marketplaceCategoryName || m.marketplaceCategoryId}</span>
                          <button onClick={() => handleDelete(m.id)} disabled={deletingId === m.id}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                            {deletingId === m.id ? <Loader2 size={13} className="spinning" /> : <X size={13} />}
                          </button>
                        </div>
                        {requiredFilled > 0 && (
                          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                            {attrs.filter(a => a.value).map(a => `${a.attributeName}: ${a.valueName || a.value}`).join(' · ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {unmappedCategories.length > 0 && (
                <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)', marginBottom: 6 }}>
                    Eşleşmemiş Kategoriler ({unmappedCategories.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {unmappedCategories.map(c => (
                      <span key={c} onClick={() => setSelectedLocal(c)}
                        style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--warning)', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>
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
