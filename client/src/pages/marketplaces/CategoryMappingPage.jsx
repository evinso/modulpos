import { useState, useEffect, useMemo } from 'react';
import { ArrowRight, Search, Check, Loader2, Link2, AlertCircle, FolderTree, Wand2 } from 'lucide-react';
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

  // Attribute state
  const [requiredAttributes, setRequiredAttributes] = useState([]);
  const [attributeMappings, setAttributeMappings] = useState({});
  const [attrLoading, setAttrLoading] = useState(false);
  const [aiMatching, setAiMatching] = useState(false);

  // XML Source Filter
  const [xmlSources, setXmlSources] = useState([]);
  const [filterXmlSource, setFilterXmlSource] = useState('');
  const [categoryAiCost, setCategoryAiCost] = useState(0.5);

  useEffect(() => {
    fetchConnections();
    fetchXmlSources();
    api.get('/credits/prices').then(r => setCategoryAiCost(r.data.categoryAiCost ?? 0.5)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedConn) fetchLocalCategories();
  }, [filterXmlSource, selectedConn]);

  useEffect(() => {
    if (!selectedTrendyol || !selectedConn) {
      setRequiredAttributes([]);
      setAttributeMappings({});
      return;
    }
    const fetchAttrs = async () => {
      setAttrLoading(true);
      try {
        const res = await api.get(`/marketplace/connections/${selectedConn.id}/categories/${selectedTrendyol.id}/attributes`);
        const attrs = res.data?.categoryAttributes || [];
        const required = attrs.filter(a => a.required);
        setRequiredAttributes(required);
        
        // Varsayılan boş değerleri set et
        const initialMappings = {};
        required.forEach(a => {
          initialMappings[a.attribute.id] = { name: a.attribute.name, valueId: '', valueName: '' };
        });
        setAttributeMappings(initialMappings);
      } catch (err) {
        toast.error('Kategori özellikleri alınamadı');
      } finally {
        setAttrLoading(false);
      }
    };
    fetchAttrs();
  }, [selectedTrendyol, selectedConn]);

  const fetchXmlSources = async () => {
    try {
      const res = await api.get('/xml-sources');
      // Sadece kullanıcının kendi eklediği (globalProviderId'si olmayan) XML'leri göster
      const customSources = res.data.filter(s => !s.globalProviderId);
      setXmlSources(customSources);
    } catch {}
  };

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

  const fetchLocalCategories = async () => {
    try {
      const params = filterXmlSource ? { xmlSourceId: filterXmlSource } : {};
      const res = await api.get('/marketplace/local-categories', { params });
      setLocalCategories(res.data);
    } catch (err) {
      toast.error('Kategoriler güncellenemedi');
    }
  };

  const loadData = async (connId) => {
    setCatLoading(true);
    try {
      const params = filterXmlSource ? { xmlSourceId: filterXmlSource } : {};
      const [localRes, catRes, mapRes] = await Promise.all([
        api.get('/marketplace/local-categories', { params }),
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
    
    // Check if all required attributes are mapped
    const unmappedAttr = requiredAttributes.find(a => !attributeMappings[a.attribute.id]?.valueId && !attributeMappings[a.attribute.id]?.valueName);
    if (unmappedAttr) {
      toast.error(`"${unmappedAttr.attribute.name}" özelliği zorunludur.`);
      return;
    }

    setSaving(true);
    try {
      await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
        localCategory: selectedLocal,
        marketplaceCategoryId: selectedTrendyol.id,
        marketplaceCategoryName: selectedTrendyol.fullPath || selectedTrendyol.name,
        attributes: attributeMappings
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

  const handleAiMatch = async () => {
    if (!selectedConn) return;
    const unmapped = localCategories.filter(c => !mappedLookup[c]);
    if (unmapped.length === 0) {
      toast('Tüm kategoriler zaten eşleştirilmiş.');
      return;
    }
    setAiMatching(true);
    try {
      const res = await api.post('/ai/category-match', { xmlCategories: unmapped });
      const matches = res.data.matches || {};
      const aiMatched = Object.values(matches).filter(Boolean).length;
      if (aiMatched === 0) {
        toast.error(`AI hiçbir kategori eşleştiremedi. Kategori isimleri Trendyol'daki kategorilerle çok farklı olabilir.`);
        setAiMatching(false);
        return;
      }
      let added = 0;
      let saveErrors = 0;
      for (const [cat, match] of Object.entries(matches)) {
        if (!match) continue;
        try {
          await api.post(`/marketplace/connections/${selectedConn.id}/category-mappings`, {
            localCategory: cat,
            marketplaceCategoryId: match.id,
            marketplaceCategoryName: match.path,
            attributes: {}
          });
          added++;
        } catch (saveErr) {
          saveErrors++;
          console.error('[AI Save Error]', cat, saveErr?.response?.data || saveErr.message);
        }
      }
      const mapRes = await api.get(`/marketplace/connections/${selectedConn.id}/category-mappings`);
      setMappings(mapRes.data);
      if (saveErrors > 0) {
        toast.error(`${added} kaydedildi, ${saveErrors} kaydedilemedi. Konsola bakın.`);
      } else {
        toast.success(`${added} / ${unmapped.length} kategori otomatik eşleştirildi.`);
      }
    } catch (err) {
      toast.error('AI eşleştirme hatası: ' + (err.response?.data?.error || err.message));
    } finally {
      setAiMatching(false);
    }
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

  const selectedXmlSource = xmlSources.find(s => s.id === filterXmlSource);
  const isGlobalXml = selectedXmlSource && selectedXmlSource.globalProviderId;

  return (
    <div>
      <div className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Kategori Eşleştirme</h1>
          <p>XML ürün kategorilerinizi Trendyol kategorileriyle eşleştirin</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {xmlSources.length > 0 && (
            <select className="form-select" style={{ width: 220 }}
              value={filterXmlSource}
              onChange={e => setFilterXmlSource(e.target.value)}
            >
              <option value="">Tüm Tedarikçiler (XML)</option>
              {xmlSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {connections.length > 0 && (
            <select className="form-select" style={{ width: 220 }}
              value={selectedConn?.id || ''}
              onChange={e => {
                const c = connections.find(c => c.id === e.target.value);
                setSelectedConn(c);
                loadData(c.id);
              }}
            >
              {connections.map(c => <option key={c.id} value={c.id}>{c.supplierName || c.marketplaceType} ({c.marketplaceType})</option>)}
            </select>
          )}
        </div>
      </div>

      {/* New Mapping Form */}
      {(() => {
        if (isGlobalXml) {
          return (
            <div className="card" style={{ marginBottom: 20, padding: 32, textAlign: 'center', background: 'rgba(59,130,246,0.03)' }}>
              <FolderTree size={48} style={{ color: 'var(--accent-primary)', marginBottom: 16, opacity: 0.5, display: 'inline-block' }} />
              <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 8 }}>
                ✨ Ayarlar Tedarikçi Havuzundan Eklendi
              </h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: 500, margin: '0 auto' }}>
                Bu XML kaynağı global havuzdan eklendiği için kategori eşleştirmeleri sistem yöneticisi tarafından merkezi olarak yönetilmektedir. Burada ek bir işlem yapmanıza gerek yoktur.
              </p>
            </div>
          );
        }

        return (
          <div className="card" style={{ marginBottom: 20, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Link2 size={18} style={{ color: 'var(--accent-primary)' }} />
                Yeni Eşleştirme
              </h3>
              <button
                className="btn btn-secondary"
                onClick={handleAiMatch}
                disabled={aiMatching || !selectedConn}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {aiMatching ? <Loader2 size={14} className="spinning" /> : <Wand2 size={14} />}
                {aiMatching ? 'AI Eşleştiriyor...' : `AI ile Otomatik Eşleştir${categoryAiCost > 0 ? ` (${categoryAiCost} kredi/kategori)` : ''}`}
              </button>
            </div>

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

        {/* Required Attributes Section */}
        {selectedTrendyol && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={16} style={{ color: 'var(--warning)' }} />
              Zorunlu Kategori Özellikleri
            </h4>
            
            {attrLoading ? (
              <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
                <Loader2 size={16} className="spinning" /> Özellikler yükleniyor...
              </div>
            ) : requiredAttributes.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Bu kategori için zorunlu özellik bulunmuyor.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                {requiredAttributes.map(attr => (
                  <div key={attr.attribute.id}>
                    <label className="form-label">
                      {attr.attribute.name}
                      <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>
                    </label>
                    {attr.allowCustom ? (
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder={`${attr.attribute.name} girin veya XML alan adını {alan} yazın`}
                        value={attributeMappings[attr.attribute.id]?.valueName || ''}
                        onChange={e => setAttributeMappings(prev => ({
                          ...prev,
                          [attr.attribute.id]: { name: attr.attribute.name, valueName: e.target.value }
                        }))}
                      />
                    ) : (
                      <select 
                        className="form-select"
                        value={attributeMappings[attr.attribute.id]?.valueId || ''}
                        onChange={e => {
                          const valId = e.target.value;
                          const valObj = attr.attributeValues.find(v => v.id.toString() === valId);
                          setAttributeMappings(prev => ({
                            ...prev,
                            [attr.attribute.id]: { 
                              name: attr.attribute.name, 
                              valueId: valId, 
                              valueName: valObj ? valObj.name : '' 
                            }
                          }));
                        }}
                      >
                        <option value="">Seçiniz...</option>
                        {attr.attributeValues.map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
        );
      })()}

    </div>
  );
}
